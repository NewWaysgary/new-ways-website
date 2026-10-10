// Protecting meditation download links against being forwarded.
//
// The phone or computer used to BUY a meditation is remembered with a small security cookie (a random value; only a
// hash of it is stored, with the order). The download button works there. On any OTHER device it doesn't, and there
// is no code or other automatic way to add a device: if a customer genuinely needs to download elsewhere, Gary or a
// full Admin can authorise a replacement in Admin (recorded, with a reason). Nothing uses the visitor's internet
// address, so a changing mobile connection never matters.
//
// Purchases made before this protection existed (orders.device_protected = 0) work on any device, and a replacement
// authorised in Admin can be set to work on any device (download_entitlements.any_device = 1). Either way, the
// purchase still has only ONE download (see shop/downloads.js).
import { parseCookies, cookie, randomToken } from '../lib/http.js';
import { sha256Hex } from '../orders.js';

export const DEVICE_COOKIE = 'nw_device';
const DEVICE_DAYS = 365;

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
  return !!(await env.DB.prepare('SELECT 1 FROM order_devices WHERE order_id = ?1 AND device_hash = ?2 AND how = \'purchase\'').bind(ent.order_id, await deviceHash(token)).first());
}
