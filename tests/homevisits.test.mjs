// Automated tests for private readings as a Home Visit (In Person) as well as by WhatsApp video call: the booking
// assistant's choice, the address, the road-mileage travel charge (60p a mile, there and back, rounded up), prices
// hidden until every detail is given, travel time kept clear in the diary, payment of exactly the amount shown,
// emails, Admin and Incomplete Bookings, and Gary's home location never reaching the browser.
// Run with: npm test, or on its own: node tests/homevisits.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== '' ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
}
const PORT = 8985;
function start(port, extraEnv = {}) {
  const dbFile = path.join(root, 'dev', '.local', `homev-${port}.sqlite`);
  for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: `http://localhost:${port}`, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', (d) => { if (String(d).includes('local test copy')) { clearTimeout(timer); resolve({ child, base: `http://localhost:${port}`, mock: `http://localhost:${port + 100}`, dbFile }); } });
    child.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  });
}
class Jar {
  constructor() { this.c = {}; }
  add(res) { for (const sc of res.headers.getSetCookie()) { const [p] = sc.split(';'); const i = p.indexOf('='); const v = p.slice(i + 1).trim(); if (v) this.c[p.slice(0, i).trim()] = v; else delete this.c[p.slice(0, i).trim()]; } }
  header() { return Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join('; '); }
}
let base = '';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
async function req(p, { jar, method = 'GET', body, ua } = {}) {
  const h = {};
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET') h.Origin = base;
  if (ua) h['User-Agent'] = ua;
  const res = await fetch(base + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}
const text = async (p, o) => (await req(p, o)).text();
async function signIn(who) {
  const jar = new Jar();
  const login = await req('/admin/login', { jar });
  const auth = await (await fetch(login.headers.get('location'))).text();
  const link = (auth.match(new RegExp(`id="as-${who}" href="([^"]+)"`)) || [])[1];
  const cb = new URL(link.replace(/&amp;/g, '&'));
  await req(cb.pathname + cb.search, { jar });
  return jar;
}
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// The hidden fields of the first form on a page whose pay value is `pay`
function payForm(htmlText, pay) {
  const forms = htmlText.split('<form').slice(1);
  const f = forms.find((x) => x.includes(`name="pay" value="${pay}"`));
  if (!f) return null;
  const out = {};
  for (const m of f.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) out[m[1]] = unesc(m[2]);
  return out;
}
const post = async (p, fields, opts = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return req(p, { method: 'POST', body: fd, ...opts });
};



const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = [];
try {
  const dev = await start(PORT, { HOME_VISITS: '1' }); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn('owner');
  const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
  const routing = async () => (await fetch(dev.mock + '/__routing')).json();
  const emails = async () => (await fetch(dev.mock + '/__emails')).json();
  const sq = async () => (await fetch(dev.mock + '/__square/state')).json();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let day = addDays(today, 3); while (new Date(day + 'T12:00:00Z').getUTCDay() !== 0) day = addDays(day, 1);   // a Sunday (12 noon to 5pm)
  const noPrice = (h) => !/£\s?\d/.test(h) && !h.includes('6500') && !h.includes('4000');
  const HOME_HINTS = ['56.47', '-2.99', '2.990', '56.470'];
  const leaksHome = (h) => HOME_HINTS.some((x) => h.includes(x));
  const form = (path, fields, ip = '10.9.0.1') => fetch(base + path, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, 'CF-Connecting-IP': ip }, body: new URLSearchParams(fields).toString() });
  db.prepare(`INSERT INTO settings (key, value) VALUES ('notification_email', 'gary@example.test') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  db.prepare(`DELETE FROM availability_dates WHERE date = ?`).run(day);
  db.prepare(`INSERT INTO availability_dates (date, mode, start_time, end_time) VALUES (?, 'hours', '10:00', '18:00')`).run(day);
  const det = await text(`/private-readings/book/details?reading=reading-60&date=${day}&time=14:00`);
  const stamp = det.match(/name="t" value="([^"]+)"/)[1];
  const who = { t: stamp, website: '', reading: 'reading-60', date: day, time: '14:00', name: 'Hannah Home', phone: '07700 900456', email: 'hannah@example.test' };
  const homeDetails = (extra = {}, ip) => form('/private-readings/book/details', { ...who, method: 'home', address: '12 Example Street', town: 'Dundee', postcode: 'DD2 1AA', ...extra }, ip);
  const hidden = (h) => Object.fromEntries([...h.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], unesc(m[2])]));

  console.log('\nThe Private Readings page and the booking assistant');
  {
    const rp = await text('/private-readings');
    check('the reading page offers both ways and still shows no price', rp.includes('then choose a WhatsApp video call or a home visit') && noPrice(rp) && !leaksHome(rp));
    check('the Bookings page advertises WhatsApp readings and home visits', (await text('/bookings')).includes('in the comfort of your own home: Gary comes to you'));
    check('after the date and time, the assistant asks: How would you like your reading?', det.includes('How would you like your reading?') && det.includes('name="method" value="whatsapp"') && det.includes('name="method" value="home"'));
    check('…with the two choices clearly labelled, and Gary travelling to the customer', det.includes('<strong>WhatsApp Video Call</strong>') && det.includes('<strong>Home Visit (In Person)</strong>') && det.includes('Gary comes to your home for your reading'));
    check('…a home visit also asks for the address (house number and street, town) and postcode', det.includes('name="address"') && det.includes('name="town"') && det.includes('name="postcode"'));
    check('…and no price, and nothing about Gary’s own home, is in the page', noPrice(det) && !leaksHome(det));
  }

  console.log('\nDetails first: no price until everything is given and checked');
  {
    const r1 = await homeDetails({ address: '', town: '', postcode: '' });
    const h1 = await r1.text();
    check('a home visit without an address and postcode is explained, with no price', r1.status === 422 && h1.includes('Please enter your house number (or name) and street.') && h1.includes('Please enter your town or city.') && h1.includes('Please enter your full UK postcode') && noPrice(h1));
    const calls0 = (await routing()).calls.length;
    check('…and nothing was looked up', (await routing()).calls.length === calls0);
    const r2 = await homeDetails({ postcode: 'ZZ9 9ZZ' });
    const h2 = await r2.text();
    check('an unknown postcode is explained (no mileage made up, no price)', r2.status === 422 && h2.includes('We couldn’t find the postcode ZZ9 9ZZ') && noPrice(h2) && h2.includes('value="12 Example Street"'));
    const r3 = await homeDetails({ postcode: 'dd19zz' });
    const h3 = await r3.text();
    check('no driving route: explained, no figure invented, no price', r3.status === 422 && h3.includes('couldn’t work out a driving route to DD1 9ZZ') && noPrice(h3));
    await fetch(dev.mock + '/__routing/down?on=1');
    const r4 = await homeDetails();
    const h4 = await r4.text();
    await fetch(dev.mock + '/__routing/down?on=0');
    check('the route service not answering: explained, nothing booked, no price', r4.status === 422 && h4.includes('can’t be calculated just now') && noPrice(h4));
    const routeCall = (await routing()).calls.find((c) => c.kind === 'osrm');
    check('the route is a real road route from the private starting point (OpenStreetMap routing, identified politely)', !!routeCall && routeCall.path.includes('/-2.99,56.47;') && routeCall.ua.startsWith('NewWaysMediumship/'));
    check('…using the road routing service, never a straight line', (await routing()).calls.some((c) => c.kind === 'osrm' && c.path.includes('overview=false')));
  }

  let review;
  console.log('\nThe booking review: reading price + return mileage + travel charge = total');
  {
    const r = await homeDetails({ postcode: 'dd2 1aa' });
    review = await r.text();
    check('17.6 miles each way → 35.2 there and back → rounded up to 36 miles → £21.60 travel', r.status === 200 && review.includes('Return travel: 36 miles (17.6 miles each way by road') && review.includes('<dd>£21.60</dd>'));
    check('…plus the 60 minute reading £65.00 = total £86.60, shown on the payment button', review.includes('<dd>£65.00</dd>') && review.includes('<strong class="assistant-price">£86.60</strong>') && review.includes('Proceed to Secure Payment: £86.60'));
    check('…with the customer’s own address and the home visit wording', review.includes('Gary will come to 12 Example Street, Dundee, DD2 1AA') && review.includes('as a <strong>home visit</strong>: Gary comes to your home'));
    check('…and nothing about Gary’s own home anywhere in it (hidden fields included)', !leaksHome(review));
    check('“Change my details” is there, and the gift voucher box isn’t offered for home visits', review.includes('Change my details') && !review.includes('Have a Gift Voucher'));
    const p2 = await (await homeDetails({ postcode: 'DD3 3AA' }, '10.9.0.2')).text();
    check('18.64 miles each way → 37.28 → rounded UP to 38 miles → £22.80 (always up)', p2.includes('Return travel: 38 miles (18.6 miles each way') && p2.includes('<dd>£22.80</dd>') && p2.includes('£87.80'));
    const voucherTry = await (await form('/private-readings/book/voucher', { ...hidden(review), code: 'GV-ABCD-EFGH-JKLM' }, '10.9.0.9')).text();
    check('a gift voucher on a home visit is explained (contact Gary), nothing booked', voucherTry.includes('For a home visit with a gift voucher, please contact Gary.'), voucherTry.replace(/\s+/g, ' ').slice(voucherTry.indexOf('<main'), voucherTry.indexOf('<main') + 1500));
    const p20 = await (await homeDetails({ postcode: 'DD5 2AA' }, '10.9.0.3')).text();
    check('exactly 20 miles away: allowed, 40 miles there and back = £24.00 travel', p20.includes('Return travel: 40 miles (20.0 miles each way') && p20.includes('<dd>£24.00</dd>'));
    const far = await (await homeDetails({ postcode: 'KY16 9AA' }, '10.9.0.4')).text();
    check('more than 20 miles away: the assistant says it is outside the 20-mile home-visit area, offering WhatsApp instead', far.includes('Unfortunately, your address is outside Gary’s 20-mile home-visit area.') &&
      far.includes('Thank you for your interest in booking a private reading with Gary.') && far.includes('so you can still enjoy your reading from the comfort of your own home, wherever you live.') && far.includes('Would you like to continue with a WhatsApp video reading instead?'));
    check('…with the two buttons, and no price or distance shown', far.includes('YES — SWITCH TO WHATSAPP VIDEO CALL') && far.includes('NO — CANCEL BOOKING') && noPrice(far) && !far.includes('25.0') && !leaksHome(far));
    check('…NO cancels: back to Private Readings, nothing booked', /href="\/private-readings">NO — CANCEL BOOKING/.test(far) && db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE customer_email = 'hannah@example.test'`).get().n === 0);
    const yes = await (await form('/private-readings/book/details', hidden(far.slice(far.indexOf('data-outside-area'))), '10.9.0.5')).text();
    check('…YES keeps the reading, date, time, name, number and email: straight to the WhatsApp price (£65.00), no travel charge', yes.includes('The price of your 60 minute reading is <strong class="assistant-price">£65.00</strong>') && !yes.includes('Travel') &&
      yes.includes('by WhatsApp video call') && yes.includes('name="method" value="whatsapp"') && yes.includes('value="Hannah Home"') && yes.includes('value="hannah@example.test"'));
    const early = await (await homeDetails({ time: '10:00' }, '10.9.0.6')).text();
    check('a home visit is only offered where the journeys fit inside Gary’s available hours (10am start: the journey there would begin before 10am)', early.includes('would either go outside his available hours or overlap another reading') && noPrice(early));
    const edit = await (await form('/private-readings/book/details', { ...hidden(review), edit: '1' })).text();
    check('Change my details goes back with everything filled in (address too), and no price', edit.includes('value="12 Example Street"') && edit.includes('value="DD2 1AA"') && noPrice(edit));
    const draft = db.prepare(`SELECT * FROM reading_drafts WHERE customer_email = 'hannah@example.test' AND reading_method = 'home' ORDER BY id DESC LIMIT 1`).get();
    check('Incomplete Bookings records it as a home visit, with the address and travel charge', draft && draft.visit_address === '12 Example Street, Dundee' && draft.visit_postcode === 'DD5 2AA' && draft.travel_pence === 2400 && draft.travel_return_miles === 40);
    const inc = await text('/admin/incomplete', { jar: g });
    check('…shown in Admin › Incomplete Bookings as Home Visit (In Person), with the address', inc.includes('Home Visit (In Person)') && inc.includes('12 Example Street, Dundee, DD5 2AA'));
  }

  console.log('\nPaying exactly the amount shown, with travel time kept clear');
  let order, booking;
  {
    await sleep(3200);
    // someone alters the travel charge in the page: never charged; the review is worked out again
    const fields = { ...hidden(review), policy: '1', 'cf-turnstile-response': TOKEN, website: '' };
    const n0 = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
    const tampered = await form('/private-readings/book', { ...fields, q_pence: '60', q_return: '1' }, '10.9.1.1');
    const th = await tampered.text();
    check('an altered travel charge is never used: nothing booked, the real charge is shown again', tampered.status === 200 && db.prepare('SELECT COUNT(*) AS n FROM orders').get().n === n0 && th.includes('<dd>£21.60</dd>') && th.includes('£86.60'));
    const ok = await form('/private-readings/book', fields, '10.9.1.2');
    const loc = ok.headers.get('location') || '';
    order = db.prepare(`SELECT * FROM orders WHERE customer_email = 'hannah@example.test' ORDER BY id DESC`).get();
    booking = order && db.prepare('SELECT * FROM bookings WHERE order_id = ?').get(order.id);
    check('booked and held: the order is for £86.60 (reading £65.00 + travel £21.60)', ok.status === 303 && /^\/order\//.test(loc) && order.amount_pence === 8660 && booking.price_pence === 6500 && booking.travel_pence === 2160);
    check('…recorded as a home visit with the address, miles and travel time', booking.reading_method === 'home' && booking.visit_address === '12 Example Street, Dundee' && booking.visit_postcode === 'DD2 1AA' && booking.travel_return_miles === 36 && booking.travel_minutes === 36);
    const link = (await sq()).links.find((l) => l.orderId === order.square_order_id);
    check('Square is asked for exactly £86.60 (the amount shown)', !!link && link.amount === 8660);
    const slots = db.prepare('SELECT slot_utc FROM booking_slots WHERE booking_id = ? ORDER BY slot_utc').all(booking.id).map((r) => r.slot_utc);
    check('the diary keeps the journey there and back clear too (1pm to 4:30pm for a 2pm hour with 36 minutes’ travel)', slots.length === 7 && new Date(slots[0]).toISOString() === new Date(Date.parse(booking.start_utc) - 3600_000).toISOString());
    const cal = await text(`/private-readings/book?reading=reading-30&date=${day}`);
    check('…so a WhatsApp reading can’t be booked while Gary is travelling (1pm and 3:30pm gone; 12 noon still free)', !cal.includes('>1pm</a>') && !cal.includes('>3:30pm</a>') && cal.includes('>12 noon</a>'), [...cal.matchAll(/class="time-btn[^>]*>([^<]+)</g)].map((m) => m[1]).join(' '));
    const clash = await (await form('/private-readings/book/details', { ...who, email: 'other@example.test', reading: 'reading-30', time: '12:00', method: 'home', address: '1 Near Road', town: 'Dundee', postcode: 'DD3 3AA' }, '10.9.1.3')).text();
    check('a home visit whose journey would overlap another reading is refused, with the reason (no price)', clash.includes('would either go outside his available hours or overlap another reading') && noPrice(clash), clash.replace(/\s+/g, ' ').slice(clash.indexOf('<main'), clash.indexOf('<main') + 900));
    const op = await text(loc);
    check('the order page shows the home visit, the address, and Pay £86.60', op.includes('Home Visit (In Person): Gary comes to your home') && op.includes('12 Example Street, Dundee, DD2 1AA') && op.includes('Pay £86.60 securely with Square'));
    // pay in Square, then the customer comes back
    const e0 = (await emails()).length;
    await fetch(`${dev.mock}/__square/pay/${order.square_payment_link_id}`);
    const done = await text(loc);
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    check('paid in Square (£86.60): the reading is booked', order.status === 'paid' && done.includes('Gary will come to your home: 12 Example Street, Dundee, DD2 1AA.'));
    const sent = (await emails()).slice(e0);
    const cust = sent.find((m) => String(m.to).includes('hannah@example.test'));
    check('the confirmation email says it is a home visit, with the address, travel and total', !!cust && cust.text.includes('Your reading is a home visit: Gary will come to you at 12 Example Street, Dundee, DD2 1AA.') && cust.text.includes('£21.60') && cust.text.includes('£86.60') && cust.text.includes('36 miles there and back'));
    check('…and never Gary’s own home', !leaksHome(cust.html + cust.text));
    const adminMail = sent.find((m) => /HOME VISIT/.test(m.subject || ''));
    check('Gary’s notification says HOME VISIT, with the customer’s address and the road miles', !!adminMail && adminMail.text.includes('12 Example Street, Dundee, DD2 1AA') && adminMail.text.includes('17.6'));
    const ad = await text(`/admin/orders/${order.id}`, { jar: g });
    check('Admin shows Home Visit (In Person), the address, mileage and the travel charge', ad.includes('Home Visit (In Person)') && ad.includes('12 Example Street, Dundee, DD2 1AA') && ad.includes('36 miles there and back') && ad.includes('£21.60') && ad.includes('<dt>Total</dt>'));
    check('…and the bookings list marks it Home Visit', (await text('/admin/bookings', { jar: g })).includes('<strong>Home Visit</strong>'));
  }

  console.log('\nWhatsApp readings are unchanged');
  {
    const w = await (await form('/private-readings/book/details', { ...who, reading: 'reading-30', time: '16:30', email: 'wendy@example.test', method: 'whatsapp' }, '10.9.2.1')).text();
    check('WhatsApp: name, WhatsApp number and email, then the price (£40.00) with no travel', w.includes('The price of your 30 minute reading is <strong class="assistant-price">£40.00</strong>') && !w.includes('Travel charge') && w.includes('>Proceed to Secure Payment</button>'));
    const old = await (await form('/private-readings/book/details', { ...who, reading: 'reading-30', time: '16:30', email: 'oldform@example.test' }, '10.9.2.2')).text();
    check('a page sent without a choice is treated as WhatsApp, as before', old.includes('£40.00') && !old.includes('Travel'));
    await sleep(500);
    const ok = await form('/private-readings/book', { ...hidden(w), policy: '1', 'cf-turnstile-response': TOKEN, website: '' }, '10.9.2.3');
    const o = db.prepare(`SELECT * FROM orders WHERE customer_email = 'wendy@example.test'`).get();
    const b = o && db.prepare('SELECT * FROM bookings WHERE order_id = ?').get(o.id);
    check('…booked for exactly £40.00 as a WhatsApp reading', ok.status === 303 && o.amount_pence === 4000 && b.reading_method === 'whatsapp' && b.travel_pence === 0);
  }
  for (const s of servers) s.child.kill();
  servers.length = 0;

  console.log('\nOpenRouteService (when its free key is set)');
  {
    const ors = await start(PORT + 1, { HOME_VISITS: '1', ORS_KEY: 'ors-local-test-key' }); servers.push(ors);
    base = ors.base;
    { const d = new DatabaseSync(ors.dbFile); d.exec('PRAGMA busy_timeout = 5000'); d.prepare(`INSERT INTO availability_dates (date, mode, start_time, end_time) VALUES (?, 'hours', '10:00', '18:00')`).run(day); d.close(); }
    const d2 = await text(`/private-readings/book/details?reading=reading-60&date=${day}&time=14:00`);
    const st = d2.match(/name="t" value="([^"]+)"/)[1];
    const r = await (await fetch(base + '/private-readings/book/details', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
      body: new URLSearchParams({ ...who, t: st, method: 'home', address: '12 Example Street', town: 'Dundee', postcode: 'DD2 1AA' }).toString() })).text();
    const calls = (await (await fetch(ors.mock + '/__routing')).json()).calls;
    check('the route comes from OpenRouteService with its key (same £21.60 for 36 miles)', r.includes('<dd>£21.60</dd>') && calls.some((c) => c.kind === 'ors' && c.auth === 'ors-local-test-key') && !calls.some((c) => c.kind === 'osrm'));
  }
  for (const s of servers) s.child.kill();
  servers.length = 0;

  console.log('\nWithout Gary’s private starting point set, home visits aren’t offered (nothing else changes)');
  {
    const off = await start(PORT + 2, {}); servers.push(off);
    base = off.base;
    { const d = new DatabaseSync(off.dbFile); d.exec('PRAGMA busy_timeout = 5000'); d.prepare(`INSERT INTO availability_dates (date, mode, start_time, end_time) VALUES (?, 'hours', '10:00', '18:00')`).run(day); d.close(); }
    const d3 = await text(`/private-readings/book/details?reading=reading-60&date=${day}&time=14:00`);
    check('only WhatsApp: no choice is asked, exactly as before', !d3.includes('How would you like your reading?') && d3.includes('name="method" value="whatsapp"') && d3.includes('(UK time), by WhatsApp video call'));
    const st = d3.match(/name="t" value="([^"]+)"/)[1];
    const r = await fetch(base + '/private-readings/book/details', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
      body: new URLSearchParams({ ...who, t: st, method: 'home', address: '12 Example Street', town: 'Dundee', postcode: 'DD2 1AA' }).toString() });
    const h = await r.text();
    check('a home visit sent anyway is refused with an explanation, and no price', r.status === 422 && h.includes('Home visits can’t be booked online just now') && noPrice(h));
  }
} catch (err) {
  failed++;
  console.log('  FAIL the test run stopped: ' + (err && err.stack ? err.stack : err));
} finally {
  for (const s of servers) s.child.kill();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
