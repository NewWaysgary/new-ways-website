// Booking a private reading on the website, the customer's order page, and Square's webhook.
// Everything that matters is decided here on the server: the price comes from the database, the time is checked
// again, and the database itself refuses a second booking for any half hour already held or booked.
import { htmlResponse, redirect, readForm, textResponse } from '../lib/http.js';
import { turnstileConfig, verifyTurnstile, formStamp, stampAge } from '../lib/turnstile.js';
import { allow } from '../lib/ratelimit.js';
import { ukToday, isIsoDate, longDate } from '../lib/dates.js';
import * as data from '../lib/data.js';
import * as pub from '../views/public.js';
import * as view from '../views/booking.js';
import { getBookingSettings, numberSetting, EMAIL_RE } from './config.js';
import { loadRules, bookableStarts, momentOf, slotsFor, addDays, isGridTime, friendlyTime } from './availability.js';
import { squareConfig, squareMode, createPaymentLink, verifyWebhook, SquareError } from '../payments/square.js';
import * as orders from '../orders.js';
import * as dl from '../shop/downloads.js';
import { deviceAllowed } from '../shop/devices.js';
import { normaliseEmail } from '../lib/emails.js';

const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
const show = (body, status = 200) => htmlResponse(body, { status, headers: PRIVATE });

export function bookingOpen(request, env) {
  return !!(squareConfig(env) && turnstileConfig(request, env));
}

export async function activeServices(env) {
  const { results } = await env.DB.prepare('SELECT * FROM reading_services WHERE active = 1 ORDER BY sort_order, id').all();
  return results || [];
}

async function takenSlots(env, from, to) {
  const { results } = await env.DB.prepare('SELECT slot_utc FROM booking_slots WHERE slot_utc >= ?1 AND slot_utc < ?2')
    .bind(momentOf(from, '00:00'), momentOf(addDays(to, 1), '00:00')).all();
  return new Set((results || []).map((r) => r.slot_utc));
}

// What a customer can choose from: today up to the booking horizon, minus the notice period and taken times
async function availability(env, settings, minutes, from, to) {
  const today = ukToday();
  const horizonEnd = addDays(today, numberSetting(settings, 'booking_horizon_weeks') * 7);
  const start = from < today ? today : from;
  const end = to > horizonEnd ? horizonEnd : to;
  if (start > end) return { horizonEnd, byDate: {} };
  const [rules, taken] = await Promise.all([loadRules(env, start, end), takenSlots(env, start, end)]);
  const opts = { nowMs: Date.now(), noticeHours: numberSetting(settings, 'booking_min_notice_hours'), taken };
  const byDate = {};
  for (let d = start; d <= end; d = addDays(d, 1)) byDate[d] = bookableStarts(d, rules, minutes, opts);
  return { horizonEnd, byDate };
}

// ---------- the Private Readings page ----------
export async function readingsPage(ctx) {
  const { env, request } = ctx;
  const [{ private_readings: block }, services] = await Promise.all([data.getBlocks(env, ['private_readings']), activeServices(env)]);
  return view.readingsPage(ctx, { block, services, open: bookingOpen(request, env) && services.length > 0, sandbox: squareMode(env) === 'sandbox' });
}

// ---------- GET /private-readings/book  (calendar) ----------
async function calendar(request, env, url) {
  const ctx = await pub.pageContext(request, env);
  const services = await activeServices(env);
  const service = services.find((s) => s.code === url.searchParams.get('reading'));
  if (!bookingOpen(request, env) || !service) return redirect('/private-readings');
  await orders.releaseExpiredHolds(env, 3);
  const settings = await getBookingSettings(env);
  const today = ukToday();
  const horizonEnd = addDays(today, numberSetting(settings, 'booking_horizon_weeks') * 7);
  const months = [];
  for (let d = today.slice(0, 7) + '-01'; d <= horizonEnd; d = addMonth(d)) months.push(d.slice(0, 7));
  let month = url.searchParams.get('month');
  const selected = isIsoDate(url.searchParams.get('date')) ? url.searchParams.get('date') : null;
  if (selected && !month) month = selected.slice(0, 7);
  let all = null;
  if (!months.includes(month)) {
    // Start on the first month that has a free time
    all = await availability(env, settings, service.minutes, today, horizonEnd);
    month = (Object.keys(all.byDate).find((d) => all.byDate[d].length) || today).slice(0, 7);
  }
  const monthStart = month + '-01', monthEnd = addDays(addMonth(monthStart), -1);
  const avail = all || await availability(env, settings, service.minutes, monthStart, monthEnd);
  const days = [];
  for (let d = monthStart; d <= monthEnd; d = addDays(d, 1)) days.push({ date: d, count: (avail.byDate[d] || []).length });
  const times = selected && selected.slice(0, 7) === month ? (avail.byDate[selected] || []) : [];
  return show(await view.calendarPage(ctx, { service, services, month, months, days, selected: selected && selected.slice(0, 7) === month ? selected : null, times, sandbox: squareMode(env) === 'sandbox' }));
}

function addMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

// Checks a chosen reading, date and time against everything, now. Returns { service } or { problem }.
async function checkChoice(env, settings, services, code, date, time) {
  const service = services.find((s) => s.code === code);
  if (!service || !isIsoDate(date) || !isGridTime(time)) return { problem: 'missing' };
  const avail = await availability(env, settings, service.minutes, date, date);
  if (!(avail.byDate[date] || []).includes(time)) return { service, problem: 'taken' };
  return { service };
}

// ---------- GET /private-readings/book/details ----------
async function details(request, env, url, state = {}) {
  const ctx = await pub.pageContext(request, env);
  const cfg = turnstileConfig(request, env);
  if (!bookingOpen(request, env)) return redirect('/private-readings');
  const services = await activeServices(env);
  const settings = await getBookingSettings(env);
  const p = state.values || Object.fromEntries(url.searchParams);
  await orders.releaseExpiredHolds(env, 3);
  const choice = await checkChoice(env, settings, services, p.reading, p.date, p.time);
  if (choice.problem === 'missing') return redirect('/private-readings');
  if (choice.problem === 'taken') {
    const back = `/private-readings/book?reading=${encodeURIComponent(p.reading)}&month=${String(p.date).slice(0, 7)}&date=${p.date}#times`;
    return show(await view.simpleMessage(ctx, { title: 'Please choose another time', message: `Sorry, ${friendlyTime(p.time)} on ${longDate(p.date)} is no longer available.`, link: back, linkText: 'Choose another time' }), 409);
  }
  return show(await view.detailsPage(ctx, { service: choice.service, date: p.date, time: p.time, policy: settings.booking_cancellation_policy,
    holdMinutes: numberSetting(settings, 'booking_hold_minutes'), stamp: await formStamp(cfg), siteKey: cfg.siteKey,
    values: state.values, errors: state.errors, notice: state.notice, sandbox: squareMode(env) === 'sandbox' }), state.status || 200);
}

export function normalisePhone(raw) {
  const s = String(raw || '').replace(/[\s\-().]/g, '');
  if (/^0\d{10}$/.test(s)) return '+44' + s.slice(1);
  if (/^00\d{10,15}$/.test(s)) return '+' + s.slice(2);
  if (/^\+\d{10,15}$/.test(s)) return s;
  return null;
}

// ---------- POST /private-readings/book ----------
async function book(request, env, url) {
  const cfg = turnstileConfig(request, env);
  const sq = squareConfig(env);
  if (!cfg || !sq) return redirect('/private-readings');
  const origin = request.headers.get('Origin');
  const here = new URL(request.url).origin;
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const f = await readForm(request, 20_000);
  const values = { reading: String(f.reading || ''), date: String(f.date || ''), time: String(f.time || ''),
    name: String(f.name || '').trim(), email: normaliseEmail(f.email), phone: String(f.phone || '').trim(), policy: f.policy === '1' };
  const again = (state) => details(request, env, url, { values, ...state });

  const age = await stampAge(cfg, f.t);
  if (String(f.website || '').trim() || (age !== null && age < 3000)) return redirect('/private-readings');   // a program: keep nothing
  if (age === null || age > 2 * 3600_000) return again({ notice: 'This page was open for a long time. Please check your details and try again.', status: 400 });

  const errors = {};
  if (values.name.length < 2) errors.name = 'Please enter your name.';
  else if (values.name.length > 80) errors.name = 'Please keep your name under 80 characters.';
  if (values.email.length > 254 || !EMAIL_RE.test(values.email)) errors.email = 'Please enter your full email address.';
  const phone = normalisePhone(values.phone);
  if (!phone) errors.phone = 'Please enter the mobile number you use for WhatsApp, for example 07700 900123 or +44 7700 900123.';
  if (!values.policy) errors.policy = 'Please tick to confirm you understand how cancelling and rearranging works.';
  if (Object.keys(errors).length) return again({ errors, status: 422 });

  if (!(await allow(env, request, 'booking', 6, 3600))) {
    return again({ notice: 'We have received a lot of booking attempts from this connection. Please try again later.', status: 429 });
  }
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return again({ notice: 'The security check didn’t complete. Please wait for it to finish, then try again.', status: 400 });
  }
  // a site-wide limit, counted only for requests that passed the spam check
  if (!(await allow(env, { headers: new Headers() }, 'booking-all', 300, 86400))) {
    return again({ notice: 'Online booking is very busy just now. Please try again later.', status: 429 });
  }

  // Check the time again, now, with the price from the database
  await orders.releaseExpiredHolds(env, 3);
  const settings = await getBookingSettings(env);
  const services = await activeServices(env);
  const choice = await checkChoice(env, settings, services, values.reading, values.date, values.time);
  if (choice.problem === 'missing') return redirect('/private-readings');
  if (choice.problem === 'taken') return details(request, env, url, { values });
  const service = choice.service;
  const startUtc = momentOf(values.date, values.time);
  const endUtc = new Date(Date.parse(startUtc) + service.minutes * 60_000).toISOString();
  const holdMinutes = numberSetting(settings, 'booking_hold_minutes');
  const holdUntil = new Date(Date.now() + holdMinutes * 60_000).toISOString();
  const reference = orders.newReference();
  const access = await orders.newAccessKey();
  const itemName = `${service.name}, ${longDate(values.date, '0000')} at ${friendlyTime(values.time)}`;
  const nowIso = new Date().toISOString();
  const orderId = `(SELECT id FROM orders WHERE reference = '${reference}')`;   // reference is our own A-Z/2-9 code
  const bookingId = `(SELECT id FROM bookings WHERE order_id = ${orderId})`;

  try {
    // All or nothing: the order, the appointment and its half-hour slots. A slot already taken makes the whole step fail.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO orders (reference, kind, status, item_name, amount_pence, customer_name, customer_email, customer_phone, terms_text, terms_accepted_at, access_hash, origin, created_at)
        VALUES (?1, 'PRIVATE_READING', 'pending', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(reference, itemName, service.price_pence, values.name, values.email, phone, settings.booking_cancellation_policy, nowIso, access.hash, here, nowIso),
      env.DB.prepare(`INSERT INTO bookings (order_id, service_code, service_name, minutes, price_pence, date, local_start, start_utc, end_utc, status, hold_expires_at, created_at)
        VALUES (${orderId}, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'held', ?9, ?10)`)
        .bind(service.code, service.name, service.minutes, service.price_pence, values.date, values.time, startUtc, endUtc, holdUntil, nowIso),
      ...slotsFor(startUtc, service.minutes).map((s) => env.DB.prepare(`INSERT INTO booking_slots (slot_utc, booking_id) VALUES (?1, ${bookingId})`).bind(s))
    ]);
  } catch (err) {
    if (!/UNIQUE|constraint/i.test(String(err && err.message))) throw err;
    return details(request, env, url, { values });   // someone else took it a moment ago
  }

  // Square's payment page for exactly this order and price
  try {
    const link = await createPaymentLink(sq, { reference, itemName, amountPence: service.price_pence, buyerEmail: values.email, idempotencyKey: reference,
      redirectUrl: `${here}/order/${reference}?key=${encodeURIComponent(access.key)}` });
    await env.DB.prepare('UPDATE orders SET square_payment_link_id = ?1, square_payment_url = ?2, square_order_id = ?3 WHERE reference = ?4')
      .bind(link.id, link.url, link.orderId, reference).run();
  } catch (err) {
    console.error("New Way's: Square payment link not created:", err instanceof SquareError ? `${err.message} ${err.detail}` : err);
    await releaseNow(env, reference);
    return again({ notice: 'Sorry, the secure payment page couldn’t be opened just now, so nothing has been booked or charged. Please try again in a few minutes.', status: 503 });
  }
  return redirect(`/order/${reference}?key=${encodeURIComponent(access.key)}`);
}

async function releaseNow(env, reference) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE reference = ?1').bind(reference).first();
  if (!order) return;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM booking_slots WHERE booking_id IN (SELECT id FROM bookings WHERE order_id = ?1)`).bind(order.id),
    env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?1 WHERE order_id = ?2`).bind(new Date().toISOString(), order.id),
    env.DB.prepare(`UPDATE orders SET status = 'cancelled', note = 'The Square payment page could not be created.' WHERE id = ?1`).bind(order.id)
  ]);
}

// ---------- GET /order/NW-XXXXXX?key=…  (the customer's own page; also where Square sends them back) ----------
async function orderStatus(request, env, url, reference) {
  const key = url.searchParams.get('key');
  let order = await orders.orderForCustomer(env, reference, key);
  const ctx = await pub.pageContext(request, env);
  if (!order) return show(await view.simpleMessage(ctx, { title: 'Order not found', message: 'This link isn’t complete or has expired. Please use the link from your email.', link: '/', linkText: 'Go to the home screen' }), 404);
  let checkFailed = false;
  if (order.status === 'pending' && order.square_order_id) {
    // Coming back from Square is NOT proof of payment: Square itself is asked.
    try { await orders.checkWithSquare(env, order); }
    catch (err) { checkFailed = true; console.error("New Way's: could not check an order with Square:", err && err.message); }
    order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(order.id).first();
  }
  const booking = order.kind === 'PRIVATE_READING' ? await orders.bookingForOrder(env, order.id) : null;
  if (booking && booking.status === 'held' && Date.parse(booking.hold_expires_at) < Date.now()) await orders.releaseExpiredHolds(env, 3);
  const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(order.id).first();
  const bk = booking ? await orders.bookingForOrder(env, order.id) : null;
  const holdOk = bk ? bk.status === 'held' && Date.parse(bk.hold_expires_at) > Date.now() : fresh.status === 'pending';
  let download = null;
  if (fresh.kind === 'MEDITATION_PURCHASE' && fresh.status === 'paid') {
    let ent = await env.DB.prepare(`SELECT * FROM download_entitlements WHERE order_id = ?1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`).bind(fresh.id).first();
    if (!ent && !(await env.DB.prepare('SELECT 1 FROM download_entitlements WHERE order_id = ?1').bind(fresh.id).first())) {
      // paid, but making the link failed earlier: make it now (the email follows from the hourly job)
      const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(fresh.product_id).first();
      if (product && product.full_key) {
        await orders.createDownload(env, fresh, product);
        ent = await env.DB.prepare(`SELECT * FROM download_entitlements WHERE order_id = ?1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`).bind(fresh.id).first();
      }
    }
    if (ent) download = { state: dl.downloadState(ent), expires: ent.expires_at, windowEnds: dl.windowEndsAt(ent), otherDevice: !(await deviceAllowed(request, env, ent)) };
  }
  const holdUntil = bk && bk.hold_expires_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(bk.hold_expires_at)).replace(' ', '').toLowerCase() : '';
  return show(await view.orderPage(ctx, { order: fresh, booking: bk, key, sandbox: squareMode(env) === 'sandbox', checkFailed,
    payUrl: holdOk && /^(https:\/\/|http:\/\/localhost[:/])/.test(fresh.square_payment_url) ? fresh.square_payment_url : '', holdUntil, download }));
}

// Reads a request body as text, giving up (null) past `max` bytes even when no length was declared
async function readLimited(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

// ---------- POST /webhooks/square ----------
async function squareWebhook(request, env) {
  const cfg = squareConfig(env);
  if (!cfg || !cfg.signatureKey) return textResponse('Not configured', { status: 503 });
  if (Number(request.headers.get('Content-Length') || 0) > 1_000_000) return textResponse('Too large', { status: 413 });
  const raw = await readLimited(request, 1_000_000);
  if (raw === null) return textResponse('Too large', { status: 413 });
  if (!(await verifyWebhook(cfg.signatureKey, request.url, raw, request.headers.get('x-square-hmacsha256-signature')))) {
    return textResponse('Forbidden', { status: 403 });
  }
  let event;
  try { event = JSON.parse(raw); } catch { return textResponse('Bad request', { status: 400 }); }
  const id = String(event.event_id || '');
  if (!id) return textResponse('Bad request', { status: 400 });
  if (await env.DB.prepare('SELECT 1 FROM square_events WHERE event_id = ?1').bind(id).first()) return textResponse('Already received');
  let outcome = 'ignored';
  const payment = event?.data?.object?.payment;
  if (/^payment\.(created|updated)$/.test(String(event.type)) && payment) outcome = await orders.paymentArrived(env, payment);
  const order = payment && payment.order_id ? await env.DB.prepare('SELECT id FROM orders WHERE square_order_id = ?1').bind(payment.order_id).first() : null;
  await env.DB.prepare('INSERT OR IGNORE INTO square_events (event_id, type, order_id, outcome) VALUES (?1, ?2, ?3, ?4)')
    .bind(id, String(event.type || '').slice(0, 60), order ? order.id : null, String(outcome).slice(0, 60)).run();
  return textResponse('OK');
}

// ---------- routing ----------
export async function handleBookingRoutes(request, env, url, method, path) {
  if (path === '/webhooks/square') return method === 'POST' ? squareWebhook(request, env) : textResponse('Method not allowed', { status: 405 });
  if (path === '/private-readings/book') {
    if (method === 'POST') return book(request, env, url);
    if (method === 'GET') return calendar(request, env, url);
  }
  if (path === '/private-readings/book/details' && method === 'GET') return details(request, env, url);
  const o = path.match(/^\/order\/(NW-[A-Z0-9]{6})$/);
  if (o && method === 'GET') return orderStatus(request, env, url, o[1]);
  return null;
}
