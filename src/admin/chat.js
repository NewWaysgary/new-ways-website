// Admin > Live chat: conversations, replying, "I'm available" (the truthful online status visitors see), phone
// notifications, and the chat settings. Only the owner and full Admins (such as Julie) can use it.
import { textResponse, redirect, siteOrigin } from '../lib/http.js';
import * as data from '../lib/data.js';
import * as c from '../chat/model.js';
import { vapidKeys, allowedEndpoint, sendPush } from '../lib/webpush.js';
import * as view from '../views/admin-chat.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const upsert = (env, k, v) => env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(k, String(v));
const whoKey = (admin) => (admin.role === 'owner' ? 'owner' : 'admin:' + admin.adminUserId);

async function conversations(env, filter) {
  const where = filter === 'closed' ? `s.status IN ('closed', 'blocked')` : `s.status = 'open'`;
  const { results } = await env.DB.prepare(`SELECT s.*, (SELECT body FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT sender FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_sender
    FROM chat_sessions s WHERE ${where} ORDER BY s.staff_unread > 0 DESC, s.last_message_at DESC LIMIT 100`).all();
  return results || [];
}

export async function chatUnread(env) {
  try { return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM chat_sessions WHERE status = 'open' AND staff_unread > 0`).first('n')) || 0; } catch { return 0; }
}

export async function handleChatAdmin({ request, env, url, method, path, form, page, csrf, admin }) {
  if (path !== '/admin/chat' && !path.startsWith('/admin/chat/')) return null;
  const f = form.fields;
  const me = admin.role === 'owner' ? 'Gary' : admin.name;

  if (path === '/admin/chat' && method === 'GET') {
    const filter = url.searchParams.get('show') === 'closed' ? 'closed' : 'open';
    const [settings, list, subs, keys] = await Promise.all([c.chatSettings(env), conversations(env, filter),
      env.DB.prepare('SELECT id, who, label, created_at, last_ok_at, last_error, failures FROM push_subscriptions ORDER BY id').all(), vapidKeys(env)]);
    return page(view.chatListPage({ settings, list, filter, subs: subs.results || [], me: whoKey(admin), vapidKey: keys.publicKey, csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }
  if (path === '/admin/chat/unread' && method === 'GET') return json({ unread: await chatUnread(env) });

  // ----- "I'm available" (what visitors see as Online now / Away) -----
  if (path === '/admin/chat/available' && method === 'POST') {
    const hours = Number(f.hours);
    const until = [1, 2, 4, 8, 12].includes(hours) ? new Date(Date.now() + hours * 3600_000).toISOString() : '';
    await env.DB.batch([upsert(env, 'chat_available_until', until), data.audit(env, 'chat.available', until ? `${me} available for chat for ${hours} hours` : `${me} set chat to away`)]);
    return redirect('/admin/chat?flash=' + (until ? 'available' : 'away'));
  }
  if (path === '/admin/chat/settings' && method === 'POST') {
    const name = String(f.chat_staff_name || '').trim().replace(/\s+/g, ' ').slice(0, 40) || c.CHAT_DEFAULTS.chat_staff_name;
    const days = Math.min(365, Math.max(7, Number(f.chat_retention_days) || 90));
    const welcome = String(f.chat_welcome || '').trim().slice(0, 400) || c.CHAT_DEFAULTS.chat_welcome;
    const away = String(f.chat_away_message || '').trim().slice(0, 400) || c.CHAT_DEFAULTS.chat_away_message;
    await env.DB.batch([upsert(env, 'chat_enabled', f.chat_enabled === '1' ? '1' : '0'), upsert(env, 'chat_staff_name', name), upsert(env, 'chat_retention_days', days),
      upsert(env, 'chat_welcome', welcome), upsert(env, 'chat_away_message', away), data.audit(env, 'chat.settings', `Live chat settings saved by ${me} (chat ${f.chat_enabled === '1' ? 'on' : 'off'})`)]);
    return redirect('/admin/chat?flash=saved');
  }

  // ----- phone notifications -----
  if (path === '/admin/chat/push/subscribe' && method === 'POST') {
    let sub;
    try { sub = JSON.parse(String(f.subscription || '')); } catch { sub = null; }
    const endpoint = sub && String(sub.endpoint || '');
    const p256dh = sub && sub.keys && String(sub.keys.p256dh || '');
    const auth = sub && sub.keys && String(sub.keys.auth || '');
    if (!endpoint || endpoint.length > 1000 || !allowedEndpoint(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,40}$/.test(auth)) {
      return json({ ok: false, error: 'This phone’s notification details weren’t accepted.' }, 400);
    }
    const label = String(f.label || '').slice(0, 80);
    await env.DB.prepare(`INSERT INTO push_subscriptions (who, label, endpoint, p256dh, auth) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(endpoint) DO UPDATE SET who = excluded.who, label = excluded.label, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0, last_error = ''`)
      .bind(whoKey(admin), `${me}: ${label}`.slice(0, 120), endpoint, p256dh, auth).run();
    await data.audit(env, 'chat.push-on', `Chat notifications switched on for ${me}`).run();
    return json({ ok: true });
  }
  if (path === '/admin/chat/push/test' && method === 'POST') {
    const { results } = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE who = ?1').bind(whoKey(admin)).all();
    if (!(results || []).length) return redirect('/admin/chat?flash=no-phone');
    const subject = siteOrigin(request, env).startsWith('https://') ? siteOrigin(request, env) : 'https://newwaysmediumshipdevelopmentcentre.com';
    let ok = 0, bad = 0;
    for (const sub of results) {
      const r = await sendPush(env, sub, { title: 'New Way’s live chat', body: 'Test notification: notifications are working on this phone.', url: '/admin/chat', tag: 'chat-test' }, subject);
      if (r.ok) { ok++; await env.DB.prepare(`UPDATE push_subscriptions SET last_ok_at = ?1, failures = 0, last_error = '' WHERE id = ?2`).bind(new Date().toISOString(), sub.id).run(); }
      else { bad++; if (r.gone) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(sub.id).run(); else await env.DB.prepare('UPDATE push_subscriptions SET failures = failures + 1, last_error = ?1 WHERE id = ?2').bind(`answered ${r.status}`, sub.id).run(); }
    }
    return redirect(`/admin/chat?flash=${ok ? 'test-sent' : 'test-failed'}`);
  }
  const pm = path.match(/^\/admin\/chat\/push\/(\d{1,9})\/remove$/);
  if (pm && method === 'POST') {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(Number(pm[1])).run();
    return redirect('/admin/chat?flash=push-removed');
  }

  // ----- one conversation -----
  const m = path.match(/^\/admin\/chat\/(\d{1,9})(?:\/(messages|reply|close|reopen|block|delete))?$/);
  if (!m) return null;
  const session = await env.DB.prepare('SELECT * FROM chat_sessions WHERE id = ?1').bind(Number(m[1])).first();
  if (!session) return redirect('/admin/chat?flash=gone');
  const back = (flash) => redirect(`/admin/chat/${session.id}?flash=${flash}`);
  if (!m[2]) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    if (session.staff_unread) await env.DB.prepare('UPDATE chat_sessions SET staff_unread = 0 WHERE id = ?1').bind(session.id).run();
    const [settings, list] = await Promise.all([c.chatSettings(env), c.messages(env, session.id, 0, 1000)]);
    return page(view.conversationPage({ session, messages: list, settings, csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }
  if (m[2] === 'messages' && method === 'GET') {
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    const list = await c.messages(env, session.id, after);
    if (list.some((x) => x.sender === 'visitor')) await env.DB.prepare('UPDATE chat_sessions SET staff_unread = 0 WHERE id = ?1').bind(session.id).run();
    return json({ messages: list.map((x) => ({ id: x.id, from: x.sender, name: x.staff_name, body: x.body, at: x.created_at })) });
  }
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  if (m[2] === 'reply') {
    const body = c.cleanBody(f.body);
    if (!body) return back('empty');
    if (body.length > 2000) return back('too-long');
    const settings = await c.chatSettings(env);
    await c.addMessage(env, session, 'staff', body, f.as_me === '1' ? me : settings.chat_staff_name);
    if (session.status !== 'open') await env.DB.prepare(`UPDATE chat_sessions SET status = 'open' WHERE id = ?1 AND status = 'closed'`).bind(session.id).run();
    if (f.ajax === '1') return json({ ok: true });
    return back('sent');
  }
  if (m[2] === 'close' || m[2] === 'reopen' || m[2] === 'block') {
    const status = m[2] === 'close' ? 'closed' : m[2] === 'block' ? 'blocked' : 'open';
    await env.DB.batch([env.DB.prepare('UPDATE chat_sessions SET status = ?1, staff_unread = 0 WHERE id = ?2').bind(status, session.id),
      data.audit(env, 'chat.' + m[2], `Chat ${session.id} ${status} by ${me}`)]);
    return m[2] === 'close' ? redirect('/admin/chat?flash=closed') : back(m[2] === 'block' ? 'blocked' : 'reopened');
  }
  if (m[2] === 'delete') {
    await env.DB.batch([env.DB.prepare('DELETE FROM chat_messages WHERE session_id = ?1').bind(session.id), env.DB.prepare('DELETE FROM chat_sessions WHERE id = ?1').bind(session.id),
      data.audit(env, 'chat.delete', `Chat ${session.id} deleted by ${me}`)]);
    return redirect('/admin/chat?flash=deleted');
  }
  return null;
}
