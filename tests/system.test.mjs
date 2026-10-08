// Automated tests. Run with: npm test   (Node 22 or newer; no internet; uses the local WorkOS stand-in)
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { ukToday, isIsoDate, longDate } from '../src/lib/dates.js';
import * as av from '../src/bookings/availability.js';
import { squareMode as sqMode } from '../src/payments/square.js';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (f) => fs.readFileSync(path.join(root, 'tests', 'fixtures', f));
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 300) : '')); }
}

function start(port, extraEnv, nodeArgs = []) {
  const dbFile = path.join(root, 'dev', '.local', `test-${port}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', ...nodeArgs, 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start on ' + port)), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('local test copy')) { clearTimeout(timer); resolve({ child, base: `http://localhost:${port}`, mock: `http://localhost:${port + 100}`, dbFile }); } });
    // (the database-failure test server logs its deliberate failures; those expected lines are not shown)
    child.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings|simulated database failure/.test(t)) process.stderr.write(t); });
  });
}

class Jar {
  constructor() { this.c = {}; }
  add(res) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (!v || attrs.some((a) => /max-age=0\b/i.test(a.trim()))) delete this.c[k]; else this.c[k] = v;
    }
  }
  header() { return Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function req(base, p, { jar, method = 'GET', body, headers = {}, origin } = {}) {
  const h = { ...headers };
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET' && origin !== null) h.Origin = origin || base;
  const res = await fetch(base + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}

const text = async (base, p, opts) => (await req(base, p, opts)).text();
const csrfFrom = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];

async function signIn(srv, who = 'owner') {
  const jar = new Jar();
  const login = await req(srv.base, '/admin/login', { jar });
  if (!login.headers.get('location')) throw new Error(`sign-in did not start (status ${login.status})`);
  const authPage = await (await fetch(login.headers.get('location'))).text();
  const link = (authPage.match(new RegExp(`id="as-${who}" href="([^"]+)"`)) || [])[1];
  const cb = new URL(link.replace(/&amp;/g, '&'));
  const res = await req(srv.base, cb.pathname + cb.search, { jar });
  return { jar, res, callback: cb.pathname + cb.search };
}

async function submit(srv, jar, p, fields, files = {}, origin) {
  const page = await text(srv.base, p.replace(/\/(delete|move|toggle)$/, '').replace(/\/new$/, '/new'), { jar });
  const fd = new FormData();
  fd.append('_csrf', csrfFrom(page) || jar.c.nw_csrf || '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.buf], { type: f.type }), f.name);
  return req(srv.base, p, { jar, method: 'POST', body: fd, origin });
}

function nextWednesday(offsetWeeks = 0) {
  const today = ukToday();
  const d = new Date(today + 'T12:00:00Z');
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * offsetWeeks);
  return d.toISOString().slice(0, 10);
}
const addDays = (n) => { const d = new Date(ukToday() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const localDateTime = (hoursFromNow) => {
  const d = new Date(Date.now() + hoursFromNow * 3600_000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d).replace(' ', 'T');
};

const PAGES = ['/', '/whos-on', '/events', '/private-readings', '/bookings', '/meditations', '/development-circle', '/about', '/charity',
  '/faqs', '/find-us', '/gallery', '/reviews', '/teaching-videos', '/live', '/privacy'];
const PROTECTED = ['/admin', '/admin/settings', '/admin/wording', '/admin/wording/mission', '/admin/whos-on', '/admin/whos-on/new',
  '/admin/events', '/admin/events/new', '/admin/announcements', '/admin/charity', '/admin/faqs', '/admin/social-links',
  '/admin/reviews', '/admin/gallery', '/admin/teaching-videos', '/admin/live', '/admin/music', '/admin/backups', '/admin/backups/download'];

// The total number of checks in a complete run, so an early stop is reported as checks not run
const EXPECTED_CHECKS = 365;

{
  const probe = new DatabaseSync(':memory:');
  console.log(`Node ${process.version}, SQLite ${probe.prepare('SELECT sqlite_version() AS v').get().v}, ${process.platform}-${process.arch}`);
  probe.close();
}

const servers = [];
try {
  const dev = await start(8801, {});
  const locked = await start(8802, { NO_SIGNIN: '1', NO_TURNSTILE: '1' });
  const prod = await start(8803, { SITE_URL: 'http://localhost:8803' });
  servers.push(dev, locked, prod);
  const db = new DatabaseSync(dev.dbFile);

  console.log('\nPublic pages');
  for (const p of PAGES) {
    const res = await req(dev.base, p);
    const html = await res.text();
    const h1s = (html.match(/<h1[\s>]/g) || []).length;
    const noAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/g) || []).length;
    check(`${p}: loads, one heading, images described, title/description/canonical`,
      res.status === 200 && h1s === 1 && noAlt === 0 && html.includes('<html lang="en-GB">') && /<title>[^<]+<\/title>/.test(html) &&
      /<meta name="description" content="[^"]{20,}"/.test(html) && html.includes('<link rel="canonical" href="https://newwaysmediumshipdevelopmentcentre.com'),
      `status ${res.status}, h1 ${h1s}, noAlt ${noAlt}`);
  }
  check('unknown address shows the not-found page', (await req(dev.base, '/no-such-page')).status === 404);
  check('trailing slash is tidied', (await req(dev.base, '/about/')).headers.get('location') === '/about');

  console.log('\nGoogle: test address hidden, real address indexable');
  const devHome = await req(dev.base, '/');
  check('test address: noindex header and tag, robots.txt blocks all', devHome.headers.get('x-robots-tag')?.includes('noindex') &&
    (await devHome.text()).includes('content="noindex, nofollow"') && (await text(dev.base, '/robots.txt')).includes('Disallow: /\n'));
  const prodHome = await req(prod.base, '/');
  const robots = await text(prod.base, '/robots.txt');
  check('real address: indexable, robots.txt blocks only Admin, sitemap has 16 pages', !prodHome.headers.get('x-robots-tag') &&
    !(await prodHome.text()).includes('noindex') && robots.includes('Disallow: /admin') &&
    ((await text(prod.base, '/sitemap.xml')).match(/<loc>/g) || []).length === 16);
  const h = devHome.headers;
  check('security headers on pages', (h.get('content-security-policy') || '').includes("frame-ancestors 'none'") && h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY');

  console.log('\nAdmin is locked when sign-in is not configured');
  check('locked: Admin pages', (await req(locked.base, '/admin')).status === 503 && (await req(locked.base, '/admin/login')).status === 503);
  check('locked: changes refused', (await req(locked.base, '/admin/settings', { method: 'POST', body: 'x=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 403);

  console.log('\nEvery Admin page and change needs the owner’s session');
  for (const p of PROTECTED) {
    const res = await req(dev.base, p);
    const body = await res.text();
    check(`${p} without signing in shows only the sign-in page`, res.status === 401 && body.includes('href="/admin/login"') && !body.includes('name="_csrf"'));
  }
  for (const p of ['/admin/settings', '/admin/whos-on/new', '/admin/events/1/delete', '/admin/faqs/1/toggle', '/admin/logout']) {
    check(`POST ${p} without signing in is refused`, (await req(dev.base, p, { method: 'POST', body: 'x=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 403);
  }
  const adminHead = await req(dev.base, '/admin');
  check('Admin pages are never cached or indexed', adminHead.headers.get('cache-control') === 'no-store' && adminHead.headers.get('x-robots-tag')?.includes('noindex'));

  console.log('\nSigning in (WorkOS AuthKit flow)');
  const jar0 = new Jar();
  const login = await req(dev.base, '/admin/login', { jar: jar0 });
  if (!login.headers.get('location')) throw new Error(`/admin/login did not redirect to sign-in (status ${login.status}); later checks cannot run`);
  const loc = new URL(login.headers.get('location'));
  const signinCookie = login.headers.getSetCookie()[0] || '';
  check('sign-in goes to AuthKit with PKCE and a one-time state', login.status === 302 && loc.pathname === '/user_management/authorize' &&
    loc.searchParams.get('provider') === 'authkit' && loc.searchParams.get('code_challenge_method') === 'S256' && loc.searchParams.get('code_challenge')?.length >= 43 &&
    loc.searchParams.get('state')?.length >= 30 && loc.searchParams.get('redirect_uri') === dev.base + '/admin/callback');
  check('sign-in state cookie is HttpOnly, short-lived, Admin-only', /HttpOnly/.test(signinCookie) && /Max-Age=600/.test(signinCookie) && /Path=\/admin/.test(signinCookie) && /SameSite=Lax/.test(signinCookie));

  const forged = await signIn(dev, 'owner');
  const tampered = forged.callback.replace(/state=[^&]+/, 'state=forged-state-value-1234567890');
  const fresh = await signIn(dev, 'owner');      // a real sign-in, used below
  const jarBad = new Jar(); jarBad.c = { ...forged.jar.c };
  const badState = await req(dev.base, tampered, { jar: new Jar() });
  check('a callback with the wrong or missing state is refused', badState.status === 303 && badState.headers.get('location') === '/admin?signin=expired' && !badState.headers.getSetCookie().some((c) => c.startsWith('nw_admin=') && !/Max-Age=0/.test(c)));
  const reuse = await req(dev.base, fresh.callback, { jar: new Jar() });
  check('a sign-in link cannot be reused', reuse.headers.get('location') === '/admin?signin=expired');

  const other = await signIn(dev, 'other');
  check('a different account is refused', other.res.status === 403 && (await other.res.text()).includes('isn’t allowed') && !other.jar.c.nw_admin);
  const unverified = await signIn(dev, 'unverified');
  check('the owner email without a verified address is refused', unverified.res.status === 403 && !unverified.jar.c.nw_admin);

  const owner = fresh;
  const sessionCookie = owner.res.headers.getSetCookie().find((c) => c.startsWith('nw_admin=')) || '';
  check('the owner signs in and lands on Admin', owner.res.status === 303 && owner.res.headers.get('location') === '/admin' && !!owner.jar.c.nw_admin);
  check('session cookie: HttpOnly, Admin-only, stays signed in for 30 days', /HttpOnly/.test(sessionCookie) && /Path=\/admin/.test(sessionCookie) && /Max-Age=2592000/.test(sessionCookie) && /SameSite=Lax/.test(sessionCookie));
  const dash = await text(dev.base, '/admin', { jar: owner.jar });
  check('dashboard shows who is signed in, with a Sign out button', dash.includes('Signed in as owner@example.test') && dash.includes('action="/admin/logout"'));
  const sessionRow = db.prepare('SELECT * FROM admin_sessions ORDER BY created_at DESC LIMIT 1').get();
  check('only a hash of the session is stored, and the WorkOS token is encrypted', /^[0-9a-f]{64}$/.test(sessionRow.id_hash) && sessionRow.id_hash !== owner.jar.c.nw_admin && /^[\w-]+\.[\w-]+$/.test(sessionRow.refresh_token));
  check('the owner account is now bound', db.prepare('SELECT workos_user_id FROM owner').get()?.workos_user_id === 'user_owner_01');
  const impostor = await signIn(dev, 'impostor');
  check('a new account with the same email is still refused once the owner is bound', impostor.res.status === 403 && !impostor.jar.c.nw_admin);

  console.log('\nSessions stay valid only while WorkOS agrees');
  const setSession = (sql, ...args) => db.prepare(`UPDATE admin_sessions SET ${sql} WHERE id_hash = ?`).run(...args, sessionRow.id_hash);
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const statsBefore = await (await fetch(dev.mock + '/__test/stats')).json();
  setSession('checked_at = ?', ago(20));
  check('after 10 minutes the session is re-confirmed with WorkOS', (await req(dev.base, '/admin', { jar: owner.jar })).status === 200 &&
    (await (await fetch(dev.mock + '/__test/stats')).json()).authenticateCalls === statsBefore.authenticateCalls + 1);
  await fetch(dev.mock + '/__test/fail?count=1');
  setSession('checked_at = ?', ago(20));
  check('a brief WorkOS outage does not sign Gary out', (await req(dev.base, '/admin', { jar: owner.jar })).status === 200);
  await fetch(dev.mock + '/__test/fail?count=1');
  setSession('checked_at = ?', ago(120));
  check('a long outage blocks Admin until WorkOS confirms again', (await req(dev.base, '/admin', { jar: owner.jar })).status === 401 && !!db.prepare('SELECT 1 FROM admin_sessions WHERE id_hash = ?').get(sessionRow.id_hash));
  setSession('checked_at = ?', ago(0));
  setSession('last_seen_at = ?', ago(15 * 24 * 60));
  check('14 days without use signs out', (await req(dev.base, '/admin', { jar: owner.jar })).status === 401 && !db.prepare('SELECT 1 FROM admin_sessions WHERE id_hash = ?').get(sessionRow.id_hash));
  const s2 = await signIn(dev, 'owner');
  const row2 = db.prepare('SELECT id_hash FROM admin_sessions ORDER BY created_at DESC LIMIT 1').get();
  db.prepare('UPDATE admin_sessions SET expires_at = ? WHERE id_hash = ?').run(ago(1), row2.id_hash);
  check('the 30-day limit signs out', (await req(dev.base, '/admin', { jar: s2.jar })).status === 401);
  const s3 = await signIn(dev, 'owner');
  const row3 = db.prepare('SELECT id_hash FROM admin_sessions ORDER BY created_at DESC LIMIT 1').get();
  await fetch(dev.mock + '/__test/revoke-all');
  db.prepare('UPDATE admin_sessions SET checked_at = ? WHERE id_hash = ?').run(ago(20), row3.id_hash);
  check('ending the session at WorkOS (password reset, sign out everywhere) ends it here', (await req(dev.base, '/admin', { jar: s3.jar })).status === 401 && !db.prepare('SELECT 1 FROM admin_sessions WHERE id_hash = ?').get(row3.id_hash));

  const g = (await signIn(dev, 'owner')).jar;   // Gary, signed in, for the rest of the tests
  check('signed in again', (await req(dev.base, '/admin', { jar: g })).status === 200);

  console.log('\nChanges need the security token and must come from this site');
  check('change refused without the security token', (await req(dev.base, '/admin/settings', { jar: g, method: 'POST', body: '_csrf=wrong&x=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 403);
  check('change refused from another website', (await submit(dev, g, '/admin/settings', {}, {}, 'https://evil.example')).status === 403);

  console.log('\nCentre Settings: change once, shows everywhere');
  const settingsHtml = await text(dev.base, '/admin/settings', { jar: g });
  const values = {};
  for (const m of settingsHtml.matchAll(/<input id="f-[^"]+" name="([^"]+)"[^>]*?value="([^"]*)"/g)) values[m[1]] = m[2].replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  for (const m of settingsHtml.matchAll(/<textarea id="f-[^"]+" name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) values[m[1]] = m[2].replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const savedSettings = await submit(dev, g, '/admin/settings', { ...values, entry_price: '6.50', circle_price: '4', doors_open: '6:45pm', parking_info: 'Free parking beside the building.', directions_link: 'https://maps.app.goo.gl/TestExactLink' });
  const [home2, whos2, faqs2, find2] = await Promise.all(['/', '/whos-on', '/faqs', '/find-us'].map((p) => text(dev.base, p)));
  check('settings save and update Home, Who’s On, FAQs and Find Us', savedSettings.status === 303 && home2.includes('Entry £6.50') && whos2.includes('<dd>£6.50</dd>') &&
    faqs2.includes('Doors open at 6:45pm.') && faqs2.includes('Is there parking?') && find2.includes('href="https://maps.app.goo.gl/TestExactLink"'));
  const badSettings = await submit(dev, g, '/admin/settings', { ...values, entry_price: 'five pounds' });
  check('a mistake is explained and nothing is saved', badSettings.status === 422 && (await badSettings.text()).includes('Enter an amount like 5 or 5.50.') && (await text(dev.base, '/whos-on')).includes('Entry £6.50'));

  console.log('\nWho’s On');
  const wed = nextWednesday(1);
  const newMedium = await submit(dev, g, '/admin/whos-on/new', { date: wed, name: 'Stage Two Medium <script>x</script>', location: 'Perth', description: 'First paragraph.\n\nSecond paragraph.', visible: '1' },
    { photo_key: { buf: fixture('test-portrait.jpg'), type: 'image/jpeg', name: 'portrait.jpg' } });
  const m1 = db.prepare("SELECT * FROM mediums WHERE name LIKE 'Stage Two Medium%'").get();
  const whos3 = await text(dev.base, '/whos-on');
  check('add a medium with a photo', newMedium.status === 303 && newMedium.headers.get('location') === '/admin/whos-on?flash=added' && !!m1 && /^img\/\d{4}\/\d{2}\/medium-[a-z0-9x]+\.jpg$/.test(m1.photo_key));
  check('the medium and photo appear on Who’s On, with typed code shown as text', whos3.includes('Stage Two Medium &lt;script&gt;x&lt;/script&gt;') && whos3.includes(encodeURIComponent(m1.photo_key)) && !whos3.includes('<script>x'));
  const photo = await req(dev.base, '/media/' + m1.photo_key);
  check('the photo is served from storage with long-term caching', photo.status === 200 && photo.headers.get('content-type') === 'image/jpeg' && photo.headers.get('cache-control').includes('immutable'));
  const thursday = addDays(((4 - new Date(ukToday() + 'T12:00:00Z').getUTCDay() + 7) % 7) || 7);
  const notWed = await submit(dev, g, '/admin/whos-on/new', { date: thursday, name: 'Wrong day', visible: '1' });
  check('a date that is not a Wednesday is explained', notWed.status === 422 && (await notWed.text()).includes('Please choose a Wednesday'));
  const pastWed = await submit(dev, g, '/admin/whos-on/new', { date: nextWednesday(-1), name: 'Too late', visible: '1' });
  check('a Wednesday that has passed is explained', pastWed.status === 422 && (await pastWed.text()).includes('already passed'));
  const noName = await submit(dev, g, '/admin/whos-on/new', { date: wed, name: '', visible: '1' });
  check('a missing name is explained', noName.status === 422 && (await noName.text()).includes('This is needed.'));
  const fake = await submit(dev, g, '/admin/whos-on/new', { date: wed, name: 'Fake photo test', visible: '1' }, { photo_key: { buf: Buffer.from('this is not really a photo'), type: 'image/jpeg', name: 'fake.jpg' } });
  check('a file that is not really a photo is refused and nothing is saved', fake.status === 400 && (await fake.text()).includes('isn’t a photo') && !db.prepare("SELECT 1 FROM mediums WHERE name = 'Fake photo test'").get());

  const oldKey = m1.photo_key;
  const edited = await submit(dev, g, `/admin/whos-on/${m1.id}`, { date: wed, name: 'Stage Two Medium', location: 'Perth', description: 'Updated.', visible: '1' },
    { photo_key: { buf: fixture('test-poster.jpg'), type: 'image/jpeg', name: 'new.jpg' } });
  const m1b = db.prepare('SELECT * FROM mediums WHERE id = ?').get(m1.id);
  check('editing replaces the photo and the old one is removed from storage', edited.status === 303 && m1b.photo_key !== oldKey && (await req(dev.base, '/media/' + oldKey)).status === 404 && (await text(dev.base, '/whos-on')).includes('Updated.'));
  await submit(dev, g, `/admin/whos-on/${m1.id}/toggle`, {});
  check('Hide takes it off the website', !(await text(dev.base, '/whos-on')).includes('Stage Two Medium'));
  await submit(dev, g, `/admin/whos-on/${m1.id}/toggle`, {});
  check('Show puts it back', (await text(dev.base, '/whos-on')).includes('Stage Two Medium'));
  await submit(dev, g, '/admin/whos-on/new', { date: wed, name: 'Same Night Second', visible: '1' });
  const second = db.prepare("SELECT id FROM mediums WHERE name = 'Same Night Second'").get();
  const before = await text(dev.base, '/whos-on');
  await submit(dev, g, `/admin/whos-on/${second.id}/move`, { dir: 'up' });
  const after = await text(dev.base, '/whos-on');
  check('Move up changes the order for the same Wednesday', before.indexOf('Stage Two Medium') < before.indexOf('Same Night Second') && after.indexOf('Same Night Second') < after.indexOf('Stage Two Medium'));
  const listHtml = await text(dev.base, '/admin/whos-on', { jar: g });
  check('the Admin list shows past entries separately and marks hidden ones', listHtml.includes('Past entries') && listHtml.includes('[Test] Hidden medium') && listHtml.includes('Hidden'));
  const keyBeforeDelete = m1b.photo_key;
  const del = await submit(dev, g, `/admin/whos-on/${m1.id}/delete`, {});
  check('Delete removes the entry and its photo', del.headers.get('location') === '/admin/whos-on?flash=deleted' && !(await text(dev.base, '/whos-on')).includes('Stage Two Medium') && (await req(dev.base, '/media/' + keyBeforeDelete)).status === 404);

  console.log('\nEvents');
  const ev = await submit(dev, g, '/admin/events/new', { name: 'Stage Two Event', date: addDays(10), time_text: '7pm', summary: 'Short.', details: 'Full details.', ticket_info: 'Tickets £10', ticket_url: 'square.link/u/stage2', visible: '1' },
    { poster_key: { buf: fixture('test-logo.png'), type: 'image/png', name: 'poster.png' } });
  const evRow = db.prepare("SELECT * FROM events WHERE name = 'Stage Two Event'").get();
  const evPage = await text(dev.base, '/events');
  check('add an event with a poster; the ticket link gets https://', ev.status === 303 && evRow.ticket_url === 'https://square.link/u/stage2' && evRow.poster_key.endsWith('.png') && evPage.includes('href="https://square.link/u/stage2"'));
  const badLink = await submit(dev, g, '/admin/events/new', { name: 'Bad link', date: addDays(10), ticket_url: 'javascript:alert(1)', visible: '1' });
  check('unsafe links are refused', badLink.status === 422 && (await badLink.text()).includes('https://'));
  check('the event appears on Bookings with its ticket button', (await text(dev.base, '/bookings')).includes('Stage Two Event'));

  console.log('\nAnnouncements');
  await submit(dev, g, '/admin/announcements/new', { title: 'Closed this Wednesday', message: 'Back next week.', importance: 'urgent', starts_at: '', ends_at: '', active: '1' });
  check('an urgent announcement shows at the top of every page', (await text(dev.base, '/')).includes('Closed this Wednesday') && (await text(dev.base, '/events')).includes('announcement-urgent'));
  await submit(dev, g, '/admin/announcements/new', { title: 'Future notice', message: '', importance: 'notice', starts_at: localDateTime(48), ends_at: '', active: '1' });
  const annList = await text(dev.base, '/admin/announcements', { jar: g });
  check('a scheduled announcement waits for its start time', !(await text(dev.base, '/')).includes('Future notice') && annList.includes('Scheduled'));
  const badTimes = await submit(dev, g, '/admin/announcements/new', { title: 'Wrong way round', importance: 'notice', starts_at: localDateTime(48), ends_at: localDateTime(24), active: '1' });
  check('a stop time before the start time is explained', badTimes.status === 422 && (await badTimes.text()).includes('needs to be after'));
  const ann = db.prepare("SELECT id FROM announcements WHERE title = 'Closed this Wednesday'").get();
  await submit(dev, g, `/admin/announcements/${ann.id}/toggle`, {});
  check('switching an announcement off removes it', !(await text(dev.base, '/')).includes('Closed this Wednesday'));
  db.prepare("UPDATE announcements SET active = 1, ends_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), ann.id);
  check('an announcement stops by itself at its end time', !(await text(dev.base, '/')).includes('Closed this Wednesday'));

  console.log('\nCommunity & Charity');
  await submit(dev, g, '/admin/charity/new', { charity_name: 'Stage Two Charity', amount_pence: '£1,250.50', date_label: 'December 2026', description: '', visible: '1' },
    { image_key: { buf: fixture('test-logo.png'), type: 'image/png', name: 'logo.png' } });
  const charityPage = await text(dev.base, '/charity');
  check('a new charity total appears first, with its amount', charityPage.includes('£1,250.50') && charityPage.indexOf('Stage Two Charity') < charityPage.indexOf('Help for Kids'));
  const badAmount = await submit(dev, g, '/admin/charity/new', { charity_name: 'Bad', amount_pence: 'lots', visible: '1' });
  check('an amount that is not a number is explained', badAmount.status === 422 && (await badAmount.text()).includes('Enter an amount'));
  const ch = db.prepare("SELECT id FROM charity_totals WHERE charity_name = 'Stage Two Charity'").get();
  await submit(dev, g, `/admin/charity/${ch.id}/move`, { dir: 'down' });
  const charity2 = await text(dev.base, '/charity');
  check('Move down changes the order', charity2.indexOf('Help for Kids') < charity2.indexOf('Stage Two Charity'));

  console.log('\nFAQs');
  await submit(dev, g, '/admin/faqs/new', { question: 'Is there a lift?', answer: 'Yes. Entry is still {Entry price}.', visible: '1' });
  check('a new FAQ appears, filled in from Centre Settings', (await text(dev.base, '/faqs')).includes('Yes. Entry is still £6.50.'));
  const religious = db.prepare("SELECT id FROM faqs WHERE question LIKE 'Do I need to be religious%'").get();
  await submit(dev, g, `/admin/faqs/${religious.id}`, { question: 'Do I need to be religious or a Spiritualist to attend?', answer: 'Test answer from Admin.', visible: '1' });
  check('answering the empty FAQ makes it appear', (await text(dev.base, '/faqs')).includes('Test answer from Admin.'));

  console.log('\nSocial links');
  await submit(dev, g, '/admin/social-links/new', { platform: 'Facebook', url: 'facebook.com/newwaystest', visible: '1' });
  check('a social link appears in the footer and on Find Us', (await text(dev.base, '/')).includes('href="https://facebook.com/newwaystest"') && (await text(dev.base, '/find-us')).includes('Follow New Way’s'));

  // ================= Stage 3 =================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
  async function share(fields, { stamp, origin } = {}) {
    const html = await text(dev.base, '/reviews');
    const t = stamp || (html.match(/name="t" value="([^"]+)"/) || [])[1];
    return req(dev.base, '/reviews', { method: 'POST', origin, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ t, website: '', 'cf-turnstile-response': TOKEN, consent: '1', ...fields }).toString() });
  }
  const reviewCount = () => db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n;

  console.log('\nVisitor experiences: never published until approved');
  const reviewsHtml = await text(dev.base, '/reviews');
  check('the share form has the Turnstile check, consent box and spam trap', reviewsHtml.includes('data-sitekey="1x00000000000000000000AA"') && reviewsHtml.includes('name="consent"') && reviewsHtml.includes('name="website"') && reviewsHtml.includes('/privacy'));
  const stamp = (reviewsHtml.match(/name="t" value="([^"]+)"/) || [])[1];
  const n0 = reviewCount();
  const fast = await share({ name: 'Too Fast', body: 'Sent the instant the page opened.' }, { stamp });
  check('a form sent instantly (a program) is quietly ignored', fast.status === 303 && reviewCount() === n0);
  await sleep(3200);
  const sent = await share({ name: 'Margaret <b>T</b>', rating: '5', body: 'A wonderful evening <script>alert(1)</script>. Thank you.', status: 'approved', featured: '1' }, { stamp });
  const mine = db.prepare("SELECT * FROM reviews WHERE name LIKE 'Margaret%'").get();
  check('a genuine experience is accepted and thanked', sent.status === 303 && sent.headers.get('location') === '/reviews?thanks=1#share' && (await text(dev.base, '/reviews?thanks=1')).includes('will appear once it has been approved'));
  check('it is saved as AWAITING APPROVAL even if the form tries to say otherwise', mine && mine.status === 'pending' && mine.featured === 0);
  check('it is NOT shown anywhere on the website', !(await text(dev.base, '/reviews')).includes('Margaret') && !(await text(dev.base, '/')).includes('Margaret'));
  check('without the consent box ticked it is refused', (await share({ name: 'No Consent', body: 'I did not tick the consent box here.', consent: '' }, { stamp })).status === 422 && !db.prepare("SELECT 1 FROM reviews WHERE name = 'No Consent'").get());
  const badCheck = await share({ name: 'Bot Check', body: 'This one fails the Turnstile check.', 'cf-turnstile-response': 'wrong-token' }, { stamp });
  check('failing the Turnstile check is refused', badCheck.status === 400 && (await badCheck.text()).includes('security check') && !db.prepare("SELECT 1 FROM reviews WHERE name = 'Bot Check'").get());
  check('a filled-in trap field is quietly ignored', (await share({ name: 'Trap', body: 'Spam program filling every field.', website: 'http://spam.example' }, { stamp })).status === 303 && !db.prepare("SELECT 1 FROM reviews WHERE name = 'Trap'").get());
  check('a forged time stamp is refused', (await share({ name: 'Forged', body: 'With a made-up time stamp.' }, { stamp: '1700000000000.deadbeef' })).status === 400);
  check('sending from another website is refused', (await share({ name: 'Elsewhere', body: 'Posted from another website.' }, { stamp, origin: 'https://evil.example' })).status === 403);
  await share({ name: 'Second Visitor', body: 'Another lovely evening at New Way’s.' }, { stamp });
  const limited = await share({ name: 'Fourth Try', body: 'One too many from the same connection.' }, { stamp });
  check('more than 3 in an hour from one connection are paused', limited.status === 429 && !db.prepare("SELECT 1 FROM reviews WHERE name = 'Fourth Try'").get());
  check('when Turnstile is not set up, sharing is closed', (await text(locked.base, '/reviews')).includes('not open yet') && (await req(locked.base, '/reviews', { method: 'POST', body: 'name=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 503);

  const adminReviews = await text(dev.base, '/admin/reviews', { jar: g });
  check('Admin shows it AWAITING APPROVAL, with typed code shown as text', adminReviews.includes('AWAITING APPROVAL') && adminReviews.includes('Margaret &lt;b&gt;T&lt;/b&gt;') && adminReviews.includes('&lt;script&gt;'));
  check('the dashboard shows how many are waiting', (await text(dev.base, '/admin', { jar: g })).includes('2 awaiting approval'));
  await submit(dev, g, `/admin/reviews/${mine.id}/approve`, {});
  const pubReviews = await text(dev.base, '/reviews');
  check('once approved it appears, safely', pubReviews.includes('Margaret &lt;b&gt;T&lt;/b&gt;') && !pubReviews.includes('<script>alert(1)') && !(await text(dev.base, '/')).includes('Margaret'));
  await submit(dev, g, `/admin/reviews/${mine.id}/feature`, {});
  check('Feature puts it on the Home screen', (await text(dev.base, '/')).includes('Margaret'));
  await submit(dev, g, `/admin/reviews/${mine.id}/hide`, {});
  check('Hide takes it off the website (and off Home)', !(await text(dev.base, '/reviews')).includes('Margaret') && !(await text(dev.base, '/')).includes('Margaret'));
  await submit(dev, g, `/admin/reviews/${mine.id}/show`, {});
  check('Show again brings it back', (await text(dev.base, '/reviews')).includes('Margaret'));
  const secondReview = db.prepare("SELECT id FROM reviews WHERE name = 'Second Visitor'").get();
  await submit(dev, g, `/admin/reviews/${secondReview.id}/reject`, {});
  check('a rejected experience is never shown', !(await text(dev.base, '/reviews')).includes('Second Visitor'));
  db.prepare('UPDATE reviews SET decided_at = ? WHERE id = ?').run(new Date(Date.now() - 31 * 86400_000).toISOString(), secondReview.id);
  await text(dev.base, '/admin/reviews', { jar: g });
  check('rejected experiences are deleted after 30 days', !db.prepare('SELECT 1 FROM reviews WHERE id = ?').get(secondReview.id));
  await submit(dev, g, `/admin/reviews/${mine.id}/delete`, {});
  check('Delete removes it permanently', !db.prepare('SELECT 1 FROM reviews WHERE id = ?').get(mine.id) && !(await text(dev.base, '/reviews')).includes('Margaret'));

  console.log('\nGallery');
  const noPhoto = await submit(dev, g, '/admin/gallery/new', { caption: 'Nothing chosen', visible: '1' });
  check('adding without a photo is explained', noPhoto.status === 422 && (await noPhoto.text()).includes('Please choose a photo.'));
  await submit(dev, g, '/admin/gallery/new', { caption: 'Summer evening', visible: '1' },
    { image_key: { buf: fixture('test-poster.jpg'), type: 'image/jpeg', name: 'big.jpg' }, image_key__thumb: { buf: fixture('test-logo.png'), type: 'image/png', name: 'small.png' } });
  const gp = db.prepare("SELECT * FROM gallery_photos WHERE caption = 'Summer evening'").get();
  const galleryHtml = await text(dev.base, '/gallery');
  check('a photo is added with a small preview copy; the page uses the small copy and opens the large one', gp && gp.thumb_key && galleryHtml.includes(`src="/media/${encodeURIComponent(gp.thumb_key)}"`) && galleryHtml.includes(`href="/media/${encodeURIComponent(gp.image_key)}"`) && galleryHtml.includes('Summer evening'));
  const fd = new FormData();
  const galleryPage = await text(dev.base, '/admin/gallery', { jar: g });
  fd.append('_csrf', csrfFrom(galleryPage));
  for (const n of [1, 2]) { fd.append('photos', new Blob([fixture('test-portrait.jpg')], { type: 'image/jpeg' }), `p${n}.jpg`); fd.append('photos__thumb', new Blob([fixture('test-logo.png')], { type: 'image/png' }), `t${n}.png`); }
  const before3 = db.prepare('SELECT COUNT(*) AS n FROM gallery_photos').get().n;
  const multi = await req(dev.base, '/admin/gallery/upload', { jar: g, method: 'POST', body: fd });
  check('several photos can be added at once', multi.headers.get('location') === '/admin/gallery?flash=uploaded' && db.prepare('SELECT COUNT(*) AS n FROM gallery_photos').get().n === before3 + 2);
  await submit(dev, g, `/admin/gallery/${gp.id}/delete`, {});
  check('deleting a photo removes both copies from storage', (await req(dev.base, '/media/' + gp.image_key)).status === 404 && (await req(dev.base, '/media/' + gp.thumb_key)).status === 404);

  console.log('\nTeaching videos (YouTube only)');
  const addVid = await submit(dev, g, '/admin/teaching-videos/new', { youtube_url: 'https://youtu.be/dQw4w9WgXcQ?si=share', title: 'Feeling, not forcing', description: 'An introduction.', category: 'Development', embed_ok: '1' });
  const vid = db.prepare("SELECT * FROM teaching_videos WHERE title = 'Feeling, not forcing'").get();
  check('a video is added from a YouTube share link, hidden while you prepare it', addVid.headers.get('location') === '/admin/teaching-videos?flash=added-hidden' && vid.youtube_id === 'dQw4w9WgXcQ' && vid.youtube_url === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' && vid.visible === 0);
  check('a hidden video is not on the website', !(await text(dev.base, '/teaching-videos')).includes('Feeling, not forcing'));
  await submit(dev, g, `/admin/teaching-videos/${vid.id}/toggle`, {});
  const videosHtml = await text(dev.base, '/teaching-videos');
  check('Show puts it on the website: tap-to-play player, category heading, Watch on YouTube', videosHtml.includes('data-yt="dQw4w9WgXcQ"') && videosHtml.includes('Development') && videosHtml.includes('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"') && videosHtml.includes('i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg') && !videosHtml.includes('<iframe'));
  const notYt = await submit(dev, g, '/admin/teaching-videos/new', { youtube_url: 'https://vimeo.com/12345', title: 'Wrong site', embed_ok: '1' });
  check('a link that is not YouTube is explained', notYt.status === 422 && (await notYt.text()).includes('YouTube video link'));
  const blocked = await submit(dev, g, '/admin/teaching-videos/new', { youtube_url: 'https://www.youtube.com/watch?v=BLOCKED0001', title: 'Owner blocks embedding', embed_ok: '1', visible: '1' });
  const bv = db.prepare("SELECT * FROM teaching_videos WHERE youtube_id = 'BLOCKED0001'").get();
  const blockedHtml = await text(dev.base, '/teaching-videos');
  check('if YouTube does not allow embedding, visitors get a Watch on YouTube button instead', blocked.headers.get('location') === '/admin/teaching-videos?flash=noembed' && bv.embed_ok === 0 && !blockedHtml.includes('data-yt="BLOCKED0001"') && blockedHtml.includes('watch?v=BLOCKED0001'));
  await submit(dev, g, `/admin/teaching-videos/${vid.id}/delete`, {});
  check('removing a video only removes the entry from New Way’s', !(await text(dev.base, '/teaching-videos')).includes('Feeling, not forcing') && !db.prepare('SELECT 1 FROM teaching_videos WHERE id = ?').get(vid.id));
  check('no video files are ever stored', db.prepare("SELECT COUNT(*) AS n FROM media WHERE content_type LIKE 'video/%'").get().n === 0);

  console.log('\nLive (YouTube Live)');
  await submit(dev, g, '/admin/live', { youtube_url: 'https://www.youtube.com/live/abcDEF12345?feature=share', title: 'Wednesday Live Service', description: 'Join us live.', scheduled_at: localDateTime(24), embed_ok: '1' });
  const live1 = await text(dev.base, '/live');
  check('while off, Live shows “No live broadcast at the moment” and the next broadcast', live1.includes('No live broadcast at the moment') && live1.includes('Wednesday Live Service') && !live1.includes('LIVE NOW'));
  await submit(dev, g, '/admin/live/on', {});
  const [home4, live2] = await Promise.all([text(dev.base, '/'), text(dev.base, '/live')]);
  check('switching on shows LIVE NOW on every page', home4.includes('LIVE NOW') && (await text(dev.base, '/events')).includes('class="live-now press"'));
  check('Live shows the stream (tap to play) and a Watch on YouTube button', live2.includes('data-yt="abcDEF12345"') && live2.includes('href="https://www.youtube.com/watch?v=abcDEF12345"'));
  await submit(dev, g, '/admin/live', { youtube_url: 'https://www.youtube.com/@NewWaysDundee/live', title: 'Wednesday Live Service', description: '', scheduled_at: '', embed_ok: '1' });
  const live3 = await text(dev.base, '/live');
  check('a channel live-page link works as a Watch on YouTube button', live3.includes('href="https://www.youtube.com/@NewWaysDundee/live"') && !live3.includes('data-yt='));
  await submit(dev, g, '/admin/live/off', {});
  check('switching off removes LIVE NOW', !(await text(dev.base, '/')).includes('LIVE NOW'));
  await submit(dev, g, '/admin/live', { youtube_url: 'https://youtu.be/abcDEF12345', title: 'Wednesday Live Service', description: 'Recorded live.', scheduled_at: '', embed_ok: '1' });
  const copy = await submit(dev, g, '/admin/live/to-videos', {});
  const rec = db.prepare("SELECT * FROM teaching_videos WHERE youtube_id = 'abcDEF12345'").get();
  check('the recording can be added to Teaching Videos (hidden, ready to check)', /^\/admin\/teaching-videos\/\d+$/.test(copy.headers.get('location') || '') && rec && rec.title === 'Wednesday Live Service' && rec.visible === 0);

  console.log('\nBackground music');
  const mp3 = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x0a', 'latin1'), Buffer.alloc(6000, 0xff)]);
  const musicPage = await text(dev.base, '/admin/music', { jar: g });
  const mcsrf = (musicPage.match(/data-csrf="([^"]+)"/) || [])[1];
  const up = (buf, type, token = mcsrf) => req(dev.base, '/admin/music/upload', { jar: g, method: 'POST', body: buf, headers: { 'Content-Type': type, 'X-CSRF-Token': token, 'X-File-Name': 'Peaceful%20Track.mp3' } });
  check('upload refused without the security token', (await up(mp3, 'audio/mpeg', 'x'.repeat(43))).status === 403);
  const fakeAudio = await up(Buffer.from('definitely not music at all'), 'audio/mpeg');
  check('a file that is not music is refused and removed', fakeAudio.status === 400 && db.prepare("SELECT COUNT(*) AS n FROM media WHERE kind = 'audio'").get().n === 0);
  const upOk = await up(mp3, 'audio/mpeg');
  const music1 = db.prepare('SELECT * FROM music').get();
  check('a music file uploads straight into storage', upOk.status === 200 && /^audio\/\d{4}\/\d{2}\/music-[a-z0-9x]+\.mp3$/.test(music1.track_key) && music1.track_title === 'Peaceful Track');
  check('music stays off until switched on', !(await text(dev.base, '/')).includes('data-music'));
  await submit(dev, g, '/admin/music', { track_title: 'Peaceful Track', default_volume: '30', enabled: '1' });
  const home5 = await text(dev.base, '/');
  check('when on, every page has the Music button (no autoplay) at the chosen volume', home5.includes('data-music data-volume="30"') && home5.includes('preload="none"') && !/<audio[^>]*autoplay/.test(home5) && home5.includes('>Music<'));
  const part = await req(dev.base, '/media/' + music1.track_key, { headers: { Range: 'bytes=0-99' } });
  check('music streams in parts (quick to start)', part.status === 206 && part.headers.get('content-range') === `bytes 0-99/${mp3.length}` && (await part.arrayBuffer()).byteLength === 100);
  await submit(dev, g, '/admin/music/remove', {});
  check('removing the music takes it off the website and out of storage', !(await text(dev.base, '/')).includes('data-music') && (await req(dev.base, '/media/' + music1.track_key)).status === 404);

  // ================= Stage 4 =================
  console.log('\nBackups and recovery');
  const dl = await req(dev.base, '/admin/backups/download', { jar: g });
  const backup = await dl.json();
  check('a full backup downloads as one file', dl.status === 200 && /attachment; filename="new-ways-backup-[\d-]+\.json"/.test(dl.headers.get('content-disposition')) &&
    backup.format === 'new-ways-backup' && backup.tables.faqs.length >= 16 && backup.tables.settings.length > 10 && backup.tables.charity_totals.length >= 3 && Array.isArray(backup.tables.media));
  check('the backup leaves out sign-in sessions and security records', !('admin_sessions' in backup.tables) && !('rate_limits' in backup.tables));
  await submit(dev, g, '/admin/backups/now', {});
  const bpage = await text(dev.base, '/admin/backups', { jar: g });
  const stored = (bpage.match(/href="\/admin\/backups\/file\/(new-ways-backup-[\d-]+\.json)"/) || [])[1];
  check('a copy can be saved and is listed with the storage used', !!stored && bpage.includes('of the free 10 GB'));
  check('a saved copy downloads from Admin', (await req(dev.base, '/admin/backups/file/' + stored, { jar: g })).status === 200);
  check('backups can never be fetched publicly', (await req(dev.base, '/media/backups/' + stored)).status === 404 && (await req(dev.base, '/media/' + encodeURIComponent('backups/' + stored))).status === 404);
  const before5 = (await text(dev.base, '/admin/backups', { jar: g })).match(/new-ways-backup-/g).length;
  await fetch(dev.base + '/__dev/cron');
  const after5 = (await text(dev.base, '/admin/backups', { jar: g })).match(/new-ways-backup-/g).length;
  check('the daily job does not duplicate a recent weekly copy', after5 === before5);

  // restore round trip: backup -> SQL -> a brand-new empty database -> same content
  const bfile = path.join(root, 'dev', '.local', 'roundtrip-backup.json');
  fs.writeFileSync(bfile, JSON.stringify(backup));
  const sql = execFileSync(process.execPath, [path.join(root, 'scripts', 'restore-from-backup.mjs'), bfile]).toString();
  const restored = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) restored.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
  restored.exec(sql);
  const same = Object.keys(backup.summary).every((t) => restored.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n === backup.summary[t]);
  const priceBack = restored.prepare("SELECT value FROM settings WHERE key = 'entry_price'").get()?.value;
  check('the restore tool rebuilds identical content from a backup', same && priceBack === '6.50' && restored.prepare("SELECT title FROM teaching_videos WHERE youtube_id = 'abcDEF12345'").get()?.title === 'Wednesday Live Service');
  fs.rmSync(bfile);

  console.log('\nFinal SEO and quality checks');
  const whosLd = [...(await text(dev.base, '/whos-on')).matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const ev1 = whosLd.find((d) => d['@type'] === 'Event');
  check('each upcoming Wednesday is described for Google (time, venue, price, medium)', ev1 && /T\d{2}:00:00\.000Z$/.test(ev1.startDate) && ev1.offers?.price === '6.50' && ev1.offers.priceCurrency === 'GBP' && ev1.performer?.name && ev1.location?.address?.postalCode === 'DD2 2SJ');
  check('no review stars are claimed for Google (no self-serving review markup)', !(await text(dev.base, '/reviews')).includes('AggregateRating') && !(await text(dev.base, '/')).includes('"Review"'));
  let inlineStyles = 0, inlineScripts = 0;
  const seen = new Set(), broken = [];
  for (const p of [...PAGES, '/admin', '/admin/backups', '/admin/music', '/admin/live', '/admin/reviews']) {
    const html = await text(dev.base, p, p.startsWith('/admin') ? { jar: g } : {});
    inlineStyles += (html.match(/\sstyle="/g) || []).length;
    inlineScripts += (html.match(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g) || []).length;
    if (!p.startsWith('/admin')) for (const m of html.matchAll(/href="(\/[^"#]*)"/g)) seen.add(m[1]);
  }
  check('no inline styles or scripts anywhere (the strict security policy holds)', inlineStyles === 0 && inlineScripts === 0, `styles ${inlineStyles}, scripts ${inlineScripts}`);
  for (const link of seen) {
    const res = await req(dev.base, link);
    if (res.status !== 200) broken.push(`${link} ${res.status}`);
  }
  check(`every internal link and image on the public pages works (${seen.size} checked)`, broken.length === 0, broken.join(', '));

  console.log('\nThe local database stand-in behaves like Cloudflare D1 on any Node version');
  const compat = await start(8804, {}, ['--import', pathToFileURL(path.join(root, 'tests', 'support', 'simulate-old-node-sqlite.mjs')).href]);
  servers.push(compat);
  const compatStatuses = await Promise.all(PAGES.map(async (p) => (await req(compat.base, p)).status));
  check('with Node’s older SQLite behaviour (before Node 24.7.0), every public page still loads', compatStatuses.every((st) => st === 200), compatStatuses.join(','));
  const cg = await signIn(compat, 'owner');
  check('…and signing in works', cg.res.status === 303 && !!cg.jar.c.nw_admin);
  const cSettings = await text(compat.base, '/admin/settings', { jar: cg.jar });
  const cValues = {};
  for (const m of cSettings.matchAll(/<input id="f-[^"]+" name="([^"]+)"[^>]*?value="([^"]*)"/g)) cValues[m[1]] = m[2].replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  for (const m of cSettings.matchAll(/<textarea id="f-[^"]+" name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) cValues[m[1]] = m[2].replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const cSave = await submit(compat, cg.jar, '/admin/settings', { ...cValues, entry_price: '7' });
  check('…and saving Centre Settings works', cSave.status === 303 && (await text(compat.base, '/whos-on')).includes('<dd>£7</dd>'));

  console.log('\nPages still load if a shared part fails');
  const faulty = await start(8805, { FAIL_SQL: 'FROM announcements|FROM live_stream|FROM social_links|FROM music|FROM settings' });
  servers.push(faulty);
  const faultyStatuses = await Promise.all(PAGES.map(async (p) => (await req(faulty.base, p)).status));
  check('if announcements, LIVE NOW, social links, music or Centre Settings fail to load, every public page still loads', faultyStatuses.every((st) => st === 200), faultyStatuses.join(','));
  check('…using the standard Centre Settings values', (await text(faulty.base, '/whos-on')).includes('<dd>6:30pm</dd>'));

  console.log('\nInstall button and private counters');
  const homeHtml = await text(dev.base, '/');
  const installBtn = (homeHtml.match(/<button type="button" class="home-btn home-install press" data-install-app hidden>[\s\S]*?<\/button>/) || [])[0] || '';
  check('Home has the Install New Way’s App button, hidden until the browser offers installation', !!installBtn && installBtn.includes('Install New Way’s App'));
  check('it uses the same parts as the four Home buttons (orb, label, subtitle, gold chevron)', ['class="orb"', 'home-btn-text', 'home-btn-label', 'home-btn-sub', 'icon-gold'].every((c) => installBtn.includes(c)));
  check('the four existing Home buttons are unchanged', [['/whos-on', 'Who’s On', 'Wednesday guest mediums'], ['/events', 'Events', 'Special events at New Way’s'], ['/private-readings', 'Private Readings', 'With Medium Gary Findlay'], ['/bookings', 'Bookings', 'Readings and event tickets']]
    .every(([href, label, sub]) => homeHtml.includes(`<a class="home-btn press" href="${href}"><span class="orb" aria-hidden="true">`) && homeHtml.includes(`<span class="home-btn-label">${label}</span><span class="home-btn-sub">${sub}</span>`)));
  check('the install button appears only on Home', !(await text(dev.base, '/whos-on')).includes('data-install-app'));
  let publicMentions = 0;
  for (const p of PAGES) publicMentions += ((await text(dev.base, p)).match(/unique visitors|app installs/gi) || []).length;
  check('the counters never appear on public pages', publicMentions === 0);
  const metric = (type, origin = dev.base) => req(dev.base, '/api/metrics', { method: 'POST', origin, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) });
  const count = (key) => db.prepare('SELECT value FROM app_metrics WHERE key = ?').get(key).value;
  const v0 = count('unique_visitors'), i0 = count('app_installs');
  check('a visitor is counted', (await metric('visitor')).status === 204 && count('unique_visitors') === v0 + 1);
  check('an install is counted', (await metric('install')).status === 204 && count('app_installs') === i0 + 1);
  check('counting from another website is refused', (await metric('visitor', 'https://evil.example')).status === 403 && count('unique_visitors') === v0 + 1);
  check('counting without the browser’s Origin header is refused', (await metric('visitor', null)).status === 403);
  check('an unknown counter is refused', (await metric('anything')).status === 400);
  for (let k = 0; k < 4; k++) await metric('visitor');
  check('repeated counting from one connection is ignored (no inflation)', count('unique_visitors') === v0 + 3);
  const metricsDash = await text(dev.base, '/admin', { jar: g });
  check('the signed-in Admin dashboard shows unique visitors and app installs', metricsDash.includes(`<strong>${v0 + 3}</strong> unique visitors`) && metricsDash.includes(`<strong>${i0 + 1}</strong> app installs`));
  check('the counters keep no visitor details', db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('app_metrics')").get().n === 2);
  const nometrics = await start(8806, { FAIL_SQL: 'app_metrics' });
  servers.push(nometrics);
  const nm = await signIn(nometrics, 'owner');
  const nmDash = await req(nometrics.base, '/admin', { jar: nm.jar });
  check('if the counters can’t be read, Admin still works (showing 0)', nmDash.status === 200 && (await nmDash.text()).includes('<strong>0</strong> unique visitors'));
  check('…and counting fails quietly without an error page', (await req(nometrics.base, '/api/metrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"visitor"}' })).status === 204);

  console.log('\nStage A: database changes are additive and safe');
  {
    const mig = fs.readFileSync(path.join(root, 'migrations', '0006_bookings_and_shop.sql'), 'utf8').replace(/--.*$/gm, '');
    check('migration 0006 only creates new tables and adds starting rows (no DROP, ALTER, DELETE or UPDATE)', !/\b(DROP|ALTER|DELETE|UPDATE|REPLACE)\b/i.test(mig) &&
      [...mig.matchAll(/INSERT INTO (\w+)/gi)].every((m) => ['reading_services', 'availability_weekly', 'products'].includes(m[1])));
    const older = new DatabaseSync(':memory:');
    const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((f) => f < '0006')) older.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    older.exec("INSERT INTO reviews (name, body, consent, status) VALUES ('Existing Visitor', 'An experience shared before the update.', 1, 'approved')");
    older.exec("INSERT INTO settings (key, value) VALUES ('entry_price', '7.00') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const tablesBefore = older.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    const snapshot = () => JSON.stringify(tablesBefore.map((t) => older.prepare(`SELECT * FROM ${t}`).all()));
    const before = snapshot();
    older.exec(fs.readFileSync(path.join(root, 'migrations', '0006_bookings_and_shop.sql'), 'utf8'));
    check('applied to a database with existing content, every existing table and row is unchanged', snapshot() === before);
    const svc = older.prepare('SELECT code, minutes, price_pence FROM reading_services ORDER BY sort_order').all();
    check('it starts with a 30-minute reading at £40 and a 60-minute reading at £65', JSON.stringify(svc) === JSON.stringify([{ code: 'reading-30', minutes: 30, price_pence: 4000 }, { code: 'reading-60', minutes: 60, price_pence: 6500 }]));
    check('…and Sunday 12 noon to 5pm as the normal weekly hours', JSON.stringify(older.prepare('SELECT weekday, start_time, end_time FROM availability_weekly').all()) === JSON.stringify([{ weekday: 0, start_time: '12:00', end_time: '17:00' }]));
    older.exec("INSERT INTO booking_slots (slot_utc, booking_id) VALUES ('2026-10-25T12:00:00.000Z', 1)");
    let refused = false;
    try { older.exec("INSERT INTO booking_slots (slot_utc, booking_id) VALUES ('2026-10-25T12:00:00.000Z', 2)"); } catch { refused = true; }
    check('the database itself refuses two appointments in the same half hour', refused);
    older.close();
  }

  console.log('\nStage A: reading times (UK time, summer time, notice, blocks)');
  {
    const rules = { weekly: [{ weekday: 0, start_time: '12:00', end_time: '17:00', active: 1 }], dates: [], blocks: [] };
    const s30 = av.startTimes(av.windowsFor('2026-10-25', rules).windows, 30), s60 = av.startTimes(av.windowsFor('2026-10-25', rules).windows, 60);
    check('a Sunday offers 30-minute readings from 12 noon to 4:30pm and 60-minute readings from 12 noon to 4pm', s30.length === 10 && s30[0] === '12:00' && s30[9] === '16:30' && s60.length === 9 && s60[8] === '16:00');
    check('other days have no times unless opened', av.windowsFor('2026-10-26', rules).windows.length === 0);
    check('UK time is right in winter and summer (12 noon = 12:00 GMT on 25 Oct 2026, 11:00 GMT on 18 Oct 2026 and 28 Mar 2027)',
      av.momentOf('2026-10-25', '12:00') === '2026-10-25T12:00:00.000Z' && av.momentOf('2026-10-18', '12:00') === '2026-10-18T11:00:00.000Z' && av.momentOf('2027-03-28', '12:00') === '2027-03-28T11:00:00.000Z');
    check('a 60-minute reading takes two half hours', JSON.stringify(av.slotsFor(av.momentOf('2026-10-18', '16:00'), 60)) === JSON.stringify(['2026-10-18T15:00:00.000Z', '2026-10-18T15:30:00.000Z']));
    const changed = { ...rules, dates: [{ date: '2026-10-25', mode: 'closed' }, { date: '2026-11-01', mode: 'hours', start_time: '14:00', end_time: '16:00' },
      { date: '2026-10-28', mode: 'extra', start_time: '10:00', end_time: '11:00' }], blocks: [{ date: '2026-11-08', start_time: '12:00', end_time: '13:00' }] };
    check('a closed date has no times', av.windowsFor('2026-10-25', changed).windows.length === 0 && av.windowsFor('2026-10-25', changed).closed);
    check('different hours replace the normal hours for that date', JSON.stringify(av.startTimes(av.windowsFor('2026-11-01', changed).windows, 60)) === JSON.stringify(['14:00', '14:30', '15:00']));
    check('extra hours open another day of the week', JSON.stringify(av.startTimes(av.windowsFor('2026-10-28', changed).windows, 30)) === JSON.stringify(['10:00', '10:30']));
    const blocked = av.startTimes(av.windowsFor('2026-11-08', changed).windows, 30);
    check('blocked time is removed and the rest of the day stays', blocked[0] === '13:00' && blocked.length === 8);
    const now = Date.parse('2026-10-24T13:00:00Z');   // Saturday 2pm UK time: 24 hours ahead is Sunday 1pm (GMT)
    check('online booking stops 24 hours before a reading', av.bookableStarts('2026-10-25', rules, 30, { nowMs: now, noticeHours: 24 })[0] === '13:00');
    const taken = new Set([av.momentOf('2026-10-25', '14:00')]);
    const free60 = av.bookableStarts('2026-10-25', rules, 60, { nowMs: 0, taken });
    check('a booked half hour removes every start time that would overlap it', !free60.includes('13:30') && !free60.includes('14:00') && free60.includes('13:00') && free60.includes('14:30'));
    check('times are shown the friendly way', av.friendlyTime('12:00') === '12 noon' && av.friendlyTime('16:30') === '4:30pm' && av.friendlyTime('09:00') === '9am');
    check('only times on the hour or half hour are accepted', av.isGridTime('12:30') && !av.isGridTime('12:15') && !av.isGridTime('24:00') && !av.isGridTime('9:00'));
  }

  console.log('\nStage A: Private Readings in Admin');
  {
    const dayAhead = (weekday, minDays) => { let d = av.addDays(ukToday(), minDays); while (new Date(d + 'T12:00:00Z').getUTCDay() !== weekday) d = av.addDays(d, 1); return d; };
    const sun1 = dayAhead(0, 2), sun2 = av.addDays(sun1, 7), mon1 = dayAhead(1, 2);
    const price = (code) => db.prepare('SELECT price_pence FROM reading_services WHERE code = ?').get(code).price_pence;
    const setting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
    check('Admin home has a Private Readings tile', (await text(dev.base, '/admin', { jar: g })).includes('href="/admin/readings"'));
    check('Private Readings needs signing in', (await req(dev.base, '/admin/readings')).status === 401 && (await req(dev.base, '/admin/readings/availability')).status === 401);
    const rp = await text(dev.base, '/admin/readings', { jar: g });
    check('it shows the current prices (£40 and £65) and the booking rules', rp.includes('name="price_reading-30" type="text" inputmode="decimal" autocomplete="off" value="40"') && rp.includes('value="65"') &&
      rp.includes('name="booking_hold_minutes"') && rp.includes('value="15"') && rp.includes('value="24"') && rp.includes('value="12"') && rp.includes('At least 24 hours’ notice is needed.'));
    check('a price change without the security token is refused', (await req(dev.base, '/admin/readings/prices', { jar: g, method: 'POST', body: '_csrf=wrong&price_reading-30=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 403 && price('reading-30') === 4000);
    check('…or from another website', (await submit(dev, g, '/admin/readings/prices', { 'price_reading-30': '1', 'price_reading-60': '1' }, {}, 'https://evil.example')).status === 403 && price('reading-30') === 4000);
    const badPrice = await submit(dev, g, '/admin/readings/prices', { 'price_reading-30': 'forty', 'price_reading-60': '5000' });
    check('an unclear or out-of-range price is explained and nothing is saved', badPrice.status === 422 && (await badPrice.text()).includes('Enter a price from £1 to £1,000') && price('reading-30') === 4000 && price('reading-60') === 6500);
    const goodPrice = await submit(dev, g, '/admin/readings/prices', { 'price_reading-30': '£42.50', 'price_reading-60': '65' });
    check('new prices are saved (£42.50) and recorded in the change log', goodPrice.status === 303 && price('reading-30') === 4250 && price('reading-60') === 6500 &&
      !!db.prepare("SELECT 1 FROM audit_log WHERE action = 'readings.prices' AND summary LIKE '%£40 → £42.50%'").get());
    await submit(dev, g, '/admin/readings/prices', { 'price_reading-30': '40', 'price_reading-60': '65' });
    const rulesBase = { booking_hold_minutes: '15', booking_min_notice_hours: '24', booking_horizon_weeks: '12', customer_retention_months: '24', booking_cancellation_policy: 'Please contact Gary to cancel or rearrange.' };
    const badRules = await submit(dev, g, '/admin/readings/rules', { ...rulesBase, booking_hold_minutes: '2', booking_cancellation_policy: '' });
    check('booking rules are checked (hold of 2 minutes and an empty policy refused)', badRules.status === 422 && (await badRules.text()).includes('Enter a whole number from 5 to 60.') && setting('booking_hold_minutes') === undefined);
    const goodRules = await submit(dev, g, '/admin/readings/rules', { ...rulesBase, booking_hold_minutes: '20' });
    check('booking rules save', goodRules.status === 303 && setting('booking_hold_minutes') === '20' && setting('booking_cancellation_policy') === 'Please contact Gary to cancel or rearrange.');
    await submit(dev, g, '/admin/settings', { ...values, entry_price: '6.50', circle_price: '4', doors_open: '6:45pm', parking_info: 'Free parking beside the building.', directions_link: 'https://maps.app.goo.gl/TestExactLink' });
    check('saving Centre Settings never changes the booking rules', setting('booking_hold_minutes') === '20');
    await submit(dev, g, '/admin/readings/rules', { ...rulesBase });

    const av1 = await text(dev.base, '/admin/readings/availability', { jar: g });
    check('Availability shows Sundays 12 noon to 5pm and the coming weeks with the last start times', av1.includes('<span class="row-title">Sundays</span><span class="row-line">12 noon to 5pm</span>') &&
      av1.includes('10 × 30-minute times, last starts 4:30pm') && av1.includes('9 × 60-minute times, last starts 4pm') && av1.includes('The next 12 weeks'));
    const badWeekly = await submit(dev, g, '/admin/readings/availability/weekly', { weekday: '3', start_time: '19:00', end_time: '18:00' });
    const offGrid = await submit(dev, g, '/admin/readings/availability/weekly', { weekday: '3', start_time: '18:15', end_time: '19:00' });
    check('hours that finish before they start, or are not on the hour or half hour, are refused', badWeekly.status === 422 && (await badWeekly.text()).includes('must be after the starting time') && offGrid.status === 422 &&
      db.prepare('SELECT COUNT(*) AS n FROM availability_weekly').get().n === 1);
    const pastDate = await submit(dev, g, '/admin/readings/availability/dates', { date: av.addDays(ukToday(), -1), mode: 'closed', start_time: '12:00', end_time: '17:00' });
    check('a change for a date in the past is refused', pastDate.status === 422 && (await pastDate.text()).includes('today or a later date'));
    await submit(dev, g, '/admin/readings/availability/dates', { date: sun1, mode: 'closed', start_time: '12:00', end_time: '17:00', note: 'Holiday' });
    await submit(dev, g, '/admin/readings/availability/dates', { date: mon1, mode: 'extra', start_time: '10:00', end_time: '11:00' });
    await submit(dev, g, '/admin/readings/availability/blocks', { date: sun2, start_time: '12:00', end_time: '13:00' });
    const av2 = await text(dev.base, '/admin/readings/availability', { jar: g });
    const dayBlock = (d) => (av2.split('id="calendar"')[1] || '').split('<li class="row-card">').find((b) => b.includes(longDate(d))) || '';
    check('closing one Sunday shows it as closed', dayBlock(sun1).includes('Closed') && dayBlock(sun1).includes('CLOSED THIS DATE'));
    check('extra hours open a Monday (two 30-minute times, one 60-minute time)', dayBlock(mon1).includes('10am to 11am') && dayBlock(mon1).includes('2 × 30-minute times') && dayBlock(mon1).includes('1 × 60-minute times'));
    check('a block removes only that time (the day then starts at 1pm)', dayBlock(sun2).includes('1pm to 5pm') && dayBlock(sun2).includes('8 × 30-minute times'));
    const addedWeekly = await submit(dev, g, '/admin/readings/availability/weekly', { weekday: '3', start_time: '13:00', end_time: '15:00' });
    const wid = db.prepare('SELECT id FROM availability_weekly WHERE weekday = 3').get()?.id;
    check('weekly hours can be added for another day', addedWeekly.status === 303 && !!wid && (await text(dev.base, '/admin/readings/availability', { jar: g })).includes('Wednesdays'));
    check('removing needs a POST with the security token', (await req(dev.base, `/admin/readings/availability/weekly/${wid}/delete`, { jar: g })).status === 405 &&
      (await req(dev.base, `/admin/readings/availability/weekly/${wid}/delete`, { jar: g, method: 'POST', body: '_csrf=wrong', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 403 && !!db.prepare('SELECT 1 FROM availability_weekly WHERE id = ?').get(wid));
    await submit(dev, g, `/admin/readings/availability/weekly/${wid}/delete`, {});
    for (const r of db.prepare('SELECT id FROM availability_dates').all()) await submit(dev, g, `/admin/readings/availability/dates/${r.id}/delete`, {});
    for (const r of db.prepare('SELECT id FROM availability_blocks').all()) await submit(dev, g, `/admin/readings/availability/blocks/${r.id}/delete`, {});
    check('changes, blocks and weekly hours can be removed again', db.prepare('SELECT COUNT(*) AS n FROM availability_weekly').get().n === 1 &&
      db.prepare('SELECT COUNT(*) AS n FROM availability_dates').get().n === 0 && db.prepare('SELECT COUNT(*) AS n FROM availability_blocks').get().n === 0);
    check('every availability change is recorded in the change log', db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'readings.%'").get().n >= 9);
    let styles = 0;
    for (const p of ['/admin/readings', '/admin/readings/availability']) styles += ((await text(dev.base, p, { jar: g })).match(/\sstyle="|<script(?![^>]*\bsrc=)/g) || []).length;
    check('the new Admin screens have no inline styles or scripts', styles === 0);
  }

  console.log('\nStage A: Visitor Experiences ON/OFF switch');
  {
    const ar = await text(dev.base, '/admin/reviews', { jar: g });
    check('Admin shows that sharing is open, with a button to close it', ar.includes('Sharing experiences is open') && ar.includes('action="/admin/reviews/close"'));
    check('the switch cannot be changed without the security token', (await req(dev.base, '/admin/reviews/close', { jar: g, method: 'POST', body: '_csrf=wrong', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 403 &&
      !db.prepare("SELECT 1 FROM settings WHERE key = 'reviews_open' AND value = '0'").get());
    const st = (await text(dev.base, '/reviews')).match(/name="t" value="([^"]+)"/)?.[1];
    db.prepare("INSERT INTO reviews (name, body, consent, status, decided_at) VALUES ('Approved Before Closing', 'Shared and approved before sharing was closed.', 1, 'approved', ?)").run(new Date().toISOString());
    await submit(dev, g, '/admin/reviews/close', {});
    const closedPage = await text(dev.base, '/reviews');
    check('when closed, the website says “Sharing experiences is currently closed.” and shows no form', closedPage.includes('Sharing experiences is currently closed.') && !closedPage.includes('name="consent"') && !closedPage.includes('cf-turnstile'));
    check('approved experiences still show while sharing is closed', closedPage.includes('Approved Before Closing'));
    const direct = await share({ name: 'While Closed', body: 'Sent straight to the server while sharing was closed.' }, { stamp: st });
    check('an experience sent straight to the server while closed is refused and not kept', direct.status === 403 && !db.prepare("SELECT 1 FROM reviews WHERE name = 'While Closed'").get());
    check('the change is recorded in the change log', !!db.prepare("SELECT 1 FROM audit_log WHERE action = 'reviews.close'").get());
    await submit(dev, g, '/admin/reviews/open', {});
    const openPage = await text(dev.base, '/reviews');
    check('opening it again brings back the form with the Turnstile check', openPage.includes('name="consent"') && openPage.includes('data-sitekey="1x00000000000000000000AA"') && (await text(dev.base, '/admin/reviews', { jar: g })).includes('Sharing experiences is open'));
  }

  console.log('\nStage A: customer details are removed after the retention period, financial records kept');
  {
    const old = new Date(Date.now() - 3 * 365 * 86400_000).toISOString();
    const ins = db.prepare(`INSERT INTO orders (reference, kind, status, item_name, amount_pence, customer_name, customer_email, customer_phone, square_payment_id, created_at, paid_at)
      VALUES (?, 'PRIVATE_READING', ?, '30 Minute Private Reading', 4000, 'Test Customer', 'customer@example.com', '07700900000', ?, ?, ?)`);
    const oldId = Number(ins.run('NW-OLD1', 'paid', 'sq-pay-old', old, old).lastInsertRowid);
    const attnId = Number(ins.run('NW-OLD2', 'needs_attention', 'sq-pay-attn', old, old).lastInsertRowid);
    const newId = Number(ins.run('NW-NEW1', 'paid', 'sq-pay-new', new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
    db.prepare("INSERT INTO email_log (order_id, kind, recipient) VALUES (?, 'customer_confirmation', 'customer@example.com')").run(oldId);
    const ordersBefore = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
    await fetch(dev.base + '/__dev/cron');
    const o = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    check('after 2 years the name, email and phone are removed', o(oldId).customer_name === '' && o(oldId).customer_email === '' && o(oldId).customer_phone === '' && !!o(oldId).personal_data_removed_at &&
      db.prepare('SELECT recipient FROM email_log WHERE order_id = ?').get(oldId).recipient === '');
    check('…but the order, amount, date and Square payment reference are kept (nothing deleted)', db.prepare('SELECT COUNT(*) AS n FROM orders').get().n === ordersBefore &&
      o(oldId).amount_pence === 4000 && o(oldId).square_payment_id === 'sq-pay-old' && o(oldId).paid_at === old && o(oldId).item_name === '30 Minute Private Reading');
    check('recent orders and orders needing attention keep their details', o(newId).customer_email === 'customer@example.com' && o(attnId).customer_email === 'customer@example.com');
    db.prepare('DELETE FROM email_log WHERE order_id IN (?, ?, ?)').run(oldId, attnId, newId);
    db.prepare('DELETE FROM orders WHERE id IN (?, ?, ?)').run(oldId, attnId, newId);
    const bk = await (await req(dev.base, '/admin/backups/download', { jar: g })).json();
    check('backups now include reading prices, availability, bookings and orders', ['reading_services', 'availability_weekly', 'orders', 'bookings', 'products'].every((t) => Array.isArray(bk.tables[t])) && bk.tables.reading_services.length === 2);
  }

  console.log('\nStage B: the Private Readings page');
  const bk = {};   // shared by the booking and payment checks
  {
    const rp = await text(dev.base, '/private-readings');
    check('the page has the new wording about WhatsApp video calls', rp.includes('Private readings are available with Medium Gary Findlay by WhatsApp video call. Choose an available date and time that suits you and book securely online.') &&
      rp.includes('please provide a mobile number connected to WhatsApp when booking.'));
    check('“Opens the Square booking calendar” has gone from the website', !(await Promise.all(PAGES.map((p) => text(dev.base, p)))).some((h) => h.includes('Opens the Square booking calendar') || h.includes('[Square booking calendar link goes here]')));
    check('it offers the 30- and 60-minute readings at the prices set in Admin (£40 and £65)', rp.includes('href="/private-readings/book?reading=reading-30"') && rp.includes('<span class="choice-price">£40</span>') && rp.includes('<span class="choice-price">£65</span>'));
    await submit(dev, g, '/admin/readings/prices', { 'price_reading-30': '42', 'price_reading-60': '65' });
    check('a price changed in Admin shows straight away (nothing is fixed in the page)', (await text(dev.base, '/private-readings')).includes('<span class="choice-price">£42</span>'));
    await submit(dev, g, '/admin/readings/prices', { 'price_reading-30': '40', 'price_reading-60': '65' });
    check('it says it is in test mode while Square Sandbox is used', rp.includes('Test mode.') && rp.includes('no real money is taken'));
    const bookingsHtml = await text(dev.base, '/bookings');
    check('the Bookings page sends people to the new booking calendar', bookingsHtml.includes('<a class="btn-gold press" href="/private-readings">Check availability &amp; book</a>'));
    const lockedReadings = await text(locked.base, '/private-readings');
    check('where payments or the spam check are not set up, online booking says it opens soon and can’t be used', lockedReadings.includes('Online booking will open here soon.') && !lockedReadings.includes('/private-readings/book') &&
      (await req(locked.base, '/private-readings/book?reading=reading-30')).status === 303);
    check('Centre Settings no longer asks for a Square booking calendar link', !(await text(dev.base, '/admin/settings', { jar: g })).includes('readings_booking_link'));
    check('the Privacy Notice explains what booking details are kept, and for how long', (await text(dev.base, '/privacy')).includes('We never see or store your card details.') && (await text(dev.base, '/privacy')).includes('after 2 years'));
  }

  console.log('\nStage B: choosing a date and time');
  {
    const dayAhead = (weekday, minDays) => { let d = av.addDays(ukToday(), minDays); while (new Date(d + 'T12:00:00Z').getUTCDay() !== weekday) d = av.addDays(d, 1); return d; };
    bk.s1 = dayAhead(0, 3); bk.s2 = av.addDays(bk.s1, 7); bk.s3 = av.addDays(bk.s1, 14); bk.s4 = av.addDays(bk.s1, 21); bk.s5 = av.addDays(bk.s1, 28);
    const mon = av.addDays(bk.s1, 1);
    const cal = await text(dev.base, `/private-readings/book?reading=reading-60&month=${bk.s1.slice(0, 7)}`);
    check('the calendar marks Sundays as available', cal.includes(`date=${bk.s1}#times`) && cal.includes(`${longDate(bk.s1)}, 9 times available`));
    check('…and other days as not available', !cal.includes(`date=${mon}#times`) || mon.slice(0, 7) !== bk.s1.slice(0, 7));
    const day = await text(dev.base, `/private-readings/book?reading=reading-60&date=${bk.s1}`);
    check('choosing a date shows its start times; 60-minute readings run 12 noon to 4pm', day.includes('>12 noon</a>') && day.includes('>4pm</a>') && !day.includes('>4:30pm</a>'));
    const beyond = av.addDays(ukToday(), 12 * 7 + 7);
    check('dates beyond 12 weeks can’t be booked', (await req(dev.base, `/private-readings/book/details?reading=reading-30&date=${beyond}&time=12:00`)).status === 409);
    check('a time inside the 24-hour notice period can’t be booked', (await req(dev.base, `/private-readings/book/details?reading=reading-30&date=${ukToday()}&time=23:30`)).status === 409);
    check('a time that isn’t offered can’t be booked (Monday, or 4:30pm for 60 minutes)', (await req(dev.base, `/private-readings/book/details?reading=reading-30&date=${mon}&time=12:00`)).status === 409 &&
      (await req(dev.base, `/private-readings/book/details?reading=reading-60&date=${bk.s1}&time=16:30`)).status === 409);
    const det = await text(dev.base, `/private-readings/book/details?reading=reading-60&date=${bk.s1}&time=14:00`);
    check('before paying, the customer sees the reading, length, date, time, price and that it is by WhatsApp video call', ['60 Minute Private Reading', '<dd>60 minutes</dd>', `<dd>${longDate(bk.s1)}</dd>`, '<dd>2pm (UK time)</dd>', '<dd>£65.00</dd>', '<dd>WhatsApp video call</dd>'].every((x) => det.includes(x)));
    check('…the cancellation policy, with the box to tick, and the spam check', det.includes('Please contact Gary to cancel or rearrange.') && det.includes('I understand how cancelling and rearranging works.') && det.includes('data-sitekey="1x00000000000000000000AA"'));
    bk.stamp = det.match(/name="t" value="([^"]+)"/)[1];
    await sleep(3200);
  }

  const bookIt = (fields, ip = '10.0.0.1') => req(dev.base, '/private-readings/book', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
    body: new URLSearchParams({ t: bk.stamp, website: '', 'cf-turnstile-response': TOKEN, name: 'Jane Booker', email: 'jane@example.com', phone: '07700 900123', policy: '1', ...fields }).toString() });
  const orderCount = () => db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const emails = async () => (await fetch(dev.mock + '/__emails')).json();
  const sq = async () => (await fetch(dev.mock + '/__square/state')).json();

  console.log('\nStage B: booking and holding a time');
  {
    const n0 = orderCount();
    const noTick = await bookIt({ reading: 'reading-60', date: bk.s1, time: '14:00', policy: '' }, '10.0.1.1');
    check('without ticking the cancellation box, nothing is booked', noTick.status === 422 && (await noTick.text()).includes('Please tick to confirm you understand how cancelling and rearranging works.') && orderCount() === n0);
    const badPhone = await bookIt({ reading: 'reading-60', date: bk.s1, time: '14:00', phone: '12345', email: 'not-an-email' }, '10.0.1.2');
    const badPhoneHtml = await badPhone.text();
    check('a missing WhatsApp mobile number or email address is explained', badPhone.status === 422 && badPhoneHtml.includes('mobile number you use for WhatsApp') && badPhoneHtml.includes('full email address') && orderCount() === n0);
    check('failing the spam check books nothing', (await bookIt({ reading: 'reading-60', date: bk.s1, time: '14:00', 'cf-turnstile-response': 'wrong' }, '10.0.1.3')).status === 400 && orderCount() === n0);
    check('booking from another website is refused', (await req(dev.base, '/private-readings/book', { method: 'POST', origin: 'https://evil.example', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'reading=reading-30' })).status === 403);

    const ok = await bookIt({ reading: 'reading-60', date: bk.s1, time: '14:00', price: '1', amount_pence: '1' }, '10.0.1.4');
    bk.loc = ok.headers.get('location') || '';
    const order = db.prepare("SELECT * FROM orders WHERE customer_name = 'Jane Booker' ORDER BY id DESC").get();
    const booking = order && db.prepare('SELECT * FROM bookings WHERE order_id = ?').get(order.id);
    bk.order = order;
    check('a correct booking holds the time and goes to the payment step', ok.status === 303 && /^\/order\/NW-[A-Z0-9]{6}\?key=/.test(bk.loc) && booking?.status === 'held' && order.status === 'pending');
    check('the price is the one in the database (£65), whatever the browser sends', order?.amount_pence === 6500 && booking.price_pence === 6500);
    const holdMins = (Date.parse(booking.hold_expires_at) - Date.parse(booking.created_at)) / 60000;
    check('the time is held for 15 minutes', holdMins > 14.9 && holdMins < 15.1);
    check('the cancellation policy and the time it was agreed are recorded with the order', order.terms_text === 'Please contact Gary to cancel or rearrange.' && !!order.terms_accepted_at);
    check('the WhatsApp number is stored in full international form', order.customer_phone === '+447700900123');
    const slots = db.prepare('SELECT slot_utc FROM booking_slots WHERE booking_id = ?').all(booking.id).map((r) => r.slot_utc);
    check('a 60-minute reading takes both half hours', slots.length === 2 && slots[0] === av.momentOf(bk.s1, '14:00') && slots[1] === av.momentOf(bk.s1, '14:30'));
    const link = (await sq()).links.find((l) => l.orderId === order.square_order_id);
    check('Square is asked for exactly this order: £65 in GBP, New Way’s location, returning to the customer’s own order page', !!link && link.amount === 6500 && link.requests.order.location_id === 'LOCAL_LOCATION' &&
      link.redirect === dev.base + bk.loc && link.requests.order.reference_id === order.reference);
    const op = await req(dev.base, bk.loc);
    const opHtml = await op.text();
    check('the order page shows the hold and a button to pay securely with Square', opHtml.includes('Your time is held until') && opHtml.includes(`href="${dev.mock}/__square/checkout/${link.id}"`) && opHtml.includes('Pay £65.00 securely with Square'));
    check('order pages are kept out of Google and never stored', (op.headers.get('x-robots-tag') || '').includes('noindex') && op.headers.get('cache-control') === 'no-store');
    check('without the private key in the link, an order can’t be seen', (await req(dev.base, `/order/${order.reference}?key=wrong`)).status === 404 && !(await text(dev.base, `/order/${order.reference}`)).includes('Jane'));

    const after = await text(dev.base, `/private-readings/book?reading=reading-60&date=${bk.s1}`);
    check('the held time disappears for everyone else (1:30pm, 2pm and 2:30pm for 60 minutes)', !after.includes('>1:30pm</a>') && !after.includes('>2pm</a>') && !after.includes('>2:30pm</a>') && after.includes('>1pm</a>') && after.includes('>3pm</a>'));
    const after30 = await text(dev.base, `/private-readings/book?reading=reading-30&date=${bk.s1}`);
    check('…and for 30-minute readings (2pm and 2:30pm)', !after30.includes('>2pm</a>') && !after30.includes('>2:30pm</a>') && after30.includes('>3pm</a>'));
    const n1 = orderCount();
    const clash = await bookIt({ reading: 'reading-30', date: bk.s1, time: '14:30', name: 'Second Person' }, '10.0.1.5');
    check('a second customer can’t book an overlapping time', clash.status === 409 && (await clash.text()).includes('is no longer available') && orderCount() === n1);
    const [r1, r2] = await Promise.all([bookIt({ reading: 'reading-30', date: bk.s1, time: '12:00', name: 'Racer One' }, '10.0.2.1'), bookIt({ reading: 'reading-30', date: bk.s1, time: '12:00', name: 'Racer Two' }, '10.0.2.2')]);
    const held12 = db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND local_start = '12:00' AND status = 'held'`).get(bk.s1).n;
    check('two customers booking the same time at the same moment: exactly one gets it', held12 === 1 && [r1.status, r2.status].sort().join(',') === '303,409');
  }

  const sign = (body, url = dev.base + '/webhooks/square') => crypto.createHmac('sha256', 'local-webhook-signature-key').update(url + body).digest('base64');
  const webhook = (event, signature) => { const body = JSON.stringify(event); return req(dev.base, '/webhooks/square', { method: 'POST', origin: null, headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': signature ?? sign(body) }, body }); };
  const payEvent = (payment, id = 'evt_' + Math.random().toString(36).slice(2)) => ({ merchant_id: 'M1', type: 'payment.updated', event_id: id, created_at: new Date().toISOString(), data: { type: 'payment', id: payment.id, object: { payment } } });
  const payInSquare = async (order, extra = '') => (await (await fetch(`${dev.mock}/__square/pay/${order.square_payment_link_id}?${extra}`)).json()).payment;
  const freshOrder = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const bookingOf = (id) => db.prepare('SELECT * FROM bookings WHERE order_id = ?').get(id);

  console.log('\nStage C: Square payments');
  const rulesBase = { booking_hold_minutes: '15', booking_min_notice_hours: '24', booking_horizon_weeks: '12', customer_retention_months: '24', booking_cancellation_policy: 'Please contact Gary to cancel or rearrange.' };
  {
    await submit(dev, g, '/admin/readings/rules', { ...rulesBase, notification_email: 'gary@example.com' });
    const order = freshOrder(bk.order.id);
    const back = await text(dev.base, bk.loc);
    check('coming back from Square is not proof of payment: unpaid, the order stays unpaid', back.includes('Your time is held until') && freshOrder(order.id).status === 'pending');
    const payment = await payInSquare(order);
    const event = payEvent(payment, 'evt_first');
    const forged = await webhook(event, 'bm90IHRoZSByaWdodCBzaWduYXR1cmU=');
    check('a webhook without Square’s valid signature is refused and changes nothing', forged.status === 403 && freshOrder(order.id).status === 'pending');
    const tampered = JSON.stringify({ ...event, data: { ...event.data, object: { payment: { ...payment, amount_money: { amount: 1, currency: 'GBP' } } } } });
    check('a webhook whose contents were altered is refused', (await req(dev.base, '/webhooks/square', { method: 'POST', origin: null, headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': sign(JSON.stringify(event)) }, body: tampered })).status === 403);
    const e0 = (await emails()).length;
    const good = await webhook(event);
    const paid = freshOrder(order.id);
    check('Square’s signed webhook confirms the booking', good.status === 200 && paid.status === 'paid' && paid.square_payment_id === payment.id && bookingOf(order.id).status === 'confirmed' && !!paid.paid_at);
    const sent = (await emails()).slice(e0);
    const cust = sent.find((m) => m.to[0] === 'jane@example.com'), adm = sent.find((m) => m.to[0] === 'gary@example.com');
    check('the customer is emailed the reading, date, time, WhatsApp number, price and cancellation policy', !!cust && cust.subject.startsWith('Your private reading is booked') && cust.text.includes('WhatsApp video call') &&
      cust.text.includes('+447700900123') && cust.text.includes('£65.00') && cust.text.includes('Please contact Gary to cancel or rearrange.') && cust.text.includes(order.reference));
    check('Gary gets a separate notification with the customer’s details and a link to Admin', !!adm && adm.subject.startsWith('New booking:') && adm.text.includes('Jane Booker') && adm.text.includes('+447700900123') && adm.text.includes(`/admin/orders/${order.id}`));
    check('emails come from the sending address set as a secret, with Gary’s details nowhere in the code', cust.from === 'New Way’s <bookings@example.test>');
    const again = await webhook(event);
    check('the same webhook sent again is recognised and ignored', again.status === 200 && (await again.text()) === 'Already received');
    await webhook(payEvent(payment, 'evt_second'));
    check('a second event for the same payment sends no duplicate emails', (await emails()).length === e0 + 2 && freshOrder(order.id).status === 'paid');
    check('the order page now says the reading is booked', (await text(dev.base, bk.loc)).includes('Your reading is booked'));
    check('every webhook received is recorded once', db.prepare("SELECT COUNT(*) AS n FROM square_events WHERE event_id IN ('evt_first', 'evt_second')").get().n === 2);

    // paid, but the webhook hasn't arrived: the return page asks Square itself
    const r = await bookIt({ reading: 'reading-30', date: bk.s2, time: '13:00', name: 'Returning Customer', email: 'return@example.com' }, '10.0.3.1');
    const o2 = db.prepare("SELECT * FROM orders WHERE customer_name = 'Returning Customer'").get();
    await payInSquare(o2);
    const ret = await text(dev.base, r.headers.get('location'));
    check('if the customer returns before the webhook arrives, Square is asked directly and the booking is confirmed', ret.includes('Your reading is booked') && freshOrder(o2.id).status === 'paid' && bookingOf(o2.id).status === 'confirmed');

    // the wrong amount
    const r3 = await bookIt({ reading: 'reading-30', date: bk.s2, time: '15:00', name: 'Wrong Amount', email: 'wrong@example.com' }, '10.0.3.2');
    const o3 = db.prepare("SELECT * FROM orders WHERE customer_name = 'Wrong Amount'").get();
    const p3 = await payInSquare(o3, 'amount=100');
    await webhook(payEvent(p3));
    check('a payment of the wrong amount is not accepted as a booking: it is flagged for Gary', freshOrder(o3.id).status === 'needs_attention' && bookingOf(o3.id).status === 'needs_attention' && freshOrder(o3.id).note.includes('£1.00 paid'));
    check('…and Gary is emailed about it', (await emails()).some((m) => m.to[0] === 'gary@example.com' && m.subject === `Needs attention: payment ${o3.reference}`));
    check('…its time stays reserved until Gary decides', db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(bookingOf(o3.id).id).n === 1);
    void r3;
  }

  console.log('\nStage C: holds that run out, and late payments');
  {
    const expire = (orderId) => db.prepare(`UPDATE bookings SET hold_expires_at = ? WHERE order_id = ?`).run(new Date(Date.now() - 60_000).toISOString(), orderId);
    const hourly = () => fetch(dev.base + '/__dev/cron?cron=' + encodeURIComponent('7 * * * *'));
    // unpaid: released
    const r = await bookIt({ reading: 'reading-30', date: bk.s3, time: '12:00', name: 'Never Paid', email: 'never@example.com' }, '10.0.4.1');
    const o = db.prepare("SELECT * FROM orders WHERE customer_name = 'Never Paid'").get();
    const deleted0 = (await sq()).deletedCount;
    expire(o.id);
    await hourly();
    check('after 15 minutes without payment the hold is released and the time is free again', bookingOf(o.id).status === 'expired' && freshOrder(o.id).status === 'expired' &&
      db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(bookingOf(o.id).id).n === 0 && (await text(dev.base, `/private-readings/book?reading=reading-30&date=${bk.s3}`)).includes('>12 noon</a>'));
    check('…Square’s payment page for it is closed, so it can’t be paid afterwards', (await sq()).deletedCount === deleted0 + 1 && (await fetch(`${dev.mock}/__square/checkout/${o.square_payment_link_id}`)).status === 410);
    check('…and the customer’s page says the hold has run out and no payment was taken', (await text(dev.base, r.headers.get('location'))).includes('This hold has run out'));

    // paid at the last moment: found, not released
    await bookIt({ reading: 'reading-30', date: bk.s3, time: '13:00', name: 'Last Moment', email: 'last@example.com' }, '10.0.4.2');
    const lm = db.prepare("SELECT * FROM orders WHERE customer_name = 'Last Moment'").get();
    await payInSquare(lm);
    expire(lm.id);
    await hourly();
    check('a payment made just before the hold ran out is found by asking Square, and the booking is confirmed', freshOrder(lm.id).status === 'paid' && bookingOf(lm.id).status === 'confirmed');

    // Square can't be reached: the hold is kept rather than risk losing a payment
    await bookIt({ reading: 'reading-30', date: bk.s3, time: '14:00', name: 'Square Down', email: 'down@example.com' }, '10.0.4.3');
    const sd = db.prepare("SELECT * FROM orders WHERE customer_name = 'Square Down'").get();
    expire(sd.id);
    await fetch(dev.mock + '/__square/fail-reads?on=1');
    await hourly();
    await fetch(dev.mock + '/__square/fail-reads?on=0');
    check('if Square can’t be reached, an expired hold is kept until Square can be asked', bookingOf(sd.id).status === 'held');
    await hourly();
    check('…and released once Square confirms it was not paid', bookingOf(sd.id).status === 'expired');
    await bookIt({ reading: 'reading-30', date: bk.s5, time: '16:00', name: 'Long Outage', email: 'outage@example.com' }, '10.0.4.7');
    const lo = db.prepare("SELECT * FROM orders WHERE customer_name = 'Long Outage'").get();
    db.prepare(`UPDATE bookings SET hold_expires_at = ? WHERE order_id = ?`).run(new Date(Date.now() - 3 * 3600_000).toISOString(), lo.id);
    await fetch(dev.mock + '/__square/fail-reads?on=1');
    await hourly();
    await fetch(dev.mock + '/__square/fail-reads?on=0');
    check('if Square stays unreachable, a hold is still released after 2 hours, so times are never blocked for long (a later payment is handled as a late payment)', bookingOf(lo.id).status === 'expired');

    // paid after release, time still free: taken back and confirmed
    const late = { id: 'PAYLATE1', order_id: o.square_order_id, status: 'COMPLETED', location_id: 'LOCAL_LOCATION', amount_money: { amount: o.amount_pence, currency: 'GBP' } };
    await webhook(payEvent(late));
    check('a payment arriving after the hold was released still books the time if it is free', freshOrder(o.id).status === 'paid' && bookingOf(o.id).status === 'confirmed' &&
      db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(bookingOf(o.id).id).n === 1);

    // paid after release, time taken by someone else: flagged, no automatic refund
    const sdo = freshOrder(sd.id);
    await bookIt({ reading: 'reading-30', date: bk.s3, time: '14:00', name: 'Took The Time', email: 'took@example.com' }, '10.0.4.4');
    const lateClash = { id: 'PAYLATE2', order_id: sdo.square_order_id, status: 'COMPLETED', location_id: 'LOCAL_LOCATION', amount_money: { amount: sdo.amount_pence, currency: 'GBP' } };
    await webhook(payEvent(lateClash));
    check('if the time was taken by someone else meanwhile, the late payment is flagged for Gary (no double booking, no automatic refund)', freshOrder(sd.id).status === 'needs_attention' &&
      freshOrder(sd.id).note.includes('No refund has been made') && db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND local_start = '14:00' AND status IN ('held','confirmed')`).get(bk.s3).n === 1);

    // paid after release, but Gary has since blocked that time: flagged, not booked into the closed time
    await bookIt({ reading: 'reading-30', date: bk.s5, time: '12:00', name: 'Blocked Later', email: 'blocked@example.com' }, '10.0.4.6');
    const bl = db.prepare("SELECT * FROM orders WHERE customer_name = 'Blocked Later'").get();
    expire(bl.id);
    await hourly();
    await submit(dev, g, '/admin/readings/availability/blocks', { date: bk.s5, start_time: '12:00', end_time: '13:00' });
    await webhook(payEvent({ id: 'PAYLATE3', order_id: bl.square_order_id, status: 'COMPLETED', location_id: 'LOCAL_LOCATION', amount_money: { amount: bl.amount_pence, currency: 'GBP' } }));
    check('a late payment for a time Gary has since blocked is flagged for him, not booked', freshOrder(bl.id).status === 'needs_attention' && bookingOf(bl.id).status === 'needs_attention' && freshOrder(bl.id).note.includes('no longer available'));
    for (const r of db.prepare('SELECT id FROM availability_blocks').all()) await submit(dev, g, `/admin/readings/availability/blocks/${r.id}/delete`, {});

    // Square fails while creating the payment page: nothing held
    await fetch(dev.mock + '/__square/fail-next');
    const fail = await bookIt({ reading: 'reading-30', date: bk.s3, time: '15:00', name: 'Square Failed', email: 'failed@example.com' }, '10.0.4.5');
    const fo = db.prepare("SELECT * FROM orders WHERE customer_name = 'Square Failed'").get();
    check('if Square can’t create the payment page, the customer is told and the time is not left held', fail.status === 503 && (await fail.text()).includes('nothing has been booked or charged') &&
      fo.status === 'cancelled' && db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(bookingOf(fo.id).id).n === 0);

    // reminder the day before
    const start = new Date(Date.now() + 20 * 3600_000); start.setUTCMinutes(0, 0, 0);
    const longAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
    const rid = Number(db.prepare(`INSERT INTO orders (reference, kind, status, item_name, amount_pence, customer_name, customer_email, customer_phone, origin, paid_at, created_at) VALUES ('NW-REMIND', 'PRIVATE_READING', 'paid', 'Reminder reading', 4000, 'Remind Me', 'remind@example.com', '+447700900999', ?, ?, ?)`).run(dev.base, longAgo, longAgo).lastInsertRowid);
    db.prepare(`INSERT INTO bookings (order_id, service_code, service_name, minutes, price_pence, date, local_start, start_utc, end_utc, status) VALUES (?, 'reading-30', '30 Minute Private Reading', 30, 4000, ?, ?, ?, ?, 'confirmed')`)
      .run(rid, ukToday(new Date(start)), new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start), start.toISOString(), new Date(start.getTime() + 1800_000).toISOString());
    await hourly();
    await hourly();
    const reminders = (await emails()).filter((m) => m.to[0] === 'remind@example.com');
    check('a reminder is emailed about 24 hours before the reading, once only', reminders.length === 1 && reminders[0].subject.startsWith('Reminder: your private reading') && reminders[0].text.includes('WhatsApp video call'));
    check('Square stays in Sandbox (test) mode unless Production is deliberately switched on', sqMode({}) === 'sandbox' && sqMode({ SQUARE_ENVIRONMENT: 'Sandbox' }) === 'sandbox' && sqMode({ SQUARE_ENVIRONMENT: 'prod' }) === 'sandbox' && sqMode({ SQUARE_ENVIRONMENT: 'production' }) === 'production');
    let secretsInCode = '';
    try { secretsInCode = execFileSync('grep', ['-rlE', 'EAAA[A-Za-z0-9_-]{20,}|sq0atp-|sq0csp-|re_[A-Za-z0-9]{20,}', path.join(root, 'src'), path.join(root, 'public')], { encoding: 'utf8' }).trim(); } catch { /* grep found nothing */ }
    check('no Square or email keys are in the website’s code or browser files', secretsInCode === '');
  }

  console.log('\nStage D: bookings and orders in Admin');
  {
    const jane = freshOrder(bk.order.id);
    const wrong = db.prepare("SELECT * FROM orders WHERE customer_name = 'Wrong Amount'").get();
    const down = db.prepare("SELECT * FROM orders WHERE customer_name = 'Square Down'").get();
    const ret = db.prepare("SELECT * FROM orders WHERE customer_name = 'Returning Customer'").get();
    check('Bookings needs signing in', (await req(dev.base, '/admin/bookings')).status === 401 && (await req(dev.base, `/admin/orders/${jane.id}`)).status === 401);
    const dash = await text(dev.base, '/admin', { jar: g });
    check('Admin home shows upcoming readings and how many payments need attention', dash.includes('href="/admin/bookings"') && dash.includes(`${db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'needs_attention'").get().n} need your attention`) && /<strong>\d+<\/strong> upcoming private readings/.test(dash));
    const up = await text(dev.base, '/admin/bookings', { jar: g });
    check('the upcoming list shows the booking with the customer’s name', up.includes('Jane Booker') && up.includes(`href="/admin/orders/${jane.id}"`) && up.includes('TEST MODE'));
    const att = await text(dev.base, '/admin/bookings?show=attention', { jar: g });
    check('payments needing attention are listed separately', att.includes('Wrong Amount') && att.includes('Square Down') && !att.includes('Jane Booker'));
    const detail = await text(dev.base, `/admin/orders/${jane.id}`, { jar: g });
    check('a booking shows the customer’s details, with WhatsApp and email links', detail.includes('Jane Booker') && detail.includes('href="mailto:jane@example.com"') && detail.includes('href="https://wa.me/447700900123"'));
    check('…the Square payment reference, the agreed cancellation policy and the emails sent', detail.includes(jane.square_payment_id) && detail.includes('Please contact Gary to cancel or rearrange.') && detail.includes('Confirmation to customer: sent') && detail.includes('Notification to you: sent'));
    check('cancelling needs the security token', (await req(dev.base, `/admin/orders/${jane.id}/cancel`, { jar: g, method: 'POST', body: '_csrf=wrong', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 403 && bookingOf(jane.id).status === 'confirmed');
    const s0 = await sq();
    await submit(dev, g, `/admin/orders/${jane.id}/cancel`, {});
    check('Gary can cancel a booking: the time is freed and the payment record is kept', bookingOf(jane.id).status === 'cancelled' && freshOrder(jane.id).status === 'paid' && freshOrder(jane.id).amount_pence === 6500 &&
      db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(bookingOf(jane.id).id).n === 0 && (await text(dev.base, `/private-readings/book?reading=reading-60&date=${bk.s1}`)).includes('>2pm</a>'));
    check('…nothing is refunded automatically (Square is not asked to refund) and a note is added', JSON.stringify((await sq()).links.length) === JSON.stringify(s0.links.length) && freshOrder(jane.id).note.includes('No automatic refund'));
    const wd = await text(dev.base, `/admin/orders/${wrong.id}`, { jar: g });
    check('a flagged payment explains the problem and offers to keep the appointment', wd.includes('NEEDS ATTENTION') && wd.includes('£1.00 paid') && wd.includes(`action="/admin/orders/${wrong.id}/keep"`));
    await submit(dev, g, `/admin/orders/${wrong.id}/keep`, {});
    check('…keeping it confirms the appointment', bookingOf(wrong.id).status === 'confirmed' && freshOrder(wrong.id).status === 'paid');
    check('a late payment whose time was taken cannot be “kept” (that would double-book)', !(await text(dev.base, `/admin/orders/${down.id}`, { jar: g })).includes(`/admin/orders/${down.id}/keep`) &&
      (await submit(dev, g, `/admin/orders/${down.id}/keep`, {})).status === 303 && freshOrder(down.id).status === 'needs_attention');
    await submit(dev, g, `/admin/orders/${down.id}/resolve`, {});
    check('…it can be marked as dealt with once Gary has contacted the customer', freshOrder(down.id).status === 'paid' && bookingOf(down.id).status === 'cancelled' && freshOrder(down.id).note.includes('Marked as dealt with'));
    const e0 = (await emails()).length;
    await submit(dev, g, `/admin/orders/${ret.id}/resend`, {});
    check('the confirmation email can be sent again', (await emails()).length === e0 + 1 && (await emails()).at(-1).to[0] === 'return@example.com');
    await submit(dev, g, `/admin/orders/${ret.id}/note`, { note: 'Asked to move to 3pm; done by phone.' });
    check('Gary can add private notes', freshOrder(ret.id).note.includes('Asked to move to 3pm; done by phone.'));
    check('changes are recorded in the change log', ['bookings.cancel', 'bookings.keep', 'orders.resolve'].every((a) => !!db.prepare('SELECT 1 FROM audit_log WHERE action = ?').get(a)));

    // an email that fails is shown and can be tried again
    await fetch(dev.mock + '/__emails/fail-next?count=1');
    await bookIt({ reading: 'reading-30', date: bk.s4, time: '12:00', name: 'Mail Fails', email: 'mailfails@example.com' }, '10.0.5.1');
    const mf = db.prepare("SELECT * FROM orders WHERE customer_name = 'Mail Fails'").get();
    await webhook(payEvent(await payInSquare(mf)));
    check('if a confirmation email fails, the booking is still confirmed and Admin shows the email was NOT sent', bookingOf(mf.id).status === 'confirmed' && (await text(dev.base, `/admin/orders/${mf.id}`, { jar: g })).includes('Confirmation to customer: NOT sent (failed)'));
    await submit(dev, g, `/admin/orders/${mf.id}/resend`, {});
    check('…and Gary can send it again', (await emails()).some((m) => m.to[0] === 'mailfails@example.com'));
    await fetch(dev.mock + '/__emails/fail-next?count=1');
    await bookIt({ reading: 'reading-30', date: bk.s4, time: '13:00', name: 'Retry Mail', email: 'retry@example.com' }, '10.0.5.2');
    const rm = db.prepare("SELECT * FROM orders WHERE customer_name = 'Retry Mail'").get();
    await webhook(payEvent(await payInSquare(rm)));
    const failedFirst = !(await emails()).some((m) => m.to[0] === 'retry@example.com');
    await fetch(dev.base + '/__dev/cron?cron=' + encodeURIComponent('7 * * * *'));
    await fetch(dev.base + '/__dev/cron?cron=' + encodeURIComponent('7 * * * *'));
    check('a confirmation email that failed is sent again automatically by the hourly job, once', failedFirst && (await emails()).filter((m) => m.to[0] === 'retry@example.com').length === 1);
    const bfile2 = path.join(root, 'dev', '.local', 'merge-backup.json');
    fs.writeFileSync(bfile2, JSON.stringify(await (await req(dev.base, '/admin/backups/download', { jar: g })).json()));
    const restoreSql = execFileSync(process.execPath, [path.join(root, 'scripts', 'restore-from-backup.mjs'), bfile2]).toString();
    fs.rmSync(bfile2);
    check('the restore tool never deletes orders, bookings or payment records (it only adds missing ones)', !/DELETE FROM (orders|bookings|booking_slots|square_events|email_log|download_entitlements)\b/.test(restoreSql) && restoreSql.includes('INSERT OR IGNORE INTO orders'));
    const rp = await text(dev.base, '/admin/readings', { jar: g });
    check('Private Readings shows what is connected, and the notification address to give Square', rp.includes('Square is connected (Sandbox test payments)') && rp.includes('Emails to customers are set up.') && rp.includes(`${dev.base}/webhooks/square`));
  }

  console.log('\nStage E: Meditation Shop in Admin');
  const shop = {};
  // A real-format MP3 (MPEG-1 Layer III, 128 kbps, 44.1 kHz frames) of the given length, made here for testing
  const fakeMp3 = (seconds, tag = 0) => { const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x40; frame[100] = tag;
    return Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'), ...Array.from({ length: Math.round(seconds * 44100 / 1152) }, () => frame)]); };
  const product = (slug) => db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);
  {
    const FEEL = 'feel-it-awaken-the-spirit-within';
    const feel = product(FEEL);
    shop.feel = feel;
    check('Meditations needs signing in', (await req(dev.base, '/admin/meditations')).status === 401 && (await req(dev.base, `/admin/meditations/${feel.id}/upload/preview`, { method: 'POST', body: 'x' })).status === 403);
    check('Admin home has a Meditations tile', (await text(dev.base, '/admin', { jar: g })).includes('href="/admin/meditations"'));
    const list = await text(dev.base, '/admin/meditations', { jar: g });
    check('“Feel It – Awaken the Spirit Within” is ready as a draft at £9.99', list.includes('Feel It – Awaken the Spirit Within') && list.includes('£9.99') && list.includes('DRAFT, NOT ON THE WEBSITE') && list.includes('NO FULL RECORDING YET'));
    const ed = await text(dev.base, `/admin/meditations/${feel.id}`, { jar: g });
    check('…by Medium Gary Findlay, narrated by an American voice artist', ed.includes('value="By Medium Gary Findlay"') && ed.includes('value="Narrated by an American voice artist"'));
    check('a draft is not on the website', !(await text(dev.base, '/meditations')).includes('Feel It') && (await req(dev.base, '/meditations/' + FEEL)).status === 404);
    await submit(dev, g, `/admin/meditations/${feel.id}/publish`, {});
    check('it can’t be published without its full recording', product(FEEL).status === 'draft');
    const csrfTok = (ed.match(/data-csrf="([^"]+)"/) || [])[1];
    const upload = (kind, buf, token = csrfTok, type = 'audio/mpeg') => req(dev.base, `/admin/meditations/${feel.id}/upload/${kind}`, { jar: g, method: 'POST', body: buf, headers: { 'Content-Type': type, 'X-CSRF-Token': token, 'X-File-Name': kind + '.mp3' } });
    check('uploads need the security token', (await upload('preview', fakeMp3(30), 'x'.repeat(43))).status === 403);
    const long = await upload('preview', fakeMp3(61));
    check('a preview longer than 1 minute is refused with “Preview audio must be 1 minute or less.”', long.status === 400 && (await long.json()).error === 'Preview audio must be 1 minute or less.' && !product(FEEL).preview_key);
    check('a preview that isn’t an MP3 is refused', (await upload('preview', Buffer.from('not really audio at all, just text'.repeat(20)))).status === 400 && !product(FEEL).preview_key);
    const okPrev = await upload('preview', fakeMp3(59));
    shop.previewKey = product(FEEL).preview_key;
    check('a preview of 1 minute or less is accepted and stored as public audio', okPrev.status === 200 && /^audio\/previews\/\d{4}\/\d{2}\/preview-[a-z0-9]+\.mp3$/.test(shop.previewKey) && (await req(dev.base, '/media/' + shop.previewKey)).status === 200);
    check('exactly 1 minute is accepted', (await upload('preview', fakeMp3(60))).status === 200 && (await req(dev.base, '/media/' + shop.previewKey)).status === 404);
    shop.previewKey = product(FEEL).preview_key;
    check('a full recording that isn’t an MP3 is refused', (await upload('full', Buffer.from('%PDF-1.4 not audio'.repeat(30)))).status === 400 && !product(FEEL).full_key);
    shop.fullA = fakeMp3(300, 0xa1);
    check('the full recording uploads', (await upload('full', shop.fullA)).status === 200);
    shop.fullKeyA = product(FEEL).full_key;
    check('…into private storage that can never be fetched publicly', /^private\/meditations\//.test(shop.fullKeyA) && (await req(dev.base, '/media/' + shop.fullKeyA)).status === 404 && (await req(dev.base, '/media/' + encodeURIComponent(shop.fullKeyA))).status === 404);
    check('Gary can download it in Admin to check it (signed in only)', (await req(dev.base, `/admin/meditations/${feel.id}/recording`, { jar: g })).status === 200 && (await req(dev.base, `/admin/meditations/${feel.id}/recording`)).status === 401);
    await submit(dev, g, `/admin/meditations/${feel.id}/publish`, {});
    check('once it has its recording it can be published', product(FEEL).status === 'published');

    const added = await submit(dev, g, '/admin/meditations/new', { title: 'Evening Calm', by_line: 'By Medium Gary Findlay', narration_note: 'Narrated by an American voice artist', short_description: 'A short evening meditation.', description: 'First paragraph.\n\nSecond paragraph.', price: '5' },
      { cover_key: { buf: fixture('test-portrait.jpg'), type: 'image/jpeg', name: 'cover.jpg' } });
    const calm = product('evening-calm');
    shop.calm = calm;
    check('another meditation can be added with its own price and cover (any number of products)', added.status === 303 && calm && calm.price_pence === 500 && calm.status === 'draft' && /^img\//.test(calm.cover_key));
    check('a price that is unclear is explained', (await submit(dev, g, `/admin/meditations/${calm.id}`, { title: 'Evening Calm', price: 'five' })).status === 422);
  }

  console.log('\nStage E: Meditations on the website');
  {
    const FEEL = 'feel-it-awaken-the-spirit-within';
    const list = await text(dev.base, '/meditations');
    check('Meditations lists the published meditation with its title, by-line, narration, price and preview', list.includes('Feel It – Awaken the Spirit Within') && list.includes('By Medium Gary Findlay') &&
      list.includes('Narrated by an American voice artist') && list.includes('£9.99') && list.includes(`src="/media/${shop.previewKey}"`) && !list.includes('Evening Calm'));
    let allText = '';
    for (const p of [...PAGES, '/meditations/' + FEEL]) allText += await text(dev.base, p);
    check('nothing on the website says Gary narrates the meditation', !/narrated by (medium )?gary|gary findlay narrat|voice of (medium )?gary/i.test(allText));
    const home = await text(dev.base, '/');
    check('Meditations is in the main menu and in Explore on the Home screen', home.includes('class="site-menu-link press" href="/meditations"') && home.includes('class="explore-link press" href="/meditations"'));
    const pp = await text(dev.base, '/meditations/' + FEEL);
    check('the meditation’s page shows the personal-use terms, a box to tick and the spam check', pp.includes('Personal-use terms') && pp.includes('for your own personal use only') && pp.includes('I agree to these terms.') && pp.includes('data-action="meditation"'));
    shop.stamp = pp.match(/name="t" value="([^"]+)"/)[1];
  }
  await sleep(3200);
  const buyIt = (slug, fields, ip) => req(dev.base, `/meditations/${slug}/buy`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
    body: new URLSearchParams({ t: shop.stamp, website: '', 'cf-turnstile-response': TOKEN, name: 'Mia Buyer', email: 'mia@example.com', terms: '1', ...fields }).toString() });

  console.log('\nStage E: buying and secure downloads');
  {
    const FEEL = 'feel-it-awaken-the-spirit-within';
    const n0 = orderCount();
    const noTerms = await buyIt(FEEL, { terms: '' }, '10.0.6.1');
    check('without agreeing to the personal-use terms nothing is ordered', noTerms.status === 422 && (await noTerms.text()).includes('Please tick to agree to the personal-use terms.') && orderCount() === n0);
    check('a draft meditation can’t be bought', (await buyIt('evening-calm', {}, '10.0.6.2')).status === 303 && orderCount() === n0);
    const ok = await buyIt(FEEL, { price: '1' }, '10.0.6.3');
    const order = db.prepare("SELECT * FROM orders WHERE customer_name = 'Mia Buyer' ORDER BY id DESC").get();
    shop.order = order; shop.loc = ok.headers.get('location');
    check('buying goes to the payment step; the price (£9.99) is copied from the database at that moment', ok.status === 303 && order.kind === 'MEDITATION_PURCHASE' && order.amount_pence === 999 && order.product_id === shop.feel.id && order.status === 'pending');
    check('…and the agreed terms are recorded with the order', order.terms_text.includes('for your own personal use only') && !!order.terms_accepted_at);
    check('Square is asked for £9.99', (await sq()).links.find((l) => l.orderId === order.square_order_id).amount === 999);
    await submit(dev, g, `/admin/meditations/${shop.feel.id}`, { title: 'Feel It – Awaken the Spirit Within', by_line: 'By Medium Gary Findlay', narration_note: 'Narrated by an American voice artist', short_description: 'A guided meditation by Medium Gary Findlay.', description: '', price: '12' });
    check('changing the price later doesn’t change an order already made', freshOrder(order.id).amount_pence === 999 && product(FEEL).price_pence === 1200);
    check('nothing can be downloaded before payment', (await req(dev.base, `/order/${order.reference}/download?${shop.loc.split('?')[1]}`)).status === 410);
    const e0 = (await emails()).length;
    await webhook(payEvent(await payInSquare(order)));
    const ent = db.prepare('SELECT * FROM download_entitlements WHERE order_id = ?').get(order.id);
    const hours = (Date.parse(ent.expires_at) - Date.now()) / 3600_000;
    check('once Square confirms payment, a download link is made: 48 hours, up to 5 downloads', freshOrder(order.id).status === 'paid' && hours > 47.9 && hours <= 48 && ent.max_attempts === 5 && ent.file_key === shop.fullKeyA);
    const sent = (await emails()).slice(e0);
    const cust = sent.find((m) => m.to[0] === 'mia@example.com'), adm = sent.find((m) => m.to[0] === 'gary@example.com');
    const token = (cust?.text.match(/\/download\/([A-Za-z0-9_-]+)/) || [])[1];
    shop.token = token;
    check('the customer is emailed a private download link and the personal-use terms', !!token && cust.subject === 'Your meditation: Feel It – Awaken the Spirit Within' && cust.text.includes('48 hours') && cust.text.includes('for your own personal use only'));
    check('…and Gary is told about the sale', !!adm && adm.subject === 'Meditation sold: Feel It – Awaken the Spirit Within');
    check('only a scrambled form of the link is stored', !db.prepare('SELECT 1 FROM download_entitlements WHERE token_hash = ?').get(token));
    const op = await text(dev.base, shop.loc);
    check('the order page thanks them and offers the download', op.includes('Thank you') && op.includes('Download your meditation') && op.includes('5 more times'));
    const d1 = await req(dev.base, `/order/${order.reference}/download?${shop.loc.split('?')[1]}`);
    const got = Buffer.from(await d1.arrayBuffer());
    check('the download is the full recording, as a file to save', d1.status === 200 && got.equals(shop.fullA) && /attachment; filename="feel-it-awaken-the-spirit-within\.mp3"/.test(d1.headers.get('content-disposition')) && d1.headers.get('cache-control').includes('no-store'));
    const attempts = () => db.prepare('SELECT attempts FROM download_entitlements WHERE id = ?').get(ent.id).attempts;
    const landing = await text(dev.base, '/download/' + token);
    check('the emailed link opens a page with a Download button; opening it uses up nothing (email scanners can’t waste downloads)', landing.includes(`href="/download/${token}/file"`) && landing.includes('4 more times') && attempts() === 1);
    check('…and neither does a link check (HEAD)', (await req(dev.base, `/download/${token}/file`, { method: 'HEAD', origin: null })).status === 200 && attempts() === 1);
    const d2 = await req(dev.base, `/download/${token}/file`);
    check('the Download button works, and every download is counted', d2.status === 200 && Buffer.from(await d2.arrayBuffer()).equals(shop.fullA) && attempts() === 2);
    const resume = await req(dev.base, `/download/${token}/file`, { headers: { Range: 'bytes=1000-1999' } });
    check('continuing an interrupted download isn’t counted as another download', resume.status === 206 && Buffer.from(await resume.arrayBuffer()).length === 1000 && attempts() === 2);
    for (let k = 0; k < 3; k++) await req(dev.base, `/download/${token}/file`);
    const sixth = await req(dev.base, `/download/${token}/file`);
    check('after 5 downloads the link stops working, with a friendly message', sixth.status === 410 && (await sixth.text()).includes('contact New Way’s and we’ll send you a new one') && (await req(dev.base, '/download/' + token)).status === 410);
    db.prepare(`UPDATE download_entitlements SET completed_at = ? WHERE id = ?`).run(new Date(Date.now() - 4 * 3600_000).toISOString(), ent.id);
    check('“continuing” can’t be used to get round the limit once the last download is hours old', (await req(dev.base, `/download/${token}/file`, { headers: { Range: 'bytes=1-' } })).status === 410);
    check('a made-up download link doesn’t work', (await req(dev.base, '/download/' + 'A'.repeat(43))).status === 410);

    // reissue from Admin
    const reissue = await submit(dev, g, `/admin/orders/${order.id}/reissue`, {});
    const rhtml = await reissue.text();
    const newLink = (rhtml.match(/\/download\/([A-Za-z0-9_-]{30,60})/) || [])[1];
    check('Gary can send a new download link from Admin; it is emailed and shown once to copy', reissue.status === 200 && !!newLink && rhtml.includes('emailed to the customer') && (await emails()).some((m) => m.to[0] === 'mia@example.com' && m.text.includes(newLink)));
    check('…the new link works', (await req(dev.base, `/download/${newLink}/file`)).status === 200);

    // replacing the recording keeps links already sent working
    const csrfTok = ((await text(dev.base, `/admin/meditations/${shop.feel.id}`, { jar: g })).match(/data-csrf="([^"]+)"/) || [])[1];
    const fullB = fakeMp3(200, 0xb2);
    await req(dev.base, `/admin/meditations/${shop.feel.id}/upload/full`, { jar: g, method: 'POST', body: fullB, headers: { 'Content-Type': 'audio/mpeg', 'X-CSRF-Token': csrfTok, 'X-File-Name': 'v2.mp3' } });
    const keyB = product(FEEL).full_key;
    const stillOld = await req(dev.base, `/download/${newLink}/file`);
    check('after replacing the full recording, links already sent still download the recording they were bought with', keyB !== shop.fullKeyA && Buffer.from(await stillOld.arrayBuffer()).equals(shop.fullA));
    await fetch(dev.base + '/__dev/cron');
    check('…so the old recording is kept while a link still needs it', !!db.prepare('SELECT 1 FROM product_files WHERE key = ?').get(shop.fullKeyA));
    db.prepare(`UPDATE download_entitlements SET expires_at = '2000-01-01T00:00:00.000Z' WHERE file_key = ?`).run(shop.fullKeyA);
    check('an expired link no longer works', (await req(dev.base, `/download/${newLink}/file`)).status === 410 && (await req(dev.base, '/download/' + newLink)).status === 410);
    await fetch(dev.base + '/__dev/cron');
    check('…and once no link needs the old recording, the daily job removes it', !db.prepare('SELECT 1 FROM product_files WHERE key = ?').get(shop.fullKeyA) && !db.prepare('SELECT 1 FROM media WHERE key = ?').get(shop.fullKeyA));

    const sales = await text(dev.base, '/admin/meditations/sales', { jar: g });
    check('Admin lists meditation sales with the buyer and the price paid', sales.includes('Mia Buyer') && sales.includes('£9.99'));
    const od = await text(dev.base, `/admin/orders/${order.id}`, { jar: g });
    check('the order shows its download links and emails', od.includes('Download links') && od.includes('Replaced: 5 of 5 downloads used') && od.includes('Download link to customer: sent'));
    await submit(dev, g, `/admin/meditations/${shop.feel.id}/delete`, {});
    check('a meditation that has been bought can’t be deleted', !!product(FEEL));
    const calmFiles = [shop.calm.cover_key];
    await submit(dev, g, `/admin/meditations/${shop.calm.id}/delete`, {});
    check('a meditation never bought can be deleted, with its files', !product('evening-calm') && !db.prepare('SELECT 1 FROM media WHERE key = ?').get(calmFiles[0]));
    const badShop = await submit(dev, g, '/admin/meditations/settings', { download_expiry_hours: '0', download_max_attempts: '5', meditation_terms: 'Terms.' });
    check('download settings are checked', badShop.status === 422);
    const termsNow = db.prepare("SELECT value FROM settings WHERE key = 'meditation_terms'").get()?.value;
    await submit(dev, g, '/admin/meditations/settings', { download_expiry_hours: '72', download_max_attempts: '3', meditation_terms: termsNow || 'For your own personal use only.' });
    await submit(dev, g, `/admin/orders/${order.id}/reissue`, {});
    const latest = db.prepare('SELECT * FROM download_entitlements WHERE order_id = ? ORDER BY id DESC').get(order.id);
    check('Gary can change how long links last and how many downloads they allow', latest.max_attempts === 3 && (Date.parse(latest.expires_at) - Date.now()) / 3600_000 > 71.9);
    await submit(dev, g, '/admin/meditations/settings', { download_expiry_hours: '48', download_max_attempts: '5', meditation_terms: termsNow || 'For your own personal use only.' });
  }

  console.log('\nSigning out');
  const outPage = await text(dev.base, '/admin', { jar: g });
  const outRes = await req(dev.base, '/admin/logout', { jar: g, method: 'POST', body: new URLSearchParams({ _csrf: csrfFrom(outPage) }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const outLoc = new URL(outRes.headers.get('location'));
  check('Sign out ends the session here and at WorkOS', outRes.status === 303 && outLoc.pathname === '/user_management/sessions/logout' && outLoc.searchParams.get('return_to') === dev.base + '/admin/signed-out' && !g.c.nw_admin);
  check('after signing out, Admin needs signing in again', (await req(dev.base, '/admin', { jar: g })).status === 401);

  console.log('\nRepeated sign-in attempts are limited');
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await req(prod.base, '/admin/login')).status;
  check('more than 20 sign-in attempts in 10 minutes are paused', last === 429);
  db.close();
} catch (err) {
  failed++;
  console.error('Test run stopped:', err);
} finally {
  for (const s of servers) { s.child.kill(); try { fs.rmSync(s.dbFile); } catch {} }
}
const notRun = Math.max(0, EXPECTED_CHECKS - passed - failed);
console.log(`\n${passed} passed, ${failed} failed, ${notRun} not run (skipped)`);
process.exit(failed || notRun ? 1 : 0);
