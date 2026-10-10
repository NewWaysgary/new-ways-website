// Wednesday advance payments on the website: OPTIONAL, for people who prefer to pay before they come.
// "No booking required. Everyone is welcome to come along and pay at the door." The only detail asked for is an
// email address. Prices come from the door till's buttons (the same products and prices). Square takes the payment.
import { htmlResponse, redirect, readForm, textResponse } from '../lib/http.js';
import { turnstileConfig, verifyTurnstile, formStamp, stampAge } from '../lib/turnstile.js';
import { allow } from '../lib/ratelimit.js';
import { normaliseEmail } from '../lib/emails.js';
import { EMAIL_RE } from '../bookings/config.js';
import { squareConfig, squareMode, createPaymentLink, SquareError } from '../payments/square.js';
import { newAccessKey, sha256Hex } from '../orders.js';
import { qrPng, qrSvg } from '../lib/qr.js';
import { ukToday, longDate } from '../lib/dates.js';
import * as pub from '../views/public.js';
import * as view from '../views/wednesday.js';
import * as w from './model.js';
import { loadOrder, checkWedWithSquare } from './payments.js';

const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
const show = (body, status = 200) => htmlResponse(body, { status, headers: PRIVATE });

export async function prepaySettings(env) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('wed_prepay_open', 'wed_prepay_weeks', 'wed_prepay_cutoff')`).all();
  const s = Object.fromEntries((results || []).map((r) => [r.key, r.value]));
  return { open: s.wed_prepay_open !== '0', weeks: Math.min(12, Math.max(1, Number(s.wed_prepay_weeks) || 4)), cutoff: /^\d{2}:\d{2}$/.test(s.wed_prepay_cutoff || '') ? s.wed_prepay_cutoff : '19:00' };
}

// The Wednesdays a customer can pay for now: the next few, not closed, and not past the cut-off time
export async function payableNights(env, settings) {
  const dates = w.nextWednesdays(settings.weeks);
  const [{ results: closed }, { results: mediums }] = await Promise.all([
    env.DB.prepare(`SELECT night_date, closure_reason FROM wed_nights WHERE closed_for_public = 1 AND night_date >= ?1`).bind(dates[0]).all(),
    env.DB.prepare(`SELECT date, name FROM mediums WHERE visible = 1 AND date >= ?1 ORDER BY date, sort_order, id`).bind(dates[0]).all()
  ]);
  const closedMap = new Map((closed || []).map((r) => [r.night_date, r.closure_reason]));
  const now = Date.now();
  return dates.map((date) => ({
    date, medium: ((mediums || []).find((m) => m.date === date) || {}).name || '',
    closed: closedMap.has(date), reason: closedMap.get(date) || '',
    tooLate: Date.parse(w.prepayCutoffUtc(date, settings.cutoff)) <= now
  }));
}

export const prepayOpen = (request, env) => !!(squareConfig(env) && turnstileConfig(request, env));

async function payPage(request, env, url, state = {}) {
  const ctx = await pub.pageContext(request, env);
  const settings = await prepaySettings(env);
  const cfg = turnstileConfig(request, env);
  const open = prepayOpen(request, env) && settings.open;
  const [nights, items] = await Promise.all([payableNights(env, settings), w.tillItems(env, { enabledOnly: true, onlineOnly: true })]);
  const want = url.searchParams.get('night');
  return show(await view.payPage(ctx, { nights, items, open, sandbox: squareMode(env) === 'sandbox', settings,
    stamp: open ? await formStamp(cfg) : '', siteKey: cfg ? cfg.siteKey : '', values: { night: want || '', ...(state.values || {}) }, ...state }), state.status || 200);
}

async function createPrepay(request, env, url) {
  const cfg = turnstileConfig(request, env);
  const sq = squareConfig(env);
  const settings = await prepaySettings(env);
  if (!cfg || !sq || !settings.open) return redirect('/whos-on/pay');
  const here = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const f = await readForm(request, 20_000);
  const items = await w.tillItems(env, { enabledOnly: true, onlineOnly: true });
  const values = { night: String(f.night || ''), email: normaliseEmail(f.email), qty: Object.fromEntries(items.map((i) => [i.id, String(f['q' + i.id] || '0')])) };
  const again = (state) => payPage(request, env, url, { values, ...state });
  const age = await stampAge(cfg, f.t);
  if (String(f.website || '').trim() || (age !== null && age < 3000)) return redirect('/whos-on');
  if (age === null || age > 3 * 3600_000) return again({ notice: 'This page was open for a long time. Please check the details and try again.', status: 400 });

  const errors = {};
  const nights = await payableNights(env, settings);
  const chosen = nights.find((n) => n.date === values.night);
  if (!chosen) errors.night = 'Please choose the Wednesday you are coming.';
  else if (chosen.closed) errors.night = `New Way’s is closed on ${longDate(chosen.date)}${chosen.reason ? ': ' + chosen.reason : ''}.`;
  else if (chosen.tooLate) errors.night = 'Paying online for this evening has closed. Please pay at the door.';
  const basket = w.priceBasket(items, items.map((i) => ({ item_id: i.id, qty: Number(values.qty[i.id]) })), { online: true });
  if (basket.errors.length) errors.items = basket.errors[0];
  else if (!basket.lines.length) errors.items = 'Please choose at least one thing to pay for.';
  else if (basket.total < 100) errors.items = 'The smallest amount that can be paid online is £1.';
  if (values.email.length > 254 || !EMAIL_RE.test(values.email)) errors.email = 'Please enter your full email address, so we can send your QR code.';
  if (Object.keys(errors).length) return again({ errors, status: 422 });
  if (!(await allow(env, request, 'wed-prepay', 8, 3600))) return again({ notice: 'We have received a lot of payments from this connection. Please try again later.', status: 429 });
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return again({ notice: 'The security check didn’t complete. Please wait for it to finish, then try again.', status: 400 });
  }

  const reference = w.newWedReference();
  const access = await newAccessKey();
  const nowIso = new Date().toISOString();
  const steps = [env.DB.prepare(`INSERT INTO wed_orders (reference, night_date, email, status, total_pence, checkin_token, access_hash, origin, created_at)
      VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?8)`).bind(reference, chosen.date, values.email, basket.total, w.newWedToken(), await sha256Hex('wed:' + access.key), here, nowIso)];
  for (const l of basket.lines) {
    steps.push(env.DB.prepare(`INSERT INTO wed_order_lines (order_id, item_id, label, category, unit_pence, qty, line_pence) VALUES ((SELECT id FROM wed_orders WHERE reference = ?1), ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(reference, l.item_id, l.label, l.category, l.unit_pence, l.qty, l.line_pence));
  }
  await env.DB.batch(steps);
  try {
    const link = await createPaymentLink(sq, { reference, itemName: `New Way’s Wednesday ${longDate(chosen.date, '0000')}: ${w.summaryText(basket.lines)}`, amountPence: basket.total,
      buyerEmail: values.email, idempotencyKey: reference, redirectUrl: `${here}/wednesday/${reference}?key=${encodeURIComponent(access.key)}` });
    await env.DB.prepare('UPDATE wed_orders SET square_payment_link_id = ?1, square_payment_url = ?2, square_order_id = ?3 WHERE reference = ?4').bind(link.id, link.url, link.orderId, reference).run();
    return redirect(link.url);
  } catch (err) {
    console.error("New Way's: Square payment link not created (Wednesday):", err instanceof SquareError ? `${err.message} ${err.detail}` : err);
    await env.DB.prepare(`UPDATE wed_orders SET status = 'cancelled', cancelled_at = ?1, note = 'The Square payment page could not be created.' WHERE reference = ?2`).bind(nowIso, reference).run();
    return again({ notice: 'Sorry, the secure payment page couldn’t be opened just now, so nothing has been charged. Please try again in a few minutes, or simply pay at the door.', status: 503 });
  }
}

async function orderStatus(request, env, url, reference) {
  const key = url.searchParams.get('key') || '';
  const ctx = await pub.pageContext(request, env);
  let o = /^WN-[A-Z0-9]{6}$/.test(reference) && key && key.length < 100 ? await env.DB.prepare('SELECT * FROM wed_orders WHERE reference = ?1').bind(reference).first() : null;
  if (!o || (await sha256Hex('wed:' + key)) !== o.access_hash) {
    return show(await view.messagePage(ctx, { title: 'Payment not found', message: 'This link isn’t complete or has expired. Please use the link from your email.' }), 404);
  }
  let checkFailed = false;
  if (o.status === 'pending' && o.square_order_id) {
    try { await checkWedWithSquare(env, o); } catch (err) { checkFailed = true; console.error("New Way's: could not check a Wednesday payment with Square:", err && err.message); }
  }
  o = await loadOrder(env, 'id', o.id);
  const n = await w.night(env, o.night_date);
  return show(await view.statusPage(ctx, { order: o, night: n, checkFailed, sandbox: squareMode(env) === 'sandbox', self: `/wednesday/${o.reference}?key=${encodeURIComponent(key)}`,
    payUrl: o.status === 'pending' && /^(https:\/\/|http:\/\/localhost[:/])/.test(o.square_payment_url) ? o.square_payment_url : '',
    qr: o.status === 'paid' ? qrSvg(w.wedCheckinUrl(o.origin, o.checkin_token), { label: 'Your QR code for the door' }) : '' }));
}

// /w/TOKEN: what the QR code opens (no personal details)
async function qrPage(request, env, token) {
  const ctx = await pub.pageContext(request, env);
  const o = w.isWedToken(token) ? await loadOrder(env, 'token', token) : null;
  if (!o) return show(await view.messagePage(ctx, { title: 'Not found', message: 'This QR code doesn’t match a New Way’s payment.' }), 404);
  const valid = o.status === 'paid' && !o.refunded_at;
  return show(await view.qrPage(ctx, { order: o, valid, qr: valid ? qrSvg(w.wedCheckinUrl(o.origin || new URL(request.url).origin, o.checkin_token), { label: 'QR code for the door' }) : '' }));
}

async function qrImage(env, token) {
  const o = w.isWedToken(token) ? await env.DB.prepare(`SELECT origin, checkin_token FROM wed_orders WHERE checkin_token = ?1 AND status = 'paid'`).bind(token).first() : null;
  if (!o) return textResponse('Not found', { status: 404 });
  return new Response(qrPng(w.wedCheckinUrl(o.origin, o.checkin_token), { scale: 8 }), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', 'X-Robots-Tag': 'noindex' } });
}

export async function handleWednesdayRoutes(request, env, url, method, path) {
  if (path === '/whos-on/pay') {
    if (method === 'GET') return payPage(request, env, url);
    if (method === 'POST') return createPrepay(request, env, url);
    return textResponse('Method not allowed', { status: 405 });
  }
  const s = path.match(/^\/wednesday\/(WN-[A-Z0-9]{6})$/);
  if (s && method === 'GET') return orderStatus(request, env, url, s[1]);
  const q = path.match(/^\/w\/([A-Za-z0-9_-]{1,64})$/);
  if (q && method === 'GET') return qrPage(request, env, q[1]);
  const qi = path.match(/^\/wq\/([A-Za-z0-9_-]{1,64})\.png$/);
  if (qi && method === 'GET') return qrImage(env, qi[1]);
  return null;
}

export { ukToday };
