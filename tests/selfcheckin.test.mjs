// Automated tests for iPad self check-in at the entrance, Julie's live check-in screen and Import a paper list.
// Run with: npm test, or on its own: node tests/selfcheckin.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== '' ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
}
function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `selfcheckin-${port}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: `http://localhost:${port}` }, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('local test copy')) { clearTimeout(timer); resolve({ child, base: `http://localhost:${port}`, dbFile }); } });
    child.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  });
}
class Jar {
  constructor() { this.c = {}; }
  add(res) { for (const sc of res.headers.getSetCookie()) { const [p] = sc.split(';'); const i = p.indexOf('='); const v = p.slice(i + 1).trim(); if (v) this.c[p.slice(0, i).trim()] = v; else delete this.c[p.slice(0, i).trim()]; } }
  header() { return Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join('; '); }
}
let base = '';
async function req(p, { jar, method = 'GET', body, headers = {}, origin = true } = {}) {
  const h = { ...headers };
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET' && origin) h.Origin = base;
  const res = await fetch(base + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}
const text = async (p, o) => (await req(p, o)).text();
async function signIn(who) {
  const jar = new Jar();
  const login = await req('/admin/login', { jar });
  const auth = await (await fetch(login.headers.get('location'))).text();
  const cb = new URL(auth.match(new RegExp(`id="as-${who}" href="([^"]+)"`))[1].replace(/&amp;/g, '&'));
  await req(cb.pathname + cb.search, { jar });
  return jar;
}
async function post(jar, p, fields) {
  const page = await text('/admin/checkin', { jar });
  const csrf = (page.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const fd = new URLSearchParams({ _csrf: csrf, ...fields });
  return req(p, { jar, method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
}
// The iPad's own requests
const ipad = new Jar();
async function api(name, body, { jar = ipad, origin = true, type = 'application/json' } = {}) {
  const res = await req('/self-checkin/api/' + name, body === undefined ? { jar } : { jar, method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': type }, origin });
  let j = null;
  try { j = await res.json(); } catch { j = null; }
  return { status: res.status, ...(j || {}), setCookie: res.headers.get('set-cookie') || '' };
}

const EXPECTED_CHECKS = 154;
const servers = [];
try {
  const dev = await start(8915); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + n * 86400_000));
  const today = day(0);

  // ---------- test events and bookings (online, Admin cash/card, paid reservation, paper) ----------
  const ev = (name, date, extra = {}) => Number(db.prepare(`INSERT INTO events (name, date, visible, sales_mode, capacity, price_pence, start_time, legacy_places)
    VALUES (?, ?, 1, 'online', ?, 2500, '19:00', ?) RETURNING id`).get(name, date, extra.capacity ?? 60, extra.legacy ?? 0).id);
  let refN = 0;
  function booking(eventId, names, { status = 'confirmed', pay = 'paid', source = 'online', method = null, email = 'customer@example.test', phone = '07700900123', reservation = null } = {}) {
    const token = crypto.randomBytes(16).toString('base64url');
    const ref = 'EV-TEST' + String(++refN).padStart(2, '0');
    const b = db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, unit_price_pence, total_pence,
        purchaser_name, purchaser_email, purchaser_phone, checkin_token, square_payment_id, reservation_kind) VALUES (?, ?, ?, ?, ?, ?, ?, 2500, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .get(eventId, ref, source, status, method || (source === 'online' ? 'square_online' : 'cash'), pay, names.length, 2500 * names.length, names[0], email, phone, token,
        source === 'online' ? 'sqpay_' + ref : null, reservation);
    names.forEach((n, i) => db.prepare('INSERT INTO event_guests (booking_id, event_id, position, name) VALUES (?, ?, ?, ?)').run(b.id, eventId, i + 1, n));
    return { id: Number(b.id), ref, token, url: `${base}/c/${token}` };
  }
  const E = ev('Psychic Supper (test)', today, { legacy: 6 });
  const OTHER = ev('Charity Night (test)', day(1));
  const FUTURE = ev('Spring Supper (test)', day(92));
  const smiths = booking(E, ['Mary Smith', 'John Smith', 'Ann Smith', 'Bob Smith']);
  const six = booking(E, ['Kate One', 'Kate Two', 'Kate Three', 'Kate Four', 'Kate Five', 'Kate Six']);
  const linda1 = booking(E, ['Linda Brown', 'Sam Grey'], { source: 'admin', email: '' });
  const linda2 = booking(E, ['Linda Brown']);
  const accents = booking(E, ['Anne-Marie O’Neill', 'Zoë Ćwik']);
  const card = booking(E, ['Carol Card'], { source: 'admin', method: 'card', email: '' });
  const reserved = booking(E, ['Rhona Reserve', 'Ross Reserve'], { source: 'admin', method: 'cash', reservation: 'new' });
  const unpaid = booking(E, ['Pat Doyle'], { source: 'admin', pay: 'unpaid', email: '' });
  const cancelled = booking(E, ['Carl Gone'], { status: 'cancelled' });
  const elsewhere = booking(OTHER, ['Tom Other']);
  const spring = booking(FUTURE, ['Fiona Future', 'Frank Future']);
  const guestsOf = (b) => db.prepare('SELECT * FROM event_guests WHERE booking_id = ? ORDER BY position').all(b.id);
  const arrived = (ev = E) => db.prepare(`SELECT COUNT(*) AS n FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id WHERE g.event_id = ? AND b.status = 'confirmed' AND g.checked_in_at IS NOT NULL`).get(ev).n;
  const testIns = (ev = E) => db.prepare('SELECT COUNT(*) AS n FROM checkin_test_attendance WHERE event_id = ?').get(ev).n;
  const realSnapshot = () => JSON.stringify(db.prepare('SELECT id, checked_in_at, checked_in_by FROM event_guests ORDER BY id').all());
  const bookingsSnapshot = () => JSON.stringify(db.prepare('SELECT * FROM event_bookings ORDER BY id').all());

  const gary = await signIn('owner');
  let tabletId = 0;
  const ctl = (action, extra = {}, jar = gary) => post(jar, `/admin/checkin/tablets/${tabletId}/control`, { action, back: `/admin/checkin/${E}`, ...extra });
  const tabletRow = () => db.prepare('SELECT * FROM checkin_tablets WHERE id = ?').get(tabletId);

  console.log('\nSetting up the iPad (once)');
  {
    const page = await req('/self-checkin', { jar: ipad });
    const body = await page.text();
    check('an iPad that isn’t set up only sees the setup screen (no guest names, no event)', page.status === 200 && body.includes('Set up this iPad for self check-in') && !body.includes('Mary Smith') && !body.includes('Psychic Supper'));
    check('…and every check-in request is refused', (await api('state')).status === 401 && (await api('scan', { code: smiths.url })).status === 401 && (await api('find', { name: 'Mary Smith' })).status === 401);
    const list = await text('/admin/checkin/tablets', { jar: gary });
    check('Admin › Check in › iPad self check-in explains it and offers to set one up', list.includes('Set up an iPad') && list.includes('TEST MODE') && list.includes('any date'));
    const add = await post(gary, '/admin/checkin/tablets', { name: 'Entrance iPad' });
    const addHtml = await add.text();
    const code = (addHtml.match(/class="setup-digits"[^>]*>(\d{4}) (\d{4})</) || []).slice(1).join('');
    check('adding the iPad shows an 8-digit setup code and a QR code with the link', add.status === 200 && /^\d{8}$/.test(code) && addHtml.includes('<svg') && addHtml.includes('/self-checkin'));
    check('only a scrambled form of the code is stored', !JSON.stringify(db.prepare('SELECT * FROM checkin_tablets').all()).includes(code));
    const wrong = await req('/self-checkin/connect', { jar: ipad, method: 'POST', body: new URLSearchParams({ code: code === '12345678' ? '87654321' : '12345678' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    check('a wrong code is refused', wrong.status === 422 && !ipad.c.nw_tablet);
    const noOrigin = await req('/self-checkin/connect', { jar: ipad, method: 'POST', origin: false, body: new URLSearchParams({ code }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    check('a setup request from another website is refused', noOrigin.status === 403 && !ipad.c.nw_tablet);
    const ok = await req('/self-checkin/connect', { jar: ipad, method: 'POST', body: new URLSearchParams({ code: code.slice(0, 4) + ' ' + code.slice(4) }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const sc = ok.headers.get('set-cookie') || '';
    check('the right code (with or without the space) sets up the iPad', ok.status === 303 && ok.headers.get('location') === '/self-checkin' && !!ipad.c.nw_tablet);
    check('…its key is private to the check-in screens (HttpOnly, only sent to /self-checkin, kept 60 days, renewed while in use)', /HttpOnly/.test(sc) && /Path=\/self-checkin/.test(sc) && /Max-Age=5184000/.test(sc) && /SameSite=Lax/.test(sc));
    const again = new Jar();
    const reuse = await req('/self-checkin/connect', { jar: again, method: 'POST', body: new URLSearchParams({ code }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    check('the code can’t be used a second time', reuse.status === 422 && !again.c.nw_tablet);
    const t = db.prepare('SELECT * FROM checkin_tablets').get();
    tabletId = t.id;
    check('stored: a scrambled key only, the code is cleared', t.token_hash && t.token_hash !== ipad.c.nw_tablet && !t.pair_code_hash && t.paired_at);
    check('a new iPad starts closed, in TEST MODE, with no event', t.state === 'closed' && t.mode === 'test' && !t.event_id);
    const expired = await post(gary, '/admin/checkin/tablets', { name: 'Spare iPad' });
    const code2 = ((await expired.text()).match(/class="setup-digits"[^>]*>(\d{4}) (\d{4})</) || []).slice(1).join('');
    db.prepare(`UPDATE checkin_tablets SET pair_expires_at = '2000-01-01T00:00:00Z' WHERE name = 'Spare iPad'`).run();
    const late = await req('/self-checkin/connect', { jar: new Jar(), method: 'POST', body: new URLSearchParams({ code: code2 }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    check('a code older than 15 minutes no longer works', late.status === 422);
  }

  console.log('\nThe check-in screens, and Admin in control');
  {
    const page = await req('/self-checkin', { jar: ipad });
    const body = await page.text();
    check('the iPad shows the check-in screens: Scan QR Code, Enter Your Name, and the Closed and Paused screens', body.includes('Scan QR Code') && body.includes('Enter Your Name') && body.includes('Check-In Closed.') && body.includes('Check-In Temporarily Paused.') && body.includes('Please See Julie.') && body.includes('/js/vendor/jsqr-1.4.0.js'));
    check('the page itself holds no guest names', !/Mary Smith|Linda Brown|Pat Doyle/.test(body));
    check('the front camera is allowed on these screens only', (page.headers.get('permissions-policy') || '').includes('camera=(self)') && ((await req('/')).headers.get('permissions-policy') || '').includes('camera=()'));
    check('never stored by the browser and kept out of search engines', page.headers.get('cache-control') === 'no-store' && /noindex/.test(page.headers.get('x-robots-tag') || '') && (await text('/robots.txt')).includes('Disallow: /self-checkin'));
    check('the website app helper never stores these screens', fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8').includes("url.pathname.startsWith('/self-checkin/')) return;"));
    const st0 = await api('state');
    check('with no event chosen, check-in is closed (and the staff note says how to choose one)', st0.state === 'no_event' && st0.open === false && /Choose one in Admin/.test(st0.staffNote));
    check('…nothing can be looked up', (await api('find', { name: 'Mary Smith' })).result === 'closed');
    const use = await ctl('use', { event_id: String(E) });
    const st1 = await api('state');
    check('Admin chooses the event: the iPad shows it, closed and in TEST MODE until check-in is started', use.status === 303 && st1.state === 'closed' && st1.mode === 'test' && st1.event.name === 'Psychic Supper (test)');
    check('…and while closed nothing can be checked in', (await api('scan', { code: smiths.url })).result === 'closed' && (await api('checkin', { name: 'Sam Grey' })).result === 'closed' && arrived() === 0);
    const noTick = await ctl('live');
    check('starting LIVE without ticking the confirmation is refused (sent to the confirmation page)', noTick.status === 303 && /\/live\?back=/.test(noTick.headers.get('location')) && tabletRow().state === 'closed');
    const confirmPage = await text(`/admin/checkin/tablets/${tabletId}/live?back=${encodeURIComponent(`/admin/checkin/${E}`)}`, { jar: gary });
    check('the LIVE confirmation page explains it and needs a tick', confirmPage.includes('guests’ check-ins will be real attendance') && confirmPage.includes('name="confirm" value="yes" required'));
    const live = await ctl('live', { confirm: 'yes' });
    const st2 = await api('state');
    check('with the tick, LIVE check-in starts: the iPad is open in LIVE mode', live.status === 303 && st2.state === 'active' && st2.open && st2.mode === 'live');
    check('…and it is in the activity log', db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'selfcheckin.live'`).get().n === 1);
  }

  console.log('\nScan QR Code: a group of four, two arriving first (LIVE)');
  {
    const r = await api('scan', { code: smiths.url });
    check('the booking’s four guests are shown', r.result === 'booking' && r.guests.map((g) => g.name).join(',') === 'Mary Smith,John Smith,Ann Smith,Bob Smith' && r.guests.every((g) => !g.in));
    const raw = JSON.stringify(r);
    check('…names only: no email, phone, reference, payment or amount', !/@|07700|EV-TEST|2500|£|paid|square/i.test(raw) && Object.keys(r.guests[0]).sort().join(',') === 'at,id,in,name');
    const [mary, john, ann, bob] = guestsOf(smiths);
    const done = await api('checkin', { code: smiths.url, guests: [mary.id, john.id] });
    check('Mary and John check in; Ann and Bob don’t', done.result === 'done' && done.guests.length === 2 && done.guests.every((g) => g.result === 'in') && arrived() === 2 && !guestsOf(smiths)[2].checked_in_at);
    check('recorded in the real attendance, as checked in on the iPad', guestsOf(smiths)[0].checked_in_by === 'iPad self check-in' && testIns() === 0);
    const again = await api('scan', { code: smiths.url });
    check('a repeat scan shows Mary and John as already checked in, with the time', again.guests[0].in && again.guests[1].in && /\d(am|pm)$/.test(again.guests[0].at) && !again.guests[2].in);
    const twice = await api('checkin', { code: smiths.url, guests: [mary.id] });
    check('checking Mary in again isn’t counted twice', twice.guests[0].result === 'already' && arrived() === 2);
    const foreign = await api('checkin', { code: smiths.url, guests: [guestsOf(linda2)[0].id] });
    check('a guest from a different booking can’t be checked in with this QR code', foreign.status === 400 && !guestsOf(linda2)[0].checked_in_at);
    const later = await api('checkin', { code: `${base}/c/${smiths.token}?from=email`, guests: [ann.id] });
    check('Ann arrives later and checks in with the same QR code', later.guests[0].result === 'in' && arrived() === 3);
    const bobName = await api('checkin', { name: 'Bob Smith' });
    check('Bob arrives last and checks in by typing his own name', bobName.guests[0].result === 'in' && arrived() === 4);
    const all = await api('scan', { code: smiths.token });
    check('once everyone is in, the QR code shows they are all checked in', all.guests.every((g) => g.in));
  }

  console.log('\nA booking of six: three arrive, the others later');
  {
    const r = await api('scan', { code: six.url });
    check('the iPad shows the six individual guests on that booking', r.guests.length === 6 && r.guests.map((g) => g.name).join(',') === 'Kate One,Kate Two,Kate Three,Kate Four,Kate Five,Kate Six');
    const g = guestsOf(six);
    await api('checkin', { code: six.url, guests: [g[0].id, g[2].id, g[4].id] });
    check('three check in; the other three stay outstanding', guestsOf(six).filter((x) => x.checked_in_at).length === 3 && !guestsOf(six)[1].checked_in_at);
    check('Kate Two checks in later by her own name', (await api('checkin', { name: 'kate two' })).guests[0].result === 'in' && guestsOf(six).filter((x) => x.checked_in_at).length === 4);
  }

  console.log('\nEnter Your Name');
  {
    check('a first name alone asks for the full name', (await api('find', { name: 'Sam' })).result === 'full_name');
    const sam = await api('find', { name: '  sam   GREY ' });
    check('one guest with that full name is found (any capitals or extra spaces)', sam.result === 'one' && sam.guest.name === 'Sam Grey' && !sam.guest.in);
    check('…only the name and whether they have arrived are sent', Object.keys(sam.guest).sort().join(',') === 'at,id,in,name' && !/@|07700|EV-|2500/.test(JSON.stringify(sam)));
    check('looking someone up doesn’t check them in', !guestsOf(linda1)[1].checked_in_at);
    const in1 = await api('checkin', { name: 'Sam Grey' });
    check('Sam checks in on his own; Linda Brown on the same booking does not', in1.result === 'done' && in1.guests[0].result === 'in' && guestsOf(linda1)[1].checked_in_at && !guestsOf(linda1)[0].checked_in_at);
    check('Sam can’t be checked in twice', (await api('checkin', { name: 'Sam Grey' })).guests[0].result === 'already');
    const back = await api('find', { name: 'Sam Grey' });
    check('looking him up again says he’s already checked in, with the time', back.result === 'one' && back.guest.in && /\d(am|pm)$/.test(back.guest.at));
    check('accents, apostrophes and hyphens don’t matter (anne marie oneill = Anne-Marie O’Neill)', (await api('find', { name: 'anne marie oneill' })).guest?.name === 'Anne-Marie O’Neill');
    check('…nor letters with accents (zoe cwik = Zoë Ćwik)', (await api('find', { name: 'Zoe Cwik' })).result === 'one');
    check('part of a name never matches', (await api('find', { name: 'Mary Smit' })).result === 'not_found');
    check('a surname alone never matches', (await api('find', { name: 'Smith' })).result === 'full_name');
    check('a card booking made in Admin checks in by name', (await api('checkin', { name: 'Carol Card' })).guests[0].result === 'in');
    const res = await api('scan', { code: reserved.url });
    check('a paid reservation shows both guests and checks in', res.guests.length === 2 && (await api('checkin', { code: reserved.url, guests: [res.guests[0].id] })).guests[0].result === 'in');
  }

  console.log('\nTwo guests with exactly the same name');
  {
    const r = await api('find', { name: 'linda brown' });
    check('“Linda Brown” is on two bookings: the iPad sends her to Julie', r.result === 'same_name' && !r.guest);
    check('…also with different capitals and extra spaces', (await api('find', { name: '  LINDA   brown ' })).result === 'same_name');
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'selfcheckin.js'), 'utf8');
    check('…with exactly the agreed words', js.includes('We have found more than one guest with this name. Please see Julie for assistance with your check-in.'));
    const c = await api('checkin', { name: 'Linda Brown' });
    check('…and neither Linda is checked in, even if the iPad asks', c.result === 'same_name' && !guestsOf(linda1)[0].checked_in_at && !guestsOf(linda2)[0].checked_in_at);
    const h = db.prepare(`SELECT * FROM checkin_help WHERE kind = 'same_name'`).all();
    check('Julie is told (Needs Julie), with the name typed', h.length === 2 && h[0].typed_name === 'linda brown' && !h[0].resolved_at && h[0].test === 0);
    check('different guests on the same booking (the Smiths, the six Kates) never count as the same name', !db.prepare(`SELECT 1 FROM checkin_help WHERE typed_name LIKE '%smith%' OR typed_name LIKE '%kate%'`).get());
    const qr = await api('scan', { code: linda2.url });
    check('her QR code still finds exactly her booking', qr.result === 'booking' && qr.guests.length === 1 && qr.guests[0].name === 'Linda Brown' && qr.guests[0].id === guestsOf(linda2)[0].id);
  }

  console.log('\nNames not on the list, bookings for Julie, other events');
  {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE kind = 'not_found'`).get().n;
    const nf = await api('find', { name: 'Nobody Here' });
    check('an unknown name: not found, and Julie is told (with the name typed)', nf.result === 'not_found' && db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE kind = 'not_found'`).get().n === before + 1);
    const typo = await api('find', { name: 'Zoe Cwick' });
    const fixed = await api('checkin', { name: 'Zoë Ćwik' });
    check('after a spelling mistake, finding the right name clears the “not found” notes from this iPad', typo.result === 'not_found' && fixed.guests[0].result === 'in' &&
      db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE kind = 'not_found' AND resolved_at IS NULL`).get().n === 0);
    const pay = await api('scan', { code: unpaid.url });
    const payName = await api('find', { name: 'Pat Doyle' });
    const payTry = await api('checkin', { name: 'Pat Doyle' });
    check('a booking with something to pay at the door is sent to Julie (QR code and name), never checked in', pay.result === 'see_julie' && payName.result === 'see_julie' && payTry.result === 'see_julie' && !guestsOf(unpaid)[0].checked_in_at);
    check('…and the iPad says nothing about payment', !/pay|£|owe/i.test(JSON.stringify([pay, payName])));
    check('a cancelled booking is sent to Julie, never checked in', (await api('scan', { code: cancelled.url })).result === 'see_julie' && (await api('checkin', { code: cancelled.url, guests: [guestsOf(cancelled)[0].id] })).result === 'see_julie' && !guestsOf(cancelled)[0].checked_in_at);
    check('a cancelled guest’s name isn’t found', (await api('find', { name: 'Carl Gone' })).result === 'not_found');
    check('a QR code for a different event is refused and sent to Julie', (await api('scan', { code: elsewhere.url })).result === 'other_event' && (await api('checkin', { code: elsewhere.url, guests: [guestsOf(elsewhere)[0].id] })).result === 'other_event' && !guestsOf(elsewhere)[0].checked_in_at);
    check('…a guest of a different event isn’t found by name', (await api('find', { name: 'Tom Other' })).result === 'not_found');
    check('any other QR code (a website, Wi-Fi details) isn’t a booking', (await api('scan', { code: 'https://example.com/hello' })).result === 'unknown' && (await api('scan', { code: 'WIFI:S:x;;' })).result === 'unknown');
    check('a made-up booking code is refused and Julie is told', (await api('scan', { code: `${base}/c/${'A'.repeat(22)}` })).result === 'unknown' && db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE kind = 'unknown_qr'`).get().n === 1);
  }

  console.log('\nNobody is ever counted twice');
  {
    const g = guestsOf(linda2)[0];
    const many = await Promise.all(Array.from({ length: 6 }, () => api('checkin', { code: linda2.url, guests: [g.id] })));
    check('six check-ins for the same guest at the same moment: exactly one counts', many.filter((r) => r.guests && r.guests[0].result === 'in').length === 1 && many.every((r) => r.result === 'done'));
    const b2 = booking(E, ['Rita Race']);
    const rg = guestsOf(b2)[0];
    const both = await Promise.all([api('checkin', { name: 'Rita Race' }), post(gary, `/admin/checkin/${E}/guest/${rg.id}`, { back: `/admin/checkin/${E}` })]);
    check('the iPad and Julie’s phone at the same moment: counted once', db.prepare('SELECT COUNT(*) AS n FROM event_guests WHERE id = ? AND checked_in_at IS NOT NULL').get(rg.id).n === 1 && both[0].result === 'done');
    const retry = await api('checkin', { name: 'Rita Race' });
    check('a repeat of a check-in that already went through (as after a dropped connection) is answered “already”, never a second record', retry.guests[0].result === 'already' && arrived() === db.prepare(`SELECT COUNT(*) AS n FROM event_guests WHERE checked_in_at IS NOT NULL AND event_id = ?`).get(E).n);
  }

  console.log('\nJulie’s check-in screen (live)');
  db.prepare(`INSERT INTO checkin_helpers (email, name) VALUES ('julie.helper@example.test', 'Julie')`).run();
  const julie = await signIn('julie');
  {
    const page = await text(`/admin/checkin/${E}`, { jar: julie });
    const expected = db.prepare(`SELECT COUNT(*) AS n FROM event_guests g JOIN event_bookings b ON b.id = g.booking_id WHERE g.event_id = ? AND b.status = 'confirmed'`).get(E).n;
    check('Julie (a check-in helper) sees expected, checked in (arrived) and outstanding', page.includes(`<strong data-k="booked">${expected}</strong> expected`) && page.includes(`<strong data-k="arrived">${arrived()}</strong> arrived`) && page.includes(`${expected - arrived()}</strong> outstanding`));
    check('…plus the places allocated before the website that aren’t on the guest list', page.includes('Plus 6 places allocated before the website'));
    check('Needs Julie lists what the iPad sent her: the duplicate name, the unpaid booking, the other event', page.includes('Needs Julie (') && page.includes('Typed: “linda brown”') && page.includes('Booking needs you') && page.includes('Ticket for a different event'));
    check('Same name lists both Linda Browns with their bookings, so she can tell them apart', page.includes('Same name (1)') && (page.match(/<span class="guest-name">Linda Brown<\/span>/g) || []).length >= 2 && page.includes(linda1.ref) && page.includes(linda2.ref));
    check('Groups partly arrived lists the six Kates (4 of 6) and who is still to come', page.includes('Groups partly arrived') && page.includes('4 of 6 arrived') && page.includes('Still to come: Kate Four, Kate Six'));
    check('the iPad’s check-ins are marked “iPad”, and Just arrived shows recent activity', page.includes('<span class="chip">iPad</span>') && page.includes('Just arrived') && page.includes('on the iPad'));
    check('the iPad panel: online, LIVE MODE, Open, operational, with Pause and Close', page.includes('Entrance iPad') && page.includes('chip-online') && page.includes('LIVE MODE') && page.includes('chip-state-active') && page.includes('operational') && page.includes('value="pause"') && page.includes('value="close"'));
    check('Julie’s screen loads the QR reader for iPhone too (jsQR) and the live updates', page.includes('/js/vendor/jsqr-1.4.0.js?v=') && page.includes(`data-live-url="/admin/checkin/${E}/live"`));
    const l1 = await (await req(`/admin/checkin/${E}/live`, { jar: julie })).json();
    await api('checkin', { name: 'Anne-Marie O’Neill' });
    const l2 = await (await req(`/admin/checkin/${E}/live`, { jar: julie })).json();
    check('a check-in on the iPad changes Julie’s live figures straight away', l2.arrived === l1.arrived + 1 && l2.waiting === l1.waiting - 1 && l2.stamp !== l1.stamp && l2.booked === expected);
    check('the live figures need Julie or Gary to be signed in', (await req(`/admin/checkin/${E}/live`)).status === 401);
    const linda = guestsOf(linda1)[0];
    const man = await post(julie, `/admin/checkin/${E}/guest/${linda.id}`, { back: `/admin/checkin/${E}` });
    check('Julie checks in the right Linda Brown by hand', man.status === 303 && guestsOf(linda1)[0].checked_in_by === 'Julie' && !guestsOf(linda2)[0].checked_in_at === false);
    const help = db.prepare(`SELECT id FROM checkin_help WHERE kind = 'same_name' ORDER BY id`).all();
    for (const h of help) await post(julie, `/admin/checkin/${E}/help/${h.id}/done`, { back: `/admin/checkin/${E}` });
    const l3 = await (await req(`/admin/checkin/${E}/live`, { jar: julie })).json();
    check('…and marks the iPad’s notes Done: they leave Needs Julie', db.prepare(`SELECT resolved_by FROM checkin_help WHERE id = ?`).get(help[0].id).resolved_by === 'Julie' && l3.help === l2.help - help.length && !(await text(`/admin/checkin/${E}`, { jar: julie })).includes('Typed: “linda brown”'));
    const mary = guestsOf(smiths)[0];
    const undo = await post(julie, `/admin/checkin/${E}/guest/${mary.id}/undo`, { back: `/admin/checkin/${E}` });
    check('Julie corrects a mistake (Undo): the guest is no longer counted', undo.status === 303 && !guestsOf(smiths)[0].checked_in_at && (await (await req(`/admin/checkin/${E}/live`, { jar: julie })).json()).arrived === l3.arrived - 1);
    check('…and the iPad then lets Mary check in again', (await api('checkin', { name: 'Mary Smith' })).guests[0].result === 'in');
    const search = await text(`/admin/checkin/${E}?q=${linda1.ref}&view=all`, { jar: julie });
    check('Julie can search by booking reference', search.includes('Sam Grey') && search.includes('Linda Brown') && !search.includes('Bob Smith'));
    check('Julie can control the iPad, but can’t open the rest of Admin', (await req('/admin/checkin/tablets', { jar: julie })).status === 200 && (await req('/admin/events', { jar: julie })).status === 403);
  }

  console.log('\nPause, resume, close, disconnect and reconnect (from Admin)');
  {
    const before = realSnapshot();
    const p = await ctl('pause', {}, julie);
    const st = await api('state');
    check('Julie pauses check-in: the iPad shows Paused at once (next check, within 5 seconds)', p.status === 303 && p.headers.get('location').includes('ipad=paused') && st.state === 'paused' && !st.open);
    check('…and refuses every look-up and check-in while paused', (await api('find', { name: 'Ann Smith' })).result === 'paused' && (await api('scan', { code: smiths.url })).result === 'paused' && (await api('checkin', { name: 'Kate Six' })).result === 'paused' && !guestsOf(six)[5].checked_in_at);
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'selfcheckin.js'), 'utf8');
    check('the iPad checks with Admin every 5 seconds while open or paused', js.includes("session.state === 'active' || session.state === 'paused' ? 5000 : 15000"));
    const r = await ctl('resume', {}, julie);
    check('Resume: open again, still LIVE', r.status === 303 && (await api('state')).state === 'active' && (await api('state')).mode === 'live');
    const c = await ctl('close', {}, julie);
    const stc = await api('state');
    check('Close: the iPad shows “Check-In Closed”, and nothing can be checked in', c.status === 303 && stc.state === 'closed' && (await api('checkin', { name: 'Kate Six' })).result === 'closed');
    check('closing deleted nothing: every booking and every attendance record is unchanged', realSnapshot() === before && db.prepare('SELECT COUNT(*) AS n FROM event_bookings').get().n === refN + 0);
    const resumeClosed = await ctl('resume', {}, julie);
    check('Resume doesn’t reopen a closed iPad (it must be started again on purpose)', resumeClosed.status === 303 && tabletRow().state === 'closed');
    const d = await ctl('disconnect', {}, julie);
    const std = await api('state');
    check('Disconnect: the iPad stays set up (its key still works) but shows Closed and takes no check-ins', d.status === 303 && std.status === 200 && std.state === 'disconnected' && (await api('find', { name: 'Kate Six' })).result === 'closed');
    const page = await text(`/admin/checkin/${E}`, { jar: julie });
    check('Julie’s screen shows it as Disconnected with a Reconnect button', page.includes('chip-state-disconnected') && page.includes('value="reconnect"'));
    await ctl('reconnect', {}, julie);
    check('Reconnect: no new setup code needed; it is ready (closed) until started', (await api('state')).state === 'closed' && tabletRow().token_hash);
    await ctl('live', { confirm: 'yes' }, julie);
    check('…and LIVE check-in can be started again (with the tick)', (await api('state')).state === 'active' && (await api('checkin', { name: 'Kate Six' })).guests[0].result === 'in');
    check('every change was recorded in the activity log', ['pause', 'resume', 'close', 'disconnect', 'reconnect'].every((a) => db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get('selfcheckin.' + a).n >= 1));
  }

  console.log('\nTest Mode (any event, kept apart from real attendance)');
  {
    const realBefore = realSnapshot();
    const bookBefore = bookingsSnapshot();
    const sw = await ctl('test', {}, julie);
    const st = await api('state');
    check('switching LIVE → TEST needs no tick, and the iPad shows TEST MODE', sw.status === 303 && st.mode === 'test' && st.state === 'active');
    const t1 = await api('checkin', { name: 'Ann Smith' });
    check('in TEST MODE, a guest already checked in for real can practise checking in', t1.guests[0].result === 'in' && testIns() === 1);
    const qr = await api('scan', { code: smiths.url });
    check('a scan in TEST MODE shows practice check-ins only (not the real ones)', qr.guests.filter((g) => g.in).map((g) => g.name).join() === 'Ann Smith');
    await api('checkin', { code: smiths.url, guests: [qr.guests[0].id, qr.guests[1].id] });
    check('group test check-in: only the guests chosen', testIns() === 3);
    check('…repeat test check-ins aren’t counted twice', (await api('checkin', { name: 'Ann Smith' })).guests[0].result === 'already' && testIns() === 3);
    check('…identical names still go to Julie in TEST MODE', (await api('find', { name: 'linda brown' })).result === 'same_name' && db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE test = 1 AND kind = 'same_name'`).get().n === 1);
    check('…unknown names too', (await api('find', { name: 'Nobody Known' })).result === 'not_found');
    check('REAL attendance and bookings were not changed at all by Test Mode', realSnapshot() === realBefore && bookingsSnapshot() === bookBefore);
    const tp = await text(`/admin/checkin/${E}?mode=test`, { jar: julie });
    check('Julie’s Test Mode view: banner, test figures, test Needs Julie, Reset button', tp.includes('banner-test') && tp.includes('<strong data-k="arrived">3</strong> test check-ins') && tp.includes('Typed: “linda brown”') && tp.includes('Reset test check-ins'));
    const lp = await text(`/admin/checkin/${E}`, { jar: julie });
    check('her Live attendance view says the iPad is in TEST MODE and shows only real figures', lp.includes('The iPad is in <strong>TEST MODE</strong>') && lp.includes(`<strong data-k="arrived">${arrived()}</strong> arrived`) && !lp.includes('Typed: “linda brown”'));
    const lt = await (await req(`/admin/checkin/${E}/live?mode=test`, { jar: julie })).json();
    check('the Test Mode live figures update by themselves too', lt.arrived === 3);
    const kate = guestsOf(six)[1];
    await post(julie, `/admin/checkin/${E}/guest/${kate.id}`, { mode: 'test', back: `/admin/checkin/${E}?mode=test` });
    check('Julie can test-check-in by hand: it goes to the test records only', db.prepare('SELECT COUNT(*) AS n FROM checkin_test_attendance WHERE guest_id = ?').get(kate.id).n === 1 && realSnapshot() === realBefore);
    await post(julie, `/admin/checkin/${E}/guest/${kate.id}/undo`, { mode: 'test', back: `/admin/checkin/${E}?mode=test` });
    check('…and undo a test check-in, without touching the real one', db.prepare('SELECT COUNT(*) AS n FROM checkin_test_attendance WHERE guest_id = ?').get(kate.id).n === 0 && guestsOf(six)[1].checked_in_at);
    await ctl('pause', {}, julie); const tpz = await api('find', { name: 'Kate One' });
    await ctl('resume', {}, julie); const trz = await api('state');
    await ctl('close', {}, julie); const tcz = await api('find', { name: 'Kate One' });
    await ctl('test', {}, julie); const taz = await api('state');
    check('pause, resume, close and start again all work in TEST MODE', tpz.result === 'paused' && trz.state === 'active' && trz.mode === 'test' && tcz.result === 'closed' && taz.state === 'active');
    const reset = await post(julie, `/admin/checkin/${E}/test-reset`, {});
    check('Reset test check-ins: all practice records for this event are cleared, real ones untouched', reset.status === 303 && testIns() === 0 && db.prepare('SELECT COUNT(*) AS n FROM checkin_help WHERE test = 1').get().n === 0 &&
      realSnapshot() === realBefore && db.prepare('SELECT COUNT(*) AS n FROM checkin_help WHERE test = 0').get().n > 0);
    check('…and the tests can be run again straight away', (await api('checkin', { name: 'Ann Smith' })).guests[0].result === 'in' && testIns() === 1);
    // Any event, any date: one three months away
    await ctl('use', { event_id: String(FUTURE) }, julie);
    await ctl('test', {}, julie);
    const fs1 = await api('state');
    check('an event three months away can be chosen and tested today', fs1.state === 'active' && fs1.mode === 'test' && fs1.event.name === 'Spring Supper (test)');
    const fq = await api('scan', { code: spring.url });
    check('…its QR codes and names work (in TEST MODE)', fq.guests.length === 2 && (await api('checkin', { name: 'Fiona Future' })).guests[0].result === 'in' && testIns(FUTURE) === 1 && arrived(FUTURE) === 0);
    check('…while tonight’s QR codes are “another event”', (await api('scan', { code: smiths.url })).result === 'other_event');
    const confirm = await text(`/admin/checkin/tablets/${tabletId}/live`, { jar: julie });
    check('starting LIVE for an event that isn’t today warns clearly first', confirm.includes('This event is <strong>not today</strong>'));
    const choose = await text('/admin/checkin/tablets', { jar: julie });
    check('the iPad’s event list includes every event, future and past', choose.includes('Spring Supper (test)') && choose.includes('Charity Night (test)') && choose.includes('Psychic Supper (test)'));
    const allList = await text('/admin/checkin?all=1', { jar: julie });
    check('Admin › Check in › “Show every event” lists any event to open', allList.includes('Spring Supper (test)') && allList.includes('Show only events with bookings coming up'));
    const moved = await ctl('use', { event_id: String(E) }, julie);
    check('choosing a different event always closes check-in and returns to TEST MODE (nothing opens for real by accident)', moved.status === 303 && tabletRow().state === 'closed' && tabletRow().mode === 'test');
    await post(julie, `/admin/checkin/${FUTURE}/test-reset`, {});
    await post(julie, `/admin/checkin/${E}/test-reset`, {});
    await ctl('live', { confirm: 'yes' });
  }

  console.log('\nThe iPad stays set up');
  {
    db.prepare(`UPDATE checkin_tablets SET key_renewed_at = ? WHERE id = ?`).run(new Date(Date.now() - 30 * 86400_000).toISOString(), tabletId);
    const st = await api('state');
    check('while in use, its key is renewed once a day (same key, another 60 days), so a restarted iPad carries on', /nw_tablet=/.test(st.setCookie) && /Max-Age=5184000/.test(st.setCookie) && (await api('state')).setCookie === '');
    db.prepare(`UPDATE checkin_tablets SET key_renewed_at = ? WHERE id = ?`).run(new Date(Date.now() - 61 * 86400_000).toISOString(), tabletId);
    check('an iPad not used for 60 days needs a new setup code (its key has expired)', (await api('state')).status === 401);
    db.prepare(`UPDATE checkin_tablets SET key_renewed_at = ? WHERE id = ?`).run(new Date().toISOString(), tabletId);
    const restarted = new Jar(); restarted.c.nw_tablet = ipad.c.nw_tablet;
    check('a restarted iPad (Safari reopened, same key) goes straight back to check-in', (await api('state', undefined, { jar: restarted })).state === 'active' && (await text('/self-checkin', { jar: restarted })).includes('Scan QR Code'));
  }

  console.log('\nOnly the iPad’s own page can send these requests');
  {
    check('no Origin (another app or website): refused', (await api('find', { name: 'Bob Smith' }, { origin: false })).status === 403);
    const evil = await req('/self-checkin/api/find', { jar: ipad, method: 'POST', body: JSON.stringify({ name: 'Bob Smith' }), headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, origin: false });
    check('another website’s Origin: refused', evil.status === 403);
    check('GET can’t check anyone in', (await req('/self-checkin/api/checkin', { jar: ipad })).status === 405);
    check('a guest can’t reach Admin from the iPad: Admin needs its own sign-in', (await req('/admin', { jar: ipad })).status === 401 && (await req(`/admin/checkin/${E}`, { jar: ipad })).status === 401);
  }

  console.log('\nImport a paper list');
  {
    const P = ev('Paper night (test)', today, { capacity: 20, legacy: 5 });
    const pre0 = booking(P, ['Eve Paper'], { source: 'admin', email: '' });   // already booked (Admin) before the paper list
    const form = await text(`/admin/events/${P}/bookings/import`, { jar: gary });
    check('Admin › Events › Import a paper list: one booking per line, a payment choice, and the “allocated before the website” option', form.includes('One booking on each line') && form.includes('To pay at the door') && form.includes('allocated before the website (5 recorded)'));
    check('the event page has the Import a paper list tile', (await text(`/admin/events/${P}/manage`, { jar: gary })).includes(`/admin/events/${P}/bookings/import`));
    const list = '1. Fred Paper, Gail Paper\n- Hugh Paper\n';
    const pre = await post(gary, `/admin/events/${P}/bookings/import`, { list, pay: 'paid_cash', legacy: '1', step: 'preview' });
    const preHtml = await pre.text();
    check('it shows exactly what will be added first (2 bookings, 3 guests) and adds nothing yet', pre.status === 200 && preHtml.includes('2 bookings, 3 guests') && db.prepare('SELECT COUNT(*) AS n FROM event_bookings WHERE event_id = ?').get(P).n === 1);
    const dupList = 'Eve Paper\nIvy Paper, Ivy Paper';
    const dupPre = await (await post(gary, `/admin/events/${P}/bookings/import`, { list: dupList, pay: 'paid_cash', step: 'preview' })).text();
    check('possible duplicates are pointed out: already booked (online or Admin) and twice on the list', dupPre.includes('Already on this event’s guest list') && dupPre.includes('Eve Paper') && dupPre.includes('Appear more than once') && dupPre.includes('Ivy Paper') && dupPre.includes('name="dups" value="yes" required'));
    const noTick = await post(gary, `/admin/events/${P}/bookings/import`, { list: dupList, pay: 'paid_cash', step: 'import' });
    check('…and nothing is added until Admin ticks to confirm them', noTick.status === 422 && (await noTick.text()).includes('Please tick the box') && db.prepare('SELECT COUNT(*) AS n FROM event_bookings WHERE event_id = ?').get(P).n === 1);
    const edit = await (await post(gary, `/admin/events/${P}/bookings/import`, { list: dupList, pay: 'paid_cash', step: 'edit' })).text();
    check('“Change the list” takes Admin back to correct it, with the list kept', edit.includes('Ivy Paper, Ivy Paper</textarea>') && edit.includes('Check the list'));
    const tooMany = await post(gary, `/admin/events/${P}/bookings/import`, { list: 'A One\nB Two\nC Three\nD Four\nE Five\nF Six', pay: 'paid_cash', legacy: '1', step: 'import' });
    check('more names than the places allocated before the website: refused, nothing added', tooMany.status === 422 && db.prepare('SELECT COUNT(*) AS n FROM event_bookings WHERE event_id = ?').get(P).n === 1);
    const imp = await post(gary, `/admin/events/${P}/bookings/import`, { list, pay: 'paid_cash', legacy: '1', step: 'import' });
    const rows = db.prepare('SELECT * FROM event_bookings WHERE event_id = ? AND id != ? ORDER BY id').all(P, pre0.id);
    check('Import adds them: 2 confirmed, paid bookings (a group of 2 and a single), a QR code each, no email', imp.status === 303 && rows.length === 2 && rows.every((b) => b.status === 'confirmed' && b.payment_status === 'paid' && b.source === 'admin' && b.checkin_token && !b.purchaser_email) &&
      rows[0].quantity === 2 && rows[1].quantity === 1);
    check('…the existing booking is untouched, and places move from “allocated before the website” (5 → 2)', db.prepare('SELECT legacy_places FROM events WHERE id = ?').get(P).legacy_places === 2 && db.prepare('SELECT status FROM event_bookings WHERE id = ?').get(pre0.id).status === 'confirmed');
    const ticked = await post(gary, `/admin/events/${P}/bookings/import`, { list: 'Ivy Paper', pay: 'free', step: 'import' });
    check('with no possible duplicates, no tick is needed', ticked.status === 303);
    const confirmDup = await post(gary, `/admin/events/${P}/bookings/import`, { list: 'Eve Paper', pay: 'free', step: 'import', dups: 'yes' });
    check('a confirmed possible duplicate is added once ticked', confirmDup.status === 303 && db.prepare(`SELECT COUNT(*) AS n FROM event_guests WHERE event_id = ? AND name = 'Eve Paper'`).get(P).n === 2);
    await ctl('use', { event_id: String(P) }); await ctl('live', { confirm: 'yes' });
    const fq = await api('scan', { code: `${base}/c/${rows[0].checkin_token}` });
    check('paper-list guests use the same iPad check-in: their QR code (from Admin) shows the group', fq.guests.map((g) => g.name).join() === 'Fred Paper,Gail Paper');
    check('…and they check in by name', (await api('checkin', { name: 'hugh paper' })).guests[0].result === 'in');
    check('…the two Eve Papers are now the same name, so the iPad sends Eve to Julie', (await api('find', { name: 'Eve Paper' })).result === 'same_name');
    const unpaidList = await post(gary, `/admin/events/${P}/bookings/import`, { list: 'Jim Paper', pay: 'unpaid', step: 'import' });
    check('a paper booking “to pay at the door” is sent to Julie by the iPad', unpaidList.status === 303 && (await api('find', { name: 'Jim Paper' })).result === 'see_julie');
    const full = await post(gary, `/admin/events/${P}/bookings/import`, { list: Array.from({ length: 20 }, (_, i) => `Person Number${i}`).join('\n'), pay: 'free', step: 'import' });
    check('more guests than places left: refused, nothing added', full.status === 422 && !db.prepare(`SELECT 1 FROM event_guests WHERE name = 'Person Number1'`).get());
    check('a helper (Julie) can’t import lists', (await req(`/admin/events/${P}/bookings/import`, { jar: julie })).status === 403);
    await ctl('use', { event_id: String(E) }); await ctl('live', { confirm: 'yes' });
  }

  console.log('\nRemoving an iPad, and tidying up');
  {
    const busy = [];
    for (let i = 0; i < 95; i++) busy.push(await api('find', { name: `Guess Name${i}` }));
    check('guesses are limited (90 a minute), so the guest list can’t be worked through from the iPad', busy.some((r) => r.result === 'busy') && busy.filter((r) => r.result === 'not_found').length <= 90);
    const before = realSnapshot();
    const off = await post(gary, `/admin/checkin/tablets/${tabletId}/remove`, {});
    check('Remove iPad (lost or replaced): its key stops working at once; it shows the setup screen', off.status === 303 && (await api('state')).status === 401 && (await text('/self-checkin', { jar: ipad })).includes('Set up this iPad'));
    check('…and nothing else is deleted', realSnapshot() === before);
    db.prepare(`INSERT INTO checkin_help (event_id, kind, typed_name, created_at) VALUES (?, 'not_found', 'Old Name', '2000-01-01T00:00:00Z')`).run(E);
    const { removeOldCheckinHelp } = await import('../src/selfcheckin/model.js');
    await removeOldCheckinHelp({ DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => db.prepare(sql.replace(/\?1/g, '?')).run(...a) }) }) } });
    check('notes the iPad sent Julie are removed after 14 days (they can hold a typed name)', db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE typed_name = 'Old Name'`).get().n === 0 && db.prepare('SELECT COUNT(*) AS n FROM checkin_help').get().n > 0);
    check('the daily clean-up runs it', fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8').includes("quietly('self check-in clean-up', removeOldCheckinHelp(env))"));
  }

  console.log('\nNothing else changed');
  {
    const mig = fs.readFileSync(path.join(root, 'migrations', '0024_self_checkin_ipad.sql'), 'utf8').replace(/--.*$/gm, '');
    check('the database change only adds four new tables (no existing table altered, nothing deleted)', (mig.match(/CREATE TABLE/g) || []).length === 4 && !/ALTER|DROP|DELETE|UPDATE|INSERT/i.test(mig));
    check('the iPad code never touches payments or Square', !/square|payment_status\s*=/i.test(fs.readFileSync(path.join(root, 'src', 'selfcheckin', 'public.js'), 'utf8').replace(/payment_status !== 'unpaid'/g, '')));
  }
} catch (err) {
  console.log('Test run stopped: ' + (err && err.stack ? err.stack : err));
  failed++;
} finally {
  for (const s of servers) s.child.kill();
}
const notRun = Math.max(0, EXPECTED_CHECKS - passed - failed);
console.log(`\n${passed} passed, ${failed} failed, ${notRun} not run (skipped)`);
process.exit(failed || notRun ? 1 : 0);
