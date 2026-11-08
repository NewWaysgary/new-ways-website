// iPad self check-in: the iPad's own page and its small set of requests (all under /self-checkin).
// Only an iPad set up from Admin can use them. The iPad only ever receives guest NAMES (for a scanned booking, or the
// one guest whose full name was typed) and whether they have arrived: never an email address, phone number, payment,
// amount, reference or any other customer detail. It can't list or search the guest list.
// Admin decides the event, TEST or LIVE, and whether check-in is open, paused or closed; every request checks this.
import { htmlResponse, textResponse, redirect, ASSET_VERSION, readForm } from '../lib/http.js';
import { allow } from '../lib/ratelimit.js';
import { eventWhen } from '../events/model.js';
import { buildPack, packStamp, recordCheckin, syncOffline, notePending } from './offline.js';
import * as s from './model.js';
import * as view from '../views/self-checkin.js';

const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '').toLowerCase();
function json(obj, status = 200, setCookie = null) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(JSON.stringify(obj), { status, headers });
}

// Requests that change anything must come from this website's own page, as JSON (another website can't send these)
function sameSite(request) {
  const origin = request.headers.get('Origin');
  return !!origin && origin === new URL(request.url).origin;
}
async function readJson(request, max = 4000) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) return null;
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > max) return null;
  try { const t = await request.text(); return t.length > max ? null : JSON.parse(t); } catch { return null; }
}

export async function handleSelfCheckin(request, env, url, method, path) {
  if (path === '/self-checkin') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const t = await s.tabletFor(request, env);
    if (!t) return htmlResponse(view.pairPage({ code: s.cleanPairCode(url.searchParams.get('code')) }), { status: 200 });
    // X-NW-Kiosk: the iPad's helper keeps a copy of this page (the same for every iPad: no names, no key), so the
    // check-in screens still open if Safari is reopened while the connection is down
    return htmlResponse(view.kioskPage({ version: ASSET_VERSION }), { headers: { 'X-NW-Kiosk': '1' } });
  }

  if (path === '/self-checkin/connect') {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    if (!sameSite(request)) return textResponse('Not allowed.', { status: 403 });
    if (!(await allow(env, request, 'tablet-pair', 10, 600))) return htmlResponse(view.pairPage({ problem: 'Too many tries. Please wait ten minutes, then try again.' }), { status: 429 });
    const form = await readForm(request, 2000);
    const result = await s.pairTablet(request, env, s.cleanPairCode(form.code));
    if (!result) return htmlResponse(view.pairPage({ problem: 'That code didn’t work. Codes can only be used once and stop working after 15 minutes. Ask for a new code in Admin › Check in › iPad self check-in.' }), { status: 422 });
    return redirect('/self-checkin', 303, { 'Set-Cookie': result.setCookie });
  }

  const api = path.match(/^\/self-checkin\/api\/(state|scan|find|checkin|pack|sync)$/);
  if (!api) return null;
  const t = await s.tabletFor(request, env);
  if (!t) return json({ result: 'not_set_up' }, 401);
  await s.touchTablet(env, t);
  const session = await s.tabletSession(env, t);
  const { event, mode } = session;
  const test = mode === 'test';

  const packable = !!event && (session.state === 'active' || session.state === 'paused');

  if (api[1] === 'state') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    await notePending(env, t, request.headers.get('X-NW-Pending'));
    return json({
      version: ASSET_VERSION, state: session.state, mode, open: session.state === 'active',
      event: event ? { id: event.id, name: event.name, when: eventWhen(event) } : null,
      packStamp: packable ? await packStamp(env, event.id, test) : null,
      staffNote: session.state === 'no_event' ? 'No event has been chosen for this iPad. Choose one in Admin › Check in › iPad self check-in.' : ''
    }, 200, await s.renewKey(request, env, t));
  }

  // The event pack, for checking guests in if the connection drops (only while check-in is open or paused)
  if (api[1] === 'pack') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    if (!packable) return json({ result: 'closed' });
    return json({ result: 'pack', pack: { ...(await buildPack(env, t, event, mode)), event: { id: event.id, name: event.name, when: eventWhen(event) } } });
  }

  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  if (!sameSite(request)) return json({ result: 'error' }, 403);

  // Offline check-ins arriving once the connection is back: accepted whatever Admin has set since (paused, closed),
  // because they were made while check-in was open. Each is checked again here; see offline.js.
  if (api[1] === 'sync') {
    const body = await readJson(request, 120_000);
    if (!body || typeof body !== 'object') return json({ result: 'error' }, 400);
    return json(await syncOffline(env, t, body));
  }
  if (!(await allow(env, request, 'tablet-' + t.id, 90, 60))) return json({ result: 'busy' }, 429);
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return json({ result: 'error' }, 400);
  // Paused or closed in Admin: nothing can be looked up or checked in
  if (session.state !== 'active') return json({ result: session.state === 'paused' ? 'paused' : 'closed', mode });
  const help = (kind, extra = {}) => s.logHelp(env, { tabletId: t.id, eventId: event.id, test, kind, ...extra });
  const reply = (obj) => json({ ...obj, mode });

  // ---------- a scanned QR code ----------
  if (api[1] === 'scan' || (api[1] === 'checkin' && body.code !== undefined)) {
    const token = s.tokenFromScan(body.code);
    if (!token) return reply({ result: 'unknown' });
    const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE checkin_token = ?1').bind(token).first();
    if (!b) {
      await help('unknown_qr');
      return reply({ result: 'unknown' });
    }
    if (b.event_id !== event.id) {
      await help('other_event', { bookingId: b.id });
      return reply({ result: 'other_event' });
    }
    if (!s.selfCheckinAllowed(b)) {
      await help('booking', { bookingId: b.id });
      return reply({ result: 'see_julie' });
    }
    if (api[1] === 'checkin') {
      const wanted = new Set((Array.isArray(body.guests) ? body.guests : []).slice(0, 40).map(Number).filter(Number.isInteger));
      const party = (await env.DB.prepare('SELECT id, name FROM event_guests WHERE booking_id = ?1 ORDER BY position').bind(b.id).all()).results || [];
      const chosen = party.filter((g) => wanted.has(g.id));
      if (!chosen.length) return json({ result: 'error' }, 400);
      const done = [];
      const cids = body.cids && typeof body.cids === 'object' ? body.cids : {};
      for (const g of chosen) {
        const cid = /^[A-Za-z0-9_-]{16,64}$/.test(String(cids[g.id] || '')) ? String(cids[g.id]) : null;
        const r = await recordCheckin(env, { tablet: t, eventId: event.id, test, guestId: g.id, cid });
        done.push({ id: g.id, name: g.name, result: r.result === 'in' ? 'in' : r.result === 'already' ? 'already' : 'error', at: r.already ? clock(r.already.checked_in_at) : '' });
      }
      return reply({ result: 'done', guests: done });
    }
    const a = test ? 'ta.checked_in_at' : 'g.checked_in_at';
    const { results } = await env.DB.prepare(`SELECT g.id, g.name, ${a} AS checked_in_at FROM event_guests g ${test ? 'LEFT JOIN checkin_test_attendance ta ON ta.guest_id = g.id' : ''}
      WHERE g.booking_id = ?1 ORDER BY g.position`).bind(b.id).all();
    return reply({ result: 'booking', guests: (results || []).map((g) => ({ id: g.id, name: g.name, in: !!g.checked_in_at, at: g.checked_in_at ? clock(g.checked_in_at) : '' })) });
  }

  // ---------- a typed full name ----------
  const typed = String(body.name || '').slice(0, 100);
  const { key, matches } = await s.guestsNamed(env, event.id, typed);
  if (!key.includes(' ')) return reply({ result: 'full_name' });
  if (matches.length > 1) {
    if (api[1] === 'find') await help('same_name', { typedName: typed });
    return reply({ result: 'same_name' });
  }
  if (!matches.length) {
    if (api[1] === 'find') await help('not_found', { typedName: typed });
    return reply({ result: 'not_found' });
  }
  const g = matches[0];
  const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1').bind(g.booking_id).first();
  if (!s.selfCheckinAllowed(b)) {
    if (api[1] === 'find') await help('booking', { typedName: typed, bookingId: b.id });
    return reply({ result: 'see_julie' });
  }
  if (api[1] === 'find') {
    const at = (await env.DB.prepare(test ? 'SELECT checked_in_at FROM checkin_test_attendance WHERE guest_id = ?1' : 'SELECT checked_in_at FROM event_guests WHERE id = ?1').bind(g.id).first() || {}).checked_in_at;
    return reply({ result: 'one', guest: { id: g.id, name: g.name, in: !!at, at: at ? clock(at) : '' } });
  }
  const cid = /^[A-Za-z0-9_-]{16,64}$/.test(String((body.cids || {})[g.id] || '')) ? String(body.cids[g.id]) : null;
  const rec = await recordCheckin(env, { tablet: t, eventId: event.id, test, guestId: g.id, cid });
  const r = { ok: rec.result === 'in', already: rec.already || (rec.result === 'already' ? { checked_in_at: null } : null) };
  if (r.ok) {
    // They found themselves after a spelling mistake: the "name not found" note from a moment ago is no longer needed
    await env.DB.prepare(`UPDATE checkin_help SET resolved_at = ?1, resolved_by = 'Found on the iPad' WHERE tablet_id = ?2 AND event_id = ?3 AND test = ?4 AND kind = 'not_found'
      AND resolved_at IS NULL AND created_at > ?5`).bind(new Date().toISOString(), t.id, event.id, test ? 1 : 0, new Date(Date.now() - 5 * 60_000).toISOString()).run();
  }
  return reply({ result: 'done', guests: [{ id: g.id, name: g.name, result: r.ok ? 'in' : r.already ? 'already' : 'error', at: r.already && r.already.checked_in_at ? clock(r.already.checked_in_at) : '' }] });
}
