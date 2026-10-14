// Admin › Community launch, official commenting, statistics, the Admin Community view and Wednesday notifications.
// Gary and Julie only (check-in helpers never reach these). Every change needs the Admin sign-in and CSRF check.
import { textResponse, redirect, siteOrigin, htmlResponse } from '../lib/http.js';
import * as data from '../lib/data.js';
import * as view from '../views/admin-community-launch.js';
import { getConfig, setConfig, officialIdentity, OFFICIAL_NAMES, LAUNCH_STATES, LIVE_RANGES, utcDay } from '../community/config.js';
import { adminSocket, liveChanged, liveUsage, liveAvailable } from '../community/live.js';
import { getPrefs, setPrefs, markSeen } from '../community/alerts.js';
import { replyTarget } from '../community/public.js';
import { statsSummary } from '../community/stats.js';
import { postExtras } from '../community/public.js';
import { getPost, postPath } from '../community/model.js';
import * as push from '../community/push.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function handleCommunityLaunchAdmin({ request, env, url, method, path, form, page, csrf, admin }) {
  const mine = ['/admin/community/launch', '/admin/community/stats', '/admin/community/live', '/admin/community/go', '/admin/community/alerts', '/admin/community/live-settings', '/admin/community/live-resume'].includes(path) ||
    /^\/admin\/community\/official\//.test(path) || /^\/admin\/community\/\d{1,9}\/(view|official-comment|notify|notify\/batch|live-socket)$/.test(path);
  if (!mine) return null;
  if (admin.role !== 'owner' && admin.role !== 'admin') return textResponse('Not allowed.', { status: 403 });
  const who = admin.name || admin.email || 'Admin';
  const whoKey = admin.role === 'owner' ? 'owner' : 'admin:' + admin.adminUserId;   // the same as the Admin phone list
  const me = await officialIdentity(env, admin);
  const flash = url.searchParams.get('flash');
  const subscribers = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM community_subscribers').first('n')) || 0;

  // ---------- View Live Comments: the most recent card, or the card chosen in the switcher ----------
  if (path === '/admin/community/live' || path === '/admin/community/go') {
    const id = Number(url.searchParams.get('id')) || (await env.DB.prepare(`SELECT id FROM community_posts WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 1`).first('id'));
    return redirect(id ? `/admin/community/${id}/view` : '/admin/community');
  }

  // ---------- each person's own Community notification choices ----------
  if (path === '/admin/community/alerts') {
    if (method !== 'POST') return redirect('/admin/community/launch#alerts');
    const mode = ['all', 'review', 'off'].includes(form.fields.mode) ? form.fields.mode : 'all';
    await setPrefs(env, whoKey, mode, form.fields.show_text === '1');
    return redirect('/admin/community/launch?flash=alerts#alerts');
  }

  // ---------- live updates safety settings (saved in the database: no new upload needed) ----------
  if (path === '/admin/community/live-settings') {
    if (method !== 'POST') return redirect('/admin/community/launch#live');
    const steps = [setConfig(env, 'live_enabled', form.fields.live_enabled === '0' ? '0' : '1', who)];
    for (const [k, [lo, hi]] of Object.entries(LIVE_RANGES)) {
      const v = Number(form.fields[k]);
      if (!Number.isFinite(v) || v < lo || v > hi) return redirect(`/admin/community/launch?flash=live-range&k=${k}#live`);
      steps.push(setConfig(env, k, String(Math.round(v)), who));
    }
    steps.push(data.audit(env, 'community.live-settings', `Community live updates settings saved by ${who}`));
    await env.DB.batch(steps);
    return redirect('/admin/community/launch?flash=live-saved#live');
  }
  if (path === '/admin/community/live-resume') {
    if (method !== 'POST') return redirect('/admin/community/launch#live');
    await env.DB.batch([setConfig(env, 'live_paused_day', '', who), data.audit(env, 'community.live-resume', `Community live updates resumed by ${who}`)]);
    return redirect('/admin/community/launch?flash=live-resumed#live');
  }

  if (path === '/admin/community/launch') {
    if (method === 'GET') return page(view.launchPage({ config: await getConfig(env), me, csrf: csrf.token, flash, subscribers: await subscribers(),
      usage: await liveUsage(env), liveReady: liveAvailable(env), prefs: await getPrefs(env, whoKey), today: utcDay(), rangeKey: url.searchParams.get('k') || '',
      privacyCoversCommunity: /community/i.test(String(((await env.DB.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).first().catch(() => null)) || {}).body || '')) }));
    const state = String(form.fields.state || '');
    if (!LAUNCH_STATES.includes(state)) return redirect('/admin/community/launch');
    await env.DB.batch([setConfig(env, 'launch', state, who), data.audit(env, 'community.launch', `Community launch set to ${state} by ${who}`)]);
    return redirect('/admin/community/launch?flash=launch');
  }

  // Official commenting: your own switch on or off; the other person's only off
  const om = path.match(/^\/admin\/community\/official\/(gary|julie)\/(on|off)$/);
  if (om) {
    if (method !== 'POST') return redirect('/admin/community/launch');
    const [, target, to] = om;
    if (to === 'on' && target !== me) return redirect('/admin/community/launch?flash=not-yours');
    if (to === 'off' && !me) return redirect('/admin/community/launch?flash=not-official');
    await env.DB.batch([setConfig(env, 'official_' + target, to === 'on' ? '1' : '0', who),
      data.audit(env, 'community.official', `${OFFICIAL_NAMES[target]} official commenting switched ${to} by ${who}`)]);
    return redirect('/admin/community/launch?flash=official');
  }

  if (path === '/admin/community/stats') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return page(view.statsPage({ stats: await statsSummary(env), csrf: csrf.token }));
  }

  const m = path.match(/^\/admin\/community\/(\d{1,9})\/(view|official-comment|notify|notify\/batch|live-socket)$/);
  if (m[2] === 'live-socket') return method === 'GET' ? adminSocket(env, request, Number(m[1])) : textResponse('Method not allowed', { status: 405 });
  const post = await getPost(env, Number(m[1]));
  if (!post) return method === 'GET' ? redirect('/admin/community') : textResponse('That card no longer exists.', { status: 404 });
  const origin = siteOrigin(request, env);

  if (m[2] === 'view') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const [extra, review, config] = await Promise.all([postExtras(env, post.id),
      env.DB.prepare(`SELECT * FROM community_comments WHERE post_id = ?1 AND status IN ('held', 'hidden') ORDER BY id`).bind(post.id).all(),
      getConfig(env)]);
    // the Admin view also shows how often each comment was reported
    const reports = await env.DB.prepare(`SELECT id, report_count FROM community_comments WHERE post_id = ?1 AND report_count > 0`).bind(post.id).all();
    const rc = Object.fromEntries((reports.results || []).map((r) => [r.id, r.report_count]));
    for (const c of extra.comments) { c.report_count = rc[c.id] || 0; for (const r of c.replies) r.report_count = rc[r.id] || 0; }
    const region = { post, extra, review: review.results || [], me, officialOn: !!me && config['official_' + me] === '1', csrf: csrf.token };
    // The live part only (the page fetches it whenever something changes)
    if (url.searchParams.get('part') === 'live') {
      const res = htmlResponse(view.liveRegion(region));
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }
    const [notify, subs, cards] = await Promise.all([push.sendStatus(env, post.id), subscribers(),
      env.DB.prepare(`SELECT id, title, wed_date FROM community_posts WHERE status = 'published' ORDER BY published_at DESC, id DESC LIMIT 100`).all()]);
    await markSeen(env, whoKey, post.id).catch(() => {});
    extra.replyTo = url.searchParams.get('reply');
    return page(view.viewPage({ ...region, flash, origin, notify, subscribers: subs, cards: cards.results || [], liveReady: liveAvailable(env) }));
  }

  if (m[2] === 'official-comment') {
    if (method !== 'POST') return redirect(`/admin/community/${post.id}/view`);
    // The name and the green badge come only from the signed-in Admin account, never from anything typed
    if (!me) return redirect(`/admin/community/${post.id}/view?flash=not-official`);
    const config = await getConfig(env);
    if (config['official_' + me] !== '1') return redirect(`/admin/community/${post.id}/view?flash=official-off`);
    if (post.status !== 'published') return redirect(`/admin/community/${post.id}/view?flash=not-published`);
    const text = String(form.fields.text || '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
    if (!text) return redirect(`/admin/community/${post.id}/view?flash=empty#official`);
    // A reply to a reply joins the same conversation and says who it answers (as for visitors)
    const target = /^\d{1,9}$/.test(String(form.fields.parent || '')) ? await replyTarget(env, post.id, Number(form.fields.parent)) : null;
    const parent = target ? target.parentId : null;
    const row = await env.DB.prepare(`INSERT INTO community_comments (post_id, parent_id, reply_to_id, name, body, status, official, admin_user_id, approved_by, approved_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 'published', ?6, ?7, ?8, strftime('%Y-%m-%dT%H:%M:%fZ','now')) RETURNING *`)
      .bind(post.id, parent, target ? target.replyToId : null, OFFICIAL_NAMES[me], text, me, admin.adminUserId || null, who).first();
    await liveChanged(env, null, post.id, { kind: 'add', comment: row, replyToName: target ? target.replyToName : '' });   // appears for everyone watching
    await data.audit(env, 'community.official-comment', `${OFFICIAL_NAMES[me]} posted an official ${parent ? 'reply' : 'comment'} on card ${post.id}`).run();
    if ((request.headers.get('Accept') || '').includes('application/json')) return json({ ok: true, id: row.id, message: 'Your official ' + (parent ? 'reply' : 'comment') + ' has been posted.' });
    return redirect(`/admin/community/${post.id}/view?flash=commented#c${row.id}`);
  }

  // ---------- Wednesday notification for this card (never automatic) ----------
  if (m[2] === 'notify') {
    if (method !== 'POST') return redirect(`/admin/community/${post.id}/view`);
    if (post.status !== 'published') return redirect(`/admin/community/${post.id}/view?flash=not-published`);
    if (!(await subscribers())) return redirect(`/admin/community/${post.id}/view?flash=no-subscribers`);
    const r = await push.startSend(env, post, who, postPath(post));
    if (!r.ok) return redirect(`/admin/community/${post.id}/view?flash=already-sent`);
    await data.audit(env, 'community.notify', `Wednesday notification for card ${post.id} started by ${who}`).run();
    await push.sendBatch(env, request, r.id);
    return redirect(`/admin/community/${post.id}/view?flash=send-started#notify`);
  }
  if (m[2] === 'notify/batch') {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const st = await push.sendStatus(env, post.id);
    if (!st) return json({ ok: false }, 404);
    if (!st.done) await push.sendBatch(env, request, st.send.id);
    const now = await push.sendStatus(env, post.id);
    return json({ ok: true, done: now.done, counts: now.counts, total: now.total });
  }
  return null;
}
