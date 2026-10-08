// Local stand-ins for WorkOS AuthKit, Cloudflare Turnstile, YouTube oEmbed, Square and Resend, for testing only (never deployed).
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
  const square = { links: new Map(), orders: new Map(), payments: new Map(), byKey: new Map(), failNext: 0, failReads: false, deletedCount: 0, orderReads: 0 };
  const mail = { sent: [], failNext: 0 };
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

    // ---------- Stand-in for Square (Checkout, Orders and Payments APIs), testing only ----------
    if (url.pathname.startsWith('/v2/')) {
      if (req.headers.authorization !== 'Bearer sq_local_test' || !req.headers['square-version']) return json(res, 401, { errors: [{ code: 'UNAUTHORIZED' }] });
      if (url.pathname === '/v2/online-checkout/payment-links' && req.method === 'POST') {
        if (square.failNext > 0) { square.failNext--; return json(res, 503, { errors: [{ code: 'SERVICE_UNAVAILABLE' }] }); }
        let b; try { b = JSON.parse(body); } catch { return json(res, 400, { errors: [{ code: 'BAD_REQUEST' }] }); }
        if (b.idempotency_key && square.byKey.has(b.idempotency_key)) return json(res, 200, { payment_link: square.byKey.get(b.idempotency_key) });
        const item = b.order?.line_items?.[0];
        if (!b.order || b.order.location_id !== 'LOCAL_LOCATION' || !item || item.base_price_money?.currency !== 'GBP') return json(res, 400, { errors: [{ code: 'INVALID_REQUEST' }] });
        const id = 'PL' + crypto.randomBytes(6).toString('hex').toUpperCase(), orderId = 'SQORDER' + crypto.randomBytes(6).toString('hex').toUpperCase();
        square.links.set(id, { id, orderId, amount: item.base_price_money.amount, name: item.name, redirect: b.checkout_options?.redirect_url, deleted: false, paymentId: null, requests: b });
        square.orders.set(orderId, id);
        const link = { id, version: 1, order_id: orderId, url: `${base}/__square/checkout/${id}`, long_url: `${base}/__square/checkout/${id}?long=1`, created_at: new Date().toISOString() };
        if (b.idempotency_key) square.byKey.set(b.idempotency_key, link);
        return json(res, 200, { payment_link: link });
      }
      const del = url.pathname.match(/^\/v2\/online-checkout\/payment-links\/([A-Z0-9]+)$/);
      if (del && req.method === 'DELETE') {
        const l = square.links.get(del[1]);
        if (!l || l.deleted) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
        l.deleted = true; square.deletedCount++;
        return json(res, 200, { id: l.id });
      }
      const ord = url.pathname.match(/^\/v2\/orders\/([A-Z0-9]+)$/);
      if (ord && req.method === 'GET') {
        if (square.failReads) return json(res, 503, { errors: [{ code: 'SERVICE_UNAVAILABLE' }] });
        const l = square.links.get(square.orders.get(ord[1]));
        if (!l) return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
        square.orderReads++;
        return json(res, 200, { order: { id: l.orderId, location_id: 'LOCAL_LOCATION', state: l.paymentId ? 'COMPLETED' : 'OPEN', tenders: l.paymentId ? [{ id: 'T' + l.paymentId, payment_id: l.paymentId }] : [] } });
      }
      const pay = url.pathname.match(/^\/v2\/payments\/([A-Za-z0-9]+)$/);
      if (pay && req.method === 'GET') {
        const p = square.payments.get(pay[1]);
        return p ? json(res, 200, { payment: p }) : json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
      }
      return json(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
    }
    const co = url.pathname.match(/^\/__square\/checkout\/([A-Z0-9]+)$/);
    if (co) {
      const l = square.links.get(co[1]);
      res.writeHead(l && !l.deleted ? 200 : 410, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(l && !l.deleted ? `<!doctype html><title>Square Sandbox stand-in</title><h1>Pay £${(l.amount / 100).toFixed(2)}</h1><p>${l.name}</p><a id="pay" href="/__square/pay/${l.id}?redirect=1">Pay now (test)</a>` : 'This payment link is no longer available.');
    }
    const pp = url.pathname.match(/^\/__square\/pay\/([A-Z0-9]+)$/);
    if (pp) {
      const l = square.links.get(pp[1]);
      if (!l || l.deleted) return json(res, 410, { error: 'link gone' });
      if (!l.paymentId) {
        l.paymentId = 'PAY' + crypto.randomBytes(6).toString('hex').toUpperCase();
        const amount = url.searchParams.has('amount') ? Number(url.searchParams.get('amount')) : l.amount;
        square.payments.set(l.paymentId, { id: l.paymentId, order_id: l.orderId, status: 'COMPLETED', location_id: url.searchParams.get('location') || 'LOCAL_LOCATION',
          amount_money: { amount, currency: 'GBP' }, created_at: new Date().toISOString() });
      }
      if (url.searchParams.get('redirect') === '1' && l.redirect) { res.writeHead(302, { Location: l.redirect }); return res.end(); }
      return json(res, 200, { payment: square.payments.get(l.paymentId) });
    }
    if (url.pathname === '/__square/fail-next') { square.failNext = Number(url.searchParams.get('count') || 1); return json(res, 200, { ok: true }); }
    if (url.pathname === '/__square/fail-reads') { square.failReads = url.searchParams.get('on') === '1'; return json(res, 200, { ok: true }); }
    if (url.pathname === '/__square/state') return json(res, 200, { links: [...square.links.values()], deletedCount: square.deletedCount, orderReads: square.orderReads });

    // ---------- Stand-in for Resend (email), testing only ----------
    if (url.pathname === '/emails' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer re_local_test') return json(res, 401, { message: 'invalid key' });
      if (mail.failNext > 0) { mail.failNext--; return json(res, 500, { message: 'temporary failure' }); }
      const m = JSON.parse(body);
      const id = 'email_' + crypto.randomBytes(5).toString('hex');
      mail.sent.push({ id, ...m });
      return json(res, 200, { id });
    }
    if (url.pathname === '/__emails') return json(res, 200, mail.sent);
    if (url.pathname === '/__emails/fail-next') { mail.failNext = Number(url.searchParams.get('count') || 1); return json(res, 200, { ok: true }); }

    // test controls
    if (url.pathname === '/__test/revoke-all') { for (const s of sessions.values()) s.active = false; return json(res, 200, { ok: true }); }
    if (url.pathname === '/__test/fail') { state.failNext = Number(url.searchParams.get('count') || 1); return json(res, 200, { ok: true }); }
    if (url.pathname === '/__test/stats') return json(res, 200, { ...state, activeSessions: [...sessions.values()].filter((s) => s.active).length });

    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, base })));
}
