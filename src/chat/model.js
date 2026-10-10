// Live chat on the website (instead of WhatsApp). A visitor chats without giving any contact details: their browser
// keeps a random token in a cookie, so they can come back to the same conversation in the same browser. Messages are
// kept on the server (D1), Julie (and Gary) answer from Admin, and their phones get a notification.
// Conversations are deleted automatically a set number of days after the last message.
import { parseCookies, cookie, randomToken } from '../lib/http.js';
import { sha256Hex } from '../lib/auth.js';
import { sendPush } from '../lib/webpush.js';
import { siteOrigin } from '../lib/http.js';

export const CHAT_COOKIE = 'nw_chat';
export const MAX_MESSAGE = 1000;
export const CHAT_DEFAULTS = {
  chat_enabled: '0',
  chat_staff_name: 'New Way’s',
  chat_retention_days: '90',
  chat_available_until: '',
  chat_welcome: 'Hello! Ask us anything about New Way’s: Wednesday evenings, events, private readings or your first visit.',
  chat_away_message: 'We’re not online just now. Leave a message and we’ll reply here as soon as we can. Come back to this page in the same browser to see our reply.'
};

export async function chatSettings(env) {
  const keys = Object.keys(CHAT_DEFAULTS);
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map((_, i) => '?' + (i + 1)).join(', ')})`).bind(...keys).all();
  const stored = Object.fromEntries((results || []).filter((r) => r.key === 'chat_available_until' || String(r.value).trim()).map((r) => [r.key, r.value]));
  const s = { ...CHAT_DEFAULTS, ...stored };
  s.enabled = s.chat_enabled === '1';
  // TRUTHFUL status: "online" only while someone has said they are available, and only until the time they chose
  s.online = s.enabled && !!s.chat_available_until && Date.parse(s.chat_available_until) > Date.now();
  s.retentionDays = Math.min(365, Math.max(7, Number(s.chat_retention_days) || 90));
  return s;
}

const isHttps = (request) => new URL(request.url).protocol === 'https:';
export const tokenHash = (token) => sha256Hex('chat:' + token);

export async function sessionFor(request, env) {
  const token = parseCookies(request)[CHAT_COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  return env.DB.prepare('SELECT * FROM chat_sessions WHERE token_hash = ?1').bind(await tokenHash(token)).first();
}

export async function newSession(request, env, retentionDays) {
  const token = randomToken(32);
  const now = new Date().toISOString();
  const r = await env.DB.prepare('INSERT INTO chat_sessions (token_hash, created_at, last_message_at) VALUES (?1, ?2, ?2)').bind(await tokenHash(token), now).run();
  const session = await env.DB.prepare('SELECT * FROM chat_sessions WHERE id = ?1').bind(r.meta.last_row_id).first();
  return { session, setCookie: cookie(CHAT_COOKIE, token, { path: '/', maxAge: retentionDays * 86400, secure: isHttps(request), sameSite: 'Lax' }) };
}

export async function messages(env, sessionId, after = 0, limit = 200) {
  const { results } = await env.DB.prepare('SELECT * FROM chat_messages WHERE session_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3').bind(sessionId, after, limit).all();
  return results || [];
}

export const cleanBody = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\n{4,}/g, '\n\n\n').trim();

export async function addMessage(env, session, sender, body, staffName = '') {
  const now = new Date().toISOString();
  const steps = [env.DB.prepare('INSERT INTO chat_messages (session_id, sender, staff_name, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(session.id, sender, staffName, body, now)];
  if (sender === 'visitor') steps.push(env.DB.prepare(`UPDATE chat_sessions SET last_message_at = ?1, last_visitor_at = ?1, staff_unread = staff_unread + 1, status = CASE WHEN status = 'closed' THEN 'open' ELSE status END WHERE id = ?2`).bind(now, session.id));
  else steps.push(env.DB.prepare(`UPDATE chat_sessions SET last_message_at = ?1, last_staff_at = ?1, staff_unread = 0 WHERE id = ?2`).bind(now, session.id));
  const [ins] = await env.DB.batch(steps);
  return ins.meta.last_row_id;
}

// A notification to every phone that asked for chat notifications (Gary's and Julie's).
// To avoid a buzz for every line typed, a conversation notifies at most once every 2 minutes while unread.
export async function notifyStaff(env, request, session, body) {
  const unreadBefore = session.staff_unread || 0;
  const recent = session.last_visitor_at && Date.now() - Date.parse(session.last_visitor_at) < 120_000;
  if (unreadBefore > 0 && recent) return { skipped: true };
  const { results } = await env.DB.prepare('SELECT * FROM push_subscriptions ORDER BY id').all();
  const subject = siteOrigin(request, env).startsWith('https://') ? siteOrigin(request, env) : 'https://newwaysmediumshipdevelopmentcentre.com';
  const preview = body.length > 90 ? body.slice(0, 89) + '…' : body;
  const out = { sent: 0, failed: 0 };
  for (const sub of results || []) {
    const r = await sendPush(env, sub, { title: 'New Way’s live chat', body: preview, url: `/admin/chat/${session.id}`, tag: 'chat-' + session.id }, subject);
    if (r.ok) { out.sent++; await env.DB.prepare('UPDATE push_subscriptions SET last_ok_at = ?1, failures = 0, last_error = \'\' WHERE id = ?2').bind(new Date().toISOString(), sub.id).run(); }
    else if (r.gone) { out.failed++; await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(sub.id).run(); }
    else { out.failed++; await env.DB.prepare('UPDATE push_subscriptions SET failures = failures + 1, last_error = ?1 WHERE id = ?2').bind(`answered ${r.status}${r.error ? ': ' + r.error : ''}`, sub.id).run(); }
  }
  return out;
}

// Daily: conversations are deleted the set number of days after their last message
export async function removeOldChats(env, now = Date.now()) {
  const s = await chatSettings(env);
  const cut = new Date(now - s.retentionDays * 86400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE last_message_at < ?1)').bind(cut),
    env.DB.prepare('DELETE FROM chat_sessions WHERE last_message_at < ?1').bind(cut)
  ]);
}
