// Web Push (free, built into Chrome on Android): phone notifications for Admin, used for live chat.
// Standards: VAPID (RFC 8292) to identify this website to the phone's push service, and "aes128gcm" message
// encryption (RFC 8291 / RFC 8188), so only the phone that subscribed can read a notification.
// Everything uses the Workers' built-in Web Crypto: no outside service, library or cost.
//
// The website's VAPID key pair is made automatically the first time it is needed and kept in the settings table
// (it is never shown, and is left out of backups). If it is ever lost, phones simply turn notifications on again.

const enc = new TextEncoder();

export function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(text) {
  const t = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

// ---------- the website's VAPID keys ----------
export async function vapidKeys(env) {
  const rows = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('vapid_public_key', 'vapid_private_jwk')`).all();
  const s = Object.fromEntries((rows.results || []).map((r) => [r.key, r.value]));
  if (s.vapid_public_key && s.vapid_private_jwk) {
    try {
      const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(s.vapid_private_jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      return { publicKey: s.vapid_public_key, privateKey };
    } catch { /* fall through and make new keys */ }
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = b64url(publicRaw);
  // Only stored if no other request stored keys at the same moment (then theirs are used)
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_public_key', ?1)`).bind(publicKey),
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_private_jwk', ?1)`).bind(JSON.stringify(jwk))
  ]);
  const again = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'vapid_public_key'`).first('value');
  if (again !== publicKey) return vapidKeys(env);
  return { publicKey, privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
}

export async function vapidJwt(privateKey, audience, subject, expiresInSeconds = 12 * 3600) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + expiresInSeconds, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(header + '.' + claims));
  return `${header}.${claims}.${b64url(sig)}`;   // Web Crypto gives the raw r||s signature that ES256 needs
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// Encrypts one notification for one subscription (RFC 8291). Returns the request body.
export async function encryptPayload(payload, p256dh, auth, { salt = crypto.getRandomValues(new Uint8Array(16)), localKeys = null } = {}) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('That push subscription is not valid.');
  const local = localKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = concat(enc.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)), new Uint8Array([2]));   // 2 = last (only) record
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// Only the phones' real push services are ever contacted (and this computer, for the automated tests)
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

// Sends one notification. Returns { ok, status, gone } (gone = the phone has turned notifications off: forget it).
export async function sendPush(env, sub, payload, subject) {
  if (!allowedEndpoint(sub.endpoint)) return { ok: false, status: 0, gone: true };
  const keys = await vapidKeys(env);
  const audience = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(keys.privateKey, audience, subject);
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  try {
    const res = await fetch(sub.endpoint, { method: 'POST', body, headers: {
      Authorization: `vapid t=${jwt}, k=${keys.publicKey}`, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high'
    } });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (err) {
    return { ok: false, status: 0, gone: false, error: String(err && err.message).slice(0, 120) };
  }
}
