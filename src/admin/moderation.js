// Admin › Community moderation (Gary and Julie have exactly the same powers; check-in helpers never reach it).
//   /admin/community/moderation              comments held for review, hidden, published and rejected (from Stage 5)
//   /admin/community/moderation/test         Test a Comment: the real checks, but nothing is stored, published or sent
//   /admin/community/moderation/words        the block, hold and allow word lists
//   /admin/community/moderation/visitors     repeat visitors (hold all their comments, ignore their reports, clear)
import { textResponse, redirect } from '../lib/http.js';
import * as data from '../lib/data.js';
import * as view from '../views/admin-moderation.js';
import { screenComment, moderateComment, moderationCounts } from '../community/comments.js';
import { normalisePhrase } from '../community/moderation.js';
import { liveChanged } from '../community/live.js';

const BASE = '/admin/community/moderation';
const CATEGORY_KEYS = view.CATEGORIES.map(([k]) => k);

export async function handleModerationAdmin({ env, url, method, path, form, page, csrf, admin }) {
  if (path !== BASE && !path.startsWith(BASE + '/')) return null;
  if (admin.role !== 'owner' && admin.role !== 'admin') return textResponse('Not allowed.', { status: 403 });
  const who = admin.name || admin.email || 'Admin';
  const flash = url.searchParams.get('flash');

  // ---------- comments ----------
  if (path === BASE) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const show = ['held', 'hidden', 'published', 'rejected'].includes(url.searchParams.get('show')) ? url.searchParams.get('show') : 'held';
    const [list, counts] = await Promise.all([
      env.DB.prepare(`SELECT c.*, p.title AS post_title FROM community_comments c LEFT JOIN community_posts p ON p.id = c.post_id WHERE c.status = ?1
        ORDER BY c.created_at ${show === 'held' ? 'ASC' : 'DESC'} LIMIT 200`).bind(show).all(),
      moderationCounts(env)]);
    return page(view.commentsPage({ show, comments: list.results || [], counts, csrf: csrf.token, flash }));
  }
  const cm = path.match(/^\/admin\/community\/moderation\/comment\/(\d{1,9})\/(approve|reject|hide|delete)$/);
  if (cm) {
    if (method !== 'POST') return redirect(BASE);
    const r = await moderateComment(env, Number(cm[1]), cm[2], who);
    if (!r.ok) return redirect(`${BASE}?flash=not-allowed`);
    await data.audit(env, 'community.comment.' + cm[2], `Comment ${cm[1]} (${r.comment.name}) ${cm[2] === 'delete' ? 'deleted' : cm[2] + 'd'} by ${who}`).run();
    // Live: visitors watching the card see it disappear (with its replies) or reappear; Admin pages refresh themselves
    const was = r.comment.status;
    if (was === 'published' && (cm[2] === 'hide' || cm[2] === 'delete')) {
      const ids = [r.comment.id, ...(((await env.DB.prepare('SELECT id FROM community_comments WHERE parent_id = ?1').bind(r.comment.id).all()).results || []).map((x) => x.id))];
      await liveChanged(env, null, r.comment.post_id, { kind: 'remove', ids: cm[2] === 'delete' ? r.removedIds || ids : ids });
    } else if (cm[2] === 'approve') await liveChanged(env, null, r.comment.post_id, { kind: 'reload' });
    else await liveChanged(env, null, r.comment.post_id, { kind: 'admin' });
    // From the Admin Community view, go back there
    if (/^\/admin\/community\/\d{1,9}\/view$/.test(String(form.fields.back || ''))) {
      if ((url.searchParams.get('ajax') || form.fields.ajax) === '1') return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      return redirect(`${form.fields.back}?flash=${cm[2]}#conversation`);
    }
    const back = { approve: r.comment.status, reject: 'held', hide: 'published', delete: r.comment.status }[cm[2]];
    return redirect(`${BASE}?show=${back}&flash=${cm[2]}`);
  }

  // ---------- Test a Comment (reads only: nothing is stored, published or sent) ----------
  if (path === BASE + '/test') {
    let values = {};
    if (method === 'POST') values = { name: String(form.fields.name || '').slice(0, 200), text: String(form.fields.text || '').slice(0, 5000) };
    else if (method === 'GET' && url.searchParams.has('example')) {
      const ex = view.EXAMPLES[Number(url.searchParams.get('example'))];
      if (ex) values = { text: ex[1], name: ex[2] };
    } else if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    let result = null;
    if (values.text !== undefined) {
      result = await screenComment(env, { name: values.name && values.name.trim() ? values.name : undefined, text: values.text }, { live: false });
    }
    return page(view.testPage({ values, result, csrf: csrf.token }));
  }

  // ---------- word lists ----------
  if (path === BASE + '/words') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const { results } = await env.DB.prepare('SELECT * FROM community_words ORDER BY phrase').all();
    return page(view.wordsPage({ rows: results || [], csrf: csrf.token, flash, q: String(url.searchParams.get('q') || '').slice(0, 60) }));
  }
  if (path === BASE + '/words/add') {
    if (method !== 'POST') return redirect(BASE + '/words');
    const phrase = normalisePhrase(String(form.fields.phrase || '').slice(0, 80));
    const action = ['block', 'hold', 'allow'].includes(form.fields.action) ? form.fields.action : '';
    const category = CATEGORY_KEYS.includes(form.fields.category) ? form.fields.category : 'other';
    const anywhere = form.fields.anywhere === '1' && action === 'block' && !phrase.includes(' ') && phrase.length >= 4 ? 1 : 0;
    let error = '';
    if (!phrase || phrase.length < 2) error = 'Please type a word or phrase (at least 2 letters).';
    else if (phrase.length > 60) error = 'Please keep it under 60 characters.';
    else if (!action) error = 'Please choose what should happen.';
    if (error) {
      const { results } = await env.DB.prepare('SELECT * FROM community_words ORDER BY phrase').all();
      return page(view.wordsPage({ rows: results || [], csrf: csrf.token, error, values: form.fields }), 422);
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO community_words (phrase, action, category, anywhere, source, added_by) VALUES (?1, ?2, ?3, ?4, 'admin', ?5)
        ON CONFLICT(phrase) DO UPDATE SET action = excluded.action, category = excluded.category, anywhere = excluded.anywhere, source = 'admin', added_by = excluded.added_by`)
        .bind(phrase, action, category, anywhere, who),
      data.audit(env, 'community.words.add', `Word list: “${phrase}” set to ${action} by ${who}`)]);
    return redirect(BASE + '/words?flash=added');
  }
  const wm = path.match(/^\/admin\/community\/moderation\/words\/(\d{1,9})\/delete$/);
  if (wm) {
    if (method !== 'POST') return redirect(BASE + '/words');
    const row = await env.DB.prepare('SELECT phrase, action FROM community_words WHERE id = ?1').bind(Number(wm[1])).first();
    if (row) await env.DB.batch([env.DB.prepare('DELETE FROM community_words WHERE id = ?1').bind(Number(wm[1])),
      data.audit(env, 'community.words.remove', `Word list: “${row.phrase}” (${row.action}) removed by ${who}`)]);
    return redirect(BASE + '/words?flash=removed');
  }

  // ---------- repeat visitors ----------
  if (path === BASE + '/visitors') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const { results } = await env.DB.prepare(`SELECT * FROM community_visitors WHERE blocked_total > 0 OR held_total > 0 OR always_hold = 1 OR reports_ignored = 1
      ORDER BY updated_at DESC LIMIT 200`).all();
    return page(view.visitorsPage({ visitors: results || [], csrf: csrf.token, flash }));
  }
  const vm = path.match(/^\/admin\/community\/moderation\/visitors\/(v[0-9a-f]{24})\/(always-hold|normal|ignore-reports|count-reports|clear)$/);
  if (vm) {
    if (method !== 'POST') return redirect(BASE + '/visitors');
    const sql = {
      'always-hold': 'UPDATE community_visitors SET always_hold = 1 WHERE visitor_key = ?1',
      normal: 'UPDATE community_visitors SET always_hold = 0, hold_until = NULL, strikes = 0 WHERE visitor_key = ?1',
      'ignore-reports': 'UPDATE community_visitors SET reports_ignored = 1 WHERE visitor_key = ?1',
      'count-reports': 'UPDATE community_visitors SET reports_ignored = 0 WHERE visitor_key = ?1',
      clear: 'DELETE FROM community_visitors WHERE visitor_key = ?1'
    }[vm[2]];
    const statements = [env.DB.prepare(sql).bind(vm[1]), data.audit(env, 'community.visitor.' + vm[2], `Visitor ${vm[1].slice(0, 9)}: ${vm[2]} by ${who}`)];
    // Their past reports stop (or start again) counting too
    if (vm[2] === 'ignore-reports' || vm[2] === 'count-reports') statements.push(env.DB.prepare('UPDATE community_reports SET counted = ?2 WHERE reporter_key = ?1').bind(vm[1], vm[2] === 'ignore-reports' ? 0 : 1));
    await env.DB.batch(statements);
    return redirect(BASE + '/visitors?flash=visitor');
  }
  return null;
}
