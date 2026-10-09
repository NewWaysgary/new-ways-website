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
  if (b.payment_status === 'paid') return 'already done';
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
  if (!b) return 'unknown order';
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
    await env.DB.prepare(`UPDATE event_bookings SET status = 'expired' WHERE id = ?1 AND status = 'held'`).bind(b.id).run();
  }
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
  const { results } = await env.DB.prepare(`SELECT b.* FROM event_bookings b WHERE b.source = 'online' AND b.paid_at > ?1 AND b.personal_data_removed_at IS NULL
      AND b.status IN ('confirmed', 'needs_attention') AND (
        (b.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind = 'customer_confirmation'))
        OR (b.status = 'confirmed' AND ?2 != '' AND NOT EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind = 'admin_notification'))
        OR (b.status = 'needs_attention' AND ?2 != '' AND NOT EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind = 'admin_attention'))
        OR EXISTS (SELECT 1 FROM event_email_log l WHERE l.booking_id = b.id AND l.kind IN ('customer_confirmation', 'admin_notification', 'admin_attention') AND l.status IN ('failed', 'not_configured')))
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
