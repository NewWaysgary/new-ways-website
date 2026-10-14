// New Way's Community live comments: the Worker's side.
//   GET /community/12/socket          a visitor's live connection for card 12 (passed to the Durable Object)
//   GET /community/12/live?v=7&why=   "have I missed anything?" -> { v, mode } or the card's current comments
//   GET /admin/community/12/live-socket   Gary's or Julie's live connection (Admin sign-in checked by the Admin router)
// and liveChanged(), which every change to a published conversation calls so the phones are told straight away.
import { getConfig, liveLimits, setConfig, utcDay } from './config.js';
import { renderComment, renderConversation } from '../views/community-public.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

export function liveAvailable(env) { return !!(env && env.COMMUNITY_LIVE); }
function hub(env) { return env.COMMUNITY_LIVE.get(env.COMMUNITY_LIVE.idFromName('community-live')); }
// A live connection is passed on with the visitor's own request headers (as Cloudflare's examples do), but the two
// headers the Durable Object acts on are always set here, never taken from the visitor.
function connectRequest(request, card, role, config) {
  const url = new URL('https://community-live.internal/connect');
  url.searchParams.set('card', String(card));
  const headers = new Headers(request.headers);
  headers.set('Upgrade', 'websocket');
  headers.set('x-nwc-role', role);
  headers.set('x-nwc-limits', JSON.stringify(liveLimits(config)));
  return new Request(url, { method: 'GET', headers });
}
function hubRequest(path, limits, init = {}) {
  return new Request('https://community-live.internal' + path, { ...init, headers: { ...(init.headers || {}), 'x-nwc-limits': JSON.stringify(limits) } });
}

// What a visitor's page should do right now: 'normal', 'reduced', 'paused' (today's allowance used) or 'off'
export function liveState(config) {
  const limits = liveLimits(config);
  if (!limits.enabled) return 'off';
  return config.live_paused_day === utcDay() ? 'paused' : 'normal';
}

// ---------- a visitor's live connection ----------
export async function publicSocket(env, request, post, config, ctx) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ ok: false }, 426);
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return json({ ok: false }, 403);
  if (!liveAvailable(env)) return json({ ok: false, state: 'off' }, 503);
  const state = liveState(config);
  if (state !== 'normal') return json({ ok: false, state }, 503);   // paused or off: not even passed on (saves a request)
  const res = await hub(env).fetch(connectRequest(request, post.id, 'public', config));
  if (res.headers.get('x-nwc-state') === 'paused' && config.live_paused_day !== utcDay()) {
    // The first refusal today: remember it (so further attempts don't reach the Durable Object) and tell Gary and Julie
    await setConfig(env, 'live_paused_day', utcDay(), 'automatic safety limit').run();
    const { alertSafety } = await import('./alerts.js');
    const job = alertSafety(env, request).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  }
  return res;
}

// ---------- Gary's or Julie's live connection (the Admin router has already checked the sign-in) ----------
export async function adminSocket(env, request, postId) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ ok: false }, 426);
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return json({ ok: false }, 403);   // no other website can open it with Admin's sign-in
  if (!liveAvailable(env)) return json({ ok: false, state: 'off' }, 503);
  return hub(env).fetch(connectRequest(request, postId, 'admin', await getConfig(env)));
}

// ---------- "have I missed anything?" ----------
// why=catchup (after connecting or coming back to the page; not counted), fallback (a phone that can't connect live;
// counted and limited), manual (the Refresh comments button; counted and limited)
export async function liveCheck(env, request, url, post, config, render) {
  const why = ['fallback', 'manual'].includes(url.searchParams.get('why')) ? url.searchParams.get('why') : 'catchup';
  const have = Number(url.searchParams.get('v'));
  let mode = liveState(config);
  let fallback = liveLimits(config).fallbackSecs;
  if (why !== 'catchup') {
    if (!liveAvailable(env) || mode === 'off') return json({ ok: true, mode: 'off' });
    try {
      const r = await (await hub(env).fetch(hubRequest('/check?kind=' + why, liveLimits(config)))).json();
      if (!r.allowed) return json({ ok: true, mode: 'paused' });
      if (mode !== 'paused') mode = r.mode; fallback = r.fallback || fallback;
    } catch {
      if (why === 'fallback') return json({ ok: true, mode: 'paused' });   // can't count it: don't risk it
    }
  }
  const v = (await env.DB.prepare('SELECT live_version FROM community_posts WHERE id = ?1').bind(post.id).first('live_version')) || 0;
  if (Number.isFinite(have) && have === v && url.searchParams.has('v')) return json({ ok: true, v, mode, fallback });
  // Everyone who missed the same change gets the same answer, kept briefly at Cloudflare's edge (saves database reads)
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = new Request(new URL(request.url).origin + `/__nwc-live/${post.id}/${v}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) { const body = await hit.json(); return json({ ...body, mode, fallback }); }
  }
  const snap = await render(post);
  const body = { ok: true, v, counts: snap.counts, total: snap.total, html: snap.html };
  if (cache) await cache.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } })).catch(() => {});
  return json({ ...body, mode, fallback });
}

// ---------- telling the phones about a change ----------
// kind: 'add' (a new comment or reply published), 'remove' (hidden, deleted), 'reload' (anything more complicated,
// such as a comment restored with its replies: phones fetch the conversation again), 'counts' (reactions),
// 'likes', 'gone' (the card was unpublished), 'admin' (only Admin needs to know, e.g. a comment held for review).
// Conversation changes move the card's live_version on by one, so phones can tell if they missed anything.
export async function liveChanged(env, ctx, postId, change) {
  const job = (async () => {
    let v = 0;
    const events = [];
    if (change.kind === 'add' || change.kind === 'remove' || change.kind === 'reload') {
      v = (await env.DB.prepare('UPDATE community_posts SET live_version = live_version + 1 WHERE id = ?1 RETURNING live_version').bind(postId).first('live_version')) || 0;
      if (change.kind === 'add' && change.comment) events.push({ op: 'add', v, id: change.comment.id, parent: change.comment.parent_id || 0, html: String(renderComment(change.comment, change.replyToName || '')) });
      if (change.kind === 'remove') events.push({ op: 'remove', v, ids: change.ids });
      if (change.kind === 'reload') events.push({ op: 'reload', v });
    }
    if (change.kind === 'counts') events.push({ op: 'counts', counts: change.counts });
    if (change.kind === 'likes') events.push({ op: 'likes', id: change.id, likes: change.likes });
    if (change.kind === 'gone') events.push({ op: 'gone' });
    if (!liveAvailable(env)) return v;
    const config = await getConfig(env);
    await hub(env).fetch(hubRequest('/broadcast', liveLimits(config), { method: 'POST', body: JSON.stringify({ card: postId, v, events, admin: true }) }));
    return v;
  })().catch((err) => { console.error("New Way's: live update not sent:", err && err.message); return 0; });
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  return job;
}

export async function liveUsage(env) {
  if (!liveAvailable(env)) return null;
  try {
    const config = await getConfig(env);
    return await (await hub(env).fetch(hubRequest('/usage', liveLimits(config)))).json();
  } catch { return null; }
}

export { renderConversation };
