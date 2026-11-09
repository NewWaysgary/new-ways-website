// Wednesday till › ADD EVENT BOOKING: Julie books event tickets for a customer without leaving the till.
//
// It reuses the event booking system exactly as Admin's "Add a booking" does: the same form rules (readBookingForm),
// the same database steps (insertBookingStatements, so the capacity rules in the database still refuse overselling),
// the same confirmation email with the QR codes (sendConfirmation), the same mailing-list sign-up. The booking then
// appears everywhere a booking appears: places left, the guest list, payments, table planning, meal choices and
// check-in (Julie's screen and the iPad).
//
// Payment uses the till's own ways of taking money:
//   * CASH: Julie confirms the cash is in her hand, then the booking is made, paid, in one step.
//   * CARD in the Square app (Julie's Android phone or the iPad, as for till sales): the places are HELD first, the Square app is
//     opened with the exact amount, and the booking is only confirmed once Square itself confirms the payment
//     (door-card.js checks it exactly as it checks a till sale). Cancelled, declined or different: the places are
//     released and nothing is booked.
//   * CARD on the card reader without the app (e.g. the iPad): as on the till, Julie confirms the card reader shows
//     the payment approved ("Card payment taken ✓"), then the booking is made.
// The till's own reference for each booking can only ever be used once, so a double tap, a refresh or Square coming
// back twice never makes two bookings. Event money is kept apart from the Wednesday night's own totals.
import { redirect, randomToken } from '../lib/http.js';
import { ukToday, isIsoDate } from '../lib/dates.js';
import * as data from '../lib/data.js';
import * as m from '../events/model.js';
import * as mail from '../events/emails.js';
import { subscribe } from '../mailing.js';
import { posConfig } from '../payments/square.js';
import { pounds } from '../wednesday/model.js';
import * as view from '../views/admin-door-events.js';

export const HOLD_MINUTES = 20;               // how long places are held while the card is taken in the Square app
const CLIENT_RE = /^[A-Za-z0-9_-]{16,64}$/;
const nowIso = () => new Date().toISOString();
const stampNow = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
const hex32 = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Can this event be sold at the till? (A price is needed; sold out, by hand or full, can't be.)
export function tillState(event, taken) {
  const left = event.capacity > 0 ? Math.max(0, event.capacity - taken) : null;
  if (!(event.price_pence > 0)) return { ok: false, left, why: 'No ticket price set' };
  if (Number(event.sold_out) === 1) return { ok: false, left, why: 'SOLD OUT' };
  if (left === 0) return { ok: false, left, why: 'SOLD OUT' };
  return { ok: true, left, max: Math.min(m.MAX_TICKETS, left === null ? m.MAX_TICKETS : left) };
}

// Which Square app link this device can open. An iPad's Safari usually says it is a Mac ('apple'): the page then
// checks for a touch screen itself (/js/door-events.js) and shows the card reader option instead on a real Mac.
export function squareDevice(ua) {
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|CriOS|Chromium|Firefox|FxiOS|Edg/.test(ua)) return 'apple';
  return '';
}

export async function upcomingEvents(env, today = ukToday()) {
  const { results } = await env.DB.prepare(`SELECT e.*,
      (SELECT COALESCE(SUM(b.quantity), 0) FROM event_bookings b WHERE b.event_id = e.id AND b.status IN ('held', 'confirmed')) + e.legacy_places AS taken
    FROM events e WHERE e.date >= ?1 ORDER BY e.date, e.start_time, e.id LIMIT 60`).bind(today).all();
  return (results || []).map((e) => ({ ...e, till: tillState(e, e.taken) }));
}

async function posSettings(env, request) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('pos_app_id', 'pos_handoff')`).all();
  const s = Object.fromEntries((results || []).map((r) => [r.key, r.value]));
  const appId = /^[A-Za-z0-9_-]{6,80}$/.test(s.pos_app_id || '') ? s.pos_app_id : '';
  const cfg = posConfig(env);
  // the same rule as the till: the Square app is used from an Android phone, an iPad or an iPhone when it's switched on
  const device = squareDevice(request.headers.get('user-agent') || '');
  const app = !!(s.pos_handoff === '1' && appId && device);
  return { app, device, appId, locationId: cfg ? cfg.locationId : '' };
}

// The details form, checked with the same rules as Admin's "Add a booking", plus what the till needs to send the
// confirmation: the customer's name and email address, and every question the event marks as required.
export function readTillForm(f, event, questions) {
  const { values, errors } = m.readBookingForm(f, event, questions, { admin: true });
  if (errors.qty) return { values, errors };
  if (!values.purchaser.name || values.purchaser.name.length < 2) errors.p_name = 'Please enter the customer’s name.';
  if (!values.purchaser.email) errors.p_email = 'Please enter the customer’s email address, so their confirmation and QR code can be sent.';
  const need = (q, key, a) => { if (q.required && !a.value && !errors[key]) errors[key] = q.type === 'checkbox' ? 'Please tick to confirm.' : 'Please answer this.'; };
  for (const g of values.guests) for (const a of g.answers) { const q = questions.find((x) => x.id === a.question_id); if (q) need(q, `g${g.position}_q${q.id}`, a); }
  for (const a of values.answers) { const q = questions.find((x) => x.id === a.question_id); if (q) need(q, `b_q${q.id}`, a); }
  return { values, errors };
}

async function duplicateOf(env, event, email) {
  if (!email) return null;
  return env.DB.prepare(`SELECT reference, quantity FROM event_bookings WHERE event_id = ?1 AND purchaser_email = ?2 AND status IN ('held', 'confirmed') LIMIT 1`).bind(event.id, email).first();
}
const tillBooking = (env, clientRef) => env.DB.prepare('SELECT * FROM till_event_bookings WHERE client_ref = ?1').bind(clientRef).first();

// Makes the booking (and, for the Square app, the card request) in one all-or-nothing step.
async function makeBooking(env, { event, values, method, held, clientRef, date, by, origin, cardRef = null }) {
  const total = event.price_pence * values.qty;
  const reference = m.newEventReference();
  const now = nowIso();
  const b = {
    event_id: event.id, reference, source: 'admin', status: held ? 'held' : 'confirmed', payment_method: method, payment_status: held ? 'pending' : 'paid',
    unit_price_pence: event.price_pence, total_pence: total, checkin_token: m.newCheckinToken(), origin,
    confirmed_snapshot: m.snapshot(event, values, { unitPence: event.price_pence, totalPence: total, at: now }),
    note: `${stampNow()}: Booked at the Wednesday till by ${by}, paid by ${method === 'cash' ? 'cash' : held ? 'card in the Square app' : 'card (card reader)'}.`,
    created_at: now, paid_at: held ? null : now, hold_expires_at: held ? new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString() : null
  };
  const steps = [env.DB.prepare(`INSERT INTO till_event_bookings (client_ref, night_date, event_id, reference, method, qty, total_pence, status, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(clientRef, date, event.id, reference, method, values.qty, total, held ? 'waiting' : 'paid', by),
    ...m.insertBookingStatements(env, b, values),
    env.DB.prepare('UPDATE till_event_bookings SET booking_id = (SELECT id FROM event_bookings WHERE reference = ?1) WHERE client_ref = ?2').bind(reference, clientRef)];
  if (cardRef) {
    const lines = [{ label: `${event.name}: ${values.qty} ${values.qty === 1 ? 'ticket' : 'tickets'} (${reference})`, qty: values.qty, unit_pence: event.price_pence, line_pence: total }];
    steps.push(env.DB.prepare(`INSERT INTO till_card_requests (ref, client_ref, night_date, total_pence, lines_json, created_by, kind, booking_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'event', (SELECT id FROM event_bookings WHERE reference = ?7))`).bind(cardRef, clientRef, date, total, JSON.stringify(lines), by, reference),
      env.DB.prepare('UPDATE till_event_bookings SET card_request_id = (SELECT id FROM till_card_requests WHERE ref = ?1) WHERE client_ref = ?2').bind(cardRef, clientRef));
  }
  steps.push(data.audit(env, 'door.event_booking', `Booking ${reference} for ${event.name} (${values.qty}, ${pounds(total)}) ${held ? 'held while the card is taken in the Square app' : `taken at the till, ${method}`} by ${by}`));
  await env.DB.batch(steps);
  return { reference, total };
}

// After a booking is paid: the mailing list (if asked) and the normal confirmation email with the QR codes
export async function afterPaid(env, bookingId) {
  const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1').bind(bookingId).first();
  if (!b || b.status !== 'confirmed') return 'not booked';
  if (b.marketing_opt_in && b.purchaser_email) {
    await subscribe(env, { email: b.purchaser_email, name: b.purchaser_name, source: `Booked at the till (${b.reference})`, consent: 'Told New Way’s they would like to join the mailing list.' }).catch(() => {});
  }
  return b.purchaser_email ? mail.sendConfirmation(env, b.id).catch(() => 'failed') : 'no address';
}

const doneUrl = (date, row, emailed) => `/admin/door?date=${date}&flash=${emailed === 'sent' ? 'event-booked' : emailed === 'again' ? 'event-already' : 'event-booked-no-email'}&detail=${encodeURIComponent(`${row.reference}: ${row.qty} ${row.qty === 1 ? 'ticket' : 'tickets'}, ${pounds(row.total_pence)} ${row.method}`)}`;

export async function handleDoorEvents({ request, env, url, method, path, form, page, csrf, by }) {
  const f = form.fields;
  const date = isIsoDate(method === 'POST' ? f.date : url.searchParams.get('date')) ? (method === 'POST' ? f.date : url.searchParams.get('date')) : ukToday();

  // 1. the list of upcoming events
  if (path === '/admin/door/events' && method === 'GET') return page(view.eventListPage({ date, events: await upcomingEvents(env), csrf: csrf.token }));

  // the Square app step for a card booking
  if (path === '/admin/door/event-card' && method === 'GET') {
    const r = /^[a-f0-9]{32}$/.test(url.searchParams.get('ref') || '') ? await env.DB.prepare(`SELECT * FROM till_card_requests WHERE ref = ?1 AND kind = 'event'`).bind(url.searchParams.get('ref')).first() : null;
    if (!r) return redirect(`/admin/door?date=${date}`);
    if (r.status !== 'waiting') return redirect(`/admin/door/card?ref=${r.ref}`);
    const row = await env.DB.prepare('SELECT * FROM till_event_bookings WHERE card_request_id = ?1').bind(r.id).first();
    return page(view.squareStepPage({ r, row, pos: await posSettings(env, request), origin: url.origin, csrf: csrf.token }));
  }
  if (path === '/admin/door/event-card/cancel' && method === 'POST') {
    const r = /^[a-f0-9]{32}$/.test(f.ref || '') ? await env.DB.prepare(`SELECT * FROM till_card_requests WHERE ref = ?1 AND kind = 'event'`).bind(f.ref).first() : null;
    if (r && r.status === 'waiting') {
      await env.DB.prepare(`UPDATE till_card_requests SET status = 'cancelled', detail = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'waiting'`)
        .bind(`Cancelled on the till by ${by} before the card was taken.`, nowIso(), r.id).run();
      await releaseEventHold(env, { ...r, status: 'cancelled' });
    }
    return redirect(`/admin/door?date=${r ? r.night_date : date}&flash=event-cancelled`);
  }

  const em = path.match(/^\/admin\/door\/events\/(\d{1,9})(?:\/(details|pay))?$/);
  if (!em) return null;
  const event = await m.getEvent(env, Number(em[1]));
  if (!event) return redirect(`/admin/door/events?date=${date}`);
  const counts = await m.placeCounts(env, event.id);
  const state = tillState(event, counts.taken);
  const questions = await m.questionsFor(env, event.id);
  const step = em[2] || '';

  // 2. how many tickets
  if (!step && method === 'GET') {
    return page(view.ticketsPage({ date, event, state, csrf: csrf.token }));
  }
  // 3. the customer's and guests' details
  if (step === 'details' && method === 'GET') {
    const qty = Number(url.searchParams.get('qty'));
    if (!state.ok || !Number.isInteger(qty) || qty < 1 || qty > state.max) return redirect(`/admin/door/events/${event.id}?date=${date}`);
    return page(view.detailsPage({ date, event, qty, questions, state, csrf: csrf.token }));
  }
  if (step === 'details' && method === 'POST') {
    const { values, errors } = readTillForm(f, event, questions);
    if (errors.qty || !state.ok) return redirect(`/admin/door/events/${event.id}?date=${date}`);
    if (values.qty > state.max) return page(view.detailsPage({ date, event, qty: values.qty, questions, state, fields: f, errors, notice: `There ${state.left === 1 ? 'is' : 'are'} only ${state.left} ${state.left === 1 ? 'place' : 'places'} left.`, csrf: csrf.token }), 409);
    if (!Object.keys(errors).length && f.dup_ok !== '1') {
      const same = await duplicateOf(env, event, values.purchaser.email);
      if (same) errors.duplicate = `${values.purchaser.email} already has a booking for this event (${same.reference}, ${same.quantity} ${same.quantity === 1 ? 'ticket' : 'tickets'}). Is this a separate, additional booking?`;
    }
    if (Object.keys(errors).length) return page(view.detailsPage({ date, event, qty: values.qty, questions, state, fields: f, errors, csrf: csrf.token }), 422);
    // 4. the payment screen (a new till reference for this booking: it can only ever be used once)
    return page(view.payPage({ date, event, values, dupOk: f.dup_ok === '1', clientRef: randomToken(18), pos: await posSettings(env, request), csrf: csrf.token }));
  }

  // 5. payment taken: make the booking
  if (step === 'pay' && method === 'POST') {
    const clientRef = String(f.client_ref || '');
    const how = ['cash', 'card', 'card_app'].includes(f.pay) ? f.pay : '';
    if (!CLIENT_RE.test(clientRef) || !how) return redirect(`/admin/door/events/${event.id}?date=${date}`);
    // the same booking arriving twice (a double tap, or the page sent again): never booked twice
    const already = await tillBooking(env, clientRef);
    if (already) return alreadyDone(env, already, date);
    const { values, errors } = readTillForm(f, event, questions);
    const pos = await posSettings(env, request);
    const back = (notice, status = 409) => page(view.payPage({ date, event, values, dupOk: f.dup_ok === '1', clientRef, pos, notice, csrf: csrf.token }), status);
    if (Object.keys(errors).length) return page(view.detailsPage({ date, event, qty: values.qty || 1, questions, state, fields: f, errors, csrf: csrf.token }), 422);
    if (!state.ok) return back(state.why === 'SOLD OUT' ? 'This event is now SOLD OUT. Nothing has been booked. If you took cash, please give it back.' : 'This event can’t be booked at the till. Nothing has been booked.');
    if (values.qty > state.max) return back(`There ${state.left === 1 ? 'is' : 'are'} now only ${state.left} ${state.left === 1 ? 'place' : 'places'} left. Nothing has been booked.`);
    if (f.dup_ok !== '1') {
      const same = await duplicateOf(env, event, values.purchaser.email);
      if (same) return page(view.detailsPage({ date, event, qty: values.qty, questions, state, fields: f, errors: { duplicate: `${values.purchaser.email} already has a booking for this event (${same.reference}). Is this a separate, additional booking?` }, csrf: csrf.token }), 422);
    }
    if (how === 'cash' && f.cash_ok !== '1') return back('Please tick to confirm you have the cash, then press the button again.', 422);
    if (how === 'card' && f.card_ok !== '1') return back('Please tick to confirm the card reader shows the payment as approved, then press the button again.', 422);
    if (how === 'card_app' && !pos.app) return back('The Square app can’t be opened from this device. Use the card reader, then “Card payment taken ✓”.', 422);
    const origin = url.origin;
    const cardRef = how === 'card_app' ? hex32() : null;
    try {
      await makeBooking(env, { event, values, method: how === 'cash' ? 'cash' : 'card', held: how === 'card_app', clientRef, date, by, origin, cardRef });
    } catch (err) {
      const msg = String(err && err.message);
      if (/EVENT_FULL/.test(msg)) return back('This event has just become full. Nothing has been booked. If you took cash, please give it back.');
      if (/UNIQUE/.test(msg)) { const again = await tillBooking(env, clientRef); if (again) return alreadyDone(env, again, date); }
      throw err;
    }
    if (cardRef) return redirect(`/admin/door/event-card?ref=${cardRef}&date=${date}`);
    const row = await tillBooking(env, clientRef);
    const emailed = await afterPaid(env, row.booking_id);
    return redirect(doneUrl(date, row, emailed));
  }
  return null;
}

async function alreadyDone(env, row, date) {
  if (row.status === 'paid') return redirect(doneUrl(date, row, 'again'));
  const r = row.card_request_id ? await env.DB.prepare('SELECT ref FROM till_card_requests WHERE id = ?1').bind(row.card_request_id).first() : null;
  if (r) return redirect(row.status === 'waiting' ? `/admin/door/event-card?ref=${r.ref}&date=${date}` : `/admin/door/card?ref=${r.ref}`);
  return redirect(`/admin/door?date=${date}`);
}

// ---------- used by door-card.js when the Square app payment is for an event booking ----------

// Not paid (cancelled, declined, different, already counted): the held places are released and nothing is booked
export async function releaseEventHold(env, r) {
  if (!r || r.kind !== 'event' || !['cancelled', 'failed', 'mismatch', 'duplicate'].includes(r.status) || !r.booking_id) return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE event_bookings SET status = 'cancelled', hold_expires_at = NULL, note = CASE WHEN note = '' THEN ?1 ELSE note || char(10) || char(10) || ?1 END
      WHERE id = ?2 AND status IN ('held', 'expired') AND payment_status = 'pending'`).bind(`${stampNow()}: Card payment at the till not completed, so nothing was booked and the places were released.`, r.booking_id),
    env.DB.prepare(`UPDATE till_event_bookings SET status = 'released', updated_at = ?1 WHERE card_request_id = ?2 AND status = 'waiting'`).bind(nowIso(), r.id)
  ]);
}

// Square confirmed the payment (or Julie confirmed it after checking the Square app): the booking is confirmed.
// Returns '' when done, or the reason it couldn't be.
export async function confirmEventBooking(env, r, { paymentId = null, by = '', byHand = false } = {}) {
  const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1').bind(r.booking_id).first();
  if (!b) return 'The booking for this payment no longer exists. Nothing has been booked; check the Square app and refund if needed.';
  if (b.status === 'confirmed' && b.payment_status === 'paid') return '';
  if (!['held', 'expired'].includes(b.status) || b.payment_status !== 'pending') return `The booking ${b.reference} was cancelled before the payment was confirmed, so it has NOT been booked. Refund the ${pounds(r.total_pence)} in the Square app, or book again.`;
  const now = nowIso();
  const steps = [
    env.DB.prepare(`UPDATE event_bookings SET status = 'confirmed', payment_status = 'paid', paid_at = ?1, square_payment_id = ?2, hold_expires_at = NULL,
        note = CASE WHEN note = '' THEN ?3 ELSE note || char(10) || char(10) || ?3 END WHERE id = ?4 AND status IN ('held', 'expired') AND payment_status = 'pending'`)
      .bind(now, paymentId, `${stampNow()}: ${byHand ? `Card payment recorded by ${by} after checking the Square app.` : `Card payment confirmed by Square (${paymentId}).`}`, b.id),
    env.DB.prepare(`UPDATE till_event_bookings SET status = 'paid', square_payment_id = ?1, updated_at = ?2 WHERE card_request_id = ?3`).bind(paymentId, now, r.id),
    byHand
      ? env.DB.prepare(`UPDATE till_card_requests SET detail = ?1, updated_at = ?2 WHERE id = ?3`).bind(`Recorded by ${by} after checking the Square app (not confirmed automatically).`, now, r.id)
      : env.DB.prepare(`UPDATE till_card_requests SET status = 'paid', square_payment_id = ?1, verified_at = ?2, updated_at = ?2, detail = '' WHERE id = ?3 AND status = 'checking'`).bind(paymentId, now, r.id),
    data.audit(env, byHand ? 'door.event_card_by_hand' : 'door.event_card_app', `Booking ${b.reference} paid by card ${pounds(r.total_pence)}${byHand ? `, recorded by ${by} after checking the Square app` : `, confirmed by Square (${paymentId})`}`)
  ];
  try {
    await env.DB.batch(steps);
  } catch (err) {
    const msg = String(err && err.message);
    if (/EVENT_FULL/.test(msg)) return `Square took ${pounds(r.total_pence)}, but the held places ran out and the event is now full, so the booking has NOT been made. Refund the payment in the Square app, or raise the event’s maximum in Admin and add the booking there.`;
    if (/UNIQUE/.test(msg)) return 'This Square payment had already been counted for something else. The booking has NOT been confirmed; check the Square app.';
    throw err;
  }
  await afterPaid(env, b.id);
  return '';
}

// For the till screen and Close night: event tickets taken at the till on this night (kept apart from the
// Wednesday night's own money)
export async function eventTakings(env, date) {
  const { results } = await env.DB.prepare(`SELECT t.*, e.name AS event_name FROM till_event_bookings t JOIN event_bookings b ON b.id = t.booking_id LEFT JOIN events e ON e.id = t.event_id
    WHERE t.night_date = ?1 AND t.status = 'paid' AND b.status = 'confirmed' ORDER BY t.id DESC`).bind(date).all();
  const rows = results || [];
  const sum = (k) => rows.filter((r) => r.method === k).reduce((n, r) => n + r.total_pence, 0);
  return { rows, cash: sum('cash'), card: sum('card'), total: sum('cash') + sum('card'), tickets: rows.reduce((n, r) => n + r.qty, 0) };
}
