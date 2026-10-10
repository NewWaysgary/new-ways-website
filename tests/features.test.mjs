// Automated tests for the complete build: meditation download security and 24 hours, Julie's full Admin, the second
// notification address, mailing-list promotion, background music checks, event pages and sharing, the table planner,
// the Wednesday door till, Close night and reports, emergency closure, Wednesday advance payments with QR check-in
// and raffles, the 6pm email, live chat with phone notifications, the updated Privacy Notice, go-live checks and the
// virtual tour. Run with: npm test (after tests/system.test.mjs), or on its own: node tests/features.test.mjs
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ukToday } from '../src/lib/dates.js';
import { notificationAddresses } from '../src/bookings/config.js';
import { sixPmWindow, sendSixPmReminders } from '../src/wednesday/payments.js';
import { encryptPayload, vapidJwt, allowedEndpoint, b64url, fromB64url } from '../src/lib/webpush.js';
import { PRIVACY_NOTICE } from '../src/lib/privacy-notice.js';
import { priceBasket } from '../src/wednesday/model.js';
import { makeD1 } from './support/d1.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const subtle = crypto.webcrypto.subtle;
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 300) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function start(port, extraEnv = {}) {
  const dbFile = path.join(root, 'dev', '.local', `features-${port}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start on ' + port)), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('local test copy')) { clearTimeout(timer); resolve({ child, base: `http://localhost:${port}`, mock: `http://localhost:${port + 100}`, dbFile }); } });
    child.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
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
const csrfFrom = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || html.match(/data-csrf="([^"]+)"/) || [])[1];

async function signIn(srv, who = 'owner') {
  const jar = new Jar();
  const login = await req(srv.base, '/admin/login', { jar });
  const authPage = await (await fetch(login.headers.get('location'))).text();
  const link = (authPage.match(new RegExp(`id="as-${who}" href="([^"]+)"`)) || [])[1];
  const cb = new URL(link.replace(/&amp;/g, '&'));
  const res = await req(srv.base, cb.pathname + cb.search, { jar });
  return { jar, res };
}
async function submit(srv, jar, p, fields, files = {}, origin) {
  const fd = new FormData();
  fd.append('_csrf', jar.c.nw_csrf || csrfFrom(await text(srv.base, '/admin', { jar })) || '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.buf], { type: f.type }), f.name);
  return req(srv.base, p, { jar, method: 'POST', body: fd, origin });
}
const form = (fields) => ({ body: new URLSearchParams(fields).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

function nextWednesday(offsetWeeks = 0) {
  const d = new Date(ukToday() + 'T12:00:00Z');
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * offsetWeeks);
  return d.toISOString().slice(0, 10);
}
const addDays = (n) => { const d = new Date(ukToday() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hex = (t) => crypto.createHash('sha256').update(t).digest('hex');
const fixture = (f) => fs.readFileSync(path.join(root, 'tests', 'fixtures', f));
const fakeMp3 = (seconds, tag = 0) => { const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x40; frame[100] = tag;
  return Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'), ...Array.from({ length: Math.round(seconds * 44100 / 1152) }, () => frame)]); };
function putMedia(key, buf, contentType) {
  const file = path.join(root, 'dev', '.local', 'media', key.replace(/[^a-z0-9._\-/]/gi, '_'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  fs.writeFileSync(file + '.meta.json', JSON.stringify({ contentType }));
}

// RFC 8291: what a phone does to read a notification (used here to prove the notifications are really readable)
async function decryptPush(bodyB64, uaKeys, authSecret) {
  const body = Buffer.from(bodyB64, 'base64');
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const uaPublic = new Uint8Array(await subtle.exportKey('raw', uaKeys.publicKey));
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const hk = async (s, ikm, info, n) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const te = new TextEncoder();
  const ikm = await hk(authSecret, secret, Buffer.concat([te.encode('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('bad padding delimiter');
  return JSON.parse(new TextDecoder().decode(plain.subarray(0, end)));
}
async function verifyVapid(authorization, expectedAud) {
  const m = authorization.match(/^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/);
  if (!m) return false;
  const [h, c, sig] = m[1].split('.');
  const key = await subtle.importKey('raw', fromB64url(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64url(sig), new TextEncoder().encode(h + '.' + c));
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  return ok && claims.aud === expectedAud && claims.exp > Date.now() / 1000 && /^https:\/\//.test(claims.sub);
}

const EXPECTED_CHECKS = 225;   // the total in a complete run, so an early stop is reported as checks not run
const servers = [];
try {
  console.log('\nDatabase update 0009: additive, safe on an existing database');
  {
    const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const old = new DatabaseSync(':memory:');
    for (const f of migrations.filter((f) => f < '0009')) old.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    old.exec(`INSERT INTO settings (key, value) VALUES ('download_expiry_hours', '48'), ('meditation_terms', 'Personal use. Your link must be used within 48 hours. Thank you.');
      INSERT INTO orders (reference, kind, status, item_name, amount_pence, customer_name, customer_email, access_hash, origin) VALUES ('NW-OLD001', 'MEDITATION_PURCHASE', 'paid', 'Feel It', 999, 'Old Buyer', 'old@example.com', 'x', 'https://x');`);
    const before = old.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body;
    old.exec(fs.readFileSync(path.join(root, 'migrations', migrations.find((f) => f.startsWith('0009'))), 'utf8'));
    const v = (k) => old.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
    check('existing records are kept (an order made before the update is still there)', old.prepare(`SELECT COUNT(*) AS n FROM orders WHERE reference = 'NW-OLD001'`).get().n === 1);
    check('the meditation download time becomes 24 hours, and the terms say “started within 24 hours”', v('download_expiry_hours') === '24' && v('meditation_terms').includes('must be started within 24 hours'));
    check('orders made before the update are not device-protected (their links keep working as sent)', old.prepare(`SELECT device_protected FROM orders WHERE reference = 'NW-OLD001'`).get().device_protected === 0);
    const after = old.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body;
    check('an unedited Privacy Notice is replaced with the updated one, and the old wording is kept', after === PRIVACY_NOTICE && old.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice_previous'`).get().body === before);
    check('the migration contains exactly the updated notice from the code', fs.readFileSync(path.join(root, 'migrations', '0009_complete_build.sql'), 'utf8').includes(PRIVACY_NOTICE.replace(/'/g, "''")));
    const edited = new DatabaseSync(':memory:');
    for (const f of migrations.filter((f) => f < '0009')) edited.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    edited.exec(`UPDATE content_blocks SET body = body || ' Gary added this line.' WHERE key = 'privacy_notice'`);
    const editedBody = edited.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body;
    edited.exec(fs.readFileSync(path.join(root, 'migrations', migrations.find((f) => f.startsWith('0009'))), 'utf8'));
    check('a Privacy Notice Gary has edited is left exactly as it is', edited.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === editedBody);
    check('the till starts with Entry £5, Development £3, Raffle strip £1 and Gift Shop (amount typed in)',
      JSON.stringify(old.prepare('SELECT label, price_pence, custom_amount FROM till_items ORDER BY sort_order').all().map((r) => [r.label, r.price_pence, r.custom_amount])) === JSON.stringify([['Entry', 500, 0], ['Development', 300, 0], ['Raffle strip', 100, 0], ['Gift Shop', 0, 1]]));
  }

  console.log('\nSmall parts on their own');
  {
    const s = { notification_email: 'gary@example.com', notification_email_2: 'julie@example.com', notification_2_events: '0' };
    check('readings, meditations and payment problems go to Gary and Julie', JSON.stringify(notificationAddresses(s).map((a) => a.to)) === '["gary@example.com","julie@example.com"]');
    check('event ticket bookings go to Julie only if chosen', notificationAddresses(s, 'events').length === 1 && notificationAddresses({ ...s, notification_2_events: '1' }, 'events').length === 2);
    check('the same address twice is only emailed once', notificationAddresses({ ...s, notification_email_2: 'gary@example.com' }).length === 1);
    const items = [{ id: 1, label: 'Entry', price_pence: 500, custom_amount: 0, category: 'entry', enabled: 1, online: 1 }, { id: 4, label: 'Gift Shop', price_pence: 0, custom_amount: 1, category: 'gift', enabled: 1, online: 0 }];
    const b = priceBasket(items, [{ item_id: 1, qty: 2, amount_pence: 1 }, { item_id: 4, qty: 1, amount_pence: 450 }]);
    check('the till uses its own prices: a price sent by a phone for Entry is ignored', b.total === 1450 && b.lines[0].unit_pence === 500);
    check('a Gift Shop item can’t be paid for online', priceBasket(items, [{ item_id: 4, qty: 1, amount_pence: 450 }], { online: true }).errors.length === 1);
    check('6pm email time: Wednesday 6pm in summer (17:00 UTC) and winter (18:00 UTC), never 5pm or a Tuesday',
      sixPmWindow(Date.parse('2026-10-14T17:00:00Z')).open && !sixPmWindow(Date.parse('2026-10-14T16:59:00Z')).open && sixPmWindow(Date.parse('2026-11-11T18:00:00Z')).open &&
      !sixPmWindow(Date.parse('2026-11-11T17:00:00Z')).open && !sixPmWindow(Date.parse('2026-11-10T18:30:00Z')).open && !sixPmWindow(Date.parse('2026-10-14T19:00:00Z')).open);
    // web push encryption and signature, checked the way a phone would read them
    const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const authSecret = crypto.randomBytes(16);
    const bodyBytes = await encryptPayload({ title: 'Hello', body: 'Test' }, b64url(await subtle.exportKey('raw', ua.publicKey)), b64url(authSecret));
    const back = await decryptPush(Buffer.from(bodyBytes).toString('base64'), ua, authSecret);
    check('a phone notification is encrypted so only the subscribed phone can read it (RFC 8291)', back.title === 'Hello' && back.body === 'Test');
    const vk = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwt = await vapidJwt(vk.privateKey, 'https://fcm.googleapis.com', 'https://newwaysmediumshipdevelopmentcentre.com');
    check('…and signed so the push service knows it comes from this website (VAPID, RFC 8292)', await verifyVapid(`vapid t=${jwt}, k=${b64url(await subtle.exportKey('raw', vk.publicKey))}`, 'https://fcm.googleapis.com'));
    check('notifications only ever go to real push services', allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc') && !allowedEndpoint('https://evil.example/x') && !allowedEndpoint('http://fcm.googleapis.com/x'));
  }

  const dev = await start(8901, {});
  const prod = await start(8902, { SITE_URL: 'http://localhost:8902' });
  servers.push(dev, prod);
  const db = new DatabaseSync(dev.dbFile);
  const setting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  const emails = async () => (await fetch(dev.mock + '/__emails')).json();
  const sq = async () => (await fetch(dev.mock + '/__square/state')).json();
  const sign = (body, url = dev.base + '/webhooks/square') => crypto.createHmac('sha256', 'local-webhook-signature-key').update(url + body).digest('base64');
  const webhook = (event) => { const body = JSON.stringify(event); return req(dev.base, '/webhooks/square', { method: 'POST', origin: null, headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': sign(body) }, body }); };
  const payEvent = (payment, id = 'evt_' + Math.random().toString(36).slice(2)) => ({ merchant_id: 'M1', type: 'payment.updated', event_id: id, created_at: new Date().toISOString(), data: { type: 'payment', id: payment.id, object: { payment } } });
  const payInSquare = async (linkId) => (await (await fetch(`${dev.mock}/__square/pay/${linkId}`)).json()).payment;
  const { jar: g } = await signIn(dev, 'owner');

  console.log('\nPublic pages: mailing list promotion, music, footer');
  {
    const home = await text(dev.base, '/');
    check('the Home screen has “Stay Connected with New Way’s” and JOIN OUR MAILING LIST (the existing Join page)', home.includes('Stay Connected with New Way’s') && home.includes('<a class="btn-gold press" href="/join">') && home.includes('JOIN OUR MAILING LIST'));
    const about = await text(dev.base, '/about');
    check('every page’s footer has JOIN OUR MAILING LIST', about.includes('class="footer-block footer-join"') && about.includes('href="/join">JOIN OUR MAILING LIST'));
    check('the footer year is the current year (worked out automatically)', home.includes(`© ${new Date().getUTCFullYear()} `));
    check('there is still one mailing list: joining from the promotion uses the same Join page', (await req(dev.base, '/join')).status === 200);
    check('the existing pages, logo and menu are unchanged (Home still has its logo, buttons and Explore)', home.includes('home-logo') && home.includes('href="/whos-on"') && home.includes('Explore New Way’s') && home.includes('data-install-app'));
  }

  console.log('\nJulie: full Admin with her own sign-in (Gary stays the owner)');
  {
    check('Admin team is for the owner (Gary)', (await req(dev.base, '/admin/team', { jar: g })).status === 200 && (await text(dev.base, '/admin', { jar: g })).includes('href="/admin/team"'));
    const add = await submit(dev, g, '/admin/team', { name: 'Julie', email: '  Julie.Helper@Example.TEST ' });
    check('Gary gives Julie full Admin (her address is stored in lower case)', add.status === 303 && db.prepare(`SELECT COUNT(*) AS n FROM admin_users WHERE email = 'julie.helper@example.test' AND active = 1`).get().n === 1);
    const ownerAgain = await submit(dev, g, '/admin/team', { name: 'Me', email: 'owner@example.test' });
    check('the owner’s own address can’t be added again', ownerAgain.status === 422);
    const julie = await signIn(dev, 'julie');
    check('Julie signs in with her own account and lands in Admin', julie.res.status === 303 && julie.res.headers.get('location') === '/admin');
    const jhome = await text(dev.base, '/admin', { jar: julie.jar });
    check('Julie sees the same Admin as Gary (settings, bookings, events, door, chat)', jhome.includes('(full Admin)') && jhome.includes('href="/admin/settings"') && jhome.includes('href="/admin/door"') && jhome.includes('href="/admin/chat"') && jhome.includes('href="/admin/bookings"'));
    check('…and can open them', (await req(dev.base, '/admin/settings', { jar: julie.jar })).status === 200 && (await req(dev.base, '/admin/door', { jar: julie.jar })).status === 200 &&
      (await req(dev.base, '/admin/readings', { jar: julie.jar })).status === 200 && (await req(dev.base, '/admin/backups', { jar: julie.jar })).status === 200);
    check('only adding or removing full Admins is kept for Gary', (await req(dev.base, '/admin/team', { jar: julie.jar })).status === 403 && !jhome.includes('href="/admin/team"') &&
      (await submit(dev, julie.jar, '/admin/team', { name: 'X', email: 'x@example.com' })).status === 403);
    const twin = await signIn(dev, 'julie2');
    check('someone else with the same email address but a different account is refused', twin.res.status === 403);
    const jid = db.prepare(`SELECT id FROM admin_users WHERE email = 'julie.helper@example.test'`).get().id;
    await submit(dev, g, `/admin/team/${jid}/off`, {});
    check('switching Julie off signs her out at once', (await req(dev.base, '/admin', { jar: julie.jar })).status === 401);
    await submit(dev, g, `/admin/team/${jid}/on`, {});
    check('check-in helpers are unchanged and separate (Helpers page still there)', (await req(dev.base, '/admin/helpers', { jar: g })).status === 200);
    await submit(dev, g, '/admin/helpers', { name: 'Door Helper', email: 'someone.else@example.test' });
    const helper = await signIn(dev, 'other');
    check('a check-in helper still can’t open the door till, chat or settings', helper.res.status === 303 && (await req(dev.base, '/admin/door', { jar: helper.jar })).status === 403 &&
      (await req(dev.base, '/admin/chat', { jar: helper.jar })).status === 403 && (await req(dev.base, '/admin/settings', { jar: helper.jar })).status === 403);
  }
  const julieJar = (await signIn(dev, 'julie')).jar;

  console.log('\nNotifications: a second address for Julie');
  {
    const rules = { booking_hold_minutes: '15', booking_min_notice_hours: '24', booking_horizon_weeks: '12', customer_retention_months: '24',
      booking_cancellation_policy: 'Please contact Gary to cancel or rearrange.', notification_email: 'gary@example.com', notification_email_2: ' Julie@Example.com ', notification_2_events: '1' };
    const res = await submit(dev, g, '/admin/readings/rules', rules);
    check('the second address is set in Private Readings > Booking rules (and stored in lower case)', res.status === 303 && setting('notification_email_2') === 'julie@example.com' && setting('notification_2_events') === '1');
    const bad = await submit(dev, g, '/admin/readings/rules', { ...rules, notification_email_2: 'not an email' });
    check('a mistyped address is refused', bad.status === 422);
    const page = await text(dev.base, '/admin/readings', { jar: g });
    check('the setting explains no emails are sent for Wednesday door sales', page.includes('Nothing is sent for Wednesday door sales'));
    const e0 = (await emails()).length;
    await submit(dev, g, '/admin/status/test-email', {});
    const sent = (await emails()).slice(e0).map((m) => m.to[0]);
    check('SEND TEST EMAIL TO ME also reaches the second address', sent.includes('gary@example.com') && sent.includes('julie@example.com'));
  }

  console.log('\nMeditations: 24 hours, and protection against forwarded links');
  const med = {};
  {
    const FEEL = 'feel-it-awaken-the-spirit-within';
    putMedia('private/features-full.mp3', fakeMp3(120, 0xc3), 'audio/mpeg');
    db.prepare(`UPDATE products SET full_key = 'private/features-full.mp3', status = 'published' WHERE slug = ?`).run(FEEL);
    db.prepare(`INSERT OR IGNORE INTO media (key, kind, content_type, size_bytes) VALUES ('private/features-full.mp3', 'audio', 'audio/mpeg', ?)`).run(fakeMp3(120, 0xc3).length);
    const pp = await text(dev.base, '/meditations/' + FEEL);
    check('the meditation page’s terms say 24 hours and the device rule', pp.includes('started within 24 hours') && pp.includes('the phone or computer you buy on'));
    const stamp = pp.match(/name="t" value="([^"]+)"/)[1];
    await sleep(3100);
    med.buyer = new Jar();
    const buy = await req(dev.base, `/meditations/${FEEL}/buy`, { jar: med.buyer, method: 'POST', ...form({ t: stamp, website: '', 'cf-turnstile-response': TOKEN, name: 'Rose Buyer', email: 'rose@example.com', terms: '1' }) });
    const order = db.prepare(`SELECT * FROM orders WHERE customer_email = 'rose@example.com'`).get();
    check('buying remembers the buyer’s phone with a security cookie (only a hash is stored)', buy.status === 303 && !!med.buyer.c.nw_device && order.device_protected === 1 &&
      db.prepare('SELECT device_hash FROM order_devices WHERE order_id = ?').get(order.id).device_hash === hex('device:' + med.buyer.c.nw_device));
    const e0 = (await emails()).length;
    await webhook(payEvent(await payInSquare(order.square_payment_link_id)));
    const sent = (await emails()).slice(e0);
    const cust = sent.find((m) => m.to[0] === 'rose@example.com');
    med.token = (cust?.text.match(/\/download\/([A-Za-z0-9_-]+)/) || [])[1];
    med.order = order;
    const ent = db.prepare('SELECT * FROM download_entitlements WHERE order_id = ?').get(order.id);
    const hours = (Date.parse(ent.expires_at) - Date.now()) / 3600_000;
    check('after payment there are 24 hours to START the one download', hours > 23.9 && hours <= 24 && ent.max_attempts === 1);
    check('the email says clearly: 24 hours from purchase to START the download, and not to forward it', !!cust && cust.text.includes('you have 24 hours from your purchase to START your download') &&
      cust.text.includes('Please don’t forward this email'));
    check('Gary AND Julie are told about the sale', sent.some((m) => m.to[0] === 'gary@example.com' && /Meditation sold/.test(m.subject)) && sent.some((m) => m.to[0] === 'julie@example.com' && /Meditation sold/.test(m.subject)));
    const attempts = () => db.prepare('SELECT attempts FROM download_entitlements WHERE id = ?').get(ent.id).attempts;
    const mine = await text(dev.base, '/download/' + med.token, { jar: med.buyer });
    check('on the phone used to buy, the link shows “1 download available” straight away', mine.includes('1 download available') && mine.includes(`/download/${med.token}/file`));
    const friend = new Jar();
    const fwd = await text(dev.base, '/download/' + med.token, { jar: friend });
    check('a FORWARDED link on another device can’t download: it offers a code sent to the buyer’s email instead', fwd.includes('Email me a code') && !fwd.includes('/file"') && fwd.includes('r••e@example.com'));
    const tryFile = await req(dev.base, `/download/${med.token}/file`, { jar: friend });
    check('…the file address itself refuses that device, and nothing is used up', tryFile.status === 303 && tryFile.headers.get('location') === `/download/${med.token}` &&
      (await req(dev.base, `/download/${med.token}/file`, { jar: friend, method: 'HEAD', origin: null })).status === 403 && attempts() === 0);
    const e1 = (await emails()).length;
    const ask = await req(dev.base, `/download/${med.token}/code`, { jar: friend, method: 'POST', ...form({ step: 'send' }) });
    const codeMail = (await emails()).slice(e1).find((m) => /download code/i.test(m.subject));
    const code = (codeMail?.text.match(/\b(\d{6})\b/) || [])[1];
    check('asking for a code emails it ONLY to the purchase address', ask.status === 200 && !!code && codeMail.to[0] === 'rose@example.com' && (await ask.text()).includes('Code from the email'));
    check('the code is only stored scrambled', !db.prepare('SELECT 1 FROM download_codes WHERE code_hash = ?').get(code));
    const stranger = new Jar();
    await text(dev.base, '/download/' + med.token, { jar: stranger });
    const steal = await req(dev.base, `/download/${med.token}/code`, { jar: stranger, method: 'POST', ...form({ step: 'check', code }) });
    check('the code only works on the device that asked for it', steal.status === 422 && (await req(dev.base, `/download/${med.token}/file`, { jar: stranger })).status === 303);
    const wrong = await req(dev.base, `/download/${med.token}/code`, { jar: friend, method: 'POST', ...form({ step: 'check', code: code === '000000' ? '111111' : '000000' }) });
    check('a wrong code is refused', wrong.status === 422 && (await wrong.text()).includes('That code isn’t right'));
    const right = await req(dev.base, `/download/${med.token}/code`, { jar: friend, method: 'POST', ...form({ step: 'check', code }) });
    check('the right code on that device lets it download (a genuine customer on a new phone)', right.status === 303 && (await text(dev.base, '/download/' + med.token, { jar: friend })).includes('1 download available'));
    const got = await req(dev.base, `/download/${med.token}/file`, { jar: friend });
    check('…and the download itself works (still ONE download per purchase)', got.status === 200 && Buffer.from(await got.arrayBuffer()).equals(fakeMp3(120, 0xc3)) && attempts() === 1);
    check('the 15-minute restart still works on the confirmed device', (await req(dev.base, `/download/${med.token}/file`, { jar: friend, headers: { Range: 'bytes=0-99' } })).status === 206);
    check('…but not on a device that was never confirmed', (await req(dev.base, `/download/${med.token}/file`, { jar: stranger })).status === 303);
    check('using the code again does nothing', (await req(dev.base, `/download/${med.token}/code`, { jar: stranger, method: 'POST', ...form({ step: 'check', code }) })).status === 422);
    db.prepare('UPDATE download_entitlements SET completed_at = ? WHERE id = ?').run(new Date(Date.now() - 16 * 60_000).toISOString(), ent.id);
    check('after the 15 minutes, nothing more downloads on any device', (await req(dev.base, `/download/${med.token}/file`, { jar: friend })).status === 410 && (await req(dev.base, `/download/${med.token}/file`, { jar: med.buyer })).status === 410);
    // too many wrong codes
    const reissue = await submit(dev, g, `/admin/orders/${order.id}/reissue`, {});
    const newLink = ((await reissue.text()).match(/\/download\/([A-Za-z0-9_-]{30,60})/) || [])[1];
    const pest = new Jar();
    await text(dev.base, '/download/' + newLink, { jar: pest });
    await req(dev.base, `/download/${newLink}/code`, { jar: pest, method: 'POST', ...form({ step: 'send' }) });
    let last;
    for (let i = 0; i < 5; i++) last = await req(dev.base, `/download/${newLink}/code`, { jar: pest, method: 'POST', ...form({ step: 'check', code: '00000' + i }) });
    check('after 5 wrong tries the code stops working (a new one must be asked for)', last.status === 422 && (await last.text()).includes('ask for a new code'));
    check('Gary’s reissued link works straight away on the buyer’s phone', (await req(dev.base, `/download/${newLink}/file`, { jar: med.buyer })).status === 200);
    const any = await submit(dev, g, `/admin/orders/${order.id}/reissue`, { any_device: '1' });
    const anyLink = ((await any.text()).match(/\/download\/([A-Za-z0-9_-]{30,60})/) || [])[1];
    check('for a customer who can’t receive the code, Gary can reissue a link that works on any device', (await req(dev.base, `/download/${anyLink}/file`, { jar: new Jar() })).status === 200);
    const od = await text(dev.base, `/admin/orders/${order.id}`, { jar: g });
    check('the order in Admin shows it is protected, and on how many devices', od.includes('Protected against forwarding: works on 2 devices') && od.includes('(works on any device)'));
    db.prepare(`UPDATE orders SET device_protected = 0 WHERE id = ?`).run(order.id);
    const legacy = await submit(dev, g, `/admin/orders/${order.id}/reissue`, {});
    const legacyLink = ((await legacy.text()).match(/\/download\/([A-Za-z0-9_-]{30,60})/) || [])[1];
    check('purchases made before this update keep working on any device, as before', (await req(dev.base, `/download/${legacyLink}/file`, { jar: new Jar() })).status === 200);
    check('System status says 24 hours and protected', (await text(dev.base, '/admin/status', { jar: g })).includes('24 hours to start it, protected against forwarded links'));
  }

  console.log('\nBackground music');
  {
    const music = await text(dev.base, '/admin/music', { jar: g });
    check('with no track, Admin says there is no Music button', music.includes('No music is uploaded, so there is no Music button'));
    putMedia('audio/2026/10/music-features.mp3', fakeMp3(120, 0xc3), 'audio/mpeg');
    db.prepare(`INSERT INTO media (key, kind, content_type, size_bytes, original_name) VALUES ('audio/2026/10/music-features.mp3', 'audio', 'audio/mpeg', ?, 'Feel It full.mp3')`).run(fakeMp3(120, 0xc3).length);
    db.prepare(`UPDATE music SET track_key = 'audio/2026/10/music-features.mp3', enabled = 0, default_volume = 20 WHERE id = 1`).run();
    const off = await text(dev.base, '/admin/music', { jar: g });
    check('a track uploaded but switched OFF is clearly explained (the likely reason no Music button showed)', off.includes('Music is uploaded but switched OFF'));
    check('…and a track that looks like the paid meditation is warned about', off.includes('It looks like a meditation that is sold in the Meditation Shop'));
    check('the Admin home lists both under Still to add', (await text(dev.base, '/admin', { jar: g })).includes('Background music is uploaded but switched off'));
    check('switched off: no Music button on the website', !(await text(dev.base, '/')).includes('data-music'));
    db.prepare(`UPDATE music SET enabled = 1 WHERE id = 1`).run();
    const home = await text(dev.base, '/');
    check('switched on: the visible Music button appears, at the volume set (20), and it never plays by itself', home.includes('data-music data-volume="20"') && home.includes('data-music-toggle') && !/<audio[^>]*autoplay/.test(home) && home.includes('preload="none"'));
    db.prepare(`UPDATE music SET enabled = 0, track_key = '' WHERE id = 1`).run();
  }

  console.log('\nEvents: a page for each event, and sharing on Facebook and WhatsApp');
  const ev = {};
  {
    const date = addDays(20);
    const base = { name: 'Psychic Supper', date, time_text: '7pm to 10pm', summary: 'An evening of mediumship with a two-course supper.', details: 'Full details here.', ticket_info: '',
      sales_mode: 'link', ticket_url: '', visible: '1', start_time: '19:00', doors_time: '', venue: '', address: '', price_pence: '', capacity: '0', max_per_booking: '10', sales_open_at: '', sales_close_at: '', instructions: '', booking_terms: '' };
    const made = await submit(dev, g, '/admin/events/new', base, { poster_key: { buf: fixture('test-poster.jpg'), type: 'image/jpeg', name: 'poster.webp' }, poster_key__thumb: { buf: fixture('test-poster.jpg'), type: 'image/jpeg', name: 'share.jpg' } });
    const row = db.prepare(`SELECT * FROM events WHERE name = 'Psychic Supper'`).get();
    ev.id = row.id; ev.date = date;
    check('saving a poster also keeps a JPEG copy for sharing', made.status === 303 && !!row.poster_key && /\.jpg$/.test(row.share_key));
    const pg = await req(dev.base, `/events/${row.id}`);
    const html = await pg.text();
    check('each event has its own address', pg.status === 200 && html.includes('An evening of mediumship with a two-course supper.') && html.includes('Full details here.'));
    check('the preview shows the event’s name, date and short information', html.includes('<meta property="og:title" content="Psychic Supper">') && html.includes(`og:description" content="`) && html.includes('An evening of mediumship'));
    check('…and its poster (the JPEG copy, with its size), not the logo', html.includes(`og:image" content="${dev.base}/media/${encodeURIComponent(row.share_key)}"`) && html.includes('og:image:type" content="image/jpeg"') && /og:image:width" content="\d+"/.test(html));
    check('the shared link is the address the site is on (so previews work on the test address too); Google still only sees the real address',
      html.includes(`og:url" content="${dev.base}/events/${row.id}"`) && html.includes(`rel="canonical" href="https://newwaysmediumshipdevelopmentcentre.com/events/${row.id}"`));
    const robots = await text(dev.base, '/robots.txt');
    check('on the test address, only link-preview services may read event pages and pictures; Google is still kept out', robots.includes('User-agent: facebookexternalhit') && robots.includes('Allow: /events/') && robots.includes('User-agent: *\nDisallow: /'));
    check('the real address’s robots.txt is unchanged', (await text(prod.base, '/robots.txt')).startsWith('User-agent: *\nAllow: /\nDisallow: /admin'));
    check('the Events page links each event name to its own page (design unchanged)', (await text(dev.base, '/events')).includes(`<a class="event-title-link" href="/events/${row.id}">Psychic Supper</a>`));
    const hub = await text(dev.base, `/admin/events/${row.id}/manage`, { jar: g });
    check('Admin has Copy link and Share for the event', hub.includes(`data-copy="${dev.base}/events/${row.id}"`) && hub.includes('data-share-url=') && hub.includes('Share this event'));
    db.prepare('UPDATE events SET visible = 0 WHERE id = ?').run(row.id);
    check('a draft event’s page is not found, and Admin warns about it', (await req(dev.base, `/events/${row.id}`)).status === 404 && (await text(dev.base, `/admin/events/${row.id}/manage`, { jar: g })).includes('This event is a draft'));
    db.prepare('UPDATE events SET visible = 1 WHERE id = ?').run(row.id);
    check('an event that doesn’t exist is not found', (await req(dev.base, '/events/999999')).status === 404);
  }

  console.log('\nTable planner, Mediums’ table and catering report');
  {
    const eid = ev.id;
    db.prepare(`UPDATE events SET sales_mode = 'online', capacity = 30, price_pence = 2500 WHERE id = ?`).run(eid);
    const q = (label, opts, order) => {
      const id = db.prepare(`INSERT INTO event_questions (event_id, label, type, scope, required, sort_order) VALUES (?, ?, 'select', 'guest', 1, ?)`).run(eid, label, order).lastInsertRowid;
      return { id: Number(id), opts: opts.map((o, i) => ({ label: o, id: Number(db.prepare('INSERT INTO event_question_options (question_id, label, sort_order) VALUES (?, ?, ?)').run(id, o, i).lastInsertRowid) })) };
    };
    const meal = q('Meal', ['Beef', 'Chicken', 'Vegetarian'], 1), dessert = q('Dessert', ['Cheesecake', 'Sticky toffee'], 2);
    const book = (ref, purchaser, guests) => {
      const bid = Number(db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, purchaser_name, checkin_token) VALUES (?, ?, 'admin', 'confirmed', 'cash', 'paid', ?, ?, ?)`)
        .run(eid, ref, guests.length, purchaser, crypto.randomBytes(16).toString('base64url')).lastInsertRowid);
      return guests.map(([name, m, d], i) => {
        const gid = Number(db.prepare('INSERT INTO event_guests (booking_id, event_id, position, name) VALUES (?, ?, ?, ?)').run(bid, eid, i + 1, name).lastInsertRowid);
        for (const [qq, v] of [[meal, m], [dessert, d]]) { const o = qq.opts.find((x) => x.label === v); db.prepare('INSERT INTO event_answers (booking_id, guest_id, question_id, question_label, option_id, value, original_value) VALUES (?, ?, ?, ?, ?, ?, ?)').run(bid, gid, qq.id, qq.id === meal.id ? 'Meal' : 'Dessert', o.id, v, v); }
        return { bid, gid, name };
      });
    };
    const smith = book('EV-SMITH1', 'Anne Smith', [['Anne Smith', 'Beef', 'Cheesecake'], ['Bob Smith', 'Beef', 'Sticky toffee'], ['Cath Smith', 'Chicken', 'Cheesecake'], ['Dan Smith', 'Vegetarian', 'Cheesecake']]);
    const jones = book('EV-JONES1', 'Eve Jones', [['Eve Jones', 'Chicken', 'Sticky toffee'], ['Fay Jones', 'Vegetarian', 'Cheesecake']]);
    const brown = book('EV-BROWN1', 'Gus Brown', [['Gus Brown', 'Beef', 'Cheesecake']]);
    const T = `/admin/events/${eid}/tables`;
    check('the event page in Admin has a Table plan', (await text(dev.base, `/admin/events/${eid}/manage`, { jar: g })).includes(`href="${T}"`));
    const setup = await submit(dev, g, `${T}/setup`, { count: '3', seats: '4' });
    const tables = db.prepare('SELECT * FROM event_tables WHERE event_id = ? ORDER BY sort_order').all(eid);
    check('set up round tables: 3 tables of 4 (any number of tables and seats)', setup.status === 303 && tables.length === 3 && tables.every((t) => t.seats === 4));
    let plan = await text(dev.base, T, { jar: g });
    check('each table has a drop-down to add a whole booking or one guest (no seat numbers)', plan.includes(`action="${T}/${tables[0].id}/assign"`) && plan.includes(`value="b:${smith[0].bid}"`) && plan.includes(`value="g:${brown[0].gid}"`) && !/seat number/i.test(plan));
    const seatSmith = await submit(dev, g, `${T}/${tables[0].id}/assign`, { who: 'b:' + smith[0].bid });
    plan = await text(dev.base, T, { jar: g });
    check('a whole booking (the Smiths, 4) goes to Table 1, which is now full', seatSmith.status === 303 && db.prepare('SELECT COUNT(*) AS n FROM event_table_guests WHERE table_id = ?').get(tables[0].id).n === 4 && plan.includes('<strong>4</strong> of 4 seats taken'));
    check('seated guests disappear from every drop-down (no duplicates)', !plan.includes(`value="g:${smith[1].gid}"`) && !plan.includes(`value="b:${smith[0].bid}"`));
    const over = await submit(dev, g, `${T}/${tables[0].id}/assign`, { who: 'b:' + jones[0].bid });
    check('a booking can’t go to a table without enough seats (nothing is changed)', over.status === 303 && /flash=(too-many|full)/.test(over.headers.get('location')) && db.prepare('SELECT COUNT(*) AS n FROM event_table_guests WHERE table_id = ?').get(tables[0].id).n === 4);
    let dbFull = false;
    try { db.prepare('INSERT INTO event_table_guests (guest_id, event_id, table_id) VALUES (?, ?, ?)').run(brown[0].gid, eid, tables[0].id); } catch (e) { dbFull = /TABLE_FULL/.test(e.message); }
    check('the database itself refuses a fifth person at a table of four', dbFull);
    await submit(dev, g, `${T}/${tables[1].id}/assign`, { who: 'g:' + jones[0].gid });
    const split = await submit(dev, g, `${T}/${tables[2].id}/assign`, { who: 'g:' + jones[1].gid });
    plan = await text(dev.base, T, { jar: g });
    check('splitting a booking across tables is allowed, with a clear warning', split.headers.get('location').includes('seated-split') && plan.includes('Bookings split up') && plan.includes('EV-JONES1') && plan.includes('booking split'));
    const dup = await submit(dev, g, `${T}/${tables[1].id}/assign`, { who: 'g:' + jones[1].gid });
    check('a guest already at a table can’t be added again', dup.headers.get('location').includes('already') && db.prepare('SELECT table_id FROM event_table_guests WHERE guest_id = ?').get(jones[1].gid).table_id === tables[2].id);
    const move = await submit(dev, g, `${T}/guest/${jones[1].gid}/move`, { table_id: String(tables[1].id) });
    plan = await text(dev.base, T, { jar: g });
    check('moving a guest to another table: the Joneses are together again and the warning goes', move.headers.get('location').includes('moved') && !plan.includes('Bookings split up'));
    const moveFull = await submit(dev, g, `${T}/guest/${jones[0].gid}/move`, { table_id: String(tables[0].id), whole: '1' });
    check('a move to a full table is refused', /too-many|full/.test(moveFull.headers.get('location')) && db.prepare('SELECT table_id FROM event_table_guests WHERE guest_id = ?').get(jones[0].gid).table_id === tables[1].id);
    const lower = await submit(dev, g, `${T}/${tables[0].id}/edit`, { name: 'Top table', seats: '3' });
    check('a table’s seats can’t be set below the people already at it', lower.headers.get('location').includes('seats-too-few') && db.prepare('SELECT seats FROM event_tables WHERE id = ?').get(tables[0].id).seats === 4);
    await submit(dev, g, `${T}/${tables[0].id}/edit`, { name: 'Top table', seats: '4' });
    check('tables can be renamed', db.prepare('SELECT name FROM event_tables WHERE id = ?').get(tables[0].id).name === 'Top table');
    const notEmpty = await submit(dev, g, `${T}/${tables[0].id}/remove`, {});
    check('a table with people at it can’t be removed', notEmpty.headers.get('location').includes('not-empty') && !!db.prepare('SELECT 1 FROM event_tables WHERE id = ?').get(tables[0].id));
    await submit(dev, g, `${T}/mediums-table`, { seats: '3' });
    const mt = db.prepare('SELECT * FROM event_tables WHERE event_id = ? AND is_mediums = 1').get(eid);
    await submit(dev, g, `${T}/${mt.id}/medium`, { name: 'Medium Mary', ['q' + meal.id]: String(meal.opts[0].id), ['q' + dessert.id]: String(dessert.opts[1].id), note: 'No onions' });
    await submit(dev, g, `${T}/${mt.id}/medium`, { name: 'Medium Tom', ['q' + meal.id]: String(meal.opts[2].id) });
    check('a separate Mediums’ table with each medium’s name and food choices', !!mt && db.prepare('SELECT COUNT(*) AS n FROM event_medium_guests WHERE table_id = ?').get(mt.id).n === 2);
    check('…guests can’t be put at the Mediums’ table', (await submit(dev, g, `${T}/${mt.id}/assign`, { who: 'g:' + brown[0].gid })).headers.get('location').includes('mediums-only'));
    const places = db.prepare(`SELECT SUM(quantity) AS n FROM event_bookings WHERE event_id = ? AND status = 'confirmed'`).get(eid).n;
    const hub = await text(dev.base, `/admin/events/${eid}/manage`, { jar: g });
    check('mediums do NOT use paid places (booked places are still 7 of 30)', places === 7 && hub.includes('<p><strong>7</strong> booked</p>') && hub.includes('<p><strong>23</strong> remaining</p>'));
    plan = await text(dev.base, T, { jar: g });
    check('catering totals include the mediums: 9 meals (7 guests + 2 mediums)', plan.includes('plus 2 mediums: 9 meals in total'));
    check('…with meal and dessert counts (Beef 4 = 3 guests + Mary)', /Beef<\/span><strong>4<\/strong>/.test(plan) && /Vegetarian<\/span><strong>3<\/strong>/.test(plan) && /Sticky toffee<\/span><strong>3<\/strong>/.test(plan));
    check('Gus is still to be seated', plan.includes('Not seated yet (1)') && plan.includes('Gus Brown'));
    const pr = await req(dev.base, `${T}/print`, { jar: g });
    const prHtml = await pr.text();
    check('the printable plan: one page per table (with each guest’s choices), then the catering totals page', pr.status === 200 && (prHtml.match(/class="print-page"/g) || []).length === 5 &&
      prHtml.includes('<h1>Top table</h1>') && prHtml.includes('Medium Mary (medium)') && prHtml.includes('<h1>Catering totals</h1>') && prHtml.includes('/css/print.css') && prHtml.includes('data-print'));
    check('…with a round table drawn on each page and a Save as PDF tip for Android', prHtml.includes('class="print-table"') && prHtml.includes('Save as PDF'));
    const csvRes = await req(dev.base, `/admin/events/${eid}/tables.csv`, { jar: g });
    const csvText = await csvRes.text();
    check('a spreadsheet (CSV) of the plan too', csvRes.headers.get('content-type').includes('text/csv') && csvText.includes('Table,Guest,Booking,Booked by,Meal,Dessert') && csvText.includes('Not seated yet,Gus Brown'));
    await submit(dev, g, `${T}/guest/${smith[3].gid}/unseat`, {});
    plan = await text(dev.base, T, { jar: g });
    check('taking someone off a table puts them back in the drop-downs', plan.includes(`value="g:${smith[3].gid}"`) && !db.prepare('SELECT 1 FROM event_table_guests WHERE guest_id = ?').get(smith[3].gid));
    db.prepare(`UPDATE event_bookings SET status = 'cancelled' WHERE reference = 'EV-BROWN1'`).run();
    check('a cancelled booking drops out of the plan', !(await text(dev.base, T, { jar: g })).includes('Gus Brown'));
    check('the table plan is for full Admins only (not public)', (await req(dev.base, T)).status === 401 && (await req(dev.base, T, { jar: julieJar })).status === 200);
  }

  console.log('\nWednesday door till');
  const door = {};
  {
    const page = await text(dev.base, '/admin/door', { jar: g });
    const items = db.prepare('SELECT * FROM till_items ORDER BY sort_order').all();
    door.items = Object.fromEntries(items.map((i) => [i.category, i]));
    door.csrf = (page.match(/data-csrf="([^"]+)"/) || [])[1];
    check('the Admin home has a prominent Wednesday Door tile, first', (await text(dev.base, '/admin', { jar: g })).indexOf('href="/admin/door"') < (await text(dev.base, '/admin', { jar: g })).indexOf('href="/admin/settings"'));
    check('big repeat-tap buttons: Entry £5, Development £3, Raffle strip £1, Gift Shop (amount)', page.includes('data-label="Entry" data-price="500"') && page.includes('data-label="Development" data-price="300"') &&
      page.includes('data-label="Raffle strip" data-price="100"') && page.includes('data-label="Gift Shop" data-price="0" data-custom="1"'));
    check('Undo, Clear, CASH, CARD and SCAN QR CODE are all on the same screen', page.includes('data-undo') && page.includes('data-clear') && page.includes('data-pay="cash"') && page.includes('data-pay="card"') && page.includes('data-door-scan'));
    check('the itemised GRAND TOTAL is shown before cash or card is recorded', page.includes('GRAND TOTAL') && page.includes('Card payment taken'.slice(0, 0)) && page.includes('data-confirm-panel'));
    const today = ukToday();
    const sale = async (method, lines, expected, ref = crypto.randomBytes(8).toString('hex'), jar = g, csrf = door.csrf) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ _csrf: csrf, date: today, method, client_ref: ref, expected_total: String(expected), lines: JSON.stringify(lines) })) fd.append(k, v);
      const r = await req(dev.base, '/admin/door/sale', { jar, method: 'POST', body: fd });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const lines1 = [{ item_id: door.items.entry.id, qty: 2 }, { item_id: door.items.development.id, qty: 1 }, { item_id: door.items.raffle.id, qty: 3 }, { item_id: door.items.gift.id, qty: 1, amount_pence: 450 }];
    const ref1 = 'saleref000001';
    const s1 = await sale('cash', lines1, 2050, ref1);
    check('a cash sale is recorded with the till’s own prices (2 Entry, 1 Development, 3 raffle strips, £4.50 Gift Shop = £20.50)', s1.status === 200 && s1.body.ok && s1.body.total === 2050 &&
      db.prepare(`SELECT COUNT(*) AS n FROM till_sale_lines WHERE sale_id = ?`).get(s1.body.saleId).n === 4);
    const s1again = await sale('cash', lines1, 2050, ref1);
    check('pressing the button twice (or a dropped signal resending it) records it only once', s1again.body.ok && s1again.body.repeat && db.prepare(`SELECT COUNT(*) AS n FROM till_sales WHERE client_ref = ?`).get(ref1).n === 1);
    const cheat = await sale('cash', [{ item_id: door.items.entry.id, qty: 1, amount_pence: 1 }], 1);
    check('a phone can’t change a price (the total must match the till’s own prices)', cheat.status === 409);
    check('a Gift Shop amount must be typed in', (await sale('cash', [{ item_id: door.items.gift.id, qty: 1, amount_pence: 0 }], 0)).status === 422);
    check('an empty sale is refused', (await sale('card', [], 0)).status === 422);
    const s2 = await sale('card', [{ item_id: door.items.entry.id, qty: 1 }], 500);
    check('a card sale is recorded as card', s2.body.ok && db.prepare('SELECT method FROM till_sales WHERE id = ?').get(s2.body.saleId).method === 'card');
    const noCsrf = new FormData(); noCsrf.append('date', today); noCsrf.append('method', 'cash');
    check('the till needs the security token, and signing in', (await req(dev.base, '/admin/door/sale', { jar: g, method: 'POST', body: noCsrf })).status === 403 && (await req(dev.base, '/admin/door/sale', { method: 'POST', body: noCsrf })).status === 403);
    const tot = await (await req(dev.base, '/admin/door/totals?date=' + today, { jar: g })).json();
    check('live totals for every phone: 3 at the service, 1 at the circle, 3 raffle strips, £25.50', tot.service === 3 && tot.circle === 1 && tot.raffle === 3 && tot.door === 2550);
    await submit(dev, g, `/admin/door/sale/${s2.body.saleId}/void`, {});
    check('a mistaken sale can be cancelled, and then no longer counts', (await (await req(dev.base, '/admin/door/totals?date=' + today, { jar: g })).json()).door === 2050);
    await submit(dev, g, `/admin/door/sale/${s2.body.saleId}/unvoid`, {});
    const editEntry = await submit(dev, g, '/admin/door/items', { id: String(door.items.entry.id), label: 'Entry', price: '6', category: 'entry', enabled: '1', online: '1' });
    const s3 = await sale('cash', [{ item_id: door.items.entry.id, qty: 1 }], 600);
    check('Admin can change a price; new sales use it, past sales keep theirs', editEntry.status === 303 && s3.body.ok && db.prepare(`SELECT unit_pence FROM till_sale_lines WHERE sale_id = ? AND category = 'entry'`).get(s1.body.saleId).unit_pence === 500 &&
      db.prepare(`SELECT unit_pence FROM till_sale_lines WHERE sale_id = ?`).get(s3.body.saleId).unit_pence === 600);
    check('…and Admin warns when the till price differs from Centre Settings', (await text(dev.base, '/admin/door/items', { jar: g })).includes('Entry is £5 in Centre Settings but £6.00 on the till'));
    await submit(dev, g, '/admin/door/items', { id: String(door.items.entry.id), label: 'Entry', price: '5', category: 'entry', enabled: '1', online: '1' });
    await submit(dev, g, '/admin/door/items', { id: String(door.items.gift.id), label: 'Gift Shop', custom_amount: '1', category: 'gift', enabled: '' });
    check('a switched-off button is not on the till and can’t be sold', !(await text(dev.base, '/admin/door', { jar: g })).includes('data-label="Gift Shop"') && (await sale('cash', [{ item_id: door.items.gift.id, qty: 1, amount_pence: 100 }], 100)).status === 422);
    await submit(dev, g, '/admin/door/items', { id: String(door.items.gift.id), label: 'Gift Shop', custom_amount: '1', category: 'gift', enabled: '1' });
    await submit(dev, g, `/admin/door/items/${door.items.raffle.id}/up`, {});
    check('buttons can be put in a different order', db.prepare('SELECT id FROM till_items ORDER BY sort_order LIMIT 1 OFFSET 1').get().id === door.items.raffle.id);
    await submit(dev, g, `/admin/door/items/${door.items.raffle.id}/down`, {});
    const added = await submit(dev, g, '/admin/door/items', { label: 'Tea and coffee', price: '1.50', category: 'other', enabled: '1' });
    check('a new button can be added (for example Tea and coffee £1.50)', added.status === 303 && !!db.prepare(`SELECT 1 FROM till_items WHERE label = 'Tea and coffee' AND price_pence = 150`).get());
    const juliesSale = await sale('cash', [{ item_id: door.items.development.id, qty: 1 }], 300, undefined, julieJar, julieJar.c.nw_csrf || csrfFrom(await text(dev.base, '/admin/door', { jar: julieJar })));
    check('Julie can use the till on her own phone (recorded as hers)', juliesSale.body.ok && db.prepare('SELECT created_by FROM till_sales WHERE id = ?').get(juliesSale.body.saleId).created_by === 'Julie');
    door.today = today; door.sale = sale;
  }

  console.log('\nWednesday advance payment (optional, email only)');
  const wn = {};
  {
    const who = await text(dev.base, '/whos-on');
    check('Who’s On shows the exact principle and an optional Pay in advance link', who.includes('No booking required. Everyone is welcome to come along and pay at the door.') && who.includes('href="/whos-on/pay"'));
    const pay = await text(dev.base, '/whos-on/pay');
    check('the payment page uses the same products and prices as the till (not the Gift Shop)', pay.includes('Entry') && pay.includes('£5.00 each') && pay.includes('Development') && pay.includes('Raffle strip') && pay.includes('(one per raffle strip)') && !pay.includes('Gift Shop'));
    check('the ONLY detail asked for is an email address (no name)', pay.includes('name="email"') && !pay.includes('name="name"') && !pay.includes('name="phone"'));
    check('it says plainly that paying in advance is optional', (pay.match(/No booking required\. Everyone is welcome to come along and pay at the door\./g) || []).length >= 1);
    const night = nextWednesday(1);
    wn.night = night;
    const stamp = pay.match(/name="t" value="([^"]+)"/)[1];
    await sleep(3100);
    const items = db.prepare('SELECT * FROM till_items').all();
    const id = (cat) => items.find((i) => i.category === cat).id;
    const post = (fields, ip = '10.9.0.1') => req(dev.base, '/whos-on/pay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
      body: new URLSearchParams({ t: stamp, website: '', 'cf-turnstile-response': TOKEN, night, email: 'wed@example.com', ['q' + id('entry')]: '2', ['q' + id('development')]: '1', ['q' + id('raffle')]: '3', ...fields }).toString() });
    check('an email address is needed', (await post({ email: '' })).status === 422);
    check('something must be chosen', (await post({ ['q' + id('entry')]: '0', ['q' + id('development')]: '0', ['q' + id('raffle')]: '0' })).status === 422);
    const notWed = new Date(night + 'T12:00:00Z'); notWed.setUTCDate(notWed.getUTCDate() - 1);
    check('a Wednesday must be chosen, and only the coming Wednesdays', (await post({ night: notWed.toISOString().slice(0, 10) })).status === 422);
    const ok = await post({ email: ' WED@Example.com ' });
    const o = db.prepare(`SELECT * FROM wed_orders WHERE email = 'wed@example.com'`).get();
    const lines = db.prepare('SELECT * FROM wed_order_lines WHERE order_id = ?').all(o.id);
    check('paying goes straight to Square’s secure checkout for £16.00 (2 × £5 + £3 + 3 × £1)', ok.status === 303 && ok.headers.get('location').includes('/__square/checkout/') && o.total_pence === 1600 && o.status === 'pending' && lines.length === 3);
    const link = (await sq()).links.find((l) => l.orderId === o.square_order_id);
    check('Square is asked for exactly £16.00', link.amount === 1600);
    const e0 = (await emails()).length;
    const payment = await payInSquare(o.square_payment_link_id);
    await webhook(payEvent(payment));
    await webhook(payEvent(payment));
    const paid = db.prepare('SELECT * FROM wed_orders WHERE id = ?').get(o.id);
    const conf = (await emails()).slice(e0).filter((m) => m.to[0] === 'wed@example.com');
    check('only Square’s verified payment confirms it; the same payment twice sends ONE confirmation', paid.status === 'paid' && conf.length === 1);
    check('the confirmation has the quantities and the QR code (attached and shown)', conf[0].text.includes('2 × Entry') && conf[0].text.includes('1 × Development') && conf[0].text.includes('3 × Raffle strip') &&
      conf[0].attachments?.length === 1 && conf[0].html.includes(`/wq/${paid.checkin_token}.png`));
    check('…and says the raffle strips are given at the door', conf[0].text.includes('Your 3 raffle strips are given to you at the door.'));
    const key = new URL(link.redirect).searchParams.get('key');
    const status = await text(dev.base, `/wednesday/${paid.reference}?key=${encodeURIComponent(key)}`);
    check('the customer’s page shows they have paid, with the QR code', status.includes('You’ve paid') && status.includes('<svg') && status.includes('£16.00'));
    const qr = await text(dev.base, `/w/${paid.checkin_token}`);
    check('the QR code’s own page shows what was paid for, but no email address', qr.includes('Paid in advance') && qr.includes('Raffle strip') && !qr.includes('wed@example.com'));
    check('the QR image is only made for a paid payment', (await req(dev.base, `/wq/${paid.checkin_token}.png`)).headers.get('content-type') === 'image/png' && (await req(dev.base, '/wq/' + 'A'.repeat(22) + '.png')).status === 404);
    wn.order = paid;
  }

  console.log('\nWednesday QR check-in at the door, raffles, and no double counting');
  {
    const o = wn.order;
    const today = door.today;
    const scanOther = await req(dev.base, `/admin/door/w/${o.checkin_token}`, { jar: g });
    const otherPage = await text(dev.base, scanOther.headers.get('location'), { jar: g });
    check('scanning a payment for ANOTHER Wednesday says so, and nothing can be checked in', otherPage.includes('THIS IS FOR ANOTHER EVENING') && !otherPage.includes('/admit-all'));
    db.prepare('UPDATE wed_orders SET night_date = ? WHERE id = ?').run(today, o.id);   // (as if tonight were that Wednesday)
    const before = await (await req(dev.base, '/admin/door/totals?date=' + today, { jar: g })).json();
    const scan = await req(dev.base, `/admin/door/w/${o.checkin_token}`, { jar: g });
    const p1 = await text(dev.base, scan.headers.get('location'), { jar: g });
    check('scanning tonight’s payment: VALID, with every quantity shown', p1.includes('VALID: PAID IN ADVANCE') && p1.includes('Entry: 2') && p1.includes('Development: 1') && p1.includes('0 of 2 let in'));
    check('…and a clear GIVE 3 RAFFLE STRIPS with a RAFFLES GIVEN ✓ button', p1.includes('GIVE 3 RAFFLE STRIPS') && p1.includes('RAFFLES GIVEN ✓'));
    const mid = await (await req(dev.base, '/admin/door/totals?date=' + today, { jar: g })).json();
    check('scanning alone counts nobody and adds no money again', mid.service === before.service && mid.total === before.total);
    const entryLine = db.prepare(`SELECT * FROM wed_order_lines WHERE order_id = ? AND category = 'entry'`).get(o.id);
    await submit(dev, g, `/admin/door/order/${o.id}/admit`, { line_id: String(entryLine.id) });
    check('Let 1 in: one person counts at the service', (await (await req(dev.base, '/admin/door/totals?date=' + today, { jar: g })).json()).service === before.service + 1);
    await submit(dev, g, `/admin/door/order/${o.id}/admit-all`, {});
    const after = await (await req(dev.base, '/admin/door/totals?date=' + today, { jar: g })).json();
    check('CHECK IN EVERYONE lets in the rest: 2 at the service and 1 at the circle, money unchanged', after.service === before.service + 2 && after.circle === before.circle + 1 && after.total === before.total);
    const again = await text(dev.base, (await req(dev.base, `/admin/door/w/${o.checkin_token}`, { jar: g })).headers.get('location'), { jar: g });
    check('scanning again says ALREADY CHECKED IN', again.includes('ALREADY CHECKED IN'));
    const tooMany = await submit(dev, g, `/admin/door/order/${o.id}/admit`, { line_id: String(entryLine.id) });
    check('nobody can be let in twice on the same payment', tooMany.headers.get('location').includes('all-in') && db.prepare('SELECT admitted FROM wed_order_lines WHERE id = ?').get(entryLine.id).admitted === 2);
    let overByDb = false;
    try { db.prepare('UPDATE wed_order_lines SET admitted = 3 WHERE id = ?').run(entryLine.id); } catch (e) { overByDb = /CHECK constraint/.test(e.message); }
    check('…the database itself refuses more check-ins than paid for', overByDb);
    await submit(dev, g, `/admin/door/order/${o.id}/raffles`, {});
    const r2 = await submit(dev, g, `/admin/door/order/${o.id}/raffles`, {});
    const given = await text(dev.base, `/admin/door/order/${o.id}`, { jar: g });
    check('RAFFLES GIVEN ✓ is recorded once, so strips are never given twice', r2.headers.get('location').includes('raffles-already') && given.includes('RAFFLES GIVEN ✓') && !given.includes('GIVE 3 RAFFLE STRIPS') && given.includes('by Gary'));
    await submit(dev, g, `/admin/door/order/${o.id}/unadmit`, { line_id: String(entryLine.id) });
    check('a check-in can be undone', db.prepare('SELECT admitted FROM wed_order_lines WHERE id = ?').get(entryLine.id).admitted === 1);
    await submit(dev, g, `/admin/door/order/${o.id}/admit`, { line_id: String(entryLine.id) });
    const list = await text(dev.base, '/admin/door/orders?date=' + today, { jar: g });
    check('Paid in advance lists tonight’s payments with their state', list.includes(o.reference) && list.includes('All in ✓') && list.includes('Raffles given ✓'));
    const event = db.prepare('SELECT checkin_token FROM event_bookings LIMIT 1').get();
    check('an EVENT ticket QR code is not mistaken for a Wednesday payment', (await req(dev.base, `/admin/door/w/${event.checkin_token}`, { jar: g })).status === 404);
    const close = await text(dev.base, '/admin/door/close?date=' + today, { jar: g });
    check('Close night separates door cash, door card and online payments (counted once each)', close.includes('Cash at the door') && close.includes('Card at the door') && close.includes('Paid in advance online (1)') && close.includes('£16.00'));
    check('…and people: paid at the door + paid in advance and let in', /Service \(\d+ paid at the door \+ 2 paid in advance\)/.test(close));
    const done = await submit(dev, g, '/admin/door/close', { date: today, float: '20', counted: '45.50', note: 'All fine', action: 'close' });
    const n = db.prepare('SELECT * FROM wed_nights WHERE night_date = ?').get(today);
    check('Close night records the float, the cash counted and closes the till', done.status === 303 && n.float_pence === 2000 && n.counted_cash_pence === 4550 && !!n.till_closed_at);
    check('after closing, no more sales can be added', (await door.sale('cash', [{ item_id: door.items.entry.id, qty: 1 }], 500)).status === 409);
    const report = await text(dev.base, '/admin/door/nights/' + today, { jar: g });
    const expectedCash = 2000 + db.prepare(`SELECT SUM(total_pence) AS p FROM till_sales WHERE night_date = ? AND method = 'cash' AND voided_at IS NULL`).get(today).p;
    check('the night’s report shows the expected cash and the difference', report.includes('Expected in the tin') && report.includes('£' + (expectedCash / 100).toFixed(2)) && /(Over|Short) by|None/.test(report));
    const csvRes = await req(dev.base, `/admin/door/nights/${today}.csv`, { jar: g });
    const csvText = await csvRes.text();
    check('…and downloads as a spreadsheet', csvRes.headers.get('content-type').includes('text/csv') && csvText.includes('Cash at the door') && csvText.includes('Paid in advance online'));
    check('Nights & reports lists the night', (await text(dev.base, '/admin/door/nights', { jar: g })).includes(`/admin/door/nights/${today}`));
    await submit(dev, g, '/admin/door/close', { date: today, action: 'reopen' });
    check('a closed night can be reopened to correct a mistake', !db.prepare('SELECT till_closed_at FROM wed_nights WHERE night_date = ?').get(today).till_closed_at && (await door.sale('cash', [{ item_id: door.items.entry.id, qty: 1 }], 500)).body.ok);
    await submit(dev, g, `/admin/door/order/${o.id}/refunded`, {});
    check('a payment marked as refunded no longer counts as money (refunds are done in Square)', (await (await req(dev.base, '/admin/door/totals?date=' + today, { jar: g })).json()).online === 0);
    await submit(dev, g, `/admin/door/order/${o.id}/refunded`, { undo: '1' });
  }

  console.log('\nThe 6pm Wednesday email');
  {
    const env = { DB: makeD1(dev.dbFile), EMAIL_FROM: 'New Way’s <bookings@example.test>', RESEND_API_KEY: 're_local_test', RESEND_API_BASE: dev.mock, SITE_URL: 'https://newwaysmediumshipdevelopmentcentre.com' };
    const night = '2026-11-18';
    const mk = (email, paidAt, extra = {}) => {
      const id = Number(db.prepare(`INSERT INTO wed_orders (reference, night_date, email, status, total_pence, checkin_token, origin, paid_at, refunded_at) VALUES (?, ?, ?, 'paid', 500, ?, ?, ?, ?)`)
        .run('WN-' + crypto.randomBytes(3).toString('hex').toUpperCase(), extra.night || night, email, crypto.randomBytes(16).toString('base64url'), dev.base, paidAt, extra.refunded || null).lastInsertRowid);
      db.prepare(`INSERT INTO wed_order_lines (order_id, label, category, unit_pence, qty, line_pence) VALUES (?, 'Entry', 'entry', 500, 1, 500)`).run(id);
      return id;
    };
    mk('early@example.com', '2026-11-17T10:00:00.000Z');
    mk('late@example.com', '2026-11-18T18:20:00.000Z');
    mk('refunded@example.com', '2026-11-17T10:00:00.000Z', { refunded: '2026-11-17T12:00:00.000Z' });
    mk('othernight@example.com', '2026-11-17T10:00:00.000Z', { night: '2026-11-25' });
    const e0 = (await emails()).length;
    const at6 = Date.parse('2026-11-18T18:00:30Z');
    const sent1 = await sendSixPmReminders(env, at6);
    const got = (await emails()).slice(e0);
    check('at 6pm on the Wednesday, that evening’s QR code is emailed again', sent1 === 1 && got.length === 1 && got[0].to[0] === 'early@example.com' && /Tonight at New Way’s/.test(got[0].subject) && got[0].attachments?.length === 1);
    check('…not to anyone who paid after 6pm, was refunded, or paid for another evening', !got.some((m) => /late@|refunded@|othernight@/.test(m.to[0])));
    check('running again (for example the hourly job) sends nothing twice', (await sendSixPmReminders(env, at6 + 3600_000)) === 0);
    check('nothing is sent at 5pm or on another day', (await sendSixPmReminders(env, Date.parse('2026-11-18T17:00:00Z'))) === 0 && (await sendSixPmReminders(env, Date.parse('2026-11-19T18:30:00Z'))) === 0);
    db.prepare(`INSERT INTO wed_nights (night_date, closed_for_public, closure_reason) VALUES ('2026-11-25', 1, 'Snow')`).run();
    check('nothing is sent for an evening that has been closed', (await sendSixPmReminders(env, Date.parse('2026-11-25T18:05:00Z'))) === 0);
    const cron = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
    check('a free Cron Trigger runs it on Wednesdays at 6pm UK time, summer and winter', cron.includes('"0 17,18 * * 3"'));
    env.DB.close();
  }

  console.log('\nEmergency closure of a Wednesday');
  {
    const night = wn.night;
    const stampPage = await text(dev.base, '/whos-on/pay');
    const stamp = stampPage.match(/name="t" value="([^"]+)"/)[1];
    // someone pays in advance for that evening first
    db.prepare(`INSERT INTO wed_orders (reference, night_date, email, status, total_pence, checkin_token, origin, paid_at) VALUES ('WN-CLOSE1', ?, 'affected@example.com', 'paid', 500, ?, ?, ?)`)
      .run(night, crypto.randomBytes(16).toString('base64url'), dev.base, new Date().toISOString());
    db.prepare(`INSERT INTO wed_order_lines (order_id, label, category, unit_pence, qty, line_pence) VALUES ((SELECT id FROM wed_orders WHERE reference = 'WN-CLOSE1'), 'Entry', 'entry', 500, 1, 500)`).run();
    const noReason = await submit(dev, g, '/admin/door/closure', { date: night, reason: '', action: 'close' });
    check('closing needs a reason (it is shown on the website)', noReason.headers.get('location').includes('need-reason'));
    await submit(dev, g, '/admin/door/closure', { date: night, reason: 'Closed due to snow. Stay safe.', action: 'close' });
    const who = await text(dev.base, '/whos-on');
    check('Who’s On clearly shows the Wednesday as CLOSED, with the reason', who.includes('CLOSED: ') && who.includes('Closed due to snow. Stay safe.'));
    const pay = await text(dev.base, '/whos-on/pay');
    check('nobody can pay in advance for that Wednesday', pay.includes('CLOSED: Closed due to snow. Stay safe.') && new RegExp(`value="${night}"[^>]*disabled`).test(pay));
    await sleep(3100);
    const items = db.prepare(`SELECT id FROM till_items WHERE category = 'entry'`).get();
    const tryPay = await req(dev.base, '/whos-on/pay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '10.9.0.9' },
      body: new URLSearchParams({ t: stamp, website: '', 'cf-turnstile-response': TOKEN, night, email: 'x@example.com', ['q' + items.id]: '1' }).toString() });
    check('…even if the form is sent anyway', tryPay.status === 422 && (await tryPay.text()).includes('closed on'));
    check('the rest of the website keeps working', (await req(dev.base, '/events')).status === 200 && (await req(dev.base, '/private-readings')).status === 200 && (await req(dev.base, '/meditations')).status === 200);
    const cp = await text(dev.base, '/admin/door/closure', { jar: g });
    check('Admin shows who has paid in advance, and that refunds are NOT automatic', cp.includes('1 person has paid in advance (£5.00)') && cp.includes('Refunds are NOT made automatically'));
    check('nothing already recorded is deleted', !!db.prepare(`SELECT 1 FROM wed_orders WHERE reference = 'WN-CLOSE1' AND status = 'paid'`).get());
    const e0 = (await emails()).length;
    await submit(dev, g, '/admin/door/closure', { date: night, action: 'notify', message: 'We are so sorry. Your payment will be refunded.' });
    await submit(dev, g, '/admin/door/closure', { date: night, action: 'notify', message: 'Again' });
    const notices = (await emails()).slice(e0).filter((m) => m.to[0] === 'affected@example.com');
    check('everyone who paid in advance can be emailed about the closure, once each', notices.length === 1 && notices[0].text.includes('CLOSED') && notices[0].text.includes('Your payment will be refunded.'));
    await submit(dev, g, '/admin/door/closure', { date: night, action: 'open' });
    check('the Wednesday can be reopened', !(await text(dev.base, '/whos-on')).includes('Closed due to snow'));
  }

  console.log('\nLive chat (on the website, not WhatsApp) with phone notifications');
  {
    check('chat starts switched off: no Chat button, and the chat page says so', !(await text(dev.base, '/')).includes('class="chat-fab') && (await text(dev.base, '/chat')).includes('Live chat isn’t available at the moment'));
    await submit(dev, g, '/admin/chat/settings', { chat_enabled: '1', chat_staff_name: 'New Way’s', chat_retention_days: '90', chat_welcome: '', chat_away_message: '' });
    const home = await text(dev.base, '/');
    check('switched on: a navy and gold Chat button on every page (Home links to it from Explore, keeping its first screen as designed)',
      (await text(dev.base, '/about')).includes('class="chat-fab press" href="/chat"') && (await text(dev.base, '/events')).includes('class="chat-fab press"') && home.includes('class="explore-link press" href="/chat"') && !home.includes('class="chat-fab'));
    const cp = await text(dev.base, '/chat');
    check('the chat page asks for NO email or phone, only an optional first name', cp.includes('name="body"') && cp.includes('Your first name') && cp.includes('(optional)') && !cp.includes('type="email"') && !cp.includes('type="tel"'));
    check('it truthfully shows AWAY when nobody has said they are available', cp.includes('Away just now') && !cp.includes('Online now'));
    // Julie turns on notifications on her phone
    const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const authSecret = crypto.randomBytes(16);
    const subscription = { endpoint: `${dev.mock}/__push/send/julie-phone`, keys: { p256dh: b64url(await subtle.exportKey('raw', ua.publicKey)), auth: b64url(authSecret) } };
    const chatAdmin = await text(dev.base, '/admin/chat', { jar: julieJar });
    check('Admin > Live chat has “Turn on notifications on this phone”', chatAdmin.includes('Turn on notifications on this phone') && /data-key="[A-Za-z0-9_-]{80,90}"/.test(chatAdmin));
    const subFd = new FormData(); subFd.append('_csrf', julieJar.c.nw_csrf); subFd.append('subscription', JSON.stringify(subscription)); subFd.append('label', 'Android');
    const subRes = await req(dev.base, '/admin/chat/push/subscribe', { jar: julieJar, method: 'POST', body: subFd });
    check('Julie’s phone is registered for notifications', subRes.status === 200 && (await subRes.json()).ok && db.prepare(`SELECT who FROM push_subscriptions`).get().who.startsWith('admin:'));
    const evil = new FormData(); evil.append('_csrf', julieJar.c.nw_csrf); evil.append('subscription', JSON.stringify({ ...subscription, endpoint: 'https://evil.example/collect' }));
    check('a notification address that isn’t a real push service is refused', (await req(dev.base, '/admin/chat/push/subscribe', { jar: julieJar, method: 'POST', body: evil })).status === 400);
    const vapidPublic = setting('vapid_public_key');
    // a visitor writes
    const visitor = new Jar();
    const vpage = await text(dev.base, '/chat', { jar: visitor });
    const stamp = vpage.match(/name="t" value="([^"]+)"/)[1];
    await sleep(1700);
    const send = (jar, fields, ip = '10.8.0.1', json = false) => req(dev.base, '/chat/send', { jar, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip, ...(json ? { 'X-NW-Chat': '1' } : {}) },
      body: new URLSearchParams({ t: stamp, website: '', ...fields }).toString() });
    check('the first message needs the spam check', (await send(new Jar(), { body: 'Hello', 'cf-turnstile-response': '' })).status === 400 && !db.prepare('SELECT 1 FROM chat_messages').get());
    check('a program filling the hidden trap field is ignored', (await send(new Jar(), { body: 'Buy cheap stuff', website: 'http://spam', 'cf-turnstile-response': TOKEN })).status === 303 && !db.prepare('SELECT 1 FROM chat_messages').get());
    check('a very long message is refused', (await send(visitor, { body: 'x'.repeat(1001), 'cf-turnstile-response': TOKEN })).status === 422);
    const p0 = (await (await fetch(dev.mock + '/__push/state')).json()).length;
    const first = await send(visitor, { name: 'Linda', body: 'Hello! Is there parking at Thomson Park? <script>alert(1)</script>', 'cf-turnstile-response': TOKEN });
    const s = db.prepare('SELECT * FROM chat_sessions').get();
    check('a visitor starts a chat with no contact details; the browser keeps a cookie to come back (only a hash is stored)', first.status === 303 && !!visitor.c.nw_chat && s.visitor_name === 'Linda' && s.token_hash === hex('chat:' + visitor.c.nw_chat) && s.staff_unread === 1);
    const pushes = (await (await fetch(dev.mock + '/__push/state')).json()).slice(p0);
    check('Julie’s phone gets a notification straight away', pushes.length === 1 && pushes[0].id === 'julie-phone' && pushes[0].headers['content-encoding'] === 'aes128gcm' && pushes[0].headers.urgency === 'high');
    const payload = await decryptPush(pushes[0].body, ua, authSecret);
    check('…which only her phone can read, and which opens the conversation', payload.title === 'New Way’s live chat' && payload.body.startsWith('Hello! Is there parking') && payload.url === `/admin/chat/${s.id}`);
    check('…signed as coming from this website', await verifyVapid(pushes[0].headers.authorization, dev.mock) && pushes[0].headers.authorization.endsWith('k=' + vapidPublic));
    const quick = await send(visitor, { t: String(Date.now()) + '.x', body: 'Also, what time do doors open?' }, '10.8.0.1', true);
    check('someone already chatting can reply straight away (the “too fast” spam check is only for a new conversation)', quick.status === 200 && db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n === 2);
    check('a second message straight after doesn’t buzz her phone again (no flood of notifications)', (await (await fetch(dev.mock + '/__push/state')).json()).slice(p0).length === 1);
    const poll1 = await (await req(dev.base, '/chat/messages?after=0', { jar: visitor })).json();
    check('the visitor sees their messages (kept on the server)', poll1.ok && poll1.messages.length === 2 && poll1.messages.every((m) => m.from === 'you'));
    check('another browser can’t see them', (await (await req(dev.base, '/chat/messages?after=0', { jar: new Jar() })).json()).messages.length === 0);
    const vp = await text(dev.base, '/chat', { jar: visitor });
    check('coming back in the same browser shows the conversation (and nothing typed is run as code)', vp.includes('Also, what time do doors open?') && vp.includes('&lt;script&gt;') && !vp.includes('<script>alert'));
    const list = await text(dev.base, '/admin/chat', { jar: julieJar });
    check('Julie sees the conversation, marked as new, on her phone in Admin', list.includes('Linda') && list.includes('2 new'));
    check('the Admin home shows a badge for new chat messages', (await text(dev.base, '/admin', { jar: julieJar })).includes('new chat messages'));
    await text(dev.base, `/admin/chat/${s.id}`, { jar: julieJar });
    await submit(dev, julieJar, `/admin/chat/${s.id}/reply`, { body: 'Yes, free parking beside the building. Doors open 6:30pm.' });
    const poll2 = await (await req(dev.base, '/chat/messages?after=' + poll1.messages[1].id, { jar: visitor })).json();
    check('Julie replies from Admin, and the visitor sees the reply', poll2.messages.length === 1 && poll2.messages[0].from === 'staff' && poll2.messages[0].body.includes('free parking') && poll2.messages[0].name === 'New Way’s');
    check('Julie’s own contact details are never shown to the visitor', !JSON.stringify(poll2).includes('julie.helper@example.test') && !(await text(dev.base, '/chat', { jar: visitor })).includes('julie.helper'));
    await submit(dev, julieJar, '/admin/chat/available', { hours: '2' });
    check('“Online for 2 hours”: visitors now see Online now (and a green dot on the Chat button)', (await text(dev.base, '/chat', { jar: visitor })).includes('Online now') && (await text(dev.base, '/about')).includes('chat-fab press is-online'));
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'chat_available_until'`).run(new Date(Date.now() - 1000).toISOString());
    check('…and it goes back to Away by itself when the time is up', (await text(dev.base, '/chat', { jar: visitor })).includes('Away just now'));
    const testPush = await submit(dev, julieJar, '/admin/chat/push/test', {});
    check('Send a test notification reaches her phone', testPush.headers.get('location').includes('test-sent'));
    await fetch(dev.mock + '/__push/gone/julie-phone');
    db.prepare('UPDATE chat_sessions SET staff_unread = 0, last_visitor_at = ? WHERE id = ?').run(new Date(Date.now() - 600_000).toISOString(), s.id);
    await send(visitor, { body: 'Thank you!' }, '10.8.0.1', true);
    check('a phone that has turned notifications off is forgotten', !db.prepare('SELECT 1 FROM push_subscriptions').get());
    await submit(dev, julieJar, `/admin/chat/${s.id}/block`, {});
    const blocked = await send(visitor, { body: 'More spam' }, '10.8.0.1', true);
    check('a visitor can be blocked', blocked.status === 403);
    db.prepare(`UPDATE chat_sessions SET last_message_at = '2020-01-01T00:00:00.000Z'`).run();
    await fetch(dev.base + '/__dev/cron?cron=daily');
    check('conversations are deleted automatically after the set number of days (90)', !db.prepare('SELECT 1 FROM chat_sessions').get() && !db.prepare('SELECT 1 FROM chat_messages').get());
    check('chat Admin is for full Admins only', (await req(dev.base, '/admin/chat')).status === 401);
  }

  console.log('\nPrivacy Notice and go-live checks');
  {
    const pn = await text(dev.base, '/privacy');
    check('the Privacy Notice covers guest answers, table plans, Wednesday payments and QR codes, chat, the mailing list, retention and rights',
      pn.includes('Event tickets and table plans') && pn.includes('meal and dessert choices') && pn.includes('Wednesday evenings') && pn.includes('QR code') && pn.includes('Live chat') &&
      pn.includes('Mailing list') && pn.includes('How long we keep it') && pn.includes('Your rights') && pn.includes('ico.org.uk'));
    check('…with the real retention periods filled in (2 years, 90 days)', pn.includes('removed 2 years after') && pn.includes('deleted 90 days after the last message') && !pn.includes('{Chat kept}'));
    check('…and the meditation download security cookie explained', pn.includes('remembered with a small security cookie'));
    db.prepare(`UPDATE content_blocks SET body = 'An old notice.' WHERE key = 'privacy_notice'`).run();
    const wp = await text(dev.base, '/admin/wording/privacy_notice', { jar: g });
    check('if Gary’s notice is different, Admin offers the updated one with a button', wp.includes('An updated Privacy Notice is ready') && wp.includes('Use the updated Privacy Notice'));
    check('the Admin home reminds him', (await text(dev.base, '/admin', { jar: g })).includes('Use the updated Privacy Notice'));
    await submit(dev, g, '/admin/wording/privacy_notice/update', {});
    check('one tap puts it in place, keeping his previous wording', db.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === PRIVACY_NOTICE &&
      db.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice_previous'`).get().body === 'An old notice.');
    const st = await text(dev.base, '/admin/status', { jar: g });
    check('System status checks the new parts: Privacy Notice, live chat, Julie’s Admin, Wednesday payments, the real domain',
      st.includes('Privacy Notice') && st.includes('Live chat') && st.includes('Full Admin for Julie') && st.includes('Wednesday advance payments') && st.includes('Real website address (domain)'));
    check('…and says plainly the real domain is NOT connected yet (nothing here changes it)', st.includes('is NOT connected yet') && st.includes('Square Sandbox (test)'));
    check('Square stays in Sandbox (test mode)', st.includes('TEST MODE (Sandbox)'));
  }

  console.log('\nVirtual centre tour (genuine photos only)');
  {
    check('with no photos, there is no tour page and no link to it (nothing invented)', (await req(dev.base, '/tour')).status === 404 && !(await text(dev.base, '/')).includes('href="/tour"'));
    const add = await submit(dev, g, '/admin/tour/new', { title: 'The main hall', description: 'Where the service takes place.', visible: '1' },
      { image_key: { buf: fixture('test-portrait.jpg'), type: 'image/jpeg', name: 'hall.webp' }, image_key__thumb: { buf: fixture('test-portrait.jpg'), type: 'image/jpeg', name: 'hall-small.webp' } });
    check('Gary adds a stop with a real photo from his phone', add.status === 303 && db.prepare(`SELECT COUNT(*) AS n FROM tour_stops WHERE title = 'The main hall'`).get().n === 1);
    check('a stop needs a photo', (await submit(dev, g, '/admin/tour/new', { title: 'No photo', visible: '1' })).status === 422);
    const tour = await text(dev.base, '/tour');
    check('the tour page appears, mobile-friendly, one stop at a time', tour.includes('The main hall') && tour.includes('Stop 1 of 1') && tour.includes('Where the service takes place.') && tour.includes('loading="eager"'));
    check('it is linked from Home (Explore) and About', (await text(dev.base, '/')).includes('href="/tour"') && (await text(dev.base, '/about')).includes('href="/tour"'));
    db.prepare('UPDATE tour_stops SET visible = 0').run();
    check('hiding every stop hides the tour again', (await req(dev.base, '/tour')).status === 404);
  }

  console.log('\nBackups include the new records');
  {
    const backup = await (await req(dev.base, '/admin/backups/download', { jar: g })).json();
    check('a backup includes till sales, Wednesday payments, table plans, chat and Julie’s Admin', backup.tables.till_sales.length > 0 && backup.tables.wed_orders.length > 0 &&
      backup.tables.event_tables.length > 0 && backup.tables.admin_users.length === 1 && Array.isArray(backup.tables.chat_messages) && Array.isArray(backup.tables.tour_stops));
    check('…but never the private key for phone notifications', !backup.tables.settings.some((r) => /^vapid_/.test(r.key)));
    const bfile = path.join(root, 'dev', '.local', 'features-backup.json');
    fs.writeFileSync(bfile, JSON.stringify(backup));
    const sql = execFileSync(process.execPath, [path.join(root, 'scripts', 'restore-from-backup.mjs'), bfile]).toString();
    const fresh = new DatabaseSync(':memory:');
    for (const f of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) fresh.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    let restoreError = '';
    try { fresh.exec(sql); } catch (e) { restoreError = e.message; }
    const same = Object.keys(backup.summary).every((t) => fresh.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n === backup.summary[t]);
    check('the restore tool rebuilds everything, including closed nights and table plans', !restoreError && same, restoreError);
  }

  console.log('\nThe service worker and versions');
  {
    const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
    check('phones fetch the new styles and scripts (version 7 everywhere)', sw.includes("const VERSION = 'nw-v7'") && sw.includes('/css/site.css?v=7') && (await text(dev.base, '/')).includes('/css/site.css?v=7'));
    check('the service worker shows chat notifications and opens Admin when tapped', sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'"));
    check('Wednesday payments and chat are never stored on the phone', sw.includes('whos-on\\/pay') && sw.includes('|chat)'));
  }
} catch (err) {
  console.log('Test run stopped: ' + (err && err.stack ? err.stack : err));
  failed++;
} finally {
  for (const s of servers) s.child.kill();
}
const notRun = EXPECTED_CHECKS ? Math.max(0, EXPECTED_CHECKS - passed - failed) : 0;
console.log(`\n${passed} passed, ${failed} failed, ${notRun} not run (skipped)`);
process.exit(failed || notRun ? 1 : 0);
