// iPad self check-in: the shared rules, used by the iPad's own pages and by the Admin screens (Gary and Julie).
import { sha256Hex } from '../lib/auth.js';
import { randomToken, parseCookies, cookie } from '../lib/http.js';
import { nameKey } from './names.js';

export const TABLET_COOKIE = 'nw_tablet';
export const TABLET_BY = 'iPad self check-in';
export const PAIR_MINUTES = 15;
export const TABLET_DAYS = 60;   // the iPad's key lasts 60 days, renewed each day it is used: an iPad left unused for 60 days needs a new setup code
export const ONLINE_SECONDS = 90;   // the iPad checks in every few seconds; "connected" = heard from in the last 90 seconds

export const HELP_LABEL = {
  same_name: 'Two or more guests have this name',
  not_found: 'Name not found on the guest list',
  booking: 'Booking needs you (not paid or not valid)',
  other_event: 'Ticket for a different event',
  unknown_qr: 'QR code not recognised',
  offline_duplicate: 'Offline check-in: this guest was already checked in (counted once)',
  offline_problem: 'Offline check-in NOT accepted (booking no longer valid, or for another event)'
};
export const STATE_LABEL = { active: 'Open', paused: 'Paused', closed: 'Closed', disconnected: 'Disconnected' };

const nowIso = () => new Date().toISOString();
const isHttps = (request) => new URL(request.url).protocol === 'https:';

// ---------- setting up an iPad (once) ----------
// The one-time setup code: 8 digits (shown as 1234 5678), valid for 15 minutes, used once.
export function newPairCode() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return String(a[0] % 10000).padStart(4, '0') + String(a[1] % 10000).padStart(4, '0');
}
export const cleanPairCode = (raw) => String(raw || '').replace(/\D/g, '').slice(0, 8);

export async function issuePairCode(env, tabletId) {
  const code = newPairCode();
  await env.DB.prepare('UPDATE checkin_tablets SET pair_code_hash = ?1, pair_expires_at = ?2 WHERE id = ?3 AND revoked_at IS NULL')
    .bind(await sha256Hex('pair|' + code), new Date(Date.now() + PAIR_MINUTES * 60_000).toISOString(), tabletId).run();
  return code;
}

const keyCookie = (request, key) => cookie(TABLET_COOKIE, key, { path: '/self-checkin', maxAge: TABLET_DAYS * 86400, secure: isHttps(request), sameSite: 'Lax' });

// Returns the Set-Cookie value for the iPad, or null if the code is wrong or has expired.
// Using the code replaces any earlier key, so an old copy of the key stops working.
export async function pairTablet(request, env, code) {
  if (!/^\d{8}$/.test(code)) return null;
  const hash = await sha256Hex('pair|' + code);
  const t = await env.DB.prepare('SELECT * FROM checkin_tablets WHERE pair_code_hash = ?1 AND revoked_at IS NULL').bind(hash).first();
  if (!t || !t.pair_expires_at || Date.parse(t.pair_expires_at) <= Date.now()) return null;
  const key = randomToken(32);
  const r = await env.DB.prepare(`UPDATE checkin_tablets SET token_hash = ?1, pair_code_hash = NULL, pair_expires_at = NULL, paired_at = ?2, key_renewed_at = ?2, last_seen_at = ?2
    WHERE id = ?3 AND pair_code_hash = ?4`).bind(await sha256Hex('tablet|' + key), nowIso(), t.id, hash).run();
  if (!r.meta.changes) return null;
  return { tablet: t, setCookie: keyCookie(request, key) };
}

export async function tabletFor(request, env) {
  const key = parseCookies(request)[TABLET_COOKIE];
  if (!key || key.length < 40 || key.length > 64) return null;
  const t = await env.DB.prepare('SELECT * FROM checkin_tablets WHERE token_hash = ?1 AND revoked_at IS NULL').bind(await sha256Hex('tablet|' + key)).first();
  if (!t) return null;
  // Not used for 60 days: the key has expired, here as well as in the iPad's browser
  if (t.key_renewed_at && Date.now() - Date.parse(t.key_renewed_at) > TABLET_DAYS * 86400_000) return null;
  return t;
}

// While the iPad is in use its key is renewed once a day (the same key, kept for another 60 days), so a restarted iPad
// or a reopened Safari carries straight on, without a new setup code. Removing the iPad in Admin stops it at once.
export async function renewKey(request, env, t) {
  if (t.key_renewed_at && Date.now() - Date.parse(t.key_renewed_at) < 20 * 3600_000) return null;
  const key = parseCookies(request)[TABLET_COOKIE];
  await env.DB.prepare('UPDATE checkin_tablets SET key_renewed_at = ?1 WHERE id = ?2').bind(nowIso(), t.id).run();
  return keyCookie(request, key);
}

// "Last seen" is written at most every 30 seconds, so an iPad left on all evening uses few database writes
export async function touchTablet(env, t) {
  if (t.last_seen_at && Date.now() - Date.parse(t.last_seen_at) < 30_000) return;
  await env.DB.prepare('UPDATE checkin_tablets SET last_seen_at = ?1 WHERE id = ?2').bind(nowIso(), t.id).run();
}

export const tabletOnline = (t, now = Date.now()) => !!(t && t.token_hash && t.last_seen_at && now - Date.parse(t.last_seen_at) < ONLINE_SECONDS * 1000);

// What the iPad should do now: { state, mode, event }. state is 'active', 'paused', 'closed', 'disconnected' or
// 'no_event'. Any event can be chosen, on any date (Test Mode for trying it out at any time; Live for the real night).
export async function tabletSession(env, t) {
  const mode = t.mode === 'live' ? 'live' : 'test';
  if (!t.event_id) return { state: 'no_event', mode, event: null };
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?1').bind(t.event_id).first();
  if (!event) return { state: 'no_event', mode, event: null };
  return { state: t.state, mode, event };
}

// ---------- looking up guests ----------
// A booking guests may check themselves in for: confirmed, and nothing left to pay at the door
export const selfCheckinAllowed = (b) => !!b && b.status === 'confirmed' && b.payment_status !== 'unpaid' && !b.personal_data_removed_at;

export function tokenFromScan(text) {
  const s = String(text || '').trim().slice(0, 300);
  const m = s.match(/\/c\/([A-Za-z0-9_-]{22})(?:[?#/]|$)/) || s.match(/^([A-Za-z0-9_-]{22})$/);
  return m ? m[1] : null;
}

// Every guest on a confirmed booking for this event whose name is exactly the typed name (as nameKey compares them)
export async function guestsNamed(env, eventId, typed) {
  const key = nameKey(typed);
  if (key.length < 3 || !key.includes(' ')) return { key, matches: [] };
  const { results } = await env.DB.prepare(`SELECT g.id, g.name, g.booking_id FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id
    WHERE g.event_id = ?1 AND b.status = 'confirmed'`).bind(eventId).all();
  return { key, matches: (results || []).filter((g) => nameKey(g.name) === key) };
}

export async function logHelp(env, { tabletId, eventId, test, kind, typedName = '', bookingId = null }) {
  await env.DB.prepare('INSERT INTO checkin_help (tablet_id, event_id, test, kind, typed_name, booking_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(tabletId || null, eventId, test ? 1 : 0, kind, String(typedName || '').trim().slice(0, 80), bookingId).run();
}

// Help requests are kept for 14 days, then removed (they can hold a typed name)
export async function removeOldCheckinHelp(env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM checkin_help WHERE created_at < ?1').bind(new Date(now - 14 * 86400_000).toISOString()).run();
}
