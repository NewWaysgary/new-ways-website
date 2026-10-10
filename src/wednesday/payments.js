// Wednesday advance payments: confirming payment (only a verified Square payment does that), the confirmation with
// its QR code, the 6pm reminder on the evening, closure notices, and tidying up. Every email is recorded in
// wed_email_log, so each one is only ever sent once successfully (a webhook retry can't send a duplicate).
import { squareConfig, paidPaymentForOrder, deletePaymentLink } from '../payments/square.js';
import { sendEmail, emailConfigured } from '../lib/email.js';
import { build, context } from '../notify.js';
import { qrPng, base64 } from '../lib/qr.js';
import { longDate, ukToday, londonLocalToUtc, utcToLondonLocal } from '../lib/dates.js';
import { audit } from '../lib/data.js';
import { wedCheckinUrl, pounds, summaryText, raffleStrips, night as loadNight } from './model.js';

const nowIso = () => new Date().toISOString();

async function claim(env, orderId, kind, recipient) {
  const row = await env.DB.prepare(
    `INSERT INTO wed_email_log (order_id, kind, recipient, status, created_at) VALUES (?1, ?2, ?3, 'sending', ?4)
     ON CONFLICT(order_id, kind) DO UPDATE SET status = 'sending', recipient = excluded.recipient, created_at = excluded.created_at
     WHERE wed_email_log.status IN ('failed', 'not_configured')
     RETURNING id`).bind(orderId, kind, recipient, nowIso()).first();
  return !!row;
}

async function deliver(env, orderId, kind, msg) {
  if (!msg.to) return 'no address';
  if (!(await claim(env, orderId, kind, msg.to))) return 'already sent';
  const out = await sendEmail(env, msg);
  await env.DB.prepare('UPDATE wed_email_log SET status = ?1, provider_id = ?2 WHERE order_id = ?3 AND kind = ?4').bind(out.status, out.id || out.error || '', orderId, kind).run();
  return out.status;
}

export async function loadOrder(env, where, value) {
  const col = { id: 'id', reference: 'reference', token: 'checkin_token', square: 'square_order_id' }[where];
  const order = await env.DB.prepare(`SELECT * FROM wed_orders WHERE ${col} = ?1`).bind(value).first();
  if (!order) return null;
  const { results } = await env.DB.prepare('SELECT * FROM wed_order_lines WHERE order_id = ?1 ORDER BY id').bind(order.id).all();
  order.lines = results || [];
  return order;
}

function orderMessage(c, o, { reminder = false } = {}) {
  const url = wedCheckinUrl(o.origin, o.checkin_token);
  const strips = raffleStrips(o.lines);
  const p = [
    reminder ? `See you tonight at New Way’s! Here is your QR code for this evening, ${longDate(o.night_date, '0000')}.` : `Thank you. Your advance payment for Wednesday ${longDate(o.night_date, '0000').replace(/^Wednesday /, '')} at New Way’s is confirmed.`,
    'You have paid for:\n' + o.lines.map((l) => `${l.qty} × ${l.label}`).join('\n'),
    strips ? `Your ${strips} raffle ${strips === 1 ? 'strip is' : 'strips are'} given to you at the door.` : '',
    `At the door, show this QR code (on your phone, or printed). Your payment is also here: ${url}`,
    c.s.doors_open ? `Doors open at ${c.s.doors_open}${c.s.service_start ? ', and the service starts at ' + c.s.service_start : ''}.` : ''
  ].filter(Boolean);
  const after = [c.contact ? `If you need to contact New Way’s, please ${c.contact}.` : ''].filter(Boolean);
  const rows = [['Evening', longDate(o.night_date, '0000')], ['Paid', pounds(o.total_pence)], ['Reference', o.reference]];
  return {
    ...build(c.centre, p, rows, { image: { src: `${o.origin}/wq/${o.checkin_token}.png`, alt: 'Your QR code', width: 240 }, after }),
    attachments: [{ filename: `New-Ways-Wednesday-${o.reference}.png`, content: base64(qrPng(url, { scale: 8 })) }]
  };
}

export async function sendWedConfirmation(env, orderId, kind = 'customer_confirmation') {
  const o = await loadOrder(env, 'id', orderId);
  if (!o || o.status !== 'paid' || !o.email || o.refunded_at) return 'no address';
  const c = await context(env);
  return deliver(env, o.id, kind, { to: o.email, replyTo: c.replyTo, subject: `Your Wednesday at New Way’s: ${longDate(o.night_date, '0000')}`, ...orderMessage(c, o) });
}

// ---------- payment ----------
async function flag(env, o, pid, note) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE wed_orders SET status = 'needs_attention', paid_at = ?1, square_payment_id = ?2, note = ?3 WHERE id = ?4 AND status IN ('pending', 'expired', 'cancelled')`).bind(nowIso(), pid || null, note, o.id),
    audit(env, 'wednesday.attention', `Wednesday payment ${o.reference} needs attention: ${note}`)
  ]);
  return 'needs attention';
}

export async function wedPaid(env, o, payment) {
  if (!o) return 'unknown order';
  if (o.status === 'paid' || (o.status === 'needs_attention' && o.square_payment_id)) return 'already done';
  if (payment?.status !== 'COMPLETED') return 'not completed';
  const cfg = squareConfig(env);
  const amount = Number(payment?.amount_money?.amount);
  const pid = String(payment.id || '');
  if (amount !== Number(o.total_pence) || payment.amount_money.currency !== 'GBP') return flag(env, o, pid, `Square shows ${pounds(amount)} paid, but the total was ${pounds(o.total_pence)}.`);
  if (cfg && payment.location_id && payment.location_id !== cfg.locationId) return flag(env, o, pid, 'The payment was made to a different Square location.');
  if (o.status === 'cancelled') return flag(env, o, pid, 'Paid for an advance payment that had been cancelled. No refund has been made.');
  const r = await env.DB.prepare(`UPDATE wed_orders SET status = 'paid', paid_at = ?1, square_payment_id = ?2 WHERE id = ?3 AND status IN ('pending', 'expired')`)
    .bind(nowIso(), pid, o.id).run();
  if (!r.meta.changes) return 'already done';
  try { await sendWedConfirmation(env, o.id); } catch (err) { console.error("New Way's: Wednesday confirmation not sent (will be retried):", err && err.message); }
  return 'confirmed';
}

export async function wedPaymentArrived(env, payment) {
  if (!payment || !payment.order_id) return 'no order';
  const o = await env.DB.prepare('SELECT * FROM wed_orders WHERE square_order_id = ?1').bind(payment.order_id).first();
  if (!o) return 'unknown order';
  return wedPaid(env, o, payment);
}

export async function checkWedWithSquare(env, o) {
  const cfg = squareConfig(env);
  if (!cfg || !o.square_order_id || o.status === 'paid') return null;
  const payment = await paidPaymentForOrder(cfg, o.square_order_id);
  return payment ? wedPaid(env, o, payment) : 'unpaid';
}

// ---------- 6pm on the evening ----------
// Between 6pm and 8pm UK time on a Wednesday: every advance payment for TONIGHT that was paid before 6pm gets its
// confirmation and QR code again, once. Nothing is sent for a closed evening, a refunded payment, or anyone who
// paid after 6pm (their confirmation has only just arrived). A dedicated 6pm trigger runs this, and the hourly job
// runs it too in case that trigger was late.
export function sixPmWindow(now = Date.now()) {
  const local = utcToLondonLocal(new Date(now).toISOString());
  const [date, time] = local.split('T');
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return { date, open: day === 3 && time >= '18:00' && time < '20:00' };
}

export async function sendSixPmReminders(env, now = Date.now()) {
  const w = sixPmWindow(now);
  if (!w.open || !emailConfigured(env)) return 0;
  try { await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('system_last_6pm', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(new Date(now).toISOString()).run(); } catch { /* not important */ }
  const n = await loadNight(env, w.date);
  if (n.closed_for_public) return 0;
  const sixPm = londonLocalToUtc(`${w.date}T18:00`);
  const { results } = await env.DB.prepare(`SELECT o.id FROM wed_orders o WHERE o.night_date = ?1 AND o.status = 'paid' AND o.refunded_at IS NULL AND o.email != ''
      AND o.paid_at < ?2 AND NOT EXISTS (SELECT 1 FROM wed_email_log l WHERE l.order_id = o.id AND l.kind = 'reminder_6pm' AND l.status IN ('sent', 'sending'))
    ORDER BY o.id LIMIT 50`).bind(w.date, sixPm).all();
  const c = await context(env);
  let sent = 0;
  for (const row of results || []) {
    const o = await loadOrder(env, 'id', row.id);
    try {
      const st = await deliver(env, o.id, 'reminder_6pm', { to: o.email, replyTo: c.replyTo, subject: `Tonight at New Way’s: your QR code (${o.reference})`, ...orderMessage(c, o, { reminder: true }) });
      if (st === 'sent') sent++;
    } catch (err) { console.error("New Way's: 6pm email failed:", err && err.message); }
  }
  return sent;
}

// ---------- emergency closure: tell everyone who paid in advance for that evening (once each) ----------
export async function sendClosureNotices(env, date, message) {
  const { results } = await env.DB.prepare(`SELECT id FROM wed_orders WHERE night_date = ?1 AND status = 'paid' AND email != '' AND personal_data_removed_at IS NULL`).bind(date).all();
  const c = await context(env);
  const out = { sent: 0, failed: 0, already: 0 };
  for (const row of results || []) {
    const o = await loadOrder(env, 'id', row.id);
    const msg = build(c.centre, [
      `We’re sorry: New Way’s is CLOSED on ${longDate(date, '0000')}.`, message,
      `You paid ${pounds(o.total_pence)} in advance for that evening (${summaryText(o.lines)}). We will be in touch about your payment.`,
      c.contact ? `If you have any questions, please ${c.contact}.` : ''
    ].filter(Boolean), [['Reference', o.reference]]);
    const st = await deliver(env, o.id, 'closure_notice', { to: o.email, replyTo: c.replyTo, subject: `New Way’s is closed on ${longDate(date, '0000')}`, ...msg });
    if (st === 'sent') out.sent++; else if (st === 'already sent') out.already++; else out.failed++;
  }
  return out;
}

// ---------- hourly ----------
export async function wedHourlyJobs(env) {
  for (const job of [() => sendSixPmReminders(env), () => closeAbandonedWed(env), () => retryWedConfirmations(env)]) {
    try { await job(); } catch (err) { console.error("New Way's: hourly Wednesday job failed:", err && err.message ? err.message : err); }
  }
}

// Unpaid advance payments older than 2 hours: Square is asked first (so a payment is never lost), then they are closed
async function closeAbandonedWed(env) {
  const cut = new Date(Date.now() - 2 * 3600_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT * FROM wed_orders WHERE status = 'pending' AND created_at < ?1 ORDER BY created_at LIMIT 10`).bind(cut).all();
  const cfg = squareConfig(env);
  for (const o of results || []) {
    try {
      if (cfg && o.square_order_id) {
        const outcome = await checkWedWithSquare(env, o);
        if (outcome && outcome !== 'unpaid') continue;
        await deletePaymentLink(cfg, o.square_payment_link_id);
      }
    } catch (err) {
      if (!(err && err.status === 404) && Date.parse(o.created_at) > Date.now() - 3 * 86400_000) continue;
    }
    await env.DB.prepare(`UPDATE wed_orders SET status = 'expired' WHERE id = ?1 AND status = 'pending'`).bind(o.id).run();
  }
}

async function retryWedConfirmations(env) {
  if (!emailConfigured(env)) return;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT o.id FROM wed_orders o WHERE o.status = 'paid' AND o.paid_at > ?1 AND o.email != '' AND o.refunded_at IS NULL AND (
      NOT EXISTS (SELECT 1 FROM wed_email_log l WHERE l.order_id = o.id AND l.kind = 'customer_confirmation')
      OR EXISTS (SELECT 1 FROM wed_email_log l WHERE l.order_id = o.id AND l.kind = 'customer_confirmation' AND l.status IN ('failed', 'not_configured')))
    ORDER BY o.paid_at DESC LIMIT 20`).bind(since).all();
  for (const r of results || []) {
    try { await sendWedConfirmation(env, r.id); } catch (err) { console.error("New Way's: Wednesday confirmation retry failed:", err && err.message); }
  }
}

// Daily: the email address is removed once the retention period has passed (the payment record itself is kept)
export async function removeOldWedDetails(env, now = Date.now()) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'customer_retention_months'").first();
  const months = /^\d{1,3}$/.test(String(row?.value ?? '')) && Number(row.value) >= 6 ? Number(row.value) : 24;
  const cut = new Date(now);
  cut.setUTCMonth(cut.getUTCMonth() - months);
  const cutoffDate = cut.toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(`UPDATE wed_email_log SET recipient = '' WHERE order_id IN (SELECT id FROM wed_orders WHERE personal_data_removed_at IS NULL AND night_date < ?1 AND status != 'needs_attention')`).bind(cutoffDate),
    env.DB.prepare(`UPDATE wed_orders SET email = '', personal_data_removed_at = ?2 WHERE personal_data_removed_at IS NULL AND night_date < ?1 AND status != 'needs_attention'`).bind(cutoffDate, new Date(now).toISOString())
  ]);
}

export { ukToday };
