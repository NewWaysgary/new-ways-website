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
import { sendEmail } from '../lib/email.js';
import { build, context } from '../notify.js';

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
  // device_protected: the download will work on THIS phone or computer (remembered with a security cookie), and on
  // any other device only after a code emailed to the purchase address (see shop/devices.js)
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

// ---------- secure downloads (see shop/downloads.js: ONE download per purchase) ----------
async function downloadGone(request, env) {
  const ctx = await pub.pageContext(request, env);
  return htmlResponse(await simpleMessage(ctx, { route: 'meditations', title: 'Download link not available',
    message: 'This download link isn’t available. It may have been used already, expired, or been replaced by a newer link. Please contact New Way’s and we’ll help.',
    link: '/meditations', linkText: 'Back to Meditations' }), { status: 410, headers: PRIVATE });
}

const entitlementFor = async (env, token) => /^[A-Za-z0-9_-]{30,60}$/.test(token)
  ? env.DB.prepare('SELECT * FROM download_entitlements WHERE token_hash = ?1').bind(await orders.sha256Hex('download:' + token)).first() : null;

async function downloadByToken(request, env, token) {
  const ent = await entitlementFor(env, token);
  if (ent && !(await dev.deviceAllowed(request, env, ent))) {
    // Not the device used to buy (and not confirmed with a code): back to the page, which explains what to do
    if (request.method === 'HEAD') return new Response(null, { status: 403, headers: PRIVATE });
    return redirect(`/download/${token}`);
  }
  const res = ent ? await dl.deliver(request, env, ent) : null;
  return res || downloadGone(request, env);
}

// The page the emailed link opens. Opening it uses nothing; it always shows the current state from the server.
async function downloadPage(request, env, token, extra = {}) {
  const ent = await entitlementFor(env, token);
  const state = dl.downloadState(ent);
  if (state === 'gone') return downloadGone(request, env);
  const [product, order] = await Promise.all([
    env.DB.prepare('SELECT title FROM products WHERE id = ?1').bind(ent.product_id).first(),
    env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(ent.order_id).first()
  ]);
  const allowed = await dev.deviceAllowed(request, env, ent);
  const ctx = await pub.pageContext(request, env);
  return htmlResponse(await view.downloadPage(ctx, { href: `/download/${token}/file`, title: product ? product.title : 'Your meditation',
    state, expires: ent.expires_at, windowEnds: dl.windowEndsAt(ent),
    confirm: allowed || (state !== 'available' && state !== 'started') ? null
      : { action: `/download/${token}/code`, email: dev.maskEmail(order && !order.personal_data_removed_at ? order.customer_email : ''), ...extra } }),
  { status: extra.status || 200, headers: { ...PRIVATE, ...(extra.setCookie ? { 'Set-Cookie': extra.setCookie } : {}) } });
}

// POST /download/TOKEN/code: "Email me a code" (step=send) and "Confirm" (step=check)
async function downloadCode(request, env, token) {
  const here = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const ent = await entitlementFor(env, token);
  const state = dl.downloadState(ent);
  if (state !== 'available' && state !== 'started') return downloadPage(request, env, token);
  const f = await readForm(request, 4_000);
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(ent.order_id).first();
  const device = dev.ensureDevice(request);
  const show = (extra) => downloadPage(request, env, token, { setCookie: device.setCookie, ...extra });
  if (await dev.deviceAllowed(request, env, ent)) return redirect(`/download/${token}`);
  if (f.step === 'check') {
    if (!device.setCookie && !(await allow(env, request, 'download-code-check', 30, 3600))) return show({ notice: 'Too many tries from this connection. Please try again later.', status: 429 });
    const result = device.setCookie ? 'none' : await dev.checkCode(env, order, device.token, f.code);
    if (result === 'ok') {
      await env.DB.prepare('INSERT INTO audit_log (action, summary) VALUES (?1, ?2)').bind('downloads.device', `Another device confirmed with an emailed code for ${order.reference}`).run();
      return redirect(`/download/${token}`);
    }
    return show({ sent: result === 'wrong', status: 422,
      notice: result === 'wrong' ? 'That code isn’t right. Please check the email and try again.'
        : result === 'expired' ? 'That code has run out or has been tried too many times. Please ask for a new code.'
          : 'Please ask for a code first, on this phone or computer.' });
  }
  // send a code
  if (!(await allow(env, request, 'download-code', 6, 3600))) return show({ notice: 'Too many codes have been asked for from this connection. Please try again later.', status: 429 });
  const made = await dev.newCode(env, order, device.token);
  if (made.refused) {
    return show({ status: 429, notice: made.refused === 'too-many-devices' ? 'This meditation has already been set up on several devices. Please contact New Way’s and we’ll help.'
      : made.refused === 'no-email' ? 'We can’t send a code for this purchase. Please contact New Way’s and we’ll help.'
        : 'Several codes have been sent today already. Please use the latest one, or try again tomorrow.' });
  }
  const c = await context(env);
  const msg = build(c.centre, [
    `Your code to download “${order.item_name}” on another phone or computer is:`,
    made.code,
    `It works for ${dev.CODE_MINUTES} minutes, only on the device where you asked for it.`,
    'If you didn’t ask for this code, someone may have your download link. Don’t share this code: without it the link won’t download anything on their device.'
  ], [['Reference', order.reference]]);
  const out = await sendEmail(env, { to: order.customer_email, replyTo: c.replyTo, subject: `Your download code: ${made.code}`, ...msg });
  if (out.status !== 'sent') return show({ notice: 'Sorry, the code couldn’t be emailed just now. Please try again in a few minutes, or contact New Way’s.', status: 503 });
  return show({ sent: true });
}

async function downloadByOrder(request, env, url, reference) {
  const order = await orders.orderForCustomer(env, reference, url.searchParams.get('key'));
  if (!order || order.status !== 'paid' || order.kind !== 'MEDITATION_PURCHASE') return downloadGone(request, env);
  const ent = await env.DB.prepare('SELECT * FROM download_entitlements WHERE order_id = ?1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').bind(order.id).first();
  if (ent && !(await dev.deviceAllowed(request, env, ent))) {
    if (request.method === 'HEAD') return new Response(null, { status: 403, headers: PRIVATE });
    return redirect(`/order/${reference}?key=${encodeURIComponent(url.searchParams.get('key') || '')}`);
  }
  const res = ent ? await dl.deliver(request, env, ent) : null;
  return res || downloadGone(request, env);
}

export async function handleShopRoutes(request, env, url, method, path) {
  const d = path.match(/^\/download\/([^/]{1,100})(\/file|\/code)?$/);
  if (d && d[2] === '/code' && method === 'POST') return downloadCode(request, env, d[1]);
  if (d && d[2] !== '/code' && method === 'GET') return d[2] ? downloadByToken(request, env, d[1]) : downloadPage(request, env, d[1]);
  const od = path.match(/^\/order\/(NW-[A-Z0-9]{6})\/download$/);
  if (od && method === 'GET') return downloadByOrder(request, env, url, od[1]);
  const p = path.match(/^\/meditations\/([a-z0-9-]{1,80})(\/buy)?$/);
  if (p && p[2] && method === 'POST') return buy(request, env, p[1]);
  if (p && !p[2] && method === 'GET') return productPage(request, env, p[1]);
  return null;
}
