// The public Gift Vouchers page: /gift-vouchers (conditions and purchase details, no price), /gift-vouchers/review
// (the total, agree, then Square), /gift-vouchers/buy, the purchaser's own page and the printable voucher.
// The price always comes from the database; nothing the browser sends can change it or the voucher's travel cover.
import { htmlResponse, redirect, readForm, textResponse } from '../lib/http.js';
import { turnstileConfig, verifyTurnstile, formStamp, stampAge } from '../lib/turnstile.js';
import { allow } from '../lib/ratelimit.js';
import * as pub from '../views/public.js';
import * as view from '../views/gift-vouchers.js';
import { getBookingSettings, EMAIL_RE } from './config.js';
import { squareConfig, squareMode, createPaymentLink, SquareError } from '../payments/square.js';
import { normaliseEmail } from '../lib/emails.js';
import * as vouchers from './vouchers.js';
import * as sales from './voucher-sales.js';
import { audit } from '../lib/data.js';

const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
const show = (body, status = 200) => htmlResponse(body, { status, headers: PRIVATE });
const salesOpen = (request, env) => !!(squareConfig(env) && turnstileConfig(request, env));
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function readValues(f) {
  return { reading: String(f.reading || '').slice(0, 40), name: clean(f.name, 100), email: normaliseEmail(f.email),
    delivery: f.delivery === 'recipient' ? 'recipient' : f.delivery === 'purchaser' ? 'purchaser' : '',
    recipient_name: clean(f.recipient_name, 100), recipient_email: f.recipient_email ? normaliseEmail(f.recipient_email) : '',
    message: clean(f.message, sales.MESSAGE_MAX + 50), conditions: f.conditions === '1' ? '1' : '', t: String(f.t || '') };
}

function valueErrors(values, services) {
  const errors = {};
  if (values.conditions !== '1') errors.conditions = 'Please tick to confirm you have read the WhatsApp Video Call and Home Visit conditions.';
  if (!services.find((s) => s.code === values.reading)) errors.reading = 'Please choose the 30 minute or 60 minute reading.';
  if (values.name.length < 2) errors.name = 'Please enter your full name.';
  else if (values.name.length > 80) errors.name = 'Please keep your name under 80 characters.';
  if (values.email.length > 254 || !EMAIL_RE.test(values.email)) errors.email = 'Please enter your full email address.';
  if (!values.delivery) errors.delivery = 'Please choose how the voucher should be delivered.';
  if (values.recipient_name.length > 80) errors.recipient_name = 'Please keep the name under 80 characters.';
  else if (values.delivery === 'recipient' && values.recipient_name.length < 2) errors.recipient_name = 'Please enter the recipient’s name, so the voucher can be addressed to them.';
  if (values.delivery === 'recipient' && (values.recipient_email.length > 254 || !EMAIL_RE.test(values.recipient_email))) errors.recipient_email = 'Please enter the recipient’s full email address.';
  if (values.message.length > sales.MESSAGE_MAX) errors.message = `Please keep the message to ${sales.MESSAGE_MAX} characters.`;
  return errors;
}

// ---------- GET /gift-vouchers (and the details form shown again with what was typed) ----------
async function formPage(request, env, state = {}) {
  const ctx = await pub.pageContext(request, env);
  const cfg = turnstileConfig(request, env);
  const services = await sales.voucherServices(env);
  const open = salesOpen(request, env) && services.length > 0;
  const settings = await getBookingSettings(env);
  const age = state.values && state.values.t && cfg ? await stampAge(cfg, state.values.t) : null;
  const stamp = !cfg ? '' : age !== null && age < 90 * 60_000 ? state.values.t : await formStamp(cfg);
  const out = view.giftVouchersPage(ctx, { services, open, values: state.values, errors: state.errors, notice: state.notice, stamp, sandbox: squareMode(env) === 'sandbox', validMonths: sales.validMonths(settings) });
  // the page itself is public (and can be found in search); the same form answered with someone's details is private
  return state.values ? show(out, state.status || 200) : htmlResponse(out, { headers: { 'Cache-Control': 'no-store' } });
}

async function reviewPage(request, env, values, state = {}) {
  const ctx = await pub.pageContext(request, env);
  const cfg = turnstileConfig(request, env);
  const services = await sales.voucherServices(env);
  const service = services.find((s) => s.code === values.reading);
  const settings = await getBookingSettings(env);
  const months = sales.validMonths(settings);
  return show(view.reviewPage(ctx, { service, values, stamp: values.t, siteKey: cfg.siteKey, validMonths: months, expiresOn: sales.expiryFor(months),
    errors: state.errors, notice: state.notice, sandbox: squareMode(env) === 'sandbox' }), state.status || 200);
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

// ---------- POST /gift-vouchers/review ----------
async function review(request, env) {
  if (!salesOpen(request, env)) return redirect('/gift-vouchers');
  if (!sameOrigin(request)) return textResponse('Forbidden', { status: 403 });
  const f = await readForm(request, 20_000);
  if (String(f.website || '').trim()) return redirect('/gift-vouchers');   // a program: keep nothing
  const values = readValues(f);
  if (f.edit === '1') return formPage(request, env, { values });
  const services = await sales.voucherServices(env);
  const errors = valueErrors(values, services);
  if (Object.keys(errors).length) return formPage(request, env, { values, errors, status: 422 });
  if (!(await allow(env, request, 'voucher-review', 40, 3600))) return formPage(request, env, { values, notice: 'We have received a lot of attempts from this connection. Please try again later.', status: 429 });
  const cfg = turnstileConfig(request, env);
  const age = await stampAge(cfg, values.t);
  if (age === null || age > 2 * 3600_000) values.t = await formStamp(cfg);
  return reviewPage(request, env, values);
}

// ---------- POST /gift-vouchers/buy ----------
async function buy(request, env) {
  const cfg = turnstileConfig(request, env);
  const sq = squareConfig(env);
  if (!cfg || !sq) return redirect('/gift-vouchers');
  if (!sameOrigin(request)) return textResponse('Forbidden', { status: 403 });
  const here = new URL(request.url).origin;
  const f = await readForm(request, 20_000);
  const values = readValues(f);
  const age = await stampAge(cfg, values.t);
  if (String(f.website || '').trim() || (age !== null && age < 3000)) return redirect('/gift-vouchers');   // a program: keep nothing
  const services = await sales.voucherServices(env);
  const errors = valueErrors(values, services);
  if (Object.keys(errors).length) return formPage(request, env, { values, errors, status: 422 });
  if (age === null || age > 2 * 3600_000) { values.t = await formStamp(cfg); return reviewPage(request, env, values, { notice: 'This page was open for a long time. Please check the details and try again.', status: 400 }); }
  if (f.agree !== '1') return reviewPage(request, env, values, { errors: { agree: 'Please tick to agree to the total before paying.' }, status: 422 });
  if (!(await allow(env, request, 'voucher-buy', 6, 3600))) return reviewPage(request, env, values, { notice: 'We have received a lot of attempts from this connection. Please try again later.', status: 429 });
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return reviewPage(request, env, values, { notice: 'The security check didn’t complete. Please wait for it to finish, then try again.', status: 400 });
  }
  if (!(await allow(env, { headers: new Headers() }, 'voucher-buy-all', 200, 86400))) return reviewPage(request, env, values, { notice: 'Online gift voucher sales are very busy just now. Please try again later.', status: 429 });

  const service = services.find((s) => s.code === values.reading);   // the price comes from the database
  const settings = await getBookingSettings(env);
  const months = sales.validMonths(settings);
  const reference = sales.newPurchaseReference();
  const keys = await sales.newPurchaseKeys();
  const nowIso = new Date().toISOString();
  const terms = [`Gift voucher: one ${service.minutes} minute private reading (${service.name}). Total ${'£' + (service.price_pence / 100).toFixed(2)}, agreed before payment.`,
    `Valid for ${months} months (until ${sales.expiryFor(months).split('-').reverse().join('/')} if bought today).`,
    'WhatsApp Video Call: the voucher covers the full cost of the private reading; no additional travel charges.',
    'Home Visit (In Person): the voucher covers the reading itself; an additional travel charge of 60p per mile applies to the complete return journey; Home Visits only within 20 driving miles one way of Gary’s home location; the recipient can choose a WhatsApp Video Call instead, with no additional charges.'].join('\n');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO voucher_purchases (reference, status, service_code, service_name, minutes, amount_pence, purchaser_name, purchaser_email, delivery, recipient_name, recipient_email, message,
        terms_text, terms_accepted_at, access_hash, print_key, origin, created_at)
      VALUES (?1, 'pending', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?13)`)
      .bind(reference, service.code, service.name, service.minutes, service.price_pence, values.name, values.email, values.delivery, values.recipient_name,
        values.delivery === 'recipient' ? values.recipient_email : '', values.message, terms, nowIso, keys.hash, keys.printKey, here),
    audit(env, 'vouchers.purchase_started', `Gift voucher purchase started: ${reference}, ${service.minutes} minute reading`)
  ]);
  try {
    const link = await createPaymentLink(sq, { reference, itemName: `New Way’s gift voucher: ${service.minutes} minute private reading`, amountPence: service.price_pence,
      buyerEmail: values.email, idempotencyKey: reference, redirectUrl: `${here}/gift-vouchers/order/${reference}?key=${encodeURIComponent(keys.key)}` });
    await env.DB.prepare('UPDATE voucher_purchases SET square_payment_link_id = ?1, square_payment_url = ?2, square_order_id = ?3 WHERE reference = ?4')
      .bind(link.id, link.url, link.orderId, reference).run();
  } catch (err) {
    console.error("New Way's: Square payment link not created (gift voucher):", err instanceof SquareError ? `${err.message} ${err.detail}` : err);
    await env.DB.prepare(`UPDATE voucher_purchases SET status = 'expired', note = 'The Square payment page could not be created.' WHERE reference = ?1 AND status = 'pending'`).bind(reference).run();
    return reviewPage(request, env, values, { notice: 'Sorry, the secure payment page couldn’t be opened just now, so nothing has been charged. Please try again in a few minutes.', status: 503 });
  }
  return redirect(`/gift-vouchers/order/${reference}?key=${encodeURIComponent(keys.key)}`);
}

// ---------- GET /gift-vouchers/order/NWV-XXXXXX?key=… ----------
async function purchaseStatus(request, env, url, reference) {
  const key = url.searchParams.get('key');
  let p = await sales.purchaseForCustomer(env, reference, key);
  const ctx = await pub.pageContext(request, env);
  if (!p) return show(await pub.notFoundPage(ctx), 404);
  let checkFailed = false;
  if ((p.status === 'pending' || p.status === 'expired') && p.square_order_id) {
    // Coming back from Square is NOT proof of payment: Square itself is asked.
    try { await sales.checkPurchaseWithSquare(env, p); }
    catch (err) { checkFailed = true; console.error("New Way's: could not check a gift voucher purchase with Square:", err && err.message); }
  } else if (p.status === 'paid' && !p.voucher_id) {
    await sales.markVoucherPaid(env, p, { status: 'COMPLETED', id: p.square_payment_id, amount_money: { amount: p.amount_pence, currency: 'GBP' } });
  }
  p = await env.DB.prepare('SELECT * FROM voucher_purchases WHERE id = ?1').bind(p.id).first();
  const voucher = p.voucher_id ? await env.DB.prepare('SELECT * FROM gift_vouchers WHERE id = ?1').bind(p.voucher_id).first() : null;
  return show(view.purchasePage(ctx, { p, voucher, self: `/gift-vouchers/order/${p.reference}?key=${encodeURIComponent(key)}`, checkFailed, sandbox: squareMode(env) === 'sandbox',
    payUrl: p.status === 'pending' && /^(https:\/\/|http:\/\/localhost[:/])/.test(p.square_payment_url || '') ? p.square_payment_url : '' }));
}

// ---------- GET /gift-vouchers/print/<key>  (the printable A4 voucher; the private link from the email) ----------
async function printVoucher(request, env, key) {
  const p = await env.DB.prepare('SELECT * FROM voucher_purchases WHERE print_key = ?1').bind(key).first();
  const v = p && p.voucher_id ? await env.DB.prepare('SELECT * FROM gift_vouchers WHERE id = ?1').bind(p.voucher_id).first() : null;
  if (!p || p.status !== 'paid' || !v || v.status === 'cancelled') {
    return show(`<!doctype html><meta charset="utf-8"><title>Voucher not available</title><body style="background:#000428;color:#fff;font-family:sans-serif;padding:24px"><p>This voucher link isn’t available. If you think it should be, please contact New Way’s.</p><p><a style="color:#F8B709" href="/">Go to the home screen</a></p></body>`, 404);
  }
  const templates = await vouchers.loadTemplates(env, request.url);
  if (!templates) return textResponse('The voucher could not be prepared just now. Please try again in a moment.', { status: 503, headers: PRIVATE });
  const bytes = vouchers.voucherPdf(sales.withPersonal(v, p), new URL(request.url).origin, templates);
  return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="New-Ways-gift-voucher-${v.code}.pdf"`, ...PRIVATE, 'Cache-Control': 'private, no-store' } });
}

export async function handleGiftVoucherRoutes(request, env, url, method, path) {
  if (path === '/gift-vouchers') {
    if (method === 'GET') return formPage(request, env);
    return textResponse('Method not allowed', { status: 405 });
  }
  if (path === '/gift-vouchers/review' && method === 'POST') return review(request, env);
  if (path === '/gift-vouchers/review' && method === 'GET') return redirect('/gift-vouchers');
  if (path === '/gift-vouchers/buy' && method === 'POST') return buy(request, env);
  const o = path.match(/^\/gift-vouchers\/order\/(NWV-[A-Z0-9]{6})$/);
  if (o && method === 'GET') return purchaseStatus(request, env, url, o[1]);
  const pr = path.match(/^\/gift-vouchers\/print\/([A-Za-z0-9_-]{20,64})$/);
  if (pr && method === 'GET') {
    if (!(await allow(env, request, 'voucher-print', 60, 3600))) return textResponse('Too many requests. Please try again later.', { status: 429, headers: PRIVATE });
    return printVoucher(request, env, pr[1]);
  }
  return null;
}

