// The emails New Way's sends. Each email is recorded in email_log, so the same one is never sent twice
// (a webhook retry or a second check can't send a duplicate). One that failed or couldn't be sent yet can be tried again.
import { esc } from './lib/html.js';
import { sendEmail } from './lib/email.js';
import { getSettings } from './lib/data.js';
import { getBookingSettings, notificationAddresses } from './bookings/config.js';
import { longDate } from './lib/dates.js';
import { friendlyTime } from './bookings/availability.js';

export const money = (pence) => '£' + (Number(pence) / 100).toFixed(2);
const nowIso = () => new Date().toISOString();

// Claims the right to send one email. Returns false when it was already sent (or is being sent).
async function claim(env, orderId, kind, recipient) {
  const row = await env.DB.prepare(
    `INSERT INTO email_log (order_id, kind, recipient, status, created_at) VALUES (?1, ?2, ?3, 'sending', ?4)
     ON CONFLICT(order_id, kind) DO UPDATE SET status = 'sending', recipient = excluded.recipient, created_at = excluded.created_at
     WHERE email_log.status IN ('failed', 'not_configured')
     RETURNING id`
  ).bind(orderId, kind, recipient, nowIso()).first();
  return !!row;
}

async function deliver(env, orderId, kind, msg) {
  if (!msg.to) return 'no address';
  if (!(await claim(env, orderId, kind, msg.to))) return 'already sent';
  const out = await sendEmail(env, msg);
  await env.DB.prepare('UPDATE email_log SET status = ?1, provider_id = ?2 WHERE order_id = ?3 AND kind = ?4')
    .bind(out.status, out.id || out.error || '', orderId, kind).run();
  return out.status;
}

// An email to Gary, and to the second notification address if one is set (each recorded and sent only once).
// Returns the status of Gary's own copy.
export async function deliverAdmin(env, c, orderId, kind, msg, { scope = 'core', deliverFn = deliver } = {}) {
  let first = 'no address';
  for (const a of notificationAddresses(c.b, scope)) {
    const status = await deliverFn(env, orderId, kind + a.suffix, { ...msg, to: a.to });
    if (!a.suffix) first = status;
  }
  return first;
}

// Plain-text and simple HTML versions of the same message (image: an optional picture, such as a QR code, after the details)
export function build(centre, paragraphs, rows = [], { image = null, after = [] } = {}) {
  const text = [...paragraphs.flatMap((p) => [p, '']), ...rows.map(([k, v]) => `${k}: ${v}`), '', ...after.flatMap((p) => [p, '']), centre].join('\n');
  const para = (p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a style="color:#F8B709" href="$1">$1</a>')}</p>`;
  const html = `<!doctype html><html lang="en-GB"><body style="margin:0;padding:24px;background:#000428;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:560px;margin:0 auto">
<p style="color:#F8B709;font-size:20px;font-family:Georgia,serif;margin:0 0 16px">${esc(centre)}</p>
${paragraphs.map(para).join('')}
${rows.length ? `<table style="border-collapse:collapse;margin:8px 0 16px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#9CC2FF;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table>` : ''}
${image ? `<p style="margin:8px 0 16px"><img src="${esc(image.src)}" width="${Number(image.width) || 240}" height="${Number(image.width) || 240}" alt="${esc(image.alt || '')}" style="display:block;background:#ffffff;border-radius:8px"></p>` : ''}
${after.map(para).join('')}
</div></body></html>`;
  return { text, html };
}

export async function context(env) {
  const [s, b] = await Promise.all([getSettings(env), getBookingSettings(env)]);
  const contact = [s.phone && `phone ${s.phone}`, s.email && `email ${s.email}`].filter(Boolean).join(' or ');
  return { s, b, centre: s.centre_name || 'New Way’s', contact, replyTo: s.email || undefined };
}

const when = (bk) => `${longDate(bk.date, '0000')} at ${friendlyTime(bk.local_start)} (UK time)`;

function readingRows(order, bk) {
  return [['Reading', bk.service_name], ['Date', longDate(bk.date, '0000')], ['Time', friendlyTime(bk.local_start) + ' UK time'],
    ['Length', bk.minutes + ' minutes'], ['How', 'WhatsApp video call'], ['Price paid', money(order.amount_pence)], ['Reference', order.reference]];
}

function readingConfirmationEmail(c, order, bk) {
  return build(c.centre, [
    `Dear ${order.customer_name},`,
    `Thank you. Your private reading with Medium Gary Findlay is booked for ${when(bk)}.`,
    `Your reading will take place by WhatsApp video call, using the mobile number you gave us: ${order.customer_phone}. Please make sure WhatsApp is ready on that phone a few minutes before your reading.`,
    'Cancelling or rearranging:\n' + (order.terms_text || c.b.booking_cancellation_policy),
    c.contact ? `To contact Gary, please ${c.contact}.` : ''
  ].filter(Boolean), readingRows(order, bk));
}

function sendReadingConfirmation(env, c, order, bk, kind) {
  return deliver(env, order.id, kind, { to: order.customer_email, replyTo: c.replyTo,
    subject: `Your private reading is booked: ${longDate(bk.date, '0000')}, ${friendlyTime(bk.local_start)}`, ...readingConfirmationEmail(c, order, bk) });
}

export async function resendReadingConfirmation(env, order, bk, kind) {
  return sendReadingConfirmation(env, await context(env), order, bk, kind);
}

export async function readingConfirmed(env, order, bk) {
  const c = await context(env);
  await sendReadingConfirmation(env, c, order, bk, 'customer_confirmation');
  const admin = build(c.centre, [`New private reading booked and paid: ${when(bk)}.`, `See it in Admin: ${order.origin}/admin/orders/${order.id}`],
    [...readingRows(order, bk), ['Customer', order.customer_name], ['Email', order.customer_email], ['Mobile (WhatsApp)', order.customer_phone], ['Square payment', order.square_payment_id || '']]);
  await deliverAdmin(env, c, order.id, 'admin_notification', { subject: `New booking: ${longDate(bk.date, '0000')}, ${friendlyTime(bk.local_start)}, ${bk.service_name}`, ...admin });
}

export async function readingReminder(env, order, bk) {
  const c = await context(env);
  const msg = build(c.centre, [
    `Dear ${order.customer_name},`,
    `A reminder that your private reading with Medium Gary Findlay is on ${when(bk)}.`,
    `It will take place by WhatsApp video call, using ${order.customer_phone}. Please have WhatsApp ready a few minutes before.`,
    c.contact ? `If you need to contact Gary, please ${c.contact}.` : ''
  ].filter(Boolean), readingRows(order, bk));
  return deliver(env, order.id, 'customer_reminder', { to: order.customer_email, replyTo: c.replyTo, subject: `Reminder: your private reading, ${longDate(bk.date, '0000')} at ${friendlyTime(bk.local_start)}`, ...msg });
}

export async function needsAttention(env, order, bk) {
  const c = await context(env);
  const msg = build(c.centre, [`A payment needs your attention (${order.reference}).`, order.note, `See it in Admin: ${order.origin}/admin/orders/${order.id}`],
    [['Item', order.item_name], ['Amount', money(order.amount_pence)], ['Customer', order.customer_name], ['Email', order.customer_email], ['Mobile', order.customer_phone || ''],
      ...(bk ? [['Appointment', when(bk)]] : []), ['Square payment', order.square_payment_id || '']]);
  await deliverAdmin(env, c, order.id, 'admin_attention', { subject: `Needs attention: payment ${order.reference}`, ...msg });
}

export async function meditationBought(env, order, product, token, kind = 'customer_download') {
  const c = await context(env);
  const link = `${order.origin}/download/${token}`;
  const hours = Number(c.b.download_expiry_hours) || 24;
  const msg = build(c.centre, [
    `Dear ${order.customer_name},`,
    `Thank you for buying “${product.title}”. Your download link is below.`,
    link,
    `IMPORTANT: you have ${hours} hours from your purchase to START your download. Your purchase includes ONE download, so please use the link on the phone or computer where you want to keep the recording. The MP3 file is saved to your Downloads (or My Files), so you can listen any time afterwards.`,
    order.device_protected ? 'For your security, the link works on the phone or computer you bought on. To download on a different device, open the link there and we’ll email you a short code to confirm it’s you. Please don’t forward this email: the link won’t work for anyone else.' : '',
    'Personal-use terms:\n' + (order.terms_text || c.b.meditation_terms),
    c.contact ? `If you have any trouble downloading, please ${c.contact}.` : ''
  ].filter(Boolean), [['Meditation', product.title], ['Price paid', money(order.amount_pence)], ['Reference', order.reference]]);
  const status = await deliver(env, order.id, kind, { to: order.customer_email, replyTo: c.replyTo, subject: `Your meditation: ${product.title}`, ...msg });
  if (kind === 'customer_download') await meditationAdminNotice(env, order, product, c);
  return status;
}

export async function meditationAdminNotice(env, order, product, c) {
  c = c || await context(env);
  const admin = build(c.centre, [`Meditation sold: ${product.title}.`, `See it in Admin: ${order.origin}/admin/orders/${order.id}`],
    [['Price paid', money(order.amount_pence)], ['Customer', order.customer_name], ['Email', order.customer_email], ['Reference', order.reference], ['Square payment', order.square_payment_id || '']]);
  return deliverAdmin(env, c, order.id, 'admin_notification', { subject: `Meditation sold: ${product.title}`, ...admin });
}
