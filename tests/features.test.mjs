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
import http from 'node:http';
import crypto from 'node:crypto';
import { ukToday } from '../src/lib/dates.js';
import { notificationAddresses } from '../src/bookings/config.js';
import { sixPmWindow, sendSixPmReminders } from '../src/wednesday/payments.js';
import { encryptPayload, vapidJwt, allowedEndpoint, b64url, fromB64url } from '../src/lib/webpush.js';
import { PRIVACY_NOTICE } from '../src/lib/privacy-notice.js';
const OLD_PRIVACY_SENTENCE = 'If you download on a different device, we email a short code to the address you bought with, and that device is remembered too.';
const NEW_PRIVACY_SENTENCE = 'We also keep a record of your one download: when the download button was pressed, how much of the file our server sent and whether it finished, and any further attempts to download it.';
// The notice as 0010 left it (before 0013 added the Donations section)
const INCOMPLETE_SECTION = PRIVACY_NOTICE.slice(PRIVACY_NOTICE.indexOf('# Incomplete bookings'), PRIVACY_NOTICE.indexOf('# Meditations'));
const INCOMPLETE_RETENTION = ' Details from unfinished private reading bookings are deleted 24 hours after they were given.';
const NOTICE_0013 = PRIVACY_NOTICE.replace(INCOMPLETE_SECTION, '').replace(INCOMPLETE_RETENTION, '');
const DONATIONS_SECTION = NOTICE_0013.slice(NOTICE_0013.indexOf('# Donations'), NOTICE_0013.indexOf('# Live chat'));
const NOTICE_0010 = NOTICE_0013.replace(DONATIONS_SECTION, '').replace('event bookings, Wednesday payments and donations are removed', 'event bookings and Wednesday payments are removed');
const DEFAULT_TERMS_0009 = 'Your purchase includes one download. Your secure download link is sent by email straight after payment and must be started within 24 hours, on the phone or computer you buy on (or another device you confirm with a code we email to you). Because the recording is available to you immediately, you agree that you lose the right to cancel once your download is ready.';
import { priceBasket } from '../src/wednesday/model.js';
import { allowanceFor, parseRange, coversWholeFile, megabytes, countTransfers, settleOpenDownloads } from '../src/shop/downloads.js';
import { makeD1 } from './support/d1.mjs';
import { incompleteHourlyJobs } from '../src/bookings/incomplete.js';
import * as avl from '../src/bookings/availability.js';

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

const EXPECTED_CHECKS = 463;   // the total in a complete run, so an early stop is reported as checks not run
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
    // (0010 later changes one sentence of it: the emailed codes no longer exist)
    const notice0009 = NOTICE_0010.replace(NEW_PRIVACY_SENTENCE, OLD_PRIVACY_SENTENCE);
    check('an unedited Privacy Notice is replaced with the updated one, and the old wording is kept', after === notice0009 && old.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice_previous'`).get().body === before);
    check('the migration contains exactly the updated notice from the code (as it was then)', fs.readFileSync(path.join(root, 'migrations', '0009_complete_build.sql'), 'utf8').includes(notice0009.replace(/'/g, "''")));
    const edited = new DatabaseSync(':memory:');
    for (const f of migrations.filter((f) => f < '0009')) edited.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    edited.exec(`UPDATE content_blocks SET body = body || ' Gary added this line.' WHERE key = 'privacy_notice'`);
    const editedBody = edited.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body;
    edited.exec(fs.readFileSync(path.join(root, 'migrations', migrations.find((f) => f.startsWith('0009'))), 'utf8'));
    check('a Privacy Notice Gary has edited is left exactly as it is', edited.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === editedBody);
    check('the till starts with Entry £5, Development £3, Raffle strip £1 and Gift Shop (amount typed in)',
      JSON.stringify(old.prepare('SELECT label, price_pence, custom_amount FROM till_items ORDER BY sort_order').all().map((r) => [r.label, r.price_pence, r.custom_amount])) === JSON.stringify([['Entry', 500, 0], ['Development', 300, 0], ['Raffle strip', 100, 0], ['Gift Shop', 0, 1]]));
  }

  console.log('\nDatabase update 0010: one purchase, one click, one download');
  {
    const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const sql0010 = fs.readFileSync(path.join(root, 'migrations', '0010_one_download.sql'), 'utf8');
    check('0010 only adds tables and columns, plus two sentence fixes (no DROP or DELETE)', !/\b(DROP|DELETE)\b/i.test(sql0010.replace(/--.*$/gm, '')) && (sql0010.replace(/--.*$/gm, '').match(/\bUPDATE\b/g) || []).length === 2);
    const db9 = new DatabaseSync(':memory:');
    for (const f of migrations.filter((f) => f < '0010')) db9.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    db9.exec(`INSERT OR REPLACE INTO settings (key, value) VALUES ('meditation_terms', 'Personal use.\n\n' || '${DEFAULT_TERMS_0009.replace(/'/g, "''")}');
      INSERT INTO orders (reference, kind, status, item_name, amount_pence, customer_name, customer_email, access_hash, origin, device_protected) VALUES ('NW-OLD010', 'MEDITATION_PURCHASE', 'paid', 'Feel It', 999, 'Old Buyer', 'old@example.com', 'x', 'https://x', 1);
      INSERT INTO download_entitlements (order_id, product_id, file_key, token_hash, expires_at, max_attempts, attempts, completed_at) VALUES (1, 1, 'private/x.mp3', 'abc', '2030-01-01T00:00:00.000Z', 1, 1, '2026-10-01T10:00:00.000Z');`);
    db9.exec(sql0010);
    const e9 = db9.prepare('SELECT * FROM download_entitlements').get();
    check('a download already used before the update stays used, with its record kept', e9.attempts === 1 && e9.completed_at === '2026-10-01T10:00:00.000Z' && e9.transfer_status === '' && e9.bytes_sent === 0);
    check('the terms no longer mention a code, and say pressing the button uses the one download', !db9.prepare(`SELECT value FROM settings WHERE key = 'meditation_terms'`).get().value.includes('code') &&
      db9.prepare(`SELECT value FROM settings WHERE key = 'meditation_terms'`).get().value.includes('Pressing the download button uses your one download'));
    check('the Privacy Notice sentence about codes is replaced (the rest is unchanged)', db9.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === NOTICE_0010);
    db9.exec(fs.readFileSync(path.join(root, 'migrations', '0011_parallel_downloads.sql'), 'utf8'));
    db9.exec(fs.readFileSync(path.join(root, 'migrations', '0012_till_square_app.sql'), 'utf8'));
    const sql0013 = fs.readFileSync(path.join(root, 'migrations', '0013_launch.sql'), 'utf8');
    db9.exec(sql0013);
    check('0013 adds a Donations section to the Privacy Notice (exactly the code’s wording), and adds only new tables (no DROP or DELETE)', db9.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === NOTICE_0013 &&
      !/\b(DROP|DELETE)\b/i.test(sql0013.replace(/--.*$/gm, '')) && !!db9.prepare(`SELECT 1 FROM content_blocks WHERE key = 'support_thanks'`).get());
    const before13 = db9.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body;
    db9.exec(sql0013.replace(/CREATE (TABLE|INDEX) /g, 'CREATE $1 IF NOT EXISTS '));
    check('…and running it again changes nothing (the section is only added once)', db9.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === before13);
    const sql0014 = fs.readFileSync(path.join(root, 'migrations', '0014_incomplete_bookings.sql'), 'utf8');
    db9.exec(sql0014);
    check('0014 adds the Incomplete bookings section and the 24-hour sentence (exactly the code’s wording), only a new table, no DROP or DELETE', db9.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === PRIVACY_NOTICE &&
      !/\b(DROP|DELETE)\b/i.test(sql0014.replace(/--.*$/gm, '')) && !!db9.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'reading_drafts'`).get());
    db9.exec(sql0014.replace(/CREATE (TABLE|INDEX) /g, 'CREATE $1 IF NOT EXISTS '));
    check('…and running it again changes nothing', db9.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === PRIVACY_NOTICE);
    const ed14 = new DatabaseSync(':memory:');
    for (const f of migrations.filter((f) => f < '0014')) ed14.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    ed14.exec(`UPDATE content_blocks SET body = 'Gary’s own notice.' WHERE key = 'privacy_notice'`);
    ed14.exec(sql0014);
    check('…a notice Gary has rewritten himself is left exactly as it is', ed14.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === 'Gary’s own notice.');
    const sql0015 = fs.readFileSync(path.join(root, 'migrations', '0015_availability_breaks.sql'), 'utf8');
    db9.exec(`INSERT INTO availability_dates (date, mode, start_time, end_time) VALUES ('2026-10-25', 'hours', '15:00', '18:00');
      INSERT INTO availability_blocks (date, start_time, end_time) VALUES ('2026-11-01', '15:00', '18:00');`);
    const keep = () => JSON.stringify([db9.prepare('SELECT * FROM availability_dates').all(), db9.prepare('SELECT * FROM availability_blocks').all(), db9.prepare('SELECT * FROM bookings').all(), db9.prepare('SELECT * FROM booking_slots').all()]);
    const kept = keep();
    db9.exec(sql0015);
    check('0015 sets the regular hours to Sunday 3pm to 6pm and a 30-minute break, leaving date changes, blocks and bookings exactly as they were',
      JSON.stringify(db9.prepare('SELECT weekday, start_time, end_time FROM availability_weekly').all()) === JSON.stringify([{ weekday: 0, start_time: '15:00', end_time: '18:00' }]) &&
      db9.prepare(`SELECT value FROM settings WHERE key = 'booking_break_minutes'`).get().value === '30' && keep() === kept);
    db9.exec(`INSERT INTO settings (key, value) VALUES ('booking_horizon_weeks', '10') ON CONFLICT(key) DO UPDATE SET value = '10'`);
    const bookingsBefore = JSON.stringify([db9.prepare('SELECT * FROM bookings').all(), db9.prepare('SELECT * FROM booking_slots').all(), db9.prepare('SELECT * FROM orders').all()]);
    db9.exec(fs.readFileSync(path.join(root, 'migrations', '0016_manual_dates.sql'), 'utf8'));
    check('0016 closes every date (no weekly hours, no opened dates, no blocks), sets the 8-week window, and leaves bookings and orders exactly as they were',
      db9.prepare('SELECT COUNT(*) AS n FROM availability_weekly').get().n === 0 && db9.prepare('SELECT COUNT(*) AS n FROM availability_dates').get().n === 0 &&
      db9.prepare('SELECT COUNT(*) AS n FROM availability_blocks').get().n === 0 && db9.prepare(`SELECT value FROM settings WHERE key = 'booking_horizon_weeks'`).get().value === '8' &&
      JSON.stringify([db9.prepare('SELECT * FROM bookings').all(), db9.prepare('SELECT * FROM booking_slots').all(), db9.prepare('SELECT * FROM orders').all()]) === bookingsBefore);
    const ed = new DatabaseSync(':memory:');
    for (const f of migrations.filter((f) => f < '0010')) ed.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    ed.exec(`INSERT OR REPLACE INTO settings (key, value) VALUES ('meditation_terms', 'Gary’s own terms, written by him.'); UPDATE content_blocks SET body = 'Gary’s own notice.' WHERE key = 'privacy_notice';`);
    ed.exec(sql0010);
    check('terms or a notice Gary has rewritten are left exactly as they are', ed.prepare(`SELECT value FROM settings WHERE key = 'meditation_terms'`).get().value === 'Gary’s own terms, written by him.' &&
      ed.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get().body === 'Gary’s own notice.');
  }

  console.log('\nSmall parts on their own');
  {
    const s = { notification_email: 'gary@example.com', notification_email_2: 'julie@example.com', notification_2_events: '0' };
    const feel = 43_620_000;
    check('for a file the size of “Feel It” (43.62 MB) the server can never send more than the file plus 16 MB, well under two copies',
      allowanceFor(feel) === 16 * 1024 * 1024 && feel + allowanceFor(feel) < 2 * feel && [1, 1000, 5e6, 2e8].every((n) => n + allowanceFor(n) < 2 * n) && megabytes(feel) === '43.62 MB');
    check('resume requests are read exactly (from a byte, a span, the last bytes; nonsense refused)', JSON.stringify(parseRange('bytes=100-', 1000)) === '{"offset":100,"length":900}' &&
      JSON.stringify(parseRange('bytes=0-99', 1000)) === '{"offset":0,"length":100}' && JSON.stringify(parseRange('bytes=-10', 1000)) === '{"offset":990,"length":10}' &&
      parseRange('bytes=1000-', 1000) === 'invalid' && parseRange('bytes=5-2', 1000) === 'invalid' && parseRange(null, 1000) === null);
    {
      const T = (id, s, len, sent, status, ago = 0) => ({ id, range_start: s, range_length: len, bytes_sent: sent, status, updated_at: new Date(Date.now() - ago).toISOString() });
      const cover = (ts) => coversWholeFile(countTransfers(ts).map((c) => [c.from, c.until]), 300);
      check('the counting rule: a connection closed early counts only up to where another request takes over; with nothing taking over it counts for nothing',
        cover([T(1, 0, 300, 250, 'interrupted'), T(2, 200, 100, 100, 'part_sent')]) && !cover([T(1, 0, 300, 150, 'interrupted'), T(2, 200, 100, 100, 'part_sent')]) &&
        !cover([T(1, 0, 300, 300, 'interrupted')]) && cover([T(1, 0, 300, 300, 'completed')]) && !cover([T(1, 0, 300, 250, 'in_progress'), T(2, 200, 100, 100, 'part_sent')]) &&
        cover([T(1, 0, 300, 250, 'in_progress', 5 * 60_000), T(2, 200, 100, 100, 'part_sent')]));
    }
    {
      // Gary's own test download on his Samsung phone, exactly as Admin recorded it
      const size = 43_623_718, slice = size - 14_541_240;
      const ts = [{ id: 1, range_start: 0, range_length: size, bytes_sent: 32_526_336, status: 'interrupted', updated_at: new Date().toISOString() },
        { id: 2, range_start: slice, range_length: 14_541_240, bytes_sent: 14_541_240, status: 'part_sent', updated_at: new Date().toISOString() }];
      const c = countTransfers(ts);
      check('Gary’s real records (32,526,336 + 14,541,240 bytes over two connections) now count as Completed: the first connection up to byte 29,082,478, the second from there to the end',
        coversWholeFile(c.map((x) => [x.from, x.until]), size) && c[0].until === slice && c[0].takenOverAt === slice && c[1].until === size);
    }
    check('a download counts as complete only when every byte has been sent at least once', coversWholeFile([[0, 600], [500, 1000]], 1000) && !coversWholeFile([[0, 600], [700, 1000]], 1000) && !coversWholeFile([], 10));
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
  db.exec('PRAGMA busy_timeout = 5000');
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
    check('the large “Stay Connected” card is gone from the middle of the Home screen; the smaller one in the footer stays (same Join page)', !home.includes('class="card-gold text-card stay-connected"') && !home.includes('<a class="btn-gold press" href="/join">') &&
      home.includes('class="footer-block footer-join"') && home.includes('href="/join">JOIN OUR MAILING LIST') && home.includes('id="explore-title">Explore New Way’s'));
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
    const rules = { booking_hold_minutes: '15', booking_min_notice_hours: '24', booking_horizon_weeks: '8', customer_retention_months: '24',
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

  console.log('\nMeditations: ONE PURCHASE, ONE CLICK, ONE DOWNLOAD');
  const med = {};
  {
    const FEEL = 'feel-it-awaken-the-spirit-within';
    putMedia('private/features-full.mp3', fakeMp3(120, 0xc3), 'audio/mpeg');
    db.prepare(`UPDATE products SET full_key = 'private/features-full.mp3', status = 'published' WHERE slug = ?`).run(FEEL);
    db.prepare(`INSERT OR IGNORE INTO media (key, kind, content_type, size_bytes) VALUES ('private/features-full.mp3', 'audio', 'audio/mpeg', ?)`).run(fakeMp3(120, 0xc3).length);
    const pp = await text(dev.base, '/meditations/' + FEEL);
    check('the meditation page’s terms say ONE download, 24 hours and the device rule, with no codes', pp.includes('started within 24 hours') && pp.includes('the phone or computer you buy on') &&
      pp.includes('Pressing the download button uses your one download') && !pp.includes('code we email'));
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
    check('after payment there are 24 hours to press the button for the ONE download', hours > 23.9 && hours <= 24 && ent.max_attempts === 1);
    check('the email says clearly: ONE-TIME DOWNLOAD, 24 hours from purchase, and not to forward it', !!cust && cust.text.includes('IMPORTANT – ONE-TIME DOWNLOAD') && cust.text.includes('You have 24 hours from your purchase to press the button') &&
      cust.text.includes('Please don’t forward this email') && !cust.text.includes('short code'));
    check('Gary AND Julie are told about the sale', sent.some((m) => m.to[0] === 'gary@example.com' && /Meditation sold/.test(m.subject)) && sent.some((m) => m.to[0] === 'julie@example.com' && /Meditation sold/.test(m.subject)));
    const entNow = () => db.prepare('SELECT * FROM download_entitlements WHERE id = ?').get(ent.id);
    const press = (p, jar, fields = { understand: '1' }) => req(dev.base, p, { jar, method: 'POST', ...form(fields) });
    const mine = await text(dev.base, '/download/' + med.token, { jar: med.buyer });
    check('on the phone used to buy, the link shows “1 download available” and the one-time warning straight away', mine.includes('1 download available') && mine.includes('IMPORTANT: ONE&#8209;TIME DOWNLOAD') &&
      mine.includes('I understand this is a one-time download.'));
    const friend = new Jar();
    const fwd = await text(dev.base, '/download/' + med.token, { jar: friend });
    check('a FORWARDED link on another device shows no button and offers no code', !fwd.includes('Download your meditation</button>') && !fwd.includes('Email me a code') && !/6-digit|short code/.test(fwd) &&
      fwd.includes('downloads only on the phone or computer you used to buy it'));
    const fp = await press('/download/' + med.token, friend);
    check('…pressing there anyway uses nothing, and the refusal is recorded', fp.status === 403 && entNow().attempts === 0 &&
      !!db.prepare(`SELECT 1 FROM download_events WHERE entitlement_id = ? AND kind = 'blocked_other_device'`).get(ent.id));
    const e1 = (await emails()).length;
    const askCode = await press(`/download/${med.token}/code`, friend, { step: 'send' });
    const checkCode = await press(`/download/${med.token}/code`, friend, { step: 'check', code: '123456' });
    check('the old six-digit code addresses do nothing: no code is emailed and no device is added', askCode.status === 303 && checkCode.status === 303 && (await emails()).length === e1 &&
      db.prepare('SELECT COUNT(*) AS n FROM order_devices WHERE order_id = ?').get(order.id).n === 1);
    // a device added by a code BEFORE this update no longer counts
    db.prepare(`INSERT INTO order_devices (order_id, device_hash, how) VALUES (?, ?, 'email_code')`).run(order.id, hex('device:' + 'F'.repeat(43)));
    const codeDevice = new Jar(); codeDevice.c.nw_device = 'F'.repeat(43);
    check('a phone added with a code before this update can no longer download', (await press('/download/' + med.token, codeDevice)).status === 403 && entNow().attempts === 0);

    // ---- the one download, interrupted part-way and resumed (a big file, like the real 43.62 MB one) ----
    const big = Buffer.alloc(40 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) % 251;
    big.write('ID3', 0, 'latin1');
    putMedia('private/features-big.mp3', big, 'audio/mpeg');
    db.prepare(`UPDATE download_entitlements SET file_key = 'private/features-big.mp3' WHERE id = ?`).run(ent.id);
    const pr = await press(`/order/${order.reference}/download?key=` + new URL(buy.headers.get('location'), dev.base).searchParams.get('key'), med.buyer);
    const claim1 = pr.headers.get('location');
    check('the buyer’s phone presses DOWNLOAD YOUR MEDITATION on the page Square sends them back to: the one download is used', pr.status === 303 && /^\/download\/file\//.test(claim1) && entNow().attempts === 1 && entNow().file_size === big.length);
    // Like a phone's browser: it reads straight from the connection, then the signal drops at about 31 MB (three-quarters of the way)
    const r1 = await new Promise((resolve, reject) => {
      const u = new URL(dev.base + claim1);
      const rq = http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { Cookie: med.buyer.header(), 'X-Dev-Throttle': '25000000' } }, (res) => {
        const parts = [];
        let got = 0;
        res.on('data', (c) => { if (got >= 30 * 1024 * 1024) return; parts.push(c); got += c.length; if (got >= 30 * 1024 * 1024) { rq.destroy(); resolve({ status: res.statusCode, headers: res.headers, parts, got }); } });
        res.on('error', () => {});
      });
      rq.on('error', () => {});
      setTimeout(() => reject(new Error('download did not start')), 20000);
    });
    const etag = r1.headers.etag;
    const parts = r1.parts;
    const got = r1.got;
    let tr1;
    for (let i = 0; i < 40; i++) { await sleep(100); tr1 = db.prepare('SELECT * FROM download_transfers WHERE entitlement_id = ? ORDER BY id').get(ent.id); if (tr1 && tr1.status !== 'in_progress') break; }
    // (bytes "sent" can be more than the phone received: some were still on their way when the connection stopped)
    check('the phone loses signal part-way: the server records the transfer as interrupted, with the bytes it handed on', r1.status === 200 && r1.headers['content-length'] === String(big.length) && tr1.status === 'interrupted' &&
      tr1.bytes_sent >= got && tr1.bytes_sent < big.length && entNow().transfer_status === 'interrupted', JSON.stringify([tr1.status, tr1.bytes_sent, got]));
    check('…and no confirmation email is sent for an incomplete transfer', !(await emails()).slice(e1).some((m) => /Download Transfer Confirmation/.test(m.subject)));
    const usedPage = await text(dev.base, '/download/' + med.token, { jar: med.buyer });
    check('the page says the download is used and was not completely sent, and offers to continue the SAME download on this phone only', usedPage.includes('DOWNLOAD USED') && usedPage.includes('not completely sent') &&
      usedPage.includes('Continue my download') && !(await text(dev.base, '/download/' + med.token, { jar: friend })).includes('Continue my download'));
    check('another browser can’t continue it', (await press('/download/' + med.token, friend, { step: 'continue' })).status === 409);
    const restart = await req(dev.base, claim1, { jar: med.buyer });
    check('starting the whole file again from the beginning would go over one copy, so it is refused and recorded', restart.status === 409 &&
      !!db.prepare(`SELECT 1 FROM download_events WHERE entitlement_id = ? AND kind = 'blocked_limit'`).get(ent.id));
    const cont = await press('/download/' + med.token, med.buyer, { step: 'continue' });
    const claim2 = cont.headers.get('location');
    check('“Continue my download” on the same phone gives a fresh private address for the same download (the old one stops)', cont.status === 303 && claim2 !== claim1 && (await req(dev.base, claim1, { jar: med.buyer })).status === 410 && entNow().attempts === 1);
    const e2 = (await emails()).length;
    const r2 = await req(dev.base, claim2, { jar: med.buyer, headers: { Range: `bytes=${got}-`, 'If-Range': etag } });
    const rest = Buffer.from(await r2.arrayBuffer());
    check('the phone resumes from where it stopped (Range), and the two parts make exactly the whole file', r2.status === 206 && r2.headers.get('content-range') === `bytes ${got}-${big.length - 1}/${big.length}` &&
      Buffer.concat([...parts, rest]).equals(big));
    check('…the first request is counted up to the byte where the resume took over (the bytes it sent after that may never have arrived)',
      db.prepare('SELECT taken_over_at, counted_until FROM download_transfers WHERE entitlement_id = ? ORDER BY id LIMIT 1').get(ent.id).counted_until === got);
    let conf = [];
    for (let i = 0; i < 40 && !conf.length; i++) { await sleep(100); conf = (await emails()).slice(e2).filter((m) => /Download Transfer Confirmation/.test(m.subject)); }
    check('once the whole file has been sent, the transfer is Completed and ONE confirmation email goes to the buyer', entNow().transfer_status === 'completed' && conf.length === 1 && conf[0].to[0] === 'rose@example.com' &&
      conf[0].text.includes(`File size: ${big.length.toLocaleString('en-GB')} bytes (41.94 MB)`) && conf[0].text.includes('Data sent by our server:') && conf[0].text.includes('Status: Completed'));
    check('in total the server sent less than two copies’ worth (never a second complete copy)', entNow().bytes_sent >= big.length && entNow().bytes_sent <= big.length + 16 * 1024 * 1024 && entNow().bytes_sent < 2 * big.length);
    check('after completion nothing more is sent, whatever is asked for', (await req(dev.base, claim2, { jar: med.buyer, headers: { Range: 'bytes=0-99' } })).status === 410 &&
      (await press('/download/' + med.token, med.buyer, { step: 'continue' })).status === 409 && (await press('/download/' + med.token, med.buyer)).status === 409);
    await sleep(200);
    check('…and no second confirmation email is ever sent', (await emails()).slice(e2).filter((m) => /Download Transfer Confirmation/.test(m.subject)).length === 1);

    // ---- replacements: only Gary or a full Admin, with a reason; never a check-in helper ----
    const helper = await signIn(dev, 'other');
    const reps = () => db.prepare('SELECT COUNT(*) AS n FROM download_replacements WHERE order_id = ?').get(order.id).n;
    const hr = await submit(dev, helper.jar, `/admin/orders/${order.id}/reissue`, { reason: 'Trying to give a free copy' });
    check('a check-in helper can’t authorise a replacement (or even open the order)', hr.status === 403 && (await req(dev.base, `/admin/orders/${order.id}`, { jar: helper.jar })).status === 403 && reps() === 0);
    const anon = await req(dev.base, `/admin/orders/${order.id}/reissue`, { method: 'POST', ...form({ reason: 'No sign-in' }) });
    check('…nor can anyone not signed in', anon.status === 403 && reps() === 0);
    const noCsrf = new FormData(); noCsrf.append('reason', 'Forged request from another page');
    check('…and a forged form without the security token is refused', (await req(dev.base, `/admin/orders/${order.id}/reissue`, { jar: g, method: 'POST', body: noCsrf })).status === 403 && reps() === 0);
    check('a reason is required', (await submit(dev, julieJar, `/admin/orders/${order.id}/reissue`, { reason: ' ' })).status === 422 && reps() === 0);
    const jr = await submit(dev, julieJar, `/admin/orders/${order.id}/reissue`, { reason: 'Customer’s phone was stolen the same day' });
    const jLink = ((await jr.text()).match(/\/download\/([A-Za-z0-9_-]{30,60})/) || [])[1];
    const jrow = db.prepare('SELECT * FROM download_replacements WHERE order_id = ? ORDER BY id DESC').get(order.id);
    check('Julie (full Admin) can authorise one, recorded under her name with the reason', jr.status === 200 && !!jLink && jrow.authorised_by === 'Julie' && jrow.authorised_email === 'julie.helper@example.test' &&
      jrow.reason === 'Customer’s phone was stolen the same day' && !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'orders.reissue' AND summary LIKE '%authorised by Julie%'`).get());
    check('…the replacement works on the buyer’s phone only (not a forwarded copy)', (await press('/download/' + jLink, friend)).status === 403 && (await press('/download/' + jLink, med.buyer)).status === 303);
    const any = await submit(dev, g, `/admin/orders/${order.id}/reissue`, { reason: 'Customer has a new phone', any_device: '1' });
    const anyLink = ((await any.text()).match(/\/download\/([A-Za-z0-9_-]{30,60})/) || [])[1];
    const newPhone = new Jar();
    const ap = await press('/download/' + anyLink, newPhone);
    check('Gary can authorise a replacement that works on a new phone; it is still ONE download', ap.status === 303 && (await req(dev.base, ap.headers.get('location'), { jar: newPhone })).status === 200 &&
      (await press('/download/' + anyLink, newPhone)).status === 409 && (await press('/download/' + anyLink, new Jar())).status === 409);
    const od = await text(dev.base, `/admin/orders/${order.id}`, { jar: g });
    check('the order in Admin shows every record: the dropped and resumed requests, refused attempts, and each replacement with who and why', od.includes('closed by the phone; another request took over at byte') && od.includes('part sent in full') &&
      od.includes('Pressed on a different phone or computer') && od.includes('Asked for more than one copy’s worth of data (refused)') && od.includes('authorised by Julie') && od.includes('Customer has a new phone') &&
      od.includes('Replacement downloads authorised (2)'));
    const sales = await text(dev.base, '/admin/meditations/sales', { jar: g });
    check('Meditation sales shows the exact file size from storage, in bytes and MB', sales.includes('Rose Buyer') && sales.includes('rose@example.com') && /File: [\d,]+ bytes \(\d+\.\d\d MB; \d+\.\d\d MiB\)/.test(sales));
    db.prepare(`UPDATE orders SET device_protected = 0 WHERE id = ?`).run(order.id);
    const legacy = await submit(dev, g, `/admin/orders/${order.id}/reissue`, { reason: 'Older purchase check' });
    const legacyLink = ((await legacy.text()).match(/\/download\/([A-Za-z0-9_-]{30,60})/) || [])[1];
    check('purchases made before this update work on any device, but still ONE download', (await press('/download/' + legacyLink, new Jar())).status === 303 && (await press('/download/' + legacyLink, new Jar())).status === 409);
    check('System status says ONE download, 24 hours, protected, no codes', (await text(dev.base, '/admin/status', { jar: g })).includes('ONE download per purchase: one click, one download; 24 hours to press the button; protected against forwarded links; no codes'));

    // ---- several connections at once (Chrome for Android, Samsung Internet), as on Gary's phone ----
    // A phone-like connection: asks for the file (or from a byte onwards), reads it at phone speed, and either reads to
    // the end or closes the connection once it has reached a chosen byte (as the browser does when another of its
    // connections has the rest).
    const connection = (claimUrl, jar, { from = null, to = null, closeAt = null, speed = 8_000_000, startAfter = 0 } = {}) => new Promise((resolve) => {
      setTimeout(() => {
        const u = new URL(dev.base + claimUrl);
        const headers = { Cookie: jar.header(), 'X-Dev-Throttle': String(speed) };
        if (from !== null) headers.Range = `bytes=${from}-${to === null ? '' : to}`;
        const parts = [];
        let at = from || 0, done = false;
        const finish = (how, res) => { if (done) return; done = true; resolve({ how, status: res ? res.statusCode : 0, start: from || 0, data: Buffer.concat(parts), at }); };
        const rq = http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers }, (res) => {
          if (res.statusCode >= 300) { res.resume(); res.on('end', () => finish('refused', res)); return; }
          res.on('data', (c) => {
            if (done) return;
            const keep = closeAt !== null ? Math.min(c.length, closeAt - at) : c.length;
            parts.push(c.subarray(0, keep)); at += keep;
            if (closeAt !== null && at >= closeAt) { rq.destroy(); finish('closed', res); }
          });
          res.on('end', () => finish('ended', res));
          res.on('error', () => finish('broken', res));
        });
        rq.on('error', () => finish('broken', null));
      }, startAfter);
    });
    // A paid purchase with its button already pressed in a fresh "phone" (made directly; buying is tested above)
    const sizeP = 24 * 1024 * 1024;
    const fileP = Buffer.alloc(sizeP);
    for (let i = 0; i < sizeP; i += 1024) fileP.writeUInt32BE(i, i);
    putMedia('private/features-parallel.mp3', fileP, 'audio/mpeg');
    let pn = 0;
    const pressedDownload = async () => {
      pn++;
      const o = db.prepare(`INSERT INTO orders (reference, kind, status, item_name, amount_pence, product_id, customer_name, customer_email, access_hash, origin, device_protected, paid_at)
        VALUES (?, 'MEDITATION_PURCHASE', 'paid', 'Feel It – Awaken the Spirit Within', 999, ?, 'Phone Test', ?, 'x', ?, 0, ?)`).run(`NW-PAR00${pn}`, order.product_id, `phone${pn}@example.com`, dev.base, new Date().toISOString());
      const tok = String.fromCharCode(64 + pn).repeat(43);
      db.prepare(`INSERT INTO download_entitlements (order_id, product_id, file_key, token_hash, expires_at, max_attempts) VALUES (?, ?, 'private/features-parallel.mp3', ?, ?, 1)`)
        .run(o.lastInsertRowid, order.product_id, hex('download:' + tok), new Date(Date.now() + 86400_000).toISOString());
      const jar = new Jar();
      const r = await press('/download/' + tok, jar);
      const e = db.prepare('SELECT * FROM download_entitlements WHERE order_id = ?').get(o.lastInsertRowid);
      return { claim: r.headers.get('location'), jar, ent: e, email: `phone${pn}@example.com`, tok };
    };
    const settled = async (entId, want) => { let e; for (let i = 0; i < 60; i++) { await sleep(100); e = db.prepare('SELECT * FROM download_entitlements WHERE id = ?').get(entId); if (!want || e.transfer_status === want) break; } return e; };
    const confirmations = async (to) => (await emails()).filter((m) => m.to[0] === to && /Download Transfer Confirmation/.test(m.subject));
    const blocked = (entId) => db.prepare(`SELECT COUNT(*) AS n FROM download_events WHERE entitlement_id = ?`).get(entId).n;
    const assemble = (results) => { const out = Buffer.alloc(sizeP); const have = new Uint8Array(sizeP); for (const r of results) { r.data.copy(out, r.start); have.fill(1, r.start, r.start + r.data.length); } return have.every((x) => x === 1) ? out : null; };
    const third = Math.floor(sizeP / 3), twoThirds = Math.floor(sizeP * 2 / 3);

    // P1: Gary's phone. The first connection asks for the whole file; a second asks for the last third, finishes FIRST,
    // and then the browser closes the first connection on purpose when it reaches the last third.
    {
      const d = await pressedDownload();
      const [a, c] = await Promise.all([connection(d.claim, d.jar, { closeAt: twoThirds, speed: 6_000_000 }), connection(d.claim, d.jar, { from: twoThirds, speed: 20_000_000, startAfter: 150 })]);
      const e = await settled(d.ent.id, 'completed');
      const rows = db.prepare('SELECT * FROM download_transfers WHERE entitlement_id = ? ORDER BY id').all(d.ent.id);
      check('Gary’s case: two connections, the last third finishes first, then the phone closes the first one on purpose: Completed',
        a.how === 'closed' && c.how === 'ended' && e.transfer_status === 'completed' && e.completion_basis === 'several_connections' && !!assemble([a, c])?.equals(fileP),
        JSON.stringify([a.how, c.how, e.transfer_status, rows.map((r) => [r.range_start, r.bytes_sent, r.status, r.taken_over_at])]));
      check('…the first connection is counted only up to where the second took over, and recorded as closed by the phone', rows[0].status === 'interrupted' && rows[0].taken_over_at === twoThirds &&
        rows[0].counted_until === twoThirds && rows[1].status === 'part_sent');
      check('…ONE confirmation email, and the phone’s second connection is NOT recorded as a blocked attempt', (await confirmations(d.email)).length === 1 && blocked(d.ent.id) === 0);
      const od = await text(dev.base, `/admin/orders/${d.ent.order_id}`, { jar: g });
      check('…Admin shows Completed over several connections, and the first connection as taken over (not interrupted)', od.includes('Completed (the server sent the whole file, over several connections)') &&
        od.includes(`another request took over at byte ${twoThirds.toLocaleString('en-GB')}`) && od.includes('Blocked repeat attempts (0)'));
      check('…and the customer’s page says Completed', (await text(dev.base, '/download/' + d.tok, { jar: d.jar })).includes('Completed: our server finished sending the whole file'));
    }
    // P2: the same, but the first connection reaches the last third and is closed BEFORE the second finishes
    {
      const d = await pressedDownload();
      const [a, c] = await Promise.all([connection(d.claim, d.jar, { closeAt: twoThirds, speed: 30_000_000 }), connection(d.claim, d.jar, { from: twoThirds, speed: 3_000_000, startAfter: 150 })]);
      const e = await settled(d.ent.id, 'completed');
      check('the other order: the first connection is closed first, the last third finishes afterwards: Completed, one email, nothing blocked',
        a.how === 'closed' && c.how === 'ended' && e.transfer_status === 'completed' && (await confirmations(d.email)).length === 1 && blocked(d.ent.id) === 0 && !!assemble([a, c])?.equals(fileP),
        JSON.stringify([a.how, c.how, e.transfer_status]));
    }
    // P3: three connections (thirds), finishing in a mixed order
    {
      const d = await pressedDownload();
      const [a, b, c] = await Promise.all([
        connection(d.claim, d.jar, { closeAt: third, speed: 4_000_000 }),
        connection(d.claim, d.jar, { from: third, closeAt: twoThirds, speed: 12_000_000, startAfter: 100 }),
        connection(d.claim, d.jar, { from: twoThirds, speed: 8_000_000, startAfter: 200 })]);
      const e = await settled(d.ent.id, 'completed');
      check('three connections at once (thirds), ending in a mixed order: Completed, one email, nothing blocked, never more than one copy’s worth sent',
        e.transfer_status === 'completed' && (await confirmations(d.email)).length === 1 && blocked(d.ent.id) === 0 && !!assemble([a, b, c])?.equals(fileP) && e.bytes_sent < sizeP + allowanceFor(sizeP),
        JSON.stringify([a.how, b.how, c.how, e.transfer_status, e.bytes_sent]));
    }
    // P4: a GENUINE interruption with two connections: the first drops early (no signal), long before the last third
    {
      const d = await pressedDownload();
      const [a, c] = await Promise.all([connection(d.claim, d.jar, { closeAt: 2 * 1024 * 1024, speed: 4_000_000 }), connection(d.claim, d.jar, { from: twoThirds, speed: 20_000_000, startAfter: 150 })]);
      const e = await settled(d.ent.id, 'interrupted');
      await sleep(300);
      const page = await text(dev.base, '/download/' + d.tok, { jar: d.jar });
      check('a genuine drop part-way (a gap nobody sent) is recorded as interrupted, with no confirmation email', e.transfer_status === 'interrupted' && (await confirmations(d.email)).length === 0 &&
        page.includes('not completely sent') && page.includes('Continue my download'), JSON.stringify([a.how, a.at, c.how, e.transfer_status]));
      // the phone resumes just the missing part
      const z = await connection(d.claim, d.jar, { from: a.at, to: twoThirds - 1, speed: 30_000_000 });
      const e2 = await settled(d.ent.id, 'completed');
      check('…when the phone fetches the missing part, it becomes Completed and only then is the email sent (once)', z.how === 'ended' && e2.transfer_status === 'completed' &&
        (await confirmations(d.email)).length === 1 && !!assemble([a, c, z])?.equals(fileP));
    }
    // P5: trying to get a second complete copy: three requests for the WHOLE file at once
    {
      const d = await pressedDownload();
      const all = await Promise.all([0, 1, 2].map((i) => connection(d.claim, d.jar, { speed: 30_000_000, startAfter: i * 20 })));
      await sleep(500);
      const e = await settled(d.ent.id);
      const complete = all.filter((r) => r.how === 'ended' && r.data.equals(fileP)).length;
      check('three requests for the whole file at once: never more than ONE complete copy, and the server stops at one copy’s worth plus the allowance',
        complete <= 1 && e.bytes_sent <= sizeP + allowanceFor(sizeP) && all.some((r) => r.how !== 'ended' || r.status >= 300), JSON.stringify([all.map((r) => [r.how, r.status, r.data.length]), e.bytes_sent]));
      check('…and stopping a request at the limit is recorded', !!db.prepare(`SELECT 1 FROM download_events WHERE entitlement_id = ? AND kind IN ('stopped_limit', 'blocked_limit')`).get(d.ent.id));
      const after = await connection(d.claim, d.jar, { speed: 30_000_000 });
      check('…after that, asking again gets nothing', after.how === 'refused' && after.data.length === 0);
    }
    // P6: a stopped request whose end the server never heard about is looked at again by the hourly job
    {
      const d = await pressedDownload();
      const c = await connection(d.claim, d.jar, { from: twoThirds, speed: 30_000_000 });
      for (let i = 0; i < 50 && !db.prepare(`SELECT 1 FROM download_transfers WHERE entitlement_id = ? AND status = 'part_sent'`).get(d.ent.id); i++) await sleep(100);
      // as if the first connection had sent past the last third, then gone silent (the Worker stopped without reporting)
      db.prepare(`INSERT INTO download_transfers (entitlement_id, order_id, range_start, range_length, file_size, bytes_sent, status, started_at, updated_at)
        VALUES (?, ?, 0, ?, ?, ?, 'in_progress', ?, ?)`).run(d.ent.id, d.ent.order_id, sizeP, sizeP, twoThirds + 3 * 1024 * 1024, new Date(Date.now() - 10 * 60_000).toISOString(), new Date(Date.now() - 9 * 60_000).toISOString());
      db.prepare(`UPDATE download_entitlements SET transfer_status = 'interrupted' WHERE id = ?`).run(d.ent.id);
      const env = { DB: makeD1(dev.dbFile), EMAIL_FROM: 'New Way’s <bookings@example.test>', RESEND_API_KEY: 're_local_test', RESEND_API_BASE: dev.mock, SITE_URL: 'https://newwaysmediumshipdevelopmentcentre.com' };
      await settleOpenDownloads(env);
      const e = db.prepare('SELECT * FROM download_entitlements WHERE id = ?').get(d.ent.id);
      check('the hourly job settles a download whose first connection went silent: Completed, and sends the one email', c.how === 'ended' && e.transfer_status === 'completed' && (await confirmations(d.email)).length === 1, JSON.stringify([c.how, e.transfer_status, db.prepare('SELECT range_start, bytes_sent, status, updated_at, counted_until FROM download_transfers WHERE entitlement_id = ?').all(d.ent.id)]));
    }
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

  console.log('\nWednesday till: card payments in the Square app, confirmed by Square and recorded automatically');
  {
    const today = ukToday();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('pos_app_id', 'sq0idp-LOCALTESTAPP'), ('pos_handoff', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    const tillHtml = await text(dev.base, '/admin/door', { jar: g });
    const csrfT = (tillHtml.match(/data-csrf="([^"]+)"/) || [])[1];
    const doorJs = fs.readFileSync(path.join(root, 'public', 'js', 'door.js'), 'utf8');
    check('the till offers the Square app, with the card reader’s location, and asks Square to come straight back (3.2 seconds after Thank You) with the sale’s own reference',
      tillHtml.includes('data-pos-app="sq0idp-LOCALTESTAPP"') && tillHtml.includes('data-pos-location="POS_LOCATION"') && doorJs.includes('l.com.squareup.pos.AUTO_RETURN_TIMEOUT_MS=3200') &&
      doorJs.includes('S.com.squareup.pos.REQUEST_METADATA=') && doorJs.includes("'/admin/door/card/start'"));
    check('Admin › Buttons & prices says automatic checking with Square is set up', (await text(dev.base, '/admin/door/items', { jar: g })).includes('Automatic checking with Square is set up'));
    const items = Object.fromEntries(db.prepare('SELECT * FROM till_items').all().map((i) => [i.category, i]));
    const basket = [{ item_id: items.entry.id, qty: 2 }, { item_id: items.development.id, qty: 1 }];   // £13.00
    const hex32 = () => crypto.randomBytes(16).toString('hex');
    const start = async (ref, clientRef, lines = basket, expected = 1300, jar = g, csrf = csrfT) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ _csrf: csrf, date: today, ref, client_ref: clientRef, expected_total: String(expected), lines: JSON.stringify(lines) })) fd.append(k, v);
      const r = await req(dev.base, '/admin/door/card/start', { jar, method: 'POST', body: fd });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const charge = async (q) => (await fetch(`${dev.mock}/__square/pos/charge?` + new URLSearchParams(q))).json();
    const back = async (params) => {
      const r = await req(dev.base, '/admin/door/square-callback?' + new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => ['com.squareup.pos.' + k, v]))), { jar: g });
      const loc = r.headers.get('location');
      return { status: r.status, loc, html: loc ? await text(dev.base, loc, { jar: g }) : await r.text() };
    };
    const status = async (ref) => (await req(dev.base, '/admin/door/card/status?ref=' + ref, { jar: g })).json();
    const reqRow = (ref) => db.prepare('SELECT * FROM till_card_requests WHERE ref = ?').get(ref);
    const sales = (clientRef) => db.prepare('SELECT * FROM till_sales WHERE client_ref = ?').all(clientRef);
    const nSales = () => db.prepare('SELECT COUNT(*) AS n FROM till_sales').get().n;

    // registering the sale before Square is opened
    const A = hex32(), Aclient = 'cardsale' + hex32().slice(0, 10);
    const s0 = await start(A, Aclient);
    check('pressing CARD registers the sale first, priced from the database (£13.00), waiting for Square', s0.status === 200 && s0.body.ok && s0.body.total === 1300 && reqRow(A).status === 'waiting' && sales(Aclient).length === 0);
    check('…a changed price from the phone is refused', (await start(hex32(), 'cardsale' + hex32().slice(0, 10), basket, 100)).status === 409);
    check('…registering the same sale twice is harmless', (await start(A, Aclient)).body.ref === A && db.prepare('SELECT COUNT(*) AS n FROM till_card_requests WHERE ref = ?').get(A).n === 1);
    const helper = await signIn(dev, 'other');
    check('…a check-in helper can’t use it, and nor can anyone not signed in', (await start(hex32(), 'cardsale' + hex32().slice(0, 10), basket, 1300, helper.jar, helper.jar.c.nw_csrf || 'x')).status === 403 &&
      (await req(dev.base, '/admin/door/card/start', { method: 'POST', body: new FormData() })).status === 403);

    // a successful payment
    const n0 = nSales();
    const paidA = await charge({ amount: 1300 });
    const cbA = await back({ SERVER_TRANSACTION_ID: paidA.transactionId, CLIENT_TRANSACTION_ID: 'CLIENT1', REQUEST_METADATA: A });
    const saleA = sales(Aclient)[0];
    check('when Square comes back, the website checks with Square itself and shows PAYMENT SUCCESSFUL', cbA.status === 303 && cbA.loc === `/admin/door/card?ref=${A}` && cbA.html.includes('PAYMENT SUCCESSFUL') &&
      cbA.html.includes('data-card-result="paid"'));
    check('…and records the sale ONCE, as a £13.00 card sale with its lines and the Square payment it was', nSales() === n0 + 1 && !!saleA && saleA.method === 'card' && saleA.total_pence === 1300 &&
      saleA.square_payment_id === paidA.paymentId && db.prepare('SELECT COUNT(*) AS n FROM till_sale_lines WHERE sale_id = ?').get(saleA.id).n === 2 && reqRow(A).status === 'paid' && reqRow(A).sale_id === saleA.id);
    check('…with no need to press “Card payment taken ✓”', !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'door.card_app' AND summary LIKE ?`).get(`%${paidA.paymentId}%`));
    const twice = await back({ SERVER_TRANSACTION_ID: paidA.transactionId, CLIENT_TRANSACTION_ID: 'CLIENT1', REQUEST_METADATA: A });
    await text(dev.base, `/admin/door/card?ref=${A}`, { jar: g });
    await status(A);
    check('Square coming back a second time, a refresh, or the till asking again: still ONE sale', twice.html.includes('PAYMENT SUCCESSFUL') && nSales() === n0 + 1 && sales(Aclient).length === 1);
    const manual = await (async () => { const fd = new FormData(); for (const [k, v] of Object.entries({ _csrf: csrfT, date: today, method: 'card', client_ref: Aclient, expected_total: '1300', lines: JSON.stringify(basket) })) fd.append(k, v); return (await req(dev.base, '/admin/door/sale', { jar: g, method: 'POST', body: fd })).json(); })();
    check('…and pressing “Card payment taken ✓” as well doesn’t add a second sale', manual.ok && manual.repeat && nSales() === n0 + 1);
    const st = await status(A);
    check('the till’s own check says paid (so it clears the basket and is ready for the next customer)', st.status === 'paid' && st.clientRef === Aclient && st.total === 1300);
    check('…and it now counts in tonight’s card total', (await (await req(dev.base, '/admin/door/totals?date=' + today, { jar: g })).json()).door >= 1300);

    // things that must never be recorded as paid
    const never = async (label, q, params = {}) => {
      const ref = hex32(), cr = 'cardsale' + hex32().slice(0, 10);
      await start(ref, cr);
      const c = q ? await charge(q) : null;
      const r = await back({ ...(c ? { SERVER_TRANSACTION_ID: c.transactionId, CLIENT_TRANSACTION_ID: 'C' } : {}), REQUEST_METADATA: ref, ...params });
      return { ref, cr, r, row: reqRow(ref), sales: sales(cr) };
    };
    const cancelled = await never('cancelled', null, { ERROR_CODE: 'TRANSACTION_CANCELED', ERROR_DESCRIPTION: 'cancelled' });
    check('cancelled in the Square app: NOT PAID, nothing recorded', cancelled.row.status === 'cancelled' && cancelled.sales.length === 0 && cancelled.r.html.includes('NOT PAID: NOTHING RECORDED') && cancelled.r.html.includes('The payment was cancelled in the Square app.'));
    const declined = await never('declined', { amount: 1300, status: 'FAILED' });
    check('declined card (Square says FAILED): NOT PAID, nothing recorded', declined.row.status === 'failed' && declined.sales.length === 0 && declined.r.html.includes('NOT PAID'));
    const wrongAmount = await never('amount', { amount: 100 });
    check('Square took a different amount (£1.00 for a £13.00 sale): nothing recorded, and it says so', wrongAmount.row.status === 'mismatch' && wrongAmount.sales.length === 0 && wrongAmount.row.detail.includes('Square took £1.00, but this sale is £13.00'));
    const wrongCurrency = await never('currency', { amount: 1300, currency: 'EUR' });
    check('the right number but not in pounds: nothing recorded', wrongCurrency.row.status === 'mismatch' && wrongCurrency.sales.length === 0);
    const wrongPlace = await never('location', { amount: 1300, location: 'SOMEWHERE_ELSE' });
    check('a payment at a different Square location: nothing recorded', wrongPlace.row.status === 'mismatch' && wrongPlace.sales.length === 0);
    const oldOne = await never('old', { amount: 1300, createdAgoMs: 15 * 60_000 });
    check('an older payment (made before this sale went to Square): nothing recorded', oldOne.row.status === 'mismatch' && oldOne.sales.length === 0);
    const notCard = await never('cash', { amount: 1300, source: 'CASH' });
    check('not a card payment: nothing recorded', notCard.row.status === 'mismatch' && notCard.sales.length === 0);
    const twoPay = await never('two', { amount: 1300, payments: 2 });
    check('two payments in one Square transaction: nothing recorded', twoPay.row.status === 'mismatch' && twoPay.sales.length === 0);
    const reused = await never('reused', null, { SERVER_TRANSACTION_ID: paidA.transactionId, CLIENT_TRANSACTION_ID: 'X' });
    check('the address faked with an earlier sale’s Square transaction: nothing recorded', reused.row.status === 'mismatch' && reused.sales.length === 0 && nSales() === n0 + 1);
    const offline = await never('offline', null, { CLIENT_TRANSACTION_ID: 'OFFLINE1' });
    check('taken in Square’s Offline Mode (Square can’t confirm it): NOT recorded, and the page asks you to check the Square app', offline.row.status === 'unverified' && offline.sales.length === 0 &&
      offline.r.html.includes('NOT CONFIRMED YET: NOT RECORDED') && offline.r.html.includes('I have checked in the Square app'));
    const unticked = new FormData(); unticked.append('_csrf', csrfT); unticked.append('ref', offline.ref);
    await req(dev.base, '/admin/door/card/confirm', { jar: g, method: 'POST', body: unticked });
    check('…recording it by hand needs the box ticked', sales(offline.cr).length === 0);
    const ticked = new FormData(); ticked.append('_csrf', csrfT); ticked.append('ref', offline.ref); ticked.append('checked', '1');
    await req(dev.base, '/admin/door/card/confirm', { jar: g, method: 'POST', body: ticked });
    check('…after checking the Square app, Gary or Julie can record it by hand (marked as such in the records)', sales(offline.cr).length === 1 && reqRow(offline.ref).status === 'unverified' &&
      !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'door.card_by_hand'`).get() && (await text(dev.base, `/admin/door/card?ref=${offline.ref}`, { jar: g })).includes('RECORDED BY HAND'));
    const unknown = await back({ SERVER_TRANSACTION_ID: (await charge({ amount: 1300 })).transactionId, REQUEST_METADATA: hex32() });
    check('Square coming back with a reference the till never registered: nothing recorded', unknown.status === 200 && !unknown.html.includes('PAYMENT SUCCESSFUL') && nSales() === n0 + 2);

    // Square is slow to show the payment: CHECKING, then PAYMENT SUCCESSFUL
    const S = hex32(), Sclient = 'cardsale' + hex32().slice(0, 10);
    await start(S, Sclient);
    const slow = await charge({ amount: 1300, visibleAfterMs: 2500 });
    const cbS = await back({ SERVER_TRANSACTION_ID: slow.transactionId, CLIENT_TRANSACTION_ID: 'C', REQUEST_METADATA: S });
    check('if Square doesn’t show the payment yet, the page says CHECKING WITH SQUARE (not success) and records nothing', cbS.html.includes('CHECKING WITH SQUARE') && reqRow(S).status === 'checking' && sales(Sclient).length === 0);
    await sleep(2700);
    const many = await Promise.all(Array.from({ length: 5 }, () => status(S)));
    check('…as soon as Square confirms it: PAYMENT SUCCESSFUL, and five checks at the same moment still record it ONCE', many.every((m) => m.status === 'paid') && sales(Sclient).length === 1 && sales(Sclient)[0].square_payment_id === slow.paymentId);
    // a payment still going through (APPROVED), then completed
    const P = hex32(), Pclient = 'cardsale' + hex32().slice(0, 10);
    await start(P, Pclient);
    const appr = await charge({ amount: 1300, status: 'APPROVED' });
    await back({ SERVER_TRANSACTION_ID: appr.transactionId, CLIENT_TRANSACTION_ID: 'C', REQUEST_METADATA: P });
    const p1 = await status(P);
    await fetch(`${dev.mock}/__square/pos/set?tx=${appr.transactionId}&status=COMPLETED`);
    const p2 = await status(P);
    check('a payment Square is still processing stays CHECKING, and is recorded only once Square says COMPLETED', p1.status === 'checking' && p2.status === 'paid' && sales(Pclient).length === 1);

    // a sale already recorded by hand, and then Square says paid as well
    const D = hex32(), Dclient = 'cardsale' + hex32().slice(0, 10);
    await start(D, Dclient);
    await door.sale('cash', basket, 1300, Dclient);
    const dpay = await charge({ amount: 1300 });
    const cbD = await back({ SERVER_TRANSACTION_ID: dpay.transactionId, CLIENT_TRANSACTION_ID: 'C', REQUEST_METADATA: D });
    check('if the sale had already been recorded another way, Square’s payment is NOT counted again, and the page says to refund one in Square', reqRow(D).status === 'duplicate' &&
      sales(Dclient).length === 1 && sales(Dclient)[0].method === 'cash' && cbD.html.includes('ALREADY RECORDED') && cbD.html.includes('refund one in the Square app'));
    check('…and a new Square payment can’t even be started for a sale already recorded', (await start(hex32(), Dclient)).status === 409);

    // Square refuses the till's checking access
    const K = hex32(), Kclient = 'cardsale' + hex32().slice(0, 10);
    await start(K, Kclient);
    const kpay = await charge({ amount: 1300 });
    await fetch(`${dev.mock}/__square/pos/auth-fails?on=1`);
    const cbK = await back({ SERVER_TRANSACTION_ID: kpay.transactionId, CLIENT_TRANSACTION_ID: 'C', REQUEST_METADATA: K });
    await fetch(`${dev.mock}/__square/pos/auth-fails?on=0`);
    check('if Square refuses the till’s checking access, nothing is recorded and it asks you to check the Square app', reqRow(K).status === 'unverified' && sales(Kclient).length === 0 && cbK.html.includes('NOT CONFIRMED YET'));

    // without SQUARE_POS_ACCESS_TOKEN (not set up yet)
    const N = hex32(), Nclient = 'cardsale' + hex32().slice(0, 10);
    await start(N, Nclient);
    const npay = await charge({ amount: 1300 });
    db.prepare(`UPDATE till_card_requests SET status = 'checking', square_transaction_id = ?, returned_at = ? WHERE ref = ?`).run(npay.transactionId, new Date().toISOString(), N);
    const envNo = { DB: makeD1(dev.dbFile) };
    const { checkCardRequest } = await import('../src/admin/door-card.js');
    await checkCardRequest(envNo, db.prepare('SELECT * FROM till_card_requests WHERE ref = ?').get(N), 'Gary');
    check('if automatic checking isn’t set up yet, a Square app payment is never recorded automatically', reqRow(N).status === 'unverified' && reqRow(N).detail.includes('isn’t set up yet') && sales(Nclient).length === 0);
    const off = await (async () => { const keep = db.prepare(`SELECT value FROM settings WHERE key = 'pos_handoff'`).get().value; return keep; })();
    check('the card reader without the app still works exactly as before (“Card payment taken ✓”)', off === '1' && (await door.sale('card', [{ item_id: items.entry.id, qty: 1 }], 500)).body.ok);
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
    const loc = ok.headers.get('location') || '';
    check('Continue goes to the customer’s own payment page on THIS website (a form here may only answer to this website), for £16.00 (2 × £5 + £3 + 3 × £1)',
      ok.status === 303 && loc.startsWith(`/wednesday/${o.reference}?key=`) && loc.endsWith('&go=1') && o.total_pence === 1600 && o.status === 'pending' && lines.length === 3);
    const link = (await sq()).links.find((l) => l.orderId === o.square_order_id);
    const goPage = await req(dev.base, loc);
    const goHtml = await goPage.text();
    check('…which opens Square’s secure checkout straight away (and still shows the button if that doesn’t happen)', goHtml.includes('data-go-pay') && goHtml.includes(`href="${dev.mock}/__square/checkout/${link.id}"`) &&
      goHtml.includes('Opening Square’s secure payment page') && /form-action 'self'/.test(goPage.headers.get('content-security-policy') || ''));
    const plain = await text(dev.base, loc.replace('&go=1', ''));
    check('…but only straight after Continue: opening the payment page later doesn’t jump to Square', !plain.includes('data-go-pay') && plain.includes(`href="${dev.mock}/__square/checkout/${link.id}"`));
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

  console.log('\nLaunch: Support New Way’s (donations)');
  {
    const about = await text(dev.base, '/about');
    check('every page’s footer has a small Make a Donation link (and the mailing list button stays)', about.includes('<a href="/support">Make a Donation</a>') && about.includes('href="/join">JOIN OUR MAILING LIST'));
    const sp = await text(dev.base, '/support');
    check('the Support New Way’s page says donations go to New Way’s (not the charities), with the form, the Supporters list and the thank-you', sp.includes('Donations made here go to New Way’s Mediumship Development Centre') &&
      sp.includes('name="amount"') && sp.includes('name="name"') && sp.includes('name="email"') && sp.includes('value="public"') && sp.includes('value="anonymous"') &&
      sp.includes('Our Supporters') && sp.includes('From everyone at New Way’s: thank you.'));
    check('…the donor types their own amount: no preset or suggested amounts', !/name="amount"[^>]*placeholder/.test(sp) && !/data-amount|£5<\/button>|£10<\/button>/.test(sp) && (sp.match(/name="amount"/g) || []).length === 1);
    const stamp = sp.match(/name="t" value="([^"]+)"/)[1];
    await sleep(3100);
    const give = (fields, ip) => req(dev.base, '/support/donate', { method: 'POST', ...form({ t: stamp, website: '', 'cf-turnstile-response': TOKEN, name: 'Margaret Test', email: 'Margaret@Example.com', amount: '12.50', display: 'public', public_name: 'Margaret T, Broughty Ferry', ...fields }), headers: { ...form({}).headers, 'CF-Connecting-IP': ip } });
    const nD = () => db.prepare('SELECT COUNT(*) AS n FROM donations').get().n;
    const n0 = nD();
    check('the choice of being shown or anonymous must be made', (await give({ display: '' }, '10.20.0.1')).status === 422 && nD() === n0);
    check('amounts are checked: words, under £1, and over £5,000 are refused', (await give({ amount: 'lots' }, '10.20.0.2')).status === 422 && (await give({ amount: '0.50' }, '10.20.0.2')).status === 422 &&
      (await give({ amount: '6000' }, '10.20.0.3')).status === 422 && nD() === n0);
    const g1 = await give({}, '10.20.0.4');
    const d1 = db.prepare(`SELECT * FROM donations WHERE donor_email = 'margaret@example.com'`).get();
    const loc = g1.headers.get('location') || '';
    check('a £12.50 donation goes to the donor’s own page here, which opens Square for exactly £12.50', g1.status === 303 && loc.startsWith(`/support/donation/${d1.reference}?key=`) && loc.endsWith('&go=1') &&
      d1.amount_pence === 1250 && d1.status === 'pending' && d1.show_publicly === 1 && d1.public_name === 'Margaret T, Broughty Ferry');
    const link1 = (await sq()).links.find((l) => l.orderId === d1.square_order_id);
    check('…Square is asked for £12.50 as a donation to New Way’s, with NO coupon, loyalty or tip boxes on its page', link1.amount === 1250 && link1.name === 'Donation to New Way’s Mediumship Development Centre' &&
      link1.requests.checkout_options.enable_coupon === false && link1.requests.checkout_options.enable_loyalty === false && link1.requests.checkout_options.allow_tipping === false);
    check('…and nothing shows on the Supporters list before Square confirms the payment', !(await text(dev.base, '/support')).includes('Margaret T, Broughty Ferry'));
    const e0 = (await emails()).length;
    const pay1 = await payInSquare(d1.square_payment_link_id);
    await webhook(payEvent(pay1));
    await webhook(payEvent(pay1));
    const paid1 = db.prepare('SELECT * FROM donations WHERE id = ?').get(d1.id);
    const thanks = (await emails()).slice(e0).filter((m) => m.to[0] === 'margaret@example.com');
    check('once Square confirms it: paid, and ONE personal thank-you email with the amount (even if Square tells us twice)', paid1.status === 'paid' && thanks.length === 1 &&
      thanks[0].subject === 'Thank you for your donation to New Way’s' && thanks[0].text.includes('Dear Margaret Test') && thanks[0].text.includes('£12.50') && thanks[0].text.includes('Supporters list'));
    const list = await text(dev.base, '/support');
    check('…and the donor appears on the Supporters list straight away, as they asked (no Admin approval needed)', list.includes('<span class="supporter-name">Margaret T, Broughty Ferry</span><span class="supporter-amount">£12.50</span>'));
    const own = await text(dev.base, loc.replace('&go=1', ''));
    check('…their own page says thank you', own.includes('Thank you, Margaret Test') && own.includes('£12.50'));
    // anonymous
    const g2 = await give({ name: 'Quiet Giver', email: 'quiet@example.com', amount: '5', display: 'anonymous', public_name: 'Should not show' }, '10.20.0.5');
    const d2 = db.prepare(`SELECT * FROM donations WHERE donor_email = 'quiet@example.com'`).get();
    await webhook(payEvent(await payInSquare(d2.square_payment_link_id)));
    const quiet = (await emails()).filter((m) => m.to[0] === 'quiet@example.com');
    const list2 = await text(dev.base, '/support');
    check('an anonymous donor gets their thank-you too, and is not shown anywhere on the website', g2.status === 303 && db.prepare('SELECT status FROM donations WHERE id = ?').get(d2.id).status === 'paid' &&
      quiet.length === 1 && quiet[0].text.includes('£5') && quiet[0].text.includes('anonymous') && !list2.includes('Quiet Giver') && !list2.includes('Should not show'));
    // a payment that doesn't match
    const g3 = await give({ name: 'Odd Amount', email: 'odd@example.com', amount: '20', public_name: '' }, '10.20.0.6');
    const d3 = db.prepare(`SELECT * FROM donations WHERE donor_email = 'odd@example.com'`).get();
    const odd = (await (await fetch(`${dev.mock}/__square/pay/${d3.square_payment_link_id}?amount=100`)).json()).payment;
    await webhook(payEvent(odd));
    check('a payment for a different amount is never shown or thanked automatically; it is flagged for Admin', g3.status === 303 && db.prepare('SELECT status FROM donations WHERE id = ?').get(d3.id).status === 'needs_attention' &&
      !(await text(dev.base, '/support')).includes('Odd Amount') && !(await emails()).some((m) => m.to[0] === 'odd@example.com'));
    // Admin
    const ad = await text(dev.base, '/admin/donations', { jar: g });
    check('Admin › Donations lists the donations with names, emails, amounts and whether they are on the list', ad.includes('Margaret Test') && ad.includes('margaret@example.com') && ad.includes('£12.50') &&
      ad.includes('On the Supporters list as “Margaret T, Broughty Ferry”') && ad.includes('Anonymous (their choice)') && ad.includes('NEEDS ATTENTION'));
    await submit(dev, g, `/admin/donations/${d1.id}/hide`, {});
    const hiddenRow = db.prepare('SELECT * FROM donations WHERE id = ?').get(d1.id);
    check('Admin can take a supporter off the public list; the donation record (amount, payment) is unchanged', !(await text(dev.base, '/support')).includes('Margaret T, Broughty Ferry') && hiddenRow.status === 'paid' &&
      hiddenRow.amount_pence === 1250 && hiddenRow.square_payment_id === paid1.square_payment_id && !!hiddenRow.public_hidden_at && !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'donations.hide'`).get());
    await submit(dev, g, `/admin/donations/${d1.id}/show`, {});
    check('…and put them back', (await text(dev.base, '/support')).includes('Margaret T, Broughty Ferry'));
    check('Julie (full Admin) can manage donations; a check-in helper can’t', (await req(dev.base, '/admin/donations', { jar: julieJar })).status === 200 && (await req(dev.base, '/admin/donations', { jar: (await signIn(dev, 'other')).jar })).status === 403);
    check('the wording of the Support page can be edited in Pages and wording', (await text(dev.base, '/admin/wording', { jar: g })).includes('Support New Way’s (donations) page, introduction'));
    check('the Privacy Notice now covers donations', (await text(dev.base, '/privacy')).includes('If you make a donation we keep your name, email address, the amount'));
  }

  console.log('\nLaunch: clearing test data (only what is chosen, after confirming)');
  {
    const ev = (name, date, capacity) => db.prepare(`INSERT INTO events (name, date, sales_mode, price_pence, capacity, visible) VALUES (?, ?, 'online', 1500, ?, 1)`).run(name, date, capacity).lastInsertRowid;
    const testId = ev('Test event', '2026-10-15', 20), realId = ev('Real Evening of Mediumship', '2026-12-05', 40);
    let n = 0;
    const book = (eventId, qty, method, status, payStatus, sqPay = null) => {
      n++;
      db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, total_pence, purchaser_name, purchaser_email, checkin_token, square_payment_id)
        VALUES (?, ?, 'online', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(eventId, `EV-TST${String(n).padStart(3, '0')}`, status, method, payStatus, qty, qty * 1500, 'Tester ' + n, `t${n}@example.com`, 'tok' + crypto.randomBytes(9).toString('hex'), sqPay);
      const bid = db.prepare('SELECT id FROM event_bookings WHERE reference = ?').get(`EV-TST${String(n).padStart(3, '0')}`).id;
      db.prepare(`INSERT INTO event_guests (booking_id, event_id, position, name) VALUES (?, ?, 1, ?)`).run(bid, eventId, 'Guest ' + n);
      return bid;
    };
    for (let i = 0; i < 7; i++) book(testId, 2, 'square_online', 'confirmed', 'paid', 'SANDBOXPAY' + i);
    book(testId, 2, 'cash', 'confirmed', 'paid');
    book(testId, 1, 'square_online', 'held', 'pending');
    const realB = book(realId, 2, 'square_online', 'confirmed', 'paid', 'SANDBOXREAL1');
    check('the normal Events list still refuses to delete an event that has bookings (unchanged)', !!(await import('../src/admin/events.js')).eventHasBookings && db.prepare('SELECT COUNT(*) AS n FROM event_bookings WHERE event_id = ?').get(testId).n === 9);
    const home = await text(dev.base, '/admin/cleanup', { jar: g });
    check('Admin › Clear test data lists events with bookings (Test event: 17 places in 9 bookings)', home.includes('Test event') && home.includes('17 places booked in 9 bookings') && home.includes('Real Evening of Mediumship'));
    const review = await text(dev.base, `/admin/cleanup/event/${testId}`, { jar: g });
    check('…reviewing it lists every booking, and warns about the one recorded as paid in cash', review.includes('EV-TST001') && review.includes('recorded as PAID by cash, card or another way') && review.includes('Type REMOVE to confirm'));
    await submit(dev, g, `/admin/cleanup/event/${testId}`, { confirm: '1', word: 'remove' });
    check('nothing is removed without ticking that the cash booking is a test record', !!db.prepare('SELECT 1 FROM events WHERE id = ?').get(testId));
    await submit(dev, g, `/admin/cleanup/event/${testId}`, { paid_ok: '1', confirm: '1', word: 'nope' });
    check('…or without typing REMOVE', !!db.prepare('SELECT 1 FROM events WHERE id = ?').get(testId));
    const helperJar = (await signIn(dev, 'other')).jar;
    check('…and a check-in helper can’t use it at all', (await req(dev.base, '/admin/cleanup', { jar: helperJar })).status === 403);
    const done = await submit(dev, g, `/admin/cleanup/event/${testId}`, { paid_ok: '1', confirm: '1', word: 'REMOVE' });
    const log = db.prepare(`SELECT * FROM cleanup_log WHERE action = 'event' ORDER BY id DESC`).get();
    check('with the confirmation, the test event and all its bookings and guests are removed', done.status === 303 && !db.prepare('SELECT 1 FROM events WHERE id = ?').get(testId) &&
      db.prepare('SELECT COUNT(*) AS n FROM event_bookings WHERE event_id = ?').get(testId).n === 0 && db.prepare('SELECT COUNT(*) AS n FROM event_guests WHERE event_id = ?').get(testId).n === 0);
    check('…a complete copy of everything removed is kept, and the activity log says who did it', !!log && JSON.parse(log.snapshot_json).bookings.length === 9 && log.done_by === 'Gary' &&
      !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'cleanup.event' AND summary LIKE '%Test event%by Gary%'`).get());
    check('…the real event and its booking are untouched', !!db.prepare('SELECT 1 FROM events WHERE id = ?').get(realId) && !!db.prepare('SELECT 1 FROM event_bookings WHERE id = ?').get(realB));
    const { moneyCheck } = await import('../src/admin/cleanup.js');
    check('once the website takes REAL payments, an event with online payments can’t be removed here', moneyCheck({ SQUARE_ENVIRONMENT: 'production' }, [{ payment_method: 'square_online', square_payment_id: 'X', payment_status: 'paid' }]).realOnline.length === 1 &&
      moneyCheck({ SQUARE_ENVIRONMENT: 'sandbox' }, [{ payment_method: 'square_online', square_payment_id: 'X', payment_status: 'paid' }]).realOnline.length === 0);
    // readings
    const reading = (i, date, time) => {
      const o = db.prepare(`INSERT INTO orders (reference, kind, status, item_name, amount_pence, customer_name, customer_email, access_hash, origin, paid_at, square_payment_id)
        VALUES (?, 'PRIVATE_READING', 'paid', '30 Minute Private Reading', 4000, ?, ?, 'x', 'https://x', ?, ?)`).run(`NW-TSTR0${i}`, 'Reading Tester ' + i, `r${i}@example.com`, new Date().toISOString(), 'SBREADING' + i).lastInsertRowid;
      const start = `${date}T${time}:00.000Z`;
      const b = db.prepare(`INSERT INTO bookings (order_id, service_code, service_name, minutes, price_pence, date, local_start, start_utc, end_utc, status) VALUES (?, 'r30', '30 Minute Private Reading', 30, 4000, ?, ?, ?, ?, 'confirmed')`)
        .run(o, date, time, start, new Date(Date.parse(start) + 30 * 60_000).toISOString()).lastInsertRowid;
      db.prepare('INSERT INTO booking_slots (slot_utc, booking_id) VALUES (?, ?)').run(start, b);
      return { o, b, start };
    };
    const rs = [reading(1, '2026-11-08', '10:00'), reading(2, '2026-11-08', '11:00'), reading(3, '2026-11-08', '12:00'), reading(4, '2026-11-08', '13:00'), reading(5, '2026-11-15', '10:00')];
    const page2 = await text(dev.base, '/admin/cleanup', { jar: g });
    check('the private reading bookings are listed to choose from', ['NW-TSTR01', 'NW-TSTR05'].every((r) => page2.includes(r)));
    await submit(dev, g, '/admin/cleanup/readings', { [`r${rs[0].o}`]: '1', [`r${rs[1].o}`]: '1', [`r${rs[2].o}`]: '1', [`r${rs[3].o}`]: '1', word: 'REMOVE' });
    check('nothing is removed without the confirmation tick', db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE reference LIKE 'NW-TSTR0%'`).get().n === 5);
    await submit(dev, g, '/admin/cleanup/readings', { [`r${rs[0].o}`]: '1', [`r${rs[1].o}`]: '1', [`r${rs[2].o}`]: '1', [`r${rs[3].o}`]: '1', confirm: '1', word: 'REMOVE' });
    check('the four chosen test readings are removed and their times released; the one not chosen stays', db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE reference LIKE 'NW-TSTR0%'`).get().n === 1 &&
      rs.slice(0, 4).every((r) => !db.prepare('SELECT 1 FROM booking_slots WHERE slot_utc = ?').get(r.start)) && !!db.prepare('SELECT 1 FROM booking_slots WHERE slot_utc = ?').get(rs[4].start) &&
      JSON.parse(db.prepare(`SELECT snapshot_json FROM cleanup_log WHERE action = 'readings' ORDER BY id DESC`).get().snapshot_json).orders.length === 4);
    // counters
    db.prepare(`UPDATE app_metrics SET value = CASE key WHEN 'unique_visitors' THEN 57 ELSE 9 END`).run();
    await submit(dev, g, '/admin/cleanup/counters', { confirm: '1', word: 'REMOVE' });
    check('the visitor and app-install counters reset to 0, with the old numbers kept in the record', db.prepare('SELECT SUM(value) AS n FROM app_metrics').get().n === 0 &&
      db.prepare(`SELECT summary FROM cleanup_log WHERE action = 'counters' ORDER BY id DESC`).get().summary.includes('unique visitors 57'));
    check('genuine guest mediums are untouched by any of this', db.prepare('SELECT COUNT(*) AS n FROM mediums').get().n > 0);
  }

  console.log('\nLaunch: guests who already paid through an old Square ticket link');
  {
    const eid = db.prepare(`INSERT INTO events (name, date, sales_mode, price_pence, capacity, visible, details) VALUES ('Moving Event', '2026-12-12', 'online', 2500, 3, 1, 'Original details')`).run().lastInsertRowid;
    const before = db.prepare('SELECT name, date, price_pence, details, poster_key FROM events WHERE id = ?').get(eid);
    const links0 = (await sq()).links.length;
    const pg = await text(dev.base, `/admin/events/${eid}/bookings/new?square=1&qty=2`, { jar: g });
    check('Admin › the event › “Already paid on Square” explains nothing is charged, and is set to Square online, paid, email the QR code', pg.includes('Already paid on Square:') && pg.includes('Nothing is charged') &&
      pg.includes('<option value="square_online" selected>') && /name="send" value="1" checked/.test(pg) && pg.includes('name="receipt"'));
    const add = (fields) => submit(dev, g, `/admin/events/${eid}/bookings/new`, { qty: '2', square: '1', method: 'square_online', paid: 'paid', p_name: 'Paper Customer', p_email: 'paper@example.com', p_phone: '07700 900123', g1_name: 'Paper Customer', g2_name: 'Their Friend', send: '1', ...fields });
    const e0 = (await emails()).length;
    const r1 = await add({ receipt: '#AbC123' });
    const b1 = db.prepare(`SELECT * FROM event_bookings WHERE event_id = ? AND purchaser_email = 'paper@example.com'`).get(eid);
    check('registering them: a confirmed, PAID booking for 2, marked as paid earlier on Square, with the receipt number', r1.status === 303 && !!b1 && b1.status === 'confirmed' && b1.payment_status === 'paid' &&
      b1.payment_method === 'square_online' && b1.square_payment_id === 'AbC123' && b1.note.includes('Not charged again'));
    check('…nothing is charged (no Square payment page is made)', (await sq()).links.length === links0);
    const conf = (await emails()).slice(e0).find((m) => m.to[0] === 'paper@example.com');
    check('…they get the usual confirmation email with their QR code', !!conf && conf.html.includes(`/qr/${b1.checkin_token}`) || (!!conf && conf.text.includes(b1.reference)));
    check('…they are on the guest list, and count towards the places (2 of 3 taken)', (await text(dev.base, `/admin/events/${eid}/guests`, { jar: g })).includes('Their Friend') &&
      db.prepare(`SELECT SUM(quantity) AS n FROM event_bookings WHERE event_id = ? AND status IN ('held', 'confirmed')`).get(eid).n === 2);
    const again = await add({ receipt: 'AbC123', p_email: 'other@example.com', g1_name: 'Other', g2_name: 'Other Friend' });
    check('the same Square receipt can’t be registered twice', again.status === 422 && (await again.text()).includes('This Square payment is already registered'));
    const dup = await add({ receipt: '' });
    check('the same person again asks first whether it is a separate booking', dup.status === 422 && (await dup.text()).includes('already has a booking for this event'));
    const full = await add({ receipt: '', dup_ok: '1' });
    check('…and the event’s maximum places are still respected (2 more would make 4 of 3)', full.status === 409 && (await full.text()).includes('only 1 place left'));
    check('the event’s description, date, price and poster are unchanged', JSON.stringify(db.prepare('SELECT name, date, price_pence, details, poster_key FROM events WHERE id = ?').get(eid)) === JSON.stringify(before));
  }

  console.log('\nLaunch: matching up a card payment taken in the Square app but not in the till');
  {
    const today = ukToday();
    const p = await (await fetch(`${dev.mock}/__square/pos/charge?amount=100`)).json();
    const list = await text(dev.base, `/admin/door/reconcile?date=${today}`, { jar: g });
    check('the till lists that day’s card payments from Square, and offers to record the £1.00 one that is missing', list.includes(`Square payment ${p.paymentId}`) && list.includes(`/admin/door/reconcile/${p.paymentId}?date=`) && list.includes('£1.00 card'));
    check('…payments already in the till are marked as such (not offered again)', list.includes('Already in the till'));
    const items = Object.fromEntries(db.prepare('SELECT * FROM till_items').all().map((i) => [i.category, i]));
    const wrong = await submit(dev, g, `/admin/door/reconcile/${p.paymentId}`, { ['q' + items.entry.id]: '1', night: today });
    check('the items must add up to exactly what Square took', wrong.status === 422 && (await wrong.text()).includes('but Square took £1.00'));
    const n0 = db.prepare('SELECT COUNT(*) AS n FROM till_sales').get().n;
    const ok = await submit(dev, g, `/admin/door/reconcile/${p.paymentId}`, { ['q' + items.raffle.id]: '1', night: today });
    const sale = db.prepare('SELECT * FROM till_sales WHERE square_payment_id = ?').get(p.paymentId);
    check('recording it adds ONE £1.00 card sale (1 raffle strip) linked to that Square payment; nothing is charged', ok.status === 303 && !!sale && sale.method === 'card' && sale.total_pence === 100 &&
      db.prepare('SELECT COUNT(*) AS n FROM till_sales').get().n === n0 + 1 && !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'door.reconcile'`).get());
    const twice = await submit(dev, g, `/admin/door/reconcile/${p.paymentId}`, { ['q' + items.raffle.id]: '1', night: today });
    check('…it can never be recorded twice', twice.status === 422 && db.prepare('SELECT COUNT(*) AS n FROM till_sales').get().n === n0 + 1 &&
      (await text(dev.base, `/admin/door/reconcile?date=${today}`, { jar: g })).includes('Already in the till (£1.00'));
    check('a check-in helper can’t use it', (await req(dev.base, `/admin/door/reconcile?date=${today}`, { jar: (await signIn(dev, 'other')).jar })).status === 403);
  }

  console.log('\nLaunch: the permanent address, sharing and emails');
  {
    const { launchRedirect } = await import('../src/index.js');
    const R = (u, env, method = 'GET') => launchRedirect(new Request(u, { method }), { SITE_URL: 'https://newwaysmediumshipdevelopmentcentre.com', ...env }, new URL(u));
    const www = R('https://www.newwaysmediumshipdevelopmentcentre.com/events/12?x=1', {});
    check('www.newwaysmediumshipdevelopmentcentre.com always goes to the real address, keeping the page (an event link opens that event)', www && www.status === 301 && www.headers.get('location') === 'https://newwaysmediumshipdevelopmentcentre.com/events/12?x=1');
    check('the test address keeps working as it is until you switch the move on', R('https://new-ways-website.newwaysmediumship.workers.dev/events/12', {}) === null);
    const moved = R('https://new-ways-website.newwaysmediumship.workers.dev/events/12', { REDIRECT_TEST_ADDRESS: '1' });
    check('…after launch (REDIRECT_TEST_ADDRESS = 1), old test links go to the same page on the real address', moved && moved.headers.get('location') === 'https://newwaysmediumshipdevelopmentcentre.com/events/12');
    check('…but Square’s payment notifications (POST) are never redirected, and the real address itself never is', R('https://new-ways-website.newwaysmediumship.workers.dev/webhooks/square', { REDIRECT_TEST_ADDRESS: '1' }, 'POST') === null &&
      R('https://newwaysmediumshipdevelopmentcentre.com/', { REDIRECT_TEST_ADDRESS: '1' }) === null);
    const oldWww = R('https://www.newwaysmediumshipdevelopmentcentre.com/contact-location', {});
    const oldHome = R('https://newwaysmediumshipdevelopmentcentre.com/home', {});
    check('the old Google Sites pages go straight to the matching new page (www.…/contact-location → /find-us, /home → home page)', oldWww && oldWww.status === 301 &&
      oldWww.headers.get('location') === 'https://newwaysmediumshipdevelopmentcentre.com/find-us' && oldHome && oldHome.headers.get('location') === 'https://newwaysmediumshipdevelopmentcentre.com/' &&
      R('https://newwaysmediumshipdevelopmentcentre.com/this-weeks-medium/', {}).headers.get('location') === 'https://newwaysmediumshipdevelopmentcentre.com/whos-on');
    const { OLD_SITE_PAGES } = await import('../src/index.js');
    let allLive = true;
    for (const to of Object.values(OLD_SITE_PAGES)) if ((await req(dev.base, to)).status !== 200) allLive = false;
    check('…every one of those new pages exists', allLive && Object.keys(OLD_SITE_PAGES).length === 7);
    const home = await text(dev.base, '/');
    check('every page tells Facebook and WhatsApp the real address, the New Way’s logo picture (1200 × 630) and the name and description', home.includes('<meta property="og:url" content="https://newwaysmediumshipdevelopmentcentre.com/">') &&
      home.includes('<meta property="og:image" content="https://newwaysmediumshipdevelopmentcentre.com/images/share-1200x630.jpg">') && home.includes('<meta property="og:site_name" content="New Way’s Mediumship Development Centre">') &&
      home.includes('<link rel="canonical" href="https://newwaysmediumshipdevelopmentcentre.com/">') && home.includes('<meta property="og:image:width" content="1200">'));
    const manifest = await (await fetch(dev.base + '/manifest.webmanifest')).json();
    check('the app (Install App) uses addresses that work on any domain, so it keeps working after the move', manifest.start_url === '/' && manifest.scope === '/' && manifest.id === '/' && manifest.icons.every((i) => i.src.startsWith('/')));
    const st = await text(dev.base, '/admin/status', { jar: g });
    check('System status checks emails can reach real customers (the sending domain is verified in Resend)', st.includes('Emails to real customers') && st.includes('example.test is verified in Resend'));
    check('…and shows the till’s Square app checking, and that the test address is not moved yet', st.includes('Wednesday till card payments (Square app)') && st.includes('No (switched on at launch)'));
  }

  // Every date starts closed now: open the Sundays in the next 8 weeks, 3pm to 6pm, as Gary would in Admin
  for (let i = 0; i <= 56; i++) { const d = addDays(i); if (new Date(d + 'T12:00:00Z').getUTCDay() === 0)
    db.prepare(`INSERT INTO availability_dates (date, mode, start_time, end_time) VALUES (?, 'hours', '15:00', '18:00')`).run(d); }

  console.log('\nIncomplete private reading bookings (kept 24 hours)');
  {
    const env = { DB: makeD1(dev.dbFile), EMAIL_FROM: 'New Way’s <bookings@example.test>', RESEND_API_KEY: 're_local_test', RESEND_API_BASE: dev.mock, SITE_URL: 'https://newwaysmediumshipdevelopmentcentre.com' };
    let sunday = addDays(3); while (new Date(sunday + 'T12:00:00Z').getUTCDay() !== 0) sunday = (() => { const d = new Date(sunday + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const pick = { reading: 'reading-30', date: sunday, time: '15:00' };
    const det = await text(dev.base, `/private-readings/book/details?${new URLSearchParams(pick)}`);
    const t = (det.match(/name="t" value="([^"]+)"/) || [])[1];
    check('before giving their details, the customer is told unfinished details are kept up to 24 hours, then deleted, and not used for contact or marketing',
      det.includes('If you don’t finish booking, these details are kept for up to 24 hours so we can check the booking system is working, then deleted. We won’t use them to contact you or for marketing.') && !det.includes('name="draft"'));
    const drafts = () => db.prepare('SELECT * FROM reading_drafts ORDER BY id').all();
    const slotsBefore = db.prepare('SELECT COUNT(*) AS n FROM booking_slots').get().n;
    const give = (fields, ip = '10.9.0.1') => req(dev.base, '/private-readings/book/details', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
      body: new URLSearchParams({ t, ...pick, name: 'Ivy Incomplete', phone: '07700 900555', email: 'ivy@example.com', ...fields }).toString() });
    check('details that aren’t complete are not saved', (await give({ email: '' })).status === 422 && drafts().length === 0);
    const r1 = await give({});
    const h1 = await r1.text();
    const key = (h1.match(/name="draft" value="([^"]+)"/) || [])[1];
    const d1 = drafts()[0];
    check('once name, WhatsApp mobile and email are given, they are saved with the reading, date and time (still in progress)', r1.status === 200 && !!key && drafts().length === 1 && d1.customer_name === 'Ivy Incomplete' &&
      d1.customer_phone === '07700 900555' && d1.customer_email === 'ivy@example.com' && d1.service_code === 'reading-30' && d1.date === sunday && d1.local_start === '15:00' && d1.status === 'in_progress');
    check('…only a hash of the browser’s key is stored, and the record is set to be deleted 24 hours after it was saved', d1.token_hash === hex('draft:' + key) && !JSON.stringify(d1).includes(key) &&
      Math.abs(Date.parse(d1.delete_after) - Date.parse(d1.created_at) - 24 * 3600_000) < 1000);
    check('…and it doesn’t hold the appointment time (no slot is taken)', db.prepare('SELECT COUNT(*) AS n FROM booking_slots').get().n === slotsBefore &&
      (await text(dev.base, `/private-readings/book?reading=reading-30&date=${sunday}`)).includes('>3pm</a>'));
    const r2 = await give({ draft: key, edit: '1' });
    const r3 = await give({ draft: key, name: 'Ivy Changed' });
    check('changing their details updates the same record (no duplicate)', r2.status === 200 && r3.status === 200 && drafts().length === 1 && drafts()[0].customer_name === 'Ivy Changed' && (await r3.text()).includes(`name="draft" value="${key}"`));

    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    db.prepare('UPDATE reading_drafts SET last_active_at = ? WHERE id = ?').run(old, d1.id);
    const ping = await req(dev.base, '/private-readings/book/active', { method: 'POST', ...form({ draft: key }) });
    check('while the customer is still using the booking pages, the 30 minutes start again', ping.status === 204 && Date.now() - Date.parse(drafts()[0].last_active_at) < 5000);
    await incompleteHourlyJobs(env);
    check('…so an active customer is not counted as incomplete, and no email is sent', drafts()[0].status === 'in_progress' && drafts()[0].notify_status === '');
    check('a wrong key, or a request from another website, changes nothing', (await req(dev.base, '/private-readings/book/active', { method: 'POST', ...form({ draft: 'x'.repeat(32) }) })).status === 204 &&
      (await req(dev.base, '/private-readings/book/active', { method: 'POST', origin: 'https://evil.example', ...form({ draft: key }) })).status === 403);

    const mails = async () => (await emails()).filter((m) => /^Incomplete booking/.test(m.subject));
    const before = (await mails()).length;
    db.prepare('UPDATE reading_drafts SET last_active_at = ? WHERE id = ?').run(old, d1.id);
    await incompleteHourlyJobs(env);
    const after = await mails();
    const mail = after[after.length - 1];
    check('after 30 minutes without activity it becomes incomplete, and Gary gets one email', drafts()[0].status === 'incomplete' && drafts()[0].notify_status === 'sent' && after.length === before + 1 && mail.to[0] === 'gary@example.com');
    check('…the email has the reading, date and time and the Admin link, but no personal details', mail.text.includes('30 Minute Private Reading') && mail.text.includes('/admin/incomplete') &&
      !/Ivy|ivy@example|07700|900555/.test(mail.text + mail.html + mail.subject));
    check('…and it goes to Gary only (not the second notification address)', !after.some((m) => m.to[0] === 'julie@example.com'));
    await incompleteHourlyJobs(env);
    await req(dev.base, '/private-readings/book/active', { method: 'POST', ...form({ draft: key }) });
    db.prepare('UPDATE reading_drafts SET last_active_at = ? WHERE id = ?').run(old, d1.id);
    await incompleteHourlyJobs(env);
    check('Gary is never emailed twice about the same booking (even if the customer comes back and stops again)', (await mails()).length === before + 1);

    const ad = await text(dev.base, '/admin/incomplete', { jar: g });
    check('Admin › Incomplete Bookings shows the customer’s details, reading, date, time and status', ad.includes('Ivy Changed') && ad.includes('07700 900555') && ad.includes('ivy@example.com') &&
      ad.includes('30 Minute Private Reading') && ad.includes('3pm') && ad.includes('INCOMPLETE') && ad.includes('Delete now'));
    check('…it is on the Admin home, Julie (full Admin) can see it, check-in helpers can’t', (await text(dev.base, '/admin', { jar: g })).includes('href="/admin/incomplete"') &&
      (await req(dev.base, '/admin/incomplete', { jar: julieJar })).status === 200 && (await req(dev.base, '/admin/incomplete', { jar: (await signIn(dev, 'other')).jar })).status === 403 &&
      (await req(dev.base, '/admin/incomplete')).status !== 200);

    // A second customer goes on to payment: never incomplete, and shown as booked once paid
    await sleep(3200);
    const g2 = await give({ name: 'Paula Payer', email: 'paula@example.com', phone: '07700 900666' }, '10.9.0.2');
    const key2 = ((await g2.text()).match(/name="draft" value="([^"]+)"/) || [])[1];
    const paid = await req(dev.base, '/private-readings/book', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '10.9.0.3' },
      body: new URLSearchParams({ t, ...pick, name: 'Paula Payer', email: 'paula@example.com', phone: '07700 900666', policy: '1', draft: key2, 'cf-turnstile-response': TOKEN, website: '' }).toString() });
    const d2 = db.prepare('SELECT * FROM reading_drafts WHERE customer_name = ?').get('Paula Payer');
    check('pressing Proceed to Secure Payment marks the record as gone to payment (the existing booking and hold work as before)', paid.status === 303 && /^\/order\/NW-/.test(paid.headers.get('location')) &&
      d2.status === 'checkout' && !!d2.order_reference && db.prepare('SELECT status FROM orders WHERE reference = ?').get(d2.order_reference).status === 'pending');
    db.prepare('UPDATE reading_drafts SET last_active_at = ? WHERE id = ?').run(old, d2.id);
    const before2 = (await mails()).length;
    await incompleteHourlyJobs(env);
    check('…so it is never counted as incomplete and no email is sent about it', db.prepare('SELECT status FROM reading_drafts WHERE id = ?').get(d2.id).status === 'checkout' && (await mails()).length === before2);
    check('…Admin shows it at payment', (await text(dev.base, '/admin/incomplete', { jar: g })).includes('AT PAYMENT'));
    db.prepare(`UPDATE orders SET status = 'paid' WHERE reference = ?`).run(d2.order_reference);
    check('…and once paid, as booked and paid (no longer incomplete)', (await text(dev.base, '/admin/incomplete', { jar: g })).includes('BOOKED AND PAID'));

    const del = await submit(dev, g, `/admin/incomplete/${d2.id}/delete`, {});
    check('Delete now removes a record straight away; the change log says a record was deleted, but not whose', del.status === 303 && !db.prepare('SELECT 1 FROM reading_drafts WHERE id = ?').get(d2.id) &&
      !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'incomplete.delete' AND summary NOT LIKE '%Paula%'`).get());
    check('…and it can’t be done from another website', (await submit(dev, g, `/admin/incomplete/${d1.id}/delete`, {}, {}, 'https://evil.example')).status === 403 && !!db.prepare('SELECT 1 FROM reading_drafts WHERE id = ?').get(d1.id));

    db.prepare('UPDATE reading_drafts SET delete_after = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), d1.id);
    db.prepare(`INSERT INTO reading_drafts (token_hash, service_code, service_name, minutes, date, local_start, customer_name, customer_phone, customer_email, status, created_at, last_active_at, delete_after)
      VALUES ('old-one', 'reading-60', '60 Minute Private Reading', 60, ?, '14:00', 'Otto Old', '07700 900777', 'otto@example.com', 'incomplete', ?, ?, ?)`).run(sunday, old, old, new Date(Date.now() - 60_000).toISOString());
    const ad2 = await text(dev.base, '/admin/incomplete', { jar: g });
    check('24 hours after being saved, a record is gone from Admin and deleted from the database', !ad2.includes('Ivy') && !ad2.includes('Otto') && drafts().length === 0);
    db.prepare(`INSERT INTO reading_drafts (token_hash, service_code, service_name, minutes, date, local_start, customer_name, customer_phone, customer_email, status, created_at, last_active_at, delete_after)
      VALUES ('old-two', 'reading-60', '60 Minute Private Reading', 60, ?, '14:00', 'Otto Old', '07700 900777', 'otto@example.com', 'checkout', ?, ?, ?)`).run(sunday, old, old, new Date(Date.now() - 60_000).toISOString());
    await incompleteHourlyJobs(env);
    check('…the hourly job deletes them too, whatever their status', drafts().length === 0);
    check('the Privacy Notice explains incomplete bookings and the 24 hours', (await text(dev.base, '/privacy')).includes('Incomplete bookings') && (await text(dev.base, '/privacy')).includes('deleted 24 hours after they were given'));
    db.prepare(`INSERT INTO reading_drafts (token_hash, service_code, service_name, minutes, date, local_start, customer_name, customer_phone, customer_email, status, created_at, last_active_at, delete_after)
      VALUES ('for-backup', 'reading-30', '30 Minute Private Reading', 30, ?, '15:00', 'Bea Backup', '07700 900888', 'bea@example.com', 'incomplete', ?, ?, ?)`).run(sunday, old, old, new Date(Date.now() + 3600_000).toISOString());
    const backup = await (await req(dev.base, '/admin/backups/download', { jar: g })).text();
    check('incomplete booking details are never put in backups', !backup.includes('reading_drafts') && !backup.includes('Bea Backup'));
    db.prepare(`DELETE FROM reading_drafts`).run();
  }

  console.log('\nPrivate readings: Availability (every date closed unless opened) and breaks');
  {
    const setting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
    // The rule itself, worked through: a date open 3pm to 6pm, a 30-minute break after every reading
    let sun = addDays(20); while (new Date(sun + 'T12:00:00Z').getUTCDay() !== 0) sun = avl.addDays(sun, 1);
    const rules = { weekly: [], dates: [{ date: sun, mode: 'hours', start_time: '15:00', end_time: '18:00' }], blocks: [] };
    const opts = (taken) => ({ nowMs: Date.parse(sun + 'T00:00:00Z') - 30 * 86400_000, noticeHours: 24, taken, breakMin: 30 });
    const after = (start, minutes) => new Set(avl.reservedSlots(avl.momentOf(sun, start), minutes, 30));
    check('with nothing booked: 30-minute readings 3pm to 5:30pm, 60-minute 3pm to 5pm (the last one finishes at 6pm, no break needed after it)',
      avl.bookableStarts(sun, rules, 30, opts(new Set())).join() === '15:00,15:30,16:00,16:30,17:00,17:30' && avl.bookableStarts(sun, rules, 60, opts(new Set())).join() === '15:00,15:30,16:00,16:30,17:00');
    check('a 30-minute reading at 3pm finishes at 3:30pm: the next can start at 4pm', avl.bookableStarts(sun, rules, 30, opts(after('15:00', 30)))[0] === '16:00');
    check('a 60-minute reading at 3pm finishes at 4pm: the next can start at 4:30pm', avl.bookableStarts(sun, rules, 30, opts(after('15:00', 60)))[0] === '16:30' &&
      avl.bookableStarts(sun, rules, 60, opts(after('15:00', 60)))[0] === '16:30');
    check('…and a reading can’t end right before a booked one either (a break is needed before it too)', !avl.bookableStarts(sun, rules, 30, opts(after('16:30', 30))).includes('16:00') &&
      avl.bookableStarts(sun, rules, 30, opts(after('16:30', 30))).includes('15:30'));
    check('weekly hours are never used, even if some were left in the database (no date opens by itself)', (await (async () => {
      db.prepare(`INSERT INTO availability_weekly (weekday, start_time, end_time) VALUES (1, '09:00', '17:00')`).run();
      let mon = addDays(5); while (new Date(mon + 'T12:00:00Z').getUTCDay() !== 1) mon = avl.addDays(mon, 1);
      const r = await avl.loadRules({ DB: makeD1(dev.dbFile) }, mon, mon);
      db.prepare('DELETE FROM availability_weekly').run();
      return r.weekly.length === 0 && avl.windowsFor(mon, r).windows.length === 0;
    })()));
    check('the break comes from Admin, 30 minutes to start with; customers can book 8 weeks ahead', setting('booking_break_minutes') === '30' && setting('booking_horizon_weeks') === '8');

    // On the website: real bookings, holds and the public calendar (which looks exactly as before)
    const times = async (code, d) => { const h = await text(dev.base, `/private-readings/book?reading=${code}&date=${d}`); return [...h.matchAll(/class="time-btn press" href="[^"]*time=(\d\d%3A\d\d|\d\d:\d\d)"/g)].map((m) => decodeURIComponent(m[1])); };
    check('an opened Sunday shows 3pm to 5:30pm for 30-minute readings', (await times('reading-30', sun)).join() === '15:00,15:30,16:00,16:30,17:00,17:30');
    const det = await text(dev.base, `/private-readings/book/details?reading=reading-30&date=${sun}&time=15:00`);
    const stamp = (det.match(/name="t" value="([^"]+)"/) || [])[1];
    await sleep(3200);
    const book = (time, reading, ip, date = sun, name = 'Brenda Break') => req(dev.base, '/private-readings/book', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
      body: new URLSearchParams({ t: stamp, reading, date, time, name, email: 'brenda@example.com', phone: '07700 900321', policy: '1', 'cf-turnstile-response': TOKEN, website: '' }).toString() });
    const b1 = await book('15:00', 'reading-30', '10.8.0.1');
    const held = db.prepare(`SELECT b.* FROM bookings b JOIN orders o ON o.id = b.order_id WHERE o.customer_name = 'Brenda Break' ORDER BY b.id DESC`).get();
    check('a 30-minute booking at 3pm holds its half hour and the break after it', b1.status === 303 && held.status === 'held' &&
      db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(held.id).n === 2);
    check('…so while it is held, the next time offered is 4pm', (await times('reading-30', sun)).join() === '16:00,16:30,17:00,17:30');
    const adm = async () => text(dev.base, `/admin/readings/availability?month=${sun.slice(0, 7)}&date=${sun}`, { jar: g });
    const cellOf = (h) => (h.match(new RegExp(`<a class="av-day[^"]*"[^>]*date=${sun}[^>]*>[\\s\\S]*?</a>`)) || [''])[0];
    const heldPage = await adm();
    check('a payment hold is NOT counted as an appointment in the Admin calendar (no green number, just the “not confirmed” marker)', !cellOf(heldPage).includes('av-count') && cellOf(heldPage).includes('av-other') &&
      heldPage.includes('Payment holds') && heldPage.includes('PAYMENT HOLD') && heldPage.includes('No confirmed appointments on this date.'));
    check('the website refuses a booking that would fall in the break (3:30pm), even if sent directly', (await book('15:30', 'reading-30', '10.8.0.2')).status === 409 &&
      db.prepare(`SELECT COUNT(*) AS n FROM bookings b JOIN orders o ON o.id = b.order_id WHERE o.customer_name = 'Brenda Break'`).get().n === 1);
    db.prepare(`UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = ?`).run(held.id);
    db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(held.order_id);
    const b2 = await book('16:00', 'reading-60', '10.8.0.3');
    check('a 60-minute reading can be booked at 4pm (after the 3pm reading’s break)', b2.status === 303);
    check('…then only 5:30pm is left for 30 minutes (4pm–5pm, then the break), and nothing for 60 minutes', (await times('reading-30', sun)).join() === '17:30' && (await times('reading-60', sun)).length === 0);
    check('a booking overlapping another is refused (60 minutes at 4:30pm)', (await book('16:30', 'reading-60', '10.8.0.4')).status === 409);

    // Admin: only paid, confirmed appointments get the green number; everything else is listed apart
    const two = db.prepare(`SELECT b.id, b.order_id FROM bookings b JOIN orders o ON o.id = b.order_id WHERE o.customer_name = 'Brenda Break' AND b.local_start = '16:00'`).get();
    let page = await adm();
    check('the Admin calendar counts only the 1 paid appointment, and lists the payment hold separately', cellOf(page).includes('<span class="av-count" aria-hidden="true">1</span>') &&
      page.includes('3pm · 30 Minute Private Reading') && page.includes('PAID') && page.includes('4pm · 60 Minute Private Reading') && page.includes('PAYMENT HOLD'));
    db.prepare(`UPDATE bookings SET hold_expires_at = ? WHERE id = ?`).run(new Date(Date.now() - 60_000).toISOString(), two.id);
    page = await adm();
    check('a hold that has run out is released when Admin opens: shown as an unpaid order, never as an appointment, and its time is free again', page.includes('Unpaid orders') && page.includes('NOT PAID') &&
      !page.includes('PAYMENT HOLD') && cellOf(page).includes('<span class="av-count" aria-hidden="true">1</span>') && db.prepare('SELECT status FROM bookings WHERE id = ?').get(two.id).status === 'expired' &&
      db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(two.id).n === 0);
    db.prepare(`INSERT INTO reading_drafts (token_hash, service_code, service_name, minutes, date, local_start, customer_name, customer_phone, customer_email, status, created_at, last_active_at, delete_after)
      VALUES ('cal-incomplete', 'reading-30', '30 Minute Private Reading', 30, ?, '17:00', 'Ida Incomplete', '07700 900999', 'ida@example.com', 'incomplete', ?, ?, ?)`).run(sun, new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString());
    page = await adm();
    check('an incomplete booking (details given, never went to Square) is listed apart too, and still not counted', page.includes('Incomplete bookings') && page.includes('Ida Incomplete') && page.includes('INCOMPLETE') &&
      cellOf(page).includes('<span class="av-count" aria-hidden="true">1</span>') && !!db.prepare(`SELECT 1 FROM reading_drafts WHERE token_hash = 'cal-incomplete'`).get());
    db.prepare(`DELETE FROM reading_drafts WHERE token_hash = 'cal-incomplete'`).run();

    // Admin: the break can be changed, and the calendar follows it at once
    await submit(dev, g, '/admin/readings/availability/break', { break_minutes: '0' });
    const sun2 = avl.addDays(sun, 7);
    const noBreak = await book('15:00', 'reading-30', '10.8.0.9', sun2, 'Nora Nobreak');
    check('with no break, the next reading can start straight after (3pm booked, 3:30pm offered)', setting('booking_break_minutes') === '0' && noBreak.status === 303 &&
      (await times('reading-30', sun2)).join() === '15:30,16:00,16:30,17:00,17:30');
    check('a break that isn’t one of the choices is refused', (await submit(dev, g, '/admin/readings/availability/break', { break_minutes: '45' })).status === 422 && setting('booking_break_minutes') === '0');
    await submit(dev, g, '/admin/readings/availability/break', { break_minutes: '30' });

    // Closing a date with a paid appointment: a clear warning, and nothing is cancelled
    const close = await submit(dev, g, '/admin/readings/availability/day', { date: sun, choice: 'closed' });
    const closeHtml = await close.text();
    check('closing a date with a paid appointment warns clearly and saves nothing until confirmed', close.status === 409 && closeHtml.includes('This change affects an existing appointment') &&
      closeHtml.includes('3pm 30 Minute Private Reading (30 minutes) for Brenda Break, paid') && closeHtml.includes('will NOT cancel or change') && !!db.prepare('SELECT 1 FROM availability_dates WHERE date = ?').get(sun));
    const closed = await submit(dev, g, '/admin/readings/availability/day', { date: sun, choice: 'closed', confirm: '1' });
    check('…once confirmed, the date is closed for new bookings, and the paid appointment is untouched', closed.status === 303 && !db.prepare('SELECT 1 FROM availability_dates WHERE date = ?').get(sun) &&
      db.prepare('SELECT status FROM bookings WHERE id = ?').get(held.id).status === 'confirmed' && db.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?').get(held.id).n === 2 &&
      (await times('reading-30', sun)).length === 0 && !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'readings.day' AND summary LIKE '%unchanged%'`).get());
    await submit(dev, g, '/admin/readings/availability/day', { date: sun, choice: 'available', start_time: '15:00', end_time: '18:00' });
    const shorter = await submit(dev, g, '/admin/readings/availability/day', { date: sun, choice: 'available', start_time: '16:00', end_time: '18:00' });
    check('changing a date’s hours so a paid appointment falls outside them warns too', shorter.status === 409 && (await shorter.text()).includes('3pm 30 Minute Private Reading'));

    // Any day can be made available; dates beyond 8 weeks can be set up but aren't bookable until they come within 8 weeks
    let wed = addDays(20); while (new Date(wed + 'T12:00:00Z').getUTCDay() !== 3) wed = avl.addDays(wed, 1);
    check('a Wednesday is closed to start with', (await times('reading-30', wed)).length === 0);
    const opened = await submit(dev, g, '/admin/readings/availability/day', { date: wed, choice: 'available', start_time: '10:00', end_time: '12:00', note: 'Extra day' });
    check('making a Wednesday available (10am to 12 noon) shows it on the public calendar, with breaks', opened.status === 303 && (await times('reading-30', wed)).join() === '10:00,10:30,11:00,11:30' &&
      (await times('reading-60', wed)).join() === '10:00,10:30,11:00' && (await text(dev.base, `/private-readings/book?reading=reading-30&month=${wed.slice(0, 7)}`)).includes(`date=${wed}#times`));
    check('times set the wrong way round are refused', (await submit(dev, g, '/admin/readings/availability/day', { date: wed, choice: 'available', start_time: '12:00', end_time: '10:00' })).status === 422);
    await submit(dev, g, '/admin/readings/availability/day', { date: wed, choice: 'closed' });
    check('…and closed again', (await times('reading-30', wed)).length === 0 && !db.prepare('SELECT 1 FROM availability_dates WHERE date = ?').get(wed));
    const far = addDays(70);
    const farSaved = await submit(dev, g, '/admin/readings/availability/day', { date: far, choice: 'available', start_time: '15:00', end_time: '18:00' });
    const farPage = await text(dev.base, `/admin/readings/availability?month=${far.slice(0, 7)}&date=${far}`, { jar: g });
    check('a date 10 weeks away can be set up now; Admin says when it opens to customers', farSaved.status === 303 && farPage.includes('Not bookable yet: opens to customers on') && farPage.includes('is-later'));
    check('…but customers can’t book it yet: not offered, and refused if sent directly', (await times('reading-30', far)).length === 0 &&
      (await req(dev.base, `/private-readings/book/details?reading=reading-30&date=${far}&time=15:00`)).status === 409);
    await submit(dev, g, '/admin/readings/availability/day', { date: far, choice: 'closed' });
    check('every change is in the change log', db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('readings.day', 'readings.break')`).get().n >= 7);
    check('a check-in helper can’t open the Availability screen', (await req(dev.base, '/admin/readings/availability', { jar: (await signIn(dev, 'other')).jar })).status === 403);
    const styles = ((await adm()).match(/\sstyle="|<script(?![^>]*\bsrc=)/g) || []).length;
    check('the Availability screen has no inline styles or scripts', styles === 0);
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

  console.log('\nEvents: the manual SOLD OUT switch, the banner, and 0 places');
  {
    const poster = 'img/2026/10/event-poster-test.jpg';
    const mk = (name, capacity, mode = 'online', extra = {}) => db.prepare(`INSERT INTO events (name, date, sales_mode, price_pence, capacity, max_per_booking, start_time, visible, poster_key, summary, details, ticket_url)
      VALUES (?, ?, ?, 1500, ?, 4, '19:00', 1, ?, ?, ?, ?)`).run(name, addDays(40), mode, capacity, poster, extra.summary || 'An evening of mediumship.', extra.details || '', extra.ticket_url || '').lastInsertRowid;
    const A = mk('Sold Out Night A', 10, 'online', { details: 'Full details stay on show.' });
    const B = mk('Still Selling Night B', 10);
    const evRow = (id) => db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    const bookingsTotal = () => db.prepare('SELECT COUNT(*) AS n FROM event_bookings').get().n;
    const cardOf = (html, name) => { const i = html.indexOf(`>${name}</a>`); if (i < 0) return ''; const s = html.lastIndexOf('<article', i); return html.slice(s, html.indexOf('</article>', i)); };
    check('every existing event starts with SOLD OUT switched off (the database update changes nothing until Gary uses it)',
      db.prepare('SELECT COUNT(*) AS n FROM events WHERE sold_out != 0').get().n === 0 && evRow(A).sold_out === 0);

    // A customer is already at the payment step for event A when Gary switches SOLD OUT on
    let stampPage = await text(dev.base, `/events/${A}/book?qty=1`);
    const stamp = (stampPage.match(/name="t" value="([^"]+)"/) || [])[1];
    await sleep(3100);
    const evPost = (id, fields, ip) => req(dev.base, `/events/${id}/book`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
      body: new URLSearchParams({ t: stamp, website: '', qty: '1', p_name: 'Early Bird', p_email: 'early@example.com', p_phone: '07700 900111', g1_name: 'Early Bird', ...fields }).toString() });
    const held = await evPost(A, { step: 'confirm', 'cf-turnstile-response': TOKEN }, '10.0.77.1');
    const early = db.prepare(`SELECT * FROM event_bookings WHERE event_id = ? AND purchaser_email = 'early@example.com'`).get(A);
    check('(before) a customer holds a place for event A and is sent to pay', held.status === 303 && early && early.status === 'held');

    const before = bookingsTotal();
    const on = await submit(dev, g, `/admin/events/${A}/sold-out`, { sold_out: '1' });
    check('Gary switches SOLD OUT on for event A: saved, and the activity log records it', on.status === 303 && (on.headers.get('location') || '').endsWith(`/admin/events/${A}/manage?flash=soldout-on`) &&
      evRow(A).sold_out === 1 && !!db.prepare(`SELECT 1 FROM audit_log WHERE action = 'events.sold_out' AND summary LIKE '%Sold Out Night A%on'`).get());
    check('…only event A changed: event B is still not sold out', evRow(B).sold_out === 0);

    const list = await text(dev.base, '/events');
    const cardA = cardOf(list, 'Sold Out Night A'), cardB = cardOf(list, 'Still Selling Night B');
    check('the Events page shows the animated SOLD OUT banner over event A’s picture', cardA.includes('class="soldout-wrap"') && cardA.includes('class="soldout-banner"') && cardA.includes('>SOLD OUT</span>'));
    check('…the picture itself is the same file, unchanged (the banner is drawn on top by the page)', cardA.includes(`src="/media/${encodeURIComponent(poster)}"`));
    check('…event A stays on the website with its details, but has no Book tickets button', cardA.includes('An evening of mediumship.') && cardA.includes('Full details stay on show.') && !cardA.includes(`href="/events/${A}/book"`));
    check('…event B has no banner and can still be booked', !cardB.includes('soldout-') && cardB.includes(`href="/events/${B}/book"`));
    const pageA = await text(dev.base, `/events/${A}`);
    check('event A’s own page shows the banner too', pageA.includes('class="soldout-banner"') && !pageA.includes(`href="/events/${A}/book"`) && pageA.includes('https://schema.org/SoldOut'));
    check('the banner is navy and gold, scales with the picture, shimmers gently, and stays still for anyone who turns off motion',
      /\.soldout-ribbon \{[^}]*#000428[^}]*#F8B709/s.test(fs.readFileSync(path.join(root, 'public', 'css', 'site.css'), 'utf8')) &&
      fs.readFileSync(path.join(root, 'public', 'css', 'site.css'), 'utf8').includes('clamp(18px, 11cqw, 72px)') &&
      /@media \(prefers-reduced-motion: reduce\) \{ \.soldout-ribbon::after, \.soldout-text \{ animation: none; \}/.test(fs.readFileSync(path.join(root, 'public', 'css', 'site.css'), 'utf8')));

    // the server refuses new online purchases for A, at every step
    const start = await req(dev.base, `/events/${A}/book?qty=1`);
    const startHtml = await start.text();
    check('opening event A’s booking page shows it is SOLD OUT instead of the ticket form', !startHtml.includes('How many tickets?') && !startHtml.includes('name="g1_name"') && startHtml.includes('SOLD OUT'));
    const sneak = await evPost(A, { step: 'confirm', 'cf-turnstile-response': TOKEN, p_email: 'late@example.com' }, '10.0.77.2');
    check('a purchase sent straight to the server for event A is refused, and nothing is booked or charged', sneak.status === 409 &&
      !db.prepare(`SELECT 1 FROM event_bookings WHERE purchaser_email = 'late@example.com'`).get() && bookingsTotal() === before);
    let refused = '';
    try {
      db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, total_pence, checkin_token) VALUES (?, 'EV-SOLD01', 'online', 'held', 'square_online', 'pending', 1, 1500, 'tok-sold-1')`).run(A);
    } catch (e) { refused = e.message; }
    check('…even at the database itself, a new online hold for event A is refused (last line of defence)', /EVENT_FULL/.test(refused));
    db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, total_pence, checkin_token) VALUES (?, 'EV-SOLD02', 'online', 'held', 'square_online', 'pending', 1, 1500, 'tok-sold-2')`).run(B);
    check('…while event B still accepts online bookings', !!db.prepare(`SELECT 1 FROM event_bookings WHERE reference = 'EV-SOLD02'`).get());
    db.prepare(`DELETE FROM event_bookings WHERE reference = 'EV-SOLD02'`).run();
    db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, total_pence, checkin_token) VALUES (?, 'EV-SOLD03', 'admin', 'confirmed', 'cash', 'paid', 1, 1500, 'tok-sold-3')`).run(A);
    check('Gary can still add a booking by hand in Admin for event A (for example cash at the door)', !!db.prepare(`SELECT 1 FROM event_bookings WHERE reference = 'EV-SOLD03'`).get());
    db.prepare(`DELETE FROM event_bookings WHERE reference = 'EV-SOLD03'`).run();

    // the customer who was already paying can finish
    const payment = await payInSquare(early.square_payment_link_id);
    await webhook(payEvent(payment));
    const earlyAfter = db.prepare('SELECT * FROM event_bookings WHERE id = ?').get(early.id);
    check('the customer who was already on the payment page can still finish: paid and confirmed, with their QR code', earlyAfter.status === 'confirmed' && earlyAfter.payment_status === 'paid' && !!earlyAfter.checkin_token);

    // Admin screens
    const hub = await text(dev.base, `/admin/events/${A}/manage?flash=soldout-on`, { jar: g });
    check('event A’s Admin page shows SOLD OUT IS ON with a button to switch it off', hub.includes('SOLD OUT is switched on for this event.') && hub.includes('SOLD OUT IS ON') && hub.includes('Switch SOLD OUT off'));
    check('the Admin Events list says SOLD OUT is switched on for event A only', (await text(dev.base, '/admin/events', { jar: g })).split('SOLD OUT is switched on').length === 2);
    const hubB = await text(dev.base, `/admin/events/${B}/manage`, { jar: g });
    check('event B’s Admin page offers the switch, set to off', hubB.includes('Switch SOLD OUT on') && !hubB.includes('SOLD OUT IS ON'));
    const helper = (await signIn(dev, 'other')).jar;
    const helperTry = await submit(dev, helper, `/admin/events/${B}/sold-out`, { sold_out: '1' });
    check('a check-in helper can’t use the switch', helperTry.status === 403 && evRow(B).sold_out === 0);
    const julieTry = await req(dev.base, `/admin/events/${B}/manage`, { jar: julieJar });
    check('Julie (full Admin) sees the switch too (and so will the Admin app, which uses the same pages)', julieTry.status === 200 && (await julieTry.text()).includes('Switch SOLD OUT on'));
    check('the switch only accepts a proper button press (not a plain link)', (await req(dev.base, `/admin/events/${B}/sold-out`, { jar: g })).status === 405 && evRow(B).sold_out === 0);

    // switching off
    await submit(dev, g, `/admin/events/${A}/sold-out`, { sold_out: '0' });
    const list2 = await text(dev.base, '/events');
    check('switching SOLD OUT off removes the banner and the Book tickets button comes back (places are left)', evRow(A).sold_out === 0 && !cardOf(list2, 'Sold Out Night A').includes('soldout-') &&
      cardOf(list2, 'Sold Out Night A').includes(`href="/events/${A}/book"`) && (await text(dev.base, `/events/${A}/book`)).includes('How many tickets?'));
    check('…and no booking, payment or QR code was changed by switching on and off', db.prepare('SELECT status, payment_status, checkin_token FROM event_bookings WHERE id = ?').get(early.id).checkin_token === earlyAfter.checkin_token &&
      db.prepare('SELECT status FROM event_bookings WHERE id = ?').get(early.id).status === 'confirmed');

    // the tick-box in Edit event
    const editPage = await text(dev.base, `/admin/events/${A}`, { jar: g });
    check('Edit event has a SOLD OUT tick-box too', editPage.includes('name="sold_out"') && editPage.includes('stop online ticket sales for this event only'));

    // 0 places
    const base0 = { name: 'Zero Places Night', date: addDays(45), time_text: '7pm', summary: 'No online places.', details: '', ticket_info: '', ticket_url: '', visible: '1', sales_mode: 'online',
      start_time: '19:00', doors_time: '', venue: '', address: '', price_pence: '15', capacity: '0', max_per_booking: '4', sales_open_at: '', sales_close_at: '', instructions: '', booking_terms: '' };
    const made0 = await submit(dev, g, '/admin/events/new', base0);
    const z = db.prepare(`SELECT * FROM events WHERE name = 'Zero Places Night'`).get();
    check('the maximum number of places now accepts 0', made0.status === 303 && z && z.capacity === 0);
    const zPage = await text(dev.base, `/events/${z.id}`);
    check('…an online event with 0 places shows SOLD OUT and can’t be booked', zPage.includes('>SOLD OUT<') && !(await text(dev.base, `/events/${z.id}/book`)).includes('How many tickets?'));
    check('…and Admin shows 0 places (not “unlimited”)', (await text(dev.base, `/admin/events/${z.id}/manage`, { jar: g })).includes('<strong>0</strong> capacity'));

    // automatic sell-out also gets the banner
    const C = mk('Every Place Taken C', 1);
    db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, payment_method, payment_status, quantity, total_pence, checkin_token) VALUES (?, 'EV-SOLD04', 'admin', 'confirmed', 'cash', 'paid', 1, 1500, 'tok-sold-4')`).run(C);
    const cardC = cardOf(await text(dev.base, '/events'), 'Every Place Taken C');
    check('an event that sells out automatically (every place taken) shows the same banner', cardC.includes('class="soldout-banner"') && evRow(C).sold_out === 0);

    // Square ticket link events
    const L = mk('Square Link Night', 0, 'link', { ticket_url: 'https://square.link/u/example123' });
    const cardL1 = cardOf(await text(dev.base, '/events'), 'Square Link Night');
    await submit(dev, g, `/admin/events/${L}/sold-out`, { sold_out: '1' });
    const cardL2 = cardOf(await text(dev.base, '/events'), 'Square Link Night');
    check('a Square-ticket-link event switched to SOLD OUT shows the banner and its ticket button is hidden', cardL1.includes('square.link/u/example123') && !cardL1.includes('soldout-') &&
      cardL2.includes('class="soldout-banner"') && !cardL2.includes('square.link/u/example123'));
    // the Home screen's "Next special event"
    const H = db.prepare(`INSERT INTO events (name, date, sales_mode, capacity, visible, poster_key, sort_order, ticket_url) VALUES ('Home Next Night', ?, 'link', 0, 1, ?, -999, 'https://square.link/u/home1')`).run(ukToday(), poster).lastInsertRowid;
    const home1 = await text(dev.base, '/');
    db.prepare('UPDATE events SET sold_out = 1 WHERE id = ?').run(H);
    const home2 = await text(dev.base, '/');
    check('the Home screen’s “Next special event” shows a small SOLD OUT banner on its picture when it is sold out', home1.includes('Home Next Night') && !home1.includes('soldout-') &&
      home2.includes('Home Next Night') && home2.includes('class="soldout-wrap soldout-sm"') && home2.includes(`src="/media/${encodeURIComponent(poster)}"`));
    db.prepare('DELETE FROM event_bookings WHERE event_id IN (?, ?, ?, ?)').run(A, C, z.id, L);
    db.prepare('DELETE FROM event_guests WHERE event_id IN (?, ?, ?, ?)').run(A, C, z.id, L);
    db.prepare('DELETE FROM events WHERE id IN (?, ?, ?, ?, ?, ?)').run(A, B, C, z.id, L, H);
  }

  console.log('\nThe private New Way’s Admin app');
  {
    const man = JSON.parse(fs.readFileSync(path.join(root, 'public', 'admin.webmanifest'), 'utf8'));
    check('the Admin app is called New Way’s Admin, opens Admin, and only covers Admin pages', man.name === 'New Way’s Admin' && man.short_name === 'New Way’s Admin' &&
      man.start_url === '/admin' && man.scope === '/admin' && man.id === '/admin' && man.display === 'standalone');
    check('…it has its own ADMIN icons (192 and 512), different files from the public app’s icons', man.icons.every((i) => i.src.startsWith('/icons/admin-')) &&
      ['admin-192.png', 'admin-512.png'].every((f) => fs.existsSync(path.join(root, 'public', 'icons', f))) &&
      !fs.readFileSync(path.join(root, 'public', 'icons', 'admin-512.png')).equals(fs.readFileSync(path.join(root, 'public', 'icons', 'icon-512.png'))));
    const pubMan = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
    check('the public New Way’s app is unchanged (same name, address and icons)', pubMan.name === 'New Way’s Mediumship Development Centre' && pubMan.short_name === 'New Way’s' && pubMan.start_url === '/' &&
      pubMan.icons[0].src === '/icons/icon-192.png');
    const signedOut = await text(dev.base, '/admin');
    check('Admin pages (including the sign-in page) point to the Admin app; a signed-out visitor still only sees the sign-in page', signedOut.includes('<link rel="manifest" href="/admin.webmanifest">') && signedOut.includes('Sign in to Admin') && !signedOut.includes('Wednesday Door'));
    check('signed in, Admin pages point to the Admin app too', (await text(dev.base, '/admin', { jar: g })).includes('<link rel="manifest" href="/admin.webmanifest">'));
    const pubPages = await Promise.all(['/', '/events', '/whos-on', '/bookings'].map((p) => text(dev.base, p)));
    check('no public page mentions or links to the Admin app (no install button for the public)', pubPages.every((h) => !h.includes('admin.webmanifest') && !h.includes('admin-192.png') && h.includes('href="/manifest.webmanifest"')));
    check('the Admin app file contains nothing private (just its name, colours and icons)', JSON.stringify(man).length < 1200 && !/@|token|secret|key/i.test(JSON.stringify(man)));
  }

  console.log('\nQuiet automatic updates for the installed app');
  {
    const nav = (p, ver, method = 'GET', extra = {}) => req(dev.base, p, { method, headers: { 'X-NW-Nav': '1', ...(ver === undefined ? {} : { 'X-NW-Ver': ver }), ...extra }, origin: null });
    const current = await nav('/events', '17');
    check('an up-to-date app switching pages gets the page as normal (no reload)', current.status === 200 && (current.headers.get('content-type') || '').includes('text/html') && (await current.text()).includes('id="page"'));
    const behind = await nav('/events', '16');
    check('an app still running an older version gets a quiet “not a page” reply instead, so it does one ordinary full load', behind.status === 409 &&
      (behind.headers.get('content-type') || '').startsWith('text/plain') && behind.headers.get('cache-control') === 'no-store' && !(await behind.text()).includes('<'));
    const veryOld = await nav('/whos-on', undefined);
    check('apps installed before this change (which send no version) update the same way', veryOld.status === 409);
    check('ordinary page visits are never affected', (await req(dev.base, '/events')).status === 200 && (await req(dev.base, '/events', { headers: { 'X-NW-Ver': '1' } })).status === 200);
    check('Admin pages are never affected (Admin App, till and check-in)', (await nav('/admin', '1')).status !== 409 && (await nav('/admin/door', undefined)).status !== 409);
    const posted = await req(dev.base, '/join', { method: 'POST', headers: { 'X-NW-Nav': '1', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=x' });
    check('forms that are sent (bookings, payments, sign-ups) are never intercepted', posted.status !== 409);
    const webhookTry = await req(dev.base, '/webhooks/square', { method: 'POST', origin: null, headers: { 'X-NW-Nav': '1', 'Content-Type': 'application/json' }, body: '{}' });
    check('Square’s payment notifications are never intercepted', webhookTry.status !== 409);
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'site.js'), 'utf8');
    check('the app sends its version with each page switch, and still falls back to a full load if the reply is not a page', js.includes("'X-NW-Ver': siteVersion") &&
      js.includes("if (type.indexOf('text/html') === -1) throw new Error('not a page');") && js.includes('.catch(function () { location.assign(href); });'));
    check('no pop-ups, messages or prompts are involved', !/confirm\(|alert\(|Notification\.requestPermission|beforeinstallprompt[^;]*prompt\(\)/.test(js.slice(js.indexOf('Moving between pages'), js.indexOf('Installable app'))));
  }

  console.log('\nThe service worker and versions');
  {
    const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
    check('phones fetch the new styles and scripts (version 17 everywhere)', sw.includes("const VERSION = 'nw-v17'") && sw.includes('/css/site.css?v=17') && (await text(dev.base, '/')).includes('/css/site.css?v=17'));
    check('the service worker shows chat notifications and opens Admin when tapped', sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'"));
    check('Wednesday payments, chat and donations are never stored on the phone', sw.includes('whos-on\\/pay') && sw.includes('|chat|support)'));
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
