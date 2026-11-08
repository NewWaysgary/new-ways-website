// Automated tests for iPad self check-in when the connection drops: the event copy (pack), offline check-ins sent
// later (sync), duplicates, safety checks, and TEST never reaching real attendance. Run: node tests/offline.test.mjs
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
function start(port, extra = {}) {
  const dbFile = path.join(root, 'dev', '.local', `offline-${port}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, SITE_URL: `http://localhost:${port}`, ...extra }, stdio: ['ignore', 'pipe', 'pipe']
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
  return { status: res.status, ...(j || {}) };
}

const EXPECTED_CHECKS = 50;
const servers = [];
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const cid = () => crypto.randomBytes(16).toString('hex');
try {
  const dev = await start(8955, { TEST_FIXTURES: '1' }); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + n * 86400_000));
  const ev = (name, date) => Number(db.prepare(`INSERT INTO events (name, date, visible, sales_mode, capacity, price_pence, start_time) VALUES (?, ?, 1, 'online', 60, 2500, '19:00') RETURNING id`).get(name, date).id);
  let n = 0;
  function booking(eventId, names, { status = 'confirmed', pay = 'paid' } = {}) {
    const token = crypto.randomBytes(16).toString('base64url');
    const b = db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, purchaser_name, purchaser_email, purchaser_phone, checkin_token)
      VALUES (?, ?, 'online', ?, 'square_online', ?, ?, ?, 'secret.person@example.test', '07700900999', ?) RETURNING id`).get(eventId, 'EV-OFF' + String(++n).padStart(3, '0'), status, pay, names.length, names[0], token);
    names.forEach((x, i) => db.prepare('INSERT INTO event_guests (booking_id, event_id, position, name) VALUES (?, ?, ?, ?)').run(b.id, eventId, i + 1, x));
    return { id: Number(b.id), token, ref: 'EV-OFF' + String(n).padStart(3, '0'), guests: () => db.prepare('SELECT * FROM event_guests WHERE booking_id = ? ORDER BY position').all(b.id) };
  }
  const E = ev('Wednesday Demonstration (test)', day(0));
  const F = ev('Future Night (test)', day(60));
  const group = booking(E, ['Olive One', 'Oscar One', 'Orla One']);
  const single = booking(E, ['Pam Single']);
  const twinA = booking(E, ['Sam Same']); const twinB = booking(E, ['Sam Same']);
  const toPay = booking(E, ['Paul Pay'], { pay: 'unpaid' });
  const gone = booking(E, ['Gina Gone'], { status: 'cancelled' });
  const later = booking(E, ['Lena Later']);
  const fut = booking(F, ['Fred Future']);
  const real = () => JSON.stringify(db.prepare('SELECT id, checked_in_at, checked_in_by FROM event_guests ORDER BY id').all());

  const gary = await signIn('owner');
  const add = await post(gary, '/admin/checkin/tablets', { name: 'Entrance iPad' });
  const code = ((await add.text()).match(/class="setup-digits"[^>]*>(\d{4}) (\d{4})</) || []).slice(1).join('');
  await req('/self-checkin/connect', { jar: ipad, method: 'POST', body: new URLSearchParams({ code }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const tid = db.prepare('SELECT id FROM checkin_tablets').get().id;
  const ctl = (action, extra = {}) => post(gary, `/admin/checkin/tablets/${tid}/control`, { action, back: '/admin/checkin/tablets', ...extra });

  console.log('\nThe event copy (pack) kept on the iPad');
  {
    await ctl('use', { event_id: String(E) });
    check('no copy while check-in is closed', (await api('pack')).result === 'closed' && (await api('state')).packStamp === null);
    await ctl('live', { confirm: 'yes' });
    const st = await api('state');
    const p = (await api('pack')).pack;
    check('while open, the iPad gets a copy: every confirmed guest of the event (8), with names', st.packStamp && p.guests.length === 8 && p.guests.some((g) => g[2] === 'Olive One') && p.eventId === E && p.mode === 'live');
    const raw = JSON.stringify(p);
    check('…no email, phone, reference or payment amount', !/@|07700|EV-OFF|2500|square/i.test(raw));
    check('…QR codes only in scrambled form (never the codes themselves)', !raw.includes(group.token) && p.bookings.some((b) => b[1] === sha(group.token)));
    check('…which bookings may self check in (paid yes; to pay and cancelled no)', p.bookings.find((b) => b[0] === group.id)[2] === 1 && p.bookings.find((b) => b[0] === toPay.id)[2] === 0 && p.bookings.find((b) => b[0] === gone.id)[2] === 0);
    check('…cancelled guests are not in the name list; other events are not in it at all', !p.guests.some((g) => g[2] === 'Gina Gone' || g[2] === 'Fred Future') && !p.bookings.some((b) => b[0] === fut.id));
    check('…names in the matching form, the same as the website uses', p.guests.find((g) => g[2] === 'Olive One')[3] === 'olive one');
    check('…a ticket signed by the website, valid 12 hours', /^\d+\.\d+\.live\.\d+\.\d+\.[A-Za-z0-9_-]+$/.test(p.ticket) && Math.abs(p.expires - Date.now() - 12 * 3600_000) < 60_000);
    await api('checkin', { name: 'Pam Single' });
    const st2 = await api('state');
    check('the copy’s version changes when someone arrives (so the iPad fetches a fresh copy)', st2.packStamp !== st.packStamp);
    const p2 = (await api('pack')).pack;
    check('…and the fresh copy shows them as arrived', p2.guests.find((g) => g[2] === 'Pam Single')[4] === 1);
    db.prepare(`UPDATE event_bookings SET status = 'cancelled' WHERE id = ?`).run(later.id);
    check('…and when a booking is cancelled', (await api('state')).packStamp !== st2.packStamp);
    db.prepare(`UPDATE event_bookings SET status = 'confirmed' WHERE id = ?`).run(later.id);
    await ctl('pause');
    check('while paused, the copy is still available (check-in may resume)', (await api('pack')).result === 'pack');
    await ctl('resume');
    check('only the iPad itself can get the copy', (await api('pack', undefined, { jar: new Jar() })).status === 401 && (await req('/self-checkin/api/pack', { jar: gary })).status === 401);
  }

  console.log('\nOffline check-ins sent later (sync)');
  {
    const p = (await api('pack')).pack;
    const [olive, oscar, orla] = group.guests();
    const now = new Date().toISOString();
    const c1 = cid(), c2 = cid();
    const s1 = await api('sync', { ticket: p.ticket, items: [{ cid: c1, gid: olive.id, at: now }, { cid: c2, gid: oscar.id, at: now }] });
    check('two offline check-ins arrive: both recorded in real attendance, as “offline”', s1.ok && s1.results.every((r) => r.result === 'in') && group.guests()[0].checked_in_by === 'iPad self check-in (offline)' && group.guests()[1].checked_in_at);
    check('…with the time they actually checked in (not when sent)', group.guests()[0].checked_in_at === now);
    const s2 = await api('sync', { ticket: p.ticket, items: [{ cid: c1, gid: olive.id, at: now }] });
    check('sending the same one again (lost answer) changes nothing, and gives the same answer', s2.results[0].result === 'in' && db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE kind = 'offline_duplicate'`).get().n === 0);
    // Julie checks Orla in on her phone while the iPad is offline; the iPad also checks her in offline
    await post(gary, `/admin/checkin/${E}/guest/${orla.id}`, { back: `/admin/checkin/${E}` });
    const s3 = await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: orla.id, at: new Date().toISOString() }] });
    check('a genuine duplicate (Julie had already checked her in): counted once, and shown to Julie', s3.results[0].result === 'already' && group.guests()[2].checked_in_by === 'Gary' &&
      db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE kind = 'offline_duplicate' AND guest_id = ?`).get(orla.id).n === 1);
    db.prepare(`UPDATE event_bookings SET status = 'cancelled' WHERE id = ?`).run(later.id);
    const s4 = await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: later.guests()[0].id, at: new Date().toISOString() }] });
    check('a booking cancelled in the meantime: NOT accepted, and Julie is warned', s4.results[0].result === 'rejected' && !later.guests()[0].checked_in_at && db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE kind = 'offline_problem'`).get().n === 1);
    db.prepare(`UPDATE event_bookings SET status = 'confirmed' WHERE id = ?`).run(later.id);
    check('a pay-at-the-door guest sent from an iPad is NOT accepted', (await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: toPay.guests()[0].id, at: new Date().toISOString() }] })).results[0].result === 'rejected' && !toPay.guests()[0].checked_in_at);
    check('a guest of another event is NOT accepted under this event’s ticket', (await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: fut.guests()[0].id, at: new Date().toISOString() }] })).results[0].result === 'rejected' && !fut.guests()[0].checked_in_at);
    const forged = p.ticket.replace(/\.[^.]+$/, '.' + 'x'.repeat(43));
    check('a forged ticket is refused (nothing recorded)', (await api('sync', { ticket: forged, items: [{ cid: cid(), gid: later.guests()[0].id, at: new Date().toISOString() }] })).ok === false && !later.guests()[0].checked_in_at);
    const toTest = p.ticket.replace('.live.', '.test.');
    check('changing LIVE to TEST (or back) in a ticket breaks its signature: refused', (await api('sync', { ticket: toTest, items: [] })).ok === false);
    const old = new Date(Date.now() - 13 * 3600_000).toISOString();
    check('a time outside the ticket’s 12 hours is refused', (await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: later.guests()[0].id, at: old }] })).results[0].result === 'rejected');
    check('a time in the future is refused', (await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: later.guests()[0].id, at: new Date(Date.now() + 3600_000).toISOString() }] })).results[0].result === 'rejected');
    check('nonsense numbers are refused', (await api('sync', { ticket: p.ticket, items: [{ cid: 'x', gid: 'y' }] })).results[0].result === 'rejected');
    await ctl('close');
    const late = await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: later.guests()[0].id, at: new Date().toISOString() }] });
    check('check-ins made while open are still accepted after Admin has closed check-in', late.results[0].result === 'in' && later.guests()[0].checked_in_at);
    check('…but nothing NEW can be checked in while closed', (await api('checkin', { name: 'Sam Same' })).result === 'closed');
    await ctl('live', { confirm: 'yes' });
  }

  console.log('\nA check-in whose answer was lost, then sent again from the iPad');
  {
    const p = (await api('pack')).pack;
    const g = twinA.guests()[0];
    const c = cid();
    const on = await api('checkin', { code: twinA.token, guests: [g.id], cids: { [g.id]: c } });
    const again = await api('sync', { ticket: p.ticket, items: [{ cid: c, gid: g.id, at: new Date().toISOString() }] });
    check('the website recognises it as the same check-in: no duplicate, no warning', on.guests[0].result === 'in' && again.results[0].result === 'in' &&
      db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE kind = 'offline_duplicate' AND guest_id = ?`).get(g.id).n === 0);
  }

  console.log('\nNotes for Julie made offline');
  {
    const p = (await api('pack')).pack;
    const c = cid();
    const s = await api('sync', { ticket: p.ticket, items: [], help: [{ cid: c, kind: 'same_name', typed: 'sam same' }, { cid: cid(), kind: 'not_found', typed: 'Nobody Offline' }, { cid: cid(), kind: 'nonsense' }] });
    check('notes made offline (same name, not found) reach Needs Julie', s.ok && db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE typed_name IN ('sam same', 'Nobody Offline')`).get().n === 2);
    await api('sync', { ticket: p.ticket, items: [], help: [{ cid: c, kind: 'same_name', typed: 'sam same' }] });
    check('…sent twice, shown once', db.prepare(`SELECT COUNT(*) AS n FROM checkin_help WHERE typed_name = 'sam same'`).get().n === 1);
    const page = await text(`/admin/checkin/${E}`, { jar: gary });
    check('Julie sees the offline duplicate and the offline problem, and how many offline check-ins arrived', page.includes('Offline check-in: this guest was already checked in') && page.includes('Offline check-in NOT accepted') && /Offline check-ins received for this event: \d+ accepted/.test(page));
    check('…offline check-ins are marked “iPad · offline” in the guest list', page.includes('<span class="chip">iPad · offline</span>'));
  }

  console.log('\nTEST MODE never reaches real attendance');
  {
    await ctl('test');
    const p = (await api('pack')).pack;
    check('in TEST MODE the copy and its ticket say TEST', p.mode === 'test' && p.ticket.includes('.test.'));
    const before = real();
    const g = single.guests()[0];
    const s = await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: twinB.guests()[0].id, at: new Date().toISOString() }, { cid: cid(), gid: g.id, at: new Date().toISOString() }] });
    check('offline TEST check-ins go to the test records only: real attendance unchanged', s.ok && real() === before && db.prepare('SELECT COUNT(*) AS n FROM checkin_test_attendance WHERE guest_id = ?').get(twinB.guests()[0].id).n === 1);
    await ctl('live', { confirm: 'yes' });
    const s2 = await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: group.guests()[2].id, at: new Date().toISOString() }] });
    check('a TEST ticket sent after switching to LIVE still only goes to the test records', s2.ok && real() === before);
    await post(gary, `/admin/checkin/${E}/test-reset`, {});
  }

  console.log('\nWhat the iPad reports, and Admin sees');
  {
    const r = await api('state', undefined);
    await req('/self-checkin/api/state', { jar: ipad, headers: { 'X-NW-Pending': '3|' + new Date(Date.now() - 120_000).toISOString() } });
    const page = await text(`/admin/checkin/${E}`, { jar: gary });
    check('the iPad says it is holding 3 offline check-ins: Julie sees it', db.prepare('SELECT pending_count FROM checkin_tablets WHERE id = ?').get(tid).pending_count === 3 && page.includes('3 offline check-ins are saved on the iPad, waiting to be sent'));
    const l1 = await (await req(`/admin/checkin/${E}/live`, { jar: gary })).json();
    await req('/self-checkin/api/state', { jar: ipad, headers: { 'X-NW-Pending': '0' } });
    const l2 = await (await req(`/admin/checkin/${E}/live`, { jar: gary })).json();
    check('…and her screen updates by itself when they have been sent', l1.stamp !== l2.stamp && !(await text(`/admin/checkin/${E}`, { jar: gary })).includes('waiting to be sent'));
    check('removing an iPad that still holds check-ins warns first', (await (async () => { await req('/self-checkin/api/state', { jar: ipad, headers: { 'X-NW-Pending': '2|' + new Date().toISOString() } }); return text('/admin/checkin/tablets', { jar: gary }); })()).includes('WARNING: 2 offline check-ins are still saved'));
    await req('/self-checkin/api/state', { jar: ipad, headers: { 'X-NW-Pending': '0' } });
    check('a state reply works as before', r.state === 'active');
  }

  console.log('\nSet up again: saved check-ins still accepted');
  {
    const p = (await api('pack')).pack;
    const codePage = await (await post(gary, `/admin/checkin/tablets/${tid}/code`, {})).text();
    const code2 = (codePage.match(/class="setup-digits"[^>]*>(\d{4}) (\d{4})</) || []).slice(1).join('');
    const fresh = new Jar();
    await req('/self-checkin/connect', { jar: fresh, method: 'POST', body: new URLSearchParams({ code: code2 }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    check('after setting the iPad up again, its old key stops working', (await api('state')).status === 401 && (await api('state', undefined, { jar: fresh })).status === 200);
    const s = await api('sync', { ticket: p.ticket, items: [{ cid: cid(), gid: twinB.guests()[0].id, at: new Date().toISOString() }] }, { jar: fresh });
    check('…and check-ins saved under the earlier ticket are still accepted (nothing lost)', s.ok && s.results[0].result === 'in');
    check('a device that isn’t set up can’t send anything', (await api('sync', { ticket: p.ticket, items: [] }, { jar: new Jar() })).status === 401);
  }

  console.log('\nThe iPad screens work offline');
  {
    const sw = fs.readFileSync(path.join(root, 'public', 'self-checkin-sw.js'), 'utf8');
    const { ASSET_VERSION } = await import('../src/lib/http.js');
    check('the iPad keeps a copy of the check-in screens (same version as the website)', sw.includes(`nw-checkin-${ASSET_VERSION}`) && sw.includes(`/js/selfcheckin.js?v=${ASSET_VERSION}`) && sw.includes(`/js/vendor/jsqr-1.4.0.js?v=${ASSET_VERSION}`));
    check('…but never guest information: requests to the website always go to the network', sw.includes("if (url.pathname.startsWith('/self-checkin/')) return;"));
    const pg = await req('/self-checkin', { jar: new Jar() });
    check('the setup screen is never kept (only the check-in screens, marked X-NW-Kiosk)', !pg.headers.get('x-nw-kiosk'));
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'selfcheckin.js'), 'utf8');
    check('the iPad’s copy and saved check-ins are encrypted (AES-GCM, key can’t be exported)', js.includes("name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']") && js.includes("store.set('queue'"));
    check('a check-in is saved on the iPad before the guest is told', /return saveQueue\(\)\.then\(function \(\) \{ updateNet\(\); return results; \}\)/.test(js));
    check('the name rule on the iPad is the same as the website’s', js.includes(".replace(/[’‘'`´.]/g, '').replace(/[-‐‑‒–—_,]/g, ' ').replace(/[^\\p{L}\\p{N} ]/gu, '')") &&
      fs.readFileSync(path.join(root, 'src', 'selfcheckin', 'names.js'), 'utf8').includes(".replace(/[’‘'`´.]/g, '')"));
  }

  console.log('\nTidying up');
  {
    db.prepare(`INSERT INTO checkin_sync_log (client_id, tablet_id, event_id, guest_id, result, recorded_at) VALUES ('oldoldoldoldoldold', 1, ?, 1, 'in', '2000-01-01T00:00:00Z')`).run(E);
    const { removeOldSyncLog } = await import('../src/selfcheckin/offline.js');
    await removeOldSyncLog({ DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => db.prepare(sql.replace(/\?1/g, '?')).run(...a) }) }) } });
    check('records of sent check-ins are removed after 14 days', !db.prepare(`SELECT 1 FROM checkin_sync_log WHERE client_id = 'oldoldoldoldoldold'`).get() && db.prepare('SELECT COUNT(*) AS n FROM checkin_sync_log').get().n > 0);
    check('the daily clean-up runs it', fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8').includes("removeOldSyncLog(env)"));
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
