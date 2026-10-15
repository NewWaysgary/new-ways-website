// Event bookings and Square: confirming payments, holds running out, reminders and retries.
// Only a verified Square payment (the signed webhook, or Square's own API) confirms an online booking. Confirming is
// safe to repeat: the same payment arriving twice changes nothing the second time.
import { squareConfig, paidPaymentForOrder, deletePaymentLink } from '../payments/square.js';
import { audit } from '../lib/data.js';
import { emailConfigured } from '../lib/email.js';
import { getBookingSettings } from '../bookings/config.js';
import { subscribe, CHECKOUT_CONSENT } from '../mailing.js';
import * as mail from './emails.js';
import { getEvent, eventStartUtc } from './model.js';
import { wedPaymentArrived } from '../wednesday/payments.js';

const nowIso = () => new Date().toISOString();

async function followUp(step) {
  try { await step(); } catch (err) { console.error("New Way's: event follow-up failed (will be retried):", err && err.message ? err.message : err); }
}

// After a booking is confirmed (paid online): mailing list (only if they ticked it), customer email, email to Gary
export async function afterConfirmed(env, bookingId, { emailCustomer = true, emailGary = true } = {}) {
  const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE id = ?1').bind(bookingId).first();
  if (!b) return;
  if (b.marketing_opt_in && b.purchaser_email) {
    await followUp(() => subscribe(env, { email: b.purchaser_email, name: b.purchaser_name, source: 'Event booking ' + b.reference, consent: CHECKOUT_CONSENT }));
  }
  if (emailCustomer) await followUp(() => mail.sendConfirmation(env, b.id));
  if (emailGary) await followUp(() => mail.notifyGary(env, b.id));
}

async function flag(env, b, pid, paidAt, note) {
  const r = await env.DB.batch([
    env.DB.prepare(`UPDATE event_bookings SET status = 'needs_attention', payment_status = 'paid', paid_at = ?1, square_payment_id = ?2, note = ?3, hold_expires_at = NULL
      WHERE id = ?4 AND status IN ('held', 'expired', 'cancelled')`).bind(paidAt, pid || null, note, b.id),
    audit(env, 'events.attention', `Event booking ${b.reference} needs attention: ${note}`)
  ]);
  if (r[0].meta.changes) await followUp(() => mail.notifyAttention(env, b.id));
  return 'needs attention';
}

export async function eventPaid(env, b, payment) {
  if (!b) return 'unknown order';
  if (b.payment_status === 'paid') {
    // A reservation paid in person whose old Square payment page was used at the same moment: tell Gary (once)
    if (b.reservation_kind && !b.square_payment_id && payment?.status === 'COMPLETED' && payment.id) {
      const note = `A Square payment (${payment.id}, £${(Number(payment?.amount_money?.amount) / 100).toFixed(2)}) also arrived for this reservation after it had been paid in person. No refund has been made. Please check and refund one of the payments if needed.`;
      const r = await env.DB.prepare(`UPDATE event_bookings SET square_payment_id = ?1, note = CASE WHEN note = '' THEN ?2 ELSE note || char(10) || char(10) || ?2 END WHERE id = ?3 AND square_payment_id IS NULL`)
        .bind(payment.id, note, b.id).run();
      if (r.meta.changes) {
        await audit(env, 'events.attention', `Event booking ${b.reference}: ${note}`).run();
        await followUp(() => mail.notifyAttention(env, b.id));
        return 'needs attention';
      }
    }
    return 'already done';
  }
  if (payment?.status !== 'COMPLETED') return 'not completed';
  const cfg = squareConfig(env);
  const amount = Number(payment?.amount_money?.amount);
  const pid = String(payment.id || '');
  const paidAt = nowIso();
  const problems = [];
  if (amount !== Number(b.total_pence) || payment.amount_money.currency !== 'GBP') problems.push(`Square shows £${(amount / 100).toFixed(2)} paid, but the price was £${(b.total_pence / 100).toFixed(2)}.`);
  if (cfg && payment.location_id && payment.location_id !== cfg.locationId) problems.push('The payment was made to a different Square location.');
  if (problems.length) return flag(env, b, pid, paidAt, problems.join(' '));

  let confirmed = false;
  // A reservation that was released or ran out: its places may already have gone to someone else, so Gary decides
  if (b.reservation_kind && b.status === 'expired') {
    return flag(env, b, pid, paidAt, 'Paid through the private reservation link after the reservation had been released. No tickets have been issued and no refund has been made. Please check the places and contact the customer.');
  }
  if (b.status === 'held' || b.status === 'expired') {
    // A held booking already has its places. One whose hold ran out takes them back only if they are still free:
    // the capacity check in the database refuses it otherwise.
    const event = await getEvent(env, b.event_id);
    if (b.status === 'expired' && (!event || Date.parse(eventStartUtc(event)) <= Date.now())) {
      return flag(env, b, pid, paidAt, 'Paid after the 15-minute hold ran out, and the event has already started. No refund has been made. Please contact the customer.');
    }
    try {
      const r = await env.DB.prepare(`UPDATE event_bookings SET status = 'confirmed', payment_status = 'paid', paid_at = ?1, square_payment_id = ?2, hold_expires_at = NULL
        WHERE id = ?3 AND status IN ('held', 'expired') AND payment_status = 'pending'`).bind(paidAt, pid, b.id).run();
      confirmed = r.meta.changes > 0;
    } catch (err) {
      if (!/EVENT_FULL/.test(String(err && err.message))) throw err;
      return flag(env, b, pid, paidAt, 'Paid after the 15-minute hold ran out, and the event had filled up in the meantime. No refund has been made. Please contact the customer.');
    }
    if (!confirmed) return 'already done';
  } else {
    return flag(env, b, pid, paidAt, 'Paid for a booking that had been cancelled. No refund has been made. Please contact the customer.');
  }
  await afterConfirmed(env, b.id);
  return 'confirmed';
}

export async function eventPaymentArrived(env, payment) {
  if (!payment || !payment.order_id) return 'no order';
  const b = await env.DB.prepare('SELECT * FROM event_bookings WHERE square_order_id = ?1').bind(payment.order_id).first();
  if (!b) return wedPaymentArrived(env, payment);   // Wednesday advance payments have their own records
  return eventPaid(env, b, payment);
}

export async function checkEventWithSquare(env, b) {
  const cfg = squareConfig(env);
  if (!cfg || !b.square_order_id || b.payment_status === 'paid') return null;
  const payment = await paidPaymentForOrder(cfg, b.square_order_id);
  return payment ? eventPaid(env, b, payment) : 'unpaid';
}

// Places held for more than the hold time without payment are released (after asking Square, so a payment made at
// the last moment is never lost), and the Square payment page is closed.
export async function releaseExpiredEventHolds(env, limit = 5) {
  const { results } = await env.DB.prepare(`SELECT * FROM event_bookings WHERE status = 'held' AND hold_expires_at < ?1 ORDER BY hold_expires_at DESC LIMIT ?2`)
    .bind(nowIso(), limit).all();
  const cfg = squareConfig(env);
  for (const b of results || []) {
    try {
      if (cfg && b.square_order_id) {
        const outcome = await checkEventWithSquare(env, b);
        if (outcome && outcome !== 'unpaid') continue;
        await deletePaymentLink(cfg, b.square_payment_link_id);
      }
    } catch (err) {
      console.error("New Way's: could not check a held event booking with Square:", err && err.message ? err.message : err);
      const stale = Date.now() - Date.parse(b.hold_expires_at) > 2 * 3600_000;
      if (!(err && err.status === 404) && !stale) continue;
    }
    const r = await env.DB.prepare(`UPDATE event_bookings SET status = 'expired' WHERE id = ?1 AND status = 'held'`).bind(b.id).run();
    if (r.meta.changes && b.reservation_kind) await afterReservationClosed(env, b, 'expired', 'Released automatically at the payment deadline.', 'Automatic release');
  }
}

// After a reservation stops (released, ran out or cancelled): its private link stops working, and extra places that
// were added for it alone (Admin Override) are taken off the maximum again, so they are never sold to the public.
export async function afterReservationClosed(env, b, how, note, by) {
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  await env.DB.batch([
    env.DB.prepare(`UPDATE event_bookings SET reserve_key = '', reserve_closed = ?1, hold_expires_at = NULL, note = CASE WHEN note = '' THEN ?2 ELSE note || char(10) || char(10) || ?2 END WHERE id = ?3`)
      .bind(how, `${stamp}: ${note}`, b.id),
    audit(env, 'events.reservation', `Reservation ${b.reference} ${how}: ${note}`)
  ]);
  const ev = await env.DB.prepare('SELECT capacity, legacy_places FROM events WHERE id = ?1').bind(b.event_id).first();
  const added = Number(b.reserve_capacity_added) || 0;
  let capacityAfter = ev ? ev.capacity : null;
  let extra = '';
  if (added > 0 && !b.reserve_capacity_returned && ev && ev.capacity > 0) {
    try {
      const r = await env.DB.batch([
        env.DB.prepare(`UPDATE events SET capacity = MAX(0, capacity - ?1) WHERE id = ?2`).bind(added, b.event_id),
        env.DB.prepare(`UPDATE event_bookings SET reserve_capacity_returned = 1 WHERE id = ?1 AND reserve_capacity_returned = 0`).bind(b.id)
      ]);
      if (r[1].meta.changes) { capacityAfter = Math.max(0, ev.capacity - added); extra = ` The ${added} extra ${added === 1 ? 'place' : 'places'} added for it ${added === 1 ? 'was' : 'were'} taken off the maximum again.`; }
    } catch (err) {
      if (!/EVENT_CAPACITY_BELOW_TAKEN/.test(String(err && err.message))) throw err;
      extra = ' The extra places added for it could not be taken off the maximum because they are now booked; the maximum was left as it is.';
    }
  }
  await env.DB.prepare(`INSERT INTO event_allocation_log (event_id, booking_id, action, places, capacity_before, capacity_after, legacy_before, legacy_after, reason, done_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9)`).bind(b.event_id, b.id, 'reservation_' + how, b.quantity, ev ? ev.capacity : null, capacityAfter, ev ? ev.legacy_places : 0, (note + extra).slice(0, 500), by || '').run();
  return extra;
}

// About 24 hours before the event (the job runs every hour), once per booking. Bookings made in the 30 hours before
// the event don't get one: their confirmation has only just arrived. Admin bookings get one only if their
// confirmation email was sent. The same QR code is used (no new token).
export async function sendEventReminders(env, now = Date.now()) {
  // Events starting in the next 24 hours (UK time, so summer time is handled), found first...
  const { results: evs } = await env.DB.prepare(`SELECT id, date, start_time FROM events WHERE date BETWEEN ?1 AND ?2`)
    .bind(new Date(now - 86400_000).toISOString().slice(0, 10), new Date(now + 2 * 86400_000).toISOString().slice(0, 10)).all();
  let budget = 20;
  for (const ev of evs || []) {
    const start = Date.parse(eventStartUtc(ev));
    if (!(start > now && start <= now + 24 * 3600_000)) continue;
    // ...then only the bookings that are due one (so a busy event can never crowd out another)
    const { results } = await env.DB.prepare(`SELECT b.id FROM event_bookings b WHERE b.event_id = ?1 AND b.status = 'confirmed' AND b.purchaser_email != ''
        AND b.personal_data_removed_at IS NULL AND b.created_at < ?2
        AND NOT EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind = 'customer_reminder' AND l.status IN ('sent', 'sending'))
        AND (b.source = 'online' OR EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind = 'customer_confirmation' AND l.status = 'sent'))
      ORDER BY b.id LIMIT ?3`).bind(ev.id, new Date(start - 30 * 3600_000).toISOString(), budget).all();
    for (const row of results || []) { await followUp(() => mail.sendReminder(env, row.id)); budget--; }
    if (budget <= 0) break;
  }
}

// Over the 3 days after a payment: sends again any confirmation or notification email that failed
export async function retryEventFollowUps(env) {
  if (!emailConfigured(env)) return;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const notifyTo = (await getBookingSettings(env)).notification_email || '';
  const { results } = await env.DB.prepare(`SELECT b.* FROM event_bookings b WHERE (b.source = 'online' OR (b.reservation_kind IS NOT NULL AND b.payment_method = 'square_online' AND b.square_payment_id IS NOT NULL)) AND b.paid_at > ?1 AND b.personal_data_removed_at IS NULL
      AND b.status IN ('confirmed', 'needs_attention') AND (
        (b.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind = 'customer_confirmation'))
        OR (b.status = 'confirmed' AND ?2 != '' AND NOT EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind = 'admin_notification'))
        OR (b.status = 'needs_attention' AND ?2 != '' AND NOT EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind = 'admin_attention'))
        OR EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind IN ('customer_confirmation', 'admin_notification', 'admin_attention', 'admin_notification_2', 'admin_attention_2') AND l.status IN ('failed', 'not_configured')))
    ORDER BY b.paid_at DESC LIMIT 20`).bind(since, notifyTo).all();
  for (const b of results || []) {
    await followUp(async () => {
      if (b.status === 'needs_attention') return mail.notifyAttention(env, b.id);
      await mail.sendConfirmation(env, b.id);
      await mail.notifyGary(env, b.id);
    });
  }
}

// Daily: contact details and guest names are removed once the retention period after the event has passed.
// The booking itself (event, date, number of tickets, amount, payment reference, meal totals) is kept.
export async function removeOldEventDetails(env, now = Date.now()) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'customer_retention_months'").first();
  const months = /^\d{1,3}$/.test(String(row?.value ?? '')) && Number(row.value) >= 6 ? Number(row.value) : 24;
  const cut = new Date(now);
  cut.setUTCMonth(cut.getUTCMonth() - months);
  const cutoffDate = cut.toISOString().slice(0, 10);
  const due = `SELECT b.id FROM event_bookings b JOIN events e ON e.id = b.event_id WHERE b.personal_data_removed_at IS NULL AND b.status != 'needs_attention' AND e.date < ?1`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE event_guests SET name = 'Guest ' || position WHERE booking_id IN (${due})`).bind(cutoffDate),
    env.DB.prepare(`UPDATE event_answers SET value = '', original_value = '' WHERE booking_id IN (${due}) AND question_id IN (SELECT id FROM event_questions WHERE type IN ('short_text', 'long_text'))`).bind(cutoffDate),
    env.DB.prepare(`UPDATE event_changes SET old_value = '', new_value = '' WHERE booking_id IN (${due})`).bind(cutoffDate),
    env.DB.prepare(`UPDATE event_email_log SET recipient = '' WHERE booking_id IN (${due})`).bind(cutoffDate),
    env.DB.prepare(`UPDATE event_bookings SET purchaser_name = '', purchaser_email = '', purchaser_phone = '', confirmed_snapshot = '', note = '', personal_data_removed_at = ?2
      WHERE id IN (${due})`).bind(cutoffDate, new Date(now).toISOString())
  ]);
}

export async function eventHourlyJobs(env) {
  for (const job of [() => releaseExpiredEventHolds(env, 10), () => sendEventReminders(env), () => retryEventFollowUps(env)]) {
    try { await job(); } catch (err) { console.error("New Way's: hourly event job failed:", err && err.message ? err.message : err); }
  }
}
