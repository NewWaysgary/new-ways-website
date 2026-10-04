// Responses and security headers.

export const ASSET_VERSION = '2';   // change when CSS/JS files change, so phones fetch the new copies

// The real public address. Any other address (such as the temporary test address) is kept out of Google.
export function isProductionHost(request, env) {
  try { return new URL(request.url).host === new URL(env.SITE_URL).host; } catch { return false; }
}

export function siteOrigin(request, env) {
  try { return new URL(env.SITE_URL).origin; } catch { return new URL(request.url).origin; }
}

export function htmlResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(String(body), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...headers }
  });
}

export function textResponse(body, { status = 200, type = 'text/plain; charset=utf-8', headers = {} } = {}) {
  return new Response(body, { status, headers: { 'Content-Type': type, ...headers } });
}

export function redirect(location, status = 303, headers = {}) {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://i.ytimg.com",
  "media-src 'self'",
  "frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

export function withSecurityHeaders(response, request, env, { admin = false, formActionExtra = null } = {}) {
  const res = new Response(response.body, response);
  const h = res.headers;
  const url = new URL(request.url);
  const isHtml = (h.get('Content-Type') || '').includes('text/html');
  let csp = CSP;
  if (formActionExtra) csp = csp.replace("form-action 'self'", `form-action 'self' ${formActionExtra}`);
  if (admin) csp = csp.replace("img-src 'self' data:", "img-src 'self' data: blob:");   // photo previews before upload
  if (isHtml) h.set('Content-Security-Policy', csp + (url.protocol === 'https:' ? '; upgrade-insecure-requests' : ''));
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('X-Frame-Options', 'DENY');
  if (url.protocol === 'https:' && isProductionHost(request, env)) {
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (admin) {
    h.set('Cache-Control', 'no-store');
    h.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  } else if (!isProductionHost(request, env)) {
    h.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return res;
}

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, path = '/', secure = true, httpOnly = true, sameSite = 'Strict' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function readForm(request, maxBytes = 200_000) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'That form was too large.');
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/x-www-form-urlencoded') && !type.includes('multipart/form-data')) {
    throw new HttpError(415, 'Unexpected form type.');
  }
  const data = await request.formData();
  const out = {};
  for (const [k, v] of data.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

// Admin forms with photos: text fields plus uploaded files
export async function readMultipart(request, maxBytes = 9_000_000) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'That upload was too large. Please choose a photo under 8 MB.');
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('multipart/form-data') && !type.includes('application/x-www-form-urlencoded')) throw new HttpError(415, 'Unexpected form type.');
  const data = await request.formData();
  const fields = {};
  const files = {};
  const fileLists = {};
  for (const [k, v] of data.entries()) {
    if (typeof v === 'string') fields[k] = v;
    else if (v && typeof v.arrayBuffer === 'function' && v.size > 0) {
      if (!files[k]) files[k] = v;
      (fileLists[k] = fileLists[k] || []).push(v);
    }
  }
  return { fields, files, fileLists };
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
