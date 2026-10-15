// Booking event tickets on the website, the customer's booking page, the QR ticket page and its image,
// and the mailing list's Join and Unsubscribe pages.
import { htmlResponse, redirect, readForm, textResponse } from '../lib/http.js';
import { turnstileConfig, verifyTurnstile, formStamp, stampAge } from '../lib/turnstile.js';
import { allow } from '../lib/ratelimit.js';
import * as pub from '../views/public.js';
import * as view from '../views/tickets.js';
import { getBookingSettings, numberSetting, EMAIL_RE } from '../bookings/config.js';
import { squareConfig, squareMode, createPaymentLink, SquareError } from '../payments/square.js';
import { newAccessKey, sha256Hex } from '../orders.js';
import { normaliseEmail } from '../lib/emails.js';
import { qrPng, qrSvg } from '../lib/qr.js';
import * as m from './model.js';
import { checkEventWithSquare, releaseExpiredEventHolds } from './payments.js';
import { reservationForKey } from './reservations.js';
import { subscribe, joinWording, unsubscribeByToken } from '../mailing.js';

const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
const show = (body, status = 200) => htmlResponse(body, { status, headers: PRIVATE });

export const ticketsOpen = (request, env) => !!(squareConfig(env) && turnstileConfig(request, env));

async function loadEvent(env, id) {
  const event = await m.getEvent(env, id);
  return event && event.visible ? event : null;
}

async function stateOf(env, event) {
  const counts = await m.placeCounts(env, event.id);
  return { counts, state: m.salesState(event, counts.taken), left: m.placesLeft(event, counts.taken) };
}

// ---------- GET /events/ID/book ----------
async function start(request, env, url, event) {
  const ctx = await pub.pageContext(request, env);
  if (!ticketsOpen(request, env)) return show(await view.closedPage(ctx, { event, state: 'off', settings: ctx.settings }));
  await releaseExpiredEventHolds(env, 2);
  const { state, left } = await stateOf(env, event);
  if (state !== 'open') return show(await view.closedPage(ctx, { event, state, settings: ctx.settings, opensAt: event.sales_open_at }));
  const max = Math.min(Number(event.max_per_booking) || 10, m.MAX_TICKETS, left);
  const qty = Number(url.searchParams.get('qty'));
  const sandbox = squareMode(env) === 'sandbox';
  if (!Number.isInteger(qty) || qty < 1 || qty > max) return show(await view.quantityPage(ctx, { event, settings: ctx.settings, max, left, sandbox }));
  const questions = await m.questionsFor(env, event.id);
  const cfg = turnstileConfig(request, env);
  return show(await view.detailsPage(ctx, { event, settings: ctx.settings, qty, questions, stamp: await formStamp(cfg), sandbox, max }));
}

// ---------- POST /events/ID/book  (review, change details, confirm and pay) ----------
async function post(request, env, url, event) {
  const cfg = turnstileConfig(request, env);
  const sq = squareConfig(env);
  if (!cfg || !sq) return redirect('/events');
  const here = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const f = await readForm(request, 60_000);
  const ctx = await pub.pageContext(request, env);
  const sandbox = squareMode(env) === 'sandbox';
  const settings = await getBookingSettings(env);
  const holdMinutes = numberSetting(settings, 'booking_hold_minutes');
  const { state, left } = await stateOf(env, event);
  if (state !== 'open') return show(await view.closedPage(ctx, { event, state, settings: ctx.settings, opensAt: event.sales_open_at }), 409);
  const max = Math.min(Number(event.max_per_booking) || 10, m.MAX_TICKETS, left);
  const questions = await m.questionsFor(env, event.id);
  const qty = Number(f.qty);
  const form = async (state2 = {}) => show(await view.detailsPage(ctx, { event, settings: ctx.settings, qty, questions, fields: f, sandbox, max,
    stamp: await formStamp(cfg), ...state2 }), state2.status || 200);
  if (!Number.isInteger(qty) || qty < 1) return redirect(`/events/${event.id}/book`);
  if (qty > max) {
    const notice = left < qty ? `Sorry, only ${left} ${left === 1 ? 'place is' : 'places are'} left now. Please choose a smaller number of tickets.` : '';
    return show(await view.quantityPage(ctx, { event, settings: ctx.settings, max, left, sandbox, notice }), 409);
  }

  if (f.step === 'edit') return form();

  const { values, errors } = m.readBookingForm(f, event, questions);
  // The review screen carries this booking's own reference and private key, so pressing CONFIRM twice (or going back
  // and pressing it again) opens the same booking instead of holding a second set of places.
  const validRef = /^EV-[A-Z0-9]{6}$/.test(String(f.ref || '')) && /^[A-Za-z0-9_-]{20,64}$/.test(String(f.k || ''));
  const once = validRef ? { ref: f.ref, k: f.k } : { ref: m.newEventReference(), k: (await newAccessKey()).key };
  const review = async (extra = {}) => show(await view.reviewPage(ctx, { event, settings: ctx.settings, values, hidden: [...m.hiddenFields(values), ['ref', once.ref], ['k', once.k]], totalPence: event.price_pence * values.qty,
    holdMinutes, siteKey: cfg.siteKey, sandbox, ...extra }), extra.status || 200);

  if (f.step !== 'confirm') {
    // from the guest details form: spam checks, then the REVIEW YOUR BOOKING screen
    const age = await stampAge(cfg, f.t);
    if (String(f.website || '').trim() || (age !== null && age < 3000)) return redirect('/events');
    if (age === null || age > 3 * 3600_000) return form({ notice: 'This page was open for a long time. Please check the details and try again.', status: 400 });
    if (Object.keys(errors).length) return form({ errors, status: 422 });
    if (!(await allow(env, request, 'tickets-review', 40, 3600))) return form({ notice: 'Too many attempts from this connection. Please try again later.', status: 429 });
    return review();
  }

  // CONFIRM & PAY SECURELY
  if (validRef) {
    const existing = await env.DB.prepare('SELECT access_hash, status FROM event_bookings WHERE reference = ?1').bind(once.ref).first();
    if (existing && existing.status !== 'cancelled' && existing.access_hash === (await sha256Hex('event:' + once.k))) return redirect(`/tickets/${once.ref}?key=${encodeURIComponent(once.k)}`);
    if (existing) { once.ref = m.newEventReference(); once.k = (await newAccessKey()).key; }   // e.g. trying again after Square couldn't be reached
  }
  if (Object.keys(errors).length) return form({ errors, notice: 'Some details need checking again.', status: 422 });
  if (event.booking_terms && f.terms !== '1') return review({ termsError: 'Please tick to agree to the booking terms.', status: 422 });
  if (!(await allow(env, request, 'tickets', 8, 3600))) return review({ notice: 'We have received a lot of booking attempts from this connection. Please try again later.', status: 429 });
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return review({ notice: 'The security check didn’t complete. Please wait for it to finish, then press CONFIRM & PAY SECURELY again.', status: 400 });
  }
  if (!(await allow(env, { headers: new Headers() }, 'tickets-all', 1000, 86400))) return review({ notice: 'Online booking is very busy just now. Please try again later.', status: 429 });

  await releaseExpiredEventHolds(env, 3);
  const unit = Number(event.price_pence);
  const total = unit * values.qty;
  if (!(total >= 100)) return review({ notice: 'Online booking isn’t available for this event. Please contact New Way’s.', status: 409 });
  const reference = once.ref;
  const key = once.k;
  const nowIso = new Date().toISOString();
  const b = {
    event_id: event.id, reference, source: 'online', status: 'held', payment_method: 'square_online', payment_status: 'pending',
    unit_price_pence: unit, total_pence: total, terms_text: event.booking_terms || '', terms_accepted_at: event.booking_terms ? nowIso : null,
    confirmed_snapshot: m.snapshot(event, values, { unitPence: unit, totalPence: total, termsText: event.booking_terms || '', at: nowIso }),
    checkin_token: m.newCheckinToken(), access_hash: await sha256Hex('event:' + key), origin: here,
    hold_expires_at: new Date(Date.now() + holdMinutes * 60_000).toISOString(), created_at: nowIso
  };
  try {
    // All or nothing: the booking, every guest and every answer. The database refuses it if the places have gone.
    await env.DB.batch(m.insertBookingStatements(env, b, values));
  } catch (err) {
    if (!/EVENT_FULL/.test(String(err && err.message))) throw err;
    const now = await stateOf(env, event);
    if (now.state !== 'open') return show(await view.closedPage(ctx, { event, state: now.state, settings: ctx.settings }), 409);
    return review({ notice: `Sorry, only ${now.left} ${now.left === 1 ? 'place is' : 'places are'} left now, so this booking couldn’t be held. Please change the number of tickets.`, status: 409 });
  }

  try {
    const link = await createPaymentLink(sq, { reference, itemName: `${event.name}: ${values.qty} ${values.qty === 1 ? 'ticket' : 'tickets'}`, amountPence: total,
      buyerEmail: values.purchaser.email, idempotencyKey: reference, redirectUrl: `${here}/tickets/${reference}?key=${encodeURIComponent(key)}` });
    await env.DB.prepare('UPDATE event_bookings SET square_payment_link_id = ?1, square_payment_url = ?2, square_order_id = ?3 WHERE reference = ?4')
      .bind(link.id, link.url, link.orderId, reference).run();
  } catch (err) {
    console.error("New Way's: Square payment link not created (event):", err instanceof SquareError ? `${err.message} ${err.detail}` : err);
    await env.DB.prepare(`UPDATE event_bookings SET status = 'cancelled', cancelled_at = ?1, note = 'The Square payment page could not be created.' WHERE reference = ?2`)
      .bind(new Date().toISOString(), reference).run();
    return review({ notice: 'Sorry, the secure payment page couldn’t be opened just now, so nothing has been booked or charged. Please try again in a few minutes.', status: 503 });
  }
  return redirect(`/tickets/${reference}?key=${encodeURIComponent(key)}`);
}

export function valuesFromBooking(b) {
  return {
    qty: b.quantity,
    guests: b.guests.map((g) => ({ position: g.position, name: g.name, answers: g.answers.map((a) => ({ question_label: a.question_label, value: a.value, type: a.type })) })),
    answers: b.answers.map((a) => ({ question_label: a.question_label, value: a.value, type: a.type })),
    purchaser: { name: b.purchaser_name, email: b.purchaser_email, phone: b.purchaser_phone }, marketing: !!b.marketing_opt_in
  };
}

// ---------- GET /tickets/EV-XXXXXX?key=… ----------
async function bookingStatus(request, env, url, reference) {
  const key = url.searchParams.get('key') || '';
  const ctx = await pub.pageContext(request, env);
  let b = /^EV-[A-Z0-9]{6}$/.test(reference) && key && key.length < 100 ? await env.DB.prepare('SELECT * FROM event_bookings WHERE reference = ?1').bind(reference).first() : null;
  if (!b || !b.access_hash || (await sha256Hex('event:' + key)) !== b.access_hash) {
    return show(await view.messagePage(ctx, { title: 'Booking not found', message: 'This link isn’t complete or has expired. Please use the link from your email.' }), 404);
  }
  let checkFailed = false;
  if ((b.status === 'held' || b.status === 'expired') && b.payment_status === 'pending' && b.square_order_id) {
    // Coming back from Square is NOT proof of payment: Square itself is asked.
    try { await checkEventWithSquare(env, b); } catch (err) { checkFailed = true; console.error("New Way's: could not check an event booking with Square:", err && err.message); }
  }
  b = await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1').bind(b.id).first();
  if (b.status === 'held' && Date.parse(b.hold_expires_at) < Date.now()) await releaseExpiredEventHolds(env, 3);
  const full = await m.loadBooking(env, 'id', b.id);
  const event = await m.getEvent(env, full.event_id);
  const holdOk = full.reservation_kind ? m.reserveOpen(full) && full.payment_status === 'pending' : full.status === 'held' && Date.parse(full.hold_expires_at) > Date.now();
  return show(await view.bookingPage(ctx, { event, settings: ctx.settings, booking: full, values: valuesFromBooking(full), key, checkFailed, sandbox: squareMode(env) === 'sandbox',
    holdUntil: full.reservation_kind && full.reserve_deadline ? ukWhen(full.reserve_deadline) : '',
    payUrl: holdOk && /^(https:\/\/|http:\/\/localhost[:/])/.test(full.square_payment_url) ? full.square_payment_url : '',
    qrSvg: full.status === 'confirmed' ? qrSvg(m.checkinUrl(full.origin, full.checkin_token), { label: 'Your check-in QR code' }) : '' }));
}

// ---------- /reserve/EV-XXXXXX?k=…  (a reservation's private link: the normal booking form for the reserved tickets) ----------
export const ukWhen = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true })
  .format(new Date(iso)).replace(/ ([ap]m)$/, '$1');

async function reserve(request, env, url, method, reference) {
  const ctx = await pub.pageContext(request, env);
  const cfg = turnstileConfig(request, env);
  const here = new URL(request.url).origin;
  let f = {};
  if (method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
    f = await readForm(request, 60_000);
  }
  const key = method === 'POST' ? String(f.k || '') : url.searchParams.get('k') || '';
  const message = (title, text, status = 200) => show(view.messagePage(ctx, { title, message: text, link: '/events', linkText: 'Go to Events' }), status);
  if (!(await allow(env, request, 'reserve-open', 60, 3600))) return message('Please try again later', 'There have been too many attempts from this connection. Please try again later.', 429);
  let b = await reservationForKey(env, reference, key);
  if (!b) return message('Link not recognised', 'This reservation link isn’t complete, or it has been replaced by a newer link. Please use the latest link you were sent, or contact New Way’s.', 404);
  const event = await m.getEvent(env, b.event_id);
  if (!event) return message('Link not recognised', 'This event is no longer available. Please contact New Way’s.', 404);
  // Coming back from Square, or opening the link again: ask Square first if a payment page was made
  if (b.status === 'held' && b.square_order_id) { try { await checkEventWithSquare(env, b); } catch { /* the page below still works */ } b = await reservationForKey(env, reference, key) || b; }
  const ticketsLink = `/tickets/${b.reference}?key=${encodeURIComponent(key)}`;
  if (b.status === 'confirmed') return show(view.messagePage(ctx, { title: 'Already paid', message: `Your reserved tickets for ${event.name} are paid and confirmed. Your confirmation and QR code have been emailed${b.purchaser_email ? ' to ' + b.purchaser_email : ''}.`, link: ticketsLink, linkText: 'See your booking and QR code', done: true }));
  if (b.status === 'needs_attention') return message('Thank you, your payment was received', 'There was a problem confirming your places automatically, so New Way’s will contact you personally.');
  if (b.status === 'cancelled') return message('Reservation cancelled', 'This reservation has been cancelled, so this link no longer works. No payment has been taken. If you think this is wrong, please contact New Way’s.', 410);
  if (b.status !== 'held') return message('Reservation no longer available', 'This reservation has been released, so this link no longer works. No payment has been taken. Please contact New Way’s if you still want tickets.', 410);
  if (!m.reserveOpen(b)) return message('The payment deadline has passed', 'This reservation link has closed because its payment deadline has passed. Please contact New Way’s.', 410);
  if (b.reserve_pay === 'square_online' && !squareConfig(env)) return message('Online payment isn’t available just now', 'Please contact New Way’s to pay for your reserved tickets.', 503);
  if (!cfg) return message('Not available just now', 'Please contact New Way’s about your reserved tickets.', 503);

  const deadlineText = ukWhen(b.reserve_deadline) + ' (UK time)';
  const sandbox = squareMode(env) === 'sandbox';
  const inPerson = b.reserve_pay !== 'square_online';
  const questions = await m.questionsFor(env, event.id);
  const full = await m.loadBooking(env, 'id', b.id);
  const evForm = { ...event, max_per_booking: b.quantity };
  const form = async (state = {}) => show(await view.reserveDetailsPage(ctx, { event, settings: ctx.settings, b, questions, key, deadlineText, sandbox, stamp: await formStamp(cfg), ...state }), state.status || 200);

  if (method === 'GET') {
    // details already given (and the customer is back to change them, or to pay): start from what they gave
    const fields = {};
    if (b.reserve_details_at) {
      Object.assign(fields, { p_name: full.purchaser_name, p_email: full.purchaser_email, p_phone: full.purchaser_phone, marketing: full.marketing_opt_in ? '1' : '' });
      for (const [k2, v2] of m.hiddenFields(valuesFromFull(full, questions))) fields[k2] = v2;
    } else {
      Object.assign(fields, { p_name: full.purchaser_name, p_email: full.purchaser_email, p_phone: full.purchaser_phone });
    }
    return form({ fields });
  }

  const fields = { ...f, qty: String(b.quantity) };
  if (f.step === 'edit') return form({ fields });
  const { values, errors } = m.readBookingForm(fields, evForm, questions, { fixedQty: b.quantity });
  const review = async (extra = {}) => show(await view.reviewPage(ctx, { event, settings: ctx.settings, values, hidden: [...m.hiddenFields(values), ['k', key]], totalPence: b.total_pence,
    holdMinutes: 0, siteKey: cfg.siteKey, sandbox, reservation: { action: `/reserve/${b.reference}`, deadlineText, inPerson, restartPath: `/reserve/${b.reference}?k=${encodeURIComponent(key)}` }, ...extra }), extra.status || 200);

  if (f.step !== 'confirm') {
    const age = await stampAge(cfg, f.t);
    if (String(f.website || '').trim() || (age !== null && age < 3000)) return redirect('/events');
    if (age === null || age > 6 * 3600_000) return form({ fields, notice: 'This page was open for a long time. Please check the details and try again.', status: 400 });
    if (Object.keys(errors).length) return form({ fields, errors, status: 422 });
    return review();
  }
  if (Object.keys(errors).length) return form({ fields, errors, notice: 'Some details need checking again.', status: 422 });
  if (event.booking_terms && f.terms !== '1') return review({ termsError: 'Please tick to agree to the booking terms.', status: 422 });
  if (!(await allow(env, request, 'reserve-confirm', 10, 3600))) return review({ notice: 'We have received a lot of attempts from this connection. Please try again later.', status: 429 });
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return review({ notice: `The security check didn’t complete. Please wait for it to finish, then press ${inPerson ? 'CONFIRM MY DETAILS' : 'CONFIRM & PAY SECURELY'} again.`, status: 400 });
  }

  // Save the details on the reservation itself, all or nothing, and only while it is still reserved with THIS link
  const nowIso = new Date().toISOString();
  const guard = `EXISTS (SELECT 1 FROM event_bookings WHERE id = ${Number(b.id)} AND status = 'held' AND payment_status = 'pending' AND reserve_key = ?1)`;
  const steps = [
    env.DB.prepare(`UPDATE event_bookings SET purchaser_name = ?1, purchaser_email = ?2, purchaser_phone = ?3, marketing_opt_in = ?4, terms_text = ?5, terms_accepted_at = ?6,
        confirmed_snapshot = ?7, origin = ?8, reserve_details_at = ?9 WHERE id = ?10 AND status = 'held' AND payment_status = 'pending' AND reserve_key = ?11`)
      .bind(values.purchaser.name, values.purchaser.email, values.purchaser.phone, values.marketing ? 1 : 0, event.booking_terms || '', event.booking_terms ? nowIso : null,
        m.snapshot(event, values, { unitPence: b.unit_price_pence, totalPence: b.total_pence, termsText: event.booking_terms || '', at: nowIso }), here, nowIso, b.id, key),
    env.DB.prepare(`DELETE FROM event_answers WHERE booking_id = ${Number(b.id)} AND ${guard}`).bind(key)
  ];
  for (const g of values.guests) {
    steps.push(env.DB.prepare(`UPDATE event_guests SET name = ?2 WHERE booking_id = ${Number(b.id)} AND position = ?3 AND ${guard}`).bind(key, g.name, g.position));
    for (const a of g.answers) {
      steps.push(env.DB.prepare(`INSERT INTO event_answers (booking_id, guest_id, question_id, question_label, option_id, value, original_value, updated_at)
        SELECT ${Number(b.id)}, (SELECT id FROM event_guests WHERE booking_id = ${Number(b.id)} AND position = ?2), ?3, ?4, ?5, ?6, ?6, ?7 WHERE ${guard}`)
        .bind(key, g.position, a.question_id, a.question_label, a.option_id, a.value, nowIso));
    }
  }
  for (const a of values.answers) {
    steps.push(env.DB.prepare(`INSERT INTO event_answers (booking_id, guest_id, question_id, question_label, option_id, value, original_value, updated_at)
      SELECT ${Number(b.id)}, 0, ?2, ?3, ?4, ?5, ?5, ?6 WHERE ${guard}`).bind(key, a.question_id, a.question_label, a.option_id, a.value, nowIso));
  }
  const r = await env.DB.batch(steps);
  if (!r[0].meta.changes) return message('Reservation no longer available', 'This reservation has changed in the meantime (it may have been paid, released or given a new link). Please open the latest link you were sent, or contact New Way’s.', 409);
  // (the mailing list, if ticked, is joined once the booking is paid, exactly as for a normal booking)
  if (inPerson) {
    const fresh = await m.loadBooking(env, 'id', b.id);
    return show(view.reserveSavedPage(ctx, { event, settings: ctx.settings, b: fresh, values: valuesFromBooking(fresh), deadlineText }));
  }

  // Square's payment page for exactly this reservation and amount (made once; the same page if they confirm again)
  const sq = squareConfig(env);
  const fresh = await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1').bind(b.id).first();
  if (!fresh.square_payment_link_id) {
    if (!(fresh.total_pence >= 100)) return message('Please contact New Way’s', 'Online payment isn’t available for these tickets. Please contact New Way’s to pay.', 409);
    try {
      const link = await createPaymentLink(sq, { reference: fresh.reference, itemName: `${event.name}: ${fresh.quantity} reserved ${fresh.quantity === 1 ? 'ticket' : 'tickets'}`, amountPence: fresh.total_pence,
        buyerEmail: values.purchaser.email, idempotencyKey: `${fresh.reference}-R${fresh.reserve_link_version}`, redirectUrl: `${here}${ticketsLink}` });
      await env.DB.prepare(`UPDATE event_bookings SET square_payment_link_id = ?1, square_payment_url = ?2, square_order_id = ?3 WHERE id = ?4 AND square_payment_link_id IS NULL AND status = 'held'`)
        .bind(link.id, link.url, link.orderId, fresh.id).run();
    } catch (err) {
      console.error("New Way's: Square payment link not created (reservation):", err instanceof SquareError ? `${err.message} ${err.detail}` : err);
      return review({ notice: 'Sorry, the secure payment page couldn’t be opened just now. Your details are saved and your tickets are still reserved. Please try again in a few minutes.', status: 503 });
    }
  }
  return redirect(ticketsLink);
}

// The customer's earlier answers, as form values (for changing details before paying)
function valuesFromFull(full, questions) {
  const byQ = (list, qid) => list.find((a) => a.question_id === qid);
  return {
    qty: full.quantity, marketing: !!full.marketing_opt_in, purchaser: { name: full.purchaser_name, email: full.purchaser_email, phone: full.purchaser_phone },
    guests: full.guests.map((g) => ({ position: g.position, name: /^Guest \d+$/.test(g.name) ? '' : g.name,
      answers: questions.filter((q) => q.scope === 'guest').map((q) => { const a = byQ(g.answers, q.id) || {}; return { question_id: q.id, type: q.type, option_id: a.option_id || null, value: a.value || '' }; }) })),
    answers: questions.filter((q) => q.scope === 'booking').map((q) => { const a = byQ(full.answers, q.id) || {}; return { question_id: q.id, type: q.type, option_id: a.option_id || null, value: a.value || '' }; })
  };
}

// ---------- GET /c/TOKEN  (what the QR code opens) ----------
async function ticket(request, env, token) {
  const ctx = await pub.pageContext(request, env);
  const b = m.isCheckinToken(token) ? await env.DB.prepare('SELECT * FROM event_bookings WHERE checkin_token = ?1').bind(token).first() : null;
  if (!b) return show(await view.messagePage(ctx, { title: 'Booking not found', message: 'This QR code doesn’t match a New Way’s booking.' }), 404);
  const event = await m.getEvent(env, b.event_id);
  const valid = b.status === 'confirmed';
  return show(await view.ticketPage(ctx, { event, booking: b, valid, qrSvg: valid ? qrSvg(m.checkinUrl(b.origin || new URL(request.url).origin, b.checkin_token), { label: 'Check-in QR code' }) : '' }));
}

async function qrImage(env, token) {
  const b = m.isCheckinToken(token) ? await env.DB.prepare(`SELECT origin, checkin_token FROM event_bookings WHERE checkin_token = ?1 AND status = 'confirmed'`).bind(token).first() : null;
  if (!b) return textResponse('Not found', { status: 404 });
  return new Response(qrPng(m.checkinUrl(b.origin, b.checkin_token), { scale: 8 }), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', ...{ 'X-Robots-Tag': 'noindex' } } });
}

// ---------- /join  (the permanent page for the printed table QR code) ----------
async function join(request, env, method) {
  const ctx = await pub.pageContext(request, env);
  const wording = await joinWording(env);
  const cfg = turnstileConfig(request, env);
  const stampCfg = cfg || { secret: env.SESSION_SECRET || 'nw-join' };
  if (method === 'GET') return show(await view.joinPage(ctx, { wording, stamp: await formStamp(stampCfg), siteKey: cfg ? cfg.siteKey : '' }));
  const here = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const f = await readForm(request, 10_000);
  const values = { name: String(f.name || '').trim().replace(/\s+/g, ' '), email: normaliseEmail(f.email), consent: f.consent === '1' };
  const again = async (state) => show(await view.joinPage(ctx, { wording, stamp: await formStamp(stampCfg), siteKey: cfg ? cfg.siteKey : '', values, ...state }), state.status || 200);
  const age = await stampAge(stampCfg, f.t);
  if (String(f.website || '').trim() || (age !== null && age < 2000)) return redirect('/join/thanks');   // a program: keep nothing
  if (age === null || age > 6 * 3600_000) return again({ notice: 'This page was open for a long time. Please try again.', status: 400 });
  const errors = {};
  if (values.name.length < 1) errors.name = 'Please enter your name.';
  else if (values.name.length > 80) errors.name = 'Please keep your name under 80 characters.';
  if (values.email.length > 254 || !EMAIL_RE.test(values.email)) errors.email = 'Please enter your full email address.';
  if (!values.consent) errors.consent = 'Please tick to confirm you’d like to receive our emails.';
  if (Object.keys(errors).length) return again({ errors, status: 422 });
  if (!(await allow(env, request, 'join', 10, 3600))) return again({ notice: 'Too many sign-ups from this connection. Please try again later.', status: 429 });
  if (cfg && !(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return again({ notice: 'The security check didn’t complete. Please wait for it to finish, then try again.', status: 400 });
  }
  await subscribe(env, { email: values.email, name: values.name, source: 'Join page', consent: wording.join_consent });
  return redirect('/join/thanks');
}

async function unsubscribe(request, env, method, token) {
  const ctx = await pub.pageContext(request, env);
  const row = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await env.DB.prepare('SELECT * FROM mailing_list WHERE unsubscribe_token = ?1').bind(token).first() : null;
  if (!row) return show(await view.messagePage(ctx, { title: 'Link not recognised', message: 'This unsubscribe link isn’t complete. Please use the link from the email, or contact New Way’s.' }), 404);
  if (method === 'POST') {
    await unsubscribeByToken(env, token);
    return show(await view.unsubscribePage(ctx, { token, email: row.email, done: true }));
  }
  return show(await view.unsubscribePage(ctx, { token, email: row.email, done: row.status === 'unsubscribed' }));
}

// ---------- GET /events/ID: the event's own page (shared on Facebook and WhatsApp) ----------
async function eventOwnPage(request, env, id) {
  const event = await loadEvent(env, id);
  if (!event) return null;
  const ctx = await pub.pageContext(request, env);
  // The preview picture: the JPEG copy made when the poster was saved (best for Facebook and WhatsApp), else the poster
  const key = event.share_key || event.poster_key;
  const info = key ? await env.DB.prepare('SELECT key, width, height, content_type AS type FROM media WHERE key = ?1').bind(key).first() : null;
  return htmlResponse(await pub.eventPage(ctx, event, { shareImage: info || (key ? { key } : null) }));
}

// ---------- routing ----------
export async function handleEventRoutes(request, env, url, method, path) {
  const own = path.match(/^\/events\/(\d{1,9})$/);
  if (own && method === 'GET') return eventOwnPage(request, env, Number(own[1]));
  const ev = path.match(/^\/events\/(\d{1,9})\/book$/);
  if (ev) {
    const event = await loadEvent(env, Number(ev[1]));
    if (!event) return null;
    if (method === 'GET') return start(request, env, url, event);
    if (method === 'POST') return post(request, env, url, event);
    return textResponse('Method not allowed', { status: 405 });
  }
  const rs = path.match(/^\/reserve\/(EV-[A-Z0-9]{6})$/);
  if (rs && (method === 'GET' || method === 'POST')) return reserve(request, env, url, method, rs[1]);
  const t = path.match(/^\/tickets\/(EV-[A-Z0-9]{6})$/);
  if (t && method === 'GET') return bookingStatus(request, env, url, t[1]);
  const c = path.match(/^\/c\/([A-Za-z0-9_-]{1,64})$/);
  if (c && method === 'GET') return ticket(request, env, c[1]);
  const q = path.match(/^\/qr\/([A-Za-z0-9_-]{1,64})\.png$/);
  if (q && method === 'GET') return qrImage(env, q[1]);
  if (path === '/join' && (method === 'GET' || method === 'POST')) return join(request, env, method);
  if (path === '/join/thanks' && method === 'GET') {
    const ctx = await pub.pageContext(request, env);
    return show(await view.messagePage(ctx, { title: 'Thank you', message: 'You’re on the New Way’s mailing list. We’ll email you about future events and activities. Every email has an unsubscribe link.', done: true }));
  }
  const u = path.match(/^\/unsubscribe\/([A-Za-z0-9_-]{1,64})$/);
  if (u && (method === 'GET' || method === 'POST')) return unsubscribe(request, env, method, u[1]);
  return null;
}
