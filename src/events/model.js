// Event tickets: the shared rules. Used by the public booking pages, Admin, check-in and the scheduled jobs.
// The website (not Square, not the browser) decides the event, the price, the number of places and everything about
// the guests. Square only takes the payment.
import { randomToken } from '../lib/http.js';
import { momentOf } from '../bookings/availability.js';
import { normaliseEmail } from '../lib/emails.js';
import { EMAIL_RE } from '../bookings/config.js';
import { longDate } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';

export const QUESTION_TYPES = [
  ['short_text', 'Short answer (one line)'],
  ['long_text', 'Longer answer (a few lines)'],
  ['select', 'Drop-down list (choose one)'],
  ['choice', 'Multiple choice buttons (choose one)'],
  ['checkbox', 'Tick box (yes / no)']
];
export const CHOICE_TYPES = ['select', 'choice'];
export const PAYMENT_METHODS = [
  ['cash', 'Cash'], ['card', 'Card / in person'], ['complimentary', 'Complimentary (free)'], ['square_online', 'Square online'], ['other', 'Other']
];
export const methodLabel = (m) => (PAYMENT_METHODS.find(([k]) => k === m) || [m, m])[1];
export const PAYMENT_STATUS_LABEL = { paid: 'Paid', unpaid: 'To pay', free: 'Free', pending: 'Awaiting payment' };
export const MAX_TICKETS = 20;

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newEventReference() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return 'EV-' + [...a].map((b) => REF_CHARS[b % REF_CHARS.length]).join('');
}
// 128 random bits: what the QR code holds. Nothing personal, and impossible to guess.
export const newCheckinToken = () => randomToken(16);
export const isCheckinToken = (t) => /^[A-Za-z0-9_-]{22}$/.test(String(t || ''));
export const checkinUrl = (origin, token) => `${origin}/c/${token}`;

export const getEvent = (env, id) => env.DB.prepare('SELECT * FROM events WHERE id = ?1').bind(id).first();

// When the event starts (UTC). Uses the start time; without one, 7pm UK time.
export function eventStartUtc(event) {
  return momentOf(event.date, /^\d{2}:\d{2}$/.test(event.start_time || '') ? event.start_time : '19:00');
}

export function eventWhen(event) {
  const parts = [longDate(event.date, '0000')];
  if (event.start_time) parts.push(friendlyTime(event.start_time));
  else if (event.time_text) parts.push(event.time_text);
  return parts.join(', ');
}

export function eventVenue(event, settings = {}) {
  const venue = event.venue || settings.venue_name || '';
  const address = event.address || [settings.address_line1, settings.address_line2, settings.town, settings.postcode].filter(Boolean).join(', ');
  return { venue, address };
}

// Places: held (someone paying now) and confirmed (paid, or booked in Admin) both count
export async function placeCounts(env, eventId) {
  const row = await env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN quantity END), 0) AS confirmed,
      COALESCE(SUM(CASE WHEN status = 'held' THEN quantity END), 0) AS held
    FROM event_bookings WHERE event_id = ?1`).bind(eventId).first();
  return { confirmed: row.confirmed, held: row.held, taken: row.confirmed + row.held };
}

export async function checkinCounts(env, eventId) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS booked, COUNT(g.checked_in_at) AS arrived
    FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id WHERE g.event_id = ?1 AND b.status = 'confirmed'`).bind(eventId).first();
  return { booked: row.booked, arrived: row.arrived, waiting: row.booked - row.arrived };
}

// 'off' (not sold here) | 'past' | 'not_open' | 'closed' | 'sold_out' | 'open'
export function salesState(event, taken, now = Date.now()) {
  if (!event || event.sales_mode !== 'online' || !event.visible) return 'off';
  const start = Date.parse(eventStartUtc(event) || '');
  if (!Number.isFinite(start) || start <= now) return 'past';
  if (event.sales_open_at && Date.parse(event.sales_open_at) > now) return 'not_open';
  if (event.sales_close_at && Date.parse(event.sales_close_at) <= now) return 'closed';
  if (event.capacity > 0 && taken >= event.capacity) return 'sold_out';
  return 'open';
}

export const placesLeft = (event, taken) => (event.capacity > 0 ? Math.max(0, event.capacity - taken) : Infinity);

// The questions for an event, each with its options
export async function questionsFor(env, eventId, { activeOnly = true } = {}) {
  const [qs, opts] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM event_questions WHERE event_id = ?1 ${activeOnly ? 'AND active = 1' : ''} ORDER BY sort_order, id`).bind(eventId),
    env.DB.prepare(`SELECT o.* FROM event_question_options o JOIN event_questions q ON q.id = o.question_id
      WHERE q.event_id = ?1 ORDER BY o.sort_order, o.id`).bind(eventId)
  ]);
  const byQ = {};
  for (const o of opts.results || []) (byQ[o.question_id] = byQ[o.question_id] || []).push(o);
  return (qs.results || []).map((q) => ({ ...q, options: byQ[q.id] || [], activeOptions: (byQ[q.id] || []).filter((o) => o.active) }));
}

// ---------- reading and checking a booking form (the public form and Admin's form use the same rules) ----------

const clean = (v) => String(v ?? '').replace(/\r\n?/g, '\n').trim();

function readAnswer(q, raw, required, key, errors) {
  if (q.type === 'checkbox') {
    if (raw === '1') return { option_id: null, value: 'Yes' };
    if (required) errors[key] = 'Please tick to confirm.';
    return { option_id: null, value: '' };
  }
  if (CHOICE_TYPES.includes(q.type)) {
    if (!raw) { if (required) errors[key] = 'Please choose one.'; return { option_id: null, value: '' }; }
    const opt = q.activeOptions.find((o) => String(o.id) === raw);
    if (!opt) { errors[key] = 'Please choose one of the options.'; return { option_id: null, value: '' }; }
    return { option_id: opt.id, value: opt.label };
  }
  const max = q.type === 'long_text' ? 1000 : 200;
  if (!raw) { if (required) errors[key] = 'Please answer this.'; return { option_id: null, value: '' }; }
  if (raw.length > max) errors[key] = `Please keep this under ${max} characters.`;
  return { option_id: null, value: raw.slice(0, max) };
}

export function normalisePhoneLoose(raw) {
  const s = String(raw || '').replace(/[\s\-().]/g, '');
  if (!/^\+?\d{7,16}$/.test(s)) return null;
  return s;
}

// admin: Gary's own form. Email and phone are optional there, and questions may be left until known.
export function readBookingForm(fields, event, questions, { admin = false } = {}) {
  const errors = {};
  const max = Math.max(1, Math.min(MAX_TICKETS, Number(event.max_per_booking) || 10));
  const qty = Number(clean(fields.qty));
  const values = { qty, guests: [], answers: [], purchaser: {}, marketing: fields.marketing === '1' };
  if (!Number.isInteger(qty) || qty < 1 || qty > (admin ? MAX_TICKETS : max)) {
    errors.qty = `Please choose from 1 to ${admin ? MAX_TICKETS : max} tickets.`;
    return { values, errors };
  }
  const guestQs = questions.filter((q) => q.scope === 'guest');
  const bookingQs = questions.filter((q) => q.scope === 'booking');
  for (let i = 1; i <= qty; i++) {
    const name = clean(fields[`g${i}_name`]).replace(/\s+/g, ' ');
    if (name.length < 2) errors[`g${i}_name`] = 'Please enter this guest’s name.';
    else if (name.length > 80) errors[`g${i}_name`] = 'Please keep the name under 80 characters.';
    const guest = { position: i, name: name.slice(0, 80), answers: [] };
    for (const q of guestQs) {
      const key = `g${i}_q${q.id}`;
      guest.answers.push({ question_id: q.id, question_label: q.label, type: q.type, ...readAnswer(q, clean(fields[key]), q.required && !admin, key, errors) });
    }
    values.guests.push(guest);
  }
  for (const q of bookingQs) {
    const key = `b_q${q.id}`;
    values.answers.push({ question_id: q.id, question_label: q.label, type: q.type, ...readAnswer(q, clean(fields[key]), q.required && !admin, key, errors) });
  }
  const p = { name: clean(fields.p_name).replace(/\s+/g, ' '), email: normaliseEmail(fields.p_email), phone: clean(fields.p_phone) };
  if (!admin || p.name) {
    if (p.name.length < 2) errors.p_name = 'Please enter your name.';
    else if (p.name.length > 80) errors.p_name = 'Please keep the name under 80 characters.';
  }
  if (!admin || p.email) {
    if (p.email.length > 254 || !EMAIL_RE.test(p.email)) errors.p_email = 'Please enter a full email address.';
  }
  if (!admin || p.phone) {
    const phone = normalisePhoneLoose(p.phone);
    if (!phone) errors.p_phone = 'Please enter a phone number, for example 07700 900123.';
    else p.phone = phone;
  }
  if (admin && !p.name && values.guests[0]) p.name = values.guests[0].name;
  values.purchaser = p;
  return { values, errors };
}

// The same values as hidden form fields (carried from the review screen to the final confirmation)
export function hiddenFields(values) {
  const out = [['qty', String(values.qty)], ['p_name', values.purchaser.name], ['p_email', values.purchaser.email], ['p_phone', values.purchaser.phone]];
  if (values.marketing) out.push(['marketing', '1']);
  for (const g of values.guests) {
    out.push([`g${g.position}_name`, g.name]);
    for (const a of g.answers) out.push([`g${g.position}_q${a.question_id}`, a.type === 'checkbox' ? (a.value ? '1' : '') : a.option_id ? String(a.option_id) : a.value]);
  }
  for (const a of values.answers) out.push([`b_q${a.question_id}`, a.type === 'checkbox' ? (a.value ? '1' : '') : a.option_id ? String(a.option_id) : a.value]);
  return out;
}

// Exactly what the customer saw and confirmed, kept with the booking as a record
export function snapshot(event, values, { unitPence, totalPence, termsText = '', at = new Date().toISOString() }) {
  return JSON.stringify({
    confirmed_at: at,
    event: { id: event.id, name: event.name, date: event.date, when: eventWhen(event), venue: event.venue || '' },
    quantity: values.qty, unit_price_pence: unitPence, total_pence: totalPence,
    guests: values.guests.map((g) => ({ guest: g.position, name: g.name, answers: g.answers.filter((a) => a.value).map((a) => ({ question: a.question_label, answer: a.value })) })),
    booking_answers: values.answers.filter((a) => a.value).map((a) => ({ question: a.question_label, answer: a.value })),
    purchaser: values.purchaser, marketing_opt_in: !!values.marketing, terms: termsText
  });
}

// The database steps that store a booking with its guests and answers (all or nothing, run in one batch).
// The capacity trigger refuses the whole batch if the places aren't there.
export function insertBookingStatements(env, b, values) {
  const ref = b.reference;   // our own EV-XXXXXX code
  const bid = `(SELECT id FROM event_bookings WHERE reference = '${ref}')`;
  const out = [env.DB.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence,
      purchaser_name, purchaser_email, purchaser_phone, marketing_opt_in, terms_text, terms_accepted_at, confirmed_snapshot, checkin_token, access_hash, origin,
      hold_expires_at, note, created_at, paid_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)`)
    .bind(b.event_id, ref, b.source, b.status, b.payment_method, b.payment_status, values.qty, b.unit_price_pence, b.total_pence,
      values.purchaser.name || '', values.purchaser.email || '', values.purchaser.phone || '', values.marketing ? 1 : 0, b.terms_text || '', b.terms_accepted_at || null,
      b.confirmed_snapshot || '', b.checkin_token, b.access_hash || '', b.origin || '', b.hold_expires_at || null, b.note || '', b.created_at, b.paid_at || null)];
  for (const g of values.guests) {
    out.push(env.DB.prepare(`INSERT INTO event_guests (booking_id, event_id, position, name, created_at) VALUES (${bid}, ?1, ?2, ?3, ?4)`)
      .bind(b.event_id, g.position, g.name, b.created_at));
    const gid = `(SELECT id FROM event_guests WHERE booking_id = ${bid} AND position = ${Number(g.position)})`;
    for (const a of g.answers) {
      out.push(env.DB.prepare(`INSERT INTO event_answers (booking_id, guest_id, question_id, question_label, option_id, value, original_value, updated_at)
        VALUES (${bid}, ${gid}, ?1, ?2, ?3, ?4, ?4, ?5)`).bind(a.question_id, a.question_label, a.option_id, a.value, b.created_at));
    }
  }
  for (const a of values.answers) {
    out.push(env.DB.prepare(`INSERT INTO event_answers (booking_id, guest_id, question_id, question_label, option_id, value, original_value, updated_at)
      VALUES (${bid}, 0, ?1, ?2, ?3, ?4, ?4, ?5)`).bind(a.question_id, a.question_label, a.option_id, a.value, b.created_at));
  }
  return out;
}

// A booking with its guests and answers
export async function loadBooking(env, where, value) {
  const col = { id: 'id', reference: 'reference', token: 'checkin_token', square: 'square_order_id' }[where];
  const booking = await env.DB.prepare(`SELECT * FROM event_bookings WHERE ${col} = ?1`).bind(value).first();
  if (!booking) return null;
  const [guests, answers] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM event_guests WHERE booking_id = ?1 ORDER BY position').bind(booking.id),
    env.DB.prepare(`SELECT a.*, q.sort_order, q.type FROM event_answers a LEFT JOIN event_questions q ON q.id = a.question_id
      WHERE a.booking_id = ?1 ORDER BY q.sort_order, a.question_id`).bind(booking.id)
  ]);
  const all = answers.results || [];
  booking.guests = (guests.results || []).map((g) => ({ ...g, answers: all.filter((a) => a.guest_id === g.id) }));
  booking.answers = all.filter((a) => a.guest_id === 0);
  return booking;
}

export const isCleared = (b) => !!b.personal_data_removed_at;
