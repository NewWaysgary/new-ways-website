// Automated tests. Run with: npm test   (Node 22 or newer; no internet; uses the local WorkOS stand-in)
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { ukToday, isIsoDate } from '../src/lib/dates.js';

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

const PAGES = ['/', '/whos-on', '/events', '/private-readings', '/bookings', '/development-circle', '/about', '/charity',
  '/faqs', '/find-us', '/gallery', '/reviews', '/teaching-videos', '/live', '/privacy'];
const PROTECTED = ['/admin', '/admin/settings', '/admin/wording', '/admin/wording/mission', '/admin/whos-on', '/admin/whos-on/new',
  '/admin/events', '/admin/events/new', '/admin/announcements', '/admin/charity', '/admin/faqs', '/admin/social-links',
  '/admin/reviews', '/admin/gallery', '/admin/teaching-videos', '/admin/live', '/admin/music', '/admin/backups', '/admin/backups/download'];

// The total number of checks in a complete run, so an early stop is reported as checks not run
const EXPECTED_CHECKS = 176;

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
  check('real address: indexable, robots.txt blocks only Admin, sitemap has 15 pages', !prodHome.headers.get('x-robots-tag') &&
    !(await prodHome.text()).includes('noindex') && robots.includes('Disallow: /admin') &&
    ((await text(prod.base, '/sitemap.xml')).match(/<loc>/g) || []).length === 15);
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
