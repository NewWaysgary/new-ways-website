// New Way's: one Cloudflare Worker serving the website, the installable app and Admin.
import { htmlResponse, textResponse, redirect, withSecurityHeaders, isProductionHost, siteOrigin, HttpError } from './lib/http.js';
import { workosOrigin } from './lib/auth.js';
import { handleAdmin } from './admin/router.js';
import * as pub from './views/public.js';
import { PAGES } from './views/layout.js';
import { submitExperience } from './reviews.js';
import { housekeeping, incrementMetric } from './lib/data.js';
import { weeklyBackup } from './lib/backups.js';
import { allow } from './lib/ratelimit.js';
import { handleBookingRoutes, readingsPage } from './bookings/public.js';
import { hourlyJobs } from './orders.js';
import { handleShopRoutes, shopPage } from './shop/public.js';
import { removeRetiredRecordings } from './shop/files.js';

const HOURLY = '7 * * * *';

const PUBLIC_ROUTES = {
  '/': pub.homePage,
  '/whos-on': pub.whosOnPage,
  '/events': pub.eventsPage,
  '/private-readings': readingsPage,
  '/bookings': pub.bookingsPage,
  '/meditations': shopPage,
  '/development-circle': pub.circlePage,
  '/about': pub.aboutPage,
  '/charity': pub.charityPage,
  '/faqs': pub.faqsPage,
  '/find-us': pub.findUsPage,
  '/gallery': pub.galleryPage,
  '/reviews': pub.reviewsPage,
  '/teaching-videos': pub.videosPage,
  '/live': pub.livePage,
  '/privacy': pub.privacyPage,
  '/offline': pub.offlinePage
};

export default {
  // Cloudflare Cron Triggers (free). Every hour: releases unpaid appointment holds (after asking Square), closes
  // abandoned orders and sends reading reminders. Daily: deletes rejected experiences after 30 days, old spam-limit
  // records and expired Admin sessions, removes old customer contact details, and keeps a weekly backup copy in R2.
  async scheduled(event, env, ctx) {
    const daily = event.cron !== HOURLY;
    ctx.waitUntil(hourlyJobs(env).then(() => (daily ? housekeeping(env).then(() => removeRetiredRecordings(env)).then(() => weeklyBackup(env)) : null)));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isAdmin = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
    let response;
    try {
      response = await handle(request, env, ctx, url, isAdmin);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err && err.stack ? err.stack : err);
      response = htmlResponse(`<!doctype html><meta charset="utf-8"><title>Something went wrong</title><body style="background:#000428;color:#fff;font-family:sans-serif;padding:24px"><p>${status === 500 ? 'Something went wrong on our side. Please try again in a moment.' : String(err.message).replace(/[<>&]/g, '')}</p><p><a style="color:#F8B709" href="/">Go to the home screen</a></p></body>`, { status });
    }
    if (request.method === 'HEAD') response = new Response(null, response);
    // Admin's Sign out button hands over to WorkOS's sign-out address, so that address is allowed for Admin forms
    return withSecurityHeaders(response, request, env, { admin: isAdmin, formActionExtra: isAdmin ? workosOrigin(request, env) : null });
  }
};

async function handle(request, env, ctx, url, isAdmin) {
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';

  if (isAdmin) return handleAdmin(request, env, url, method, path);

  if (method === 'POST' && path === '/api/metrics') return recordMetric(request, env);
  if (method === 'POST' && path === '/reviews') return submitExperience(request, env);
  if (/^\/(private-readings\/book|order|webhooks|download|meditations\/)/.test(path)) {
    const r = (await handleBookingRoutes(request, env, url, method, path)) || (await handleShopRoutes(request, env, url, method, path));
    if (r) return r;
  }
  if (method !== 'GET') return textResponse('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });

  if (path === '/robots.txt') return robots(request, env);
  if (path === '/sitemap.xml') return sitemap(request, env);
  if (path.startsWith('/media/')) return serveMedia(request, env, path.slice(7), ctx);

  // Tidy old-style or mistyped addresses
  if (url.pathname !== path) return redirect(path + url.search, 301);

  const view = PUBLIC_ROUTES[path];
  const pageCtx = await pub.pageContext(request, env);
  if (!view) return htmlResponse(await pub.notFoundPage(pageCtx), { status: 404 });
  return htmlResponse(await view(pageCtx));
}


async function recordMetric(request, env) {
  // Aggregate counters only. The server stores no visitor/device identifier.
  // Browsers always send Origin with this request, so a missing or different Origin is refused.
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return textResponse('Forbidden', { status: 403 });
  if (Number(request.headers.get('Content-Length') || 0) > 200) return textResponse('Bad request', { status: 400 });
  let body;
  try { body = await request.json(); } catch { return textResponse('Bad request', { status: 400 }); }
  const key = body && body.type === 'visitor' ? 'unique_visitors' : body && body.type === 'install' ? 'app_installs' : '';
  if (!key) return textResponse('Bad request', { status: 400 });
  const done = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  try {
    // A normal visitor sends this once; repeated sending from one connection is ignored, so the counts can't be inflated.
    if (!(await allow(env, request, 'metric-' + key, 3, 3600))) return done;
    await incrementMetric(env, key);
  } catch (err) {
    console.error("New Way's: could not record a counter:", err && err.message ? err.message : err);
  }
  return done;
}

// ---------- robots.txt and sitemap.xml ----------

function robots(request, env) {
  if (!isProductionHost(request, env)) return textResponse('User-agent: *\nDisallow: /\n');
  const origin = siteOrigin(request, env);
  return textResponse(`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${origin}/sitemap.xml\n`);
}

function sitemap(request, env) {
  const origin = siteOrigin(request, env);
  const urls = PAGES.map((p) => `  <url><loc>${origin}${p.path}</loc></url>`).join('\n');
  return textResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { type: 'application/xml; charset=utf-8', headers: { 'Cache-Control': 'public, max-age=3600' } });
}

// ---------- media (photos, posters, music) from R2 ----------

async function serveMedia(request, env, rawKey, ctx) {
  let key;
  try { key = decodeURIComponent(rawKey); } catch { return textResponse('Not found', { status: 404 }); }
  if (!/^(img|audio)\/[a-z0-9/_\-.]{2,200}$/i.test(key) || key.includes('..')) return textResponse('Not found', { status: 404 });
  const wantsRange = request.headers.has('Range');
  const edge = !wantsRange && request.method === 'GET' && typeof caches !== 'undefined' && caches.default ? caches.default : null;
  if (edge) {
    const hit = await edge.match(request);
    if (hit) return hit;
  }
  const object = await env.MEDIA.get(key, wantsRange ? { range: request.headers } : { onlyIf: request.headers });
  if (!object) return textResponse('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Accept-Ranges', 'bytes');
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });
  if (wantsRange && object.range) {
    const r = object.range;
    const offset = r.offset !== undefined ? r.offset : object.size - r.suffix;
    const length = r.length !== undefined ? r.length : object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  const response = new Response(object.body, { headers });
  if (edge && ctx && ctx.waitUntil) ctx.waitUntil(edge.put(request, response.clone()).catch(() => {}));
  return response;
}
