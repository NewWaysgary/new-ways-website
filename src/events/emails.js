// Emails for event bookings. These are TRANSACTIONAL emails (confirmations, reminders, notices to Gary): they are
// sent to every purchaser who gave an email address, whatever their mailing-list choice, and never contain marketing.
// Each one is recorded in event_email_log so it is never sent twice; one that failed can be tried again.
import { sendEmail } from '../lib/email.js';
import { build, context, money, deliverAdmin } from '../notify.js';
import { qrPng, base64 } from '../lib/qr.js';
import { eventWhen, eventVenue, checkinUrl, getEvent, loadBooking, methodLabel, PAYMENT_STATUS_LABEL } from './model.js';
import { friendlyTime } from '../bookings/availability.js';
import { longDate } from '../lib/dates.js';

const nowIso = () => new Date().toISOString();

async function claim(env, bookingId, kind, recipient) {
  const row = await env.DB.prepare(
    `INSERT INTO event_email_log (booking_id, kind, recipient, status, created_at) VALUES (?1, ?2, ?3, 'sending', ?4)
     ON CONFLICT(booking_id, kind) DO UPDATE SET status = 'sending', recipient = excluded.recipient, created_at = excluded.created_at
     WHERE event_email_log.status IN ('failed', 'not_configured')
     RETURNING id`
  ).bind(bookingId, kind, recipient, nowIso()).first();
  return !!row;
}

async function deliver(env, bookingId, kind, msg) {
  if (!msg.to) return 'no address';
  if (!(await claim(env, bookingId, kind, msg.to))) return 'already sent';
  const out = await sendEmail(env, msg);
  await env.DB.prepare('UPDATE event_email_log SET status = ?1, provider_id = ?2 WHERE booking_id = ?3 AND kind = ?4')
    .bind(out.status, out.id || out.error || '', bookingId, kind).run();
  return out.status;
}

const guestLines = (b) => b.guests.map((g) => {
  const extra = g.answers.filter((a) => a.value).map((a) => `${a.question_label}: ${a.value}`);
  return `Guest ${g.position}: ${g.name}${extra.length ? ' (' + extra.join('; ') + ')' : ''}`;
}).join('\n');
const bookingAnswerLines = (b) => b.answers.filter((a) => a.value).map((a) => `${a.question_label}: ${a.value}`).join('\n');

function paymentLine(b) {
  if (b.payment_status === 'free') return 'Complimentary';
  if (b.payment_status === 'unpaid') return `${money(b.total_pence)} to pay (${methodLabel(b.payment_method)})`;
  return `${money(b.total_pence)} paid${b.payment_method !== 'square_online' ? ' (' + methodLabel(b.payment_method) + ')' : ''}`;
}

function eventRows(event, b, s) {
  const { venue, address } = eventVenue(event, s);
  return [['Event', event.name], ['Date', longDate(event.date, '0000')],
    ...(event.start_time ? [['Time', friendlyTime(event.start_time) + ' (UK time)']] : event.time_text ? [['Time', event.time_text]] : []),
    ...(event.doors_time ? [['Doors open', friendlyTime(event.doors_time)]] : []),
    ...(venue ? [['Venue', venue]] : []), ...(address ? [['Address', address]] : []),
    ['Tickets', String(b.quantity)], ['Payment', paymentLine(b)], ['Reference', b.reference]];
}

function qrParts(b) {
  const url = checkinUrl(b.origin, b.checkin_token);
  return {
    url,
    image: { src: `${b.origin}/qr/${b.checkin_token}.png`, alt: 'Your check-in QR code', width: 240 },
    attachments: [{ filename: `New-Ways-check-in-${b.reference}.png`, content: base64(qrPng(url, { scale: 8 })) }]
  };
}

async function parts(env, bookingId) {
  const b = await loadBooking(env, 'id', bookingId);
  const event = b && await getEvent(env, b.event_id);
  return { b, event, c: await context(env) };
}

function customerMessage(c, event, b, { reminder = false } = {}) {
  const qr = qrParts(b);
  const p = [
    `Dear ${b.purchaser_name},`,
    reminder ? `A reminder that you are booked for ${event.name} on ${eventWhen(event)}.` : `Thank you. Your booking for ${event.name} on ${eventWhen(event)} is confirmed.`,
    'No physical ticket is required. Your confirmed names are on the New Way’s guest list:\n' + guestLines(b),
    bookingAnswerLines(b),
    event.instructions ? (reminder ? 'Arrival information:\n' : 'Information for the event:\n') + event.instructions : '',
    `At the door, show the QR code below (on your phone, or printed), or just give your name. Your booking is also here: ${qr.url}`
  ].filter(Boolean);
  const after = [c.contact ? `If you need to contact New Way’s, please ${c.contact}.` : ''].filter(Boolean);
  return { ...build(c.centre, p, eventRows(event, b, c.s), { image: qr.image, after }), attachments: qr.attachments };
}

export async function sendConfirmation(env, bookingId, kind = 'customer_confirmation') {
  const { b, event, c } = await parts(env, bookingId);
  if (!b || !event || !b.purchaser_email || b.status !== 'confirmed') return 'no address';
  return deliver(env, b.id, kind, { to: b.purchaser_email, replyTo: c.replyTo, subject: `Your booking: ${event.name}, ${longDate(event.date, '0000')}`, ...customerMessage(c, event, b) });
}

export async function sendReminder(env, bookingId) {
  const { b, event, c } = await parts(env, bookingId);
  if (!b || !event || !b.purchaser_email || b.status !== 'confirmed') return 'no address';
  return deliver(env, b.id, 'customer_reminder', { to: b.purchaser_email, replyTo: c.replyTo,
    subject: `Reminder: ${event.name}, ${longDate(event.date, '0000')}${event.start_time ? ' at ' + friendlyTime(event.start_time) : ''}`, ...customerMessage(c, event, b, { reminder: true }) });
}

function adminRows(event, b) {
  return [['Event', `${event.name}, ${eventWhen(event)}`], ['Purchaser', b.purchaser_name], ['Email', b.purchaser_email || '—'], ['Phone', b.purchaser_phone || '—'],
    ['Tickets', String(b.quantity)], ['Amount', b.payment_status === 'free' ? 'Complimentary' : money(b.total_pence) + ' ' + (PAYMENT_STATUS_LABEL[b.payment_status] || '').toLowerCase()],
    ['Reference', b.reference], ['Mailing list', b.marketing_opt_in ? 'Asked to join' : 'No'], ...(b.square_payment_id ? [['Square payment', b.square_payment_id]] : [])];
}

export async function notifyGary(env, bookingId) {
  const { b, event, c } = await parts(env, bookingId);
  if (!b || !event) return 'no booking';
  const msg = build(c.centre, [`New event booking paid: ${event.name} (${b.quantity} ${b.quantity === 1 ? 'ticket' : 'tickets'}).`,
    'Guests:\n' + guestLines(b), bookingAnswerLines(b), `See it in Admin: ${b.origin}/admin/events/${event.id}/bookings/${b.id}`].filter(Boolean), adminRows(event, b));
  return deliverAdmin(env, c, b.id, 'admin_notification', { subject: `New booking: ${event.name}, ${b.quantity} ${b.quantity === 1 ? 'ticket' : 'tickets'} (${b.reference})`, ...msg },
    { scope: 'events', deliverFn: deliver });
}

export async function notifyAttention(env, bookingId) {
  const { b, event, c } = await parts(env, bookingId);
  if (!b || !event) return 'no booking';
  const msg = build(c.centre, [`An event payment needs your attention (${b.reference}).`, b.note, 'Guests:\n' + guestLines(b),
    `See it in Admin: ${b.origin}/admin/events/${event.id}/bookings/${b.id}`].filter(Boolean), adminRows(event, b));
  return deliverAdmin(env, c, b.id, 'admin_attention', { subject: `Needs attention: event payment ${b.reference}`, ...msg }, { deliverFn: deliver });
}

export const EMAIL_KINDS = { customer_confirmation: 'Confirmation to customer', admin_notification: 'Notification to you', customer_reminder: 'Reminder to customer',
  admin_attention: 'Attention notice to you', admin_notification_2: 'Notification to the second address', admin_attention_2: 'Attention notice to the second address' };
