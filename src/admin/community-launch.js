// Admin › Community launch, official commenting, statistics, the Admin Community view and Wednesday notifications.
// Gary and Julie only (check-in helpers never reach these). Every change needs the Admin sign-in and CSRF check.
import { textResponse, redirect, siteOrigin } from '../lib/http.js';
import * as data from '../lib/data.js';
import * as view from '../views/admin-community-launch.js';
import { getConfig, setConfig, officialIdentity, OFFICIAL_NAMES, LAUNCH_STATES } from '../community/config.js';
import { statsSummary } from '../community/stats.js';
import { postExtras } from '../community/public.js';
import { getPost, postPath } from '../community/model.js';
import * as push from '../community/push.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function handleCommunityLaunchAdmin({ request, env, url, method, path, form, page, csrf, admin }) {
  const mine = path === '/admin/community/launch' || path === '/admin/community/stats' || /^\/admin\/community\/official\//.test(path) || /^\/admin\/community\/\d{1,9}\/(view|official-comment|notify|notify\/batch)$/.test(path);
  if (!mine) return null;
  if (admin.role !== 'owner' && admin.role !== 'admin') return textResponse('Not allowed.', { status: 403 });
  const who = admin.name || admin.email || 'Admin';
  const me = await officialIdentity(env, admin);
  const flash = url.searchParams.get('flash');
  const subscribers = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM community_subscribers').first('n')) || 0;

  if (path === '/admin/community/launch') {
    if (method === 'GET') return page(view.launchPage({ config: await getConfig(env), me, csrf: csrf.token, flash, subscribers: await subscribers(),
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

  const m = path.match(/^\/admin\/community\/(\d{1,9})\/(view|official-comment|notify|notify\/batch)$/);
  const post = await getPost(env, Number(m[1]));
  if (!post) return method === 'GET' ? redirect('/admin/community') : textResponse('That card no longer exists.', { status: 404 });
  const origin = siteOrigin(request, env);

  if (m[2] === 'view') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const [extra, held, config, notify, subs] = await Promise.all([postExtras(env, post.id),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM community_comments WHERE post_id = ?1 AND status = 'held'`).bind(post.id).first('n'),
      getConfig(env), push.sendStatus(env, post.id), subscribers()]);
    // the Admin view also shows how often each comment was reported
    const reports = await env.DB.prepare(`SELECT id, report_count FROM community_comments WHERE post_id = ?1`).bind(post.id).all();
    const rc = Object.fromEntries((reports.results || []).map((r) => [r.id, r.report_count]));
    for (const c of extra.comments) { c.report_count = rc[c.id] || 0; for (const r of c.replies) r.report_count = rc[r.id] || 0; }
    extra.replyTo = url.searchParams.get('reply');
    return page(view.viewPage({ post, extra, held: held || 0, me, officialOn: !!me && config['official_' + me] === '1', csrf: csrf.token, flash, origin, notify, subscribers: subs }));
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
    let parent = /^\d{1,9}$/.test(String(form.fields.parent || '')) ? Number(form.fields.parent) : null;
    if (parent) {
      const p = await env.DB.prepare(`SELECT id, parent_id FROM community_comments WHERE id = ?1 AND post_id = ?2 AND status = 'published'`).bind(parent, post.id).first();
      parent = p && !p.parent_id ? p.id : null;
    }
    const row = await env.DB.prepare(`INSERT INTO community_comments (post_id, parent_id, name, body, status, official, admin_user_id, approved_by, approved_at)
      VALUES (?1, ?2, ?3, ?4, 'published', ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now')) RETURNING id`)
      .bind(post.id, parent, OFFICIAL_NAMES[me], text, me, admin.adminUserId || null, who).first();
    await data.audit(env, 'community.official-comment', `${OFFICIAL_NAMES[me]} posted an official ${parent ? 'reply' : 'comment'} on card ${post.id}`).run();
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
