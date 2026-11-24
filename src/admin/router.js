// Everything under /admin. Every page and every change is checked on the server:
// first the signed-in owner session, then (for changes) the CSRF token and same-site check.
import { htmlResponse, textResponse, redirect, readMultipart, HttpError, siteOrigin } from '../lib/http.js';
import { signInConfigured, getAdmin, beginSignIn, finishSignIn, signOut, workosLogoutFor, csrfFor, checkCsrf } from '../lib/auth.js';
import { allow } from '../lib/ratelimit.js';
import { validateSettings } from '../lib/settings.js';
import { ukToday, longDate } from '../lib/dates.js';
import * as evenings from '../wednesday/evenings.js';
import { nextWednesdays } from '../wednesday/model.js';
import { keepPhotoToken, readKeptPhoto } from './kept-photo.js';
import * as data from '../lib/data.js';
import * as adm from '../views/admin.js';
import * as sections from './sections.js';
import { handleStage3, uploadMusic } from './stage3.js';
import { handleBookingsAdmin } from './bookings.js';
import { handleOrdersAdmin } from './orders.js';
import { handleVouchersAdmin } from './vouchers.js';
import { handleDonationsAdmin } from './donations.js';
import { handleCleanupAdmin } from './cleanup.js';
import { handleIncompleteAdmin } from './incomplete.js';
import { handleShopAdmin, uploadMeditationAudio } from './shop.js';
import { youtubeId, embedCheck } from '../lib/youtube.js';
import { handleEventsAdmin, eventHasBookings } from './events.js';
import { handleCheckin, handleHelpers } from './checkin.js';
import { handleMailingAdmin } from './mailing.js';
import { handleStatusAdmin } from './status.js';
import { handleTeam } from './team.js';
import { handleDoor } from './door.js';
import { handleChatAdmin, chatUnread } from './chat.js';
import { handleCommunityAdmin } from './community.js';
import { handleModerationAdmin } from './moderation.js';
import { handleCommunityLaunchAdmin } from './community-launch.js';
import { handleDesignerAdmin } from './designer.js';
import { PRIVACY_NOTICE } from '../lib/privacy-notice.js';
import { helperOnlyPage } from '../views/admin-checkin.js';
import { placeCounts } from '../events/model.js';

export async function handleAdmin(request, env, url, method, path) {
  if (!signInConfigured(request, env)) {
    if (method !== 'GET') return textResponse('Admin is locked.', { status: 403 });
    return htmlResponse(adm.lockedPage(), { status: 503, headers: { 'Retry-After': '86400' } });
  }

  // ---------- signing in and out (no session yet) ----------
  if (path === '/admin/login' && method === 'GET') {
    if (!(await allow(env, request, 'signin', 20, 600))) return htmlResponse(adm.signInPage('too-many'), { status: 429 });
    const start = await beginSignIn(request, env);
    return new Response(null, { status: 302, headers: { Location: start.location, 'Set-Cookie': start.setCookie, 'Cache-Control': 'no-store' } });
  }
  if (path === '/admin/callback' && method === 'GET') {
    if (!(await allow(env, request, 'callback', 20, 600))) return htmlResponse(adm.signInPage('too-many'), { status: 429 });
    const result = await finishSignIn(request, env);
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    for (const c of result.setCookies) headers.append('Set-Cookie', c);
    if (result.ok) { headers.set('Location', '/admin'); return new Response(null, { status: 303, headers }); }
    if (result.reason === 'not-owner') {
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(String(adm.deniedPage(workosLogoutFor(request, env, result.sid))), { status: 403, headers });
    }
    headers.set('Location', '/admin?signin=' + encodeURIComponent(result.reason));
    return new Response(null, { status: 303, headers });
  }
  if (path === '/admin/signed-out' && method === 'GET') return htmlResponse(adm.signInPage('signed-out'));

  // ---------- everything else needs the owner's session ----------
  const admin = await getAdmin(request, env);
  if (!admin) {
    if (method !== 'GET') return textResponse('Please sign in again.', { status: 403 });
    return htmlResponse(adm.signInPage(url.searchParams.get('signin')), { status: 401 });
  }

  // Check-in helpers (such as Julie) can use check-in and sign out, nothing else
  if (admin.role === 'helper') {
    if (path === '/admin' && method === 'GET') return redirect('/admin/checkin');
    if (!(path === '/admin/logout' || path === '/admin/checkin' || path.startsWith('/admin/checkin/'))) {
      return method === 'GET' ? htmlResponse(helperOnlyPage(), { status: 403 }) : textResponse('Not allowed.', { status: 403 });
    }
  }

  const csrf = csrfFor(request);
  const page = (body, status = 200) => {
    const res = htmlResponse(body, { status });
    if (csrf.setCookie) res.headers.append('Set-Cookie', csrf.setCookie);
    return res;
  };

  if (path === '/admin/music/upload' && method === 'POST') return uploadMusic(request, env);
  const audioUpload = path.match(/^\/admin\/meditations\/(\d{1,9})\/upload\/(preview|full)$/);
  if (audioUpload && method === 'POST') return uploadMeditationAudio(request, env, Number(audioUpload[1]), audioUpload[2]);

  let form = { fields: {}, files: {}, fileLists: {} };
  if (method === 'POST') {
    form = await readMultipart(request);
    if (!checkCsrf(request, form.fields)) {
      const m = adm.messagePage('Please try again', 'For your security, that change was not saved because the page had expired. Go back, refresh the page and try again.', 403);
      return page(m.body, m.status);
    }
  } else if (method !== 'GET') {
    return textResponse('Method not allowed', { status: 405 });
  }

  if (path === '/admin/logout' && method === 'POST') {
    const out = await signOut(request, env, admin);
    return new Response(null, { status: 303, headers: { Location: out.location, 'Set-Cookie': out.setCookie, 'Cache-Control': 'no-store' } });
  }

  const ctx = { request, env, url, method, path, form, page, csrf, admin };
  if (path === '/admin/checkin' || path.startsWith('/admin/checkin/')) {
    const r = await handleCheckin(ctx);
    if (r) return r;
    const nf = adm.messagePage('Not found', 'That event or booking no longer exists.', 404);
    return page(nf.body, nf.status);
  }

  if (path === '/admin' && method === 'GET') {
    const [settings, counts, faqs, blocks, unread, music, team] = await Promise.all([data.getSettings(env), data.dashboardCounts(env), data.visibleFaqs(env),
      data.getBlocks(env, ['privacy_notice']), chatUnread(env), data.musicSettings(env),
      env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users WHERE active = 1').first('n').catch(() => 0)]);
    counts.chatUnread = unread;
    const faqsMissing = faqs.filter((f) => !String(f.answer).trim()).map((f) => f.question);
    const privacyBody = String(blocks.privacy_notice?.body || '');
    const privacyOutdated = privacyBody.includes('We do not copy booking or payment details into this website.');
    const privacyNoMailing = !/mailing list/i.test(privacyBody);
    const privacyNotCurrent = !/live chat/i.test(privacyBody) || !/Wednesday/i.test(privacyBody);
    return page(adm.dashboardPage({ settings, counts, faqsMissing, privacyOutdated, privacyNoMailing, privacyNotCurrent, email: admin.email, role: admin.role, name: admin.name,
      musicWarnings: await data.musicWarnings(env, music), teamCount: team || 0, csrf: csrf.token }));
  }

  if (path === '/admin/settings') {
    if (method === 'GET') {
      return page(adm.settingsPage({ values: await data.getSettings(env), saved: url.searchParams.has('saved'), csrf: csrf.token }));
    }
    const { values, errors } = validateSettings(form.fields);
    if (Object.keys(errors).length) return page(adm.settingsPage({ values: form.fields, errors, csrf: csrf.token }), 422);
    await data.saveSettings(env, values);
    return redirect('/admin/settings?saved=1');
  }

  if (path === '/admin/wording' && method === 'GET') {
    return page(adm.wordingListPage({ blocks: await data.getAllBlocks(env), csrf: csrf.token }));
  }
  if (path === '/admin/wording/privacy_notice/update' && method === 'POST') {
    const current = (await data.getBlocks(env, ['privacy_notice'])).privacy_notice;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO content_blocks (key, title, body) VALUES ('privacy_notice_previous', ?1, ?2)
        ON CONFLICT(key) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(current.title || 'Privacy notice', current.body || ''),
      env.DB.prepare(`INSERT INTO content_blocks (key, title, body) VALUES ('privacy_notice', ?1, ?2)
        ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(current.title || 'Privacy notice', PRIVACY_NOTICE),
      data.audit(env, 'wording.privacy', `Updated Privacy Notice put in place by ${admin.name || admin.email}`)
    ]);
    return redirect('/admin/wording/privacy_notice?updated=1');
  }
  const wording = path.match(/^\/admin\/wording\/([a-z_]+)$/);
  if (wording) {
    const entry = adm.WORDING.find((w) => w.key === wording[1]);
    if (!entry) return page(adm.messagePage('Not found', 'That wording does not exist.', 404).body, 404);
    if (method === 'GET') {
      const block = (await data.getBlocks(env, [entry.key]))[entry.key];
      const privacyUpdate = entry.key === 'privacy_notice' && String(block.body || '').trim() !== PRIVACY_NOTICE.trim() ? PRIVACY_NOTICE : null;
      return page(adm.wordingEditPage({ entry, block, saved: url.searchParams.has('saved'), updated: url.searchParams.has('updated'), privacyUpdate, csrf: csrf.token }));
    }
    const title = String(form.fields.title || '').trim();
    const body = String(form.fields.body || '').replace(/\r\n?/g, '\n').trim();
    const errors = {};
    if (title.length > 150) errors.title = 'Please keep the heading under 150 characters.';
    if (body.length > 20000) errors.body = 'Please keep this under 20,000 characters.';
    if (Object.keys(errors).length) return page(adm.wordingEditPage({ entry, block: { title, body }, errors, csrf: csrf.token }), 422);
    await data.saveBlock(env, entry.key, title, body);
    return redirect(`/admin/wording/${entry.key}?saved=1`);
  }

  const stage3 = await handleStage3({ request, env, url, method, path, form, page, csrf });
  if (stage3) return stage3;

  const voucherPage = await handleVouchersAdmin(ctx);
  if (voucherPage) return voucherPage;
  const bookings = await handleBookingsAdmin({ request, env, url, method, path, form, page, csrf });
  if (bookings) return bookings;
  const ordersPage = await handleOrdersAdmin({ request, env, url, method, path, form, page, csrf, admin });
  if (ordersPage) return ordersPage;
  const shopPage = await handleShopAdmin({ request, env, url, method, path, form, page, csrf });
  if (shopPage) return shopPage;
  for (const handler of [handleTeam, handleDoor, handleChatAdmin, handleEventsAdmin, handleHelpers, handleMailingAdmin, handleStatusAdmin, handleDonationsAdmin, handleCleanupAdmin, handleIncompleteAdmin, handleModerationAdmin, handleCommunityLaunchAdmin, handleDesignerAdmin, handleCommunityAdmin]) {
    const r = await handler(ctx);
    if (r) return r;
  }

  // ---------- the list sections ----------
  const m = path.match(/^\/admin\/([a-z-]+)(?:\/(new|\d{1,9}))?(?:\/(delete|move|toggle))?$/);
  const section = m && sections.SECTIONS[m[1]];
  if (section) {
    const slug = m[1];
    const id = m[2] && m[2] !== 'new' ? Number(m[2]) : null;
    const action = m[3];
    if (!m[2]) {
      if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
      const flashText = slug === 'whos-on' ? movedText(url) : '';
      return page(adm.listPage({ slug, section, rows: await sections.listRows(env, section), flash: flashText ? null : url.searchParams.get('flash'), csrf: csrf.token, today: ukToday(), origin: siteOrigin(request, env),
        extra: slug === 'gallery' ? adm.galleryUploadForm(csrf.token) : '', flashText }));
    }
    const existing = id ? await sections.getRow(env, section, id) : null;
    if (id && !existing) return page(adm.messagePage('Not found', `That ${section.noun} no longer exists. It may have been deleted.`, 404).body, 404);
    if (action) {
      if (method !== 'POST' || !id) return textResponse('Method not allowed', { status: 405 });
      if (action === 'delete') {
        // An event with bookings is never deleted: its booking, payment and guest records must stay
        if (slug === 'events' && (await eventHasBookings(env, id))) return redirect('/admin/events?flash=has-bookings');
        // A listing that had moved its week's evening: the evening (and its advance payments) goes back to the Wednesday
        const plan = slug === 'whos-on' ? await evenings.planListingDelete(env, existing) : { moves: [] };
        if (plan.error) return redirect('/admin/whos-on?flash=till-used');
        await sections.remove(env, section, existing);
        if (plan.moves.length) { await evenings.applyListingPlan(env, plan, null); return redirect(`/admin/${slug}?flash=deleted${movedQuery(plan)}`); }
        return redirect(`/admin/${slug}?flash=deleted`);
      }
      if (action === 'toggle') { await sections.toggle(env, section, existing); return redirect(`/admin/${slug}?flash=toggled`); }
      if (action === 'move') { await sections.move(env, section, existing, form.fields.dir === 'up' ? 'up' : 'down'); return redirect(`/admin/${slug}?flash=moved`); }
    }
    if (method === 'GET') {
      const suggestions = slug === 'teaching-videos' ? { category: await data.videoCategories(env) } : null;
      const values = sections.formValues(section, existing);
      if (slug === 'whos-on' && !existing) values.date = nextWednesdays(1)[0];   // Wednesday is the normal default
      return page(adm.editPage({ slug, section, id, values, csrf: csrf.token, suggestions }));
    }
    // create or update
    // A photo chosen before a mistake elsewhere on the form was kept on the server: it is used unless a new one is chosen
    const kept = {};
    for (const f of section.fields.filter((x) => x.type === 'image' && !x.thumbKey)) {
      if (!form.files[f.key]) { const k = await readKeptPhoto(env, form.fields['kept_' + f.key]); if (k) kept[f.key] = k; }
    }
    const { values, errors } = sections.validate(section, form.fields, { creating: !id, files: { ...form.files, ...kept } });
    let plan = null;
    if (slug === 'whos-on' && !errors.date && values.date) {
      plan = await evenings.planListingDate(env, { id, newDate: values.date, oldDate: existing && existing.date, longDate: (d) => longDate(d) });
      if (plan.error) errors.date = plan.error;
    }
    if (slug === 'events' && id && values.capacity > 0 && !errors.capacity) {
      const taken = (await placeCounts(env, id)).taken;
      if (values.capacity < taken) errors.capacity = `${taken} places are already booked, reserved, being paid for or allocated before the website, so the maximum can’t be lower than that.`;
    }
    const suggestions = slug === 'teaching-videos' ? { category: await data.videoCategories(env) } : null;
    const keep = { ...sections.formValues(section, existing), ...form.fields };
    if (Object.keys(errors).length) {
      // Keep a newly chosen photo, so it doesn't have to be chosen again (only if it really is a photo)
      const keptPhotos = { ...kept };
      let photoProblem = null;
      for (const f of section.fields.filter((x) => x.type === 'image')) {
        if (!form.files[f.key]) continue;
        if (f.thumbKey) { photoProblem = photoProblem || 'Please check the highlighted details, then choose the picture again.'; continue; }
        try { keptPhotos[f.key] = await sections.storeKeptPhoto(env, form.files[f.key], f.purpose); }
        catch (err) { if (err instanceof HttpError && err.status === 400) photoProblem = err.message; else throw err; }
      }
      const keptTokens = {};
      for (const [k, key] of Object.entries(keptPhotos)) keptTokens[k] = { key, token: await keepPhotoToken(env, key) };
      return page(adm.editPage({ slug, section, id, values: keep, errors, csrf: csrf.token, suggestions, kept: keptTokens,
        uploadError: photoProblem }), 422);
    }
    for (const [k, key] of Object.entries(kept)) form.files[k] = { keptKey: key };
    const removeFlags = Object.fromEntries(section.fields.filter((f) => f.type === 'image').map((f) => [f.key, form.fields['remove_' + f.key] === '1']));
    let savedId;
    try {
      savedId = await sections.save(env, section, id, values, form.files, removeFlags, existing);
    } catch (err) {
      if (/EVENT_CAPACITY_BELOW_TAKEN/.test(String(err && err.message))) {
        const taken = (await placeCounts(env, id)).taken;
        return page(adm.editPage({ slug, section, id, values: keep, errors: { capacity: `${taken} places are already booked, reserved, being paid for or allocated before the website, so the maximum can’t be lower than that.` }, csrf: csrf.token }), 422);
      }
      if (err instanceof HttpError && err.status === 400) {
        return page(adm.editPage({ slug, section, id, values: keep, csrf: csrf.token, uploadError: err.message }), 400);
      }
      throw err;
    }
    if (slug === 'teaching-videos' && values.embed_ok && (await embedCheck(request, env, values.youtube_id)) === 'blocked') {
      await env.DB.prepare('UPDATE teaching_videos SET embed_ok = 0 WHERE id = ?1').bind(savedId).run();
      return redirect(`/admin/${slug}?flash=noembed`);
    }
    const hiddenNew = !id && 'visible' in values && !values.visible;
    if (plan && (plan.carry.length || plan.moves.length)) await evenings.applyListingPlan(env, plan, values.date);
    return redirect(`/admin/${slug}?flash=${id ? 'saved' : hiddenNew ? 'added-hidden' : 'added'}${plan ? movedQuery(plan) : ''}`);
  }

  const nf = adm.messagePage('Not found', 'That part of Admin does not exist yet.', 404);
  return page(nf.body, nf.status);
}

// Who's On: what moved with an evening, for the message after saving
function movedQuery(plan) {
  const m = (plan.moves || [])[0];
  return m ? `&from=${m.from}&to=${m.to}&paid=${m.orders || 0}` : '';
}
function movedText(url) {
  const from = url.searchParams.get('from'), to = url.searchParams.get('to'), n = Number(url.searchParams.get('paid') || 0);
  if (url.searchParams.get('flash') === 'till-used') return 'Not deleted: the door till has already been used for that evening.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return '';
  const lead = url.searchParams.get('flash') === 'deleted' ? 'Deleted.' : 'Saved.';
  return `${lead} That week’s evening is now ${longDate(to)} instead of ${longDate(from)}.` +
    (n ? ` ${n} advance ${n === 1 ? 'payment' : 'payments'} for that evening moved with it (QR codes unchanged). The customers have NOT been emailed about the new date.` : ' No advance payments had been made for it.');
}
