// Automated tests for: event reservations made in Admin (private links and QR codes, payment online or in person,
// release, cancel, Admin Override, places allocated before the website), the Square checkout improvements (Google Pay
// and Apple Pay, payment help, the Facebook browser warning), and private reading gift vouchers.
// Everything runs on the local test copy with the Square and email stand-ins: no real payment or email.
// Run with: npm test, or on its own: node tests/reservations.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ukToday } from '../src/lib/dates.js';
import zlib from 'node:zlib';
import { normaliseCode, newCode, voucherPdf, renderData } from '../src/bookings/vouchers.js';
import { pngForPdf } from '../src/lib/pdf.js';
import { LAYOUT, SUPPLIED } from '../src/bookings/voucher-layout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== '' ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const PORT = 8971;
const BASE = `http://localhost:${PORT}`;

function start() {
  const dbFile = path.join(root, 'dev', '.local', `reservations-${PORT}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(PORT), MOCK_PORT: String(PORT + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: BASE }, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('local test copy')) { clearTimeout(timer); resolve({ child, mock: `http://localhost:${PORT + 100}`, dbFile }); } });
    child.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings|Square payment link not created|could not check/.test(t)) process.stderr.write(t); });
  });
}
class Jar {
  constructor() { this.c = {}; }
  add(res) { for (const sc of res.headers.getSetCookie()) { const [p, ...attrs] = sc.split(';'); const i = p.indexOf('='); const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (!v || attrs.some((a) => /max-age=0\b/i.test(a.trim()))) delete this.c[k]; else this.c[k] = v; } }
  header() { return Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join('; '); }
}
async function req(p, { jar, method = 'GET', body, headers = {}, origin } = {}) {
  const h = { ...headers };
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET' && origin !== null) h.Origin = origin || BASE;
  const res = await fetch(p.startsWith('http') ? p : BASE + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}
const text = async (p, o) => (await req(p, o)).text();
const form = (fields, ip = '10.0.0.1', extra = {}) => ({ method: 'POST', body: new URLSearchParams(fields).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip, ...extra } });
async function signIn(who = 'owner') {
  const jar = new Jar();
  const login = await req('/admin/login', { jar });
  const authPage = await (await fetch(login.headers.get('location'))).text();
  const link = (authPage.match(new RegExp(`id="as-${who}" href="([^"]+)"`)) || [])[1];
  const cb = new URL(link.replace(/&amp;/g, '&'));
  await req(cb.pathname + cb.search, { jar });
  return jar;
}
async function submit(jar, p, fields) {
  const fd = new FormData();
  const csrf = jar.c.nw_csrf || ((await text('/admin', { jar })).match(/name="_csrf" value="([^"]+)"/) || [])[1];
  fd.append('_csrf', csrf || '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return req(p, { jar, method: 'POST', body: fd });
}
const addDays = (n) => { const d = new Date(ukToday() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const stampOf = (h) => (h.match(/name="t" value="([^"]+)"/) || [])[1];
const hexText = (t) => Buffer.from(t, 'latin1').toString('hex');

const EXPECTED_CHECKS = 134;
let srv;
try {
  srv = await start();
  const db = new DatabaseSync(srv.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = srv.mock;
  const emails = async () => (await (await fetch(mock + '/__emails')).json()).map((e) => ({ ...e, to: Array.isArray(e.to) ? e.to.join(',') : e.to, text: e.text || '' }));
  const sqState = async () => (await (await fetch(mock + '/__square/state')).json());
  const sign = (body) => crypto.createHmac('sha256', 'local-webhook-signature-key').update(BASE + '/webhooks/square' + body).digest('base64');
  const webhook = (payment, type = 'payment.updated') => { const body = JSON.stringify({ event_id: 'ev-' + crypto.randomBytes(6).toString('hex'), type, data: { object: { payment } } });
    return req('/webhooks/square', { method: 'POST', origin: null, headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': sign(body) }, body }); };
  const payLink = async (linkId, status = 'COMPLETED') => (await (await fetch(`${mock}/__square/pay/${linkId}${status !== 'COMPLETED' ? '?status=' + status : ''}`)).json()).payment;
  db.prepare(`INSERT INTO settings (key, value) VALUES ('notification_email', 'gary@example.com') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  const g = await signIn('owner');
  const bookingRow = (ref) => db.prepare('SELECT * FROM event_bookings WHERE reference = ?').get(ref);
  const ev = (id) => db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  const mkEvent = (name, capacity, soldOut = 0, price = 1500, extra = {}) => Number(db.prepare(`INSERT INTO events (name, date, sales_mode, price_pence, capacity, max_per_booking, start_time, visible, sold_out, summary, details, ticket_url)
      VALUES (?, ?, 'online', ?, ?, ?, '19:00', 1, ?, 'An evening.', '', '')`).run(name, extra.date || addDays(23), price, capacity, extra.max || 14, soldOut).lastInsertRowid);
  const reservePost = (eid, fields) => submit(g, `/admin/events/${eid}/reservations/new`, { kind: 'new', qty: '1', name: 'Test Customer', email: '', phone: '', pay: 'square_online',
    deadline_date: addDays(7), deadline_time: '18:00', reason: '', note: '', ...fields });
  const reservedFrom = (res) => { const m = (res.headers.get('location') || '').match(/\/reservations\/(\d+)\?flash=([a-z-]+)/); return m ? { id: Number(m[1]), flash: m[2], row: db.prepare('SELECT * FROM event_bookings WHERE id = ?').get(Number(m[1])) } : null; };
  const linkOf = (b) => `/reserve/${b.reference}?k=${encodeURIComponent(b.reserve_key)}`;

  console.log('\nThe database update');
  {
    const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const sql = fs.readFileSync(path.join(root, 'migrations', '0023_reservations_and_gift_vouchers.sql'), 'utf8').replace(/--.*$/gm, '');
    const drops = [...sql.matchAll(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+(\w+)/gi)].map((m) => m[1]).sort().join();
    check('update 0023 is the newest; it changes no existing rows, and only replaces the three capacity rules (with versions that also count earlier allocations)',
      files[files.length - 1] === '0023_reservations_and_gift_vouchers.sql' && !/(?:^|;)\s*(DELETE|UPDATE|DROP\s+TABLE|ALTER\s+TABLE\s+\w+\s+(DROP|RENAME))\b/i.test(sql) &&
      drops === 'event_capacity_insert,event_capacity_lowered,event_capacity_update' && ['event_capacity_insert', 'event_capacity_lowered', 'event_capacity_update'].every((t) => new RegExp(`CREATE TRIGGER ${t}\\b`).test(sql)));
    check('every existing event starts with 0 places allocated before the website, and every existing order is a Square order', db.prepare('SELECT COUNT(*) AS n FROM events WHERE legacy_places != 0').get().n === 0 &&
      db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE payment_method != 'square'`).get().n === 0);
  }

  // ================= The charity night: reconciling the places allocated before the website =================
  console.log('\nThe charity night: 98 places allocated before the website, 2 booked on it, 16 of the 98 unpaid');
  const CH = mkEvent('An Evening of Mediumship in aid of Help for Kids', 3, 1, 1500, { max: 14 });
  const mealQ = Number(db.prepare(`INSERT INTO event_questions (event_id, label, type, scope, required, sort_order) VALUES (?, 'Meal choice', 'select', 'guest', 1, 1)`).run(CH).lastInsertRowid);
  const optPie = Number(db.prepare(`INSERT INTO event_question_options (question_id, label, sort_order) VALUES (?, 'Steak Pie', 0)`).run(mealQ).lastInsertRowid);
  const optVeg = Number(db.prepare(`INSERT INTO event_question_options (question_id, label, sort_order) VALUES (?, 'Vegetarian', 1)`).run(mealQ).lastInsertRowid);
  db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence, purchaser_name, purchaser_email, checkin_token, created_at, paid_at)
    VALUES (?, 'EV-L3YPM2', 'online', 'confirmed', 'square_online', 'paid', 2, 1500, 3000, 'Online Buyer', 'buyer@example.com', ?, '2026-10-13T10:00:00Z', '2026-10-13T10:01:00Z')`).run(CH, crypto.randomBytes(16).toString('base64url'));
  for (const [pos, name] of [[1, 'Online Buyer'], [2, 'Online Friend']]) db.prepare(`INSERT INTO event_guests (booking_id, event_id, position, name) VALUES ((SELECT id FROM event_bookings WHERE reference = 'EV-L3YPM2'), ?, ?, ?)`).run(CH, pos, name);
  {
    check('(as on the live website now) the event has a maximum of 3, SOLD OUT on, and one booking of 2', ev(CH).capacity === 3 && ev(CH).sold_out === 1 && ev(CH).legacy_places === 0);
    const mustExplain = await submit(g, `/admin/events/${CH}/reservations/allocations`, { capacity: '100', legacy: '98', reason: '' });
    check('recording the earlier allocations needs a reason', mustExplain.status === 422 && ev(CH).capacity === 3);
    const tooMany = await submit(g, `/admin/events/${CH}/reservations/allocations`, { capacity: '100', legacy: '99', reason: 'Paper list before online booking' });
    check('figures that don’t fit are refused (99 earlier + 2 website = 101 is more than 100)', tooMany.status === 409 && ev(CH).capacity === 3 && ev(CH).legacy_places === 0);
    const ok = await submit(g, `/admin/events/${CH}/reservations/allocations`, { capacity: '100', legacy: '98', reason: 'Paper list before online booking' });
    check('maximum 100 with 98 allocated before the website: saved together, and recorded', ok.status === 303 && ev(CH).capacity === 100 && ev(CH).legacy_places === 98 &&
      !!db.prepare(`SELECT 1 FROM event_allocation_log WHERE event_id = ? AND action = 'allocations' AND capacity_before = 3 AND capacity_after = 100 AND legacy_after = 98`).get(CH));
    const page = await text(`/admin/events/${CH}/reservations`, { jar: g });
    check('Admin shows the places separately: 100 maximum, 98 before the website, 2 booked, 0 available, SOLD OUT for the public',
      /Maximum \(total places\)<\/th><td>100</.test(page) && /Allocated before the website[^<]*<\/th><td>98</.test(page) && /Booked on the website[^<]*<\/th><td>2</.test(page) && /Still available<\/th><td>0</.test(page) && page.includes('<strong>SOLD OUT</strong>'));
    const pub = await text(`/events/${CH}/book`);
    check('the public booking page still says SOLD OUT', pub.includes('SOLD OUT') && !pub.includes('How many tickets?'));
    const over = await reservePost(CH, { kind: 'previous', qty: '99', name: 'Too Many', reason: 'Testing too many places' });
    const overText = await over.text();
    check('a reservation can’t take more “earlier” places than were recorded (99 of 98)', over.status === 409 && overText.includes('Only 98 places are recorded as allocated before the website'), over.status + ' ' + (overText.match(/banner-error[^>]*>([^<]*)/) || [])[1]);
    const newOne = await reservePost(CH, { kind: 'new', qty: '1', name: 'New Person' });
    check('a NEW reservation is refused when no places are free, with a clear explanation (not silently added)', newOne.status === 409 && (await newOne.text()).includes('only 0 places available') && ev(CH).capacity === 100);
    const noReason = await reservePost(CH, { kind: 'previous', qty: '16', name: 'Charity Group' });
    check('“allocated before the website” needs a reason', noReason.status === 422);

    const made = reservedFrom(await reservePost(CH, { kind: 'previous', qty: '16', name: 'Margaret Group', email: 'margaret@example.com', phone: '07700 900555', pay: 'square_online',
      reason: '16 of the original 98, reserved but unpaid', send: '1' }));
    const r16 = made && made.row;
    check('the 16 unpaid places are reserved from the 98: no new places, maximum still 100 (not 116)', r16 && r16.status === 'held' && r16.reservation_kind === 'previous' && r16.quantity === 16 &&
      ev(CH).capacity === 100 && ev(CH).legacy_places === 82 && r16.total_pence === 24000, r16);
    check('…the reservation is protected from the moment it is made (counted by the database), with a private key', r16 && r16.reserve_key.length >= 30 && r16.source === 'admin' && r16.reserve_link_version === 1);
    const places = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM event_bookings WHERE event_id = ? AND status IN ('held','confirmed')`).get(CH).n + ev(CH).legacy_places;
    check('…total still exactly 100: 82 earlier + 2 booked + 16 reserved', places === 100);
    const mail = (await emails()).find((e) => e.to && e.to.includes('margaret@example.com'));
    check('the private link was emailed (the real website’s /reserve/ link, £240, the event)', mail && mail.text.includes(`/reserve/${r16.reference}?k=`) && mail.text.includes('£240.00') && mail.text.includes('16 tickets have been reserved'));
    const rp = await text(`/admin/events/${CH}/reservations/${r16.id}`, { jar: g });
    check('Admin shows the link, a QR code, Copy, Share, Download QR, Email and New link', rp.includes(`/reserve/${r16.reference}?k=`) && rp.includes('<svg') && rp.includes('data-copy=') && rp.includes('data-share-url=') && rp.includes('/qr.png') && rp.includes('Make a new link'));
    const qr = await req(`/admin/events/${CH}/reservations/${r16.id}/qr.png`, { jar: g });
    check('the QR code downloads as a picture (Admin only)', qr.status === 200 && qr.headers.get('content-type') === 'image/png' && (await req(`/admin/events/${CH}/reservations/${r16.id}/qr.png`)).status !== 200);
    check('the public stays SOLD OUT, and the allocation record says why', (await text(`/events/${CH}/book`)).includes('SOLD OUT') &&
      !!db.prepare(`SELECT 1 FROM event_allocation_log WHERE event_id = ? AND action = 'reserve_previous' AND legacy_before = 98 AND legacy_after = 82 AND reason LIKE '16 of the original 98%'`).get(CH));

    // The customer
    const wrong = await req(`/reserve/${r16.reference}?k=${'x'.repeat(32)}`);
    check('a wrong key is refused', wrong.status === 404);
    const openRes = await req(linkOf(r16));
    const open = await openRes.text();
    check('the link opens the real booking form for exactly 16 tickets, with every guest’s name and meal, and £240', open.includes('16 tickets are reserved for you') && (open.match(/name="g\d+_name"/g) || []).length === 16 &&
      open.includes(`name="g16_q${mealQ}"`) && open.includes('£240.00') && open.includes('Review your booking'));
    const stamp = stampOf(open);
    await sleep(3100);
    const guests = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [[`g${i + 1}_name`, `Guest Person ${i + 1}`], [`g${i + 1}_q${mealQ}`, String(i % 2 ? optVeg : optPie)]]).flat());
    const fields = { k: r16.reserve_key, t: stamp, website: '', qty: '16', p_name: 'Margaret Group', p_email: 'margaret@example.com', p_phone: '07700 900555', ...guests };
    const missing = await req(`/reserve/${r16.reference}`, form({ ...fields, step: 'review', g5_name: '' }, '10.1.0.1'));
    check('every guest’s full name is needed', missing.status === 422 && (await missing.text()).includes('Please enter this guest’s name.'));
    const qtyTrick = await text(`/reserve/${r16.reference}`, form({ ...fields, step: 'review', qty: '20' }, '10.1.0.1'));
    check('the number of tickets can’t be changed by the customer (it is set by the reservation)', qtyTrick.includes('REVIEW YOUR BOOKING') && !qtyTrick.includes('Guest 17') && qtyTrick.includes('<dt>Tickets</dt><dd>16</dd>'));
    const review = await text(`/reserve/${r16.reference}`, form({ ...fields, step: 'review' }, '10.1.0.1'));
    check('the review shows every guest and meal, £240, the deadline and the payment help', review.includes('REVIEW YOUR BOOKING') && review.includes('Guest Person 16') && review.includes('Vegetarian') && review.includes('£240.00') &&
      review.includes('reserved until') && review.includes('data-payment-help') && review.includes('CONFIRM &amp; PAY SECURELY'));
    const conf = await req(`/reserve/${r16.reference}`, form({ ...fields, step: 'confirm', 'cf-turnstile-response': TOKEN }, '10.1.0.1'));
    const after = bookingRow(r16.reference);
    const st = await sqState();
    const sqLink = st.links.find((l) => l.orderId === after.square_order_id);
    check('confirming saves the names and meals on the reservation and opens Square for exactly £240', conf.status === 303 && (conf.headers.get('location') || '').startsWith(`/tickets/${r16.reference}?key=`) &&
      sqLink && sqLink.amount === 24000 && after.status === 'held' && after.reserve_details_at && after.purchaser_name === 'Margaret Group' &&
      db.prepare(`SELECT COUNT(*) AS n FROM event_guests WHERE booking_id = ? AND name LIKE 'Guest Person %'`).get(after.id).n === 16 &&
      db.prepare(`SELECT COUNT(*) AS n FROM event_answers WHERE booking_id = ? AND question_id = ?`).get(after.id, mealQ).n === 16);
    check('Square’s checkout offers Google Pay and Apple Pay as well as cards (and the one-reservation idempotency key)', sqLink && sqLink.requests.checkout_options.accepted_payment_methods.google_pay === true &&
      sqLink.requests.checkout_options.accepted_payment_methods.apple_pay === true && sqLink.requests.idempotency_key === `${r16.reference}-R1`);
    const again = await req(`/reserve/${r16.reference}`, form({ ...fields, step: 'confirm', 'cf-turnstile-response': TOKEN }, '10.1.0.1'));
    check('pressing confirm again opens the same Square page (no second payment page or booking)', again.status === 303 && bookingRow(r16.reference).square_order_id === after.square_order_id &&
      (await sqState()).links.filter((l) => l.requests.order.reference_id === r16.reference).length === 1);
    const tickets = await text(conf.headers.get('location'));
    check('the payment page shows “reserved until” the deadline, the Pay button, and the help if the bank approval doesn’t arrive', tickets.includes('Your tickets are reserved until') && tickets.includes('Pay £240.00 securely with Square') &&
      tickets.includes('If your bank’s approval doesn’t arrive') && tickets.includes('Open your banking app') && tickets.includes('Try Google Pay or Apple Pay') && tickets.includes('different debit or credit card'));
    const failedPay = await webhook({ id: 'PAYFAILEDX1', order_id: after.square_order_id, status: 'FAILED', location_id: 'LOCAL_LOCATION', amount_money: { amount: 24000, currency: 'GBP' } });
    check('a failed payment confirms nothing', failedPay.status === 200 && bookingRow(r16.reference).status === 'held' && bookingRow(r16.reference).payment_status === 'pending');
    const payment = await payLink(sqLink.id);
    const wh = await webhook(payment);
    const paid = bookingRow(r16.reference);
    check('Square confirms payment (signed webhook): the reservation is paid and confirmed, once', wh.status === 200 && paid.status === 'confirmed' && paid.payment_status === 'paid' && paid.square_payment_id === payment.id);
    await webhook(payment);
    await webhook({ ...payment });
    const confMails = (await emails()).filter((e) => e.to === 'margaret@example.com' && e.subject.startsWith('Your booking:'));
    check('the normal confirmation email with the QR code is sent once (repeated notices change nothing)', confMails.length === 1 && confMails[0].text.includes('Guest 16: Guest Person 16') && (confMails[0].attachments || []).length === 1, confMails.length);
    check('Gary is told about the new paid booking', (await emails()).some((e) => /New booking: An Evening of Mediumship/.test(e.subject || '') && (e.text || '').includes(r16.reference)));
    const guestsPage = await text(`/admin/events/${CH}/guests`, { jar: g });
    check('all 16 guests are on the existing guest list with their meals', guestsPage.includes('Guest Person 1<') && guestsPage.includes('Guest Person 16') && guestsPage.includes('Meal choice: Vegetarian') && guestsPage.includes('18 guests in 2 bookings'));
    const tk = await text(`/c/${paid.checkin_token}`);
    check('the QR code opens a valid ticket for 16 (the existing door scanning)', tk.includes('New Way’s booking') && tk.includes('<dt>Tickets</dt><dd>16</dd>'));
    const ci = await text(`/admin/checkin/${CH}`, { jar: g });
    check('…and the door check-in list has all 18 booked guests', ci.includes('Guest Person 16') && /18/.test(ci));
    const totals = await text(`/admin/events/${CH}/totals`, { jar: g });
    check('meal totals include the 16 (8 Steak Pie, 8 Vegetarian)', /Steak Pie<\/span><strong>8</.test(totals) && /Vegetarian<\/span><strong>8</.test(totals));
    check('the places add up: 82 earlier + 18 booked = 100, nothing reserved, still SOLD OUT for the public', ev(CH).capacity === 100 && ev(CH).legacy_places === 82 &&
      db.prepare(`SELECT SUM(quantity) AS n FROM event_bookings WHERE event_id = ? AND status = 'confirmed'`).get(CH).n === 18 && ev(CH).sold_out === 1 && (await text(`/events/${CH}/book`)).includes('SOLD OUT'));
    const used = await text(linkOf(r16));
    check('the private link now only says it is paid (it can’t be used again)', used.includes('Already paid') && !used.includes('Review your booking'));
  }

  // ================= Reservations on an ordinary event =================
  console.log('\nReservations: in person, new links, release, cancel, deadlines, late and failed payments');
  const E2 = mkEvent('Psychic Supper', 10, 0, 1000);
  {
    const r1 = reservedFrom(await reservePost(E2, { qty: '4', name: 'Cash Customer', email: 'cash@example.com', pay: 'cash' }));
    check('a new reservation of 4 (cash in person) is made and protected straight away', r1 && r1.row.status === 'held' && r1.row.reserve_pay === 'cash' && r1.row.payment_method === 'cash');
    const qtyPage = await text(`/events/${E2}/book`);
    check('…so the public can only buy the 6 places left', qtyPage.includes('<option value="6">') && !qtyPage.includes('<option value="7">'));
    const [a, b] = await Promise.all([reservePost(E2, { qty: '4', name: 'Same Moment A' }), reservePost(E2, { qty: '4', name: 'Same Moment B' })]);
    check('two reservations of 4 made at the same moment for the last 6 places: exactly one succeeds (no overselling)', [a.status, b.status].sort().join() === '303,409' &&
      db.prepare(`SELECT SUM(quantity) AS n FROM event_bookings WHERE event_id = ? AND status IN ('held','confirmed')`).get(E2).n === 8);
    const winner = reservedFrom(a.status === 303 ? a : b).row;
    const cancelW = await submit(g, `/admin/events/${E2}/reservations/${winner.id}/cancel`, {});
    check('cancelling a reservation frees its places and stops its link', cancelW.status === 303 && bookingRow(winner.reference).status === 'cancelled' && bookingRow(winner.reference).reserve_key === '' &&
      (await req(linkOf(winner))).status === 410);

    // in person: the customer gives the names, then Admin confirms the money
    const open = await text(linkOf(r1.row));
    check('an in-person reservation’s link asks for names (no payment online)', open.includes('Please pay £40.00 in person at New Way’s') && open.includes('name="g4_name"'));
    await sleep(3100);
    const base = { k: r1.row.reserve_key, t: stampOf(open), website: '', qty: '4', p_name: 'Cash Customer', p_email: 'cash@example.com', p_phone: '07700 900222', g1_name: 'Ann Cash', g2_name: 'Bob Cash', g3_name: 'Cy Cash', g4_name: 'Di Cash' };
    const rv = await text(`/reserve/${r1.row.reference}`, form({ ...base, step: 'review' }, '10.2.0.1'));
    check('…its review says CONFIRM MY DETAILS and pay in person (no Square, no Facebook warning needed)', rv.includes('CONFIRM MY DETAILS') && !rv.includes('PAY SECURELY') && !rv.includes('data-payment-help'));
    const saved = await text(`/reserve/${r1.row.reference}`, form({ ...base, step: 'confirm', 'cf-turnstile-response': TOKEN }, '10.2.0.1'));
    check('…the details are saved; tickets stay reserved, not paid, no Square page', saved.includes('your details are saved') && bookingRow(r1.row.reference).status === 'held' && !bookingRow(r1.row.reference).square_order_id &&
      db.prepare(`SELECT name FROM event_guests WHERE booking_id = ? AND position = 4`).get(r1.row.id).name === 'Di Cash');
    check('…not on the booked guest list or door list until the money is received', !(await text(`/admin/events/${E2}/guests`, { jar: g })).includes('Ann Cash'));
    const before = (await emails()).length;
    const recv = await submit(g, `/admin/events/${E2}/reservations/${r1.row.id}/paid`, { method: 'cash', send: '1' });
    const p1 = bookingRow(r1.row.reference);
    check('Payment received (cash): confirmed, paid by cash, the confirmation and QR code emailed', recv.status === 303 && (recv.headers.get('location') || '').includes('flash=paid-sent') &&
      p1.status === 'confirmed' && p1.payment_status === 'paid' && p1.payment_method === 'cash' && (await emails()).slice(before).some((e) => e.to === 'cash@example.com' && e.subject.startsWith('Your booking:')));
    check('…Gary isn’t emailed about money he took himself, and it can’t be confirmed twice', !!db.prepare(`SELECT 1 FROM event_email_log WHERE booking_id = ? AND kind = 'admin_notification' AND status = 'skipped'`).get(p1.id) &&
      (await submit(g, `/admin/events/${E2}/reservations/${r1.row.id}/paid`, { method: 'card' })).status === 409 && bookingRow(r1.row.reference).payment_method === 'cash');
    check('…now on the guest list with a working QR code', (await text(`/admin/events/${E2}/guests`, { jar: g })).includes('Ann Cash') && (await text(`/c/${p1.checkin_token}`)).includes('<dd>4</dd>'));

    // a new link replaces the old one (and closes the old Square page)
    const r3 = reservedFrom(await reservePost(E2, { qty: '2', name: 'Link Changer', email: 'link@example.com' })).row;
    const o3 = await text(linkOf(r3));
    await sleep(3100);
    const f3 = { k: r3.reserve_key, t: stampOf(o3), website: '', qty: '2', p_name: 'Link Changer', p_email: 'link@example.com', p_phone: '07700 900333', g1_name: 'Lee One', g2_name: 'Lee Two', step: 'confirm', 'cf-turnstile-response': TOKEN };
    const c3 = await req(`/reserve/${r3.reference}`, form(f3, '10.3.0.1'));
    const oldTickets = c3.headers.get('location');
    const h3 = bookingRow(r3.reference);
    const nl = await submit(g, `/admin/events/${E2}/reservations/${r3.id}/link`, {});
    const n3 = bookingRow(r3.reference);
    const oldSq = (await sqState()).links.find((l) => l.orderId === h3.square_order_id);
    check('Make a new link: the old link and the old payment page stop working at once', nl.status === 303 && n3.reserve_key !== h3.reserve_key && n3.reserve_link_version === 2 &&
      (await req(linkOf(h3))).status === 404 && oldSq.deleted === true && (await req(oldTickets)).status === 404 && !n3.square_order_id);
    const o3b = await text(linkOf(n3));
    check('…the new link works and keeps the names already given', o3b.includes('value="Lee Two"'));
    const c3b = await req(`/reserve/${r3.reference}`, form({ ...f3, k: n3.reserve_key, t: stampOf(o3b) }, '10.3.0.2'));
    const n3b = bookingRow(r3.reference);
    const newSq = (await sqState()).links.find((l) => l.orderId === n3b.square_order_id);
    check('…and leads to a new Square page (a different one, version 2)', c3b.status === 303 && newSq && newSq.requests.idempotency_key === `${r3.reference}-R2` && newSq.id !== oldSq.id);
    const emailed = await submit(g, `/admin/events/${E2}/reservations/${r3.id}/email`, {});
    check('Email the link sends the NEW link', emailed.status === 303 && (await emails()).some((e) => e.to === 'link@example.com' && e.text.includes(n3.reserve_key)));
    // release
    const rel = await submit(g, `/admin/events/${E2}/reservations/${r3.id}/release`, {});
    const r3r = bookingRow(r3.reference);
    check('Release to public sale: places free, link closed, Square page closed', rel.status === 303 && r3r.status === 'expired' && r3r.reserve_closed === 'released' && r3r.reserve_key === '' &&
      (await sqState()).links.find((l) => l.id === newSq.id).deleted === true);
    const relPage = await req(linkOf(n3));
    check('…the released link explains it no longer works', relPage.status === 410 && (await relPage.text()).includes('has been released'));
    // a payment that somehow still arrives for the released reservation
    const latePay = await webhook({ id: 'PAYLATE0001', order_id: n3b.square_order_id, status: 'COMPLETED', location_id: 'LOCAL_LOCATION', amount_money: { amount: 2000, currency: 'GBP' } });
    const late = bookingRow(r3.reference);
    check('a late Square payment after release is flagged for Admin review: no tickets issued, places not taken twice', latePay.status === 200 && late.status === 'needs_attention' &&
      late.payment_status === 'paid' && /after the reservation had been released/.test(late.note) && !(await emails()).some((e) => e.to === 'link@example.com' && e.subject.startsWith('Your booking:')) &&
      (await emails()).some((e) => /Needs attention/.test(e.subject || '') && (e.text || '').includes(r3.reference)));

    // deadlines
    const r5 = reservedFrom(await reservePost(E2, { qty: '1', name: 'Auto Release', auto_release: '1' })).row;
    check('automatic release: the hold ends at the payment deadline', r5.hold_expires_at === r5.reserve_deadline && r5.reserve_auto_release === 1);
    const past = new Date(Date.now() - 60_000).toISOString();
    db.prepare('UPDATE event_bookings SET reserve_deadline = ?, hold_expires_at = ? WHERE id = ?').run(past, past, r5.id);
    const exp = await req(linkOf(r5));
    check('after the deadline the link can’t be used to pay', exp.status === 410 && (await exp.text()).includes('payment deadline has passed'));
    await fetch(`${BASE}/__dev/cron?cron=7 * * * *`);
    await sleep(400);
    const r5x = bookingRow(r5.reference);
    check('…and the hourly job releases it automatically', r5x.status === 'expired' && r5x.reserve_closed === 'expired' && r5x.reserve_key === '');
    const r6 = reservedFrom(await reservePost(E2, { qty: '1', name: 'Manual Release' })).row;
    db.prepare('UPDATE event_bookings SET reserve_deadline = ? WHERE id = ?').run(past, r6.id);
    await fetch(`${BASE}/__dev/cron?cron=7 * * * *`);
    await sleep(400);
    check('manual release: after the deadline the tickets stay reserved (the link is closed) until Admin decides', bookingRow(r6.reference).status === 'held' && (await req(linkOf(r6))).status === 410 &&
      (await text(`/admin/events/${E2}/reservations`, { jar: g })).includes('DEADLINE PASSED'));
    const upd = await submit(g, `/admin/events/${E2}/reservations/${r6.id}/update`, { pay: 'square_online', deadline_date: addDays(5), deadline_time: '20:00' });
    check('changing the deadline opens the link again', upd.status === 303 && (await req(linkOf(r6))).status === 200);
    const badDl = await submit(g, `/admin/events/${E2}/reservations/${r6.id}/update`, { pay: 'square_online', deadline_date: addDays(40), deadline_time: '20:00' });
    check('a deadline after the event starts is refused', badDl.status === 422);

    // a failed payment, then a successful one, through the customer's return page
    const r7 = reservedFrom(await reservePost(E2, { qty: '1', name: 'Card Trouble', email: 'trouble@example.com' })).row;
    const o7 = await text(linkOf(r7));
    await sleep(3100);
    const c7 = await req(`/reserve/${r7.reference}`, form({ k: r7.reserve_key, t: stampOf(o7), website: '', qty: '1', p_name: 'Card Trouble', p_email: 'trouble@example.com', p_phone: '07700 900777', g1_name: 'Card Trouble', step: 'confirm', 'cf-turnstile-response': TOKEN }, '10.4.0.1'));
    const l7 = (await sqState()).links.find((l) => l.orderId === bookingRow(r7.reference).square_order_id);
    await payLink(l7.id, 'FAILED');
    const back7 = await text(c7.headers.get('location'));
    check('Square says the card failed: nothing is confirmed, the Pay button and help are still there', bookingRow(r7.reference).status === 'held' && back7.includes('Pay £10.00 securely with Square') && back7.includes('data-payment-help'));

    // the customer reached Square, then decided to pay in person instead
    const r8 = reservedFrom(await reservePost(E2, { qty: '1', name: 'Changed Mind', email: 'mind@example.com' })).row;
    const o8 = await text(linkOf(r8));
    await sleep(3100);
    const c8 = await req(`/reserve/${r8.reference}`, form({ k: r8.reserve_key, t: stampOf(o8), website: '', qty: '1', p_name: 'Changed Mind', p_email: 'mind@example.com', p_phone: '07700 900999', g1_name: 'Changed Mind', step: 'confirm', 'cf-turnstile-response': TOKEN }, '10.4.0.2'));
    const h8 = bookingRow(r8.reference);
    const sw = await submit(g, `/admin/events/${E2}/reservations/${r8.id}/update`, { pay: 'card', deadline_date: addDays(5), deadline_time: '20:00' });
    check('switching a reservation to card in person closes its Square payment page (Square asked first)', sw.status === 303 && (await sqState()).links.find((l) => l.orderId === h8.square_order_id).deleted === true &&
      !(await text(c8.headers.get('location'))).includes('securely with Square') && bookingRow(r8.reference).reserve_pay === 'card');
    await submit(g, `/admin/events/${E2}/reservations/${r8.id}/paid`, { method: 'card' });
    const dbl = await webhook({ id: 'PAYDOUBLE01', order_id: h8.square_order_id, status: 'COMPLETED', location_id: 'LOCAL_LOCATION', amount_money: { amount: 1000, currency: 'GBP' } });
    const p8 = bookingRow(r8.reference);
    check('if a Square payment still arrives after payment in person, Gary is told (nothing is confirmed twice)', dbl.status === 200 && p8.status === 'confirmed' && p8.payment_method === 'card' &&
      /also arrived for this reservation after it had been paid in person/.test(p8.note) && (await emails()).some((e) => /Needs attention/.test(e.subject || '') && (e.text || '').includes(r8.reference)));

    // Admin Override on a full, SOLD OUT event
    const E3 = mkEvent('Full House', 5, 1, 1200);
    for (let i = 0; i < 5; i++) db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, purchaser_name, checkin_token) VALUES (?, ?, 'admin', 'confirmed', 'cash', 'paid', 1, 'Full', ?)`)
      .run(E3, 'EV-FUL' + 'ABCDE'[i] + '2', crypto.randomBytes(16).toString('base64url'));
    const noR = await reservePost(E3, { kind: 'override', qty: '3', name: 'Override Party' });
    check('Admin Override needs a reason', noR.status === 422 && ev(E3).capacity === 5);
    const ov = reservedFrom(await reservePost(E3, { kind: 'override', qty: '3', name: 'Override Party', reason: 'Speaker’s family, agreed by Gary' })).row;
    check('Admin Override on a full, SOLD OUT event: maximum 5 → 8 by exactly 3, recorded with the reason; SOLD OUT stays on', ov && ov.reserve_capacity_added === 3 && ev(E3).capacity === 8 && ev(E3).sold_out === 1 &&
      !!db.prepare(`SELECT 1 FROM event_allocation_log WHERE event_id = ? AND action = 'reserve_override' AND capacity_before = 5 AND capacity_after = 8 AND reason LIKE 'Speaker%'`).get(E3) &&
      !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'events.reservation' AND summary LIKE '%Admin Override%Speaker%'`).get());
    check('…the public still sees SOLD OUT (the 3 added places are the reservation’s alone)', (await text(`/events/${E3}/book`)).includes('SOLD OUT'));
    const ovc = await submit(g, `/admin/events/${E3}/reservations/${ov.id}/cancel`, {});
    check('cancelling the override reservation takes the 3 places off the maximum again (never sold to the public)', ovc.status === 303 && ev(E3).capacity === 5 && bookingRow(ov.reference).reserve_capacity_returned === 1);
    const E4 = mkEvent('Switched Sold Out', 10, 1, 1000);
    const so = reservedFrom(await reservePost(E4, { qty: '2', name: 'Sold Out Switch' }));
    check('SOLD OUT never stops Admin reserving places that exist', so && so.row.status === 'held' && ev(E4).sold_out === 1);
  }

  // ================= Square checkout improvements on the normal booking =================
  console.log('\nSquare checkout: Google Pay and Apple Pay, payment help, the Facebook browser warning');
  {
    const E5 = mkEvent('Normal Online Night', 20, 0, 1000);
    const start = await text(`/events/${E5}/book?qty=2`);
    await sleep(3100);
    const fields = { t: stampOf(start), website: '', qty: '2', p_name: 'Normal Buyer', p_email: 'normal@example.com', p_phone: '07700 900888', g1_name: 'Normal Buyer', g2_name: 'Friend Buyer' };
    const fb = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]';
    const rvFb = await text(`/events/${E5}/book`, form({ ...fields, step: 'review' }, '10.5.0.1', { 'User-Agent': fb }));
    check('in Facebook’s own browser on Android, the review page asks them to open it in Chrome first (with an Open in Chrome button)', rvFb.includes('Please open this page in Chrome before paying') && rvFb.includes('intent://') && rvFb.includes('package=com.android.chrome'));
    const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]';
    const rvIos = await text(`/events/${E5}/book`, form({ ...fields, step: 'review' }, '10.5.0.1', { 'User-Agent': ios }));
    const detFb = await text(`/events/${E5}/book?qty=2`, { headers: { 'User-Agent': fb } });
    check('…the warning already shows on the details form, before they type anything (Open in Chrome keeps the same page)', detFb.includes('Please open this page in Chrome before paying') && detFb.includes(`intent://localhost:${PORT}/events/${E5}/book?qty=2#Intent`) && detFb.includes('Nothing has been booked or paid yet'));
    check('…from the review screen, Open in Chrome starts the booking again there (and says the details must be filled in again)', rvFb.includes(`intent://localhost:${PORT}/events/${E5}/book#Intent`) && rvFb.includes('fill in your details again'));
    check('…on an iPhone it says to open it in Safari', rvIos.includes('Please open this page in Safari before paying') && !rvIos.includes('intent://'));
    const rvChrome = await text(`/events/${E5}/book`, form({ ...fields, step: 'review' }, '10.5.0.1', { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile Safari/537.36' }));
    check('…in an ordinary browser there is no warning, but the payment help and the 15-minute hold are shown', !rvChrome.includes('data-inapp-warning') && rvChrome.includes('data-payment-help') &&
      rvChrome.includes('Your places are held for 15 minutes once you press CONFIRM &amp; PAY SECURELY'));
    const c = await req(`/events/${E5}/book`, form({ ...fields, step: 'confirm', 'cf-turnstile-response': TOKEN }, '10.5.0.1'));
    const ref = (c.headers.get('location') || '').match(/EV-[A-Z0-9]{6}/)[0];
    const b = bookingRow(ref);
    const sq = (await sqState()).links.find((l) => l.orderId === b.square_order_id);
    check('a normal booking still holds for 15 minutes and opens Square, now with Google Pay and Apple Pay offered', b.status === 'held' && Math.abs(Date.parse(b.hold_expires_at) - Date.parse(b.created_at) - 15 * 60_000) < 5000 &&
      sq.requests.checkout_options.accepted_payment_methods.google_pay === true && sq.requests.checkout_options.allow_tipping === false);
    const page = await text(c.headers.get('location'));
    check('…its payment page shows “held until”, the Pay button and the help', page.includes('Your places are held until') && page.includes('If your bank’s approval doesn’t arrive'));
    const pay = await payLink(sq.id);
    await webhook(pay);
    check('…and is confirmed by Square’s webhook exactly as before', bookingRow(ref).status === 'confirmed' && (await emails()).some((e) => e.to === 'normal@example.com' && e.subject.startsWith('Your booking:')));
    const abandoned = await req(`/events/${E5}/book`, form({ ...fields, p_email: 'gone@example.com', step: 'confirm', 'cf-turnstile-response': TOKEN }, '10.5.0.2'));
    const ab = bookingRow((abandoned.headers.get('location') || '').match(/EV-[A-Z0-9]{6}/)[0]);
    db.prepare('UPDATE event_bookings SET hold_expires_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), ab.id);
    await fetch(`${BASE}/__dev/cron?cron=7 * * * *`);
    await sleep(400);
    check('an abandoned checkout is released after its 15 minutes (Square asked first, page closed)', bookingRow(ab.reference).status === 'expired' && (await sqState()).links.find((l) => l.orderId === ab.square_order_id).deleted === true);
    check('the 15-minute hold setting is unchanged', (db.prepare(`SELECT value FROM settings WHERE key = 'booking_hold_minutes'`).get() || { value: '15' }).value === '15');
  }

  // ================= Admin only =================
  console.log('\nOnly Gary and Julie');
  {
    const anon = await req(`/admin/events/${CH}/reservations`);
    const anonPost = await req(`/admin/events/${CH}/reservations/new`, { method: 'POST', body: 'kind=new' });
    check('reservations and vouchers can’t be opened or changed without signing in', anon.status === 401 && anonPost.status === 403 && (await req('/admin/readings/vouchers')).status === 401);
    await submit(g, '/admin/team', { name: 'Julie', email: 'julie.helper@example.test' });
    const julie = await signIn('julie');
    check('Julie (full Admin) can use them', (await req(`/admin/events/${CH}/reservations`, { jar: julie })).status === 200 && (await req('/admin/readings/vouchers', { jar: julie })).status === 200);
  }

  // ================= Private reading gift vouchers =================
  console.log('\nGift vouchers / reservation codes for private readings');
  {
    check('prices are unchanged: £40 for 30 minutes and £65 for 60 minutes', db.prepare(`SELECT group_concat(code || '=' || price_pence) AS p FROM (SELECT * FROM reading_services ORDER BY code)`).get().p === 'reading-30=4000,reading-60=6500');
    const codes = Array.from({ length: 2000 }, newCode);
    check('codes: 12 random characters in three groups (about 59 bits), easy to read, typed in any form', codes.every((c) => /^GV-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(c)) && new Set(codes).size === 2000 &&
      normaliseCode(' gv 7kqm 3xrt 9hpc ') === 'GV-7KQM-3XRT-9HPC' && normaliseCode('7KQM3XRT9HPC') === 'GV-7KQM-3XRT-9HPC' && normaliseCode('GV-7KQM-3XRT-9HP0') === '' && normaliseCode('GV-7KQM-3XRT') === '');
    let day = addDays(4);
    const dayFree = addDays(5);
    for (const d of [day, dayFree]) await submit(g, '/admin/readings/availability/day', { date: d, choice: 'available', start_time: '12:00', end_time: '17:00' });
    const vpage = await text('/admin/readings', { jar: g });
    check('Private Readings Admin has the Gift Vouchers / Reservation Codes section', vpage.includes('href="/admin/readings/vouchers"') && vpage.includes('Gift Vouchers / Reservation Codes'));
    const mk = async (fields) => submit(g, '/admin/readings/vouchers', { service: 'reading-30', count: '1', expires_on: '', note: '', ...fields });
    const m1 = await mk({ note: 'Raffle Prize' });
    const id1 = Number(((m1.headers.get('location') || '').match(/made=(\d+)/) || [])[1]);
    const v30 = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(id1);
    check('Make voucher: a 30-minute voucher worth £40 with the note, Available, recorded', m1.status === 303 && v30 && v30.minutes === 30 && v30.value_pence === 4000 && v30.status === 'available' && v30.note === 'Raffle Prize' &&
      !!db.prepare('SELECT 1 FROM gift_voucher_log WHERE voucher_id = ?').get(id1));
    const m2 = await mk({ service: 'reading-60', count: '3', expires_on: addDays(60), note: 'Gift' });
    const ids60 = ((m2.headers.get('location') || '').match(/made=([\d,]+)/) || [])[1].split(',').map(Number);
    const v60s = ids60.map((i) => db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(i));
    check('several at once: three 60-minute vouchers worth £65, each with its own code and the expiry', v60s.length === 3 && new Set(v60s.map((v) => v.code)).size === 3 && v60s.every((v) => v.value_pence === 6500 && v.expires_on === addDays(60)));
    const madePage = await text(m2.headers.get('location'), { jar: g });
    check('the new codes are shown with Copy code, and all three as one PDF', v60s.every((v) => madePage.includes(`data-copy="${v.code}"`)) && madePage.includes(`/admin/readings/vouchers/print.pdf?ids=${ids60.join(',')}`));
    check('a bad request is refused (0 vouchers, a past expiry)', (await mk({ count: '0' })).status === 422 && (await mk({ expires_on: addDays(-1) })).status === 422);
    // the approved designs, and where things go on them
    const tplBytes = { 30: fs.readFileSync(path.join(root, 'public/images/vouchers/voucher-30.png')), 60: fs.readFileSync(path.join(root, 'public/images/vouchers/voucher-60.png')) };
    const tpl = { 30: pngForPdf(tplBytes[30]), 60: pngForPdf(tplBytes[60]), font: new Uint8Array(fs.readFileSync(path.join(root, 'public/fonts/Caladea-Bold.ttf'))) };
    check('the two approved designs are used exactly as supplied (1983 × 793, the same files)', tpl[30].width === 1983 && tpl[30].height === 793 && tpl[60].width === 1983 && tpl[60].height === 793 &&
      crypto.createHash('sha256').update(tplBytes[30]).digest('hex') === 'bfe10d6d1985961ff7345a047aa9d34eaea4b0413cbcecabe5bebd74de888a93' && crypto.createHash('sha256').update(tplBytes[60]).digest('hex') === 'd5e7d62ce227c9f6923b7005fc2a5c17997643182e154f40bae1eeb5b8bbb09d');
    const inside = (r, box) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
    check('the code, expiry and QR regions sit inside the printed boxes (measured from the designs); the supplied ones did not',
      inside(LAYOUT.regions.code, { x: 651, y: 587, w: 879, h: 76 }) && inside(LAYOUT.regions.expiry, { x: 1647, y: 597, w: 267, h: 70 }) && inside(LAYOUT.regions.qr, { x: 1660, y: 90, w: 242, h: 242 }) &&
      !inside(SUPPLIED.code, { x: 651, y: 587, w: 879, h: 76 }) && !inside(SUPPLIED.expiry, { x: 1647, y: 597, w: 267, h: 70 }));
    const pdf = await req(`/admin/readings/vouchers/${id1}.pdf`, { jar: g });
    const pdfText = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    check('the PDF: the approved 30-minute design (its own picture data, 1983 × 793), the real code in Caladea Bold, no expiry, a QR code and the link', pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf' &&
      pdfText.startsWith('%PDF-1.4') && pdfText.includes('/Width 1983 /Height 793') && pdfText.includes('/Predictor 15 /Colors 3') && pdfText.includes(Buffer.from(tpl[30].idat.subarray(0, 64)).toString('latin1')) &&
      pdfText.includes(hexText(v30.code)) && pdfText.includes('/BaseFont /Caladea-Bold') && pdfText.includes('/FontFile2') && !/<[0-9a-f]+2f[0-9a-f]+2f[0-9a-f]+>/.test(pdfText.slice(pdfText.indexOf('BT'), pdfText.lastIndexOf('ET'))) &&
      pdfText.includes(`/URI (${BASE}/private-readings)`));
    check('…only Gary and Julie can download it', (await req(`/admin/readings/vouchers/${id1}.pdf`)).status === 401);
    const pdf60 = Buffer.from(voucherPdf(v60s[0], 'https://newwaysmediumshipdevelopmentcentre.com', tpl)).toString('latin1');
    const dmY = v60s[0].expires_on.split('-').reverse().join('/');
    check('on the live website: the 60-minute design, the expiry as DD/MM/YYYY, and the QR code and link for https://newwaysmediumshipdevelopmentcentre.com/private-readings',
      pdf60.includes('/URI (https://newwaysmediumshipdevelopmentcentre.com/private-readings)') && pdf60.includes(Buffer.from(tpl[60].idat.subarray(0, 64)).toString('latin1')) && pdf60.includes(hexText(dmY)) && pdf60.includes(hexText(v60s[0].code)) &&
      fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8').includes('"SITE_URL": "https://newwaysmediumshipdevelopmentcentre.com"') && (await req('/private-readings')).status === 200);
    const all = await req(`/admin/readings/vouchers/print.pdf?ids=${ids60.join(',')}`, { jar: g });
    const allText = Buffer.from(await all.arrayBuffer()).toString('latin1');
    check('all three in one PDF, one per page (the design stored once)', all.status === 200 && (allText.match(/\/Type \/Page /g) || []).length === 3 && (allText.match(/\/Width 1983 \/Height 793/g) || []).length === 1 &&
      v60s.every((v) => allText.includes(hexText(v.code))));
    const vp = await text(`/admin/readings/vouchers/${id1}`, { jar: g });
    const rd = JSON.parse(decode((vp.match(/data-voucher-render="([^"]+)"/) || [])[1] || '{}'));
    check('the voucher’s page gives the phone exactly what to draw: the 30-minute design, the real code, no expiry, the tuned boxes and the QR code for the booking page',
      rd.code === v30.code && rd.expiry === '' && rd.template === '/images/vouchers/voucher-30.png' && rd.link === `${BASE}/private-readings` && JSON.stringify(rd.regions) === JSON.stringify(LAYOUT.regions) &&
      JSON.stringify(rd.qr) === JSON.stringify(renderData(v30, BASE).qr) && vp.includes('data-saved="0"'));
    check('…with Download PNG, Open the PDF, Download PDF, Send the picture or PDF, and the history', vp.includes('Download PNG') && vp.includes('Open the PDF') && vp.includes('Download PDF') && vp.includes('data-share-type="image/png"') && vp.includes('History'));
    const rd60 = JSON.parse(decode((madePage.match(/data-voucher-render="([^"]+)"/) || [])[1] || '{}'));
    check('…a 60-minute voucher uses the 60-minute design and its expiry date as DD/MM/YYYY', rd60.template === '/images/vouchers/voucher-60.png' && rd60.expiry === dmY);
    // the finished picture, as the phone sends it
    const fakePng = (w, h) => { const raw = Buffer.alloc((w * 3 + 1) * h, 255); const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
      const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
    const upload = async (jar, bytes, code) => { const fd = new FormData(); fd.append('_csrf', jar ? jar.c.nw_csrf || '' : ''); fd.append('code', code); fd.append('png', new Blob([bytes], { type: 'image/png' }), 'voucher.png'); return req(`/admin/readings/vouchers/${id1}/image`, { jar, method: 'POST', body: fd }); };
    const good = fakePng(1983, 793);
    check('a picture of the wrong size, or with another code, is refused; nothing is saved', (await upload(g, fakePng(1000, 400), v30.code)).status === 422 && (await upload(g, good, 'GV-AAAA-BBBB-CCCC')).status === 409 &&
      !db.prepare('SELECT image_key FROM gift_vouchers WHERE id = ?').get(id1).image_key && (await req(`/admin/readings/vouchers/${id1}.png`, { jar: g })).status === 404);
    check('…and nobody signed out can save one', (await upload(null, good, v30.code)).status === 403);
    const up = await upload(g, good, v30.code);
    const saved = db.prepare('SELECT image_key, image_made_at FROM gift_vouchers WHERE id = ?').get(id1);
    const png = await req(`/admin/readings/vouchers/${id1}.png?download=1`, { jar: g });
    check('the finished PNG is saved against the voucher (private storage) and can be downloaded again, unchanged', up.status === 200 && saved.image_key === `private/vouchers/${id1}-${v30.code}.png` && !!saved.image_made_at &&
      png.status === 200 && png.headers.get('content-type') === 'image/png' && /attachment; filename="New-Ways-gift-voucher-GV-/.test(png.headers.get('content-disposition')) && Buffer.from(await png.arrayBuffer()).equals(good) &&
      (await req(`/admin/readings/vouchers/${id1}.png`)).status === 401 && (await req(`/media/private/vouchers/${id1}-${v30.code}.png`)).status === 404);
    const vp2 = await text(`/admin/readings/vouchers/${id1}`, { jar: g });
    check('…the voucher’s page then shows the saved picture as the preview, with Make the picture again', vp2.includes('data-saved="1"') && vp2.includes(`src="/admin/readings/vouchers/${id1}.png?v=`) && vp2.includes('Make the picture again') &&
      !!db.prepare(`SELECT 1 FROM gift_voucher_log WHERE voucher_id = ? AND what = 'Voucher picture made and saved'`).get(id1));
    const search = await text(`/admin/readings/vouchers?q=${encodeURIComponent(v30.code.toLowerCase().replace(/-/g, ' '))}`, { jar: g });
    check('search finds a code however it is typed', search.includes(v30.code) && !search.includes(v60s[0].code));

    // the customer's booking
    const pay = async (code, time, extra = {}) => {
      const reading = extra.reading || 'reading-30';
      const det = await text(`/private-readings/book/details?reading=${reading}&date=${extra.date || day}&time=${time}`);
      const t = stampOf(det);
      const contact = { t, reading, date: extra.date || day, time, name: extra.name || 'Vera Voucher', email: extra.email || 'vera@example.com', phone: '07700 900444', website: '' };
      const step = await text('/private-readings/book/details', form(contact, extra.ip || '10.6.0.1'));
      return { contact, step };
    };
    const { contact, step } = await pay('', '12:00');
    check('the payment step asks “Have a Gift Voucher or Reservation Code?”, with normal Square payment still there', step.includes('Have a Gift Voucher or Reservation Code?') && step.includes('Proceed to Secure Payment') && step.includes('data-payment-help'));
    const apply = (code, c = contact, ip = '10.6.0.1') => text('/private-readings/book/voucher', form({ ...c, code }, ip));
    const bad = await apply('GV-ZZZZ-ZZZZ-ZZZZ');
    check('an unknown code: explained, and they can still pay with Square', bad.includes('We couldn’t find that voucher code') && bad.includes('You can still pay with Square below') && bad.includes('Proceed to Secure Payment'));
    const nonsense = await apply('hello');
    check('something that isn’t a code: explained', nonsense.includes('doesn’t look like a New Way’s voucher code'));
    const wrongLen = await apply(v60s[0].code);
    check('a 60-minute voucher on a 30-minute reading: explained (length must match)', wrongLen.includes('This voucher is for a 60 minute reading'));
    const ok = await apply(v30.code.toLowerCase());
    check('a valid code: “Voucher Accepted. Your Private Reading Is Fully Covered. No Payment Required.” and no Square button', ok.includes('Voucher Accepted. Your Private Reading Is Fully Covered. No Payment Required.') &&
      ok.includes('Confirm My Booking') && !ok.includes('Proceed to Secure Payment'));
    check('…the voucher is Reserved for a short time while they confirm (not used yet)', db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(id1).status === 'reserved');
    const vt = (ok.match(/name="voucher_token" value="([^"]+)"/) || [])[1];
    const other = await pay('', '15:00', { name: 'Someone Else', email: 'else@example.com', ip: '10.6.0.9' });
    const clash = await apply(v30.code, other.contact, '10.6.0.9');
    check('someone else trying the same code at that moment is told it is in use', clash.includes('being used for a booking at this moment'));
    await sleep(3100);
    const confirmVoucher = (c, fields, ip) => req('/private-readings/book', form({ ...c, policy: '1', 'cf-turnstile-response': TOKEN, ...fields }, ip));
    const noPolicy = await req('/private-readings/book', form({ ...contact, 'cf-turnstile-response': TOKEN, voucher_id: String(id1), voucher_token: vt, voucher_code: v30.code }, '10.6.0.1'));
    check('the cancellation policy must still be ticked', noPolicy.status === 422 && db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(id1).status === 'reserved');
    const sqBefore = (await sqState()).links.length;
    const done = await confirmVoucher(contact, { voucher_id: String(id1), voucher_token: vt, voucher_code: v30.code }, '10.6.0.1');
    const order = db.prepare(`SELECT * FROM orders WHERE customer_email = 'vera@example.com'`).get();
    const bk = order && db.prepare('SELECT * FROM bookings WHERE order_id = ?').get(order.id);
    const vAfter = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(id1);
    check('Confirm My Booking: the reading is confirmed with no Square payment (payment method Gift Voucher)', done.status === 303 && (done.headers.get('location') || '').startsWith(`/order/${order.reference}?key=`) &&
      order.status === 'paid' && order.payment_method === 'gift_voucher' && order.voucher_id === id1 && !order.square_payment_id && !order.square_order_id && (await sqState()).links.length === sqBefore);
    check('…the appointment is booked and its time (and break) blocked', bk && bk.status === 'confirmed' && bk.local_start === '12:00' && bk.date === day && db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(bk.id).n === 2);
    check('…the voucher is Redeemed, linked to the booking, with its history', vAfter.status === 'redeemed' && vAfter.order_id === order.id && !vAfter.reserved_token && !!db.prepare(`SELECT 1 FROM gift_voucher_log WHERE voucher_id = ? AND what LIKE 'Redeemed:%'`).get(id1));
    const op = await text(done.headers.get('location'));
    check('the customer’s page: booked, Payment method Gift voucher, Amount due £0.00', op.includes('Your reading is booked') && op.includes('Your gift voucher has been accepted') && op.includes('<dt>Payment method</dt><dd>Gift voucher</dd>') && op.includes('<dt>Amount due</dt><dd>£0.00</dd>'));
    const cm = (await emails()).filter((e) => e.to === 'vera@example.com');
    check('the normal confirmation email (Resend): date, time, WhatsApp video call, Gift voucher, £0.00', cm.length === 1 && cm[0].subject.startsWith('Your private reading is booked') && cm[0].text.includes('WhatsApp video call') &&
      cm[0].text.includes('Payment method: Gift voucher') && cm[0].text.includes('Amount due: £0.00') && cm[0].text.includes('nothing to pay') && !cm[0].text.includes('Price paid'));
    check('Gary is told (with the voucher code)', (await emails()).some((e) => /New booking \(gift voucher\)/.test(e.subject || '') && (e.text || '').includes(v30.code)));
    const adm = await text(`/admin/orders/${order.id}`, { jar: g });
    check('Admin shows the booking: Payment method Gift voucher, Amount due £0.00, no Square payment', adm.includes('Gift voucher') && adm.includes(`>${v30.code}</a>`) && adm.includes('<dt>Amount due</dt><dd>£0.00</dd>') && adm.includes('No Square payment'));
    const cal = await text(`/admin/readings/availability?month=${day.slice(0, 7)}&date=${day}`, { jar: g });
    check('…and in the Admin calendar as a confirmed appointment, and in Bookings', cal.includes('Vera Voucher') && cal.includes('Confirmed appointments') && (await text('/admin/bookings?show=upcoming', { jar: g })).includes('Vera Voucher'));
    const vpage2 = await text(`/admin/readings/vouchers/${id1}`, { jar: g });
    check('the voucher’s page shows who redeemed it and the appointment', vpage2.includes('Vera Voucher') && vpage2.includes('12 noon') && vpage2.includes('REDEEMED'));
    check('the same code can’t be used again', (await apply(v30.code, other.contact, '10.6.0.9')).includes('already been used'));
    const times = async (d) => { const h = await text(`/private-readings/book?reading=reading-30&date=${d}`); return [...h.matchAll(/class="time-btn press" href="[^"]*time=(\d\d%3A\d\d|\d\d:\d\d)"/g)].map((m) => decodeURIComponent(m[1])); };
    check('voucher bookings use the same calendar: 12pm (and the 12:30 break) are no longer offered', !(await times(day)).includes('12:00') && !(await times(day)).includes('12:30'));

    // expired, cancelled, abandoned, simultaneous, taken time, closed date
    db.prepare('UPDATE gift_vouchers SET expires_on = ? WHERE id = ?').run(addDays(-1), v60s[0].id);
    const sixty = await pay('', '14:00', { reading: 'reading-60', name: 'Sixty Person', email: 'sixty@example.com', ip: '10.6.1.1' });
    check('an expired voucher: explained, and normal payment still offered', (await apply(v60s[0].code, sixty.contact, '10.6.1.1')).includes('This voucher expired on') && (await text(`/admin/readings/vouchers/${v60s[0].id}`, { jar: g })).includes('EXPIRED'));
    const cancel = await submit(g, `/admin/readings/vouchers/${v60s[1].id}/cancel`, {});
    check('Admin can cancel an unused voucher; its code then no longer works', cancel.status === 303 && db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(v60s[1].id).status === 'cancelled' &&
      (await apply(v60s[1].code, sixty.contact, '10.6.1.1')).includes('no longer active'));
    check('…a used voucher can’t be cancelled', (await submit(g, `/admin/readings/vouchers/${id1}/cancel`, {})).headers.get('location').includes('not-allowed'));
    const v3 = v60s[2];
    const held = await apply(v3.code, sixty.contact, '10.6.1.1');
    const tok3 = (held.match(/name="voucher_token" value="([^"]+)"/) || [])[1];
    check('abandoned booking: the voucher is reserved while they confirm…', !!tok3 && db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(v3.id).status === 'reserved');
    db.prepare('UPDATE gift_vouchers SET reserved_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), v3.id);
    await fetch(`${BASE}/__dev/cron?cron=7 * * * *`);
    await sleep(400);
    check('…and becomes Available again once the short hold has run out (they never confirmed)', db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(v3.id).status === 'available' &&
      !db.prepare(`SELECT 1 FROM orders WHERE customer_email = 'sixty@example.com'`).get());
    // two people redeeming the same code at the same moment (both pages sent at once, for different times)
    const p1 = await pay('', '14:00', { reading: 'reading-60', date: dayFree, name: 'Race One', email: 'race1@example.com', ip: '10.6.2.1' });
    const p2 = await pay('', '16:00', { reading: 'reading-60', date: dayFree, name: 'Race Two', email: 'race2@example.com', ip: '10.6.2.2' });
    const a1 = await apply(v3.code, p1.contact, '10.6.2.1');
    const t1 = (a1.match(/name="voucher_token" value="([^"]+)"/) || [])[1];
    db.prepare('UPDATE gift_vouchers SET reserved_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), v3.id);   // (as if the first hold had just lapsed)
    const a2 = await apply(v3.code, p2.contact, '10.6.2.2');
    const t2 = (a2.match(/name="voucher_token" value="([^"]+)"/) || [])[1];
    db.prepare('UPDATE gift_vouchers SET reserved_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), v3.id);   // both now think they may use it
    await sleep(3100);
    const [x1, x2] = await Promise.all([confirmVoucher(p1.contact, { voucher_id: String(v3.id), voucher_token: t1, voucher_code: v3.code }, '10.6.2.1'),
      confirmVoucher(p2.contact, { voucher_id: String(v3.id), voucher_token: t2, voucher_code: v3.code }, '10.6.2.2')]);
    const raceOrders = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE voucher_id = ?`).get(v3.id).n;
    check('two customers redeeming the same code at the same moment: only ONE booking is made', !!t1 && !!t2 && raceOrders === 1 && [x1.status, x2.status].filter((s) => s === 303).length === 1 &&
      db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(v3.id).status === 'redeemed');
    // a voucher never overrides a taken time
    const v4 = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(Number(((await mk({ note: 'Complimentary Reading' })).headers.get('location').match(/made=(\d+)/))[1]));
    const sq1 = await pay('', '13:00', { name: 'Square Payer', email: 'square@example.com', ip: '10.6.3.1' });
    const vv = await pay('', '13:00', { name: 'Voucher Late', email: 'late@example.com', ip: '10.6.3.2' });
    const vh = await apply(v4.code, vv.contact, '10.6.3.2');
    const vtok = (vh.match(/name="voucher_token" value="([^"]+)"/) || [])[1];
    await sleep(3100);
    const normal = await req('/private-readings/book', form({ ...sq1.contact, policy: '1', 'cf-turnstile-response': TOKEN }, '10.6.3.1'));
    const sqOrder = db.prepare(`SELECT * FROM orders WHERE customer_email = 'square@example.com'`).get();
    check('a normal Square booking still works (£40, held for payment, Google Pay and Apple Pay offered)', normal.status === 303 && sqOrder.amount_pence === 4000 && sqOrder.payment_method === 'square' &&
      (await sqState()).links.find((l) => l.orderId === sqOrder.square_order_id).requests.checkout_options.accepted_payment_methods.apple_pay === true);
    const lateTry = await confirmVoucher(vv.contact, { voucher_id: String(v4.id), voucher_token: vtok, voucher_code: v4.code }, '10.6.3.2');
    check('a voucher can’t book a time someone else holds or has booked (double booking prevented); the voucher is not used up', lateTry.status === 409 &&
      !db.prepare(`SELECT 1 FROM orders WHERE customer_email = 'late@example.com'`).get() && db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(v4.id).status !== 'redeemed');
    const sqPay = await payLink((await sqState()).links.find((l) => l.orderId === sqOrder.square_order_id).id);
    await webhook(sqPay);
    check('…and the Square booking is confirmed by the webhook as before', db.prepare('SELECT status FROM orders WHERE id = ?').get(sqOrder.id).status === 'paid');
    const closedDay = addDays(6);
    const closedTry = await req('/private-readings/book', form({ t: stampOf(await text(`/private-readings/book/details?reading=reading-30&date=${day}&time=16:00`)), reading: 'reading-30', date: closedDay, time: '12:00',
      name: 'Closed Day', email: 'closed@example.com', phone: '07700 900111', policy: '1', 'cf-turnstile-response': TOKEN, voucher_id: String(v4.id), voucher_token: vtok || 'x'.repeat(22), voucher_code: v4.code, website: '' }, '10.6.4.1'));
    check('a voucher never opens a closed date (sent back to Private Readings, nothing booked, voucher not used)', closedTry.headers.get('location') === '/private-readings' &&
      !db.prepare(`SELECT 1 FROM orders WHERE customer_email = 'closed@example.com'`).get() && db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(v4.id).status !== 'redeemed');

    // cancelling a voucher booking does NOT bring the code back by itself
    const can = await submit(g, `/admin/orders/${order.id}/cancel`, {});
    check('cancelling a voucher booking in Admin frees the time but does NOT make the code usable again', can.status === 303 && db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(id1).status === 'redeemed' &&
      (await text(`/admin/readings/vouchers/${id1}`, { jar: g })).includes('Make this code usable again'));
    const re = await submit(g, `/admin/readings/vouchers/${id1}/reactivate`, {});
    check('…Gary or Julie can choose to make it usable again (recorded)', re.status === 303 && db.prepare('SELECT status, order_id FROM gift_vouchers WHERE id = ?').get(id1).status === 'available' &&
      !!db.prepare(`SELECT 1 FROM gift_voucher_log WHERE voucher_id = ? AND what LIKE 'Made usable again%'`).get(id1));
    const list = await text('/admin/readings/vouchers', { jar: g });
    check('the vouchers list shows every status', ['AVAILABLE', 'REDEEMED', 'EXPIRED', 'CANCELLED'].every((s) => list.includes(`>${s}<`)));
  }
} catch (err) {
  console.log('Test run stopped: ' + (err && err.stack ? err.stack : err));
  failed++;
} finally {
  if (srv) srv.child.kill();
}
const notRun = Math.max(0, EXPECTED_CHECKS - passed - failed);
console.log(`\n${passed} passed, ${failed} failed, ${notRun} not run (skipped)`);
process.exit(failed || notRun ? 1 : 0);
