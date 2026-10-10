// Orders of every kind (private readings and meditations): references, private order links, payment confirmation,
// payment holds running out, and download links. Confirming a payment is safe to repeat: the same payment arriving
// twice (webhook retries, the customer's return page, the hourly check) changes nothing the second time.
import { randomToken } from './lib/http.js';
import { squareConfig, paidPaymentForOrder, deletePaymentLink } from './payments/square.js';
import { slotsFor, loadRules, windowsFor, startTimes } from './bookings/availability.js';
import { getBookingSettings, numberSetting } from './bookings/config.js';
import * as notify from './notify.js';
import { emailConfigured } from './lib/email.js';
import { DOWNLOADS_PER_PURCHASE } from './shop/downloads.js';
import { audit } from './lib/data.js';
import { eventPaymentArrived, eventHourlyJobs } from './events/payments.js';
import { wedHourlyJobs } from './wednesday/payments.js';

const nowIso = () => new Date().toISOString();
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newReference() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return 'NW-' + [...a].map((b) => REF_CHARS[b % REF_CHARS.length]).join('');
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The private key in a customer's order link: only its hash is stored
export async function newAccessKey() {
  const key = randomToken(24);
  return { key, hash: await sha256Hex('order:' + key) };
}

export async function orderForCustomer(env, reference, key) {
  if (!/^NW-[A-Z0-9]{6}$/.test(String(reference || '')) || !key || String(key).length > 100) return null;
  const order = await env.DB.prepare('SELECT * FROM orders WHERE reference = ?1').bind(reference).first();
  if (!order || !order.access_hash) return null;
  const hash = await sha256Hex('order:' + key);
  return hash === order.access_hash ? order : null;
}

export const bookingForOrder = (env, orderId) => env.DB.prepare('SELECT * FROM bookings WHERE order_id = ?1').bind(orderId).first();

export const orderLink = (order, key) => `${order.origin}/order/${order.reference}?key=${encodeURIComponent(key)}`;

// ---------- payment confirmed ----------

// `payment` is a Square payment object (from a verified webhook or read from Square's API)
export async function markPaid(env, order, payment) {
  if (!order) return 'unknown order';
  if (order.status === 'paid' || (order.status === 'needs_attention' && order.square_payment_id)) return 'already done';
  const cfg = squareConfig(env);
  const amount = Number(payment?.amount_money?.amount);
  const problems = [];
  if (payment?.status !== 'COMPLETED') return 'not completed';
  if (amount !== Number(order.amount_pence) || payment.amount_money.currency !== 'GBP') problems.push(`Square shows £${(amount / 100).toFixed(2)} paid, but the price was £${(order.amount_pence / 100).toFixed(2)}.`);
  if (cfg && payment.location_id && payment.location_id !== cfg.locationId) problems.push('The payment was made to a different Square location.');
  const paidAt = nowIso();
  const pid = String(payment.id || '');

  if (problems.length) return flag(env, order, pid, paidAt, problems.join(' '));

  if (order.kind === 'PRIVATE_READING') {
    const booking = await bookingForOrder(env, order.id);
    if (!booking) return flag(env, order, pid, paidAt, 'Paid, but the booking record is missing.');
    let confirmed = false;
    if (booking.status === 'held') {
      // Only while the appointment is still held (checked inside the same all-or-nothing database step)
      const [o] = await env.DB.batch([
        env.DB.prepare(`UPDATE orders SET status = 'paid', paid_at = ?1, square_payment_id = ?2 WHERE id = ?3 AND status IN ('pending', 'expired')
          AND EXISTS (SELECT 1 FROM bookings WHERE id = ?4 AND status = 'held')`).bind(paidAt, pid, order.id, booking.id),
        env.DB.prepare(`UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = ?1 AND status = 'held'`).bind(booking.id)
      ]);
      confirmed = o.meta.changes > 0;
      if (!confirmed) {
        const now = await env.DB.prepare('SELECT status FROM orders WHERE id = ?1').bind(order.id).first();
        if (now && now.status !== 'pending' && now.status !== 'expired') return 'already done';
      }
    }
    if (!confirmed) {
      // The hold had run out before the payment arrived: take the time back if it is still free, still in the future
      // and still within Gary's hours (he may have closed or blocked it since).
      const rules = await loadRules(env, booking.date, booking.date);
      const stillOffered = startTimes(windowsFor(booking.date, rules).windows, booking.minutes).includes(booking.local_start);
      if (Date.parse(booking.start_utc) <= Date.now() || !stillOffered) {
        return flag(env, order, pid, paidAt, 'Paid after the 15-minute hold ran out, and that time is no longer available (it has passed, or has since been closed or blocked). No refund has been made. Please contact the customer.');
      }
      const slots = slotsFor(booking.start_utc, booking.minutes);
      try {
        await env.DB.batch([
          ...slots.map((s) => env.DB.prepare('INSERT INTO booking_slots (slot_utc, booking_id) VALUES (?1, ?2)').bind(s, booking.id)),
          env.DB.prepare(`UPDATE orders SET status = 'paid', paid_at = ?1, square_payment_id = ?2 WHERE id = ?3 AND status IN ('pending', 'expired')`).bind(paidAt, pid, order.id),
          env.DB.prepare(`UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = ?1`).bind(booking.id)
        ]);
      } catch {
        return flag(env, order, pid, paidAt, 'Paid after the 15-minute hold ran out, and that time had already been booked by someone else. No refund has been made. Please contact the customer.');
      }
    }
    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(order.id).first();
    await followUp(() => notify.readingConfirmed(env, fresh, booking && { ...booking, status: 'confirmed' }));
    return 'confirmed';
  }

  if (order.kind === 'MEDITATION_PURCHASE') {
    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(order.product_id).first();
    if (!product || !product.full_key) return flag(env, order, pid, paidAt, 'Paid, but the meditation recording could not be found.');
    const r = await env.DB.prepare(`UPDATE orders SET status = 'paid', paid_at = ?1, square_payment_id = ?2 WHERE id = ?3 AND status IN ('pending', 'expired')`).bind(paidAt, pid, order.id).run();
    if (!r.meta.changes) return 'already done';
    // The payment is recorded first. If making the link or sending the email fails, the hourly job tries again.
    await followUp(async () => {
      const token = await createDownload(env, order, product);
      const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(order.id).first();
      await notify.meditationBought(env, fresh, product, token);
    });
    return 'confirmed';
  }
  return 'unknown order';
}

async function followUp(step) {
  try { await step(); } catch (err) { console.error("New Way's: follow-up after payment failed (will be retried):", err && err.message ? err.message : err); }
}

async function flag(env, order, pid, paidAt, note) {
  const r = await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET status = 'needs_attention', paid_at = ?1, square_payment_id = ?2, note = ?3 WHERE id = ?4 AND status IN ('pending', 'expired', 'cancelled')`).bind(paidAt, pid || null, note, order.id),
    env.DB.prepare(`UPDATE bookings SET status = 'needs_attention' WHERE order_id = ?1 AND status IN ('held', 'expired', 'cancelled')`).bind(order.id),
    audit(env, 'orders.attention', `Order ${order.reference} needs attention: ${note}`)
  ]);
  if (r[0].meta.changes) {
    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(order.id).first();
    await followUp(async () => notify.needsAttention(env, fresh, await bookingForOrder(env, order.id)));
  }
  return 'needs attention';
}

// Square's webhook (already signature-checked) and the customer's return page both end up here
export async function paymentArrived(env, payment) {
  if (!payment || !payment.order_id) return 'no order';
  const order = await env.DB.prepare('SELECT * FROM orders WHERE square_order_id = ?1').bind(payment.order_id).first();
  if (!order) return eventPaymentArrived(env, payment);   // event tickets have their own records
  return markPaid(env, order, payment);
}

// Asks Square directly (used when the customer comes back from paying, and before a hold is released)
export async function checkWithSquare(env, order) {
  const cfg = squareConfig(env);
  if (!cfg || !order.square_order_id || order.status === 'paid') return null;
  const payment = await paidPaymentForOrder(cfg, order.square_order_id);
  return payment ? markPaid(env, order, payment) : 'unpaid';
}

// ---------- holds that ran out ----------

// Releases appointments held for more than the hold time without payment. Square is asked first, so a payment made
// at the last moment is never lost, and the payment page is closed so the customer can't pay afterwards.
export async function releaseExpiredHolds(env, limit = 5) {
  const now = nowIso();
  const { results } = await env.DB.prepare(
    `SELECT b.id AS booking_id, b.hold_expires_at, o.* FROM bookings b JOIN orders o ON o.id = b.order_id
     WHERE b.status = 'held' AND b.hold_expires_at < ?1 ORDER BY b.hold_expires_at DESC LIMIT ?2`
  ).bind(now, limit).all();
  const cfg = squareConfig(env);
  for (const row of results || []) {
    const { booking_id: bookingId, ...order } = row;
    try {
      if (cfg && order.square_order_id) {
        const outcome = await checkWithSquare(env, order);
        if (outcome && outcome !== 'unpaid') continue;
        await deletePaymentLink(cfg, order.square_payment_link_id);
      }
    } catch (err) {
      // Square couldn't be asked: keep the hold and try again later, rather than risk losing a payment. After 2 hours
      // (or if Square says it doesn't know the order) the hold is released anyway: a payment that still arrives later
      // is handled as a late payment (booked if the time is free, otherwise flagged for Gary), so nothing is lost.
      console.error("New Way's: could not check a held booking with Square:", err && err.message ? err.message : err);
      const stale = Date.now() - Date.parse(order.hold_expires_at || row.hold_expires_at || now) > 2 * 3600_000;
      if (!(err && err.status === 404) && !stale) continue;
    }
    await env.DB.batch([
      env.DB.prepare(`UPDATE bookings SET status = 'expired' WHERE id = ?1 AND status = 'held'`).bind(bookingId),
      env.DB.prepare(`DELETE FROM booking_slots WHERE booking_id = ?1 AND NOT EXISTS (SELECT 1 FROM bookings WHERE id = ?1 AND status IN ('held', 'confirmed', 'needs_attention'))`).bind(bookingId),
      env.DB.prepare(`UPDATE orders SET status = 'expired' WHERE id = ?1 AND status = 'pending'`).bind(order.id)
    ]);
  }
}

// Meditation orders whose payment page was never used: close them after a day so the list stays tidy.
export async function closeAbandonedOrders(env) {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT * FROM orders WHERE kind = 'MEDITATION_PURCHASE' AND status = 'pending' AND created_at < ?1 LIMIT 5`).bind(cutoff).all();
  const cfg = squareConfig(env);
  for (const order of results || []) {
    try {
      if (cfg && order.square_order_id) {
        const outcome = await checkWithSquare(env, order);
        if (outcome && outcome !== 'unpaid') continue;
        await deletePaymentLink(cfg, order.square_payment_link_id);
      }
    } catch (err) {
      if (!(err && err.status === 404) && Date.parse(order.created_at) > Date.now() - 3 * 86400_000) continue;
    }
    await env.DB.prepare(`UPDATE orders SET status = 'expired' WHERE id = ?1 AND status = 'pending'`).bind(order.id).run();
  }
}

// ---------- secure downloads ----------

// A new download link (any earlier one for the order is switched off). Returns the private token (only emailed).
export async function createDownload(env, order, product, { anyDevice = false } = {}) {
  const settings = await getBookingSettings(env);
  const hours = numberSetting(settings, 'download_expiry_hours');
  const attempts = DOWNLOADS_PER_PURCHASE;   // ONE download per purchase (fixed, not a setting)
  const token = randomToken(32);
  await env.DB.batch([
    env.DB.prepare(`UPDATE download_entitlements SET revoked_at = ?1 WHERE order_id = ?2 AND revoked_at IS NULL`).bind(nowIso(), order.id),
    env.DB.prepare(`INSERT INTO download_entitlements (order_id, product_id, file_key, token_hash, expires_at, max_attempts, any_device) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(order.id, product.id, product.full_key, await sha256Hex('download:' + token), new Date(Date.now() + hours * 3600_000).toISOString(), attempts, anyDevice ? 1 : 0)
  ]);
  return token;
}

export const downloadLink = (order, token) => `${order.origin}/download/${token}`;

// ---------- reminders, the day before ----------
// Sent once, about 24 hours before the reading (the job runs every hour). Readings booked less than 30 hours ahead
// don't get a separate reminder: the confirmation email has only just been sent.
export async function sendReminders(env, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT b.*, o.id AS oid FROM bookings b JOIN orders o ON o.id = b.order_id
     WHERE b.status = 'confirmed' AND o.status = 'paid' AND b.start_utc > ?1 AND b.start_utc <= ?2
       AND o.paid_at < strftime('%Y-%m-%dT%H:%M:%fZ', b.start_utc, '-30 hours')
       AND NOT EXISTS (SELECT 1 FROM email_log e WHERE e.order_id = o.id AND e.kind = 'customer_reminder' AND e.status IN ('sent', 'sending'))
     ORDER BY b.start_utc LIMIT 20`
  ).bind(new Date(now).toISOString(), new Date(now + 24 * 3600_000).toISOString()).all();
  for (const row of results || []) {
    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(row.oid).first();
    await notify.readingReminder(env, order, row);
  }
}

// ---------- anything after a payment that didn't complete ----------
// Over the 3 days after a payment: makes a missing download link, and sends again any confirmation, download or
// notification email that failed (each email is still only ever sent once successfully).
export async function retryFollowUps(env) {
  if (!emailConfigured(env)) return;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const KINDS = `('customer_confirmation', 'admin_notification', 'customer_download', 'admin_attention', 'admin_notification_2', 'admin_attention_2')`;
  const notifyTo = (await getBookingSettings(env)).notification_email;
  const { results } = await env.DB.prepare(
    `SELECT o.* FROM orders o WHERE o.status IN ('paid', 'needs_attention') AND o.paid_at > ?1 AND o.personal_data_removed_at IS NULL
       AND (o.kind = 'MEDITATION_PURCHASE' OR o.status = 'needs_attention' OR EXISTS (SELECT 1 FROM bookings b WHERE b.order_id = o.id AND b.status = 'confirmed'))
       AND (o.kind = 'PRIVATE_READING' OR EXISTS (SELECT 1 FROM products p WHERE p.id = o.product_id AND p.full_key != ''))
       AND (
       (o.status = 'paid' AND NOT EXISTS (SELECT 1 FROM email_log e WHERE e.order_id = o.id AND e.kind IN ('customer_confirmation', 'customer_download')))
       OR (o.status = 'needs_attention' AND ?2 != '' AND NOT EXISTS (SELECT 1 FROM email_log e WHERE e.order_id = o.id AND e.kind = 'admin_attention'))
       OR EXISTS (SELECT 1 FROM email_log e WHERE e.order_id = o.id AND e.kind IN ${KINDS} AND e.status IN ('failed', 'not_configured')))
     ORDER BY o.paid_at DESC LIMIT 20`).bind(since, notifyTo || '').all();
  for (const order of results || []) {
    await followUp(async () => {
      const sent = Object.fromEntries(((await env.DB.prepare('SELECT kind, status FROM email_log WHERE order_id = ?1').bind(order.id).all()).results || []).map((r) => [r.kind, r.status]));
      if (order.status === 'needs_attention') return notify.needsAttention(env, order, await bookingForOrder(env, order.id));
      if (order.kind === 'PRIVATE_READING') {
        const bk = await bookingForOrder(env, order.id);
        if (bk && bk.status === 'confirmed') await notify.readingConfirmed(env, order, bk);
        return;
      }
      const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(order.product_id).first();
      if (!product) return;
      if (sent.customer_download !== 'sent' && sent.customer_download !== 'sending') {
        await notify.meditationBought(env, order, product, await createDownload(env, order, product));
      } else if (sent.admin_notification !== 'sent' || (sent.admin_notification_2 && sent.admin_notification_2 !== 'sent')) {
        await notify.meditationAdminNotice(env, order, product);
      }
    });
  }
}

// Everything that runs every hour
export async function hourlyJobs(env) {
  for (const job of [() => releaseExpiredHolds(env, 10), () => closeAbandonedOrders(env), () => sendReminders(env), () => retryFollowUps(env), () => eventHourlyJobs(env), () => wedHourlyJobs(env)]) {
    try { await job(); } catch (err) { console.error("New Way's: hourly job failed:", err && err.message ? err.message : err); }
  }
  // For Admin > System status: when the scheduled job last ran
  try {
    await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('system_last_hourly', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(new Date().toISOString()).run();
  } catch { /* not important */ }
}
