// Automated tests for gift vouchers bought on the public website, and for what each voucher covers when it is used:
// the Gift Vouchers page (conditions first, prices hidden until the purchaser's details are complete), the purchase
// through Square, the voucher made only after a confirmed payment (and only once), delivery by email (to the
// purchaser or straight to the recipient) with the printable A4 PDF, Gary's notifications, Admin's three travel-cover
// options (and changing an existing voucher without changing its code), and redemption for WhatsApp and Home Visits.
// Run with: npm test, or on its own: node tests/giftvouchers.test.mjs
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== '' ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
}
const PORT = 8995;
function start(port, extraEnv = {}) {
  const dbFile = path.join(root, 'dev', '.local', `giftv-${port}.sqlite`);
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
async function req(p, { jar, method = 'GET', body, headers = {}, origin } = {}) {
  const h = { ...headers };
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET' && origin !== null) h.Origin = base;
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
async function submit(jar, p, fields) {
  const fd = new FormData();
  const csrf = jar.c.nw_csrf || ((await text('/admin', { jar })).match(/name="_csrf" value="([^"]+)"/) || [])[1];
  fd.append('_csrf', csrf || '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return req(p, { jar, method: 'POST', body: fd });
}
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the hidden fields of the form posting to `action` (the first one, or the one containing `marker`)
function formFields(h, action, marker = '') {
  const forms = h.split('<form').slice(1).filter((f) => f.includes(`action="${action}"`) && (!marker || f.includes(marker)));
  if (!forms.length) return null;
  const f = forms[0].slice(0, forms[0].indexOf('</form>'));
  return Object.fromEntries([...f.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], unesc(m[2])]));
}

const servers = [];
try {
  const dev = await start(PORT, { HOME_VISITS: '1' }); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn('owner');
  const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
  const emails = async () => (await (await fetch(dev.mock + '/__emails')).json()).map((e) => ({ ...e, to: Array.isArray(e.to) ? e.to.join(',') : e.to, text: e.text || '', html: e.html || '' }));
  const sq = async () => (await fetch(dev.mock + '/__square/state')).json();
  const cron = () => fetch(base + '/__dev/cron?cron=' + encodeURIComponent('7 * * * *'));
  const sign = (body) => crypto.createHmac('sha256', 'local-webhook-signature-key').update(base + '/webhooks/square' + body).digest('base64');
  const webhook = (payment, eventId) => { const body = JSON.stringify({ event_id: eventId || 'ev-' + crypto.randomBytes(6).toString('hex'), type: 'payment.updated', data: { object: { payment } } });
    return req('/webhooks/square', { method: 'POST', origin: null, headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': sign(body) }, body }); };
  const form = (p, fields, ip = '10.20.0.1') => fetch(base + p, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, 'CF-Connecting-IP': ip }, body: new URLSearchParams(fields).toString() });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const noPrice = (h) => !/£\s?\d/.test(h) && !h.includes('4000') && !h.includes('6500');
  const HOME_HINTS = ['56.47', '-2.99', '2.990', '56.470'];
  const leaksHome = (h) => HOME_HINTS.some((x) => h.includes(x));
  db.prepare(`INSERT INTO settings (key, value) VALUES ('notification_email', 'gary@example.test') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  let day = addDays(today, 3); while (new Date(day + 'T12:00:00Z').getUTCDay() !== 0) day = addDays(day, 1);   // a Sunday
  const day2 = addDays(day, 7), day3 = addDays(day, 14);
  for (const d of [day, day2, day3]) {
    db.prepare(`DELETE FROM availability_dates WHERE date = ?`).run(d);
    db.prepare(`INSERT INTO availability_dates (date, mode, start_time, end_time) VALUES (?, 'hours', '10:00', '18:00')`).run(d);
  }
  // A voucher made before this update (only the columns that existed then), like Gary's charity-night voucher, and an
  // unrelated one: both must read as WhatsApp only and as made in Admin
  db.prepare(`INSERT INTO gift_vouchers (code, service_code, minutes, value_pence, expires_on, note, created_by, created_at) VALUES ('GV-CHAR-TYAB-CDEF', 'reading-60', 60, 6500, NULL, 'Charity Night', 'Gary', '2026-10-01T19:00:00.000Z')`).run();
  db.prepare(`INSERT INTO gift_vouchers (code, service_code, minutes, value_pence, expires_on, note, created_by, created_at) VALUES ('GV-ZTHE-RVXU-CHER', 'reading-30', 30, 4000, NULL, 'Raffle Prize', 'Gary', '2026-10-02T19:00:00.000Z')`).run();
  const charity0 = db.prepare(`SELECT * FROM gift_vouchers WHERE code = 'GV-CHAR-TYAB-CDEF'`).get();
  const other0 = db.prepare(`SELECT * FROM gift_vouchers WHERE code = 'GV-ZTHE-RVXU-CHER'`).get();
  const P = {};   // purchases by name

  console.log('\nThe Gift Vouchers page: conditions first, no prices');
  let page1;
  {
    const r = await req('/gift-vouchers');
    page1 = await r.text();
    check('the public Gift Vouchers page opens for ordinary visitors (no sign-in)', r.status === 200 && page1.includes('<h1 class="screen-title" tabindex="-1">Gift Vouchers</h1>'));
    check('it is in the website menu and the desktop navigation', page1.includes('href="/gift-vouchers" aria-current="page"') && (await text('/')).includes('href="/gift-vouchers"') && /site-top-nav[\s\S]*href="\/gift-vouchers"/.test(await text('/events')));
    check('8. no reading price anywhere on the page (or in its hidden fields)', noPrice(page1), (page1.match(/£\s?\d[^<]{0,20}/g) || []).join(' '));
    const w = page1.indexOf('WhatsApp Video Call</h3>'), hv = page1.indexOf('Home Visit (In Person)</h3>'), firstField = page1.indexOf('name="reading"'), nameField = page1.indexOf('name="name"');
    check('the WhatsApp Video Call condition is shown, word for word, BEFORE any choice or detail is asked for',
      w > 0 && w < firstField && w < nameField && page1.includes('Your gift voucher covers the full cost of the private reading. <strong>There are no additional travel charges.</strong>'));
    check('…and the Home Visit conditions: 60p per mile for the complete return journey, 20 driving miles one way, WhatsApp instead with no extra charge',
      hv > 0 && hv < firstField && page1.includes('Gift vouchers cover the reading itself. If the recipient chooses a Home Visit, <strong>an additional travel charge of 60p per mile applies to the complete return journey.</strong>') &&
      page1.includes('Home Visits are available only within <strong>20 driving miles one way</strong> of Gary’s home location.') && page1.includes('The recipient can choose a <strong>WhatsApp Video Call</strong> instead, with no additional charges.'));
    check('the purchaser must tick that they understand the conditions', page1.includes('name="conditions" value="1"') && page1.includes('I have read and understand the WhatsApp Video Call and Home Visit conditions above.'));
    check('30 and 60 minute readings to choose from, and the two delivery choices', page1.includes('30 minute private reading') && page1.includes('60 minute private reading') && page1.includes('Send the voucher to me') && page1.includes('Send it straight to the recipient'));
    check('nothing about Gary’s home location', !leaksHome(page1));
    check('NO personal message: no message box, no character allowance, no promise that a message is printed', !page1.includes('name="message"') && !page1.includes('<textarea') && !/personal (gift )?message/i.test(page1) && !page1.includes('300 characters') && !/your message/i.test(page1));
  }

  const stamp = page1.match(/name="t" value="([^"]+)"/)[1];
  const buyer = { t: stamp, website: '', conditions: '1', reading: 'reading-30', name: 'Pat Purchaser', email: 'pat@example.test', delivery: 'purchaser', recipient_name: 'Robin', recipient_email: '', message: 'Happy birthday, with love' };

  console.log('\nPurchase details: checked before any price is shown');
  {
    const r1 = await form('/gift-vouchers/review', { ...buyer, conditions: '' });
    const h1 = await r1.text();
    check('without ticking the conditions: refused, no price', r1.status === 422 && h1.includes('Please tick to confirm you have read the WhatsApp Video Call and Home Visit conditions.') && noPrice(h1));
    const r2 = await form('/gift-vouchers/review', { ...buyer, name: '', email: 'not-an-email' });
    const h2 = await r2.text();
    check('without a name or a real email address: refused, no price, what was typed is kept', r2.status === 422 && h2.includes('Please enter your full name.') && h2.includes('Please enter your full email address.') && noPrice(h2) && h2.includes('value="Robin"'));
    const r3 = await form('/gift-vouchers/review', { ...buyer, delivery: 'recipient', recipient_name: '', recipient_email: '' });
    const h3 = await r3.text();
    check('sending straight to the recipient needs their name and email address', r3.status === 422 && h3.includes('Please enter the recipient’s name') && h3.includes('Please enter the recipient’s full email address.') && noPrice(h3));
    const r4 = await form('/gift-vouchers/review', { ...buyer, reading: 'reading-999' });
    check('a reading that isn’t offered is refused', r4.status === 422 && (await r4.text()).includes('Please choose the 30 minute or 60 minute reading.'));
    const r5 = await form('/gift-vouchers/review', buyer);
    const h5 = await r5.text();
    check('8. only once every required detail is complete is the price shown: 30 minute reading £40.00, total £40.00', r5.status === 200 && h5.includes('<strong class="assistant-price">£40.00</strong>') && h5.includes('Total to pay') && h5.includes('Proceed to Secure Payment: £40.00'));
    check('…with the delivery, recipient, validity (12 months) and what it covers, and the conditions again (a message sent by a crafted request is ignored, not shown or carried forward)', h5.includes('Emailed to you at pat@example.test, ready to print') && !h5.includes('Happy birthday') && !h5.includes('name="message"') && h5.includes('(12 months)') &&
      h5.includes('a Home Visit (In Person) with a travel charge of 60p a mile for the return journey') && h5.includes('Travel conditions'));
    check('…and the purchaser must tick to agree the total before paying', h5.includes('name="agree" value="1"') && h5.includes('I agree to pay <strong>£40.00</strong>'));
    check('no mileage is added to the purchase (the total is the reading only)', !/travel charge[^<]*£\d/i.test(h5.slice(h5.indexOf('price-review'))));
    P.review30 = h5;
  }

  console.log('\nPaying with Square: the voucher is only made once the payment is confirmed');
  {
    await sleep(3200);
    const fields = { ...formFields(P.review30, '/gift-vouchers/buy'), website: '', 'cf-turnstile-response': TOKEN };
    const n0 = db.prepare('SELECT COUNT(*) AS n FROM voucher_purchases').get().n;
    const noAgree = await form('/gift-vouchers/buy', fields, '10.20.1.1');
    check('without agreeing the total: nothing is bought', noAgree.status === 422 && db.prepare('SELECT COUNT(*) AS n FROM voucher_purchases').get().n === n0);
    const tampered = await form('/gift-vouchers/buy', { ...fields, agree: '1', amount_pence: '1', price: '1', travel_cover: 'free_mileage' }, '10.20.1.2');
    const loc = tampered.headers.get('location') || '';
    P.a = db.prepare(`SELECT * FROM voucher_purchases WHERE purchaser_email = 'pat@example.test' ORDER BY id DESC`).get();
    const link = P.a && (await sq()).links.find((l) => l.orderId === P.a.square_order_id);
    check('1. a 30 minute voucher purchase is recorded (awaiting payment) and Square is asked for exactly £40.00 (anything else in the form is ignored)',
      tampered.status === 303 && /^\/gift-vouchers\/order\/NWV-[A-Z0-9]{6}\?key=/.test(loc) && P.a.status === 'pending' && P.a.amount_pence === 4000 && P.a.minutes === 30 && !!link && link.amount === 4000, [tampered.status, loc]);
    check('…and NO voucher exists yet (nothing can be redeemed before payment)', !P.a.voucher_id && db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers WHERE purchase_id = ?').get(P.a.id).n === 0);
    P.aLink = loc;
    const pend = await text(loc);
    check('the purchaser’s page offers Pay £40.00 securely with Square, and shows no code', pend.includes('Pay £40.00 securely with Square') && !/GV-[A-Z0-9]{4}-/.test(pend));
    check('the purchaser’s page needs its private key', (await req(loc.replace(/key=[^&]+/, 'key=wrong'))).status === 404);
    // pay
    const e0 = (await emails()).length;
    await fetch(`${dev.mock}/__square/pay/${P.a.square_payment_link_id}`);
    const done = await text(loc);
    P.a = db.prepare('SELECT * FROM voucher_purchases WHERE id = ?').get(P.a.id);
    const v = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(P.a.voucher_id);
    P.va = v;
    const expected12 = (() => { const [y, m, d] = today.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + 12, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; })();
    check('3. Square confirms the payment: the voucher is made, with a unique GV code, 30 minutes, £40.00, Available', P.a.status === 'paid' && !!v && /^GV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(v.code) && v.minutes === 30 && v.value_pence === 4000 && v.status === 'available');
    check('…recorded as bought online, covering WhatsApp or Home Visit with the mileage payable, valid 12 months', v.source === 'purchase' && v.purchase_id === P.a.id && v.travel_cover === 'mileage_payable' && v.expires_on === expected12, [v.source, v.travel_cover, v.expires_on, expected12]);
    check('…with its purchase in the voucher’s history', db.prepare('SELECT what FROM gift_voucher_log WHERE voucher_id = ?').all(v.id).some((l) => l.what.startsWith(`Bought online (${P.a.reference}) by Pat Purchaser`)));
    check('the purchaser’s page now shows the code, the expiry and the print-ready download', done.includes(v.code) && done.includes('Download or print the voucher (A4 PDF)') && done.includes(`/gift-vouchers/print/${P.a.print_key}`));
    const sent = (await emails()).slice(e0);
    const toPat = sent.filter((m) => m.to.includes('pat@example.test'));
    const toGary = sent.filter((m) => m.to.includes('gary@example.test'));
    check('5. the purchaser receives the voucher by email: the code, the print link, the reading, the expiry, what it covers and the receipt',
      toPat.length === 1 && toPat[0].subject === 'Your New Way’s gift voucher: 30 minute private reading' && toPat[0].text.includes(v.code) && toPat[0].text.includes(`${base}/gift-vouchers/print/${P.a.print_key}`) &&
      toPat[0].text.includes('Amount paid: £40.00') && toPat[0].text.includes(`Purchase reference: ${P.a.reference}`) && toPat[0].text.includes('60p per mile applies to the complete return journey'), toPat.map((m) => m.subject));
    check('19. Gary is notified of the sale: purchaser, duration, reference, amount, date, delivery and payment status',
      toGary.length === 1 && /^Gift voucher sold: 30 minute reading, £40\.00 \(NWV-/.test(toGary[0].subject) && toGary[0].text.includes('Purchaser: Pat Purchaser') && toGary[0].text.includes('Voucher: 30 minute private reading') &&
      toGary[0].text.includes(`Voucher code: ${v.code}`) && toGary[0].text.includes(`Purchase reference: ${P.a.reference}`) && toGary[0].text.includes('Amount paid: £40.00') && toGary[0].text.includes('Date of purchase: ') &&
      toGary[0].text.includes('Delivery: Emailed to the purchaser') && toGary[0].text.includes('Payment: Confirmed by Square'), toGary.map((m) => m.subject + ' ' + m.text.slice(0, 400)));
    check('…and nothing about Gary’s home in any email', !sent.some((m) => leaksHome(m.text + m.html)));
    // 22. the same payment reported again and again: the webhook (twice, with its retry), the return page, the hourly check
    const payment = (await (await fetch(`${dev.mock}/__square/pay/${P.a.square_payment_link_id}`)).json()).payment;
    const w1 = await webhook(payment, 'ev-same-1');
    const w2 = await webhook(payment, 'ev-same-1');
    const w3 = await webhook(payment, 'ev-other-2');
    await text(loc); await cron();
    check('22. webhook retries, the return page and the hourly check make no second voucher and send no second email', w1.status === 200 && w2.status === 200 && w3.status === 200 &&
      db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers WHERE purchase_id = ?').get(P.a.id).n === 1 && (await emails()).length === e0 + 2);
  }

  console.log('\nThe printable voucher (A4)');
  {
    const r = await req(`/gift-vouchers/print/${P.a.print_key}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const pdf = buf.toString('latin1');
    check('7. the voucher link opens a real PDF', r.status === 200 && r.headers.get('content-type') === 'application/pdf' && pdf.startsWith('%PDF-') && pdf.trimEnd().endsWith('%%EOF'));
    check('…one A4 landscape page (297 × 210 mm)', (pdf.match(/\/Type \/Page\b/g) || []).length === 1 && pdf.includes('/MediaBox [0 0 841.89 595.28]'));
    const hex = (t) => Buffer.from(t, 'latin1').toString('hex');
    check('…using the approved design picture, with the code, the expiry date and the QR link to the booking page', pdf.includes('/Subtype /Image') && pdf.includes(hex(P.va.code)) && pdf.includes(hex(P.va.expires_on.split('-').reverse().join('/'))) && pdf.includes('/private-readings'));
    check('…with who it is for and what it covers printed under the picture, and NO gift message', pdf.includes(hex('For Robin, from Pat Purchaser')) && !pdf.includes(hex('Happy birthday').slice(0, 20)) && pdf.includes(hex('Covers one 30 minute private reading by WhatsApp video call, or a Home Visit').slice(0, 40)));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-'));
    fs.writeFileSync(path.join(tmp, 'v.pdf'), buf);
    let pages = '';
    try { pages = execFileSync('pdfinfo', [path.join(tmp, 'v.pdf')], { encoding: 'utf8' }); } catch { pages = ''; }
    check('…which a PDF reader opens: 1 page, A4 (pdfinfo)', !pages || (/Pages:\s+1\b/.test(pages) && /Page size:\s+841\.89 x 595\.28 pts \(A4\)/.test(pages)), pages);
    try { execFileSync('pdftoppm', ['-png', '-r', '60', path.join(tmp, 'v.pdf'), path.join(root, 'dev', '.local', 'giftvoucher-print')]); } catch { /* the picture is only for looking at */ }
    check('a made-up print link is refused', (await req('/gift-vouchers/print/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status === 404);
  }

  console.log('\nAbandoned or failed payment: no voucher');
  {
    // 4a. a purchase whose card payment fails
    const rv = await (await form('/gift-vouchers/review', { ...buyer, email: 'fail@example.test', name: 'Fay Failed' }, '10.20.2.1')).text();
    await sleep(3200);
    const ok = await form('/gift-vouchers/buy', { ...formFields(rv, '/gift-vouchers/buy'), website: '', 'cf-turnstile-response': TOKEN, agree: '1' }, '10.20.2.2');
    const pf = db.prepare(`SELECT * FROM voucher_purchases WHERE purchaser_email = 'fail@example.test'`).get();
    await fetch(`${dev.mock}/__square/pay/${pf.square_payment_link_id}?status=FAILED`);
    const back = await text(ok.headers.get('location'));
    const pf2 = db.prepare('SELECT * FROM voucher_purchases WHERE id = ?').get(pf.id);
    check('4. a failed card payment: no voucher is made, and the purchaser can still pay', pf2.status === 'pending' && !pf2.voucher_id && db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers WHERE purchase_id = ?').get(pf.id).n === 0 && back.includes('Pay £40.00 securely with Square'));
    // 4b. a purchase abandoned on Square's page
    const rv2 = await (await form('/gift-vouchers/review', { ...buyer, reading: 'reading-60', email: 'gone@example.test', name: 'Gwen Gone' }, '10.20.2.3')).text();
    await sleep(3200);
    await form('/gift-vouchers/buy', { ...formFields(rv2, '/gift-vouchers/buy'), website: '', 'cf-turnstile-response': TOKEN, agree: '1' }, '10.20.2.4');
    const pg = db.prepare(`SELECT * FROM voucher_purchases WHERE purchaser_email = 'gone@example.test'`).get();
    db.prepare(`UPDATE voucher_purchases SET created_at = ? WHERE id IN (?, ?)`).run(new Date(Date.now() - 25 * 3600_000).toISOString(), pg.id, pf.id);
    const e0 = (await emails()).length;
    await cron();
    const pg2 = db.prepare('SELECT * FROM voucher_purchases WHERE id = ?').get(pg.id);
    const gone = (await sq()).links.find((l) => l.orderId === pg.square_order_id);
    check('4. a purchase never paid for is closed after a day (Square asked first, its payment page closed): no voucher, no email', pg2.status === 'expired' && !pg2.voucher_id && gone.deleted && (await emails()).length === e0 &&
      db.prepare(`SELECT COUNT(*) AS n FROM gift_vouchers WHERE purchase_id IN (?, ?)`).get(pg.id, pf.id).n === 0);
    check('…and Admin lists it as Not paid', (await text('/admin/readings/vouchers', { jar: g })).includes('NOT PAID (CLOSED)'));
  }

  console.log('\nSent straight to the recipient (option B), and an email that fails');
  {
    const rv = await (await form('/gift-vouchers/review', { ...buyer, reading: 'reading-60', name: 'Sam Sender', email: 'sam@example.test', delivery: 'recipient', recipient_name: 'Jane Recipient', recipient_email: 'jane@example.test', message: 'Enjoy your reading, Jane!' }, '10.20.3.1')).text();
    check('2. a 60 minute voucher: £65.00, to be emailed straight to Jane', rv.includes('<strong class="assistant-price">£65.00</strong>') && rv.includes('Emailed straight to Jane Recipient at jane@example.test'));
    await sleep(3200);
    const ok = await form('/gift-vouchers/buy', { ...formFields(rv, '/gift-vouchers/buy'), website: '', 'cf-turnstile-response': TOKEN, agree: '1' }, '10.20.3.2');
    P.b = db.prepare(`SELECT * FROM voucher_purchases WHERE purchaser_email = 'sam@example.test'`).get();
    check('2. …Square is asked for exactly £65.00', ok.status === 303 && (await sq()).links.find((l) => l.orderId === P.b.square_order_id).amount === 6500);
    const e0 = (await emails()).length;
    await fetch(`${dev.mock}/__emails/fail-next?count=3`);   // the email service is down when the payment arrives
    const payment = (await (await fetch(`${dev.mock}/__square/pay/${P.b.square_payment_link_id}`)).json()).payment;
    const wh = await webhook(payment);
    P.b = db.prepare('SELECT * FROM voucher_purchases WHERE id = ?').get(P.b.id);
    const vb = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(P.b.voucher_id);
    P.vb = vb;
    const failedRows = db.prepare(`SELECT kind, status FROM voucher_purchase_emails WHERE purchase_id = ?`).all(P.b.id);
    check('a temporary email failure does not lose anything: the payment is recorded and the 60 minute voucher made', wh.status === 200 && P.b.status === 'paid' && !!vb && vb.minutes === 60 && vb.value_pence === 6500 &&
      failedRows.filter((r) => r.status === 'failed').length === 3 && (await emails()).length === e0, failedRows);
    await cron();
    const sent = (await emails()).slice(e0);
    const toJane = sent.filter((m) => m.to.includes('jane@example.test'));
    const toSam = sent.filter((m) => m.to.includes('sam@example.test'));
    const toGary = sent.filter((m) => m.to.includes('gary@example.test'));
    check('…the hourly retry then sends each email once, with the SAME voucher (no duplicate made)', toJane.length === 1 && toSam.length === 1 && toGary.length === 1 && db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers WHERE purchase_id = ?').get(P.b.id).n === 1);
    check('6. the recipient receives the voucher addressed to them: from Sam, the code and the print link, and NO message',
      toJane[0].subject === 'A gift for you from Sam Sender: a private reading with New Way’s' && toJane[0].text.startsWith('Dear Jane Recipient,') && !toJane[0].text.includes('Enjoy your reading') && !/message:/i.test(toJane[0].text) &&
      toJane[0].text.includes(vb.code) && toJane[0].text.includes(`/gift-vouchers/print/${P.b.print_key}`) && !toJane[0].text.includes('£65.00'));
    check('…and the purchaser still receives the purchase confirmation and receipt', toSam[0].subject === `Your gift voucher purchase: ${P.b.reference}` && toSam[0].text.includes('Amount paid: £65.00') && toSam[0].text.includes('has been emailed to Jane Recipient at jane@example.test'));
    check('21. …and Gary’s notification says it was emailed straight to the recipient', toGary[0].text.includes('Delivery: Emailed straight to the recipient, Jane Recipient (jane@example.test)') && toGary[0].text.includes('Voucher: 60 minute private reading'));
    await cron();
    check('22. running the retry again sends nothing more', (await emails()).length === e0 + 3);
    const pdf = Buffer.from(await (await req(`/gift-vouchers/print/${P.b.print_key}`)).arrayBuffer()).toString('latin1');
    check('the recipient’s PDF is personalised (For Jane Recipient, from Sam Sender)', pdf.includes(Buffer.from('For Jane Recipient, from Sam Sender', 'latin1').toString('hex')));
  }

  console.log('\nAdmin: purchased and complimentary vouchers, three travel-cover options');
  {
    const list = await text('/admin/readings/vouchers', { jar: g });
    check('11. the list shows purchased and complimentary vouchers apart, with what each covers', list.includes('PURCHASED') && list.includes('ISSUED IN ADMIN') && list.includes('WHATSAPP OR HOME VISIT (MILEAGE PAYABLE)') && list.includes('WHATSAPP VIDEO CALL ONLY'));
    check('…and the website’s sales (paid and not paid)', list.includes('Gift voucher sales on the website') && list.includes(P.a.reference) && list.includes(P.b.reference));
    check('…search finds a voucher by purchaser, recipient or purchase reference', (await text('/admin/readings/vouchers?q=jane%20recipient', { jar: g })).includes(P.vb.code) && (await text(`/admin/readings/vouchers?q=${P.a.reference}`, { jar: g })).includes(P.va.code));
    check('…and filters to purchased only', !(await text('/admin/readings/vouchers?source=purchase', { jar: g })).includes('GV-CHAR-TYAB-CDEF'));
    const mk = (fields) => submit(g, '/admin/readings/vouchers', { service: 'reading-60', count: '1', expires_on: '', note: 'Charity Night 2', ...fields });
    const noChoice = await mk({});
    check('making a voucher requires choosing what it covers (Option 1, 2 or 3)', noChoice.status === 422 && (await noChoice.text()).includes('Please choose what the voucher covers'));
    const made = await mk({ travel_cover: 'free_mileage' });
    const fm = db.prepare(`SELECT * FROM gift_vouchers WHERE note = 'Charity Night 2'`).get();
    check('Option 3: a new charity voucher with FREE mileage, recorded in its history', made.status === 303 && fm.travel_cover === 'free_mileage' && fm.source === 'admin' && db.prepare('SELECT what FROM gift_voucher_log WHERE voucher_id = ?').get(fm.id).what.includes('Covers: WhatsApp or Home Visit (FREE mileage)'));
    P.free = fm;
    await mk({ travel_cover: 'mileage_payable', note: 'Option two' });
    await mk({ travel_cover: 'whatsapp_only', note: 'Option one', service: 'reading-30' });
    P.opt2 = db.prepare(`SELECT * FROM gift_vouchers WHERE note = 'Option two'`).get();
    P.opt1 = db.prepare(`SELECT * FROM gift_vouchers WHERE note = 'Option one'`).get();
    check('Options 1 and 2 are kept with their codes', P.opt2.travel_cover === 'mileage_payable' && P.opt1.travel_cover === 'whatsapp_only');
    const fmPdf = Buffer.from(await (await req(`/admin/readings/vouchers/${fm.id}.pdf`, { jar: g })).arrayBuffer()).toString('latin1');
    check('the printed voucher says what it covers (FREE travel)', fmPdf.includes(Buffer.from('or a Home Visit (In Person) with travel FREE', 'latin1').toString('hex')));
    // 12. the existing charity voucher: found in Admin and changed to FREE mileage, same code
    const c1 = db.prepare(`SELECT * FROM gift_vouchers WHERE code = 'GV-CHAR-TYAB-CDEF'`).get();
    check('vouchers made before this update keep their original terms: WhatsApp only, made in Admin', c1.travel_cover === 'whatsapp_only' && c1.source === 'admin');
    check('the charity voucher can be found in Admin by its code', (await text('/admin/readings/vouchers?q=GV-CHAR-TYAB-CDEF', { jar: g })).includes(`/admin/readings/vouchers/${c1.id}"`));
    const vp = await text(`/admin/readings/vouchers/${c1.id}`, { jar: g });
    check('its page shows what it covers and offers the three options to change it', vp.includes('Option 1: WhatsApp Video Call only') && vp.includes('Change what this voucher covers') && vp.includes('value="free_mileage"'));
    const ch = await submit(g, `/admin/readings/vouchers/${c1.id}/travel`, { travel_cover: 'free_mileage' });
    const c2 = db.prepare(`SELECT * FROM gift_vouchers WHERE id = ?`).get(c1.id);
    check('12. changed to WhatsApp or Home Visit, FREE mileage: the SAME code, still available, nothing else changed', ch.status === 303 && c2.code === 'GV-CHAR-TYAB-CDEF' && c2.travel_cover === 'free_mileage' && c2.status === 'available' &&
      Object.keys(charity0).every((k) => k === 'travel_cover' || c2[k] === charity0[k]));
    check('…and the change is recorded in its history (from, to, by whom)', db.prepare('SELECT what, done_by FROM gift_voucher_log WHERE voucher_id = ? ORDER BY id DESC').get(c1.id).what === 'Travel cover changed from “WhatsApp Video Call only” to “WhatsApp or Home Visit (FREE mileage)” (code unchanged)');
    const o2 = db.prepare(`SELECT * FROM gift_vouchers WHERE code = 'GV-ZTHE-RVXU-CHER'`).get();
    check('13. the unrelated earlier voucher is completely unchanged', Object.keys(other0).every((k) => o2[k] === other0[k]) && o2.travel_cover === 'whatsapp_only');
    check('customers (not signed in) cannot change what a voucher covers', (await req(`/admin/readings/vouchers/${c1.id}/travel`, { method: 'POST', body: new URLSearchParams({ travel_cover: 'free_mileage' }) })).status >= 400 &&
      (await req(`/admin/readings/vouchers/${o2.id}/travel`, { method: 'POST', body: new URLSearchParams({ travel_cover: 'free_mileage' }) })).status >= 400 && db.prepare(`SELECT travel_cover FROM gift_vouchers WHERE id = ?`).get(o2.id).travel_cover === 'whatsapp_only');
    // the purchased voucher's page: purchase, emails, resend
    const pp = await text(`/admin/readings/vouchers/${P.vb.id}`, { jar: g });
    check('a purchased voucher’s page shows the purchase, delivery, amount, Square payment and each email (no message stored or shown)', pp.includes('Bought online') && pp.includes(P.b.reference) && pp.includes('Emailed straight to the recipient, Jane Recipient') && !pp.includes('Enjoy your reading') && !pp.includes('Gift message') &&
      db.prepare(`SELECT COUNT(*) AS n FROM voucher_purchases WHERE message != ''`).get().n === 0 && pp.includes('£65.00') && pp.includes('Voucher email: jane@example.test (sent'));
    const e0 = (await emails()).length;
    const rs = await submit(g, `/admin/readings/vouchers/${P.vb.id}/resend`, {});
    const again = (await emails()).slice(e0);
    check('Gary can resend the voucher email: the same voucher and code, no new voucher', rs.status === 303 && again.length === 1 && again[0].to.includes('jane@example.test') && again[0].text.includes(P.vb.code) &&
      db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers WHERE purchase_id = ?').get(P.b.id).n === 1);
  }

  // ---------- redemption ----------
  const det = await text(`/private-readings/book/details?reading=reading-60&date=${day}&time=14:00`);
  const bstamp = det.match(/name="t" value="([^"]+)"/)[1];
  const who = (extra) => ({ t: bstamp, website: '', reading: 'reading-60', date: day, time: '14:00', name: 'Rita Redeemer', phone: '07700 900777', email: 'rita@example.test', method: 'whatsapp', ...extra });
  const home = (extra) => who({ method: 'home', house: '12', street: 'Example Street', town: 'Dundee', postcode: 'DD2 1AA', ...extra });
  // details → review → apply the voucher; returns the page with the voucher accepted (or refused)
  async function apply(values, code, ip) {
    const review = await (await form('/private-readings/book/details', values, ip + '1')).text();
    const vf = formFields(review, '/private-readings/book/voucher');
    if (!vf) return { review, page: review };
    const page = await (await form('/private-readings/book/voucher', { ...vf, code }, ip + '2')).text();
    return { review, page };
  }
  const confirm = async (pageHtml, ip) => form('/private-readings/book', { ...formFields(pageHtml, '/private-readings/book', 'voucher_token'), policy: '1', 'cf-turnstile-response': TOKEN, website: '' }, ip);

  console.log('\nRedeeming a bought voucher for a WhatsApp reading');
  {
    const { page } = await apply(who({ reading: 'reading-30', time: '11:00', date: day2 }), P.va.code, '10.20.4.');
    check('9. accepted for a WhatsApp reading: fully covered, nothing to pay, no Square', page.includes('Voucher Accepted. Your Private Reading Is Fully Covered. No Payment Required.') && page.includes('Confirm My Booking'));
    await sleep(3200);
    const e0 = (await emails()).length;
    const r = await confirm(page, '10.20.4.9');
    const order = db.prepare(`SELECT * FROM orders WHERE voucher_id = ?`).get(P.va.id);
    const bk = order && db.prepare('SELECT * FROM bookings WHERE order_id = ?').get(order.id);
    const v = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(P.va.id);
    check('9. …booked and confirmed, £0, and the voucher marked redeemed for this booking', r.status === 303 && order.status === 'paid' && order.payment_method === 'gift_voucher' && bk.status === 'confirmed' && bk.reading_method === 'whatsapp' && v.status === 'redeemed' && v.order_id === order.id);
    const sent = (await emails()).slice(e0);
    const cust = sent.find((m) => m.to.includes('rita@example.test'));
    const gary = sent.find((m) => m.to.includes('gary@example.test'));
    check('21. the customer gets the normal booking confirmation (covered by the voucher)', !!cust && cust.subject.startsWith('Your private reading is booked') && cust.text.includes('Your gift voucher has been accepted: your reading is fully covered'));
    check('20. Gary gets the booking notification: customer, contact, date and time, length, WhatsApp, voucher code, mileage not applicable, £0 extra, Confirmed',
      !!gary && gary.subject.includes('(gift voucher)') && gary.text.includes('Customer: Rita Redeemer') && gary.text.includes('Email: rita@example.test') && gary.text.includes('Mobile (WhatsApp): +447700900777') &&
      gary.text.includes('Length: 30 minutes') && gary.text.includes('How: WhatsApp video call') && gary.text.includes(`Voucher code: ${P.va.code}`) && gary.text.includes('Mileage: Not applicable (WhatsApp video call)') &&
      gary.text.includes('Additional payment collected: £0.00') && gary.text.includes('Booking status: Confirmed'), gary && gary.text);
    // 14. the same voucher again
    const again = await apply(who({ reading: 'reading-30', time: '15:00', date: day2, email: 'second@example.test' }), P.va.code, '10.20.5.');
    check('14. a voucher cannot be redeemed twice', again.page.includes('This voucher has already been used for a booking.') && db.prepare('SELECT COUNT(*) AS n FROM orders WHERE voucher_id = ?').get(P.va.id).n === 1);
    check('Admin shows how and when it was redeemed, and the appointment', (await text(`/admin/readings/vouchers/${P.va.id}`, { jar: g })).includes('WhatsApp video call') && (await text(`/admin/readings/vouchers/${P.va.id}`, { jar: g })).includes('Redeemed'));
  }

  console.log('\nA WhatsApp-only voucher is never silently used for a home visit');
  {
    const { page } = await apply(home({ reading: 'reading-30', time: '11:00', email: 'w1@example.test' }), P.opt1.code, '10.20.6.');
    check('refused with the reason (choose WhatsApp, or contact Gary), nothing held or booked', page.includes('This voucher covers a WhatsApp video call reading only, so it can’t be used for a home visit.') &&
      db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(P.opt1.id).status === 'available' && !db.prepare('SELECT 1 FROM orders WHERE voucher_id = ?').get(P.opt1.id));
  }

  console.log('\nA bought (standard) voucher for a Home Visit: only the travel charge is paid');
  {
    const { review, page } = await apply(home({ email: 'hv@example.test' }), P.vb.code, '10.20.7.');
    check('the review first shows the full price (no voucher yet), with the voucher box offered', review.includes('Have a Gift Voucher') && review.includes('<strong class="assistant-price">£86.60</strong>'));
    check('10. voucher accepted: the reading is covered, the travel charge (36 miles × 60p = £21.60) is shown before any payment', page.includes('Voucher Accepted. Your Private Reading Is Covered. Travel Charge to Pay: £21.60.') &&
      page.includes('<dd>Covered by your gift voucher</dd>') && page.includes('<strong class="assistant-price">£21.60</strong>') && page.includes('Proceed to Secure Payment: £21.60'));
    await sleep(3200);
    const r = await confirm(page, '10.20.7.9');
    const loc = r.headers.get('location') || '';
    const order = db.prepare(`SELECT * FROM orders WHERE voucher_id = ? ORDER BY id DESC`).get(P.vb.id);
    const bk = db.prepare('SELECT * FROM bookings WHERE order_id = ?').get(order.id);
    let v = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(P.vb.id);
    const link = (await sq()).links.find((l) => l.orderId === order.square_order_id);
    check('10. Square is asked for the travel charge only (£21.60), for a held home visit at the full address', r.status === 303 && order.status === 'pending' && order.payment_method === 'gift_voucher_travel' && order.amount_pence === 2160 && link.amount === 2160 &&
      bk.status === 'held' && bk.reading_method === 'home' && bk.visit_address === '12 Example Street, Dundee' && bk.travel_pence === 2160);
    check('15. while the travel charge is unpaid, the voucher is NOT used up (only kept for this booking)', v.status === 'reserved' && v.reserved_token === 'order:' + order.reference && !v.order_id && !v.redeemed_at);
    const other = await apply(who({ time: '11:00', email: 'thief@example.test' }), P.vb.code, '10.20.8.');
    check('16. …so nobody else can use it at the same time', other.page.includes('being used for a booking at this moment'));
    const op = await text(loc);
    check('the order page asks for £21.60 with Square', op.includes('Pay £21.60 securely with Square') && op.includes('Covered by your gift voucher'));
    const e0 = (await emails()).length;
    const payment = (await (await fetch(`${dev.mock}/__square/pay/${order.square_payment_link_id}`)).json()).payment;
    await webhook(payment, 'ev-hv-1'); await webhook(payment, 'ev-hv-1'); await webhook(payment, 'ev-hv-2'); await text(loc); await cron();
    const o2 = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    v = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(P.vb.id);
    check('10. paid: the booking is confirmed and only now is the voucher redeemed', o2.status === 'paid' && db.prepare('SELECT status FROM bookings WHERE id = ?').get(bk.id).status === 'confirmed' && v.status === 'redeemed' && v.order_id === order.id);
    const sent = (await emails()).slice(e0);
    const gary = sent.filter((m) => m.to.includes('gary@example.test'));
    const cust = sent.filter((m) => m.to.includes('hv@example.test'));
    check('22. webhook retries and the hourly check: one customer confirmation and one notification only', cust.length === 1 && gary.length === 1, sent.map((m) => m.to + ' ' + m.subject));
    check('20. Gary’s notification: HOME VISIT, full address, voucher code, mileage CHARGED £21.60, extra payment collected, Confirmed',
      gary[0].subject.includes('(gift voucher) (HOME VISIT)') && gary[0].text.includes('Home visit address: 12 Example Street, Dundee, DD2 1AA') && gary[0].text.includes(`Voucher code: ${P.vb.code}`) &&
      gary[0].text.includes('Mileage: Charged: £21.60 (36 miles at 60p), paid by Square') && gary[0].text.includes('Additional payment collected: £21.60') && gary[0].text.includes('Booking status: Confirmed'), gary[0] && gary[0].text);
    check('21. the customer’s confirmation: reading covered by the voucher, travel £21.60 paid, the address', cust[0].text.includes('Your gift voucher has been used for the reading, and your travel payment of £21.60 has been received.') && cust[0].text.includes('12 Example Street, Dundee, DD2 1AA') && !leaksHome(cust[0].text + cust[0].html));
    const ad = await text(`/admin/orders/${order.id}`, { jar: g });
    check('Admin’s booking page: voucher for the reading, travel charge paid by Square', ad.includes('for the reading, plus the travel charge by Square') && ad.includes('Travel charge paid') && ad.includes('£21.60') && ad.includes('Covered by the gift voucher'));
    const vpage = await text(`/admin/readings/vouchers/${P.vb.id}`, { jar: g });
    check('the voucher’s page shows the Home Visit and the travel payment', vpage.includes('Home Visit (In Person) at 12 Example Street, Dundee, DD2 1AA') && vpage.includes('Charged: £21.60 paid by Square'));
    P.hvOrder = order;
  }

  console.log('\nAn abandoned home-visit booking does not use up the voucher');
  {
    const { page } = await apply(home({ email: 'quit@example.test', date: day2, time: '14:00', postcode: 'DD4 4AA' }), P.opt2.code, '10.20.9.');
    check('Option 2 voucher: the travel charge (6 miles × 60p = £3.60) is payable', page.includes('Travel Charge to Pay: £3.60.'), (page.match(/<h2 class="card-title" id="voucher-ok">[^<]*/) || [''])[0]);
    await sleep(3200);
    await confirm(page, '10.20.9.9');
    const order = db.prepare(`SELECT * FROM orders WHERE voucher_id = ? ORDER BY id DESC`).get(P.opt2.id);
    check('…held, waiting for payment', order.status === 'pending' && db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(P.opt2.id).status === 'reserved');
    db.prepare(`UPDATE bookings SET hold_expires_at = ? WHERE order_id = ?`).run(new Date(Date.now() - 60_000).toISOString(), order.id);
    await cron();
    const v = db.prepare('SELECT * FROM gift_vouchers WHERE id = ?').get(P.opt2.id);
    check('15. the customer never paid: the hold runs out, the time is released and the voucher is available again (not consumed)', db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status === 'expired' &&
      v.status === 'available' && !v.order_id && !v.redeemed_at && !v.reserved_token);
    check('…and its history shows what happened', db.prepare('SELECT what FROM gift_voucher_log WHERE voucher_id = ? ORDER BY id DESC').all(P.opt2.id).some((l) => l.what.includes('kept for this booking, not used up')));
  }

  console.log('\nFree-mileage vouchers for a Home Visit: nothing to pay');
  {
    const { page } = await apply(home({ email: 'free@example.test', date: day3, time: '10:00' }), P.free.code, '10.20.10.');
    check('11. Admin’s FREE mileage voucher: reading AND travel covered, £0 to pay, no Square', page.includes('Voucher Accepted. Your Reading and Home Visit Travel Are Fully Covered. No Payment Required.') && page.includes('FREE with your voucher') &&
      page.includes('<strong class="assistant-price">£0.00</strong>') && page.includes('Confirm My Booking'));
    await sleep(3200);
    const linksBefore = (await sq()).links.length;
    const e0 = (await emails()).length;
    const r = await confirm(page, '10.20.10.9');
    const order = db.prepare(`SELECT * FROM orders WHERE voucher_id = ?`).get(P.free.id);
    const bk = db.prepare('SELECT * FROM bookings WHERE order_id = ?').get(order.id);
    check('11. …booked and confirmed at once, no Square payment page, voucher redeemed', r.status === 303 && order.status === 'paid' && order.payment_method === 'gift_voucher' && bk.status === 'confirmed' && bk.reading_method === 'home' &&
      (await sq()).links.length === linksBefore && db.prepare('SELECT status FROM gift_vouchers WHERE id = ?').get(P.free.id).status === 'redeemed');
    const slots = db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(bk.id).n;
    check('18. Gary’s journeys there and back are kept clear in the diary as for any home visit', slots === 7, slots);
    const gary = (await emails()).slice(e0).find((m) => m.to.includes('gary@example.test'));
    check('20. Gary’s notification says the mileage was WAIVED, with the voucher code and no extra payment', gary.text.includes('Mileage: Waived (free-mileage voucher): £21.60 not charged') && gary.text.includes(`Voucher code: ${P.free.code}`) && gary.text.includes('Additional payment collected: £0.00'));
    // 12. the updated charity voucher, same code, for a home visit
    const ch = await apply(home({ email: 'charity@example.test', date: day3, time: '14:00' }), 'gv-char-tyab-cdef', '10.20.11.');
    await sleep(3200);
    const cr = await confirm(ch.page, '10.20.11.9');
    const co = db.prepare(`SELECT o.* FROM orders o JOIN gift_vouchers v ON v.id = o.voucher_id WHERE v.code = 'GV-CHAR-TYAB-CDEF'`).get();
    check('12. the charity voucher (same code the recipient already has) books a Home Visit with £0 to pay', ch.page.includes('Travel Are Fully Covered') && cr.status === 303 && co && co.status === 'paid' && co.payment_method === 'gift_voucher', [cr.status, (ch.page.match(/role="alert">[^<]*|field-error[^<]*<|id="voucher-ok">[^<]*/g) || []).join(' | ')]);
  }

  console.log('\nAddress, the 20-mile area and diary conflicts still apply with a voucher');
  {
    const far = await (await form('/private-readings/book/details', home({ email: 'far@example.test', date: day2, time: '15:00', postcode: 'KY16 9AA' }), '10.20.12.1')).text();
    check('17. outside the 20-mile area: home visit refused before any voucher or payment step', !far.includes('/private-readings/book/voucher') && !far.includes('Total to pay') && /outside|20 miles/i.test(far), (far.match(/role="alert">[^<]*|<h2[^>]*>[^<]*/g) || []).join(' | '));
    const noHouse = await form('/private-readings/book/details', home({ email: 'nohouse@example.test', house: '', date: day2, time: '15:00' }), '10.20.12.2');
    check('17. the full address is required (house number or name)', noHouse.status === 422 && (await noHouse.text()).includes('Please enter your house or flat number'));
    // the free voucher home visit on day3 at 10am keeps Gary busy until after 12 noon: a voucher home visit at 12 noon clashes
    db.prepare(`INSERT INTO gift_vouchers (code, service_code, minutes, value_pence, note, created_by, travel_cover) VALUES ('GV-FREE-TWZA-BCDE', 'reading-60', 60, 6500, 'test', 'Gary', 'free_mileage')`).run();
    // the first time still offered for a 30 minute reading after that visit (free for a WhatsApp reading), but too soon for Gary to drive to another home
    const cal = await text(`/private-readings/book?reading=reading-30&date=${day3}`);
    const firstFree = [...cal.matchAll(/time=(\d\d%3A\d\d)/g)].map((m) => decodeURIComponent(m[1])).find((t) => t >= '11:00');
    const clash = await (await form('/private-readings/book/details', home({ email: 'clash@example.test', reading: 'reading-30', date: day3, time: firstFree }), '10.20.12.3')).text();
    check('18. a voucher home visit whose journey would overlap another booking is refused with the reason (before the voucher step)', !!firstFree && clash.includes('would overlap another booking') && !clash.includes('/private-readings/book/voucher'), firstFree);
  }

  console.log('\nTwo people using one voucher at the same moment');
  {
    db.prepare(`INSERT INTO gift_vouchers (code, service_code, minutes, value_pence, note, created_by, travel_cover) VALUES ('GV-RACE-RACE-RACE', 'reading-30', 30, 4000, 'race', 'Gary', 'free_mileage')`).run();
    const a = await apply(who({ reading: 'reading-30', date: day3, time: '17:00', email: 'ra@example.test' }), 'GV-RACE-RACE-RACE', '10.20.13.');
    // the second person enters it after the first person's hold is taken over (as if it lapsed)
    db.prepare(`UPDATE gift_vouchers SET reserved_until = ? WHERE code = 'GV-RACE-RACE-RACE'`).run(new Date(Date.now() - 1000).toISOString());
    const b = await apply(who({ reading: 'reading-30', date: day3, time: '17:30', email: 'rb@example.test' }), 'GV-RACE-RACE-RACE', '10.20.14.');
    await sleep(3200);
    const [ra, rb] = await Promise.all([confirm(a.page, '10.20.13.9'), confirm(b.page, '10.20.14.9')]);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM orders o JOIN gift_vouchers v ON v.id = o.voucher_id WHERE v.code = 'GV-RACE-RACE-RACE'`).get().n;
    check('16. simultaneous redemptions of one voucher: exactly one booking is made', a.page.includes('Voucher Accepted') && b.page.includes('Voucher Accepted') && n === 1 && [ra.status, rb.status].filter((s) => s === 303).length === 1, [ra.status, rb.status, n, ra.headers.get('location'), rb.headers.get('location')]);
    const slots = db.prepare(`SELECT slot_utc, COUNT(*) AS n FROM booking_slots GROUP BY slot_utc HAVING n > 1`).all();
    check('…and no two bookings share any half hour (no overlaps anywhere)', slots.length === 0);
  }

  console.log('\nPrivacy and nothing unrelated changed');
  {
    const pn = await text('/privacy');
    check('the Privacy Notice in the code describes gift voucher purchases (Admin offers it to Gary)', fs.readFileSync(path.join(root, 'src', 'lib', 'privacy-notice.js'), 'utf8').includes('# Gift vouchers') && pn.length > 0);
    check('nothing about Gary’s home anywhere in the gift voucher pages', !leaksHome(page1) && !leaksHome(await text(P.aLink)));
    check('the Private Readings page still hides prices', noPrice(await text('/private-readings')));
  }
} catch (err) {
  failed++;
  console.log('Test run stopped:', err && err.stack ? err.stack : err);
} finally {
  for (const s of servers) s.child.kill();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
