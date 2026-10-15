// Event reservations made in Admin: tickets kept aside for a customer until they pay, with a private link to the
// normal booking form and Square checkout (or payment in person, confirmed by Gary or Julie).
// A reservation is an ordinary event booking (status 'held', source 'admin'), so:
//   * the database's capacity rules protect its places from the moment it is made (and refuse it if they aren't there);
//   * when it is paid, the existing Square webhook / return check (eventPaid) confirms it once, the guests are on the
//     existing guest list, and the existing confirmation email, QR code and door check-in are used.
import { randomToken } from '../lib/http.js';
import { audit } from '../lib/data.js';
import { squareConfig, deletePaymentLink } from '../payments/square.js';
import * as m from './model.js';
import { afterReservationClosed, afterConfirmed, checkEventWithSquare } from './payments.js';
import { sha256Hex } from '../orders.js';

const nowIso = () => new Date().toISOString();
export const whoIs = (admin) => (admin ? (admin.role === 'owner' ? 'Gary' : admin.name || admin.email || 'Admin') : 'Admin');
const stamp = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
const appendNote = (note, text) => (note ? note + '\n\n' : '') + `${stamp()}: ${text}`;
export const newReserveKey = () => randomToken(24);

// Reads the Admin form. Returns { values, errors }.
export function readReservationForm(f, event, { editing = false } = {}) {
  const errors = {};
  const v = {
    kind: String(f.kind || ''), qty: Number(f.qty), name: String(f.name || '').trim().replace(/\s+/g, ' '), email: String(f.email || '').trim().toLowerCase(),
    phone: String(f.phone || '').trim(), pay: String(f.pay || ''), date: String(f.deadline_date || ''), time: String(f.deadline_time || ''),
    auto: f.auto_release === '1', reason: String(f.reason || '').trim().replace(/\s+/g, ' ').slice(0, 500), note: String(f.note || '').trim().slice(0, 1000),
    send: f.send === '1'
  };
  if (!editing) {
    if (!m.RESERVE_KINDS.some(([k]) => k === v.kind)) errors.kind = 'Please choose what kind of reservation this is.';
    if (!Number.isInteger(v.qty) || v.qty < 1 || v.qty > m.MAX_RESERVE) errors.qty = `Please enter a number of tickets from 1 to ${m.MAX_RESERVE}.`;
    if (v.name.length < 2 || v.name.length > 80) errors.name = 'Please enter who the tickets are reserved for.';
    if (v.email && (v.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))) errors.email = 'Please enter a full email address, or leave it empty.';
    if (v.phone && !m.normalisePhoneLoose(v.phone)) errors.phone = 'Please enter a phone number, or leave it empty.';
    else if (v.phone) v.phone = m.normalisePhoneLoose(v.phone);
    if ((v.kind === 'previous' || v.kind === 'override') && v.reason.length < 5) errors.reason = 'Please write why (at least a few words). It is kept in the records.';
    if (v.send && !v.email) errors.send = 'An email address is needed to email the link.';
  }
  if (!m.RESERVE_PAY.some(([k]) => k === v.pay)) errors.pay = 'Please choose how the customer will pay.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !/^\d{2}:\d{2}$/.test(v.time)) errors.deadline = 'Please choose the payment deadline (date and time).';
  else {
    v.deadline = m.eventStartUtc({ date: v.date, start_time: v.time });
    if (!(Date.parse(v.deadline) > Date.now() + 5 * 60_000)) errors.deadline = 'The payment deadline must be in the future.';
    else if (event && Date.parse(v.deadline) > Date.parse(m.eventStartUtc(event))) errors.deadline = 'The payment deadline must be before the event starts.';
  }
  return { values: v, errors };
}

// Makes a reservation. Returns { booking } or { problem: text }.
export async function createReservation(env, { event, values, admin, origin }) {
  const reference = m.newEventReference();
  const key = newReserveKey();
  const now = nowIso();
  const who = whoIs(admin);
  const qty = values.qty;
  const unit = Number(event.price_pence) || 0;
  const guests = Array.from({ length: qty }, (_, i) => ({ position: i + 1, name: `Guest ${i + 1}`, answers: [] }));
  const vals = { qty, guests, answers: [], purchaser: { name: values.name, email: values.email, phone: values.phone }, marketing: false };
  const b = {
    event_id: event.id, reference, source: 'admin', status: 'held', payment_method: values.pay, payment_status: 'pending',
    unit_price_pence: unit, total_pence: unit * qty, checkin_token: m.newCheckinToken(), access_hash: await sha256Hex('event:' + key), origin,
    hold_expires_at: values.auto ? values.deadline : null, created_at: now,
    note: values.note ? `${stamp()}: ${values.note}` : ''
  };
  const before = await env.DB.prepare('SELECT capacity, legacy_places FROM events WHERE id = ?1').bind(event.id).first();
  const steps = [];
  if (values.kind === 'previous') steps.push(env.DB.prepare('UPDATE events SET legacy_places = legacy_places - ?1 WHERE id = ?2').bind(qty, event.id));
  if (values.kind === 'override') steps.push(env.DB.prepare('UPDATE events SET capacity = capacity + ?1 WHERE id = ?2 AND capacity > 0').bind(qty, event.id));
  steps.push(...m.insertBookingStatements(env, b, vals));
  steps.push(env.DB.prepare(`UPDATE event_bookings SET reservation_kind = ?1, reserve_key = ?2, reserve_link_version = 1, reserve_pay = ?3, reserve_deadline = ?4,
      reserve_auto_release = ?5, reserve_reason = ?6, reserve_by = ?7, reserve_capacity_added = ?8 WHERE reference = ?9`)
    .bind(values.kind, key, values.pay, values.deadline, values.auto ? 1 : 0, values.reason, who, values.kind === 'override' && before.capacity > 0 ? qty : 0, reference));
  const after = {
    capacity: values.kind === 'override' && before.capacity > 0 ? before.capacity + qty : before.capacity,
    legacy: values.kind === 'previous' ? before.legacy_places - qty : before.legacy_places
  };
  steps.push(env.DB.prepare(`INSERT INTO event_allocation_log (event_id, booking_id, action, places, capacity_before, capacity_after, legacy_before, legacy_after, reason, done_by)
    VALUES (?1, (SELECT id FROM event_bookings WHERE reference = ?2), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(event.id, reference, 'reserve_' + values.kind, qty, before.capacity, after.capacity, before.legacy_places, after.legacy, values.reason, who));
  steps.push(audit(env, 'events.reservation', `${who} reserved ${qty} ${qty === 1 ? 'ticket' : 'tickets'} (${reference}, ${event.name}): ${m.RESERVE_KINDS.find(([k]) => k === values.kind)[1]}${values.reason ? '. Reason: ' + values.reason : ''}`));
  try {
    await env.DB.batch(steps);
  } catch (err) {
    const msg = String(err && err.message);
    if (/LEGACY_NOT_ENOUGH/.test(msg)) return { problem: `Only ${before.legacy_places} ${before.legacy_places === 1 ? 'place is' : 'places are'} recorded as allocated before the website for this event. Record the earlier allocations first (Places allocated before the website), or choose another kind of reservation.` };
    if (/EVENT_FULL/.test(msg)) {
      const c = await m.placeCounts(env, event.id);
      const left = event.capacity > 0 ? Math.max(0, event.capacity - c.taken) : 0;
      return { problem: `There ${left === 1 ? 'is' : 'are'} only ${left} ${left === 1 ? 'place' : 'places'} available, so ${qty} can’t be reserved as new places. If these places were allocated before the website, choose “Places allocated before the website”. If you are deliberately adding places beyond the maximum, choose “Additional places (Admin Override)” and give the reason.` };
    }
    throw err;
  }
  return { booking: await env.DB.prepare('SELECT * FROM event_bookings WHERE reference = ?1').bind(reference).first() };
}

// A new private link: the old one stops working at once. If the customer had already reached Square's payment page,
// Square is asked first (so a payment just made is never lost), then that payment page is closed.
export async function newLink(env, b, admin) {
  if (b.status !== 'held' || !b.reservation_kind) return { problem: 'This reservation is no longer waiting for payment.' };
  const closed = await closeSquarePage(env, b);
  if (closed === 'paid') return { paid: true };
  if (closed === 'error') return { problem: 'Square couldn’t be checked just now, so the link was not changed. Please try again in a few minutes.' };
  const key = newReserveKey();
  const r = await env.DB.batch([
    env.DB.prepare(`UPDATE event_bookings SET reserve_key = ?1, reserve_link_version = reserve_link_version + 1, access_hash = ?2,
        square_payment_link_id = NULL, square_payment_url = '', square_order_id = NULL, note = ?3 WHERE id = ?4 AND status = 'held'`)
      .bind(key, await sha256Hex('event:' + key), appendNote(b.note, `New private link made by ${whoIs(admin)}. The previous link no longer works.${b.square_order_id ? ` (Square order ${b.square_order_id} closed.)` : ''}`), b.id),
    audit(env, 'events.reservation', `New private link for reservation ${b.reference} by ${whoIs(admin)}`)
  ]);
  return r[0].meta.changes ? { key } : { problem: 'This reservation is no longer waiting for payment.' };
}

// Closes the Square payment page of a reservation (if it has one). Returns 'none', 'closed', 'paid' (it had just been
// paid: it is now confirmed through the normal path) or 'error'.
export async function closeSquarePage(env, b) {
  const cfg = squareConfig(env);
  if (!cfg || !b.square_order_id) return 'none';
  try {
    const outcome = await checkEventWithSquare(env, b);
    if (outcome && outcome !== 'unpaid') return 'paid';
    await deletePaymentLink(cfg, b.square_payment_link_id);
    return 'closed';
  } catch (err) {
    console.error("New Way's: could not check a reservation with Square:", err && err.message ? err.message : err);
    return 'error';
  }
}

// Release (back to public sale, subject to the event's SOLD OUT switch) or cancel. Old links stop working.
export async function closeReservation(env, b, how, admin, reason = '') {
  if (b.status !== 'held' || !b.reservation_kind) return { problem: 'This reservation is no longer waiting for payment.' };
  const sq = await closeSquarePage(env, b);
  if (sq === 'paid') return { paid: true };
  if (sq === 'error') return { problem: 'Square couldn’t be checked just now (the customer may be paying). Nothing was changed. Please try again in a few minutes.' };
  const status = how === 'cancelled' ? 'cancelled' : 'expired';
  const r = await env.DB.prepare(`UPDATE event_bookings SET status = ?1, cancelled_at = CASE WHEN ?1 = 'cancelled' THEN ?2 ELSE cancelled_at END WHERE id = ?3 AND status = 'held'`)
    .bind(status, nowIso(), b.id).run();
  if (!r.meta.changes) return { problem: 'This reservation is no longer waiting for payment.' };
  const text = how === 'cancelled' ? `Reservation cancelled by ${whoIs(admin)}.` : `Reservation released to public sale by ${whoIs(admin)}.`;
  const extra = await afterReservationClosed(env, b, how, text + (reason ? ` Reason: ${reason}` : ''), whoIs(admin));
  return { done: true, extra };
}

// Payment taken in person (cash or card): only now are the tickets confirmed and issued
export async function paymentReceived(env, b, { method, admin, send }) {
  if (b.status !== 'held' || !b.reservation_kind) return { problem: 'This reservation is no longer waiting for payment.' };
  if (method !== 'cash' && method !== 'card') return { problem: 'Please choose cash or card.' };
  const sq = await closeSquarePage(env, b);
  if (sq === 'paid') return { paid: true };
  if (sq === 'error') return { problem: 'Square couldn’t be checked just now (the customer may be paying online). Nothing was changed. Please try again in a few minutes.' };
  const r = await env.DB.batch([
    env.DB.prepare(`UPDATE event_bookings SET status = 'confirmed', payment_status = 'paid', payment_method = ?1, paid_at = ?2, hold_expires_at = NULL,
        square_payment_link_id = NULL, square_payment_url = '', note = ?3 WHERE id = ?4 AND status = 'held' AND payment_status = 'pending'`)
      .bind(method, nowIso(), appendNote(b.note, `${m.methodLabel(method)} payment of £${(b.total_pence / 100).toFixed(2)} received in person, confirmed by ${whoIs(admin)}.`), b.id),
    audit(env, 'events.reservation', `Reservation ${b.reference}: ${method} payment received in person, confirmed by ${whoIs(admin)}`)
  ]);
  if (!r[0].meta.changes) return { problem: 'This reservation is no longer waiting for payment.' };
  // Gary or Julie took the money themselves: no "new booking" email to them
  await env.DB.prepare(`INSERT OR IGNORE INTO event_email_log (booking_id, kind, status) VALUES (?1, 'admin_notification', 'skipped')`).bind(b.id).run();
  await afterConfirmed(env, b.id, { emailGary: false, emailCustomer: !!send });
  return { done: true };
}

// Change the deadline, how they pay, and automatic release
export async function updateReservation(env, b, values, admin) {
  if (b.status !== 'held' || !b.reservation_kind) return { problem: 'This reservation is no longer waiting for payment.' };
  const changes = [];
  if (values.deadline !== b.reserve_deadline) changes.push('payment deadline changed');
  if (values.pay !== b.reserve_pay) changes.push(`payment changed to ${m.reservePayLabel(values.pay).toLowerCase()}`);
  if ((values.auto ? 1 : 0) !== b.reserve_auto_release) changes.push(values.auto ? 'automatic release switched on' : 'automatic release switched off');
  if (!changes.length) return { done: true };
  // Changing to payment in person closes the Square payment page (Square is asked first, so nothing is lost)
  let closedSquare = false;
  if (values.pay !== 'square_online' && b.square_order_id) {
    const sq = await closeSquarePage(env, b);
    if (sq === 'paid') return { paid: true };
    if (sq === 'error') return { problem: 'Square couldn’t be checked just now (the customer may be paying online). Nothing was changed. Please try again in a few minutes.' };
    closedSquare = true;
  }
  const r = await env.DB.batch([
    ...(closedSquare ? [env.DB.prepare(`UPDATE event_bookings SET square_payment_link_id = NULL, square_payment_url = '' WHERE id = ?1 AND status = 'held'`).bind(b.id)] : []),
    env.DB.prepare(`UPDATE event_bookings SET reserve_deadline = ?1, reserve_pay = ?2, payment_method = ?2, reserve_auto_release = ?3, hold_expires_at = ?4, note = ?5
      WHERE id = ?6 AND status = 'held'`).bind(values.deadline, values.pay, values.auto ? 1 : 0, values.auto ? values.deadline : null,
      appendNote(b.note, `${whoIs(admin)}: ${changes.join(', ')}.`), b.id),
    audit(env, 'events.reservation', `Reservation ${b.reference}: ${changes.join(', ')} by ${whoIs(admin)}`)
  ]);
  return r[r.length - 2].meta.changes ? { done: true } : { problem: 'This reservation is no longer waiting for payment.' };
}

// Places allocated before the website: Gary records the event's real maximum and how many of those places were given
// out before online booking (they are then never sold again). Both change together, in one step.
export async function setAllocations(env, event, { capacity, legacy, reason, admin }) {
  const before = await env.DB.prepare('SELECT capacity, legacy_places FROM events WHERE id = ?1').bind(event.id).first();
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE events SET capacity = ?1, legacy_places = ?2 WHERE id = ?3').bind(capacity, legacy, event.id),
      env.DB.prepare(`INSERT INTO event_allocation_log (event_id, action, places, capacity_before, capacity_after, legacy_before, legacy_after, reason, done_by)
        VALUES (?1, 'allocations', ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(event.id, legacy - before.legacy_places, before.capacity, capacity, before.legacy_places, legacy, reason, whoIs(admin)),
      audit(env, 'events.allocations', `${event.name}: maximum ${before.capacity} → ${capacity}, allocated before the website ${before.legacy_places} → ${legacy}, by ${whoIs(admin)}. Reason: ${reason}`)
    ]);
  } catch (err) {
    if (/EVENT_CAPACITY_BELOW_TAKEN|LEGACY_NOT_ENOUGH/.test(String(err && err.message))) return { problem: 'These figures don’t fit: the maximum must be at least the places allocated before the website plus every booking, reservation and payment hold already on the website.' };
    throw err;
  }
  return { done: true };
}

// For the customer's private link: the reservation, if the key matches. Constant-time comparison.
export async function reservationForKey(env, reference, key) {
  if (!/^EV-[A-Z0-9]{6}$/.test(String(reference || '')) || !/^[A-Za-z0-9_-]{20,64}$/.test(String(key || ''))) return null;
  const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE reference = ?1 AND reservation_kind IS NOT NULL').bind(reference).first();
  // A reservation that was released or cancelled has no working key any more: its last link still shows what happened
  if (!b || !b.reserve_key) return b && (await sha256Hex('event:' + key)) === b.access_hash ? b : null;
  const a = new TextEncoder().encode(b.reserve_key), c = new TextEncoder().encode(String(key));
  let diff = a.length ^ c.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (c[i] ?? 0);
  return diff === 0 ? b : null;
}
