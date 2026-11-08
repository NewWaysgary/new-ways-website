// Admin › Events › (event) › Import a paper list: bookings taken on paper (or by phone, or at a previous event) typed or
// pasted in one go, so those guests are on the guest list and can check themselves in on the iPad by name.
// Each line is one booking; the names on a line are the guests on that booking. Nothing is emailed and nobody is
// charged. It always shows exactly what will be added first, and adds nothing until "Import" is tapped.
// Everything is added in one database step: either every booking on the list is added, or none is.
import { textResponse, redirect, siteOrigin } from '../lib/http.js';
import * as data from '../lib/data.js';
import * as m from '../events/model.js';
import { nameKey } from '../selfcheckin/names.js';
import * as view from '../views/admin-paper-import.js';

export const MAX_LINES = 150;
export const PAY_CHOICES = [
  ['paid_cash', 'Paid in cash'],
  ['paid_card', 'Paid by card'],
  ['paid_other', 'Paid (other way)'],
  ['unpaid', 'To pay at the door'],
  ['free', 'Complimentary (free)']
];
const stampNow = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());

// One booking per line. Names are separated by commas, semicolons, "&" or "+". Numbering such as "1." or "3)" at the
// start of a line, and bullet marks, are ignored.
export function parsePaperList(text) {
  const bookings = [], problems = [];
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(/^\s*(?:[-•*]|\d{1,3}[.)])\s*/, '').trim();
    if (!line) return;
    const names = line.split(/[,;&+]/).map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const bad = names.filter((n) => n.length < 2 || n.length > 80);
    if (bad.length) { problems.push(`Line ${i + 1}: “${bad[0]}” isn’t a full name (2 to 80 letters).`); return; }
    if (names.length > m.MAX_TICKETS) { problems.push(`Line ${i + 1}: ${names.length} names. One booking can have up to ${m.MAX_TICKETS}; split it over two lines.`); return; }
    bookings.push({ line: i + 1, names });
  });
  if (bookings.length > MAX_LINES) problems.push(`That’s ${bookings.length} bookings. Please import up to ${MAX_LINES} at a time.`);
  return { bookings, problems };
}

function readOptions(fields, event) {
  const pay = PAY_CHOICES.some(([k]) => k === fields.pay) ? fields.pay : 'paid_cash';
  return { pay, fromLegacy: fields.legacy === '1' && Number(event.legacy_places) > 0, note: String(fields.note || '').trim().slice(0, 300) };
}

async function existingKeys(env, eventId) {
  const { results } = await env.DB.prepare(`SELECT g.name FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id WHERE g.event_id = ?1 AND b.status IN ('held', 'confirmed')`).bind(eventId).all();
  return new Set((results || []).map((g) => nameKey(g.name)));
}

export async function handlePaperImport({ request, env, url, method, form, page, csrf, event, admin }) {
  const who = admin.role === 'owner' ? 'Gary' : admin.name || admin.email || 'Admin';
  const counts = await m.placeCounts(env, event.id);
  const left = event.capacity > 0 ? Math.max(0, event.capacity - counts.taken) : null;
  if (method === 'GET') return page(view.importPage({ event, left, csrf: csrf.token, values: { pay: 'paid_cash' } }));
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });

  const f = form.fields;
  const values = { list: String(f.list || '').slice(0, 30000), ...readOptions(f, event) };
  const { bookings, problems } = parsePaperList(values.list);
  const guests = bookings.reduce((n, b) => n + b.names.length, 0);
  if (!bookings.length && !problems.length) problems.push('Please type or paste the names: one booking on each line.');
  if (values.fromLegacy && guests > Number(event.legacy_places)) {
    problems.push(`This list has ${guests} guests, but only ${event.legacy_places} ${Number(event.legacy_places) === 1 ? 'place is' : 'places are'} recorded as allocated before the website. Untick that box to add them as new places, or correct the figure in Reservations and places.`);
  }
  if (!values.fromLegacy && left !== null && guests > left) {
    problems.push(`This list has ${guests} guests, but only ${left} ${left === 1 ? 'place is' : 'places are'} left.${Number(event.legacy_places) > 0 ? ' If these are places allocated before the website, tick that box.' : ' Raise the maximum number of places first (Edit event).'}`);
  }
  if (problems.length) return page(view.importPage({ event, left, csrf: csrf.token, values, problems }), 422);

  // Names already on this event's guest list, and names without a surname (they can't check in by name on the iPad)
  const have = await existingKeys(env, event.id);
  const seen = new Map();
  for (const b of bookings) for (const n of b.names) seen.set(nameKey(n), (seen.get(nameKey(n)) || 0) + 1);
  const warnings = {
    onList: [...new Set(bookings.flatMap((b) => b.names).filter((n) => have.has(nameKey(n))))],
    twice: [...new Set(bookings.flatMap((b) => b.names).filter((n) => seen.get(nameKey(n)) > 1))],
    noSurname: [...new Set(bookings.flatMap((b) => b.names).filter((n) => !nameKey(n).includes(' ')))]
  };

  if (f.step === 'edit') return page(view.importPage({ event, left, csrf: csrf.token, values }));
  // Possible duplicates must be confirmed with a tick before anything is added
  const needsTick = warnings.onList.length > 0 || warnings.twice.length > 0;
  if (f.step !== 'import') return page(view.previewPage({ event, bookings, guests, values, warnings, needsTick, csrf: csrf.token }));
  if (needsTick && f.dups !== 'yes') return page(view.previewPage({ event, bookings, guests, values, warnings, needsTick, csrf: csrf.token, untick: true }), 422);

  // ---------- adding them ----------
  const unit = Number(event.price_pence) || 0;
  const free = values.pay === 'free';
  const paid = values.pay.startsWith('paid_') || (!free && unit === 0);
  const method2 = free ? 'complimentary' : values.pay === 'paid_card' ? 'card' : values.pay === 'paid_other' ? 'other' : 'cash';
  const origin = siteOrigin(request, env);
  const now = new Date().toISOString();
  const steps = [];
  const before = await env.DB.prepare('SELECT capacity, legacy_places FROM events WHERE id = ?1').bind(event.id).first();
  if (values.fromLegacy) {
    steps.push(env.DB.prepare('UPDATE events SET legacy_places = legacy_places - ?1 WHERE id = ?2').bind(guests, event.id));
    steps.push(env.DB.prepare(`INSERT INTO event_allocation_log (event_id, booking_id, action, places, capacity_before, capacity_after, legacy_before, legacy_after, reason, done_by)
      VALUES (?1, NULL, 'paper_import', ?2, ?3, ?3, ?4, ?5, ?6, ?7)`).bind(event.id, guests, before.capacity, before.legacy_places, before.legacy_places - guests,
      'Names added from a paper list', who));
  }
  const refs = [];
  for (const pb of bookings) {
    const qty = pb.names.length;
    const vals = { qty, guests: pb.names.map((name, i) => ({ position: i + 1, name, answers: [] })), answers: [], purchaser: { name: pb.names[0], email: '', phone: '' }, marketing: false };
    const total = free ? 0 : unit * qty;
    const reference = m.newEventReference();
    refs.push(reference);
    const b = {
      event_id: event.id, reference, source: 'admin', status: 'confirmed', payment_method: method2,
      payment_status: free || total === 0 ? 'free' : paid ? 'paid' : 'unpaid', unit_price_pence: free ? 0 : unit, total_pence: total,
      checkin_token: m.newCheckinToken(), origin, created_at: now, paid_at: paid && !free && total > 0 ? now : null,
      confirmed_snapshot: m.snapshot(event, vals, { unitPence: free ? 0 : unit, totalPence: total, at: now }),
      note: `${stampNow()}: Imported from a paper list by ${who}${values.fromLegacy ? ' (places allocated before the website)' : ''}.${values.note ? ' ' + values.note : ''}`
    };
    steps.push(...m.insertBookingStatements(env, b, vals));
  }
  steps.push(data.audit(env, 'events.paper_import', `${who} imported a paper list for ${event.name}: ${bookings.length} bookings, ${guests} guests${values.fromLegacy ? ' (from places allocated before the website)' : ''}`));
  try {
    await env.DB.batch(steps);
  } catch (err) {
    const msg = String(err && err.message);
    if (/EVENT_FULL|LEGACY_NOT_ENOUGH|EVENT_CAPACITY_BELOW_TAKEN/.test(msg)) {
      return page(view.importPage({ event, left, csrf: csrf.token, values, problems: ['Nothing was added: the places changed while you were importing (someone else booked or reserved). Please check the numbers and try again.'] }), 409);
    }
    throw err;
  }
  return redirect(`/admin/events/${event.id}/manage?flash=imported`);
}
