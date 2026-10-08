// Admin for Visitor Experiences, Live, Background music and multi-photo Gallery uploads.
import { htmlResponse, textResponse, redirect, HttpError } from '../lib/http.js';
import { checkCsrf } from '../lib/auth.js';
import { storeImage, storeAudioStream, deleteMedia } from '../lib/media.js';
import { youtubeId, watchUrl, embedCheck } from '../lib/youtube.js';
import * as data from '../lib/data.js';
import * as adm from '../views/admin.js';
import * as sections from './sections.js';
import { reviewsSwitch } from '../views/admin-bookings.js';
import { buildBackup, backupName, listStoredBackups, storeBackup, storageUsed } from '../lib/backups.js';

const now = () => new Date().toISOString();

export async function handleStage3(ctx) {
  const { request, env, url, method, path, form, page, csrf } = ctx;

  // ----- Visitor experiences -----
  if (path === '/admin/reviews' && method === 'GET') {
    await data.housekeeping(env);
    const current = ['pending', 'approved', 'hidden', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    const [rows, counts, open] = await Promise.all([data.reviewsByStatus(env, current), data.reviewCounts(env), data.reviewsOpen(env)]);
    return page(adm.reviewsAdminPage({ rows, current, counts, csrf: csrf.token, flash: url.searchParams.get('flash'), top: reviewsSwitch({ open, csrf: csrf.token }) }));
  }
  const rv = path.match(/^\/admin\/reviews\/(\d{1,9})\/(approve|reject|hide|show|feature|unfeature|delete)$/);
  if (rv) {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const row = await env.DB.prepare('SELECT * FROM reviews WHERE id = ?1').bind(Number(rv[1])).first();
    if (!row) return redirect('/admin/reviews');
    const action = rv[2];
    const back = (status) => redirect(`/admin/reviews?status=${status}&flash=${action}`);
    const set = (sql, ...args) => env.DB.batch([
      env.DB.prepare(`UPDATE reviews SET ${sql} WHERE id = ?${args.length + 1}`).bind(...args, row.id),
      data.audit(env, 'reviews.' + action, `Visitor experience from “${row.name.slice(0, 60)}”: ${action}`)
    ]);
    if (action === 'approve') { if (!row.consent) return back(row.status); await set("status = 'approved', decided_at = ?1", now()); return back('approved'); }
    if (action === 'reject') { await set("status = 'rejected', featured = 0, decided_at = ?1", now()); return back('rejected'); }
    if (action === 'hide' && row.status === 'approved') { await set("status = 'hidden', featured = 0"); return back('hidden'); }
    if (action === 'show' && row.status === 'hidden') { await set("status = 'approved'"); return back('approved'); }
    if (action === 'feature' && row.status === 'approved') { await set('featured = 1'); return back('approved'); }
    if (action === 'unfeature') { await set('featured = 0'); return back('approved'); }
    if (action === 'delete') {
      await env.DB.batch([env.DB.prepare('DELETE FROM reviews WHERE id = ?1').bind(row.id), data.audit(env, 'reviews.delete', `Visitor experience from “${row.name.slice(0, 60)}” deleted`)]);
      return back(row.status);
    }
    return back(row.status);
  }

  // ----- Live -----
  if (path === '/admin/live') {
    const live = await data.liveStream(env);
    if (method === 'GET') {
      return page(adm.liveAdminPage({ section: sections.LIVE, values: sections.formValues(sections.LIVE, live), live, csrf: csrf.token,
        flash: url.searchParams.get('flash'), canCopy: !!youtubeId(live.youtube_url) }));
    }
    const { values, errors } = sections.validate(sections.LIVE, form.fields, { creating: false, files: form.files });
    const keep = { ...sections.formValues(sections.LIVE, live), ...form.fields };
    if (Object.keys(errors).length) {
      return page(adm.liveAdminPage({ section: sections.LIVE, values: keep, live, errors, csrf: csrf.token, canCopy: false,
        uploadError: Object.keys(form.files).length ? 'Please check the highlighted details, then choose the picture again.' : null }), 422);
    }
    const remove = { thumbnail_key: form.fields.remove_thumbnail_key === '1' };
    try { await sections.save(env, sections.LIVE, 1, values, form.files, remove, live); }
    catch (err) {
      if (err instanceof HttpError && err.status === 400) return page(adm.liveAdminPage({ section: sections.LIVE, values: keep, live, csrf: csrf.token, uploadError: err.message }), 400);
      throw err;
    }
    const id = youtubeId(values.youtube_url);
    if (id && values.embed_ok && (await embedCheck(request, env, id)) === 'blocked') {
      await env.DB.prepare('UPDATE live_stream SET embed_ok = 0 WHERE id = 1').run();
      return redirect('/admin/live?flash=noembed');
    }
    return redirect('/admin/live?flash=saved');
  }
  const lv = path.match(/^\/admin\/live\/(on|off|to-videos)$/);
  if (lv) {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    if (lv[1] === 'to-videos') {
      const live = await data.liveStream(env);
      const id = youtubeId(live.youtube_url);
      if (!id) return redirect('/admin/live');
      const existing = await env.DB.prepare('SELECT id FROM teaching_videos WHERE youtube_id = ?1').bind(id).first();
      if (existing) return redirect(`/admin/teaching-videos/${existing.id}`);
      const newId = await sections.save(env, sections.SECTIONS['teaching-videos'], null,
        { youtube_url: watchUrl(id), youtube_id: id, title: live.title || 'Livestream recording', description: live.description || '', category: '', embed_ok: live.embed_ok ? 1 : 0, visible: 0 },
        {}, {}, null);
      return redirect(`/admin/teaching-videos/${newId}`);
    }
    const on = lv[1] === 'on' ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare(`UPDATE live_stream SET is_live = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1`).bind(on),
      data.audit(env, 'live.' + lv[1], on ? 'LIVE NOW switched on' : 'LIVE NOW switched off')
    ]);
    return redirect(`/admin/live?flash=${lv[1]}`);
  }

  // ----- Background music -----
  if (path === '/admin/music') {
    const music = await data.musicSettings(env);
    if (method === 'GET') {
      const file = music.track_key ? await env.DB.prepare('SELECT size_bytes FROM media WHERE key = ?1').bind(music.track_key).first() : null;
      return page(adm.musicAdminPage({ music, file, csrf: csrf.token, flash: url.searchParams.get('flash') }));
    }
    const title = String(form.fields.track_title || '').trim();
    const volume = String(form.fields.default_volume || '').trim();
    const errors = {};
    if (title.length > 120) errors.track_title = 'Please keep this under 120 characters.';
    if (!/^\d{1,3}$/.test(volume) || Number(volume) > 100) errors.default_volume = 'Enter a number from 0 to 100.';
    if (Object.keys(errors).length) {
      return page(adm.musicAdminPage({ music: { ...music, track_title: title, default_volume: volume }, csrf: csrf.token, errors }), 422);
    }
    const enabled = form.fields.enabled === '1' && music.track_key ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare(`UPDATE music SET track_title = ?1, default_volume = ?2, enabled = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1`).bind(title, Number(volume), enabled),
      data.audit(env, 'music.update', `Background music settings saved (${enabled ? 'on' : 'off'})`)
    ]);
    return redirect('/admin/music?flash=saved');
  }
  if (path === '/admin/music/remove' && method === 'POST') {
    const music = await data.musicSettings(env);
    await env.DB.batch([
      env.DB.prepare("UPDATE music SET track_key = '', enabled = 0 WHERE id = 1"),
      data.audit(env, 'music.remove', 'Background music removed')
    ]);
    await deleteMedia(env, music.track_key);
    return redirect('/admin/music?flash=removed');
  }

  // ----- Backups -----
  if (path === '/admin/backups' && method === 'GET') {
    const [stored, usage] = await Promise.all([listStoredBackups(env), storageUsed(env)]);
    return page(adm.backupsPage({ stored, usage, csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }
  if (path === '/admin/backups/download' && method === 'GET') {
    const backup = await buildBackup(env);
    await data.audit(env, 'backup.download', 'Backup downloaded').run();
    return new Response(JSON.stringify(backup, null, 1), { headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${backupName()}"` } });
  }
  if (path === '/admin/backups/now' && method === 'POST') {
    await storeBackup(env);
    return redirect('/admin/backups?flash=stored');
  }
  const bf = path.match(/^\/admin\/backups\/file\/(new-ways-backup-[0-9-]{16}\.json)$/);
  if (bf && method === 'GET') {
    const object = await env.MEDIA.get('backups/' + bf[1]);
    if (!object) return redirect('/admin/backups');
    return new Response(object.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${bf[1]}"` } });
  }

  // ----- Gallery: several photos at once -----
  if (path === '/admin/gallery/upload' && method === 'POST') {
    const photos = (form.fileLists.photos || []).slice(0, 10);
    const thumbs = form.fileLists.photos__thumb || [];
    if (!photos.length) return redirect('/admin/gallery');
    const section = sections.SECTIONS.gallery;
    try {
      for (let i = 0; i < photos.length; i++) {
        const files = { image_key: photos[i] };
        if (thumbs[i]) files.image_key__thumb = thumbs[i];
        await sections.save(env, section, null, { caption: '', visible: 1 }, files, {}, null);
      }
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) {
        const m = adm.messagePage('Some photos were not added', err.message, 400);
        return page(m.body, m.status);
      }
      throw err;
    }
    return redirect('/admin/gallery?flash=uploaded');
  }
  return null;
}

// Music upload: the file arrives as the raw request body (not a form), so it can stream straight into storage.
export async function uploadMusic(request, env) {
  if (!checkCsrf(request, { _csrf: request.headers.get('X-CSRF-Token') || '' })) return Response.json({ error: 'Please refresh the page and try again.' }, { status: 403 });
  let name = '';
  try { name = decodeURIComponent(request.headers.get('X-File-Name') || ''); } catch { /* ignore */ }
  try {
    const key = await storeAudioStream(env, request, name);
    const music = await data.musicSettings(env);
    const title = music.track_title || name.replace(/\.[^.]+$/, '').slice(0, 120);
    await env.DB.batch([
      env.DB.prepare(`UPDATE music SET track_key = ?1, track_title = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1`).bind(key, title),
      data.audit(env, 'music.upload', 'Background music uploaded')
    ]);
    if (music.track_key) await deleteMedia(env, music.track_key);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
