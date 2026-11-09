// Checks the LIVE website after (or before) an update. READ-ONLY: it only opens pages, never books, pays or checks in.
// Prints only page addresses (without codes), counts and results: never names, emails or QR codes.
//   node deploy/live-check.mjs            (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for the database read)
import { execFileSync } from 'node:child_process';

const SITE = (process.env.SITE || 'https://newwaysmediumshipdevelopmentcentre.com').replace(/\/$/, '');
const EXPECT_NEW = process.env.EXPECT_NEW === '1';   // after the update: the new features must be there too
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); } };
const get = async (p, opts = {}) => {
  for (let i = 0; i < 3; i++) {
    try { return await fetch(SITE + p, { redirect: 'manual', headers: { 'User-Agent': 'NewWays-live-check' }, ...opts }); }
    catch (e) { if (i === 2) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
};
const sql = (command) => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'new-ways', '--remote', '--json', '--command', command], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results || [];
};

console.log(`Checking ${SITE}`);
const page = async (p, test, name) => { const r = await get(p); const t = await r.text(); check(name || `${p} opens`, r.status === 200 && (!test || test(t)), `status ${r.status}`); return t; };
await page('/', (t) => t.includes('New Way'), 'home page');
await page('/events', null, 'events page');
await page('/whos-on', null, 'Who’s On');
await page('/private-readings', null, 'private readings');
await page('/bookings', null, 'bookings page');
await page('/development-circle', null, 'development circle');
const robots = await (await get('/robots.txt')).text();
check('robots.txt (Google can read the website; Admin and the iPad page are kept out)', robots.includes('Allow: /') && robots.includes('Disallow: /admin'));
const admin = await get('/admin');
check('Admin asks for sign-in', [301, 302, 303].includes(admin.status) || admin.status === 401, `status ${admin.status}`);
check('the site’s own stylesheet loads', (await get('/css/site.css')).status === 200);

// every upcoming event's own page
const events = sql(`SELECT id, sales_mode FROM events WHERE visible = 1 AND date >= date('now') ORDER BY date`);
let evOk = 0;
for (const e of events) { const r = await get(`/events/${e.id}`); if (r.status === 200) evOk++; await r.arrayBuffer(); }
check(`every upcoming event page opens (${evOk} of ${events.length})`, evOk === events.length);
let bookOk = 0;
const online = events.filter((x) => x.sales_mode === 'online');
for (const e of online) { const r = await get(`/events/${e.id}/book`); await r.text(); if (r.status === 200) bookOk++; }
check(`every online-tickets event’s booking page opens (${bookOk} of ${online.length})`, bookOk === online.length);

// every customer's QR code (confirmed bookings): its ticket page and its QR picture still work
const tokens = sql(`SELECT checkin_token AS t FROM event_bookings WHERE status = 'confirmed'`).map((r) => r.t);
let ticketOk = 0, pngOk = 0, shapeOk = 0;
for (const t of tokens) {
  if (/^[A-Za-z0-9_-]{22}$/.test(t)) shapeOk++;
  const a = await get('/c/' + t); const at = await a.text(); if (a.status === 200 && !at.includes('Booking not found')) ticketOk++;
  const b = await get('/qr/' + t + '.png'); if (b.status === 200 && (b.headers.get('content-type') || '').includes('image/png')) pngOk++; await b.arrayBuffer();
}
check(`every confirmed booking’s QR code is in the form the iPad reads (${shapeOk} of ${tokens.length})`, shapeOk === tokens.length);
check(`every confirmed booking’s ticket page opens from its QR code (${ticketOk} of ${tokens.length})`, ticketOk === tokens.length);
check(`every confirmed booking’s QR picture loads (${pngOk} of ${tokens.length})`, pngOk === tokens.length);

if (EXPECT_NEW) {
  const sc = await get('/self-checkin'); const st = await sc.text();
  check('the iPad self check-in page is there (set-up screen for a new iPad)', sc.status === 200 && /Connect this iPad|setup code|set-up code/i.test(st), `status ${sc.status}`);
  check('…and its Home Screen app settings', (await get('/self-checkin.webmanifest')).status === 200);
  check('the till’s new screens’ styling is there', (await (await get('/css/till.css?v=2')).text()).includes('.tev-pick'));
  const wo = await get('/whos-on/999999999');
  check('an old or unknown Who’s On link goes to Who’s On (not an error)', wo.status === 302 && wo.headers.get('location') === '/whos-on', `status ${wo.status}`);
  const meds = sql(`SELECT id FROM mediums WHERE visible = 1 AND date >= date('now') ORDER BY date LIMIT 20`);
  let mOk = 0;
  for (const m of meds) { const r = await get('/whos-on/' + m.id); const t = await r.text(); if (r.status === 200 && t.includes('og:title')) mOk++; }
  check(`every upcoming guest medium has its own shareable page (${mOk} of ${meds.length})`, mOk === meds.length);
  const tbl = sql(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('checkin_tablets', 'checkin_test_attendance', 'checkin_help', 'checkin_sync_log', 'till_event_bookings')`);
  check('the new database tables are there (iPad check-in, till event bookings)', tbl.length === 5, tbl.map((x) => x.name).join(','));
}
console.log(`\nLIVE CHECK: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
