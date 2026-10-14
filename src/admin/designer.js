// Admin › Designer (Gary and Julie only): artwork and thank-you cards on a 1733 x 910 canvas, made on the phone.
//   /admin/designer                       projects (drafts and published), templates, New design
//   /admin/designer/:id                   the Designer
//   /admin/designer/:id/save              save the project (JSON from the phone)
//   /admin/designer/:id/publish           publish (or update) as a Community card: the finished artwork without the
//                                         badge (the website adds the shimmering badge on top) and the 1200 x 630
//                                         Facebook link picture, both drawn on the phone and checked here
//   /admin/designer/library               the picture library: backgrounds, photos, stickers and frames (R2)
// The original nine backgrounds are always available. Nothing is published without the Publish button.
import { textResponse, redirect, siteOrigin } from '../lib/http.js';
import { imageInfo, storeImage, deleteMedia } from '../lib/media.js';
import * as data from '../lib/data.js';
import * as view from '../views/admin-designer.js';
import { getPost, postPath, slugify, cardTitle, cardDate, whosOnChoices } from '../community/model.js';
import { BACKGROUNDS } from '../community/card.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export const STORAGE_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;   // stop uploads well before Cloudflare's free 10 GB
const KINDS = ['background', 'photo', 'sticker', 'frame'];

// ---------- the design itself (kept as JSON; only this website's own pictures may be used) ----------
const SRC_OK = /^\/(?:images\/community\/bg-(?:0[1-6]|0[89]|10)-(?:full|1200|800)\.webp|media\/img\/[a-z0-9/_\-.]{2,200}|images\/new-ways-logo\.jpg|images\/logo-720\.webp)$/i;
export function cleanDesign(input) {
  let d = input;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return null; } }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  let bad = false;
  const walk = (v, depth) => {
    if (depth > 8) { bad = true; return null; }
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
    if (typeof v === 'string') return v.slice(0, 2000);
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => walk(x, depth + 1));
    if (typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v).slice(0, 80)) {
        if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
        if (k === 'src' && x !== '' && !(typeof x === 'string' && SRC_OK.test(x) && !x.includes('..'))) { bad = true; continue; }
        o[k] = walk(x, depth + 1);
      }
      return o;
    }
    return null;
  };
  const out = walk(d, 0);
  if (bad || !Array.isArray(out.objects || [])) return null;
  out.v = 1; out.w = 1733; out.h = 910;
  out.objects = Array.isArray(out.objects) ? out.objects : [];
  // What the card says, for screen readers and the page description
  out.words = out.objects.filter((o) => o && o.type === 'text' && typeof o.text === 'string').map((o) => o.text.replace(/\s+/g, ' ').trim()).filter(Boolean).join('. ').slice(0, 600);
  const s = JSON.stringify(out);
  return s.length > 250_000 ? null : out;
}

export function starterDesign({ name = '', dateText = '', background = '01' } = {}) {
  return {
    v: 1, w: 1733, h: 910,
    background: { src: `/images/community/bg-${BACKGROUNDS.includes(background) ? background : '01'}-full.webp`, fit: 'fill', zoom: 1, x: 0, y: 0, color: '#000428', adj: {} },
    objects: [
      { id: 't1', type: 'text', text: 'Thank You', x: 924, y: 250, rotation: 0, opacity: 1, font: 'Cinzel', size: 128, weight: 700, fill: '#F8B709', align: 'center', width: 1100, letterSpacing: 3, shadow: true, shadowColor: '#000428', shadowBlur: 18 },
      { id: 't2', type: 'text', text: name || 'Guest Medium', x: 924, y: 380, rotation: 0, opacity: 1, font: 'Cinzel', size: 72, weight: 600, fill: '#FFFFFF', align: 'center', width: 1100, shadow: true, shadowColor: '#000428', shadowBlur: 14 },
      { id: 't3', type: 'text', text: 'for a wonderful Wednesday evening\nat New Way’s', x: 924, y: 470, rotation: 0, opacity: 1, font: 'Jost', size: 46, weight: 500, fill: '#FFED81', align: 'center', width: 1100, lineHeight: 1.25, shadow: true, shadowColor: '#000428', shadowBlur: 12 },
      ...(dateText ? [{ id: 't4', type: 'text', text: dateText, x: 924, y: 610, rotation: 0, opacity: 1, font: 'Jost', size: 38, weight: 400, fill: '#FFFFFF', align: 'center', width: 1100, shadow: true, shadowColor: '#000428', shadowBlur: 12 }] : [])
    ],
    badge: { show: true, x: 1530, y: 190, size: 260 },
    shimmer: true
  };
}

async function storageUsed(env) {
  return (await env.DB.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM media').first('n')) || 0;
}

async function checkedJpeg(file, w, h, maxBytes) {
  if (!file || file.size > maxBytes) return false;
  const info = imageInfo(new Uint8Array(await file.slice(0, 65536).arrayBuffer()));
  return !!(info && info.type === 'image/jpeg' && info.width === w && info.height === h);
}

export async function handleDesignerAdmin({ request, env, url, method, path, form, page, csrf, admin }) {
  if (path !== '/admin/designer' && !path.startsWith('/admin/designer/')) return null;
  if (admin.role !== 'owner' && admin.role !== 'admin') return textResponse('Not allowed.', { status: 403 });
  const who = admin.name || admin.email || 'Admin';
  const origin = siteOrigin(request, env);

  if (path === '/admin/designer') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const [projects, templates, used] = await Promise.all([
      env.DB.prepare(`SELECT id, status, title, medium_name, wed_date, art_key, updated_at, published_at, slug FROM community_posts WHERE kind = 'design' ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, updated_at DESC LIMIT 200`).all(),
      env.DB.prepare('SELECT id, name, thumb_key, updated_at FROM community_templates ORDER BY updated_at DESC').all(), storageUsed(env)]);
    return page(view.homePage({ projects: projects.results || [], templates: templates.results || [], csrf: csrf.token, flash: url.searchParams.get('flash'), used, limit: STORAGE_LIMIT_BYTES, origin }));
  }

  // ---------- new project (blank, from a template, or the standard thank-you card) ----------
  if (path === '/admin/designer/new') {
    if (method !== 'POST') return redirect('/admin/designer');
    let design;
    let name = '', wed = '';
    const t = /^\d{1,9}$/.test(String(form.fields.template || '')) ? await env.DB.prepare('SELECT design_json FROM community_templates WHERE id = ?1').bind(Number(form.fields.template)).first() : null;
    if (t) design = cleanDesign(t.design_json);
    if (!design) {
      const w = await whosOnChoices(env);
      if (w.suggestion) { name = w.suggestion.name; wed = w.suggestion.date; }
      design = form.fields.start === 'blank' ? { ...starterDesign(), objects: [] } : starterDesign({ name, dateText: wed ? cardDate(wed) : '' });
    }
    const title = cardTitle(name);
    const row = await env.DB.prepare(`INSERT INTO community_posts (kind, status, title, medium_name, wed_date, background, layout_json, design_json, animate_logo, text_shadow, created_by, updated_by, slug)
      VALUES ('design', 'draft', ?1, ?2, ?3, '01', '{}', ?4, 1, 0, ?5, ?5, ?6) RETURNING id`).bind(title, name, wed, JSON.stringify(cleanDesign(design)), who, slugify(title)).first();
    await data.audit(env, 'designer.new', `Designer project started by ${who}`).run();
    return redirect(`/admin/designer/${row.id}`);
  }

  // ---------- the picture library ----------
  if (path === '/admin/designer/library' || path === '/admin/designer/library.json') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const { results } = await env.DB.prepare('SELECT * FROM community_library ORDER BY favourite DESC, created_at DESC LIMIT 1000').all();
    if (path.endsWith('.json')) return json({ ok: true, items: (results || []).map((r) => ({ id: r.id, kind: r.kind, name: r.name, folder: r.folder, src: '/media/' + r.image_key, thumb: '/media/' + (r.thumb_key || r.image_key), w: r.width, h: r.height, favourite: !!r.favourite })) });
    return page(view.libraryPage({ items: results || [], csrf: csrf.token, flash: url.searchParams.get('flash'), used: await storageUsed(env), limit: STORAGE_LIMIT_BYTES }));
  }
  if (path === '/admin/designer/library/upload') {
    if (method !== 'POST') return redirect('/admin/designer/library');
    const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
    const fail = (msg, status = 400) => (wantsJson ? json({ ok: false, message: msg }, status) : redirect('/admin/designer/library?flash=upload-error'));
    if ((await storageUsed(env)) > STORAGE_LIMIT_BYTES) return fail('The picture storage is nearly full (8 GB). Please delete some pictures first.', 507);
    const file = form.files.image, thumb = form.files.thumb;
    if (!file) return fail('Please choose a picture.');
    const kind = KINDS.includes(form.fields.kind) ? form.fields.kind : 'background';
    let key, thumbKey = '';
    try {
      key = await storeImage(env, file, 'designer-' + kind);
      if (thumb) thumbKey = await storeImage(env, thumb, 'designer-thumb');
    } catch (err) { return fail(err && err.message ? err.message : 'That picture could not be used.'); }
    const info = await env.DB.prepare('SELECT width, height, size_bytes FROM media WHERE key = ?1').bind(key).first();
    const row = await env.DB.prepare(`INSERT INTO community_library (kind, name, folder, image_key, thumb_key, width, height, size_bytes, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`)
      .bind(kind, String(form.fields.name || '').trim().slice(0, 60) || 'Picture', String(form.fields.folder || '').trim().slice(0, 40), key, thumbKey, info.width, info.height, info.size_bytes, who).first();
    await data.audit(env, 'designer.library.add', `Picture added to the Designer library by ${who}`).run();
    return wantsJson ? json({ ok: true, item: { id: row.id, kind, src: '/media/' + key, thumb: '/media/' + (thumbKey || key), w: info.width, h: info.height } }) : redirect('/admin/designer/library?flash=added');
  }
  const lm = path.match(/^\/admin\/designer\/library\/(\d{1,9})\/(favourite|delete|edit)$/);
  if (lm) {
    if (method !== 'POST') return redirect('/admin/designer/library');
    const item = await env.DB.prepare('SELECT * FROM community_library WHERE id = ?1').bind(Number(lm[1])).first();
    if (!item) return redirect('/admin/designer/library');
    if (lm[2] === 'favourite') await env.DB.prepare('UPDATE community_library SET favourite = 1 - favourite WHERE id = ?1').bind(item.id).run();
    if (lm[2] === 'edit') await env.DB.prepare('UPDATE community_library SET name = ?2, folder = ?3, kind = ?4 WHERE id = ?1')
      .bind(item.id, String(form.fields.name || '').trim().slice(0, 60) || item.name, String(form.fields.folder || '').trim().slice(0, 40), KINDS.includes(form.fields.kind) ? form.fields.kind : item.kind).run();
    if (lm[2] === 'delete') {
      // A picture used in a published card stays in storage (the card's own finished artwork is a separate copy, so
      // published cards are never affected); only the library entry and its files are removed.
      await env.DB.prepare('DELETE FROM community_library WHERE id = ?1').bind(item.id).run();
      await deleteMedia(env, item.image_key).catch(() => {});
      if (item.thumb_key) await deleteMedia(env, item.thumb_key).catch(() => {});
      await data.audit(env, 'designer.library.delete', `Picture “${item.name}” deleted from the Designer library by ${who}`).run();
    }
    return redirect('/admin/designer/library?flash=' + lm[2]);
  }
  const tm = path.match(/^\/admin\/designer\/templates\/(\d{1,9})\/delete$/);
  if (tm) {
    if (method !== 'POST') return redirect('/admin/designer');
    await env.DB.prepare('DELETE FROM community_templates WHERE id = ?1').bind(Number(tm[1])).run();
    return redirect('/admin/designer?flash=template-deleted');
  }

  // ---------- one project ----------
  const m = path.match(/^\/admin\/designer\/(\d{1,9})(?:\/(save|publish|delete|template))?$/);
  if (!m) return null;
  const post = await getPost(env, Number(m[1]));
  if (!post || post.kind !== 'design') return method === 'GET' ? redirect('/admin/designer') : json({ ok: false, message: 'That project no longer exists.' }, 404);
  const action = m[2] || '';

  if (!action) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const whosOn = await whosOnChoices(env);
    return page(view.editorPage({ post, design: cleanDesign(post.design_json) || starterDesign(), csrf: csrf.token, link: origin + postPath(post), whosOn: whosOn.list, flash: url.searchParams.get('flash') }));
  }
  if (method !== 'POST') return redirect(`/admin/designer/${post.id}`);

  if (action === 'delete') {
    if (post.status !== 'draft') return redirect(`/admin/designer/${post.id}?flash=published-no-delete`);
    await env.DB.prepare(`DELETE FROM community_posts WHERE id = ?1 AND status = 'draft' AND kind = 'design'`).bind(post.id).run();
    for (const k of [post.art_key, post.share_key]) if (k) await deleteMedia(env, k).catch(() => {});
    return redirect('/admin/designer?flash=deleted');
  }

  if (action === 'template') {
    const design = cleanDesign(form.fields.design || post.design_json);
    if (!design) return json({ ok: false, message: 'The design could not be read.' }, 400);
    const name = String(form.fields.name || '').trim().slice(0, 60) || 'Template';
    await env.DB.prepare('INSERT INTO community_templates (name, design_json, created_by) VALUES (?1, ?2, ?3)').bind(name, JSON.stringify(design), who).run();
    return json({ ok: true, message: `Saved as the template “${name}”.` });
  }

  // save / publish
  const design = cleanDesign(form.fields.design);
  if (!design) return json({ ok: false, message: 'The design could not be saved (it may use a picture from outside this website).' }, 400);
  const name = String(form.fields.medium_name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const wed = /^\d{4}-\d{2}-\d{2}$/.test(String(form.fields.wed_date || '')) ? form.fields.wed_date : '';
  const title = String(form.fields.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || cardTitle(name);
  const shimmer = design.shimmer === false ? 0 : 1;
  const sets = { title, medium_name: name, wed_date: wed, design_json: JSON.stringify(design), animate_logo: shimmer };

  if (action === 'save' && post.status !== 'published') {
    await env.DB.prepare(`UPDATE community_posts SET title = ?2, medium_name = ?3, wed_date = ?4, design_json = ?5, animate_logo = ?6, slug = ?7, updated_by = ?8, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`)
      .bind(post.id, sets.title, sets.medium_name, sets.wed_date, sets.design_json, sets.animate_logo, slugify(title), who).run();
    return json({ ok: true, message: 'Saved.' });
  }

  // Publishing (or saving a published card) needs the finished pictures made on the phone
  const art = form.files.art, share = form.files.share;
  if (!(await checkedJpeg(art, 1733, 910, 6 * 1024 * 1024)) || !(await checkedJpeg(share, 1200, 630, 3 * 1024 * 1024))) {
    return json({ ok: false, message: 'The finished pictures could not be made on your phone, so nothing was published. Please try again.' }, 400);
  }
  const artKey = await storeImage(env, art, 'community-art');
  const shareKey = await storeImage(env, share, 'community-share');
  const first = post.status !== 'published';
  await env.DB.batch([
    env.DB.prepare(`UPDATE community_posts SET status = 'published', title = ?2, medium_name = ?3, wed_date = ?4, design_json = ?5, animate_logo = ?6, art_key = ?7, share_key = ?8,
      slug = CASE WHEN ?9 = 1 THEN ?10 ELSE slug END, updated_by = ?11, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      published_at = COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?1`)
      .bind(post.id, sets.title, sets.medium_name, sets.wed_date, sets.design_json, sets.animate_logo, artKey, shareKey, first ? 1 : 0, slugify(title), who),
    data.audit(env, first ? 'community.publish' : 'community.update', `Designer card ${first ? 'published' : 'updated'} by ${who}: ${title}`)
  ]);
  for (const k of [post.art_key, post.share_key]) if (k && k !== artKey && k !== shareKey) await deleteMedia(env, k).catch(() => {});
  const fresh = await getPost(env, post.id);
  return json({ ok: true, published: true, message: first ? 'Published. The card now has its own Community page.' : 'The published card has been updated.', link: origin + postPath(fresh) });
}
