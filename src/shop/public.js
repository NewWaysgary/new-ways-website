// The Meditation Shop on the website: browsing, buying (price from the database, paid on Square) and secure downloads.
import { htmlResponse, redirect, readForm, textResponse } from '../lib/http.js';
import { turnstileConfig, verifyTurnstile, formStamp, stampAge } from '../lib/turnstile.js';
import { allow } from '../lib/ratelimit.js';
import * as pub from '../views/public.js';
import * as view from '../views/shop.js';
import { simpleMessage } from '../views/booking.js';
import { getBookingSettings, EMAIL_RE } from '../bookings/config.js';
import { squareConfig, squareMode, createPaymentLink, SquareError } from '../payments/square.js';
import * as orders from '../orders.js';
import * as dl from './downloads.js';
import * as dev from './devices.js';
import { normaliseEmail } from '../lib/emails.js';
import { downloadTransferConfirmation } from '../notify.js';

const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
const shopOpen = (request, env) => !!(squareConfig(env) && turnstileConfig(request, env));
const published = (env, slug) => env.DB.prepare(`SELECT * FROM products WHERE slug = ?1 AND status = 'published'`).bind(slug).first();

export async function shopPage(ctx) {
  const { results } = await ctx.env.DB.prepare(`SELECT * FROM products WHERE status = 'published' AND full_key != '' ORDER BY sort_order, id`).all();
  return view.shopPage(ctx, { products: results || [], open: shopOpen(ctx.request, ctx.env), sandbox: squareMode(ctx.env) === 'sandbox' });
}

async function productPage(request, env, slug, state = {}) {
  const product = await published(env, slug);
  const ctx = await pub.pageContext(request, env);
  if (!product || !product.full_key) return htmlResponse(await pub.notFoundPage(ctx), { status: 404 });
  const cfg = turnstileConfig(request, env);
  const open = shopOpen(request, env);
  const settings = await getBookingSettings(env);
  return htmlResponse(await view.productPage(ctx, { product, open, sandbox: squareMode(env) === 'sandbox', terms: settings.meditation_terms,
    stamp: open ? await formStamp(cfg) : '', siteKey: cfg ? cfg.siteKey : '', ...state }), { status: state.status || 200 });
}

async function buy(request, env, slug) {
  const cfg = turnstileConfig(request, env);
  const sq = squareConfig(env);
  const product = await published(env, slug);
  if (!cfg || !sq || !product || !product.full_key) return redirect('/meditations');
  const here = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const f = await readForm(request, 20_000);
  const values = { name: String(f.name || '').trim(), email: normaliseEmail(f.email), terms: f.terms === '1' };
  const again = (state) => productPage(request, env, slug, { values, ...state });

  const age = await stampAge(cfg, f.t);
  if (String(f.website || '').trim() || (age !== null && age < 3000)) return redirect('/meditations');
  if (age === null || age > 2 * 3600_000) return again({ notice: 'This page was open for a long time. Please check your details and try again.', status: 400 });
  const errors = {};
  if (values.name.length < 2) errors.name = 'Please enter your name.';
  else if (values.name.length > 80) errors.name = 'Please keep your name under 80 characters.';
  if (values.email.length > 254 || !EMAIL_RE.test(values.email)) errors.email = 'Please enter your full email address.';
  if (!values.terms) errors.terms = 'Please tick to agree to the personal-use terms.';
  if (Object.keys(errors).length) return again({ errors, status: 422 });
  if (!(await allow(env, request, 'meditation', 6, 3600))) {
    return again({ notice: 'We have received a lot of orders from this connection. Please try again later.', status: 429 });
  }
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return again({ notice: 'The security check didn’t complete. Please wait for it to finish, then try again.', status: 400 });
  }
  if (!(await allow(env, { headers: new Headers() }, 'meditation-all', 300, 86400))) {
    return again({ notice: 'The shop is very busy just now. Please try again later.', status: 429 });
  }

  const settings = await getBookingSettings(env);
  const reference = orders.newReference();
  const access = await orders.newAccessKey();
  const nowIso = new Date().toISOString();
  // The price is copied from the product NOW, so a later price change never alters this order
  // device_protected: the download button works only on THIS phone or computer (remembered with a security cookie;
  // see shop/devices.js). There are no codes to add another device.
  const ins = await env.DB.prepare(`INSERT INTO orders (reference, kind, status, item_name, amount_pence, product_id, customer_name, customer_email, terms_text, terms_accepted_at, access_hash, origin, created_at, device_protected)
    VALUES (?1, 'MEDITATION_PURCHASE', 'pending', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)`)
    .bind(reference, product.title, product.price_pence, product.id, values.name, values.email, settings.meditation_terms, nowIso, access.hash, here, nowIso).run();
  const device = dev.ensureDevice(request);
  await dev.rememberDevice(env, ins.meta.last_row_id, device.token, 'purchase');
  try {
    const link = await createPaymentLink(sq, { reference, itemName: `${product.title} (meditation download)`, amountPence: product.price_pence, buyerEmail: values.email,
      idempotencyKey: reference, redirectUrl: `${here}/order/${reference}?key=${encodeURIComponent(access.key)}` });
    await env.DB.prepare('UPDATE orders SET square_payment_link_id = ?1, square_payment_url = ?2, square_order_id = ?3 WHERE reference = ?4')
      .bind(link.id, link.url, link.orderId, reference).run();
  } catch (err) {
    console.error("New Way's: Square payment link not created:", err instanceof SquareError ? `${err.message} ${err.detail}` : err);
    await env.DB.prepare(`UPDATE orders SET status = 'cancelled', note = 'The Square payment page could not be created.' WHERE reference = ?1`).bind(reference).run();
    return again({ notice: 'Sorry, the secure payment page couldn’t be opened just now, so nothing has been charged. Please try again in a few minutes.', status: 503 });
  }
  return redirect(`/order/${reference}?key=${encodeURIComponent(access.key)}`, 303, device.setCookie ? { 'Set-Cookie': device.setCookie } : {});
}

// ---------- secure downloads (see shop/downloads.js: ONE PURCHASE, ONE CLICK, ONE DOWNLOAD) ----------
async function downloadGone(request, env) {
  const ctx = await pub.pageContext(request, env);
  return htmlResponse(await simpleMessage(ctx, { route: 'meditations', title: 'Download link not available',
    message: 'This download link isn’t available. It may have been used already, expired, or been replaced by a newer link. Please contact New Way’s and we’ll help.',
    link: '/meditations', linkText: 'Back to Meditations' }), { status: 410, headers: PRIVATE });
}

const entitlementFor = async (env, token) => /^[A-Za-z0-9_-]{30,60}$/.test(token)
  ? env.DB.prepare('SELECT * FROM download_entitlements WHERE token_hash = ?1').bind(await orders.sha256Hex('download:' + token)).first() : null;

// Everything the download panel shows, worked out on the server every time
export async function downloadPanelData(request, env, ent) {
  const state = dl.downloadState(ent);
  const transfer = dl.transferState(ent);
  const mine = state === 'used' && (await dl.holdsClaim(request, ent));
  return {
    state, expires: ent.expires_at, size: state === 'available' || state === 'used' ? await dl.fileSize(env, ent) : null,
    pressedAt: ent.completed_at, transfer, transferCompletedAt: ent.transfer_completed_at,
    canContinue: mine && transfer !== 'completed' && Date.parse(dl.claimEndsAt(ent)) > Date.now(),
    otherDevice: state === 'available' && !(await dev.deviceAllowed(request, env, ent))
  };
}

// The page the emailed link opens. Opening it uses nothing; it always shows the current state from the server.
async function downloadPage(request, env, token, extra = {}) {
  const ent = await entitlementFor(env, token);
  if (dl.downloadState(ent) === 'gone') return downloadGone(request, env);
  const product = await env.DB.prepare('SELECT title FROM products WHERE id = ?1').bind(ent.product_id).first();
  const ctx = await pub.pageContext(request, env);
  return htmlResponse(await view.downloadPage(ctx, { action: `/download/${token}`, title: product ? product.title : 'Your meditation',
    ...(await downloadPanelData(request, env, ent)), notice: extra.notice || '' }), { status: extra.status || 200, headers: PRIVATE });
}

const REFUSED = {
  used: 'This purchase’s one download has already been used, so it can’t be downloaded again. If you have a genuine problem, please contact New Way’s.',
  simultaneous: 'Your download was already started by another press of the button a moment ago, so this press was refused. Please check your Downloads or My Files.',
  expired: 'The time to press the download button has passed. Please contact New Way’s and we’ll help.',
  gone: 'This download link has been replaced by a newer one. Please use the latest email from New Way’s.',
  missing: 'Sorry, the meditation file isn’t available just now. Your download has NOT been used. Please try again later or contact New Way’s.'
};

// The DOWNLOAD YOUR MEDITATION button (and "Continue my download" after an interruption, same browser only)
async function press(request, env, ent, show) {
  const here = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const f = await readForm(request, 4_000);
  if (!(await allow(env, request, 'download-press', 30, 3600))) return show({ notice: 'Too many tries from this connection. Please try again later.', status: 429 });
  if (f.step === 'continue') {
    const next = await dl.continueClaim(request, env, ent);
    if (next) return redirect(next.location, 303, { 'Cache-Control': 'no-store' });
    await dl.recordEvent(env, ent, 'blocked_continue', 'Continue pressed, but not allowed');
    return show({ notice: 'This download can’t be continued from here. If you have a genuine problem, please contact New Way’s.', status: 409 });
  }
  if (dl.downloadState(ent) === 'available' && !(await dev.deviceAllowed(request, env, ent))) {
    await dl.recordEvent(env, ent, 'blocked_other_device', 'Button pressed on a phone or computer not used to buy');
    return show({ notice: 'For your security, this download only works on the phone or computer used to buy it. Please contact New Way’s if you need help.', status: 403 });
  }
  if (dl.downloadState(ent) === 'available' && f.understand !== '1') {
    return show({ notice: 'Please tick the box to confirm you understand this is a one-time download.', status: 422 });
  }
  const r = await dl.claim(request, env, ent);
  if (r.refused) return show({ notice: REFUSED[r.refused] || REFUSED.used, status: r.refused === 'missing' ? 503 : 409 });
  return redirect(r.location, 303, { 'Set-Cookie': r.setCookie, 'Cache-Control': 'no-store' });
}

async function pressByToken(request, env, token) {
  const ent = await entitlementFor(env, token);
  if (dl.downloadState(ent) === 'gone') return downloadGone(request, env);
  return press(request, env, ent, (extra) => downloadPage(request, env, token, extra));
}

async function pressByOrder(request, env, url, reference) {
  const key = url.searchParams.get('key') || '';
  const order = await orders.orderForCustomer(env, reference, key);
  if (!order || order.status !== 'paid' || order.kind !== 'MEDITATION_PURCHASE') return downloadGone(request, env);
  const ent = await env.DB.prepare('SELECT * FROM download_entitlements WHERE order_id = ?1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').bind(order.id).first();
  if (!ent) return downloadGone(request, env);
  const action = `/order/${reference}/download?key=${encodeURIComponent(key)}`;
  return press(request, env, ent, async (extra) => {
    const ctx = await pub.pageContext(request, env);
    const fresh = await env.DB.prepare('SELECT * FROM download_entitlements WHERE id = ?1').bind(ent.id).first();
    return htmlResponse(await view.downloadPage(ctx, { action, title: order.item_name, ...(await downloadPanelData(request, env, fresh)), notice: extra.notice || '' }),
      { status: extra.status || 200, headers: PRIVATE });
  });
}

const CLAIM_REFUSED = {
  other_browser: 'This download can only be received by the browser where the download button was pressed.',
  completed: 'The whole file has already been sent for this purchase’s one download, so it can’t be sent again. Please check your Downloads or My Files.',
  late: 'This download can no longer be continued. If you have a genuine problem, please contact New Way’s.',
  replaced: 'This download has been replaced by a newer one. Please use the latest email from New Way’s.',
  too_many: 'This download has been asked for too many times. If you have a genuine problem, please contact New Way’s.',
  limit: 'This download is already being sent, or has already been sent, so it can’t be sent again. Please check your Downloads or My Files.',
  missing: 'Sorry, the meditation file isn’t available just now. Please contact New Way’s and we’ll help.',
  unknown: 'This download address isn’t available.'
};

// GET /download/file/SECRET: the file itself, only for the browser that pressed the button
async function claimedFile(request, env, ctx, secret) {
  const ent = await dl.entitlementForClaim(env, secret);
  const res = await dl.serveClaim(request, env, ctx, ent, {
    onCompleted: async (id) => {
      const fresh = await env.DB.prepare('SELECT * FROM download_entitlements WHERE id = ?1').bind(id).first();
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(fresh.order_id).first();
      const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(fresh.product_id).first();
      await downloadTransferConfirmation(env, order, product, fresh);
    }
  });
  if (res instanceof Response) return res;
  if (request.method === 'HEAD') return new Response(null, { status: res.status, headers: PRIVATE });
  const page = await pub.pageContext(request, env);
  return htmlResponse(await simpleMessage(page, { route: 'meditations', title: res.refused === 'completed' || res.refused === 'limit' ? 'DOWNLOAD USED' : 'Download not available',
    message: CLAIM_REFUSED[res.refused] || CLAIM_REFUSED.unknown, link: '/meditations', linkText: 'Back to Meditations' }), { status: res.status, headers: PRIVATE });
}

export async function handleShopRoutes(request, env, url, method, path, ctx) {
  const claimed = path.match(/^\/download\/file\/([^/]{1,100})$/);
  if (claimed && method === 'GET') return claimedFile(request, env, ctx, claimed[1]);
  const d = path.match(/^\/download\/([^/]{1,100})(\/file|\/code)?$/);
  // Older addresses (the direct file link, the emailed-code form) no longer download anything: back to the page
  if (d && d[2]) return redirect(`/download/${d[1]}`, 303);
  if (d && method === 'GET') return downloadPage(request, env, d[1]);
  if (d && method === 'POST') return pressByToken(request, env, d[1]);
  const od = path.match(/^\/order\/(NW-[A-Z0-9]{6})\/download$/);
  if (od && method === 'GET') return redirect(`/order/${od[1]}?key=${encodeURIComponent(url.searchParams.get('key') || '')}`, 303);
  if (od && method === 'POST') return pressByOrder(request, env, url, od[1]);
  const p = path.match(/^\/meditations\/([a-z0-9-]{1,80})(\/buy)?$/);
  if (p && p[2] && method === 'POST') return buy(request, env, p[1]);
  if (p && !p[2] && method === 'GET') return productPage(request, env, p[1]);
  return null;
}
