// Check-in at the door: Admin > Check in (Gary) and check-in helpers (check-in only).
// Every guest is checked in on their own. Each check-in is a single database step that only succeeds if that guest
// isn't checked in yet, so two phones scanning or tapping at the same moment can never check someone in twice:
// the second phone is told ALREADY CHECKED IN, with the time.
import { textResponse, redirect } from '../lib/http.js';
import { normaliseEmail } from '../lib/emails.js';
import { EMAIL_RE } from '../bookings/config.js';
import { ukToday } from '../lib/dates.js';
import * as data from '../lib/data.js';
import * as m from '../events/model.js';
import * as view from '../views/admin-checkin.js';
import * as sc from '../selfcheckin/model.js';
import { sameNameGroups } from '../selfcheckin/names.js';
import { siteOrigin } from '../lib/http.js';

import { att, checkIn, undoStatement, counts, resetTestStatements } from '../selfcheckin/attendance.js';

const nowIso = () => new Date().toISOString();
const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '').toLowerCase();

// The events to check in for. Normally: from two days ago onwards, with online tickets or bookings.
// "Show every event" (all = true): every event in the events list, any date, for choosing or testing any event.
async function eventsForCheckin(env, { all = false } = {}) {
  const from = new Date(Date.parse(ukToday() + 'T12:00:00Z') - 2 * 86400_000).toISOString().slice(0, 10);
  const counted = `(SELECT COUNT(*) FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id WHERE g.event_id = e.id AND b.status = 'confirmed') AS booked,
      (SELECT COUNT(*) FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id WHERE g.event_id = e.id AND b.status = 'confirmed' AND g.checked_in_at IS NOT NULL) AS arrived`;
  const { results } = all
    ? await env.DB.prepare(`SELECT e.*, ${counted} FROM events e ORDER BY (e.date >= ?1) DESC, CASE WHEN e.date >= ?1 THEN e.date END ASC, e.date DESC, e.id LIMIT 300`).bind(from).all()
    : await env.DB.prepare(`SELECT e.*, ${counted} FROM events e WHERE e.date >= ?1 AND (e.sales_mode = 'online' OR EXISTS (SELECT 1 FROM event_bookings b WHERE b.event_id = e.id))
      ORDER BY e.date, e.start_time, e.id LIMIT 40`).bind(from).all();
  return results || [];
}

// Guests for the door list (names and what's needed at the door only: no contact details, no payments beyond "to pay")
async function doorGuests(env, eventId, q, current, test) {
  const a = att(test);
  const where = [`g.event_id = ?1`, `b.status = 'confirmed'`];
  const binds = [eventId];
  if (current === 'arrived') where.push(`${a.at} IS NOT NULL`);
  if (current === 'waiting') where.push(`${a.at} IS NULL`);
  const text = String(q || '').trim().toLowerCase().slice(0, 80);
  if (text) {
    binds.push('%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
    where.push(`(lower(g.name) LIKE ?${binds.length} ESCAPE '\\' OR lower(b.purchaser_name) LIKE ?${binds.length} ESCAPE '\\' OR lower(b.reference) LIKE ?${binds.length} ESCAPE '\\')`);
  }
  const { results } = await env.DB.prepare(`SELECT g.id, g.booking_id, g.name, g.position, ${a.at} AS checked_in_at, ${a.by} AS checked_in_by, b.reference, b.purchaser_name, b.quantity,
      b.payment_status, b.total_pence FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id ${a.join}
    WHERE ${where.join(' AND ')} ORDER BY g.name COLLATE NOCASE, g.id LIMIT 500`).bind(...binds).all();
  return results || [];
}

async function partyGuests(env, b, test) {
  const a = att(test);
  const { results } = await env.DB.prepare(`SELECT g.id, g.booking_id, g.event_id, g.position, g.name, ${a.at} AS checked_in_at, ${a.by} AS checked_in_by,
      ?2 AS reference, ?3 AS purchaser_name, ?4 AS quantity, ?5 AS payment_status, ?6 AS total_pence
    FROM event_guests g ${a.join} WHERE g.booking_id = ?1 ORDER BY g.position`).bind(b.id, b.reference, b.purchaser_name, 1, b.payment_status, b.total_pence).all();
  return results || [];
}

// ---------- Julie's live check-in screen ----------
// One small request, every few seconds, while the screen is open: the totals and a "stamp" that changes whenever anyone
// is checked in or undone (on the iPad or any phone), the iPad asks for Julie, or the iPad's state changes. When the
// stamp changes, the screen reloads its lists by itself.
async function liveStamp(env, eventId, test) {
  const a = att(test);
  const [g, h, tb] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS booked, COUNT(${a.at}) AS arrived, MAX(${a.at}) AS last_in,
        SUM(CASE WHEN ${a.at} IS NOT NULL THEN g.id ELSE 0 END) AS who
      FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id ${a.join} WHERE g.event_id = ?1 AND b.status = 'confirmed'`).bind(eventId),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS last, COALESCE(SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END), 0) AS open
      FROM checkin_help WHERE event_id = ?1 AND test = ?2`).bind(eventId, test ? 1 : 0),
    env.DB.prepare(`SELECT id, event_id, mode, state, state_changed_at, last_seen_at, token_hash, pending_count, last_sync_at FROM checkin_tablets WHERE revoked_at IS NULL ORDER BY id`)
  ]);
  const t = g.results[0], x = h.results[0];
  // The iPad part of the stamp: its event, mode, state, and whether it is connected (so "not seen" shows by itself)
  const tablets = (tb.results || []).map((r) => [r.id, r.event_id, r.mode, r.state, r.state_changed_at, sc.tabletOnline(r) ? 1 : 0, r.pending_count, r.last_sync_at || ''].join(':')).join(',');
  return { booked: t.booked, arrived: t.arrived, waiting: t.booked - t.arrived, help: x.open,
    stamp: [t.booked, t.arrived, t.last_in || '', t.who || 0, x.last, x.open, tablets].join('|') };
}

async function helpRequests(env, eventId, test) {
  const { results } = await env.DB.prepare(`SELECT h.*, b.reference, b.purchaser_name, b.quantity FROM checkin_help h LEFT JOIN event_bookings b ON b.id = h.booking_id
    WHERE h.event_id = ?1 AND h.test = ?2 AND h.resolved_at IS NULL ORDER BY h.id DESC LIMIT 30`).bind(eventId, test ? 1 : 0).all();
  return results || [];
}

// Every confirmed guest of the event, for "Same name" and "Groups partly arrived"
async function allGuests(env, eventId, test) {
  const a = att(test);
  const { results } = await env.DB.prepare(`SELECT g.id, g.booking_id, g.name, g.position, ${a.at} AS checked_in_at, ${a.by} AS checked_in_by, b.reference, b.purchaser_name, b.quantity,
      b.payment_status, b.total_pence FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id ${a.join} WHERE g.event_id = ?1 AND b.status = 'confirmed'
    ORDER BY g.booking_id, g.position`).bind(eventId).all();
  return results || [];
}

// Bookings of two or more where some, but not all, of the guests have arrived
function partlyArrived(guests) {
  const by = new Map();
  for (const g of guests) { if (!by.has(g.booking_id)) by.set(g.booking_id, []); by.get(g.booking_id).push(g); }
  return [...by.values()].filter((list) => list.length > 1 && list.some((g) => g.checked_in_at) && list.some((g) => !g.checked_in_at))
    .map((list) => ({ booking_id: list[0].booking_id, reference: list[0].reference, purchaser_name: list[0].purchaser_name, total: list.length,
      arrived: list.filter((g) => g.checked_in_at), waiting: list.filter((g) => !g.checked_in_at) }));
}

async function recentArrivals(env, eventId, test) {
  const a = att(test);
  const { results } = await env.DB.prepare(`SELECT g.id, g.name, ${a.at} AS checked_in_at, ${a.by} AS checked_in_by FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id ${a.join}
    WHERE g.event_id = ?1 AND b.status = 'confirmed' AND ${a.at} IS NOT NULL ORDER BY ${a.at} DESC LIMIT 8`).bind(eventId).all();
  return results || [];
}

// Offline check-ins the iPad has sent for this event (TEST or LIVE): how many were accepted, already in, not accepted
async function offlineSummary(env, eventId, test) {
  const { results } = await env.DB.prepare(`SELECT result, COUNT(*) AS n FROM checkin_sync_log WHERE event_id = ?1 AND test = ?2 AND offline = 1 AND result != 'note' GROUP BY result`)
    .bind(eventId, test ? 1 : 0).all();
  const out = { in: 0, already: 0, rejected: 0 };
  for (const r of results || []) out[r.result] = r.n;
  return out;
}

const activeTablets = async (env) => (await env.DB.prepare('SELECT * FROM checkin_tablets WHERE revoked_at IS NULL ORDER BY id').all()).results || [];

// The one place a guest is checked in (live attendance; Test Mode passes test = true). Returns { ok } or { already: guest }.
export async function checkInGuest(env, eventId, guestId, by, test = false) {
  return checkIn(env, eventId, guestId, by, test);
}

const backPath = (eventId, raw) => (typeof raw === 'string' && raw.startsWith(`/admin/checkin/${eventId}`) && !/[\r\n]/.test(raw) ? raw : `/admin/checkin/${eventId}`);
const withParam = (p, k, v) => p + (p.includes('?') ? '&' : '?') + k + '=' + encodeURIComponent(v);

const FLASHES = {
  tablet: 'The iPad now uses this event. It is closed until you start check-in.',
  test: 'TEST MODE check-in is open on the iPad. Nothing real is recorded.',
  live: 'LIVE check-in is open on the iPad. Guests’ check-ins are real attendance.',
  paused: 'Check-in is paused. The iPad shows “Check-In Temporarily Paused. Please See Julie.”',
  resumed: 'Check-in has resumed.',
  closed: 'Check-in is closed. The iPad shows “Check-In Closed. Please See Julie.” Nothing has been deleted.',
  disconnected: 'The iPad is disconnected (it stays set up). Nothing has been deleted. Use Reconnect when you need it again.',
  reconnected: 'The iPad is reconnected. Check-in is closed until you start it.',
  reset: 'Test check-ins for this event have been cleared. Real attendance was not touched.',
  noevent: 'Choose an event for the iPad first.',
  confirm: 'LIVE check-in was not started: please tick the confirmation box.'
};

function flashFrom(url, guests) {
  const g = (id) => guests.find((x) => String(x.id) === String(id));
  if (url.searchParams.get('in')) { const x = g(url.searchParams.get('in')); return x ? { kind: 'is-good', text: `CHECKED IN: ${x.name}` } : null; }
  if (url.searchParams.get('many')) return { kind: 'is-good', text: `CHECKED IN: ${url.searchParams.get('many')} guests` };
  if (url.searchParams.get('already')) {
    const at = url.searchParams.get('at');
    return { kind: 'is-done', text: `ALREADY CHECKED IN${url.searchParams.get('name') ? ': ' + url.searchParams.get('name') : ''}${at ? ' at ' + clock(at) : ''}${url.searchParams.get('by') ? ' (' + url.searchParams.get('by') + ')' : ''}` };
  }
  if (url.searchParams.get('undone')) return { kind: 'is-done', text: 'Check-in undone.' };
  const f = url.searchParams.get('ipad');
  if (FLASHES[f]) return { kind: f === 'confirm' || f === 'noevent' ? 'is-bad' : 'is-good', text: FLASHES[f] };
  return null;
}

// TEST or LIVE view of Julie's screen: ?mode=test on pages, a "mode" field on forms
const isTest = (method, url, form) => (method === 'GET' ? url.searchParams.get('mode') : form.fields.mode) === 'test';
const modeQ = (test) => (test ? '?mode=test' : '');

export async function handleCheckin({ request, env, url, method, path, form, page, csrf, admin }) {
  const helper = admin.role === 'helper' ? admin.name : '';
  const by = admin.role === 'owner' ? 'Gary' : admin.name;

  if (path === '/admin/checkin') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const all = url.searchParams.get('all') === '1';
    const [events, tablets] = await Promise.all([eventsForCheckin(env, { all }), activeTablets(env)]);
    return page(view.eventsPage({ events, tablets, all, csrf: csrf.token, helper }));
  }

  if (path === '/admin/checkin/tablets' || path.startsWith('/admin/checkin/tablets/')) return handleTablets({ env, url, method, path, form, page, csrf, by, request });

  // From the QR code's own page, or the phone's Camera app: find the event, then the booking
  const find = path.match(/^\/admin\/checkin\/find\/([A-Za-z0-9_-]{0,64})$/);
  if (find) {
    const b = m.isCheckinToken(find[1]) ? await env.DB.prepare('SELECT id, event_id FROM event_bookings WHERE checkin_token = ?1').bind(find[1]).first() : null;
    if (!b) return page(view.notFoundPage({ csrf: csrf.token, helper }), 404);
    return redirect(`/admin/checkin/${b.event_id}/booking/${b.id}?scanned=1`);
  }

  const em = path.match(/^\/admin\/checkin\/(\d{1,9})(?:\/(.*))?$/);
  if (!em) return null;
  const event = await m.getEvent(env, Number(em[1]));
  if (!event) return null;
  const rest = em[2] || '';
  const test = isTest(method, url, form);

  if (!rest) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const current = ['all', 'arrived', 'waiting'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'all';
    const q = String(url.searchParams.get('q') || '').slice(0, 80);
    const [totals, guests, help, everyone, recent, tablets, offline] = await Promise.all([counts(env, event.id, test), doorGuests(env, event.id, q, current, test),
      helpRequests(env, event.id, test), allGuests(env, event.id, test), recentArrivals(env, event.id, test), activeTablets(env), offlineSummary(env, event.id, test)]);
    const all = url.searchParams.get('in') ? await doorGuests(env, event.id, '', 'all', test) : guests;
    const tabletEvents = {};
    for (const t of tablets) if (t.event_id && !tabletEvents[t.event_id]) tabletEvents[t.event_id] = t.event_id === event.id ? event : await m.getEvent(env, t.event_id);
    return page(view.doorPage({ event, totals, guests, q, current, csrf: csrf.token, helper, flash: flashFrom(url, all), help, same: sameNameGroups(everyone),
      partial: partlyArrived(everyone), recent, tablets, tabletEvents, test, offline }));
  }

  if (rest === 'live') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return new Response(JSON.stringify(await liveStamp(env, event.id, test)), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  // Julie has dealt with something the iPad sent her
  const hm = rest.match(/^help\/(\d{1,9})\/done$/);
  if (hm) {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    await env.DB.prepare('UPDATE checkin_help SET resolved_at = ?1, resolved_by = ?2 WHERE id = ?3 AND event_id = ?4 AND resolved_at IS NULL')
      .bind(nowIso(), by, Number(hm[1]), event.id).run();
    return redirect(backPath(event.id, form.fields.back));
  }

  // Test Mode: clear this event's practice check-ins (real attendance is never touched)
  if (rest === 'test-reset') {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    await env.DB.batch([...resetTestStatements(env, event.id), data.audit(env, 'selfcheckin.test_reset', `Test check-ins cleared for ${event.name} by ${by}`)]);
    return redirect(`/admin/checkin/${event.id}?mode=test&ipad=reset`);
  }

  if (rest === 'totals') {
    const t = await counts(env, event.id, test);
    return new Response(JSON.stringify(t), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  // A scanned QR code (from the SCAN QR CODE button)
  const tm = rest.match(/^t\/([A-Za-z0-9_-]{0,64})$/);
  if (tm) {
    const b = m.isCheckinToken(tm[1]) ? await env.DB.prepare('SELECT * FROM event_bookings WHERE checkin_token = ?1').bind(tm[1]).first() : null;
    if (!b) return page(view.notFoundPage({ csrf: csrf.token, helper, eventId: event.id }), 404);
    if (b.event_id !== event.id) return page(view.otherEventPage({ event, other: await m.getEvent(env, b.event_id), b, csrf: csrf.token, helper }), 409);
    return redirect(`/admin/checkin/${event.id}/booking/${b.id}?scanned=1${test ? '&mode=test' : ''}`);
  }

  const bm = rest.match(/^booking\/(\d{1,9})(\/all)?$/);
  if (bm) {
    const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1 AND event_id = ?2').bind(Number(bm[1]), event.id).first();
    if (!b) return null;
    if (bm[2]) {
      if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
      let n = 0;
      for (const g of await partyGuests(env, b, test)) if (!g.checked_in_at && (await checkIn(env, event.id, g.id, by, test)).ok) n++;
      return redirect(`/admin/checkin/${event.id}/booking/${b.id}${n ? '?many=' + n : '?already=1'}${test ? '&mode=test' : ''}`);
    }
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const guests = await partyGuests(env, b, test);
    return page(view.partyPage({ event, b, guests, csrf: csrf.token, helper, flash: flashFrom(url, guests), scanned: url.searchParams.has('scanned'), test }));
  }

  const gm = rest.match(/^guest\/(\d{1,9})(\/undo)?$/);
  if (gm) {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const back = backPath(event.id, form.fields.back);
    if (gm[2]) {
      await env.DB.batch([undoStatement(env, event.id, Number(gm[1]), test),
        data.audit(env, test ? 'checkin.test_undo' : 'checkin.undo', `${test ? 'TEST check-in' : 'Check-in'} undone for guest ${gm[1]} (${event.name}) by ${by}`)]);
      return redirect(withParam(back, 'undone', '1'));
    }
    const result = await checkIn(env, event.id, Number(gm[1]), by, test);
    if (result.ok) return redirect(withParam(back, 'in', gm[1]));
    if (result.already) {
      return redirect(withParam(withParam(withParam(withParam(back, 'already', '1'), 'name', result.already.name), 'at', result.already.checked_in_at), 'by', result.already.checked_in_by || ''));
    }
    return redirect(back);
  }
  return null;
}

// ---------- iPad self check-in: Admin controls ----------
// Gary and Julie (any check-in role) choose the iPad's event (any event, any date), start TEST or LIVE check-in, pause,
// resume, close, disconnect and reconnect. None of these deletes a booking or any attendance. Starting LIVE check-in
// always needs a tick to confirm it, so an event can't be opened for real by accident while testing.
const ACTIONS = ['use', 'test', 'live', 'pause', 'resume', 'close', 'disconnect', 'reconnect'];

async function controlTablet(env, t, action, { eventId, confirmed, by }) {
  const set = (fields) => {
    const keys = Object.keys(fields);
    return env.DB.prepare(`UPDATE checkin_tablets SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, state_changed_at = ?${keys.length + 1}, state_changed_by = ?${keys.length + 2}
      WHERE id = ?${keys.length + 3} AND revoked_at IS NULL`).bind(...keys.map((k) => fields[k]), nowIso(), by, t.id);
  };
  const event = async (id) => (id ? await m.getEvent(env, id) : null);
  let step, flash, what;
  if (action === 'use') {
    const e = await event(eventId);
    if (!e) return { flash: 'noevent' };
    // A new event always starts closed and in Test Mode: nothing opens for real until it is started on purpose
    step = set({ event_id: e.id, mode: 'test', state: 'closed' }); flash = 'tablet'; what = `set to ${e.name} (closed, Test Mode)`;
  } else {
    const e = await event(t.event_id);
    if (!e && ['test', 'live', 'resume'].includes(action)) return { flash: 'noevent' };
    if (action === 'test') { step = set({ mode: 'test', state: 'active' }); flash = 'test'; what = `TEST MODE check-in started for ${e.name}`; }
    if (action === 'live') {
      if (!confirmed) return { flash: 'confirm' };
      step = set({ mode: 'live', state: 'active' }); flash = 'live'; what = `LIVE check-in started for ${e.name}`;
    }
    if (action === 'pause') { if (t.state !== 'active') return { flash: null }; step = set({ state: 'paused' }); flash = 'paused'; what = 'check-in paused'; }
    if (action === 'resume') { if (t.state !== 'paused') return { flash: null }; step = set({ state: 'active' }); flash = 'resumed'; what = 'check-in resumed'; }
    if (action === 'close') { step = set({ state: 'closed' }); flash = 'closed'; what = 'check-in closed'; }
    if (action === 'disconnect') { step = set({ state: 'disconnected' }); flash = 'disconnected'; what = 'disconnected (still set up)'; }
    if (action === 'reconnect') { step = set({ state: 'closed' }); flash = 'reconnected'; what = 'reconnected (closed)'; }
  }
  await env.DB.batch([step, data.audit(env, 'selfcheckin.' + action, `iPad "${t.name}": ${what} by ${by}`)]);
  return { flash };
}

async function handleTablets({ env, url, method, path, form, page, csrf, by, request }) {
  const origin = siteOrigin(request, env);
  if (path === '/admin/checkin/tablets') {
    if (method === 'GET') {
      const [tablets, events] = await Promise.all([activeTablets(env), eventsForCheckin(env, { all: true })]);
      return page(view.tabletsPage({ tablets, events, csrf: csrf.token, flash: url.searchParams.get('flash') || url.searchParams.get('ipad'), origin }));
    }
    // Add an iPad: it gets a setup code straight away
    const name = String(form.fields.name || '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'Entrance iPad';
    const r = await env.DB.prepare('INSERT INTO checkin_tablets (name, created_by) VALUES (?1, ?2) RETURNING id').bind(name, by).first();
    await data.audit(env, 'selfcheckin.add', `iPad "${name}" added by ${by}`).run();
    const code = await sc.issuePairCode(env, r.id);
    return page(view.tabletCodePage({ tablet: { id: r.id, name }, code, origin, csrf: csrf.token }));
  }
  const tm = path.match(/^\/admin\/checkin\/tablets\/(\d{1,9})\/(code|control|live|rename|remove)$/);
  if (!tm) return null;
  const t = await env.DB.prepare('SELECT * FROM checkin_tablets WHERE id = ?1 AND revoked_at IS NULL').bind(Number(tm[1])).first();
  if (!t) return redirect('/admin/checkin/tablets');
  const back = (raw) => (typeof raw === 'string' && /^\/admin\/checkin(\/|$|\?)/.test(raw) && !/[\r\n]/.test(raw) ? raw : '/admin/checkin/tablets');

  // Confirming LIVE check-in (a page of its own, with a tick box)
  if (tm[2] === 'live' && method === 'GET') {
    const e = t.event_id ? await m.getEvent(env, t.event_id) : null;
    if (!e) return redirect('/admin/checkin/tablets?ipad=noevent');
    return page(view.liveConfirmPage({ tablet: t, event: e, totals: await counts(env, e.id, false), today: ukToday(), back: back(url.searchParams.get('back')), csrf: csrf.token }));
  }
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  if (tm[2] === 'control') {
    const action = ACTIONS.includes(form.fields.action) ? form.fields.action : '';
    if (!action) return redirect(back(form.fields.back));
    const r = await controlTablet(env, t, action, { eventId: Number(form.fields.event_id) || 0, confirmed: form.fields.confirm === 'yes', by });
    let to = back(form.fields.back);
    // After choosing an event from Julie's screen, stay on that event's screen
    if (action === 'use' && r.flash === 'tablet' && to.startsWith('/admin/checkin/tablets')) to = '/admin/checkin/tablets';
    if (action === 'live' && r.flash === 'confirm') return redirect(`/admin/checkin/tablets/${t.id}/live?back=${encodeURIComponent(to)}`);
    return redirect(r.flash ? withParam(to, 'ipad', r.flash) : to);
  }
  if (tm[2] === 'code') {
    const code = await sc.issuePairCode(env, t.id);
    await data.audit(env, 'selfcheckin.code', `Setup code shown for iPad "${t.name}" by ${by}`).run();
    return page(view.tabletCodePage({ tablet: t, code, origin, csrf: csrf.token }));
  }
  if (tm[2] === 'rename') {
    const name = String(form.fields.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (name) await env.DB.prepare('UPDATE checkin_tablets SET name = ?1 WHERE id = ?2').bind(name, t.id).run();
    return redirect('/admin/checkin/tablets?flash=renamed');
  }
  if (tm[2] === 'live') return redirect('/admin/checkin/tablets');
  // Remove: for a lost or replaced iPad. Its key stops working at once; it would need a new setup code.
  await env.DB.batch([env.DB.prepare(`UPDATE checkin_tablets SET revoked_at = ?1, token_hash = NULL, pair_code_hash = NULL, state = 'disconnected' WHERE id = ?2`).bind(nowIso(), t.id),
    data.audit(env, 'selfcheckin.remove', `iPad "${t.name}" removed by ${by}`)]);
  return redirect('/admin/checkin/tablets?flash=removed');
}

// ---------- helpers (owner only) ----------
export async function handleHelpers({ env, url, method, path, form, page, csrf }) {
  if (path === '/admin/helpers') {
    const list = async () => (await env.DB.prepare('SELECT * FROM checkin_helpers ORDER BY active DESC, name COLLATE NOCASE').all()).results || [];
    if (method === 'GET') return page(view.helpersPage({ helpers: await list(), csrf: csrf.token, flash: url.searchParams.get('flash') }));
    const values = { name: String(form.fields.name || '').trim().slice(0, 80), email: normaliseEmail(form.fields.email) };
    const errors = {};
    if (!values.name) errors.name = 'Please enter their name.';
    if (!EMAIL_RE.test(values.email)) errors.email = 'Please enter their full email address.';
    else if (values.email === normaliseEmail(env.OWNER_EMAIL)) errors.email = 'That is your own (owner) address.';
    else if (await env.DB.prepare('SELECT 1 FROM checkin_helpers WHERE email = ?1').bind(values.email).first()) errors.email = 'That person is already a helper.';
    if (Object.keys(errors).length) return page(view.helpersPage({ helpers: await list(), csrf: csrf.token, errors, values }), 422);
    await env.DB.batch([env.DB.prepare('INSERT INTO checkin_helpers (email, name) VALUES (?1, ?2)').bind(values.email, values.name),
      data.audit(env, 'helpers.add', `Check-in helper added: ${values.name}`)]);
    return redirect('/admin/helpers?flash=added');
  }
  const hm = path.match(/^\/admin\/helpers\/(\d{1,9})\/(off|on|remove)$/);
  if (!hm) return null;
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  const id = Number(hm[1]);
  const signOut = env.DB.prepare(`DELETE FROM admin_sessions WHERE role = 'helper' AND helper_id = ?1`).bind(id);
  if (hm[2] === 'off') await env.DB.batch([env.DB.prepare('UPDATE checkin_helpers SET active = 0 WHERE id = ?1').bind(id), signOut, data.audit(env, 'helpers.off', `Check-in helper ${id} switched off`)]);
  if (hm[2] === 'on') await env.DB.prepare('UPDATE checkin_helpers SET active = 1 WHERE id = ?1').bind(id).run();
  if (hm[2] === 'remove') await env.DB.batch([env.DB.prepare('DELETE FROM checkin_helpers WHERE id = ?1').bind(id), signOut, data.audit(env, 'helpers.remove', `Check-in helper ${id} removed`)]);
  return redirect('/admin/helpers?flash=' + (hm[2] === 'remove' ? 'removed' : hm[2]));
}
