// WorkOS AuthKit (the hosted sign-in page). Every call here runs on the server; the API key never reaches a browser.
// Docs: /user_management/authorize, /user_management/authenticate, /user_management/sessions/logout, /sso/jwks/{client_id}

const WORKOS_API = 'https://api.workos.com';

// Returns null (Admin stays locked) unless every required secret is set.
export function workosConfig(request, env) {
  if (!env.WORKOS_CLIENT_ID || !env.WORKOS_API_KEY || !env.OWNER_EMAIL || !env.SESSION_SECRET) return null;
  if (String(env.SESSION_SECRET).length < 32) return null;
  const host = new URL(request.url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  // The local test copy may point at a stand-in sign-in service. Real addresses always use WorkOS itself.
  const base = local && env.WORKOS_API_BASE ? String(env.WORKOS_API_BASE).replace(/\/+$/, '') : WORKOS_API;
  return {
    base,
    clientId: String(env.WORKOS_CLIENT_ID),
    apiKey: String(env.WORKOS_API_KEY),
    ownerEmail: String(env.OWNER_EMAIL).trim().toLowerCase(),
    secret: String(env.SESSION_SECRET)
  };
}

export function authorizeUrl(cfg, { redirectUri, state, codeChallenge }) {
  const url = new URL(cfg.base + '/user_management/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    provider: 'authkit',
    screen_hint: 'sign-in',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();
  return url.toString();
}

export function logoutUrl(cfg, sessionId, returnTo) {
  const url = new URL(cfg.base + '/user_management/sessions/logout');
  url.search = new URLSearchParams({ session_id: sessionId, return_to: returnTo }).toString();
  return url.toString();
}

// ok: true with data, or ok: false with transient (network, 5xx, 429: try again later) vs terminal (e.g. invalid_grant)
async function authenticate(cfg, body) {
  let res;
  try {
    res = await fetch(cfg.base + '/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.apiKey, ...body })
    });
  } catch {
    return { ok: false, transient: true, error: 'network' };
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.ok && data && data.access_token && data.refresh_token) return { ok: true, data };
  return { ok: false, transient: res.status >= 500 || res.status === 429, status: res.status, error: (data && (data.error || data.code)) || 'error' };
}

export function exchangeCode(cfg, code, codeVerifier, meta) {
  return authenticate(cfg, { grant_type: 'authorization_code', code, code_verifier: codeVerifier, ...meta });
}

export function refreshSession(cfg, refreshToken, meta) {
  return authenticate(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken, ...meta });
}

// ---------- access token (JWT, RS256) check against WorkOS's published signing keys ----------

let jwksCache = { url: '', keys: [], fetchedAt: 0 };

async function signingKeys(cfg, force = false) {
  const url = `${cfg.base}/sso/jwks/${encodeURIComponent(cfg.clientId)}`;
  if (!force && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < 3600_000) return jwksCache.keys;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('jwks ' + res.status);
  const body = await res.json();
  jwksCache = { url, keys: Array.isArray(body.keys) ? body.keys : [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

function b64urlToBytes(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function decodePart(text) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(text)));
}

// Returns the token's claims if the signature, issuer and expiry are valid; otherwise null.
export async function verifyAccessToken(cfg, token) {
  try {
    const [h, p, s] = String(token).split('.');
    if (!h || !p || !s) return null;
    const header = decodePart(h);
    if (header.alg !== 'RS256') return null;
    let keys = await signingKeys(cfg);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) { keys = await signingKeys(cfg, true); jwk = keys.find((k) => k.kid === header.kid); }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(h + '.' + p));
    if (!valid) return null;
    const claims = decodePart(p);
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp < now - 60) return null;
    if (typeof claims.iss !== 'string' || !claims.iss.startsWith(cfg.base)) return null;
    if (!claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}
