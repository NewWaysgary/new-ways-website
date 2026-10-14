// New Way's Community: Wednesday notifications. Completely separate from Admin's live-chat notifications: their own
// list of phones (community_subscribers), their own sending, and a phone that turns them off is only taken off THIS list
// (the phone's notification permission is left alone, because Admin chat notifications on Gary's or Julie's phone
// may use it too).
// Nothing is ever sent automatically: only when Gary or Julie press Send notification for a published card.
import { sendPush, allowedEndpoint, vapidKeys } from '../lib/webpush.js';
import { siteOrigin } from '../lib/http.js';

export async function publicKey(env) {
  return (await vapidKeys(env)).publicKey;
}

export const MAX_SUBSCRIBERS = 20000;   // far more than New Way's needs; stops anyone filling the list with fakes

// Only the real browser notification services are accepted (Google, Mozilla, Microsoft, Apple). The local test copy
// also accepts its own stand-in on localhost; the live website never does.
export function cleanSubscription(input, env = {}) {
  const sub = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  const endpoint = sub && String(sub.endpoint || '');
  if (endpoint && /^http:/i.test(endpoint) && !/^http:\/\/localhost(:\d+)?$/.test(String(env.SITE_URL || '').replace(/\/$/, ''))) return null;
  const p256dh = sub && sub.keys && String(sub.keys.p256dh || '');
  const auth = sub && sub.keys && String(sub.keys.auth || '');
  if (!endpoint || endpoint.length > 1000 || !allowedEndpoint(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,40}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

export async function subscribe(env, sub) {
  await env.DB.prepare(`INSERT INTO community_subscribers (endpoint, p256dh, auth) VALUES (?1, ?2, ?3)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, failures = 0, last_error = ''`).bind(sub.endpoint, sub.p256dh, sub.auth).run();
}
export async function unsubscribe(env, endpoint) {
  await env.DB.prepare('DELETE FROM community_subscribers WHERE endpoint = ?1').bind(String(endpoint || '')).run();
}
export async function isSubscribed(env, endpoint) {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM community_subscribers WHERE endpoint = ?1').bind(String(endpoint || '')).first());
}

// ---------- sending (Admin) ----------
// Starting a send makes one row per phone. The database refuses a second send for the same card.
export async function startSend(env, post, who, path) {
  const title = 'New Way’s Community';
  const body = String(post.title || 'A new Wednesday thank-you card').slice(0, 120);
  try {
    const row = await env.DB.prepare(`INSERT INTO community_sends (post_id, title, body, url, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`)
      .bind(post.id, title, body, path, who).first();
    await env.DB.prepare(`INSERT OR IGNORE INTO community_deliveries (send_id, subscriber_id) SELECT ?1, id FROM community_subscribers`).bind(row.id).run();
    return { ok: true, id: row.id };
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) return { ok: false, already: true };
    throw err;
  }
}

export async function sendStatus(env, postId) {
  const send = await env.DB.prepare('SELECT * FROM community_sends WHERE post_id = ?1').bind(postId).first();
  if (!send) return null;
  const { results } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM community_deliveries WHERE send_id = ?1 GROUP BY status').bind(send.id).all();
  const counts = { pending: 0, sending: 0, sent: 0, failed: 0, gone: 0 };
  for (const r of results || []) counts[r.status] = r.n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { send, counts, total, done: counts.pending === 0 };
}

// Sends one small batch (well inside Cloudflare's free limit of 50 outside requests per visit). Each phone is marked
// 'sending' BEFORE its notification goes, so if anything is interrupted that phone is never sent the same thing twice.
export const BATCH = 10;
export async function sendBatch(env, request, sendId) {
  const send = await env.DB.prepare('SELECT * FROM community_sends WHERE id = ?1').bind(sendId).first();
  if (!send) return { ok: false };
  const { results } = await env.DB.prepare(`SELECT d.subscriber_id, s.endpoint, s.p256dh, s.auth FROM community_deliveries d JOIN community_subscribers s ON s.id = d.subscriber_id
    WHERE d.send_id = ?1 AND d.status = 'pending' LIMIT ?2`).bind(sendId, BATCH).all();
  const list = results || [];
  // also pending phones that have since turned notifications off: nothing to send
  await env.DB.prepare(`UPDATE community_deliveries SET status = 'gone', detail = 'turned off', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE send_id = ?1 AND status = 'pending' AND subscriber_id NOT IN (SELECT id FROM community_subscribers)`).bind(sendId).run();
  if (list.length) {
    await env.DB.batch(list.map((d) => env.DB.prepare(`UPDATE community_deliveries SET status = 'sending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE send_id = ?1 AND subscriber_id = ?2 AND status = 'pending'`).bind(sendId, d.subscriber_id)));
  }
  const origin = siteOrigin(request, env);
  const subject = origin.startsWith('https://') ? origin : 'https://newwaysmediumshipdevelopmentcentre.com';
  for (const d of list) {
    const r = await sendPush(env, d, { title: send.title, body: send.body, url: send.url, tag: 'community-' + send.post_id }, subject);
    const status = r.ok ? 'sent' : r.gone ? 'gone' : 'failed';
    const statements = [env.DB.prepare(`UPDATE community_deliveries SET status = ?3, detail = ?4, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE send_id = ?1 AND subscriber_id = ?2`)
      .bind(sendId, d.subscriber_id, status, r.ok ? '' : `answered ${r.status}${r.error ? ': ' + r.error : ''}`.slice(0, 120))];
    if (r.ok) statements.push(env.DB.prepare(`UPDATE community_subscribers SET last_ok_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), failures = 0, last_error = '' WHERE id = ?1`).bind(d.subscriber_id));
    else if (r.gone) statements.push(env.DB.prepare('DELETE FROM community_subscribers WHERE id = ?1').bind(d.subscriber_id));
    else statements.push(env.DB.prepare('UPDATE community_subscribers SET failures = failures + 1, last_error = ?2 WHERE id = ?1').bind(d.subscriber_id, `answered ${r.status}`));
    await env.DB.batch(statements);
  }
  const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM community_deliveries WHERE send_id = ?1 AND status = 'pending'`).bind(sendId).first('n');
  if (!left) await env.DB.prepare(`UPDATE community_sends SET finished_at = COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?1`).bind(sendId).run();
  return { ok: true, sentNow: list.length, left };
}

// The hourly job finishes any send that was interrupted (for example if the Admin phone was closed part-way).
export async function finishUnfinishedSends(env) {
  const { results } = await env.DB.prepare('SELECT id FROM community_sends WHERE finished_at IS NULL ORDER BY id LIMIT 3').all();
  const fake = new Request(String(env.SITE_URL || 'https://newwaysmediumshipdevelopmentcentre.com'));
  for (const s of results || []) await sendBatch(env, fake, s.id);
}
