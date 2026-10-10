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

const nowIso = () => new Date().toISOString();
const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '').toLowerCase();

async function eventsForCheckin(env) {
  const from = new Date(Date.parse(ukToday() + 'T12:00:00Z') - 2 * 86400_000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`SELECT e.*,
      (SELECT COUNT(*) FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id WHERE g.event_id = e.id AND b.status = 'confirmed') AS booked,
      (SELECT COUNT(*) FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id WHERE g.event_id = e.id AND b.status = 'confirmed' AND g.checked_in_at IS NOT NULL) AS arrived
    FROM events e WHERE e.date >= ?1 AND (e.sales_mode = 'online' OR EXISTS (SELECT 1 FROM event_bookings b WHERE b.event_id = e.id))
    ORDER BY e.date, e.start_time, e.id LIMIT 40`).bind(from).all();
  return results || [];
}

// Guests for the door list (names and what's needed at the door only: no contact details, no payments beyond "to pay")
async function doorGuests(env, eventId, q, current) {
  const where = [`g.event_id = ?1`, `b.status = 'confirmed'`];
  const binds = [eventId];
  if (current === 'arrived') where.push('g.checked_in_at IS NOT NULL');
  if (current === 'waiting') where.push('g.checked_in_at IS NULL');
  const text = String(q || '').trim().toLowerCase().slice(0, 80);
  if (text) {
    binds.push('%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
    where.push(`(lower(g.name) LIKE ?${binds.length} ESCAPE '\\' OR lower(b.purchaser_name) LIKE ?${binds.length} ESCAPE '\\' OR lower(b.reference) LIKE ?${binds.length} ESCAPE '\\')`);
  }
  const { results } = await env.DB.prepare(`SELECT g.id, g.booking_id, g.name, g.position, g.checked_in_at, g.checked_in_by, b.reference, b.purchaser_name, b.quantity,
      b.payment_status, b.total_pence FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id
    WHERE ${where.join(' AND ')} ORDER BY g.name COLLATE NOCASE, g.id LIMIT 500`).bind(...binds).all();
  return results || [];
}

async function partyGuests(env, b) {
  const { results } = await env.DB.prepare(`SELECT g.*, ?2 AS reference, ?3 AS purchaser_name, ?4 AS quantity, ?5 AS payment_status, ?6 AS total_pence
    FROM event_guests g WHERE g.booking_id = ?1 ORDER BY g.position`).bind(b.id, b.reference, b.purchaser_name, 1, b.payment_status, b.total_pence).all();
  return results || [];
}

// The one place a guest is checked in. Returns { ok } or { already: guest }.
export async function checkInGuest(env, eventId, guestId, by) {
  const r = await env.DB.prepare(`UPDATE event_guests SET checked_in_at = ?1, checked_in_by = ?2
    WHERE id = ?3 AND event_id = ?4 AND checked_in_at IS NULL AND EXISTS (SELECT 1 FROM event_bookings b WHERE b.id = event_guests.booking_id AND b.status = 'confirmed')`)
    .bind(nowIso(), String(by || '').slice(0, 80), guestId, eventId).run();
  if (r.meta.changes) return { ok: true };
  const g = await env.DB.prepare('SELECT * FROM event_guests WHERE id = ?1 AND event_id = ?2').bind(guestId, eventId).first();
  return g && g.checked_in_at ? { already: g } : { invalid: true };
}

const backPath = (eventId, raw) => (typeof raw === 'string' && raw.startsWith(`/admin/checkin/${eventId}`) && !/[\r\n]/.test(raw) ? raw : `/admin/checkin/${eventId}`);
const withParam = (p, k, v) => p + (p.includes('?') ? '&' : '?') + k + '=' + encodeURIComponent(v);

function flashFrom(url, guests) {
  const g = (id) => guests.find((x) => String(x.id) === String(id));
  if (url.searchParams.get('in')) { const x = g(url.searchParams.get('in')); return x ? { kind: 'is-good', text: `CHECKED IN: ${x.name}` } : null; }
  if (url.searchParams.get('many')) return { kind: 'is-good', text: `CHECKED IN: ${url.searchParams.get('many')} guests` };
  if (url.searchParams.get('already')) {
    const at = url.searchParams.get('at');
    return { kind: 'is-done', text: `ALREADY CHECKED IN${url.searchParams.get('name') ? ': ' + url.searchParams.get('name') : ''}${at ? ' at ' + clock(at) : ''}${url.searchParams.get('by') ? ' (' + url.searchParams.get('by') + ')' : ''}` };
  }
  if (url.searchParams.get('undone')) return { kind: 'is-done', text: 'Check-in undone.' };
  return null;
}

export async function handleCheckin({ env, url, method, path, form, page, csrf, admin }) {
  const helper = admin.role === 'helper' ? admin.name : '';
  const by = admin.role === 'owner' ? 'Gary' : admin.name;

  if (path === '/admin/checkin') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return page(view.eventsPage({ events: await eventsForCheckin(env), csrf: csrf.token, helper }));
  }

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

  if (!rest) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const current = ['all', 'arrived', 'waiting'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'all';
    const q = String(url.searchParams.get('q') || '').slice(0, 80);
    const [totals, guests] = await Promise.all([m.checkinCounts(env, event.id), doorGuests(env, event.id, q, current)]);
    const all = url.searchParams.get('in') ? await doorGuests(env, event.id, '', 'all') : guests;
    return page(view.doorPage({ event, totals, guests, q, current, csrf: csrf.token, helper, flash: flashFrom(url, all) }));
  }

  if (rest === 'totals') {
    const t = await m.checkinCounts(env, event.id);
    return new Response(JSON.stringify(t), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  // A scanned QR code (from the SCAN QR CODE button)
  const tm = rest.match(/^t\/([A-Za-z0-9_-]{0,64})$/);
  if (tm) {
    const b = m.isCheckinToken(tm[1]) ? await env.DB.prepare('SELECT * FROM event_bookings WHERE checkin_token = ?1').bind(tm[1]).first() : null;
    if (!b) return page(view.notFoundPage({ csrf: csrf.token, helper, eventId: event.id }), 404);
    if (b.event_id !== event.id) return page(view.otherEventPage({ event, other: await m.getEvent(env, b.event_id), b, csrf: csrf.token, helper }), 409);
    return redirect(`/admin/checkin/${event.id}/booking/${b.id}?scanned=1`);
  }

  const bm = rest.match(/^booking\/(\d{1,9})(\/all)?$/);
  if (bm) {
    const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1 AND event_id = ?2').bind(Number(bm[1]), event.id).first();
    if (!b) return null;
    if (bm[2]) {
      if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
      let n = 0;
      for (const g of await partyGuests(env, b)) if (!g.checked_in_at && (await checkInGuest(env, event.id, g.id, by)).ok) n++;
      return redirect(`/admin/checkin/${event.id}/booking/${b.id}${n ? '?many=' + n : '?already=1'}`);
    }
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const guests = await partyGuests(env, b);
    return page(view.partyPage({ event, b, guests, csrf: csrf.token, helper, flash: flashFrom(url, guests), scanned: url.searchParams.has('scanned') }));
  }

  const gm = rest.match(/^guest\/(\d{1,9})(\/undo)?$/);
  if (gm) {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const back = backPath(event.id, form.fields.back);
    if (gm[2]) {
      await env.DB.batch([
        env.DB.prepare('UPDATE event_guests SET checked_in_at = NULL, checked_in_by = \'\' WHERE id = ?1 AND event_id = ?2').bind(Number(gm[1]), event.id),
        data.audit(env, 'checkin.undo', `Check-in undone for guest ${gm[1]} (${event.name}) by ${by}`)
      ]);
      return redirect(withParam(back, 'undone', '1'));
    }
    const result = await checkInGuest(env, event.id, Number(gm[1]), by);
    if (result.ok) return redirect(withParam(back, 'in', gm[1]));
    if (result.already) {
      return redirect(withParam(withParam(withParam(withParam(back, 'already', '1'), 'name', result.already.name), 'at', result.already.checked_in_at), 'by', result.already.checked_in_by || ''));
    }
    return redirect(back);
  }
  return null;
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
