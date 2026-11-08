// Automated tests for the STAGING test copy: its separate settings, the deployment safety checks, the made-up test
// bookings, and the STAGING strip. Run with: npm test, or on its own: node tests/staging.test.mjs
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
  const dbFile = path.join(root, 'dev', '.local', `staging-${port}.sqlite`);
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

const EXPECTED_CHECKS = 34;
const servers = [];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const strip = (s) => s.replace(/(^|\s)\/\/.*$/gm, '$1');
try {
  console.log('\nThe staging settings: a separate Worker, database and storage');
  const live = JSON.parse(strip(read('wrangler.jsonc')));
  const stg = JSON.parse(strip(read('wrangler.staging.jsonc')));
  check('a different Worker name (new-ways-staging), its own workers.dev address, no custom domain routes', stg.name === 'new-ways-staging' && live.name === 'new-ways-website' && stg.workers_dev === true && !stg.routes && !stg.route);
  check('its own database (not the live “new-ways” database)', stg.d1_databases[0].database_name === 'new-ways-staging' && stg.d1_databases[0].database_id !== live.d1_databases[0].database_id && stg.d1_databases[0].binding === 'DB');
  check('its own file storage (not the live “new-ways-media”)', stg.r2_buckets[0].bucket_name === 'new-ways-staging-media' && stg.r2_buckets[0].bucket_name !== live.r2_buckets[0].bucket_name);
  check('no scheduled jobs at all (no reminder emails, no clean-ups, no backups)', Array.isArray(stg.triggers.crons) && stg.triggers.crons.length === 0);
  check('its own address, the STAGING strip on, and never redirecting to the live site', stg.vars.SITE_URL === 'https://new-ways-staging.newwaysmediumship.workers.dev' && stg.vars.STAGING === '1' && stg.vars.REDIRECT_TEST_ADDRESS === '0');
  check('no Square, email or spam-check keys are given to it (no payments can be taken, no emails sent)', !/SQUARE|RESEND|EMAIL_FROM|TURNSTILE/.test(JSON.stringify(stg.vars)) && !('WORKOS_API_KEY' in stg.vars));
  check('the live settings file is unchanged (still the live Worker, database and three scheduled jobs)', live.name === 'new-ways-website' && live.d1_databases[0].database_id === '1f1dc3bc-d799-4d4b-abd4-c931701a1d55' && live.triggers.crons.length === 3 && !live.vars.STAGING);

  console.log('\nDeployment safety');
  const dep = read('.github/workflows/deploy-staging.yml');
  check('Deploy STAGING only deploys the staging branch, with the staging settings file', dep.includes('ref: staging') && /wrangler deploy --config wrangler\.staging\.jsonc/.test(dep) && !/wrangler deploy\s*$/m.test(dep) && !/migrations apply new-ways --remote/.test(dep));
  check('…and stops if the settings mention the live Worker, database or storage', dep.includes("1f1dc3bc-d799-4d4b-abd4-c931701a1d55") && dep.includes('"new-ways-website"') && dep.includes('exit 1'));
  check('…its database updates and test bookings go to the staging database only', dep.includes('migrations apply new-ways-staging --remote --config wrangler.staging.jsonc') && dep.includes('d1 execute new-ways-staging --remote --config wrangler.staging.jsonc --file staging/seed.sql'));
  check('…it only starts on the staging branch, only when staging/DEPLOY-STAGING.txt changes (or by hand)', /on:\s*\n\s*push:\s*\n\s*branches: \[staging\]\s*\n\s*paths: \['staging\/DEPLOY-STAGING\.txt'\]\s*\n\s*workflow_dispatch:/.test(dep) && !/branches: \[.*main/.test(dep));
  const steps = dep.split('\n      - name: ').slice(1);
  check('…and does nothing unless that file says YES: every step that deploys or changes anything is skipped otherwise', dep.includes("grep -q '^DEPLOY STAGING: YES' staging/DEPLOY-STAGING.txt") &&
    steps.filter((t) => !/^(Get the staging branch|Is a staging deployment requested\?)/.test(t)).every((t) => t.split('\n')[1].trim() === "if: steps.request.outputs.go == 'yes'"));
  check('the request file says plainly whether a deployment is requested', /^DEPLOY STAGING: (NO|YES)$/m.test(read('staging/DEPLOY-STAGING.txt')));
  const liveDep = read('.github/workflows/deploy.yml');
  check('the live Deploy now refuses to run from any branch except main (so the staging branch can never go live by mistake)', liveDep.includes('if [ "${GITHUB_REF_NAME}" != "main" ]') && liveDep.indexOf('Live website only from the main branch') < liveDep.indexOf('Apply D1 migrations'));

  const smoke = read('staging/smoke-test.mjs');
  check('the automatic check after deploying uses only the test copy and its database', smoke.includes("'new-ways-staging', '--remote', '--config', 'wrangler.staging.jsonc'") && smoke.includes("const BASE = 'https://new-ways-staging.newwaysmediumship.workers.dev'") &&
    !/new-ways-website|1f1dc3bc|newwaysmediumshipdevelopmentcentre|new-ways-media'/.test(smoke) && dep.includes('run: node staging/smoke-test.mjs'));
  check('…and puts the made-up bookings back afterwards (nobody checked in, temporary iPad removed)', smoke.includes("WHERE booking_id IN (SELECT id FROM event_bookings WHERE reference LIKE 'EV-STG%')") && smoke.includes("DELETE FROM checkin_tablets WHERE name = 'Automatic check (temporary)'"));

  console.log('\nThe made-up test bookings');
  const dev = await start(8945, { STAGING: '1', NO_SQUARE: '1', NO_EMAIL: '1', NO_POS_CHECK: '1', NO_TURNSTILE: '1' }); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const seed = read('staging/seed.sql');
  db.exec(seed); db.exec(seed);
  check('loading them twice adds them once: 2 events, 10 bookings, 18 guests', db.prepare('SELECT COUNT(*) AS n FROM events').get().n === 2 && db.prepare('SELECT COUNT(*) AS n FROM event_bookings').get().n === 10 && db.prepare('SELECT COUNT(*) AS n FROM event_guests').get().n === 18);
  check('no real person’s email or phone number', db.prepare(`SELECT COUNT(*) AS n FROM event_bookings WHERE purchaser_email != '' OR purchaser_phone != ''`).get().n === 0);
  check('every QR code is a valid check-in code', db.prepare('SELECT checkin_token FROM event_bookings').all().every((b) => /^[A-Za-z0-9_-]{22}$/.test(b.checkin_token)));
  const ev = db.prepare(`SELECT * FROM events WHERE name = 'Staging Test Night'`).get();
  const today = new Date().toISOString().slice(0, 10);
  check('one event today and one three months ahead, neither selling tickets online', ev.date === today && db.prepare(`SELECT date FROM events WHERE name = 'Spring Supper (staging)'`).get().date > today && db.prepare(`SELECT COUNT(*) AS n FROM events WHERE sales_mode != 'link'`).get().n === 0);
  check('the agreed test cases are all there (group of six, two Linda Browns, pay at the door, cancelled, card, reservation, another event)',
    db.prepare(`SELECT quantity FROM event_bookings WHERE reference = 'EV-STG001'`).get().quantity === 6 && db.prepare(`SELECT COUNT(*) AS n FROM event_guests WHERE name = 'Linda Brown'`).get().n === 2 &&
    db.prepare(`SELECT payment_status FROM event_bookings WHERE reference = 'EV-STG005'`).get().payment_status === 'unpaid' && db.prepare(`SELECT status FROM event_bookings WHERE reference = 'EV-STG006'`).get().status === 'cancelled' &&
    db.prepare(`SELECT reservation_kind FROM event_bookings WHERE reference = 'EV-STG007'`).get().reservation_kind === 'new');
  const ticket = await req('/c/StagingGroupOfSix00000');
  check('a test ticket link shows the QR code to scan (as in a booking email)', ticket.status === 200 && (await ticket.text()).includes('<svg'));

  console.log('\nThe STAGING strip');
  for (const p of ['/', '/events', '/self-checkin', '/admin']) {
    const html = await text(p);
    check(`${p}: “STAGING · TEST COPY” is shown at the top`, /<body[^>]*><p class="nw-staging" role="note">STAGING · TEST COPY/.test(html));
  }
  check('the strip is styled on the website, Admin and the iPad screens', ['public/css/site.css', 'public/css/admin.css', 'public/css/selfcheckin.css'].every((f) => read(f).includes('.nw-staging')));
  const prod = await start(8947, {}); servers.push(prod);
  base = prod.base;
  base = dev.base;
  const devHome = await req('/');
  check('the test copy is kept out of Google even at its own address (noindex, robots.txt keeps everyone out)', /noindex/.test(devHome.headers.get('x-robots-tag') || '') && (await text('/robots.txt')).includes('Disallow: /\n') && !(await text('/robots.txt')).includes('Allow: /\n'));
  base = prod.base;
  check('the live website (no STAGING setting) never shows it', !(await text('/')).includes('nw-staging') && !(await text('/admin')).includes('nw-staging') && !(await text('/self-checkin')).includes('nw-staging'));
  base = dev.base;

  console.log('\nThe iPad on the test copy, with the test bookings');
  const gary = await signIn('owner');
  const add = await post(gary, '/admin/checkin/tablets', { name: 'Entrance iPad' });
  const code = ((await add.text()).match(/class="setup-digits"[^>]*>(\d{4}) (\d{4})</) || []).slice(1).join('');
  await req('/self-checkin/connect', { jar: ipad, method: 'POST', body: new URLSearchParams({ code }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const tid = db.prepare('SELECT id FROM checkin_tablets').get().id;
  await post(gary, `/admin/checkin/tablets/${tid}/control`, { action: 'use', event_id: String(ev.id), back: '/admin/checkin/tablets' });
  await post(gary, `/admin/checkin/tablets/${tid}/control`, { action: 'test', back: '/admin/checkin/tablets' });
  const six = await api('scan', { code: `${base}/c/StagingGroupOfSix00000` });
  check('the group of six scans and shows six names', six.guests && six.guests.length === 6);
  check('the two Linda Browns go to Julie', (await api('find', { name: 'Linda Brown' })).result === 'same_name');
  check('pay at the door and cancelled go to Julie', (await api('find', { name: 'Pat Doyle' })).result === 'see_julie' && (await api('scan', { code: 'StagingCancelled000000' })).result === 'see_julie');
  check('the Spring Supper ticket is “another event”', (await api('scan', { code: 'StagingSpringSupper000' })).result === 'other_event');
  check('a single guest checks in (Test Mode)', (await api('checkin', { name: 'Jane Single' })).guests[0].result === 'in');
} catch (err) {
  console.log('Test run stopped: ' + (err && err.stack ? err.stack : err));
  failed++;
} finally {
  for (const s of servers) s.child.kill();
}
const notRun = Math.max(0, EXPECTED_CHECKS - passed - failed);
console.log(`\n${passed} passed, ${failed} failed, ${notRun} not run (skipped)`);
process.exit(failed || notRun ? 1 : 0);
