// Admin › Community (Gary and Julie only; check-in helpers never reach Admin pages beyond check-in).
//   /admin/community                 the list of thank-you cards (drafts and published) and New thank-you card
//   /admin/community/:id             the card editor (save draft, publish, update, Facebook image and link)
//   /admin/community/preview         the nine designs with a sample card (Stage 2)
// Nothing is ever published automatically: only the Publish button (after a confirmation) publishes a card.
// Every change is checked on the server (signed-in session, CSRF token, same-site), as everywhere in Admin.
import { textResponse, redirect, siteOrigin } from '../lib/http.js';
import { imageInfo, storeImage, deleteMedia } from '../lib/media.js';
import * as data from '../lib/data.js';
import * as view from '../views/admin-community.js';
import { parseLayout, newCardLayout } from '../community/card.js';
import { getRotation, suggestBackground, rotationStatement, getPost, listPosts, whosOnChoices, cardFromForm, cardTitle, cardDate, slugify, postPath, nextDesign } from '../community/model.js';

const SHARE_W = 1200, SHARE_H = 630, SHARE_MAX_BYTES = 3 * 1024 * 1024;

export async function handleCommunityAdmin({ request, env, url, method, path, form, page, csrf, admin }) {
  if (path !== '/admin/community' && !path.startsWith('/admin/community/')) return null;
  if (admin.role !== 'owner' && admin.role !== 'admin') return textResponse('Not allowed.', { status: 403 });
  const who = admin.name || admin.email || (admin.role === 'owner' ? 'Gary' : 'Admin');
  const origin = siteOrigin(request, env);

  if (path === '/admin/community') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return page(view.listPage({ posts: await listPosts(env), csrf: csrf.token, flash: url.searchParams.get('flash'), origin }));
  }

  if (path === '/admin/community/preview') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    let next = '';
    try { next = suggestBackground(await getRotation(env)); } catch { next = ''; }
    return page(view.previewPage({ shimmer: url.searchParams.get('shimmer') !== '0', shadow: url.searchParams.get('shadow') !== '0', next, csrf: csrf.token }));
  }

  // A new draft: background from the rotation, name and date from Who's On (all can be changed in the editor)
  if (path === '/admin/community/new') {
    if (method !== 'POST') return redirect('/admin/community');
    const [rotation, whosOn] = await Promise.all([getRotation(env), whosOnChoices(env)]);
    const background = suggestBackground(rotation);
    const m = whosOn.suggestion;
    const name = m ? m.name : '';
    const layout = newCardLayout({ background, name, dateText: m ? cardDate(m.date) : '' });
    const row = await env.DB.prepare(`INSERT INTO community_posts (status, title, medium_name, wed_date, background, layout_json, animate_logo, text_shadow, created_by, updated_by, slug)
      VALUES ('draft', ?1, ?2, ?3, ?4, ?5, 1, 1, ?6, ?6, ?7) RETURNING id`)
      .bind(cardTitle(name), name, m ? m.date : '', background, JSON.stringify(layout), who, slugify(cardTitle(name))).first();
    await data.audit(env, 'community.new', `Draft thank-you card started by ${who}${name ? ' for ' + name : ''}`).run();
    return redirect(`/admin/community/${row.id}?flash=created`);
  }

  const m = path.match(/^\/admin\/community\/(\d{1,9})(?:\/(save|unpublish|delete))?$/);
  if (!m) return null;
  const post = await getPost(env, Number(m[1]));
  if (!post) {
    const body = view.listPage({ posts: await listPosts(env), csrf: csrf.token, flash: null, origin });
    return method === 'GET' ? page(body, 404) : textResponse('That card no longer exists.', { status: 404 });
  }
  const action = m[2] || '';
  const editor = async (extra = {}, status = 200) => {
    const [rotation, whosOn] = await Promise.all([getRotation(env), whosOnChoices(env)]);
    return page(view.editorPage({ post: { ...post, ...(extra.post || {}) }, layout: extra.layout || parseLayout(post.layout_json), csrf: csrf.token,
      errors: extra.errors || {}, error: extra.error || '', flash: extra.flash || null, whosOn: whosOn.list, suggested: suggestBackground(rotation),
      link: origin + postPath(post) }), status);
  };

  if (!action) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return editor({ flash: url.searchParams.get('flash') });
  }
  if (method !== 'POST') return redirect(`/admin/community/${post.id}`);

  if (action === 'delete') {
    if (post.status !== 'draft') return editor({ error: 'A published card can’t be deleted. Move it back to drafts first.' }, 409);
    await env.DB.batch([env.DB.prepare(`DELETE FROM community_posts WHERE id = ?1 AND status = 'draft'`).bind(post.id),
      data.audit(env, 'community.delete', `Draft thank-you card deleted by ${who}: ${post.title}`)]);
    if (post.share_key) await deleteMedia(env, post.share_key).catch(() => {});
    return redirect('/admin/community?flash=deleted');
  }

  if (action === 'unpublish') {
    if (post.status === 'published') {
      await env.DB.batch([env.DB.prepare(`UPDATE community_posts SET status = 'draft', updated_by = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`).bind(post.id, who),
        data.audit(env, 'community.unpublish', `Thank-you card moved back to drafts by ${who}: ${post.title}`)]);
    }
    return redirect(`/admin/community/${post.id}?flash=unpublished`);
  }

  // ---------- save, Next Design, publish ----------
  const intent = ['save', 'next', 'publish'].includes(form.fields.action) ? form.fields.action : 'save';
  const { errors, values, layout } = cardFromForm(form.fields, parseLayout(post.layout_json));
  const shown = { post: { ...values }, layout };
  if (Object.keys(errors).length) return editor({ ...shown, errors }, 422);
  // Next Design (only used when the phone's JavaScript is off; otherwise it happens on the card straight away):
  // shows the next design in the editor without saving anything, so a published card is never changed by it.
  if (intent === 'next') {
    layout.background = nextDesign(layout.background);
    return editor({ post: { ...values, background: layout.background }, layout, flash: 'next-design' });
  }

  // Publishing, or saving a card that is already published, needs the finished 1200 x 630 Facebook picture, which the
  // editor draws on the phone from this same layout. It must really be a JPEG of exactly that size.
  const goingLive = intent === 'publish' || post.status === 'published';
  let shareKey = post.share_key;
  if (goingLive) {
    const file = form.files.share_image;
    let problem = '';
    if (!file) problem = 'The Facebook picture for this card could not be made on your phone, so nothing was published. Please try again; if it keeps happening, check the phone has a signal and Chrome is up to date.';
    else if (file.size > SHARE_MAX_BYTES) problem = 'The Facebook picture was unexpectedly large, so nothing was published. Please try again.';
    else {
      const info = imageInfo(new Uint8Array(await file.slice(0, 65536).arrayBuffer()));
      if (!info || info.type !== 'image/jpeg' || info.width !== SHARE_W || info.height !== SHARE_H) problem = 'The Facebook picture was not the right kind of picture, so nothing was published. Please try again.';
    }
    if (problem) return editor({ ...shown, error: problem }, 400);
    shareKey = await storeImage(env, file, 'community-share');
  }

  const publishNow = intent === 'publish' && post.status === 'draft';
  const status = publishNow ? 'published' : post.status;
  // The address is fixed when a card is first published, so links already shared keep working
  const slug = post.status === 'published' ? post.slug : slugify(values.title);
  const statements = [
    env.DB.prepare(`UPDATE community_posts SET status = ?2, title = ?3, medium_name = ?4, wed_date = ?5, background = ?6, layout_json = ?7, animate_logo = ?8,
      text_shadow = ?9, share_key = ?10, slug = ?11, updated_by = ?12, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      published_at = CASE WHEN ?2 = 'published' THEN COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE published_at END WHERE id = ?1`)
      .bind(post.id, status, values.title, values.medium_name, values.wed_date, values.background, JSON.stringify(layout), values.animate_logo, values.text_shadow,
        shareKey || '', slug, who)
  ];
  if (publishNow) {
    // The rotation moves on only when a card is published (the design used is crossed off for this round)
    statements.push(rotationStatement(env, await getRotation(env), values.background));
    statements.push(data.audit(env, 'community.publish', `Thank-you card published by ${who}: ${values.title}`));
  } else if (goingLive) {
    statements.push(data.audit(env, 'community.update', `Published thank-you card updated by ${who}: ${values.title}`));
  }
  await env.DB.batch(statements);
  if (shareKey && post.share_key && shareKey !== post.share_key) await deleteMedia(env, post.share_key).catch(() => {});
  const flash = publishNow ? 'published' : goingLive ? 'updated' : 'saved';
  return redirect(`/admin/community/${post.id}?flash=${flash}`);
}

