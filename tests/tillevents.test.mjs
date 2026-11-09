// Automated tests for the Wednesday till's ADD EVENT BOOKING: choosing an event, tickets, details, then cash,
// card on the card reader, or card in the Square app (confirmed by Square). Checks it reuses the normal booking
// (places, guest list, answers, QR codes, confirmation email), never books twice, never oversells, never confirms a
// card payment Square hasn't confirmed, and keeps the Wednesday totals unchanged.
// Run with: npm test, or on its own: node tests/tillevents.test.mjs
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
const PORT = 8925;
function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `tillev-${port}.sqlite`);
  for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: `http://localhost:${port}` }, stdio: ['ignore', 'pipe', 'pipe']
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

const servers = [];
try {
  const dev = await start(PORT); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn('owner');
  const csrf = g.c.nw_csrf || (await text('/admin/door', { jar: g })).match(/data-csrf="([^"]+)"/)[1];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  const future = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  // Events: a supper (£15, 5 places, a required meal question per guest), one switched to SOLD OUT, one with no price
  const ev = (name, extra = '') => Number(db.prepare(`INSERT INTO events (name, date, start_time, sales_mode, price_pence, capacity, max_per_booking, visible ${extra ? ', ' + extra.split('=')[0] : ''})
    VALUES (?, ?, '19:00', 'online', ?, ?, 10, 1 ${extra ? ', ' + extra.split('=')[1] : ''})`).run(name, future, name === 'Free Talk' ? 0 : 1500, name === 'Spring Supper' ? 5 : 40).lastInsertRowid);
  const E = ev('Spring Supper'), SOLD = ev('Sold Night', 'sold_out=1'), FREE = ev('Free Talk');
  const qid = Number(db.prepare(`INSERT INTO event_questions (event_id, label, type, scope, required) VALUES (?, 'Meal', 'select', 'guest', 1)`).run(E).lastInsertRowid);
  const fish = Number(db.prepare(`INSERT INTO event_question_options (question_id, label) VALUES (?, 'Fish')`).run(qid).lastInsertRowid);
  const veg = Number(db.prepare(`INSERT INTO event_question_options (question_id, label) VALUES (?, 'Vegetarian')`).run(qid).lastInsertRowid);
  const totals = async () => (await req('/admin/door/totals?date=' + today, { jar: g })).json();
  const before = await totals();
  const bookings = () => db.prepare('SELECT * FROM event_bookings WHERE event_id = ? ORDER BY id').all(E);
  const taken = () => db.prepare(`SELECT COALESCE(SUM(quantity), 0) AS n FROM event_bookings WHERE event_id = ? AND status IN ('held', 'confirmed')`).get(E).n;
  const emails = () => db.prepare(`SELECT COUNT(*) AS n FROM event_email_log WHERE kind = 'customer_confirmation'`).get().n;
  const details = (qty, extra = {}) => {
    const f = { _csrf: csrf, date: today, qty: String(qty), p_name: 'Ann Customer', p_email: 'ann@example.test', p_phone: '' };
    for (let i = 1; i <= qty; i++) { f[`g${i}_name`] = `Guest ${i} Smith`; f[`g${i}_q${qid}`] = String(i % 2 ? fish : veg); }
    return { ...f, ...extra };
  };
  const toPay = async (qty, extra = {}, ua) => {
    const r = await post(`/admin/door/events/${E}/details`, details(qty, extra), { jar: g, ua });
    return { status: r.status, html: await r.text() };
  };

  console.log('\nThe database update');
  {
    const sql = fs.readFileSync(path.join(root, 'migrations', '0026_till_event_bookings.sql'), 'utf8').replace(/--.*$/gm, '');
    const stmts = sql.split(';').map((x) => x.trim()).filter(Boolean);
    check('update 0026 only ADDS (one new table, its index, two new columns): it never changes, deletes or drops an existing row, table or rule',
      stmts.length === 4 && stmts.every((x) => /^(CREATE TABLE till_event_bookings|CREATE INDEX till_event_bookings_night|ALTER TABLE till_card_requests ADD COLUMN)/.test(x)) && !/\b(UPDATE|DELETE|DROP|INSERT|REPLACE|TRIGGER)\b/i.test(sql), stmts);
  }

  console.log('\nThe button and the list of events');
  {
    const till = await text('/admin/door', { jar: g });
    check('the till has a permanent ADD EVENT BOOKING button', till.includes('href="/admin/door/events?date=' + today + '"') && till.includes('ADD EVENT BOOKING'));
    const list = await text('/admin/door/events?date=' + today, { jar: g });
    check('upcoming events are listed with their names, dates, ticket prices and places left', list.includes('Spring Supper') && list.includes('£15.00') && list.includes('5 places left') && list.includes(`href="/admin/door/events/${E}?date=${today}"`));
    check('a SOLD OUT event is shown but can’t be chosen', list.includes('Sold Night') && list.includes('SOLD OUT') && !list.includes(`/admin/door/events/${SOLD}?`));
    check('an event with no ticket price can’t be sold at the till', list.includes('No ticket price set') && !list.includes(`/admin/door/events/${FREE}?`));
    const qty = await text(`/admin/door/events/${E}?date=${today}`, { jar: g });
    check('the number of tickets is chosen with big buttons, never more than the places left', qty.includes(`details?date=${today}&amp;qty=5`) && !qty.includes('qty=6'));
    check('…and the details form asks for each guest and the event’s meal question', (await text(`/admin/door/events/${E}/details?date=${today}&qty=2`, { jar: g })).includes(`name="g2_q${qid}"`));
    const helper = await signIn('other');
    const hs = await req('/admin/door/events?date=' + today, { jar: helper }), ns = await req('/admin/door/events?date=' + today);
    const hb = await hs.text();
    check('someone who isn’t Gary or Julie can’t use it, nor anyone not signed in', !hb.includes('Which event?') && hs.status !== 200 || !hb.includes('Spring Supper'), hs.status);
    check('…not signed in: sent to sign in', [302, 303, 401, 403].includes(ns.status), ns.status);
  }

  console.log('\nDetails are checked first');
  {
    const noEmail = await toPay(2, { p_email: '' });
    check('the customer’s email address is required (for the confirmation and QR codes)', noEmail.status === 422 && noEmail.html.includes('Please enter the customer’s email address'));
    const noMeal = await toPay(2, { [`g2_q${qid}`]: '' });
    check('a required question for the event must be answered', noMeal.status === 422 && noMeal.html.includes('Please answer this.'));
    check('…and nothing has been booked yet', bookings().length === 0);
  }

  console.log('\nCash');
  let cashRef;
  {
    const pay = await toPay(2);
    check('the payment screen shows the total and CASH and CARD', pay.status === 200 && pay.html.includes('TO PAY <strong>£30.00</strong>') && pay.html.includes('CASH RECEIVED') && pay.html.includes('CARD PAYMENT TAKEN'));
    const f = payForm(pay.html, 'cash');
    const noTick = await post(`/admin/door/events/${E}/pay`, f, { jar: g });
    check('cash isn’t accepted until Julie ticks that she has it', noTick.status === 422 && bookings().length === 0);
    const e0 = emails();
    const done = await post(`/admin/door/events/${E}/pay`, { ...f, cash_ok: '1' }, { jar: g });
    const b = bookings()[0];
    check('the booking is made and Julie goes straight back to the till', done.status === 303 && done.headers.get('location').startsWith(`/admin/door?date=${today}&flash=event-booked&`));
    check('…an ordinary booking: confirmed, paid, cash, £30, 2 tickets', b && b.status === 'confirmed' && b.payment_status === 'paid' && b.payment_method === 'cash' && b.total_pence === 3000 && b.quantity === 2 && b.purchaser_email === 'ann@example.test');
    const guests = db.prepare('SELECT * FROM event_guests WHERE booking_id = ? ORDER BY position').all(b.id);
    const answers = db.prepare('SELECT value FROM event_answers WHERE booking_id = ? ORDER BY guest_id').all(b.id).map((a) => a.value);
    check('…with each guest (for check-in and the guest list) and their meal choices', guests.length === 2 && guests[1].name === 'Guest 2 Smith' && answers.join(',') === 'Fish,Vegetarian');
    check('…its own QR code', /^[A-Za-z0-9_-]{22}$/.test(b.checkin_token));
    check('…the places left go down (5 → 3)', taken() === 2);
    check('…and the normal confirmation email with the QR codes is sent', emails() === e0 + 1);
    check('the till says BOOKING COMPLETE', (await text(done.headers.get('location'), { jar: g })).includes('BOOKING COMPLETE'));
    const again = await post(`/admin/door/events/${E}/pay`, { ...f, cash_ok: '1' }, { jar: g });
    check('pressing the button twice (or the page sent again) never books twice', again.status === 303 && again.headers.get('location').includes('flash=event-already') && bookings().length === 1);
    check('the booking is on the event’s guest list and its meal totals', (await text(`/admin/events/${E}/guests`, { jar: g })).includes('Guest 2 Smith'));
    const tot = await text(`/admin/events/${E}/totals`, { jar: g });
    check('…and in the event’s meal totals', tot.includes('Vegetarian'));
    const ci = await req('/admin/checkin/scan/' + b.checkin_token, { jar: g });
    const ciPage = await text(`/admin/checkin/${E}?q=Guest+1+Smith`, { jar: g });
    check('…and Julie can find and check in its guests for the event', ciPage.includes('Guest 1 Smith'));
    cashRef = b.reference;
  }

  console.log('\nDuplicates and overselling');
  {
    const dup = await toPay(1);
    check('the same email booking the same event again is asked about first', dup.status === 422 && dup.html.includes('already has a booking for this event') && dup.html.includes('name="dup_ok"'));
    const tooMany = await req(`/admin/door/events/${E}/details?date=${today}&qty=4`, { jar: g });
    check('more tickets than places left can’t be chosen (3 left)', tooMany.status === 303);
    // Two screens open at once: both for 3 tickets; the second must be refused
    const p1 = await toPay(3, { p_email: 'one@example.test' });
    const p2 = await toPay(3, { p_email: 'two@example.test' });
    const f1 = payForm(p1.html, 'cash'), f2 = payForm(p2.html, 'cash');
    const r1 = await post(`/admin/door/events/${E}/pay`, { ...f1, cash_ok: '1' }, { jar: g });
    const r2 = await post(`/admin/door/events/${E}/pay`, { ...f2, cash_ok: '1' }, { jar: g });
    const r2html = await r2.text();
    check('two tills selling the last places: the second is refused, nothing oversold', r1.status === 303 && r2.status === 409 && /SOLD OUT|only/.test(r2html) && taken() === 5);
    check('…and the event now shows SOLD OUT at the till', (await text('/admin/door/events?date=' + today, { jar: g })).match(/Spring Supper[\s\S]{0,300}SOLD OUT/) !== null);
    // make room again for the card tests
    db.prepare(`UPDATE events SET capacity = 20 WHERE id = ?`).run(E);
  }

  console.log('\nCard on the card reader (no Square app, e.g. the iPad)');
  {
    const pay = await toPay(1, { p_email: 'reader@example.test' }, IPAD);
    check('without the Square app, the card button is “Card payment taken ✓” after the card reader approves', pay.html.includes('CARD PAYMENT TAKEN ✓') && !pay.html.includes('PAY IN THE SQUARE APP'));
    const f = payForm(pay.html, 'card');
    const n0 = bookings().length;
    check('not booked until Julie ticks that the card reader shows it APPROVED', (await post(`/admin/door/events/${E}/pay`, f, { jar: g, ua: IPAD })).status === 422 && bookings().length === n0);
    const ok = await post(`/admin/door/events/${E}/pay`, { ...f, card_ok: '1' }, { jar: g, ua: IPAD });
    const b = bookings().at(-1);
    check('…then booked as paid by card', ok.status === 303 && b.payment_method === 'card' && b.payment_status === 'paid' && b.status === 'confirmed');
  }

  console.log('\nCard in the Square app (Julie’s Android phone), confirmed by Square');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('pos_app_id', 'sq0idp-LOCALTESTAPP'), ('pos_handoff', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  const charge = async (q) => (await fetch(`${dev.mock}/__square/pos/charge?` + new URLSearchParams(q))).json();
  const back = async (params) => {
    const r = await req('/admin/door/square-callback?' + new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => ['com.squareup.pos.' + k, v]))), { jar: g, ua: ANDROID });
    const loc = r.headers.get('location');
    return { loc, html: loc ? await text(loc, { jar: g, ua: ANDROID }) : await r.text() };
  };
  const startApp = async (email, qty = 2) => {
    const pay = await toPay(qty, { p_email: email }, ANDROID);
    const f = payForm(pay.html, 'card_app');
    const r = await post(`/admin/door/events/${E}/pay`, f, { jar: g, ua: ANDROID });
    const loc = r.headers.get('location') || '';
    const ref = (loc.match(/ref=([a-f0-9]{32})/) || [])[1];
    return { pay, f, r, loc, ref, page: ref ? await text(loc, { jar: g, ua: ANDROID }) : '' };
  };
  {
    const a = await startApp('app@example.test');
    const b = bookings().at(-1);
    check('on Android with the Square app switched on, CARD opens the Square app', a.pay.html.includes('CARD: PAY IN THE SQUARE APP') && a.r.status === 303 && !!a.ref);
    check('…the places are HELD (not booked, not paid) while the card is taken', b.status === 'held' && b.payment_status === 'pending' && b.purchaser_email === 'app@example.test');
    check('…the Square app is opened for exactly £30.00, with this payment’s own reference, and comes straight back', a.page.includes('i.com.squareup.pos.TOTAL_AMOUNT=3000') && a.page.includes('REQUEST_METADATA=' + a.ref) && a.page.includes('AUTO_RETURN_TIMEOUT_MS=3200'));
    const e0 = emails();
    const tx = await charge({ amount: 3000 });
    const cb = await back({ SERVER_TRANSACTION_ID: tx.transactionId, CLIENT_TRANSACTION_ID: 'C1', REQUEST_METADATA: a.ref });
    const b2 = db.prepare('SELECT * FROM event_bookings WHERE id = ?').get(b.id);
    check('when Square confirms the payment: BOOKING COMPLETE, then back to the till', cb.html.includes('BOOKING COMPLETE') && cb.html.includes('flash=event-booked'));
    check('…the booking is confirmed, paid by card, with Square’s payment recorded', b2.status === 'confirmed' && b2.payment_status === 'paid' && b2.payment_method === 'card' && b2.square_payment_id === tx.paymentId);
    check('…and the confirmation email with the QR codes is sent', emails() === e0 + 1);
    const cb2 = await back({ SERVER_TRANSACTION_ID: tx.transactionId, CLIENT_TRANSACTION_ID: 'C1', REQUEST_METADATA: a.ref });
    check('Square coming back twice changes nothing (one booking, one email)', cb2.html.includes('BOOKING COMPLETE') && emails() === e0 + 1 && db.prepare(`SELECT COUNT(*) AS n FROM event_bookings WHERE purchaser_email = 'app@example.test'`).get().n === 1);
    check('…and the same Square payment can’t be used again for a till sale', db.prepare('SELECT COUNT(*) AS n FROM till_card_requests WHERE square_payment_id = ?').get(tx.paymentId).n === 1);
  }
  {
    const a = await startApp('cancel@example.test');
    const held = taken();
    const cb = await back({ ERROR_CODE: 'TRANSACTION_CANCELED', REQUEST_METADATA: a.ref });
    const b = db.prepare(`SELECT * FROM event_bookings WHERE purchaser_email = 'cancel@example.test'`).get();
    check('cancelled in the Square app: NOT PAID, nothing booked, the places released', cb.html.includes('NOT PAID: NOTHING BOOKED') && b.status === 'cancelled' && b.payment_status === 'pending' && taken() === held - 2);
  }
  {
    const a = await startApp('wrong@example.test');
    const tx = await charge({ amount: 1000 });
    const cb = await back({ SERVER_TRANSACTION_ID: tx.transactionId, REQUEST_METADATA: a.ref });
    const b = db.prepare(`SELECT * FROM event_bookings WHERE purchaser_email = 'wrong@example.test'`).get();
    check('Square took a different amount: never marked as paid, places released', cb.html.includes('NOT PAID') && b.status === 'cancelled' && b.payment_status !== 'paid');
  }
  {
    const a = await startApp('declined@example.test');
    const tx = await charge({ amount: 3000, status: 'FAILED' });
    const cb = await back({ SERVER_TRANSACTION_ID: tx.transactionId, REQUEST_METADATA: a.ref });
    const b = db.prepare(`SELECT * FROM event_bookings WHERE purchaser_email = 'declined@example.test'`).get();
    check('a declined card: never marked as paid, places released', cb.html.includes('NOT PAID') && b.status === 'cancelled');
  }
  {
    const a = await startApp('changed@example.test');
    const r = await post('/admin/door/event-card/cancel', { _csrf: csrf, ref: a.ref }, { jar: g, ua: ANDROID });
    const b = db.prepare(`SELECT * FROM event_bookings WHERE purchaser_email = 'changed@example.test'`).get();
    check('Julie can cancel before the card is taken: back to the till, places released', r.status === 303 && r.headers.get('location').includes('flash=event-cancelled') && b.status === 'cancelled');
  }
  {
    // Square's offline mode: can't be confirmed automatically; Julie checks the Square app, then completes it
    const a = await startApp('offline@example.test', 1);
    const cb = await back({ CLIENT_TRANSACTION_ID: 'OFFLINE1', REQUEST_METADATA: a.ref });
    const b = db.prepare(`SELECT * FROM event_bookings WHERE purchaser_email = 'offline@example.test'`).get();
    check('a payment Square can’t confirm yet: NOT BOOKED, places still held', cb.html.includes('NOT CONFIRMED YET: NOT BOOKED') && b.status === 'held');
    const r = await post('/admin/door/card/confirm', { _csrf: csrf, ref: a.ref, checked: '1' }, { jar: g, ua: ANDROID });
    const page = await text(r.headers.get('location'), { jar: g });
    const b2 = db.prepare('SELECT * FROM event_bookings WHERE id = ?').get(b.id);
    check('…after Julie checks the Square app and ticks: booked and paid', page.includes('BOOKING COMPLETE') && b2.status === 'confirmed' && b2.payment_status === 'paid');
  }

  console.log('\nThe Wednesday till’s own money is unchanged');
  {
    const after = await totals();
    check('the Wednesday totals don’t include event tickets', after.total === before.total && after.cash === before.cash && after.card === before.card && after.service === before.service);
    const till = await text('/admin/door', { jar: g });
    check('the till shows the event tickets booked today separately', till.includes('Event tickets booked at the till today') && till.includes('£75.00 cash'));
    const close = await text('/admin/door/close?date=' + today, { jar: g });
    check('Close night lists them and counts their cash in “Expected in the tin”', close.includes('Event tickets booked at the till') && close.includes(cashRef) && close.includes('event-ticket cash (£75.00)'));
    const report = await text('/admin/door/nights/' + today, { jar: g });
    check('…and so does the night’s report', report.includes('Event tickets booked at the till'));
    const wedSale = await post('/admin/door/sale', { _csrf: csrf, date: today, method: 'cash', client_ref: 'tillevt' + Date.now(), expected_total: '500',
      lines: JSON.stringify([{ item_id: db.prepare(`SELECT id FROM till_items WHERE category = 'entry' LIMIT 1`).get().id, qty: 1 }]) }, { jar: g });
    const ws = await wedSale.json();
    check('ordinary till sales still work', ws.ok === true && (await totals()).cash === before.cash + ws.total);
  }

  console.log('\nWho’s On: Share to Facebook for each upcoming guest medium');
  {
    const wed = (() => { const d = new Date(Date.now() + 8 * 864e5); while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const M = Number(db.prepare(`INSERT INTO mediums (date, name, location, description, visible) VALUES (?, 'Mary Medium', 'Glasgow', 'A warm and accurate medium.\n\nMore about Mary.', 1)`).run(wed).lastInsertRowid);
    const P = Number(db.prepare(`INSERT INTO mediums (date, name, visible) VALUES ('2020-01-01', 'Past Person', 1)`).run().lastInsertRowid);
    const H = Number(db.prepare(`INSERT INTO mediums (date, name, visible) VALUES (?, 'Hidden Person', 0)`).run(wed).lastInsertRowid);
    const admin = await text('/admin/whos-on', { jar: g });
    const link = `${base}/whos-on/${M}`;
    check('each upcoming guest medium has Share to Facebook next to Edit and Hide', admin.includes(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`) && admin.includes('Share to Facebook') && admin.includes(`/admin/whos-on/${M}"`));
    check('…it opens Facebook in a new tab, and there is Copy link too', /sharer\.php[^"]*" target="_blank" rel="noopener"/.test(admin) && admin.includes(`data-copy="${link}"`));
    check('…not for a hidden or past listing (their links would not open them)', !admin.includes(encodeURIComponent(`/whos-on/${H}`)) && !admin.includes(encodeURIComponent(`/whos-on/${P}`)));
    const pageRes = await req(`/whos-on/${M}`);
    const pageHtml = await pageRes.text();
    check('the permanent link opens that medium’s own listing', pageRes.status === 200 && pageHtml.includes('Mary Medium') && pageHtml.includes('From Glasgow') && pageHtml.includes('A warm and accurate medium.'));
    check('…with the Facebook preview: the medium’s name, date and description, and this link', pageHtml.includes('property="og:title" content="Mary Medium at New Way’s') && pageHtml.includes('property="og:description" content="A warm and accurate medium."') && pageHtml.includes(`property="og:url" content="${link}"`));
    check('…and links to everyone on Who’s On', pageHtml.includes('href="/whos-on"'));
    const old = await req(`/whos-on/${P}`), hid = await req(`/whos-on/${H}`), none = await req('/whos-on/999999');
    check('after the Wednesday (or if hidden), an old shared link goes to Who’s On instead of an error', [old, hid, none].every((r) => r.status === 302 && r.headers.get('location') === '/whos-on'));
    const list = await text('/whos-on');
    check('the Who’s On page itself is unchanged and still leaves out past dates', list.includes('Mary Medium') && !list.includes('Past Person') && !list.includes('Hidden Person'));
  }
} catch (err) {
  failed++;
  console.log('  FAIL the test run stopped: ' + (err && err.stack ? err.stack : err));
} finally {
  for (const s of servers) s.child.kill();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
