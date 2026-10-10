// Admin sign-in and sessions.
//
// Sign-in happens on WorkOS's hosted AuthKit page (email + password, password reset, optional authenticator 2FA,
// attempt limits). This file then:
//  - checks the result on the server (code exchange with PKCE, token signature check),
//  - accepts only the owner (OWNER_EMAIL with a verified email, then bound to that WorkOS account), a FULL ADMIN the
//    owner has added (such as Julie: verified email; bound to their WorkOS account on first sign-in; the same Admin
//    as the owner, except adding or removing other admins), or a check-in helper the owner has added (verified email;
//    bound on first sign-in). Helpers can ONLY use check-in: the Admin router refuses everything else for them.
//  - keeps a server-side session: the phone holds only a random token in an HttpOnly cookie,
//  - re-confirms the session with WorkOS every few minutes, so a password reset or "sign out everywhere" ends it,
//  - ends sessions after 30 days, or after 14 days without use.
// If any setting is missing, Admin stays locked.
import { parseCookies, cookie, randomToken } from './http.js';
import * as workos from './workos.js';

const SESSION_COOKIE = 'nw_admin';
const SIGNIN_COOKIE = 'nw_signin';
const SESSION_DAYS = 30;
const IDLE_DAYS = 14;
const RECHECK_MINUTES = 10;
const GRACE_MINUTES = 60;        // if WorkOS can't be reached, keep working this long after the last confirmation
const MAX_SESSIONS = 5;          // per owner (phone, computer, ...)

export const signInConfigured = (request, env) => !!workos.workosConfig(request, env);

const enc = new TextEncoder();
const isHttps = (request) => new URL(request.url).protocol === 'https:';
const nowIso = () => new Date().toISOString();

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function aesKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('new-ways:refresh-token:' + secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(secret, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(text));
  return b64url(iv) + '.' + b64url(ct);
}

async function decrypt(secret, value) {
  try {
    const [ivText, ctText] = String(value).split('.');
    const from = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: from(ivText) }, await aesKey(secret), from(ctText));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requestMeta(request) {
  const meta = {};
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) meta.ip_address = ip;
  const ua = request.headers.get('User-Agent');
  if (ua) meta.user_agent = ua.slice(0, 300);
  return meta;
}

const deleteSession = (env, idHash) => env.DB.prepare('DELETE FROM admin_sessions WHERE id_hash = ?1').bind(idHash).run();

// ---------- every Admin request ----------

export async function getAdmin(request, env) {
  const cfg = workos.workosConfig(request, env);
  if (!cfg) return null;
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token || token.length < 40 || token.length > 100) return null;
  const idHash = await sha256Hex(token);
  const [row, owner] = await Promise.all([
    env.DB.prepare('SELECT * FROM admin_sessions WHERE id_hash = ?1').bind(idHash).first(),
    env.DB.prepare('SELECT * FROM owner WHERE id = 1').first()
  ]);
  if (!row) return null;
  const now = Date.now();
  const role = row.role === 'helper' ? 'helper' : row.role === 'admin' ? 'admin' : 'owner';
  const helper = role === 'helper' && row.helper_id ? await env.DB.prepare('SELECT * FROM checkin_helpers WHERE id = ?1').bind(row.helper_id).first() : null;
  const member = role === 'admin' && row.admin_user_id ? await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?1').bind(row.admin_user_id).first() : null;
  const notOwner = !owner || owner.workos_user_id !== row.user_id;
  const accountOk = role === 'owner' ? !!owner && owner.workos_user_id === row.user_id
    : role === 'admin' ? !!member && member.active === 1 && member.workos_user_id === row.user_id && notOwner
      : !!helper && helper.active === 1 && helper.workos_user_id === row.user_id && notOwner;
  if (Date.parse(row.expires_at) <= now || now - Date.parse(row.last_seen_at) > IDLE_DAYS * 86400_000 || !accountOk) {
    await deleteSession(env, idHash);
    return null;
  }

  const checkedAt = Date.parse(row.checked_at);
  if (now - checkedAt > RECHECK_MINUTES * 60_000) {
    const refreshToken = await decrypt(cfg.secret, row.refresh_token);
    const result = refreshToken ? await workos.refreshSession(cfg, refreshToken, requestMeta(request)) : { ok: false, transient: false };
    if (result.ok) {
      const claims = await workos.verifyAccessToken(cfg, result.data.access_token);
      if (!claims || claims.sub !== row.user_id || (result.data.user && result.data.user.id !== row.user_id)) {
        await deleteSession(env, idHash);
        return null;
      }
      await env.DB.prepare('UPDATE admin_sessions SET refresh_token = ?1, checked_at = ?2, last_seen_at = ?2, workos_sid = ?3 WHERE id_hash = ?4')
        .bind(await encrypt(cfg.secret, result.data.refresh_token), nowIso(), claims.sid || row.workos_sid, idHash).run();
    } else if (result.transient && now - checkedAt < GRACE_MINUTES * 60_000) {
      // WorkOS briefly unreachable: keep the session for now and try again on the next request
    } else {
      if (!result.transient) await deleteSession(env, idHash);   // ended at WorkOS (signed out, password reset, expired)
      return null;
    }
  } else if (now - Date.parse(row.last_seen_at) > 5 * 60_000) {
    await env.DB.prepare('UPDATE admin_sessions SET last_seen_at = ?1 WHERE id_hash = ?2').bind(nowIso(), idHash).run();
  }
  if (role === 'helper') return { role, userId: row.user_id, email: helper.email, name: helper.name || helper.email, helperId: helper.id, idHash, sid: row.workos_sid };
  if (role === 'admin') return { role, userId: row.user_id, email: member.email, name: member.name || member.email, adminUserId: member.id, idHash, sid: row.workos_sid };
  return { role, userId: row.user_id, email: owner.email, name: 'Gary', idHash, sid: row.workos_sid };
}

// ---------- sign in ----------

export async function beginSignIn(request, env) {
  const cfg = workos.workosConfig(request, env);
  if (!cfg) return null;
  const origin = new URL(request.url).origin;
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  return {
    location: workos.authorizeUrl(cfg, { redirectUri: origin + '/admin/callback', state, codeChallenge: challenge }),
    setCookie: cookie(SIGNIN_COOKIE, state + '.' + verifier, { path: '/admin', maxAge: 600, secure: isHttps(request), sameSite: 'Lax' })
  };
}

// Returns { ok: true, setCookies } or { ok: false, reason, setCookies }
export async function finishSignIn(request, env) {
  const cfg = workos.workosConfig(request, env);
  const clearSignin = cookie(SIGNIN_COOKIE, '', { path: '/admin', maxAge: 0, secure: isHttps(request), sameSite: 'Lax' });
  const fail = (reason) => ({ ok: false, reason, setCookies: [clearSignin] });
  if (!cfg) return fail('not-configured');
  const url = new URL(request.url);
  if (url.searchParams.get('error')) return fail('cancelled');
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const [savedState, verifier] = String(parseCookies(request)[SIGNIN_COOKIE] || '').split('.');
  if (!code || !state || !savedState || !verifier || !timingSafeEqual(state, savedState)) return fail('expired');

  const result = await workos.exchangeCode(cfg, code, verifier, requestMeta(request));
  if (!result.ok) return fail(result.transient ? 'unavailable' : 'expired');
  const { user, access_token: accessToken, refresh_token: refreshToken } = result.data;
  const claims = await workos.verifyAccessToken(cfg, accessToken);
  if (!claims || !user || claims.sub !== user.id) return fail('expired');

  const email = String(user.email || '').trim().toLowerCase();
  const owner = await env.DB.prepare('SELECT * FROM owner WHERE id = 1').first();
  let role = 'owner', helper = null, member = null;
  if (email === cfg.ownerEmail && user.email_verified === true) {
    if (owner && owner.workos_user_id !== user.id) return { ...fail('not-owner'), sid: claims.sid };
  } else if (user.email_verified === true && email
      && (member = await env.DB.prepare('SELECT * FROM admin_users WHERE email = ?1 AND active = 1').bind(email).first())) {
    // A full Admin added by the owner (Admin > Admin team): verified email, active, and the same WorkOS account each time
    if ((member.workos_user_id && member.workos_user_id !== user.id) || (owner && owner.workos_user_id === user.id)) return { ...fail('not-owner'), sid: claims.sid };
    role = 'admin';
  } else {
    // A check-in helper added by the owner (Admin > Check in > Helpers): verified email, active, and the same WorkOS account each time
    helper = user.email_verified === true && email
      ? await env.DB.prepare('SELECT * FROM checkin_helpers WHERE email = ?1 AND active = 1').bind(email).first() : null;
    if (!helper || (helper.workos_user_id && helper.workos_user_id !== user.id) || (owner && owner.workos_user_id === user.id)) return { ...fail('not-owner'), sid: claims.sid };
    role = 'helper';
  }

  const token = randomToken(48);
  const idHash = await sha256Hex(token);
  const now = new Date();
  const statements = [];
  if (role === 'owner' && !owner) statements.push(env.DB.prepare('INSERT INTO owner (id, workos_user_id, email) VALUES (1, ?1, ?2)').bind(user.id, email));
  if (helper) statements.push(env.DB.prepare('UPDATE checkin_helpers SET workos_user_id = ?1, last_signin_at = ?2 WHERE id = ?3').bind(user.id, now.toISOString(), helper.id));
  if (member) statements.push(env.DB.prepare('UPDATE admin_users SET workos_user_id = ?1, last_signin_at = ?2 WHERE id = ?3').bind(user.id, now.toISOString(), member.id));
  statements.push(
    env.DB.prepare(`INSERT INTO admin_sessions (id_hash, user_id, workos_sid, refresh_token, created_at, expires_at, last_seen_at, checked_at, user_agent, role, helper_id, admin_user_id)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?5, ?7, ?8, ?9, ?10)`)
      .bind(idHash, user.id, claims.sid || '', await encrypt(cfg.secret, refreshToken), now.toISOString(),
        new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString(), String(request.headers.get('User-Agent') || '').slice(0, 200), role, helper ? helper.id : null, member ? member.id : null),
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?1').bind(now.toISOString()),
    // at most MAX_SESSIONS signed-in devices per person (the oldest is signed out)
    env.DB.prepare(`DELETE FROM admin_sessions WHERE user_id = ?1 AND id_hash IN (SELECT id_hash FROM admin_sessions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT -1 OFFSET ${MAX_SESSIONS})`).bind(user.id),
    env.DB.prepare('INSERT INTO audit_log (action, summary) VALUES (?1, ?2)').bind('signin', helper ? `Check-in helper ${helper.name || email} signed in`
      : member ? `Admin ${member.name || email} signed in` : owner ? 'Owner signed in' : 'Owner account linked and signed in')
  );
  await env.DB.batch(statements);
  return {
    ok: true,
    setCookies: [clearSignin, cookie(SESSION_COOKIE, token, { path: '/admin', maxAge: SESSION_DAYS * 86400, secure: isHttps(request), sameSite: 'Lax' })]
  };
}

// ---------- sign out ----------

export async function signOut(request, env, admin) {
  const cfg = workos.workosConfig(request, env);
  const origin = new URL(request.url).origin;
  if (admin) await deleteSession(env, admin.idHash);
  const setCookie = cookie(SESSION_COOKIE, '', { path: '/admin', maxAge: 0, secure: isHttps(request), sameSite: 'Lax' });
  const location = cfg && admin && admin.sid ? workos.logoutUrl(cfg, admin.sid, origin + '/admin/signed-out') : '/admin/signed-out';
  return { location, setCookie };
}

export function workosLogoutFor(request, env, sid) {
  const cfg = workos.workosConfig(request, env);
  return cfg && sid ? workos.logoutUrl(cfg, sid, new URL(request.url).origin + '/admin/signed-out') : null;
}

export function workosOrigin(request, env) {
  const cfg = workos.workosConfig(request, env);
  return cfg ? new URL(cfg.base).origin : null;
}

// ---------- CSRF: a random token in a cookie that must match the token in each Admin form, plus a same-site check ----------

const CSRF_COOKIE = 'nw_csrf';

export function csrfFor(request) {
  const existing = parseCookies(request)[CSRF_COOKIE];
  if (existing && existing.length >= 32) return { token: existing, setCookie: null };
  const token = randomToken(32);
  return { token, setCookie: cookie(CSRF_COOKIE, token, { path: '/admin', secure: isHttps(request), sameSite: 'Strict' }) };
}

export function checkCsrf(request, form) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return false;
  if (!origin) {
    const referer = request.headers.get('Referer');
    try { if (!referer || new URL(referer).origin !== url.origin) return false; } catch { return false; }
  }
  const expected = parseCookies(request)[CSRF_COOKIE];
  return !!expected && expected.length >= 32 && timingSafeEqual(expected, form._csrf || '');
}
