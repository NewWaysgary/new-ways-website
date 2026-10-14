// New Way's Community: phone notifications for Gary and Julie about new comments (no email).
// They use the Admin phones already set up for live chat notifications (Admin › Live chat › notifications on this
// phone): free browser notifications, no outside service. Each person chooses separately (Admin › Community launch):
//   all     every new public comment or reply, plus anything needing review
//   review  only comments held or hidden for review
//   off     nothing
// and whether the commenter's name and words show on the lock screen.
//
// No duplicates and no buzzing for every message: each comment is only ever notified once, and for each card a person
// gets at most one notification every 2 minutes. Comments arriving in between are counted and sent as one summary
// ("3 more comments on …") as soon as the 2 minutes are up and something else happens on the website, or by the hourly
// job at the latest. Notifications for the same card replace each other on the phone instead of piling up.
import { sendPush } from '../lib/webpush.js';
import { siteOrigin } from '../lib/http.js';
import { getConfig, setConfig, utcDay } from './config.js';

const GAP_MS = 120_000;
const now = () => new Date().toISOString();
const short = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export async function getPrefs(env, who) {
  const row = await env.DB.prepare('SELECT mode, show_text FROM community_admin_prefs WHERE who = ?1').bind(who).first().catch(() => null);
  return { mode: row ? row.mode : 'all', showText: row ? row.show_text === 1 : true };
}
export async function setPrefs(env, who, mode, showText) {
  await env.DB.prepare(`INSERT INTO community_admin_prefs (who, mode, show_text, updated_at) VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(who) DO UPDATE SET mode = excluded.mode, show_text = excluded.show_text, updated_at = excluded.updated_at`).bind(who, mode, showText ? 1 : 0).run();
}

// Everyone with an Admin phone signed up (Gary = 'owner'; full Admins such as Julie = 'admin:<id>', only while active)
async function recipients(env) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT s.who, p.mode, p.show_text FROM push_subscriptions s
    LEFT JOIN community_admin_prefs p ON p.who = s.who
    WHERE s.who = 'owner' OR EXISTS (SELECT 1 FROM admin_users a WHERE 'admin:' || a.id = s.who AND a.active = 1)`).all();
  return (results || []).map((r) => ({ who: r.who, mode: r.mode || 'all', showText: r.show_text === null || r.show_text === undefined ? true : r.show_text === 1 }));
}

async function sendTo(env, who, payload, origin) {
  const { results } = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE who = ?1').bind(who).all();
  const subject = origin.startsWith('https://') ? origin : 'https://newwaysmediumshipdevelopmentcentre.com';
  let sent = 0;
  for (const sub of results || []) {
    const r = await sendPush(env, sub, payload, subject);
    if (r.ok) { sent++; await env.DB.prepare(`UPDATE push_subscriptions SET last_ok_at = ?1, failures = 0, last_error = '' WHERE id = ?2`).bind(now(), sub.id).run(); }
    else if (r.gone) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(sub.id).run();
    else await env.DB.prepare('UPDATE push_subscriptions SET failures = failures + 1, last_error = ?1 WHERE id = ?2').bind(`answered ${r.status}`, sub.id).run();
  }
  return sent;
}

function originOf(env, request) {
  if (request) return siteOrigin(request, env);
  try { return new URL(env.SITE_URL).origin; } catch { return 'https://newwaysmediumshipdevelopmentcentre.com'; }
}

// A new comment or reply (status 'published'), one held for review ('held'), or one hidden by visitors' reports ('hidden').
// Official comments by Gary or Julie never notify anyone.
export async function alertNewComment(env, request, post, comment, status) {
  if (!comment || comment.official) return;
  const origin = originOf(env, request);
  await flushAlerts(env, origin).catch(() => {});
  const review = status !== 'published';
  const key = review ? 0 : post.id;     // review alerts are grouped together, comments per card
  const card = short(post.title || 'Thank-you card', 50);
  for (const r of await recipients(env)) {
    if (r.mode === 'off' || (r.mode === 'review' && !review)) continue;
    const st = await env.DB.prepare('SELECT * FROM community_alerts WHERE who = ?1 AND post_id = ?2').bind(r.who, key).first();
    if (st && comment.id <= st.last_comment_id) continue;   // already notified (no duplicates)
    const recent = st && st.last_sent_at && Date.now() - Date.parse(st.last_sent_at) < GAP_MS;
    if (recent) {
      await env.DB.prepare('UPDATE community_alerts SET pending = pending + 1, last_comment_id = ?3 WHERE who = ?1 AND post_id = ?2').bind(r.who, key, comment.id).run();
      continue;
    }
    const words = r.showText ? `${short(comment.name, 30)}: “${short(comment.body, 90)}”` : '';
    const payload = review
      ? { title: status === 'hidden' ? 'Comment hidden after reports' : 'Comment waiting for review', body: `${card}${words ? ' · ' + words : ''}`, url: `/admin/community/${post.id}/view#review`, tag: 'nwc-review' }
      : { title: comment.parent_id ? `New reply · ${card}` : `New comment · ${card}`, body: words || 'Tap to see the conversation.', url: `/admin/community/${post.id}/view#c${comment.id}`, tag: 'nwc-' + post.id };
    await env.DB.prepare(`INSERT INTO community_alerts (who, post_id, last_sent_at, last_comment_id, pending) VALUES (?1, ?2, ?3, ?4, 0)
      ON CONFLICT(who, post_id) DO UPDATE SET last_sent_at = excluded.last_sent_at, last_comment_id = excluded.last_comment_id, pending = 0`).bind(r.who, key, now(), comment.id).run();
    await sendTo(env, r.who, payload, origin);
  }
}

// Sends the "N more comments" summaries whose 2 minutes are up (called whenever a comment arrives, and hourly)
export async function flushAlerts(env, origin = originOf(env, null)) {
  const cutoff = new Date(Date.now() - GAP_MS).toISOString();
  const { results } = await env.DB.prepare(`SELECT a.*, p.title FROM community_alerts a LEFT JOIN community_posts p ON p.id = a.post_id
    WHERE a.pending > 0 AND a.last_sent_at < ?1 LIMIT 20`).bind(cutoff).all();
  for (const a of results || []) {
    await env.DB.prepare(`UPDATE community_alerts SET pending = 0, last_sent_at = ?3 WHERE who = ?1 AND post_id = ?2`).bind(a.who, a.post_id, now()).run();
    const prefs = await getPrefs(env, a.who);
    if (prefs.mode === 'off' || (prefs.mode === 'review' && a.post_id !== 0)) continue;
    const payload = a.post_id === 0
      ? { title: 'Comments waiting for review', body: `${a.pending} more comment${a.pending === 1 ? '' : 's'} to look at.`, url: '/admin/community/moderation', tag: 'nwc-review' }
      : { title: `${a.pending} more comment${a.pending === 1 ? '' : 's'}`, body: short(a.title || 'Thank-you card', 60), url: `/admin/community/${a.post_id}/view#conversation`, tag: 'nwc-' + a.post_id };
    await sendTo(env, a.who, payload, origin);
  }
}

// Opening View Live Comments for a card counts as having seen it: nothing more is summed up for it
export async function markSeen(env, who, postId) {
  await env.DB.prepare('UPDATE community_alerts SET pending = 0 WHERE who = ?1 AND post_id = ?2 AND pending > 0').bind(who, postId).run();
}

// Once a day at most: the Community's live-updates safety limit has been reached
export async function alertSafety(env, request) {
  const config = await getConfig(env);
  if (config.live_alerted_day === utcDay()) return;
  await setConfig(env, 'live_alerted_day', utcDay(), 'automatic safety limit').run();
  const origin = originOf(env, request);
  for (const r of await recipients(env)) {
    if (r.mode === 'off') continue;
    await sendTo(env, r.who, { title: 'Community live updates paused', body: 'Today’s safety limit was reached. Cards and comments still work; live updates start again at midnight UTC (1am in British Summer Time).', url: '/admin/community/launch#live', tag: 'nwc-safety' }, origin);
  }
}
