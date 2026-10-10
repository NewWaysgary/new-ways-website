// Live chat for visitors: /chat (works with or without scripts), and the two small requests the page makes.
// No name, email or phone number is needed. Spam protection: the free Turnstile check on the first message, a hidden
// trap field, limits per connection and per conversation, and a maximum message length.
import { htmlResponse, redirect, readForm, textResponse } from '../lib/http.js';
import { turnstileConfig, verifyTurnstile, formStamp, stampAge } from '../lib/turnstile.js';
import { allow } from '../lib/ratelimit.js';
import * as pub from '../views/public.js';
import * as view from '../views/chat.js';
import * as c from './model.js';

const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...PRIVATE, ...headers } });
const shape = (m) => ({ id: m.id, from: m.sender === 'visitor' ? 'you' : 'staff', name: m.sender === 'staff' ? m.staff_name : '', body: m.body, at: m.created_at });

async function chatPage(request, env, state = {}) {
  const ctx = await pub.pageContext(request, env);
  const settings = await c.chatSettings(env);
  const session = await c.sessionFor(request, env);
  const list = session ? await c.messages(env, session.id) : [];
  const cfg = turnstileConfig(request, env);
  const stampCfg = cfg || { secret: env.SESSION_SECRET || 'nw-chat' };
  return htmlResponse(await view.chatPage(ctx, { settings, session, messages: list.map(shape), stamp: await formStamp(stampCfg),
    siteKey: !session && cfg ? cfg.siteKey : '', ...state }), { status: state.status || 200, headers: PRIVATE });
}

async function send(request, env) {
  const here = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const wantsJson = request.headers.get('X-NW-Chat') === '1';
  const settings = await c.chatSettings(env);
  const fail = async (notice, status) => (wantsJson ? json({ ok: false, error: notice }, status) : chatPage(request, env, { notice, status }));
  if (!settings.enabled) return fail('Live chat isn’t available at the moment.', 503);
  const f = await readForm(request, 8_000);
  const body = c.cleanBody(f.body);
  const cfg = turnstileConfig(request, env);
  const stampCfg = cfg || { secret: env.SESSION_SECRET || 'nw-chat' };
  const age = await stampAge(stampCfg, f.t);
  const existing = await c.sessionFor(request, env);
  // A program: keep nothing. (The "sent too fast" check is only for starting a conversation; someone already
  // chatting can reply as quickly as they like.)
  if (String(f.website || '').trim() || (!existing && age !== null && age < 1500)) return wantsJson ? json({ ok: true }) : redirect('/chat');
  if (!body) return fail('Please type a message.', 422);
  if (body.length > c.MAX_MESSAGE) return fail(`Please keep each message under ${c.MAX_MESSAGE} characters.`, 422);
  if (!(await allow(env, request, 'chat-msg', 20, 600))) return fail('You’ve sent a lot of messages in a short time. Please wait a few minutes.', 429);

  let session = existing;
  let setCookie = null;
  if (session && session.status === 'blocked') return fail('This conversation has been closed. Please contact New Way’s another way.', 403);
  if (!session) {
    // Starting a conversation: the spam check, and a limit on new conversations per connection and in total
    if (age === null || age > 12 * 3600_000) return fail('This page was open for a long time. Please refresh it and try again.', 400);
    if (cfg && !(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
      return fail('The security check didn’t complete. Please wait for it to finish, then send again.', 400);
    }
    if (!(await allow(env, request, 'chat-new', 5, 3600))) return fail('Too many new conversations from this connection. Please try again later.', 429);
    if (!(await allow(env, { headers: new Headers() }, 'chat-new-all', 300, 86400))) return fail('Live chat is very busy just now. Please try again later.', 429);
    const made = await c.newSession(request, env, settings.retentionDays);
    session = made.session;
    setCookie = made.setCookie;
    const name = String(f.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (name) await env.DB.prepare('UPDATE chat_sessions SET visitor_name = ?1 WHERE id = ?2').bind(name, session.id).run();
  } else {
    const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE session_id = ?1 AND sender = 'visitor' AND created_at > ?2`)
      .bind(session.id, new Date(Date.now() - 3600_000).toISOString()).first('n');
    if (recent >= 40) return fail('You’ve sent a lot of messages. Please wait for a reply.', 429);
  }
  const before = session;
  const id = await c.addMessage(env, session, 'visitor', body);
  try { await c.notifyStaff(env, request, before, body); } catch (err) { console.error("New Way's: chat notification not sent:", err && err.message); }
  const headers = setCookie ? { 'Set-Cookie': setCookie } : {};
  if (wantsJson) return json({ ok: true, id }, 200, headers);
  return redirect('/chat#latest', 303, headers);
}

async function poll(request, env, url) {
  const session = await c.sessionFor(request, env);
  const settings = await c.chatSettings(env);
  if (!session) return json({ ok: true, messages: [], online: settings.online, enabled: settings.enabled });
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const list = await c.messages(env, session.id, after);
  return json({ ok: true, messages: list.map(shape), online: settings.online, enabled: settings.enabled, closed: session.status === 'blocked' });
}

export async function handleChatRoutes(request, env, url, method, path) {
  if (path === '/chat') return method === 'GET' ? chatPage(request, env) : null;
  if (path === '/chat/send' && method === 'POST') return send(request, env);
  if (path === '/chat/messages' && method === 'GET') return poll(request, env, url);
  return null;
}
