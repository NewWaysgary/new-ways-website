// Local stand-ins for WorkOS AuthKit, Cloudflare Turnstile and YouTube oEmbed, for testing only (never deployed).
// Implements the same endpoints the site uses: authorize (with PKCE), authenticate (code and refresh token),
// sessions/logout and the signing keys, with RS256-signed access tokens like the real service.
import http from 'node:http';
import crypto from 'node:crypto';

export function startMockWorkOS({ port, clientId, apiKey, ownerEmail }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'local-key-1', alg: 'RS256', use: 'sig' };
  const base = `http://localhost:${port}`;
  const users = {
    owner: { object: 'user', id: 'user_owner_01', email: ownerEmail, email_verified: true, first_name: 'Owner' },
    other: { object: 'user', id: 'user_other_02', email: 'someone.else@example.test', email_verified: true },
    unverified: { object: 'user', id: 'user_unverified_03', email: ownerEmail, email_verified: false },
    impostor: { object: 'user', id: 'user_impostor_04', email: ownerEmail, email_verified: true }
  };
  const codes = new Map();
  const refreshTokens = new Map();
  const sessions = new Map();
  const state = { failNext: 0, authenticateCalls: 0 };
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const sign = (claims) => {
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }));
    const body = b64url(JSON.stringify(claims));
    return `${head}.${body}.${b64url(crypto.sign('sha256', Buffer.from(head + '.' + body), privateKey))}`;
  };
  const issue = (user, sid) => {
    const refresh = crypto.randomBytes(24).toString('base64url');
    refreshTokens.set(refresh, { userId: user.id, sid, used: false });
    const now = Math.floor(Date.now() / 1000);
    return { user, organization_id: null, authentication_method: 'Password', refresh_token: refresh,
      access_token: sign({ iss: base + '/', sub: user.id, sid, iat: now, exp: now + 300 }) };
  };
  const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks).toString() : '';

    if (url.pathname === '/user_management/authorize') {
      const p = url.searchParams;
      if (p.get('client_id') !== clientId || p.get('response_type') !== 'code' || p.get('provider') !== 'authkit' || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
        res.writeHead(400); return res.end('bad authorize request');
      }
      const links = Object.entries(users).map(([name, user]) => {
        const code = crypto.randomBytes(12).toString('hex');
        codes.set(code, { userId: user.id, challenge: p.get('code_challenge'), used: false });
        const back = new URL(p.get('redirect_uri')); back.searchParams.set('code', code); back.searchParams.set('state', p.get('state') || '');
        return `<li><a id="as-${name}" href="${back}">Sign in as ${name} (${user.email})</a></li>`;
      }).join('');
      const cancel = new URL(p.get('redirect_uri')); cancel.searchParams.set('error', 'access_denied'); cancel.searchParams.set('state', p.get('state') || '');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><title>Test sign-in</title><h1>Stand-in for WorkOS AuthKit (testing only)</h1><ul>${links}</ul><p><a id="cancel" href="${cancel}">Cancel</a></p>`);
    }

    if (url.pathname === '/user_management/authenticate' && req.method === 'POST') {
      state.authenticateCalls++;
      if (state.failNext > 0) { state.failNext--; return json(res, 503, { error: 'unavailable' }); }
      let b; try { b = JSON.parse(body); } catch { return json(res, 400, { error: 'invalid_request' }); }
      if (b.client_id !== clientId || b.client_secret !== apiKey) return json(res, 401, { error: 'invalid_client' });
      if (b.grant_type === 'authorization_code') {
        const c = codes.get(b.code);
        if (!c || c.used) return json(res, 400, { error: 'invalid_grant' });
        c.used = true;
        const challenge = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
        if (challenge !== c.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        const user = Object.values(users).find((u) => u.id === c.userId);
        const sid = 'session_' + crypto.randomBytes(8).toString('hex');
        sessions.set(sid, { active: true });
        return json(res, 200, issue(user, sid));
      }
      if (b.grant_type === 'refresh_token') {
        const r = refreshTokens.get(b.refresh_token);
        if (!r || r.used || !sessions.get(r.sid)?.active) return json(res, 400, { error: 'invalid_grant' });
        r.used = true;
        const user = Object.values(users).find((u) => u.id === r.userId);
        return json(res, 200, issue(user, r.sid));
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }

    if (url.pathname === '/user_management/sessions/logout') {
      const s = sessions.get(url.searchParams.get('session_id'));
      if (s) s.active = false;
      res.writeHead(302, { Location: url.searchParams.get('return_to') || '/' });
      return res.end();
    }

    if (url.pathname === '/sso/jwks/' + clientId) return json(res, 200, { keys: [jwk] });

    // Stand-in for Cloudflare Turnstile's siteverify: Cloudflare's always-pass test secret plus its dummy token
    if (url.pathname === '/turnstile/v0/siteverify' && req.method === 'POST') {
      const p = new URLSearchParams(body);
      state.turnstileChecks = (state.turnstileChecks || 0) + 1;
      const ok = p.get('secret') === '1x0000000000000000000000000000000AA' && p.get('response') === 'XXXX.DUMMY.TOKEN.XXXX';
      return json(res, 200, ok ? { success: true, hostname: 'localhost' } : { success: false, 'error-codes': ['invalid-input-response'] });
    }
    // Stand-in for YouTube oEmbed: a video id starting "BLOCKED" behaves like one whose owner turned off embedding
    if (url.pathname === '/oembed') {
      const target = url.searchParams.get('url') || '';
      if (/v=BLOCKED/.test(target)) { res.writeHead(401); return res.end('Unauthorized'); }
      return json(res, 200, { title: 'Test video', provider_name: 'YouTube' });
    }

    // test controls
    if (url.pathname === '/__test/revoke-all') { for (const s of sessions.values()) s.active = false; return json(res, 200, { ok: true }); }
    if (url.pathname === '/__test/fail') { state.failNext = Number(url.searchParams.get('count') || 1); return json(res, 200, { ok: true }); }
    if (url.pathname === '/__test/stats') return json(res, 200, { ...state, activeSessions: [...sessions.values()].filter((s) => s.active).length });

    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, base })));
}
