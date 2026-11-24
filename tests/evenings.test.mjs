// Automated tests for moving a week's normal evening to another day (for example Tuesday 15 December instead of
// Wednesday 16 December): Admin's Who's On (any day, "Date", Wednesday the default, one evening per week, moving an
// evening with its advance payments), the public Who's On and payment pages, confirmation emails, QR codes, the door,
// closures, the 6pm email, longer descriptions and keeping a chosen photo after a mistake on the form.
// Run with: npm test, or on its own: node tests/evenings.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeD1 } from './support/d1.mjs';
import { sendSixPmReminders } from '../src/wednesday/payments.js';
import { eveningDates, weekOf } from '../src/wednesday/evenings.js';
import { ukToday } from '../src/lib/dates.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== '' ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
}
const PORT = 8997;
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `evenings-${port}.sqlite`);
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
async function req(p, { jar, method = 'GET', body, headers = {}, origin } = {}) {
  const h = { ...headers };
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET' && origin !== null) h.Origin = base;
  const res = await fetch(base + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}
const text = async (p, o) => (await req(p, o)).text();
async function signIn() {
  const jar = new Jar();
  const login = await req('/admin/login', { jar });
  const auth = await (await fetch(login.headers.get('location'))).text();
  const cb = new URL((auth.match(/id="as-owner" href="([^"]+)"/) || [])[1].replace(/&amp;/g, '&'));
  await req(cb.pathname + cb.search, { jar });
  return jar;
}
async function submit(jar, p, fields, files = {}) {
  const fd = new FormData();
  fd.append('_csrf', jar.c.nw_csrf || ((await text('/admin', { jar })).match(/name="_csrf" value="([^"]+)"/) || [])[1] || '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.buf], { type: f.type }), f.name);
  return req(p, { jar, method: 'POST', body: fd });
}
const plus = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const fixture = (f) => fs.readFileSync(path.join(root, 'tests', 'fixtures', f));

const servers = [];
try {
  const dev = await start(PORT); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn();
  const emails = async () => (await (await fetch(dev.mock + '/__emails')).json());
  const sq = async () => (await fetch(dev.mock + '/__square/state')).json();
  const today = ukToday();
  // The test weeks: two and three weeks ahead (inside the four weeks that can be paid for online)
  const W2 = weekOf(plus(today, 14)), W3 = weekOf(plus(today, 21)), W1 = weekOf(plus(today, 7));
  const tue2 = plus(W2.wed, -1), wed2 = W2.wed, thu2 = plus(W2.wed, 1), tue3 = plus(W3.wed, -1), wed3 = W3.wed;
  db.prepare('DELETE FROM mediums').run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('wed_prepay_weeks', '4') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  const items = db.prepare('SELECT * FROM till_items WHERE online = 1 AND custom_amount = 0 AND enabled = 1').all();
  const entry = items.find((i) => i.category === 'entry');
  // An advance payment made BEFORE the evening is moved: for Wednesday of week 2 (paid, with its QR code)
  const mkOrder = (night, email) => {
    const token = crypto.randomBytes(16).toString('base64url');
    const id = Number(db.prepare(`INSERT INTO wed_orders (reference, night_date, email, status, total_pence, checkin_token, origin, paid_at, created_at) VALUES (?, ?, ?, 'paid', 500, ?, ?, ?, ?)`)
      .run('WN-' + crypto.randomBytes(3).toString('hex').toUpperCase(), night, email, token, base, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
    db.prepare(`INSERT INTO wed_order_lines (order_id, item_id, label, category, unit_pence, qty, line_pence) VALUES (?, ?, 'Entry', 'entry', 500, 1, 500)`).run(id, entry.id);
    return db.prepare('SELECT * FROM wed_orders WHERE id = ?').get(id);
  };
  const early = mkOrder(wed2, 'early@example.com');
  const other = mkOrder(W1.wed, 'otherweek@example.com');
  const snapshot = (id) => JSON.stringify(db.prepare('SELECT * FROM wed_orders WHERE id = ?').get(id));
  const otherBefore = snapshot(other.id);

  console.log('\nAdmin › Who’s On: any day, “Date”, Wednesday the default');
  {
    const form = await text('/admin/whos-on/new', { jar: g });
    const nextWed = (() => { const d = new Date(today + 'T12:00:00Z'); while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    check('the date field is headed “Date” (not “Wednesday”)', form.includes('<label for="f-date">Date</label>') && !form.includes('<label for="f-date">Wednesday</label>'));
    check('a new listing starts on the next Wednesday (Wednesday stays the normal default)', form.includes(`id="f-date" name="date" type="date" value="${nextWed}"`));
    check('the description allows up to 8,000 characters, with a taller box', form.includes('Up to 8,000 characters') && form.includes('name="description" rows="10"'));
    const wedAdd = await submit(g, '/admin/whos-on/new', { date: wed3, name: 'Wednesday Medium', location: 'Perth', description: 'A normal Wednesday.', visible: '1' });
    const wm = db.prepare(`SELECT * FROM mediums WHERE name = 'Wednesday Medium'`).get();
    check('a normal Wednesday listing saves exactly as before', wedAdd.status === 303 && wm && wm.date === wed3 && wedAdd.headers.get('location') === '/admin/whos-on?flash=added');
  }

  console.log('\nMoving a week’s evening to Tuesday');
  let gary;
  {
    const long = 'Mediumship in Darkness Under Red Light. '.repeat(100).trim();   // about 4,000 characters (over the old 3,000)
    const r = await submit(g, '/admin/whos-on/new', { date: tue2, name: 'Gary Findlay', location: 'Dundee', description: long, visible: '1' },
      { photo_key: { buf: fixture('test-portrait.jpg'), type: 'image/jpeg', name: 'gary.jpg' } });
    gary = db.prepare(`SELECT * FROM mediums WHERE name = 'Gary Findlay'`).get();
    const loc = r.headers.get('location') || '';
    check('a Tuesday listing saves (no more “Please choose a Wednesday”), with a description over the old 3,000-character limit', r.status === 303 && gary && gary.date === tue2 && gary.description.length > 3000 && !!gary.photo_key, [r.status, loc]);
    const moved = db.prepare('SELECT * FROM wed_orders WHERE id = ?').get(early.id);
    check('the advance payment already made for that week’s Wednesday moves to the Tuesday (QR code, amount and status unchanged)',
      moved.night_date === tue2 && moved.checkin_token === early.checkin_token && moved.total_pence === early.total_pence && moved.status === 'paid' && moved.reference === early.reference);
    check('an advance payment for a different week is completely unchanged', snapshot(other.id) === otherBefore);
    const list = await text(loc, { jar: g });
    check('Admin says what happened: the week’s evening moved, 1 advance payment moved with it, customers NOT emailed',
      list.includes('That week’s evening is now ') && list.includes('1 advance payment for that evening moved with it (QR codes unchanged). The customers have NOT been emailed about the new date.'), loc);
    const dates = await eveningDates({ DB: makeD1(dev.dbFile) }, 4);
    check('the weekly evenings are now the Tuesday for that week, and Wednesdays for the others (never both)', dates.includes(tue2) && !dates.includes(wed2) && dates.includes(wed3) && dates.length === 4, dates);
  }

  console.log('\nOne evening each week');
  {
    const wedSame = await submit(g, '/admin/whos-on/new', { date: wed2, name: 'Second Medium', visible: '1' });
    const h = await wedSame.text();
    check('another listing on that week’s Wednesday is refused, with the reason (the evening is the Tuesday)', wedSame.status === 422 && h.includes('That week’s evening is already on ') && h.includes('(Gary Findlay)') && !db.prepare(`SELECT 1 FROM mediums WHERE name = 'Second Medium'`).get());
    const tueSame = await submit(g, '/admin/whos-on/new', { date: tue2, name: 'Second Medium', visible: '1' });
    check('…but a second medium on the same Tuesday is fine (the same evening)', tueSame.status === 303 && db.prepare(`SELECT date FROM mediums WHERE name = 'Second Medium'`).get().date === tue2);
  }

  console.log('\nThe public website');
  {
    const who = await text('/whos-on');
    check('Who’s On shows the Tuesday with its real day and date, and says it is instead of the usual Wednesday', who.includes('Gary Findlay') && who.includes(`· instead of the usual Wednesday`) && /Tuesday \d{1,2} [A-Z][a-z]+/.test(who));
    check('the Wednesday listing still shows normally (no note)', who.includes('Wednesday Medium'));
    check('the usual weekly arrangements still say Wednesday (“Every Wednesday”)', who.includes('Every Wednesday') && who.includes('Wednesday evenings at New Way’s'));
    const own = await text(`/whos-on/${gary.id}`);
    check('the medium’s own (Facebook) page shows the Tuesday and the full long description', own.includes('Tuesday ') && own.includes('Mediumship in Darkness Under Red Light.') && own.includes('instead of the usual Wednesday'));
    const pay = await text('/whos-on/pay');
    const radios = [...pay.matchAll(/name="night" value="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
    check('paying in advance offers the Tuesday for that week, NOT the Wednesday as well', radios.includes(tue2) && !radios.includes(wed2) && pay.includes('Which evening?'), radios);
    check('…with the guest medium named against it', /Tuesday[^<]*<br><span class="small">Guest medium: Gary Findlay<\/span>/.test(pay));
    // pay online for the Tuesday
    const stamp = pay.match(/name="t" value="([^"]+)"/)[1];
    await sleep(3100);
    const post = (fields) => req('/whos-on/pay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '10.7.0.1' },
      body: new URLSearchParams({ t: stamp, website: '', 'cf-turnstile-response': TOKEN, email: 'tuesday@example.com', ['q' + entry.id]: '2', ...fields }).toString() });
    const wrong = await post({ night: wed2 });
    check('the old Wednesday of that week can’t be paid for', wrong.status === 422 && (await wrong.text()).includes('Please choose the evening you are coming.'));
    const ok = await post({ night: tue2 });
    const o = db.prepare(`SELECT * FROM wed_orders WHERE email = 'tuesday@example.com'`).get();
    const link = (await sq()).links.find((l) => l.orderId === o.square_order_id);
    check('an advance payment for the Tuesday is recorded for the Tuesday, and Square’s item says Tuesday', ok.status === 303 && o.night_date === tue2 && /^New Way’s Tuesday \d/.test(link.itemName || link.name || ''), link);
    const e0 = (await emails()).length;
    await fetch(`${dev.mock}/__square/pay/${o.square_payment_link_id}`);
    const status = await text((ok.headers.get('location') || '').replace('&go=1', ''));
    const conf = (await emails()).slice(e0).find((m) => [].concat(m.to).includes('tuesday@example.com'));
    check('the confirmation email names the Tuesday (subject, wording and Evening row) and carries the QR code', !!conf && /^Your Tuesday at New Way’s: Tuesday /.test(conf.subject) && conf.text.includes('Your advance payment for Tuesday ') &&
      /Evening: Tuesday /.test(conf.text) && conf.attachments?.length === 1 && /^New-Ways-Tuesday-WN-/.test(conf.attachments[0].filename), conf && [conf.subject, conf.attachments?.[0]?.filename]);
    check('the customer’s payment page says Tuesday', status.includes('Tuesday at New Way’s') && status.includes('Tuesday '));
    const qr = await text(`/w/${db.prepare('SELECT checkin_token FROM wed_orders WHERE id = ?').get(o.id).checkin_token}`);
    check('the QR code page works and shows the Tuesday', qr.includes('Tuesday '));
    const moved = await text(`/w/${early.checkin_token}`);
    check('the moved (earlier) payment’s QR code still works and now shows the Tuesday', moved.includes('Tuesday ') && !moved.includes('doesn’t match'));
  }

  console.log('\nThe door, the till and closures');
  {
    const door = await text(`/admin/door?date=${tue2}`, { jar: g });
    check('the door till for the Tuesday doesn’t warn “not an evening”', !door.includes('not an evening') && !door.includes('not a Wednesday'));
    const doorWed = await text(`/admin/door?date=${wed2}`, { jar: g });
    check('…while that week’s old Wednesday is marked “not an evening”', doorWed.includes('not an evening'));
    const paid = await text(`/admin/door/orders?date=${tue2}`, { jar: g });
    check('the Tuesday’s paid-in-advance list (guest list) includes both advance payments', paid.includes(early.reference) && paid.includes(db.prepare(`SELECT reference FROM wed_orders WHERE email = 'tuesday@example.com'`).get().reference), paid.slice(0, 300));
    const cl = await text('/admin/door/closure', { jar: g });
    check('the closure page offers the Tuesday (not that week’s Wednesday)', cl.includes(`<option value="${tue2}">`) && !cl.includes(`<option value="${wed2}">`) && cl.includes('Which evening?'));
    const close = await submit(g, '/admin/door/closure', { date: wed2, action: 'close', reason: 'test' });
    check('…and closing the old Wednesday of that week is refused', (close.headers.get('location') || '').includes('bad-date'));
  }

  console.log('\nThe 6pm email on the Tuesday');
  {
    const env = { DB: makeD1(dev.dbFile), EMAIL_FROM: 'New Way’s <bookings@example.test>', RESEND_API_KEY: 're_local_test', RESEND_API_BASE: dev.mock, SITE_URL: base };
    const e0 = (await emails()).length;
    const at6 = Date.parse(tue2 + 'T18:00:30Z');   // winter: UK time is UTC
    const sent = await sendSixPmReminders(env, at6);
    const got = (await emails()).slice(e0);
    check('at 6pm on the Tuesday, that evening’s QR codes are emailed again (Tonight at New Way’s)', sent >= 1 && got.some((m) => [].concat(m.to).includes('early@example.com') && /Tonight at New Way’s/.test(m.subject)), [sent, got.map((m) => m.subject)]);
    const nothing = await sendSixPmReminders(env, Date.parse(wed2 + 'T18:00:30Z'));
    check('…and nothing is sent on that week’s old Wednesday', nothing === 0);
    const cron = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
    check('the free 6pm trigger runs every day (the email itself only goes to that evening’s payments)', cron.includes('"0 17,18 * * *"'));
  }

  console.log('\nChanging the date of an existing listing (no delete and re-create)');
  {
    const second = db.prepare(`SELECT * FROM mediums WHERE name = 'Second Medium'`).get();
    const r = await submit(g, `/admin/whos-on/${gary.id}`, { date: wed2, name: 'Gary Findlay', location: 'Dundee', description: gary.description, visible: '1' });
    const g2 = db.prepare('SELECT * FROM mediums WHERE id = ?').get(gary.id);
    check('the Tuesday listing can be changed back to the Wednesday, keeping its photo and details', r.status === 303 && g2.date === wed2 && g2.photo_key === gary.photo_key && g2.description === gary.description);
    check('…the other medium of that evening moves with it, and so do its advance payments', db.prepare('SELECT date FROM mediums WHERE id = ?').get(second.id).date === wed2 &&
      db.prepare(`SELECT COUNT(*) AS n FROM wed_orders WHERE night_date = ?`).get(tue2).n === 0 && db.prepare('SELECT night_date FROM wed_orders WHERE id = ?').get(early.id).night_date === wed2);
    await submit(g, `/admin/whos-on/${gary.id}`, { date: tue2, name: 'Gary Findlay', location: 'Dundee', description: gary.description, visible: '1' });
    check('…and moved to the Tuesday again in one edit', db.prepare('SELECT date FROM mediums WHERE id = ?').get(second.id).date === tue2 && db.prepare('SELECT night_date FROM wed_orders WHERE id = ?').get(early.id).night_date === tue2);
    // a medium moved to another week entirely: its old week goes back to its Wednesday
    await submit(g, `/admin/whos-on/${second.id}`, { date: tue3, name: 'Second Medium', visible: '1' });
    const wedClash = await text('/admin/whos-on', { jar: g });
    check('a listing can’t be moved into a week whose evening is a different day', db.prepare('SELECT date FROM mediums WHERE id = ?').get(second.id).date === tue2 && wedClash.length > 0);
    // deleting the only listing of a moved evening puts the evening (and its payments) back on the Wednesday
    await submit(g, `/admin/whos-on/${second.id}/delete`, {});
    const del = await submit(g, `/admin/whos-on/${gary.id}/delete`, {});
    check('deleting the moved evening’s listings puts the evening and its advance payments back on the Wednesday', (del.headers.get('location') || '').startsWith('/admin/whos-on?flash=deleted') &&
      db.prepare(`SELECT COUNT(*) AS n FROM wed_orders WHERE night_date = ?`).get(tue2).n === 0 && db.prepare('SELECT night_date FROM wed_orders WHERE id = ?').get(early.id).night_date === wed2);
    check('the other week’s payment is still completely unchanged', snapshot(other.id) === otherBefore);
  }

  console.log('\nAn evening that has already started at the till can’t be moved');
  {
    db.prepare(`INSERT INTO till_sales (night_date, method, total_pence, client_ref, created_by) VALUES (?, 'cash', 500, 'test-ref-1', 'test')`).run(wed3);
    const wm = db.prepare(`SELECT * FROM mediums WHERE name = 'Wednesday Medium'`).get();
    const r = await submit(g, `/admin/whos-on/${wm.id}`, { date: tue3, name: 'Wednesday Medium', location: 'Perth', description: 'A normal Wednesday.', visible: '1' });
    check('moving it is refused with the reason', r.status === 422 && (await r.text()).includes('The door till has already been used for'));
    db.prepare(`DELETE FROM till_sales WHERE client_ref = 'test-ref-1'`).run();
  }

  console.log('\nThe description and the photo when something else needs correcting');
  {
    const tooLong = 'x'.repeat(8001);
    const r = await submit(g, '/admin/whos-on/new', { date: plus(today, -7), name: 'Photo Keeper', description: tooLong, visible: '1' },
      { photo_key: { buf: fixture('test-portrait.jpg'), type: 'image/jpeg', name: 'keep.jpg' } });
    const h = await r.text();
    check('a description that is too long is explained with its length (8,001 against 8,000)', r.status === 422 && h.includes('Please keep this under 8,000 characters (it is 8,001 at the moment).'));
    check('…the date mistake is explained too, and everything typed is kept', h.includes('That date has already passed.') && h.includes('value="Photo Keeper"'));
    const token = (h.match(/name="kept_photo_key" value="([^"]+)"/) || [])[1];
    check('the chosen photo is kept and shown (no need to choose it again)', !!token && h.includes('is kept: there is no need to choose it again') && !h.includes('choose the picture again'));
    const fixed = await submit(g, '/admin/whos-on/new', { date: wed3, name: 'Photo Keeper', description: 'Short now.', visible: '1', kept_photo_key: unesc(token) });
    const pk = db.prepare(`SELECT * FROM mediums WHERE name = 'Photo Keeper'`).get();
    check('after correcting the details, it saves WITH the kept photo', fixed.status === 303 && pk && pk.photo_key === unesc(token).split('|')[0], [fixed.status]);
    const forged = await submit(g, '/admin/whos-on/new', { date: wed3, name: 'Forged Photo', visible: '1', kept_photo_key: pk.photo_key + '|' + Date.now() + '|' + 'A'.repeat(43) });
    check('a made-up kept-photo note is ignored (no photo attached)', forged.status === 303 && db.prepare(`SELECT photo_key FROM mediums WHERE name = 'Forged Photo'`).get().photo_key === '');
    const noPhoto = await submit(g, '/admin/whos-on/new', { date: plus(today, -7), name: 'No Photo Keeper', visible: '1' });
    check('a mistake with no photo chosen still says only what needs correcting', noPhoto.status === 422 && !(await noPhoto.text()).includes('kept_photo_key'));
  }
} catch (err) {
  failed++;
  console.log('Test run stopped:', err && err.stack ? err.stack : err);
} finally {
  for (const s of servers) s.child.kill();
}
function unesc(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&#124;/g, '|').replace(/&quot;/g, '"'); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
