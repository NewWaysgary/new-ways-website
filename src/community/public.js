// New Way's Community: the public pages and everything visitors can do there (no accounts, no sign-in, no cookies).
//   GET  /community                         the Community page: welcome panel and the published cards   (launch on)
//   GET  /community/12-thank-you-jane       one card with its reactions and comments
//   POST /community/12/react                Like, Love or Thank You                                     (launch on)
//   POST /community/12/comment              a comment or reply (Turnstile, rate limits, all the Stage 4 checks)
//   POST /community/comment/5/like          like a comment
//   POST /community/comment/5/report        report a comment (3 different visitors hide it pending review)
//   GET  /community/push/key, POST /community/push/(subscribe|unsubscribe|status)   Wednesday notifications
//   GET  /community/12/socket               live comments (a connection to the Durable Object; see live.js)
//   GET  /community/12/live?v=7             "have I missed anything?" for live comments
//
// The launch switch (Admin › Community launch) decides what is open: 'off' = nothing at all (pages, card links and
// every request below answer 'not found' or 'not open'); 'testing' = everything works but it is not in the menu or sitemap and Google is asked not to
// list it; 'live' = in the menu and sitemap too.
import { htmlResponse, textResponse, redirect, siteOrigin } from '../lib/http.js';
import { allow } from '../lib/ratelimit.js';
import { turnstileConfig, verifyTurnstile, formStamp, stampAge } from '../lib/turnstile.js';
import { page } from '../views/layout.js';
import * as pub from '../views/public.js';
import * as view from '../views/community-public.js';
import { getPublishedPost, postPath } from './model.js';
import { launchState, getConfig, OFFICIAL_NAMES } from './config.js';
import { publicSocket, liveCheck, liveChanged, liveState } from './live.js';
import { alertNewComment } from './alerts.js';
import { visitorKey, networkKey, screenComment, reportComment } from './comments.js';
import { MAX_COMMENT, MAX_NAME } from './moderation.js';
import { countVisit } from './stats.js';
import { wordsOf } from './render.js';
import * as push from './push.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const REACTIONS = ['like', 'love', 'thanks'];
const MAX_BODY = 16_000;

async function readLimited(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

export async function handleCommunityRoutes(request, env, url, method, path, wctx) {
  // ---------- pages ----------
  if (method === 'GET' && (path === '/community' || /^\/community\/\d{1,9}(?:-[a-z0-9-]{0,90})?$/.test(path))) {
    const state = await launchState(env);
    const ctx = await pub.pageContext(request, env);
    const robots = state === 'live' ? {} : { 'X-Robots-Tag': 'noindex, nofollow' };
    // Off: nothing of the Community is public, not even a card's own link (Admin previews are under /admin)
    if (state === 'off') return htmlResponse(await pub.notFoundPage(ctx), { status: 404, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
    if (path === '/community') {
      const posts = await listPublished(env);
      await countVisit(env, request, url, 0);
      return htmlResponse(listPage(ctx, request, env, posts, state), { headers: robots });
    }
    const id = Number(path.match(/^\/community\/(\d+)/)[1]);
    const post = await getPublishedPost(env, id);
    if (!post) return htmlResponse(await pub.notFoundPage(ctx), { status: 404, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
    if (path !== postPath(post)) return redirect(postPath(post) + url.search, 301);
    const [extra, config] = await Promise.all([postExtras(env, post.id), getConfig(env)]);
    await countVisit(env, request, url, post.id);
    return htmlResponse(await postPage(ctx, post, request, env, { state, extra, live: liveState(config) }), { headers: robots });
  }

  // ---------- live comments ----------
  const lm = method === 'GET' && path.match(/^\/community\/(\d{1,9})\/(socket|live)$/);
  if (lm) {
    const config = await getConfig(env);
    if (config.launch === 'off') return json({ ok: false }, 404);
    const post = await getPublishedPost(env, Number(lm[1]));
    if (!post) return json({ ok: false, mode: 'gone' }, 404);
    if (lm[2] === 'socket') return publicSocket(env, request, post, config, wctx);
    return liveCheck(env, request, url, post, config, async (p) => {
      const extra = await postExtras(env, p.id);
      return { counts: extra.counts, total: extra.total, html: String(view.renderConversation(extra)) };
    });
  }

  // ---------- notifications (allowed whenever the Community is open) ----------
  if (path === '/community/push/key' && method === 'GET') {
    if ((await launchState(env)) === 'off') return json({ ok: false }, 404);
    return json({ ok: true, key: await push.publicKey(env) });
  }

  const pm = path.match(/^\/community\/(?:(\d{1,9})\/(react|comment)|comment\/(\d{1,9})\/(like|report)|push\/(subscribe|unsubscribe|status))$/);
  if (!pm) return null;
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  // Only from this website's own pages
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return json({ ok: false, message: 'Please try again from the Community page.' }, 403);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json({ ok: false, message: 'That was too long.' }, 413);
  if ((await launchState(env)) === 'off') return json({ ok: false, message: 'New Way’s Community isn’t open yet.' }, 403);

  // Only small plain forms or JSON are accepted (never files), and the size is checked while reading, so a request
  // without a Content-Length can't send more either.
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/json') && !type.startsWith('application/x-www-form-urlencoded')) return json({ ok: false, message: 'Please try again.' }, 415);
  const raw = await readLimited(request, MAX_BODY);
  if (raw === null) return json({ ok: false, message: 'That was too long.' }, 413);
  let f = {};
  try {
    if (type.startsWith('application/json')) f = JSON.parse(raw || '{}');
    else for (const [k, v] of new URLSearchParams(raw)) f[k] = v;
  } catch { return json({ ok: false, message: 'Please try again.' }, 400); }
  if (!f || typeof f !== 'object' || Array.isArray(f)) f = {};
  for (const k of Object.keys(f)) if (typeof f[k] !== 'string' && k !== 'subscription') f[k] = '';
  const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
  const vid = await visitorKey(env, request, String(f.vid || ''));

  if (pm[5]) return pushRoute(env, request, pm[5], f);
  if (pm[2] === 'react') return react(env, request, Number(pm[1]), String(f.kind || ''), vid, wctx);
  if (pm[2] === 'comment') return comment(env, request, url, Number(pm[1]), f, vid, wantsJson, wctx);
  if (pm[4] === 'like') return likeComment(env, request, Number(pm[3]), vid, wctx);
  if (pm[4] === 'report') return report(env, request, Number(pm[3]), vid, wctx);
  return null;
}

// ---------- reading ----------
async function listPublished(env) {
  const { results } = await env.DB.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id AND c.status = 'published') AS comment_count,
      (SELECT COUNT(*) FROM community_reactions r WHERE r.post_id = p.id) AS reaction_count
    FROM community_posts p WHERE p.status = 'published' ORDER BY p.published_at DESC, p.id DESC LIMIT 60`).all();
  return results || [];
}

export async function postExtras(env, postId) {
  const [reactions, comments] = await Promise.all([
    env.DB.prepare('SELECT kind, COUNT(*) AS n FROM community_reactions WHERE post_id = ?1 GROUP BY kind').bind(postId).all(),
    env.DB.prepare(`SELECT id, parent_id, reply_to_id, name, body, official, like_count, created_at FROM community_comments WHERE post_id = ?1 AND status = 'published' ORDER BY id LIMIT 500`).bind(postId).all()
  ]);
  const counts = { like: 0, love: 0, thanks: 0 };
  for (const r of reactions.results || []) counts[r.kind] = r.n;
  const all = comments.results || [];
  const byId = new Map(all.map((c) => [c.id, c]));
  const top = all.filter((c) => !c.parent_id);
  // Replies stay in their conversation, oldest first; a reply to a reply says who it answers
  const replies = (id) => all.filter((c) => c.parent_id === id).map((r) => ({ ...r, replyToName: r.reply_to_id && r.reply_to_id !== id ? shownName(byId.get(r.reply_to_id)) : '' }));
  const list = top.map((c) => ({ ...c, replies: replies(c.id) }));
  return { counts, comments: list, total: list.reduce((n, c) => n + 1 + c.replies.length, 0) };
}
export const shownName = (c) => (c ? (c.official && OFFICIAL_NAMES[c.official]) || c.name : '');

// Where a reply goes: a reply to a reply joins the same conversation (under the first comment) and remembers which
// reply it answers. Returns null if the comment can't be replied to.
export async function replyTarget(env, postId, id) {
  const c = await env.DB.prepare(`SELECT id, parent_id, name, official FROM community_comments WHERE id = ?1 AND post_id = ?2 AND status = 'published'`).bind(id, postId).first();
  if (!c) return null;
  if (!c.parent_id) return { parentId: c.id, replyToId: null, replyToName: '' };
  const top = await env.DB.prepare(`SELECT id FROM community_comments WHERE id = ?1 AND status = 'published'`).bind(c.parent_id).first();
  return top ? { parentId: top.id, replyToId: c.id, replyToName: shownName(c) } : null;
}

// ---------- pages ----------
function listPage(ctx, request, env, posts, state) {
  const origin = siteOrigin(request, env);
  const body = view.listBody({ posts, ctx, request, state });
  return page(ctx, { route: 'community', title: 'New Way’s Community', description: 'Thank-you cards for our Wednesday guest mediums at New Way’s, Dundee. Share your thanks, react and leave a friendly comment.',
    body, canonicalPath: '/community', noindex: state !== 'live', og: { title: 'New Way’s Community', url: origin + '/community' } });
}

export async function postPage(ctx, post, request, env, { state = 'off', extra = null, live = 'normal' } = {}) {
  const origin = siteOrigin(request, env);
  const title = post.title || (post.medium_name ? `Thank you, ${post.medium_name}` : 'Thank you');
  const wording = wordsOf(post);
  const description = (wording || title).slice(0, 200);
  const cfg = turnstileConfig(request, env);
  const body = view.postBody({ post, ctx, request, state, extra, live, turnstile: cfg, stamp: cfg ? await formStamp(cfg) : '' });
  return page(ctx, {
    route: 'community', title, description, body, canonicalPath: postPath(post), noindex: state !== 'live',
    og: post.share_key
      ? { title, description, image: `${origin}/media/${post.share_key}`, imageWidth: 1200, imageHeight: 630, imageType: 'image/jpeg', imageAlt: wording || title }
      : { title, description }
  });
}

// ---------- reactions ----------
async function react(env, request, postId, kind, vid, wctx) {
  if (!REACTIONS.includes(kind)) return json({ ok: false, message: 'Please choose Like, Love or Thank You.' }, 400);
  // A connection can react a fair amount overall, but only a few times a day on any one card (a household sharing
  // Wi-Fi is fine), so one person can't pile up reactions by changing their browser code.
  if (!(await allow(env, request, 'nwc-react', 60, 3600)) || !(await allow(env, request, 'nwc-react-' + postId, 15, 86400))) {
    return json({ ok: false, message: 'Please wait a little before reacting again.' }, 429);
  }
  const post = await getPublishedPost(env, postId);
  if (!post) return json({ ok: false, message: 'That card is no longer here.' }, 404);
  // Tapping again takes the reaction away
  const added = await env.DB.prepare('INSERT OR IGNORE INTO community_reactions (post_id, visitor_key, kind) VALUES (?1, ?2, ?3)').bind(postId, vid, kind).run();
  let on = true;
  if (!added.meta || !added.meta.changes) { await env.DB.prepare('DELETE FROM community_reactions WHERE post_id = ?1 AND visitor_key = ?2 AND kind = ?3').bind(postId, vid, kind).run(); on = false; }
  const { counts } = await postExtras(env, postId);
  liveChanged(env, wctx, postId, { kind: 'counts', counts });   // everyone watching sees the new numbers (no database version change)
  return json({ ok: true, on, counts });
}

// ---------- comments and replies ----------
async function comment(env, request, url, postId, f, vid, wantsJson, wctx) {
  const name = String(f.name || '').slice(0, MAX_NAME + 40);
  const text = String(f.text || '').replace(/\r\n?/g, '\n').slice(0, MAX_COMMENT + 200);
  const parentId = /^\d{1,9}$/.test(String(f.parent || '')) ? Number(f.parent) : null;
  const post = await getPublishedPost(env, postId);
  const answer = async (status, data) => {
    if (wantsJson) return json(data, status);
    // Without JavaScript: back to the card, with the visitor's wording kept in the form
    if (!post) return redirect('/community', 303);
    const ctx = await pub.pageContext(request, env);
    const extra = await postExtras(env, post.id);
    const state = await launchState(env);
    const cfg = turnstileConfig(request, env);
    const body = view.postBody({ post, ctx, request, state, extra, turnstile: cfg, stamp: cfg ? await formStamp(cfg) : '', form: { name, text, parent: parentId || '', message: data.message, ok: data.ok, status: data.status } });
    return htmlResponse(page(ctx, { route: 'community', title: post.title || 'Thank you', body, canonicalPath: postPath(post), noindex: true }), { status });
  };
  if (!post) return answer(404, { ok: false, message: 'That card is no longer here.' });
  const cfg = turnstileConfig(request, env);
  if (!cfg) return answer(503, { ok: false, message: 'Comments are closed at the moment. Please try again later.' });
  // Spam programs fill the hidden field or send the form instantly: pretend it worked, keep nothing.
  const age = await stampAge(cfg, f.t);
  if (String(f.website || '').trim() || (age !== null && age < 2500)) return answer(200, { ok: true, status: 'held', message: 'Thank you. Your comment will appear once it has been checked.' });
  if (age === null || age > 6 * 3600_000) return answer(400, { ok: false, message: 'This page has been open a long time. Please refresh the page and try again (copy your comment first).' });
  let target = null;
  if (parentId) {
    target = await replyTarget(env, postId, parentId);
    if (!target) return answer(400, { ok: false, message: 'That comment can no longer be replied to.' });
  }
  if (!(await allow(env, request, 'nwc-comment', 6, 600)) || !(await allow(env, request, 'nwc-comment-day', 30, 86400)) || !(await allow(env, { headers: new Headers() }, 'nwc-comment-all', 400, 3600))) {
    return answer(429, { ok: false, message: 'You’ve posted a lot in a short time. Please wait a few minutes and try again.' });
  }
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return answer(400, { ok: false, message: 'Please complete the quick “I’m human” check, then post again.', retry: true });
  }
  const result = await screenComment(env, { name, text, postId, visitor: vid }, { live: true });
  if (result.verdict === 'block') return answer(422, { ok: false, status: 'blocked', message: result.message });
  const status = result.verdict === 'allow' ? 'published' : 'held';
  const row = await env.DB.prepare(`INSERT INTO community_comments (post_id, parent_id, reply_to_id, name, body, status, reasons, visitor_key, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING *`)
    .bind(postId, target ? target.parentId : null, target ? target.replyToId : null, name.replace(/\s+/g, ' ').trim(), text.trim(), status, JSON.stringify(result.reasons.filter((r) => r.action !== 'allow').map((r) => ({ code: r.code, action: r.action, detail: r.detail }))), vid, result.fingerprint).first();
  const msg = status === 'published' ? 'Thank you, your comment has been posted.' : 'Thank you. Your comment will appear once it has been checked.';
  // Live: everyone watching this card sees a published comment straight away; Gary and Julie are told either way
  const v = status === 'published' ? await liveChanged(env, wctx, postId, { kind: 'add', comment: row, replyToName: target ? target.replyToName : '' })
    : (liveChanged(env, wctx, postId, { kind: 'admin' }), 0);
  const alert = alertNewComment(env, request, post, row, status).catch(() => {});
  if (wctx && wctx.waitUntil) wctx.waitUntil(alert);
  if (!wantsJson) return redirect(postPath(post) + (status === 'published' ? `?posted=1#c${row.id}` : '?held=1#comments'), 303);
  return json({ ok: true, status, id: row.id, message: msg, ...(status === 'published' ? { v, parent: row.parent_id || 0, html: String(view.renderComment(row, target ? target.replyToName : '')) } : {}) });
}

async function likeComment(env, request, commentId, vid, wctx) {
  if (!(await allow(env, request, 'nwc-like', 120, 3600)) || !(await allow(env, request, 'nwc-like-' + commentId, 10, 86400))) {
    return json({ ok: false, message: 'Please wait a little before liking more comments.' }, 429);
  }
  const c = await env.DB.prepare(`SELECT id, post_id FROM community_comments WHERE id = ?1 AND status = 'published'`).bind(commentId).first();
  if (!c) return json({ ok: false, message: 'That comment is no longer here.' }, 404);
  const added = await env.DB.prepare('INSERT OR IGNORE INTO community_comment_likes (comment_id, visitor_key) VALUES (?1, ?2)').bind(commentId, vid).run();
  let on = true;
  if (!added.meta || !added.meta.changes) { await env.DB.prepare('DELETE FROM community_comment_likes WHERE comment_id = ?1 AND visitor_key = ?2').bind(commentId, vid).run(); on = false; }
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM community_comment_likes WHERE comment_id = ?1').bind(commentId).first('n');
  await env.DB.prepare('UPDATE community_comments SET like_count = ?2 WHERE id = ?1').bind(commentId, n).run();
  liveChanged(env, wctx, c.post_id, { kind: 'likes', id: commentId, likes: n });
  return json({ ok: true, on, likes: n });
}

async function report(env, request, commentId, vid, wctx) {
  // Abuse protection: a few reports per hour per connection, one report per visitor per comment, and 3 different
  // visitor codes needed to hide a comment (which never hides an Admin or already-approved comment).
  if (!(await allow(env, request, 'nwc-report', 5, 3600)) || !(await allow(env, request, 'nwc-report-day', 15, 86400))) {
    return json({ ok: false, message: 'Thank you. We’ve had several reports from you recently; please wait before reporting more.' }, 429);
  }
  const r = await reportComment(env, commentId, vid, await networkKey(env, request));
  if (!r.ok && r.reason === 'own-comment') return json({ ok: false, message: 'You can’t report your own comment.' }, 400);
  if (!r.ok) return json({ ok: false, message: 'That comment is no longer here.' }, 404);
  const c = await env.DB.prepare('SELECT * FROM community_comments WHERE id = ?1').bind(commentId).first();
  if (c) {
    if (r.hidden) {
      // Hidden by reports: it (and its replies) disappear for everyone watching; Gary and Julie are asked to look at it
      const ids = [c.id, ...(((await env.DB.prepare('SELECT id FROM community_comments WHERE parent_id = ?1').bind(c.id).all()).results || []).map((x) => x.id))];
      liveChanged(env, wctx, c.post_id, { kind: 'remove', ids });
      const post = await getPublishedPost(env, c.post_id);
      if (post) { const a = alertNewComment(env, request, post, c, 'hidden').catch(() => {}); if (wctx && wctx.waitUntil) wctx.waitUntil(a); }
    } else liveChanged(env, wctx, c.post_id, { kind: 'admin' });
  }
  return json({ ok: true, message: 'Thank you. Gary and Julie will look at this comment.' });
}

// ---------- Wednesday notifications ----------
async function pushRoute(env, request, action, f) {
  if (!(await allow(env, request, 'nwc-push', 20, 3600))) return json({ ok: false, message: 'Please wait a little and try again.' }, 429);
  if (action === 'subscribe') {
    const sub = push.cleanSubscription(f.subscription, env);
    if (!sub) return json({ ok: false, message: 'This phone’s notification details weren’t accepted.' }, 400);
    if (!(await push.isSubscribed(env, sub.endpoint)) && ((await env.DB.prepare('SELECT COUNT(*) AS n FROM community_subscribers').first('n')) || 0) >= push.MAX_SUBSCRIBERS) {
      return json({ ok: false, message: 'Notifications can’t be turned on at the moment. Please try again later.' }, 503);
    }
    await push.subscribe(env, sub);
    return json({ ok: true, subscribed: true, message: 'Wednesday notifications are on.' });
  }
  const endpoint = String(f.endpoint || '').slice(0, 1000);
  if (action === 'unsubscribe') { await push.unsubscribe(env, endpoint); return json({ ok: true, subscribed: false, message: 'Wednesday notifications are off.' }); }
  return json({ ok: true, subscribed: await push.isSubscribed(env, endpoint) });
}
