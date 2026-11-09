// STAGING ONLY: checks the deployed TEST COPY from start to finish, run by the "Deploy STAGING (test copy)" workflow
// straight after it deploys. It uses only the staging Worker and the staging database (new-ways-staging), never the
// live website. It makes its OWN temporary event, bookings and iPad key in the staging database, runs the iPad's
// check-in requests against them (TEST and LIVE, QR codes, names, same name, offline sending, pause and close), then
// deletes everything it made. Gary and Julie's own test bookings, test check-ins and iPad are never touched.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const BASE = 'https://new-ways-staging.newwaysmediumship.workers.dev';
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : '')); }
};
function sql(command) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'new-ways-staging', '--remote', '--config', 'wrangler.staging.jsonc', '--json', '--command', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const j = JSON.parse(out);
  return (Array.isArray(j) ? j[0] : j).results || [];
}
const key = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update('tablet|' + key).digest('hex');
const cookie = `nw_tablet=${key}`;
async function api(name, body) {
  const res = await fetch(`${BASE}/self-checkin/api/${name}`, body === undefined ? { headers: { Cookie: cookie } }
    : { method: 'POST', headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = {};
  try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, ...j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

let tabletId = null;
let tempEvents = [];
try {
  console.log('\nThe test copy is up');
  let home = null;
  for (let i = 0; i < 20; i++) { try { home = await fetch(BASE + '/'); if (home.ok) break; } catch { /* starting */ } await sleep(3000); }
  const homeHtml = home ? await home.text() : '';
  check('the home page opens', !!home && home.ok, home && home.status);
  check('…with the STAGING · TEST COPY strip', homeHtml.includes('STAGING · TEST COPY'));
  check('…kept out of Google (noindex, and robots.txt says keep out)', /noindex/.test(home.headers.get('x-robots-tag') || '') && /Disallow: \/\n/.test(await (await fetch(BASE + '/robots.txt')).text()));
  const admin = await fetch(BASE + '/admin', { redirect: 'manual' });
  const adminHtml = await admin.text();
  const signIn = admin.status === 401 && /sign in/i.test(adminHtml);
  check(signIn ? 'Admin is ready for signing in (WorkOS key added)' : 'Admin stays locked until the WorkOS key is added (as expected for now)', signIn || (admin.status === 503 && adminHtml.includes('not switched on')), admin.status);
  const pair = await fetch(BASE + '/self-checkin');
  check('the iPad setup screen opens', pair.ok && (await pair.text()).includes('Set up this iPad for self check-in') && (pair.headers.get('permissions-policy') || '').includes('camera=(self)'));
  const ticket = await fetch(BASE + '/c/StagingGroupOfSix00000');
  check('a test QR ticket opens (group of six)', ticket.ok && (await ticket.text()).includes('<svg'));
  check('the iPad’s requests are refused without a key', (await fetch(BASE + '/self-checkin/api/state')).status === 401);
  const man = await fetch(BASE + '/self-checkin.webmanifest');
  const manJson = man.ok ? await man.json() : {};
  check('the kiosk app manifest is served (full screen, kept to /self-checkin)', manJson.start_url === '/self-checkin' && manJson.scope === '/self-checkin' && (man.headers.get('content-type') || '').includes('manifest+json'));
  const sw = await fetch(BASE + '/self-checkin-sw.js');
  check('the iPad’s offline helper is served', sw.ok && (await sw.text()).includes('nw-checkin-'));

  console.log('\nA temporary event, bookings and iPad (TEST MODE)');
  const spring = sql(`SELECT id FROM events WHERE name = 'Spring Supper (staging)'`)[0];
  check('the made-up test events are there', !!spring);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  const later = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + 92 * 86400_000));
  sql(`INSERT INTO events (name, date, visible, sales_mode, start_time, capacity) VALUES ('Automatic check (temporary event)', ${q(today)}, 0, 'link', '19:00', 60)`);
  sql(`INSERT INTO events (name, date, visible, sales_mode, start_time, capacity) VALUES ('Automatic check (temporary future event)', ${q(later)}, 0, 'link', '19:00', 60)`);
  const ev = sql(`SELECT id FROM events WHERE name = 'Automatic check (temporary event)' ORDER BY id DESC LIMIT 1`)[0];
  const fut = sql(`SELECT id FROM events WHERE name = 'Automatic check (temporary future event)' ORDER BY id DESC LIMIT 1`)[0];
  const tok = () => crypto.randomBytes(16).toString('base64url');
  const T = {};
  const mk = (key, eventId, names, { status = 'confirmed', pay = 'paid', method = 'cash' } = {}) => {
    T[key] = tok();
    const ref = 'EV-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    sql(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, purchaser_name, checkin_token, note) VALUES (${eventId}, ${q(ref)}, 'admin', ${q(status)}, ${q(method)}, ${q(pay)}, ${names.length}, ${q(names[0])}, ${q(T[key])}, 'Automatic check (temporary)')`);
    names.forEach((n, i) => sql(`INSERT INTO event_guests (booking_id, event_id, position, name) SELECT id, event_id, ${i + 1}, ${q(n)} FROM event_bookings WHERE checkin_token = ${q(T[key])}`));
  };
  mk('six', ev.id, ['Tmp Mary Smith', 'Tmp John Smith', 'Tmp Ann Smith', 'Tmp Bob Smith', 'Tmp Cat Smith', 'Tmp Alex Smith']);
  mk('twinA', ev.id, ['Tmp Linda Brown', 'Tmp Sam Grey']);
  mk('twinB', ev.id, ['Tmp Linda Brown']);
  mk('unpaid', ev.id, ['Tmp Pat Doyle'], { pay: 'unpaid' });
  mk('gone', ev.id, ['Tmp Carl Gone'], { status: 'cancelled' });
  mk('res', ev.id, ['Tmp Rhona Reserve', 'Tmp Ross Reserve']);
  mk('free', ev.id, ['Tmp Peter Single'], { pay: 'free', method: 'complimentary' });
  mk('jane', ev.id, ['Tmp Jane Single']);
  mk('am', ev.id, ['Tmp Anne-Marie O’Neill']);
  mk('future', fut.id, ['Tmp Fiona Future']);
  const now = new Date().toISOString();
  sql(`INSERT INTO checkin_tablets (name, token_hash, event_id, mode, state, created_by, paired_at, key_renewed_at, last_seen_at) VALUES ('Automatic check (temporary)', ${q(hash)}, ${ev.id}, 'test', 'active', 'smoke test', ${q(now)}, ${q(now)}, ${q(now)})`);
  tabletId = sql(`SELECT id FROM checkin_tablets WHERE token_hash = ${q(hash)}`)[0].id;
  tempEvents = [ev.id, fut.id];
  const st = await api('state');
  check('the temporary iPad sees the temporary event, open, TEST MODE', st.state === 'active' && st.mode === 'test' && st.event && st.event.name === 'Automatic check (temporary event)', st);
  const page = await fetch(BASE + '/self-checkin', { headers: { Cookie: cookie } });
  check('the check-in screens open for a set-up iPad', page.ok && (await page.text()).includes('Scan QR Code'));
  const pk = await api('pack');
  check('the iPad gets its copy of the guest list: every confirmed guest, names only (no emails or phone numbers)', pk.result === 'pack' && pk.pack.guests.length === 15 && !/@|07\d{9}/.test(JSON.stringify(pk.pack)), { got: pk.pack && pk.pack.guests.length });
  const six = await api('scan', { code: `${BASE}/c/${T.six}` });
  check('scanning a group of six shows six guests', six.result === 'booking' && six.guests.length === 6, six);
  const two = await api('checkin', { code: T.six, guests: [six.guests[0].id, six.guests[1].id] });
  check('two of the six check in (test)', two.result === 'done' && two.guests.every((g) => g.result === 'in'), two);
  check('scanning again shows those two as already in', (await api('scan', { code: T.six })).guests.filter((g) => g.in).length === 2);
  check('repeating the check-in isn’t counted twice', (await api('checkin', { code: T.six, guests: [six.guests[0].id] })).guests[0].result === 'already');
  check('another of the group checks in later by name', (await api('checkin', { name: 'tmp ann smith' })).guests[0].result === 'in');
  check('two guests with the same name go to Julie', (await api('find', { name: 'tmp linda brown' })).result === 'same_name');
  check('a booking to pay at the door goes to Julie', (await api('find', { name: 'Tmp Pat Doyle' })).result === 'see_julie');
  check('a cancelled booking goes to Julie', (await api('scan', { code: T.gone })).result === 'see_julie');
  check('a ticket for another event is refused', (await api('scan', { code: 'StagingSpringSupper000' })).result === 'other_event');
  check('a name not on the list isn’t found', (await api('find', { name: 'Nobody Here' })).result === 'not_found');
  check('accents and apostrophes don’t matter', (await api('find', { name: 'tmp anne marie oneill' })).result === 'one');
  check('a reservation and a complimentary booking check in', (await api('checkin', { name: 'Tmp Rhona Reserve' })).guests[0].result === 'in' && (await api('checkin', { name: 'Tmp Peter Single' })).guests[0].result === 'in');
  const realIns = () => sql(`SELECT COUNT(*) AS n FROM event_guests WHERE event_id = ${ev.id} AND checked_in_at IS NOT NULL`)[0].n;
  check('TEST MODE recorded nothing in the real attendance', realIns() === 0);

  console.log('\nOffline check-ins sent later');
  const jane = pk.pack.guests.find((g) => g[2] === 'Tmp Jane Single');
  const cid = crypto.randomBytes(16).toString('hex');
  const s1 = await api('sync', { ticket: pk.pack.ticket, items: [{ cid, gid: jane[0], at: new Date().toISOString() }] });
  check('an offline check-in is accepted when sent', s1.ok && s1.results[0].result === 'in', s1);
  const s2 = await api('sync', { ticket: pk.pack.ticket, items: [{ cid, gid: jane[0], at: new Date().toISOString() }] });
  check('…sending it again changes nothing', s2.ok && s2.results[0].result === 'in' && sql(`SELECT COUNT(*) AS n FROM checkin_test_attendance WHERE guest_id = ${jane[0]}`)[0].n === 1);
  check('a forged ticket is refused', (await api('sync', { ticket: pk.pack.ticket.replace(/\.[^.]+$/, '.forged'), items: [] })).ok === false);

  console.log('\nPause, close, LIVE');
  sql(`UPDATE checkin_tablets SET state = 'paused' WHERE id = ${tabletId}`);
  check('paused: the iPad says so and refuses check-ins', (await api('state')).state === 'paused' && (await api('find', { name: 'Tmp Jane Single' })).result === 'paused');
  sql(`UPDATE checkin_tablets SET state = 'closed' WHERE id = ${tabletId}`);
  check('closed: the iPad says so and refuses check-ins', (await api('state')).state === 'closed' && (await api('checkin', { name: 'Tmp Jane Single' })).result === 'closed');
  sql(`UPDATE checkin_tablets SET state = 'active', mode = 'live' WHERE id = ${tabletId}`);
  const live = await api('checkin', { name: 'Tmp Jane Single' });
  check('LIVE: a check-in goes to the attendance, marked iPad', live.guests && live.guests[0].result === 'in' && sql(`SELECT checked_in_by FROM event_guests WHERE name = 'Tmp Jane Single'`)[0].checked_in_by === 'iPad self check-in');
  const many = await Promise.all(Array.from({ length: 5 }, () => api('checkin', { name: 'Tmp Anne-Marie O’Neill' })));
  check('five check-ins for the same guest at once: counted once', many.filter((r) => r.guests && r.guests[0].result === 'in').length === 1);
  sql(`UPDATE checkin_tablets SET event_id = ${fut.id}, mode = 'test' WHERE id = ${tabletId}`);
  check('an event three months ahead can be chosen and used (TEST MODE)', (await api('state')).event.name === 'Automatic check (temporary future event)' && (await api('checkin', { name: 'Tmp Fiona Future' })).guests[0].result === 'in');
} catch (err) {
  failed++;
  console.log('  FAIL the check stopped: ' + (err && err.stack ? err.stack : err));
} finally {
  // Delete everything this check made, and nothing else. Only the staging database is touched.
  try {
    const evs = sql(`SELECT id FROM events WHERE name IN ('Automatic check (temporary event)', 'Automatic check (temporary future event)')`).map((e) => e.id);
    const tabs = sql(`SELECT id FROM checkin_tablets WHERE name = 'Automatic check (temporary)'`).map((t) => t.id);
    if (tabs.length) {
      sql(`DELETE FROM checkin_sync_log WHERE tablet_id IN (${tabs.join(',')})`);
      sql(`DELETE FROM checkin_help WHERE tablet_id IN (${tabs.join(',')})`);
      sql(`DELETE FROM checkin_tablets WHERE id IN (${tabs.join(',')})`);
    }
    if (evs.length) {
      const list = evs.join(',');
      sql(`DELETE FROM checkin_test_attendance WHERE event_id IN (${list})`);
      sql(`DELETE FROM checkin_help WHERE event_id IN (${list})`);
      sql(`DELETE FROM checkin_sync_log WHERE event_id IN (${list})`);
      sql(`DELETE FROM event_guests WHERE event_id IN (${list})`);
      sql(`DELETE FROM event_bookings WHERE event_id IN (${list})`);
      sql(`DELETE FROM events WHERE id IN (${list})`);
    }
    const left = sql(`SELECT (SELECT COUNT(*) FROM checkin_tablets WHERE name = 'Automatic check (temporary)') AS t, (SELECT COUNT(*) FROM events WHERE name LIKE 'Automatic check%') AS e, (SELECT COUNT(*) FROM event_bookings WHERE note = 'Automatic check (temporary)') AS b`)[0];
    check('tidied up: the temporary iPad, events and bookings are all gone (nothing else touched)', left.t === 0 && left.e === 0 && left.b === 0);
  } catch (err) { failed++; console.log('  FAIL tidying up: ' + err.message); }
}
console.log(`\nSTAGING CHECK: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
