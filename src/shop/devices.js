// Protecting meditation download links against being forwarded.
//
// The phone or computer used to BUY a meditation is remembered with a small security cookie (a random value; only a
// hash of it is stored, with the order). The download works there straight away. On any OTHER device, the customer
// asks for a 6-digit code, which is emailed ONLY to the address used to buy; entering it on that device lets it
// download too. A person the email was forwarded to doesn't receive the code, so the link is no use to them.
// Nothing uses the visitor's internet address, so a changing mobile connection never matters.
//
// Purchases made before this protection existed (orders.device_protected = 0) work exactly as before, and Gary can
// reissue a link that works on any device (download_entitlements.any_device = 1) for a customer who needs it.
import { parseCookies, cookie, randomToken } from '../lib/http.js';
import { sha256Hex } from '../orders.js';

export const DEVICE_COOKIE = 'nw_device';
const DEVICE_DAYS = 365;
export const CODE_MINUTES = 15;
export const CODE_TRIES = 5;
export const CODES_PER_DAY = 5;
export const DEVICES_PER_ORDER = 4;

const deviceHash = (token) => sha256Hex('device:' + token);
const isHttps = (request) => new URL(request.url).protocol === 'https:';

// This browser's device token, if it has one
export function deviceToken(request) {
  const t = parseCookies(request)[DEVICE_COOKIE];
  return t && /^[A-Za-z0-9_-]{30,60}$/.test(t) ? t : null;
}

// The token to use for this browser, and the Set-Cookie header if a new one had to be made
export function ensureDevice(request) {
  const existing = deviceToken(request);
  if (existing) return { token: existing, setCookie: null };
  const token = randomToken(32);
  return { token, setCookie: cookie(DEVICE_COOKIE, token, { path: '/', maxAge: DEVICE_DAYS * 86400, secure: isHttps(request), sameSite: 'Lax' }) };
}

export async function rememberDevice(env, orderId, token, how = 'purchase') {
  await env.DB.prepare('INSERT OR IGNORE INTO order_devices (order_id, device_hash, how) VALUES (?1, ?2, ?3)').bind(orderId, await deviceHash(token), how).run();
}

// May this browser use this download? (Checked every time, on the server.)
export async function deviceAllowed(request, env, ent) {
  if (!ent) return false;
  if (ent.any_device) return true;
  const order = await env.DB.prepare('SELECT device_protected FROM orders WHERE id = ?1').bind(ent.order_id).first();
  if (!order || !order.device_protected) return true;
  const token = deviceToken(request);
  if (!token) return false;
  return !!(await env.DB.prepare('SELECT 1 FROM order_devices WHERE order_id = ?1 AND device_hash = ?2').bind(ent.order_id, await deviceHash(token)).first());
}

export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return '';
  return (user.length <= 2 ? user[0] : user[0] + '•'.repeat(Math.min(6, user.length - 2)) + user[user.length - 1]) + '@' + domain;
}

const sixDigits = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, '0');
};

// Makes a new code for this device. Returns { code } or { refused: 'too-many' | 'too-many-devices' | 'no-email' }.
export async function newCode(env, order, token) {
  if (!order.customer_email || order.personal_data_removed_at) return { refused: 'no-email' };
  const devices = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_devices WHERE order_id = ?1').bind(order.id).first('n');
  if (devices >= DEVICES_PER_ORDER) return { refused: 'too-many-devices' };
  const since = new Date(Date.now() - 86400_000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM download_codes WHERE order_id = ?1 AND created_at > ?2').bind(order.id, since).first('n');
  if (recent >= CODES_PER_DAY) return { refused: 'too-many' };
  const code = sixDigits();
  const hash = await deviceHash(token);
  await env.DB.batch([
    // an earlier unused code for this device stops working
    env.DB.prepare(`UPDATE download_codes SET used_at = ?1 WHERE order_id = ?2 AND device_hash = ?3 AND used_at IS NULL`).bind(new Date().toISOString(), order.id, hash),
    env.DB.prepare('INSERT INTO download_codes (order_id, device_hash, code_hash, expires_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(order.id, hash, await sha256Hex(`code:${order.id}:${code}`), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString())
  ]);
  return { code };
}

// Checks a code typed on this device. Returns 'ok' | 'wrong' | 'expired' | 'none'.
export async function checkCode(env, order, token, typed) {
  const hash = await deviceHash(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT * FROM download_codes WHERE order_id = ?1 AND device_hash = ?2 AND used_at IS NULL ORDER BY id DESC LIMIT 1`)
    .bind(order.id, hash).first();
  if (!row) return 'none';
  if (row.expires_at < now || row.attempts >= CODE_TRIES) return 'expired';
  const clean = String(typed || '').replace(/\D/g, '');
  if (clean.length === 6 && (await sha256Hex(`code:${order.id}:${clean}`)) === row.code_hash) {
    const used = await env.DB.prepare('UPDATE download_codes SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL').bind(now, row.id).run();
    if (!used.meta.changes) return 'none';
    await rememberDevice(env, order.id, token, 'email_code');
    return 'ok';
  }
  await env.DB.prepare('UPDATE download_codes SET attempts = attempts + 1 WHERE id = ?1').bind(row.id).run();
  return row.attempts + 1 >= CODE_TRIES ? 'expired' : 'wrong';
}
