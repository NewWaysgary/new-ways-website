// iPad self check-in: working through a dropped connection (the iPad uses Julie's phone hotspot).
//
// THE EVENT PACK: while check-in is open, the iPad keeps a copy of what it needs to check guests in on its own:
// each guest's id, name (and the name in the form used for matching), which booking they are on, and whether they
// have arrived; and for each booking only a SCRAMBLED form (SHA-256) of its QR code, plus whether guests may check in
// themselves. No email, phone, payment, amount or reference. It comes with a TICKET signed by the website, saying which
// iPad, which event and TEST or LIVE, and until when (12 hours). The iPad keeps the pack encrypted.
//
// OFFLINE CHECK-INS: made on the iPad from the pack, saved on the iPad (encrypted) before the guest is told, each with
// its own random number, and sent here as soon as the connection returns. Here, each one is checked again from scratch
// (the ticket's signature, the iPad, the event, the guest, the booking) and recorded once, with the time the guest
// actually arrived. Sending the same one twice does nothing more. TEST check-ins go only to the test records, because
// TEST or LIVE comes from the signed ticket, not from the iPad.
import { checkIn } from './attendance.js';
import { nameKey } from './names.js';
import { sha256Hex } from '../lib/auth.js';
import { selfCheckinAllowed, TABLET_BY } from './model.js';

export const OFFLINE_BY = 'iPad self check-in (offline)';
export const TICKET_HOURS = 12;            // offline check-ins can be made for 12 hours after the pack was downloaded
export const SYNC_ACCEPT_DAYS = 7;         // ...and are accepted here for 7 days (so a late connection loses nothing)
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('nw-checkin-ticket|' + String(env.SESSION_SECRET || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

export async function makeTicket(env, t, eventId, mode, now = Date.now()) {
  const body = [t.id, eventId, mode === 'live' ? 'live' : 'test', now, now + TICKET_HOURS * 3600_000].join('.');
  return body + '.' + await hmac(env, body);
}

// { tabletId, eventId, mode, issued, expires } for a genuine ticket, otherwise null
export async function readTicket(env, ticket) {
  const parts = String(ticket || '').split('.');
  if (parts.length !== 6) return null;
  const body = parts.slice(0, 5).join('.');
  const sig = await hmac(env, body);
  if (sig.length !== parts[5].length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ parts[5].charCodeAt(i);
  if (diff) return null;
  const [tabletId, eventId, mode, issued, expires] = parts.slice(0, 5);
  if (!['test', 'live'].includes(mode)) return null;
  return { tabletId: Number(tabletId), eventId: Number(eventId), mode, issued: Number(issued), expires: Number(expires) };
}

// A short "version" of the pack: it changes whenever a guest, a booking or an arrival for this event changes
export async function packStamp(env, eventId, test) {
  const at = test ? 'ta.checked_in_at' : 'g.checked_in_at';
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(g.id), 0) AS ids, COUNT(${at}) AS arrived, COALESCE(SUM(CASE WHEN ${at} IS NOT NULL THEN g.id END), 0) AS who,
      COALESCE(SUM(length(g.name)), 0) AS names,
      (SELECT COALESCE(SUM(id * (CASE status WHEN 'confirmed' THEN 3 ELSE 1 END) * (CASE payment_status WHEN 'unpaid' THEN 7 ELSE 1 END)), 0) FROM event_bookings WHERE event_id = ?1) AS bk
    FROM event_guests g ${test ? 'LEFT JOIN checkin_test_attendance ta ON ta.guest_id = g.id' : ''} WHERE g.event_id = ?1`).bind(eventId).first();
  return [row.n, row.ids, row.arrived, row.who, row.names, row.bk].join('-');
}

export async function buildPack(env, t, event, mode) {
  const test = mode === 'test';
  const at = test ? 'ta.checked_in_at' : 'g.checked_in_at';
  const [bk, gs] = await env.DB.batch([
    env.DB.prepare('SELECT id, checkin_token, status, payment_status, personal_data_removed_at FROM event_bookings WHERE event_id = ?1').bind(event.id),
    env.DB.prepare(`SELECT g.id, g.booking_id, g.name, ${at} AS checked_in_at FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id
      ${test ? 'LEFT JOIN checkin_test_attendance ta ON ta.guest_id = g.id' : ''} WHERE g.event_id = ?1 AND b.status = 'confirmed' ORDER BY g.booking_id, g.position`).bind(event.id)
  ]);
  const bookings = [];
  for (const b of bk.results || []) bookings.push([b.id, await sha256Hex(b.checkin_token), selfCheckinAllowed(b) ? 1 : 0]);
  const guests = (gs.results || []).map((g) => [g.id, g.booking_id, g.name, nameKey(g.name), g.checked_in_at ? 1 : 0]);
  return { ticket: await makeTicket(env, t, event.id, mode), eventId: event.id, mode, stamp: await packStamp(env, event.id, test), expires: Date.now() + TICKET_HOURS * 3600_000, bookings, guests };
}

// One check-in sent by the iPad (cid: its own random number). Returns 'in', 'already' or 'rejected'.
// Also used for ONLINE check-ins, so a check-in whose answer was lost in a dropped connection, and then saved on the
// iPad and sent again, is recognised as the same one (and is not reported as a duplicate).
export async function recordCheckin(env, { tablet, eventId, test, guestId, cid, at = null, offline = false }) {
  if (cid) {
    const seen = await env.DB.prepare('SELECT result FROM checkin_sync_log WHERE client_id = ?1 AND tablet_id = ?2').bind(cid, tablet.id).first();
    if (seen) return { result: seen.result, repeat: true };
  }
  const g = await env.DB.prepare('SELECT g.id, g.name, g.booking_id, g.event_id FROM event_guests g WHERE g.id = ?1').bind(guestId).first();
  const b = g ? await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1').bind(g.booking_id).first() : null;
  let result, r = null;
  if (!g || g.event_id !== eventId || !selfCheckinAllowed(b)) result = 'rejected';
  else {
    r = await checkIn(env, eventId, guestId, offline ? OFFLINE_BY : TABLET_BY, test, at);
    result = r.ok ? 'in' : r.already ? 'already' : 'rejected';
  }
  if (cid) {
    const ins = await env.DB.prepare(`INSERT INTO checkin_sync_log (client_id, tablet_id, event_id, test, guest_id, offline, result, client_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT (client_id) DO NOTHING`).bind(cid, tablet.id, eventId, test ? 1 : 0, guestId, offline ? 1 : 0, result, at).run();
    if (!ins.meta.changes) {
      const seen = await env.DB.prepare('SELECT result FROM checkin_sync_log WHERE client_id = ?1').bind(cid).first();
      return { result: seen ? seen.result : result, repeat: true };
    }
  }
  // Offline only: tell Julie about anything that needs her eye
  if (offline && result !== 'in') {
    await env.DB.prepare('INSERT INTO checkin_help (tablet_id, event_id, test, kind, booking_id, guest_id, typed_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(tablet.id, eventId, test ? 1 : 0, result === 'already' ? 'offline_duplicate' : 'offline_problem', b ? b.id : null, g ? g.id : guestId, g ? g.name : '').run();
  }
  return { result, already: r && r.already ? r.already : null, name: g ? g.name : '' };
}

const CID = /^[A-Za-z0-9_-]{16,64}$/;

// The iPad sends what it saved while offline: { ticket, items: [{ cid, gid, at }], help: [{ cid, kind, typed }] }
export async function syncOffline(env, tablet, body) {
  const tk = await readTicket(env, body.ticket);
  const now = Date.now();
  // Any iPad set up in Admin may hand in a genuine ticket (so check-ins saved on an iPad that was then set up again
  // with a new code are not lost). The ticket itself, signed by this website, decides the event and TEST or LIVE.
  if (!tk || tk.issued > now + 300_000 || now - tk.issued > SYNC_ACCEPT_DAYS * 86400_000) return { ok: false, reason: 'ticket' };
  const test = tk.mode === 'test';
  const results = [];
  for (const item of (Array.isArray(body.items) ? body.items : []).slice(0, 200)) {
    if (!item || !CID.test(String(item.cid || '')) || !Number.isInteger(item.gid)) { results.push({ cid: item && item.cid, result: 'rejected' }); continue; }
    // The time the guest checked in, as the iPad recorded it: only within the ticket's 12 hours (never in the future)
    const t = Date.parse(item.at);
    const at = Number.isFinite(t) && t >= tk.issued - 300_000 && t <= Math.min(tk.expires, now + 60_000) ? new Date(Math.min(t, now)).toISOString() : null;
    if (!at) { results.push({ cid: item.cid, result: 'rejected' }); continue; }
    const r = await recordCheckin(env, { tablet, eventId: tk.eventId, test, guestId: item.gid, cid: item.cid, at, offline: true });
    results.push({ cid: item.cid, result: r.result });
  }
  // Notes for Julie made while offline (a name not found, two guests with the same name...)
  for (const h of (Array.isArray(body.help) ? body.help : []).slice(0, 100)) {
    if (!h || !CID.test(String(h.cid || '')) || !['same_name', 'not_found', 'booking', 'unknown_qr'].includes(h.kind)) continue;
    const dup = await env.DB.prepare('INSERT INTO checkin_sync_log (client_id, tablet_id, event_id, test, guest_id, offline, result) VALUES (?1, ?2, ?3, ?4, 0, 1, ?5) ON CONFLICT (client_id) DO NOTHING')
      .bind(h.cid, tablet.id, tk.eventId, test ? 1 : 0, 'note').run();
    if (dup.meta.changes) {
      await env.DB.prepare('INSERT INTO checkin_help (tablet_id, event_id, test, kind, typed_name) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(tablet.id, tk.eventId, test ? 1 : 0, h.kind, String(h.typed || '').trim().slice(0, 80)).run();
    }
    results.push({ cid: h.cid, result: 'note' });
  }
  await env.DB.prepare('UPDATE checkin_tablets SET last_sync_at = ?1 WHERE id = ?2').bind(new Date().toISOString(), tablet.id).run();
  return { ok: true, results };
}

// How the iPad is showing the screens: 'app' (the full-screen Home Screen app) or 'browser' (an ordinary Safari tab)
export async function noteDisplay(env, tablet, header) {
  const mode = header === 'app' || header === 'browser' ? header : '';
  if (!mode || mode === tablet.display_mode) return;
  await env.DB.prepare('UPDATE checkin_tablets SET display_mode = ?1 WHERE id = ?2').bind(mode, tablet.id).run();
}

// The iPad says how many offline check-ins it is still holding (shown to Julie)
export async function notePending(env, tablet, header) {
  const m = String(header || '').match(/^(\d{1,4})(?:\|(\d{4}-\d{2}-\d{2}T[\d:.]+Z))?$/);
  if (!m) return;
  const n = Number(m[1]);
  const since = n ? m[2] || null : null;
  if (n === Number(tablet.pending_count) && (since || null) === (tablet.pending_since || null)) return;
  await env.DB.prepare('UPDATE checkin_tablets SET pending_count = ?1, pending_since = ?2 WHERE id = ?3').bind(n, since, tablet.id).run();
}

export async function removeOldSyncLog(env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM checkin_sync_log WHERE recorded_at < ?1').bind(new Date(now - 14 * 86400_000).toISOString()).run();
}
