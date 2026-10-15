// Automated tests for New Way's Community live comments: the Durable Object (hibernation, grouping, counting, safety
// limits), visitors' live connections, catching up, threading (including replies to replies), live moderation, the
// Admin View Live Comments page and its connection, Gary's and Julie's phone notifications (preferences, no duplicates,
// grouping), and that nothing here costs anything or weakens security.
// Run with: npm test, or on its own: node tests/live.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { connectWs } from './support/ws-client.mjs';
import { b64url } from '../src/lib/webpush.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const subtle = crypto.webcrypto.subtle;
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== '' ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function start(port, extra = {}) {
  const dbFile = path.join(root, 'dev', '.local', `live-${port}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: `http://localhost:${port}`, ...extra }, stdio: ['ignore', 'pipe', 'pipe']
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
let base = '';
async function req(p, { jar, method = 'GET', body, headers = {}, origin } = {}) {
  const h = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', ...headers };
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET' && origin !== null) h.Origin = origin || base;
  const res = await fetch(base + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}
const text = async (p, opts) => (await req(p, opts)).text();
async function signIn(who) {
  const jar = new Jar();
  const login = await req('/admin/login', { jar });
  const authPage = await (await fetch(login.headers.get('location'))).text();
  const link = (authPage.match(new RegExp(`id="as-${who}" href="([^"]+)"`)) || [])[1];
  const cb = new URL(link.replace(/&amp;/g, '&'));
  await req(cb.pathname + cb.search, { jar });
  return jar;
}
const csrfOf = async (jar) => jar.c.nw_csrf || (((await text('/admin', { jar })).match(/name="_csrf" value="([^"]+)"/) || [])[1]);
async function admin(jar, p, fields = {}, files = {}, headers = {}) {
  const fd = new FormData();
  fd.append('_csrf', await csrfOf(jar));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.buf], { type: f.type }), f.name);
  return req(p, { jar, method: 'POST', body: fd, headers });
}
const fix = (f) => fs.readFileSync(path.join(root, 'tests', 'fixtures', f));
const wsOpen = (p, extra = {}) => connectWs(base, p, { Origin: base, 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/129 Mobile', ...extra });
// Waits for the next update message that satisfies test(msg)
async function waitFor(ws, test, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const left = end - Date.now();
    if (left <= 0) return null;
    const m = await ws.nextJson(left);
    if (!m) return null;
    if (test(m)) return m;
  }
}
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
  return JSON.parse(new TextDecoder().decode(plain.subarray(0, end)));
}

const EXPECTED_CHECKS = 81;
const servers = [];
try {
  console.log('\nFree-plan set-up (checked in the files)');
  {
    const wr = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
    check('wrangler.jsonc adds one Durable Object, SQLite-backed (the only kind on the Workers Free plan)', /"durable_objects":\s*\{\s*"bindings":\s*\[\s*\{ "name": "COMMUNITY_LIVE", "class_name": "CommunityLive" \}/.test(wr) && /"new_sqlite_classes": \["CommunityLive"\]/.test(wr));
    check('no paid settings are added (no usage model, limits, Queues, KV, Workflows or containers)', !/usage_model|"limits"|"queues"|kv_namespaces|"workflows"|"containers"|"unsafe"/.test(wr));
    const doCode = fs.readFileSync(path.join(root, 'src', 'community', 'live-do.js'), 'utf8').replace(/\/\/.*$/gm, '');
    check('the Durable Object uses hibernation (acceptWebSocket) and answers pings without waking (auto-response)', /this\.ctx\.acceptWebSocket\(server/.test(doCode) && !/server\.accept\(\)/.test(doCode) && /setWebSocketAutoResponse\(new WebSocketRequestResponsePair\('ping', 'pong'\)\)/.test(doCode));
    check('…keeps nothing running between messages (no repeating timers or alarms) and never reads the website database', !/setInterval|setAlarm|env\.DB/.test(doCode) && (doCode.match(/setTimeout/g) || []).length === 1);
    const sql = fs.readFileSync(path.join(root, 'migrations', '0022_community_live.sql'), 'utf8').replace(/--.*$/gm, '');
    const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    check('database update 0022 is there (followed only by 0023, reservations and vouchers) and only adds', files.includes('0022_community_live.sql') && files.slice(files.indexOf('0022_community_live.sql') + 1).join() === '0023_reservations_and_gift_vouchers.sql' && !/(?:^|;)\s*(DROP|DELETE|UPDATE)\b/i.test(sql));
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'community.js'), 'utf8');
    check('phones never put comments in the page as code (no innerHTML of their own; the server escapes)', !/\.innerHTML\s*=(?!\s*text)/.test(js.replace(/t\.innerHTML = text/g, '')) && /function keepPlace/.test(js));
  }

  const dev = await start(8910); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn('owner');
  db.prepare(`INSERT INTO admin_users (email, name) VALUES ('julie.helper@example.test', 'Julie')`).run();
  const julieId = db.prepare(`SELECT id FROM admin_users WHERE name = 'Julie'`).get().id;
  const j = await signIn('julie');
  db.prepare(`INSERT INTO checkin_helpers (email, name) VALUES ('someone.else@example.test', 'Door helper')`).run();
  const helper = await signIn('other');

  // A published Designer card, and a draft
  const newCard = async () => Number(((await admin(g, '/admin/designer/new')).headers.get('location') || '').split('/').pop());
  const id = await newCard();
  const draft = await newCard();
  const design = db.prepare('SELECT design_json FROM community_posts WHERE id = ?').get(id).design_json;
  const pub = await (await admin(g, `/admin/designer/${id}/publish`, { design, medium_name: 'Jackie Thomson', title: 'Thank you, Jackie Thomson' },
    { art: { buf: fix('community-art-1733x910.jpg'), type: 'image/jpeg', name: 'a.jpg' }, share: { buf: fix('community-share-1200x630.jpg'), type: 'image/jpeg', name: 's.jpg' } }, { Accept: 'application/json' })).json();
  const cardPath = new URL(pub.link).pathname;
  const sock = `/community/${id}/socket`;

  console.log('\nWhen live connections are refused');
  {
    const off = await wsOpen(sock);
    check('while the Community is Off, no live connection is possible', off.status === 404);
    await admin(g, '/admin/community/launch', { state: 'testing' });
    const noOrigin = await connectWs(base, sock, {});
    const otherSite = await wsOpen(sock, { Origin: 'https://evil.example' });
    check('only this website’s own pages can open a live connection', noOrigin.status === 403 && otherSite.status === 403);
    check('drafts have no live connection', (await wsOpen(`/community/${draft}/socket`)).status === 404);
    check('a plain request (not a live connection) is refused', (await req(sock)).status === 426);
    const st = await (await fetch(base + '/__dev/live')).json();
    check('refused attempts never reach the Durable Object (no cost there)', st.length === 0 || st.every((r) => r.open === 0 && r.wakes === 0), st);
  }

  // Posting comments as a visitor
  const page = await text(cardPath);
  check('the card page is ready for live comments (version, state, conversation area)', new RegExp(`data-nwc-live="${id}" data-nwc-v="0" data-nwc-live-state="normal"`).test(page) && page.includes('data-nwc-conversation') && page.includes('/js/community.js?v=2'));
  const stamp = page.match(/name="t" value="([^"]+)"/)[1];
  await sleep(2700);
  let n = 0;
  const say = async (name, body, parent = '') => (await req(`/community/${id}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'CF-Connecting-IP': `10.${++n}.1.1` },
    body: new URLSearchParams({ t: stamp, website: '', vid: 'V' + String(n).padStart(23, '0'), 'cf-turnstile-response': TOKEN, name, text: body, parent: String(parent) }).toString() })).json();

  console.log('\nA visitor’s live connection');
  const a = await wsOpen(sock);
  const b = await wsOpen(sock);
  const hello = a.ws && await a.ws.nextJson();
  await b.ws.nextJson();
  check('a visitor connects and is told the current state', a.status === 101 && hello && hello.t === 'hello' && hello.v === 0 && hello.mode === 'normal' && hello.ping === 40, hello);
  a.ws.send('ping');
  check('keep-alive pings are answered', (await a.ws.next()) === 'pong');
  let first;
  {
    const r = await say('Ann', 'What a "wonderful" night & thank you <3');
    first = r.id;
    const ev = await waitFor(a.ws, (m) => m.t === 'ev');
    const add = ev && ev.list.find((e) => e.op === 'add');
    check('a new comment reaches everyone watching, straight away, with the next version number', add && add.id === r.id && add.v === 1 && add.parent === 0, ev);
    check('…already made safe on the server (quotes, & and < shown as text)', add && add.html.includes('&quot;wonderful&quot; night &amp; thank you &lt;3') && !add.html.includes('<3'));
    check('the poster gets it back at once too (no page reload needed)', r.ok && r.v === 1 && r.html && r.html.includes(`id="c${r.id}"`));
    check('the other phone gets it too', !!(await waitFor(b.ws, (m) => m.t === 'ev' && m.list.some((e) => e.id === r.id))));
  }
  let reply, rr;
  {
    const r = await say('Bob', 'I agree with Ann', first);
    reply = r.id;
    const ev = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'add'));
    const add = ev.list.find((e) => e.op === 'add');
    check('a reply arrives attached to its conversation', add.id === reply && add.parent === first && add.v === 2 && add.html.includes(`data-parent="${first}"`));
    const r2 = await say('Cath', 'Me too Bob!', reply);
    rr = r2.id;
    const ev2 = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'add' && e.id === rr));
    const add2 = ev2.list.find((e) => e.id === rr);
    check('a reply to a reply stays in the same conversation and says who it answers', add2.parent === first && add2.html.includes('↪ replying to Bob') && db.prepare('SELECT reply_to_id FROM community_comments WHERE id = ?').get(rr).reply_to_id === reply);
    const shown = await text(cardPath);
    check('…and the page shows the same order: comment, then replies oldest first', shown.indexOf(`id="c${first}"`) < shown.indexOf(`id="c${reply}"`) && shown.indexOf(`id="c${reply}"`) < shown.indexOf(`id="c${rr}"`) && shown.includes('↪ replying to Bob'));
  }
  {
    const spoof = await wsOpen(sock, { 'x-nwc-role': 'admin', 'x-nwc-limits': '{"daily":999999,"enabled":true}' });
    await spoof.ws.nextJson();
    const held = await say('Pat', 'This medium is a fake');
    const got = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'add'), 2500);
    check('a comment held for review is never sent to visitors', held.status === 'held' && !got && !held.html);
    check('a visitor pretending to be Admin (sending the internal headers) is still just a visitor', !(await waitFor(spoof.ws, (m) => m.t === 'changed', 1500)));
    spoof.ws.close();
  }
  {
    // Reactions: several quick taps reach the phones grouped into one message
    for (const [i, k] of [['W1', 'love'], ['W2', 'like'], ['W3', 'thanks']]) await req(`/community/${id}/react`, { method: 'POST', body: JSON.stringify({ kind: k, vid: i.padEnd(24, 'x') }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.77.0.' + i.slice(1) } });
    const ev = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'counts'));
    check('quick changes are grouped: three reactions arrive as one message', ev && ev.list.filter((e) => e.op === 'counts').length === 3 && ev.list[2].counts.love === 1 && ev.list[2].counts.like === 1, ev);
    await req(`/community/comment/${first}/like`, { method: 'POST', body: JSON.stringify({ vid: 'L'.repeat(24) }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.78.0.1' } });
    const lk = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'likes'));
    check('comment likes update live', lk && lk.list.find((e) => e.op === 'likes').likes === 1 && lk.list.find((e) => e.op === 'likes').id === first);
  }

  console.log('\nCatching up after being away');
  {
    const all = await (await req(`/community/${id}/live?v=0`)).json();
    check('a phone that missed things gets the whole published conversation (and the version)', all.v === 3 && all.total === 3 && all.html.includes(`id="c${first}"`) && all.html.includes(`id="c${rr}"`) && !all.html.includes('This medium is a fake') && all.counts.love === 1);
    const same = await (await req(`/community/${id}/live?v=3`)).json();
    check('a phone that is up to date gets a tiny answer', same.v === 3 && same.html === undefined && same.mode === 'normal');
    check('catching up has the same security rules (no cookies, nothing private)', !(await req(`/community/${id}/live?v=0`)).headers.get('set-cookie') && !all.html.includes('visitor_key') && !/V0000/.test(JSON.stringify(all)));
    check('drafts have no conversation to catch up on', (await req(`/community/${draft}/live?v=0`)).status === 404);
  }

  console.log('\nThe Durable Object sleeping (hibernation) loses nothing');
  {
    await fetch(base + '/__dev/live?hibernate=1');
    a.ws.send('ping');
    const pong = await a.ws.next();
    const st = (await (await fetch(base + '/__dev/live')).json())[0];
    check('while asleep, keep-alive pings are answered without waking it', pong === 'pong' && st.open >= 2 && st.wakes === 1, st);
    const r = await say('Dee', 'Lovely evening');
    const ev = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.id === r.id));
    const st2 = (await (await fetch(base + '/__dev/live')).json())[0];
    check('a new comment wakes it, connections are still there, and the version carries on', ev && ev.list.find((e) => e.id === r.id).v === 4 && st2.wakes === 2);
    const fresh = await wsOpen(sock);
    const h = await fresh.ws.nextJson();
    check('a phone connecting afterwards is told the right version (kept in its storage)', h.v === 4);
    fresh.ws.close();
  }

  console.log('\nLive moderation');
  let aj;
  {
    const ad = await wsOpen(`/admin/community/${id}/live-socket`, { Cookie: g.header() });
    aj = ad.ws;
    const h = await aj.nextJson();
    check('Gary’s View Live Comments page has its own live connection', ad.status === 101 && h.t === 'hello');
    const hide = await admin(g, `/admin/community/moderation/comment/${first}/hide`, { back: `/admin/community/${id}/view`, ajax: '1' });
    const ev = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'remove'));
    const rem = ev && ev.list.find((e) => e.op === 'remove');
    check('hiding a comment removes it (and its replies) for everyone watching', hide.status === 200 && rem && rem.ids.includes(first) && rem.ids.includes(reply) && rem.ids.includes(rr) && rem.v === 5, ev);
    check('…and Admin is told to refresh', !!(await waitFor(aj, (m) => m.t === 'changed')));
    await admin(g, `/admin/community/moderation/comment/${first}/approve`, { back: `/admin/community/${id}/view`, ajax: '1' });
    const ev2 = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'reload'));
    check('restoring a comment tells phones to fetch the conversation again (it comes back with its replies)', ev2 && ev2.list.find((e) => e.op === 'reload').v === 6 && (await (await req(`/community/${id}/live?v=5`)).json()).html.includes(`id="c${rr}"`));
    const del = db.prepare(`SELECT id FROM community_comments WHERE name = 'Dee'`).get().id;
    await admin(j, `/admin/community/moderation/comment/${del}/delete`, { back: `/admin/community/${id}/view`, ajax: '1' });
    const ev3 = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'remove'));
    check('Julie deleting a comment removes it live too', ev3 && ev3.list.find((e) => e.op === 'remove').ids.includes(del));
    const pat = await say('Sam', 'Is this medium a fraud');
    check('a new comment needing review tells Admin (not visitors)', pat.status === 'held' && !!(await waitFor(aj, (m) => m.t === 'changed')));
  }

  console.log('\nView Live Comments (Admin)');
  {
    const v = await text(`/admin/community/${id}/view`, { jar: g });
    check('the page shows the conversation, the review section and the live status', v.includes('Live comments: Thank you, Jackie Thomson') && v.includes('id="conversation"') && v.includes('id="review"') && v.includes('Needs your review (2)') && v.includes('data-nwc-admin-live') && v.includes('/js/community-live-admin.js?v=1'));
    check('it explains the public card button', v.includes('View Public Card</a>') && v.includes('Comments posted there are ordinary public comments, not verified Admin comments.'));
    check('there is a card switcher', v.includes('data-nwc-card-pick') && v.includes('action="/admin/community/go"'));
    const part = await req(`/admin/community/${id}/view?part=live`, { jar: g });
    const ph = await part.text();
    check('the live part can be fetched on its own (never cached), with replies in their threads', part.headers.get('cache-control') === 'no-store' && ph.startsWith('<div data-nwc-admin-region>') && ph.includes(`data-parent="${first}"`) && ph.includes('↪ replying to Bob') && !ph.includes('<html'));
    check('the review section shows why a comment is held, with Approve, Reject and Delete', /Why: [^<]+/.test(ph) && ph.includes('>Approve</button>') && ph.includes('>Reject</button>'));
    check('only Gary and Julie can open it or its live part', (await req(`/admin/community/${id}/view?part=live`)).status === 401 && (await req(`/admin/community/${id}/view?part=live`, { jar: helper })).status === 403);
    const noAuth = await wsOpen(`/admin/community/${id}/live-socket`);
    const helperWs = await wsOpen(`/admin/community/${id}/live-socket`, { Cookie: helper.header() });
    const evilWs = await wsOpen(`/admin/community/${id}/live-socket`, { Cookie: g.header(), Origin: 'https://evil.example' });
    check('the Admin live connection needs Gary’s or Julie’s sign-in, and can’t be opened from another website', noAuth.status === 401 && helperWs.status === 403 && evilWs.status === 403, [noAuth.status, helperWs.status, evilWs.status].join(' '));
    check('Admin › Community cards has View Live Comments and View Public Card under each published card', (await text('/admin/community', { jar: g })).includes(`href="/admin/community/${id}/view">View Live Comments</a>`));
    check('/admin/community/live opens the newest card', (await req('/admin/community/live', { jar: g })).headers.get('location') === `/admin/community/${id}/view`);
    check('the Designer offers View Live Comments too', (await text(`/admin/designer/${id}`, { jar: g })).includes('>View Live Comments</a>'));
    // Official replies, to a comment and to a reply
    await admin(g, '/admin/community/official/gary/on');
    const off = await (await admin(g, `/admin/community/${id}/official-comment`, { text: 'Thank you Bob!', parent: String(reply) }, {}, { Accept: 'application/json' })).json();
    const ev = await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'add' && e.id === off.id));
    const add = ev && ev.list.find((e) => e.id === off.id);
    check('an official reply to a reply appears live, green and verified, in the right conversation', off.ok && add && add.parent === first && add.html.includes('nwc-official') && add.html.includes('Admin Gary') && add.html.includes('↪ replying to Bob'));
  }

  console.log('\nGary’s and Julie’s phone notifications');
  {
    const phone = async (who, label) => {
      const keys = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const auth = crypto.randomBytes(16);
      db.prepare(`INSERT INTO push_subscriptions (who, label, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)`).run(who, label, `${dev.mock}/__push/send/${label}`, b64url(await subtle.exportKey('raw', keys.publicKey)), b64url(auth));
      return { keys, auth, label };
    };
    const gp = await phone('owner', 'garyphone'), jp = await phone('admin:' + julieId, 'juliephone');
    const pushes = async (ph) => {
      const all = (await (await fetch(dev.mock + '/__push/state')).json()).filter((p) => p.id === ph.label);
      return Promise.all(all.map((p) => decryptPush(p.body, ph.keys, ph.auth)));
    };
    await admin(j, '/admin/community/alerts', { mode: 'review', show_text: '1' });
    check('each person saves their own choice (Julie: only reviews)', db.prepare(`SELECT mode FROM community_admin_prefs WHERE who = ?`).get('admin:' + julieId).mode === 'review' && !db.prepare(`SELECT 1 FROM community_admin_prefs WHERE who = 'owner'`).get());
    const c1 = await say('Eve', 'Thank you Jackie, so comforting');
    await sleep(400);
    let gpush = await pushes(gp);
    check('Gary gets a notification for a new comment, with the card, name and words, opening that conversation in Admin', gpush.length === 1 && gpush[0].title === 'New comment · Thank you, Jackie Thomson' && gpush[0].body.includes('Eve: “Thank you Jackie, so comforting”') && gpush[0].url === `/admin/community/${id}/view#c${c1.id}` && gpush[0].tag === 'nwc-' + id, gpush);
    check('Julie (reviews only) gets nothing for it', (await pushes(jp)).length === 0);
    await say('Fay', 'Brilliant night');
    await say('Gus', 'Can’t wait for next week');
    await sleep(400);
    check('more comments within 2 minutes don’t buzz again (they are counted)', (await pushes(gp)).length === 1 && db.prepare(`SELECT pending FROM community_alerts WHERE who = 'owner' AND post_id = ?`).get(id).pending === 2);
    db.prepare(`UPDATE community_alerts SET last_sent_at = '2000-01-01T00:00:00.000Z' WHERE who = 'owner'`).run();
    await fetch(base + '/__dev/cron?cron=' + encodeURIComponent('7 * * * *'));
    gpush = await pushes(gp);
    check('…then one summary: “2 more comments”', gpush.length === 2 && gpush[1].title === '2 more comments' && gpush[1].body === 'Thank you, Jackie Thomson', gpush[1]);
    await fetch(base + '/__dev/cron?cron=' + encodeURIComponent('7 * * * *'));
    check('…sent only once', (await pushes(gp)).length === 2);
    const heldC = await say('Hal', 'Scam medium, avoid');
    await sleep(400);
    const jpush = await pushes(jp);
    check('a comment waiting for review notifies both (Julie too), opening the review section', heldC.status === 'held' && jpush.length === 1 && jpush[0].title === 'Comment waiting for review' && jpush[0].url === `/admin/community/${id}/view#review` && (await pushes(gp)).some((p) => p.title === 'Comment waiting for review'));
    await admin(g, '/admin/community/alerts', { mode: 'all' });   // show_text unticked
    db.prepare(`UPDATE community_alerts SET last_sent_at = '2000-01-01T00:00:00.000Z', pending = 0 WHERE who = 'owner'`).run();
    await say('Ivy', 'Private words here');
    await sleep(400);
    gpush = await pushes(gp);
    check('with “show words” off, the lock screen shows no name or words', !gpush[gpush.length - 1].body.includes('Private words') && !gpush[gpush.length - 1].body.includes('Ivy'), gpush[gpush.length - 1]);
    const before = (await pushes(gp)).length;
    db.prepare(`UPDATE community_alerts SET last_sent_at = '2000-01-01T00:00:00.000Z', pending = 0`).run();
    await admin(g, `/admin/community/${id}/official-comment`, { text: 'Thank you all' }, {}, { Accept: 'application/json' });
    await sleep(400);
    check('official comments by Gary or Julie never notify anyone', (await pushes(gp)).length === before);
    await text(`/admin/community/${id}/view`, { jar: g });
    check('opening View Live Comments counts as seen (nothing left to sum up)', !db.prepare(`SELECT 1 FROM community_alerts WHERE who = 'owner' AND post_id = ? AND pending > 0`).get(id));
    check('choices can’t be changed for someone else (each saves only their own)', (await admin(helper, '/admin/community/alerts', { mode: 'off' })).status === 403);
    check('no email is ever sent for comments', !fs.readFileSync(path.join(root, 'src', 'community', 'alerts.js'), 'utf8').includes('sendEmail'));
  }

  console.log('\nFallback checking (phones that can’t connect live)');
  {
    db.exec(`UPDATE community_config SET value = '3' WHERE key = 'live_fallback_daily'`);
    db.exec(`INSERT OR IGNORE INTO community_config (key, value) VALUES ('live_fallback_daily', '3')`);
    const got = [];
    for (let i = 0; i < 5; i++) got.push((await (await req(`/community/${id}/live?v=0&why=fallback`)).json()).mode);
    check('fallback checks are counted and stop at the daily limit (then “paused”)', got.slice(0, 3).every((m) => m === 'normal') && got[3] === 'paused' && got[4] === 'paused', got);
    check('catching up after reconnecting is never blocked', !!(await (await req(`/community/${id}/live?v=0`)).json()).html);
    db.exec(`UPDATE community_config SET value = '5000' WHERE key = 'live_fallback_daily'`);
  }

  console.log('\nSafety limits');
  {
    db.exec(`INSERT INTO community_config (key, value) VALUES ('live_per_card', '10') ON CONFLICT(key) DO UPDATE SET value = '10'`);
    const extra = [];
    let full = null;
    for (let i = 0; i < 12; i++) { const r = await wsOpen(sock); if (r.status === 101) extra.push(r.ws); else { full = r; break; } }
    const pausedDay = db.prepare(`SELECT value FROM community_config WHERE key = 'live_paused_day'`).get();
    check('a card with the most phones allowed refuses more (they check every minute instead), without pausing the day', full && full.status === 503 && JSON.parse(full.body).state === 'full' && (!pausedDay || !pausedDay.value), full);
    extra.forEach((w) => w.close());
    db.exec(`UPDATE community_config SET value = '1500' WHERE key = 'live_per_card'`);
    await sleep(200);
    // Daily limit: the smallest allowed is 100
    db.exec(`INSERT INTO community_config (key, value) VALUES ('live_daily', '100') ON CONFLICT(key) DO UPDATE SET value = '100'`);
    const usage = await (await fetch(base + '/__dev/live')).json();
    let refused = null, tries = 0;
    while (!refused && tries++ < 120) { const r = await wsOpen(sock); if (r.status === 101) r.ws.close(); else refused = r; }
    const today = new Date().toISOString().slice(0, 10);
    check('at the daily limit, new live connections are refused and the day is marked as paused', refused && refused.status === 503 && db.prepare(`SELECT value FROM community_config WHERE key = 'live_paused_day'`).get().value === today, refused);
    const stBefore = (await (await fetch(base + '/__dev/live')).json())[0];
    const again = await wsOpen(sock);
    const stAfter = (await (await fetch(base + '/__dev/live')).json())[0];
    check('after that, attempts are refused by the website without reaching the Durable Object', again.status === 503 && stAfter.wakes === stBefore.wakes && stAfter.writes === stBefore.writes, [stBefore, stAfter]);
    const pg = await text(cardPath);
    check('visitors can still view the card and its comments; the page says live updates are paused', pg.includes('data-nwc-live-state="paused"') && pg.includes(`id="c${first}"`));
    check('catching up tells phones it is paused', (await (await req(`/community/${id}/live?v=0`)).json()).mode === 'paused');
    const r = await say('Jo', 'Still here');
    check('phones already connected keep receiving comments (sending costs nothing)', !!(await waitFor(a.ws, (m) => m.t === 'ev' && m.list.some((e) => e.id === r.id))));
    const ad2 = await wsOpen(`/admin/community/${id}/live-socket`, { Cookie: g.header() });
    check('Gary and Julie can still connect in Admin', ad2.status === 101);
    await sleep(300);
    const pushes = (await (await fetch(dev.mock + '/__push/state')).json()).filter((p) => p.id === 'garyphone').length;
    await wsOpen(sock); await sleep(300);
    check('Gary and Julie are told once that it paused', db.prepare(`SELECT value FROM community_config WHERE key = 'live_alerted_day'`).get().value === today && (await (await fetch(dev.mock + '/__push/state')).json()).filter((p) => p.id === 'garyphone').length === pushes);
    const lp = await text('/admin/community/launch', { jar: g });
    check('the launch page shows today’s exact live figures and what can’t be measured', lp.includes('Live connections today') && lp.includes('Connected right now') && lp.includes('Cloudflare’s total for the whole website') && lp.includes('Today’s live connection limit was reached'));
    check('a limit outside its range is refused', (await admin(g, '/admin/community/live-settings', { live_enabled: '1', live_daily: '5', live_reduce: '70', live_per_card: '1500', live_total: '4000', live_fallback_daily: '5000', live_fallback_secs: '60' })).headers.get('location').includes('live-range'));
    await admin(g, '/admin/community/live-settings', { live_enabled: '1', live_daily: '20000', live_reduce: '70', live_per_card: '1500', live_total: '4000', live_fallback_daily: '5000', live_fallback_secs: '60' });
    await admin(g, '/admin/community/live-resume');
    const back = await wsOpen(sock);
    check('raising the limit and resuming works straight away, without a new upload', back.status === 101 && db.prepare(`SELECT value FROM community_config WHERE key = 'live_daily'`).get().value === '20000');
    back.ws && back.ws.close();
    check('only Gary and Julie can change the safety settings', (await admin(helper, '/admin/community/live-settings', { live_daily: '80000' })).status === 403 && (await admin(helper, '/admin/community/live-resume')).status === 403);
    await admin(g, '/admin/community/live-settings', { live_enabled: '0', live_daily: '20000', live_reduce: '70', live_per_card: '1500', live_total: '4000', live_fallback_daily: '5000', live_fallback_secs: '60' });
    check('switching live updates off: no new connections, the page offers Refresh comments', (await wsOpen(sock)).status === 503 && (await text(cardPath)).includes('data-nwc-live-state="off"'));
    await admin(g, '/admin/community/live-settings', { live_enabled: '1', live_daily: '15000', live_reduce: '70', live_per_card: '1500', live_total: '4000', live_fallback_daily: '5000', live_fallback_secs: '60' });
  }

  console.log('\nA card taken down, and the Community switched off');
  {
    const conn = await wsOpen(sock);
    await conn.ws.nextJson();
    await admin(g, `/admin/community/${id}/unpublish`);
    const gone = await waitFor(conn.ws, (m) => m.t === 'ev' && m.list.some((e) => e.op === 'gone'));
    check('phones watching a card that is taken down are told and disconnected', !!gone && (await conn.ws.closed()) === 4004);
    check('it no longer has a live connection or conversation', (await wsOpen(sock)).status === 404 && (await req(`/community/${id}/live?v=0`)).status === 404);
    await admin(g, '/admin/community/launch', { state: 'off' });
    check('with the Community Off, catching up and connecting are refused', (await req(`/community/${draft}/live?v=0`)).status === 404 && (await wsOpen(`/community/${draft}/socket`)).status === 404);
  }
  a.ws.close(); b.ws.close(); aj.close();

  console.log('\nWithout the live service (the website still works)');
  {
    const plain = await start(8911, { NO_LIVE: '1' }); servers.push(plain);
    base = plain.base;
    const db2 = new DatabaseSync(plain.dbFile);
    const g2 = await signIn('owner');
    await admin(g2, '/admin/community/launch', { state: 'testing' });
    const cid = Number(((await admin(g2, '/admin/designer/new')).headers.get('location') || '').split('/').pop());
    const d2 = db2.prepare('SELECT design_json FROM community_posts WHERE id = ?').get(cid).design_json;
    const p2 = await (await admin(g2, `/admin/designer/${cid}/publish`, { design: d2, title: 'Thank you' },
      { art: { buf: fix('community-art-1733x910.jpg'), type: 'image/jpeg', name: 'a.jpg' }, share: { buf: fix('community-share-1200x630.jpg'), type: 'image/jpeg', name: 's.jpg' } }, { Accept: 'application/json' })).json();
    const pg = await text(new URL(p2.link).pathname);
    const s2 = await wsOpen(`/community/${cid}/socket`);
    check('if live connections are ever unavailable, cards and comments still work and phones fall back', pg.includes('nwc-comments') && s2.status === 503 && !!(await (await req(`/community/${cid}/live`)).json()).html, [pg.includes('nwc-comments'), s2.status, p2.link]);
    check('Admin says so plainly', (await text('/admin/community/launch', { jar: g2 })).includes('Live updates aren’t available on this copy of the website'));
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
