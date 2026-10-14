// Security review of New Way's Community (14 October 2026): an ordinary public visitor, a signed-out browser and a
// signed-in check-in helper each try every protected operation directly (no buttons, just the addresses), plus forged
// requests, script and SQL injection, uploads, the launch switch, drafts, notifications and what public responses reveal.
// Every unauthorised attempt must fail AND change nothing.
// Run with: npm test, or on its own: node tests/security.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { cleanSubscription } from '../src/community/push.js';
import { cleanDesign } from '../src/admin/designer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 500) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `security-${port}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: `http://localhost:${port}` }, stdio: ['ignore', 'pipe', 'pipe']
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
async function admin(jar, p, fields = {}, files = {}, headers = {}, { csrf = true } = {}) {
  const fd = new FormData();
  if (csrf) fd.append('_csrf', jar ? await csrfOf(jar) : 'x');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.buf], { type: f.type }), f.name);
  return req(p, { jar, method: 'POST', body: fd, headers });
}
const fix = (f) => fs.readFileSync(path.join(root, 'tests', 'fixtures', f));

const EXPECTED_CHECKS = 56;
const servers = [];
try {
  console.log('\nDatabase update 0021');
  {
    const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const sql = fs.readFileSync(path.join(root, 'migrations', '0021_community_report_networks.sql'), 'utf8').replace(/--.*$/gm, '').trim();
    check('0021 is the newest update and only adds one column to community_reports', files[files.length - 1] === '0021_community_report_networks.sql' &&
      sql === `ALTER TABLE community_reports ADD COLUMN reporter_net TEXT NOT NULL DEFAULT '';`);
  }

  const dev = await start(8920); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn('owner');
  db.prepare(`INSERT INTO checkin_helpers (email, name) VALUES ('someone.else@example.test', 'Door helper')`).run();
  const helper = await signIn('other');

  // Things to attack: a draft and a published Designer card, a library picture, a template, a comment
  const draftId = Number(((await admin(g, '/admin/designer/new')).headers.get('location') || '').split('/').pop());
  const pubId = Number(((await admin(g, '/admin/designer/new')).headers.get('location') || '').split('/').pop());
  const design = db.prepare('SELECT design_json FROM community_posts WHERE id = ?').get(pubId).design_json;
  const art = { buf: fix('community-art-1733x910.jpg'), type: 'image/jpeg', name: 'art.jpg' };
  const share = { buf: fix('community-share-1200x630.jpg'), type: 'image/jpeg', name: 'share.jpg' };
  const pj = await (await admin(g, `/admin/designer/${pubId}/publish`, { design, medium_name: 'Jane Smith', title: 'Thank you, Jane Smith' }, { art, share }, { Accept: 'application/json' })).json();
  await admin(g, '/admin/designer/library/upload', { kind: 'sticker', name: 'Gold' }, { image: { buf: fix('community-sticker.png'), type: 'image/png', name: 's.png' } }, { Accept: 'application/json' });
  await admin(g, `/admin/designer/${pubId}/template`, { design, name: 'T1' }, {}, { Accept: 'application/json' });
  db.prepare(`INSERT INTO community_comments (post_id, name, body, status, visitor_key) VALUES (?, 'Jean', 'Lovely night', 'held', 'vabc')`).run(pubId);
  const heldId = db.prepare(`SELECT id FROM community_comments WHERE name = 'Jean'`).get().id;
  const libId = db.prepare('SELECT id FROM community_library').get().id;
  const tplId = db.prepare('SELECT id FROM community_templates').get().id;
  const cardPath = new URL(pj.link).pathname;

  // A fingerprint of everything that matters, to prove that refused attempts changed nothing
  const TABLES = ['community_posts', 'community_comments', 'community_library', 'community_templates', 'community_config', 'community_sends', 'community_deliveries',
    'community_words', 'community_visitors', 'community_reactions', 'media', 'settings', 'admin_users', 'checkin_helpers', 'bookings', 'orders', 'content_blocks'];
  const existing = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
  const snapshot = () => JSON.stringify(TABLES.filter((t) => existing.has(t)).map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
  check('the fixtures for the attacks were made', pj.ok && draftId > 0 && pubId > draftId && libId && tplId && heldId);

  // Every protected address: [method, path]. POSTs are sent as forms (with a token where the attacker could get one).
  const P = (p) => ['POST', p], G = (p) => ['GET', p];
  const PROTECTED = [
    G('/admin'), G('/admin/designer'), P('/admin/designer/new'), G(`/admin/designer/${draftId}`), P(`/admin/designer/${draftId}/save`), P(`/admin/designer/${draftId}/publish`),
    P(`/admin/designer/${draftId}/delete`), P(`/admin/designer/${pubId}/template`), G('/admin/designer/library'), G('/admin/designer/library.json'), P('/admin/designer/library/upload'),
    P(`/admin/designer/library/${libId}/delete`), P(`/admin/designer/library/${libId}/edit`), P(`/admin/designer/templates/${tplId}/delete`),
    G('/admin/community'), P('/admin/community/new'), G(`/admin/community/${pubId}/view`), P(`/admin/community/${pubId}/unpublish`), G('/admin/community/preview'),
    G('/admin/community/moderation'), P(`/admin/community/moderation/comment/${heldId}/approve`), P(`/admin/community/moderation/comment/${heldId}/delete`),
    G('/admin/community/moderation/words'), P('/admin/community/moderation/words/add'), G('/admin/community/moderation/test'), G('/admin/community/moderation/visitors'),
    G('/admin/community/launch'), P('/admin/community/launch'), P('/admin/community/official/gary/on'), P('/admin/community/official/julie/on'),
    G('/admin/community/stats'), P(`/admin/community/${pubId}/official-comment`), P(`/admin/community/${pubId}/notify`), P(`/admin/community/${pubId}/notify/batch`),
    G('/admin/bookings'), G('/admin/orders'), G('/admin/door'), G('/admin/settings'), G('/admin/team'), G('/admin/chat'), G('/admin/backups/download'), G('/admin/status'), G('/admin/readings')
  ];
  const evil = { state: 'live', text: 'Hacked', name: 'Admin Gary', design, medium_name: 'x', kind: 'photo', phrase: 'lovely', action: 'block' };
  const pngFile = { image: { buf: fix('community-sticker.png'), type: 'image/png', name: 'x.png' }, art, share };

  console.log('\nA signed-out visitor calling every Admin address directly');
  {
    const before = snapshot();
    const bad = [];
    for (const [method, p] of PROTECTED) {
      const r = method === 'GET' ? await req(p) : await admin(null, p, evil, pngFile, { Accept: 'application/json' });
      const body = await r.text();
      if (!(r.status === 401 || r.status === 403) || body.includes('name="_csrf"') || body.includes('Jane Smith') || body.includes('"items"')) bad.push(`${method} ${p} -> ${r.status}`);
    }
    check(`all ${PROTECTED.length} Admin addresses refuse a signed-out visitor (401 or 403, nothing private in the reply)`, bad.length === 0, bad.join(', '));
    check('…and nothing in the database changed', snapshot() === before);
  }

  console.log('\nA signed-in check-in helper (lower permission) trying Gary and Julie’s actions');
  {
    const before = snapshot();
    const bad = [];
    for (const [method, p] of PROTECTED) {
      const r = method === 'GET' ? await req(p, { jar: helper }) : await admin(helper, p, evil, pngFile, { Accept: 'application/json' });
      const ok = p === '/admin' ? [302, 303].includes(r.status) && r.headers.get('location') === '/admin/checkin' : r.status === 403;
      if (!ok) bad.push(`${method} ${p} -> ${r.status}`);
    }
    check(`all ${PROTECTED.length} addresses refuse a check-in helper (403; /admin goes to check-in)`, bad.length === 0, bad.join(', '));
    check('…and nothing in the database changed', snapshot() === before);
    check('a helper still has their own check-in page', (await req('/admin/checkin', { jar: helper })).status === 200);
  }

  console.log('\nForged requests against a signed-in Admin (cross-site request forgery)');
  {
    const before = snapshot();
    const noToken = await admin(g, '/admin/community/launch', { state: 'live' }, {}, {}, { csrf: false });
    const wrongToken = await req('/admin/community/launch', { jar: g, method: 'POST', body: new URLSearchParams({ _csrf: 'forged', state: 'live' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const fd = new FormData(); fd.append('_csrf', await csrfOf(g)); fd.append('state', 'live');
    const otherSite = await req('/admin/community/launch', { jar: g, method: 'POST', body: fd, origin: 'https://evil.example' });
    check('changing the launch setting without the page’s token, with a wrong token, or from another website is refused',
      noToken.status === 403 && wrongToken.status === 403 && otherSite.status === 403, [noToken.status, wrongToken.status, otherSite.status].join(' '));
    const n1 = await admin(g, `/admin/community/${pubId}/notify`, {}, {}, {}, { csrf: false });
    const p1 = await admin(g, `/admin/designer/${draftId}/publish`, { design }, { art, share }, {}, { csrf: false });
    const d1 = await admin(g, `/admin/designer/${draftId}/delete`, {}, {}, {}, { csrf: false });
    check('sending a notification, publishing or deleting without the token is refused', n1.status === 403 && p1.status === 403 && d1.status === 403);
    check('…and nothing changed (still Off, nothing published or sent)', snapshot() === before && db.prepare(`SELECT value FROM community_config WHERE key = 'launch'`).get().value === 'off');
    const viaGet = await req('/admin/community/official/gary/on', { jar: g });
    check('a plain link (GET) can never change anything', viaGet.status === 302 || viaGet.status === 303 ? db.prepare(`SELECT value FROM community_config WHERE key = 'official_gary'`).get().value === '0' : false);
  }

  console.log('\nThe launch switch: Off really means off');
  {
    const tries = [
      ['GET', '/community'], ['GET', cardPath], ['GET', `/community/${pubId}`], ['GET', '/community/push/key'],
      ['POST', `/community/${pubId}/react`], ['POST', `/community/${pubId}/comment`], ['POST', '/community/comment/1/like'], ['POST', '/community/comment/1/report'],
      ['POST', '/community/push/subscribe'], ['POST', '/community/push/status']
    ];
    const bad = [];
    for (const [m, p] of tries) {
      const r = await req(p, { method: m, body: m === 'POST' ? JSON.stringify({ kind: 'like', vid: 'A'.repeat(24) }) : undefined, headers: m === 'POST' ? { 'Content-Type': 'application/json' } : {} });
      if (![403, 404].includes(r.status)) bad.push(`${m} ${p} -> ${r.status}`);
    }
    check('while Off, every Community page, card link and request is refused', bad.length === 0, bad.join(', '));
    check('…with nothing stored', !db.prepare('SELECT 1 FROM community_reactions').get());
    check('…and Off is the starting setting', db.prepare(`SELECT value FROM community_config WHERE key = 'launch'`).get().value === 'off');
  }

  await admin(g, '/admin/community/launch', { state: 'testing' });

  console.log('\nDrafts and unpublished cards are never public');
  {
    const r1 = await req(`/community/${draftId}`), r2 = await req(`/community/${draftId}-thank-you-test-first-medium`);
    check('a draft can’t be seen by guessing its address', r1.status === 404 && r2.status === 404);
    check('a draft can’t be reacted to or commented on', (await req(`/community/${draftId}/react`, { method: 'POST', body: JSON.stringify({ kind: 'love', vid: 'B'.repeat(24) }), headers: { 'Content-Type': 'application/json' } })).status === 404);
    const list = await text('/community');
    check('drafts aren’t listed on the Community page', !list.includes(`/community/${draftId}-`) && list.includes(cardPath));
    check('publishing never sent a notification by itself', !db.prepare('SELECT 1 FROM community_sends').get());
  }

  console.log('\nScripts, HTML and SQL in visitors’ comments');
  {
    const page = await text(cardPath);
    const stamp = page.match(/name="t" value="([^"]+)"/)[1];
    await sleep(2700);
    let n = 0;
    const post = (name, body, extra = {}) => req(`/community/${pubId}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'CF-Connecting-IP': `10.${++n}.0.1` },
      body: new URLSearchParams({ t: stamp, website: '', vid: 'V' + String(n).padStart(23, '0'), 'cf-turnstile-response': TOKEN, name, text: body, ...extra }).toString() });
    const s1 = await post('Ann', '<script>alert(1)</script> lovely');
    const s2 = await post('<img src=x onerror=alert(1)>', 'Lovely night');
    const s3 = await post('Bob', 'Great <a href="javascript:alert(1)">night</a>');
    check('script, picture and link code is blocked in comments and names', s1.status === 422 && s2.status === 422 && s3.status === 422, [s1.status, s2.status, s3.status].join(' '));
    const sql1 = await post("Rob'); DROP TABLE community_comments;--", 'What a lovely evening');
    const sql2 = await post('Tess', "Brilliant' OR '1'='1'; DELETE FROM bookings; --");
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('community_comments', 'bookings', 'admin_users')`).all().length;
    check('SQL typed into a name or comment is only ever stored or refused as text (tables intact)', tables === 3 && [200, 422].includes(sql1.status) && [200, 422].includes(sql2.status));
    const stored = db.prepare(`SELECT body FROM community_comments WHERE body LIKE '%DELETE FROM bookings%' OR name LIKE '%DROP TABLE%'`).all();
    const shown = await text(cardPath);
    check('whatever is stored is shown as plain text, never as page code', !/<script>alert|onerror=alert|href="javascript:/i.test(shown) && stored.every((r) => !shown.includes(r.body) || shown.includes(r.body.replace(/'/g, '&#39;')) || !r.body.includes("'")));
    const weird = await req(`/community/${pubId}/react`, { method: 'POST', body: JSON.stringify({ kind: "like' OR 1=1 --", vid: "x'; DROP TABLE community_reactions; --" }), headers: { 'Content-Type': 'application/json' } });
    check('odd values in reactions are refused and the visitor code can’t be chosen by the visitor', weird.status === 400 && existing.has('community_reactions') && !!db.prepare(`SELECT name FROM sqlite_master WHERE name = 'community_reactions'`).get());
    const okR = await (await req(`/community/${pubId}/react`, { method: 'POST', body: JSON.stringify({ kind: 'love', vid: "x'; DROP TABLE x; --" }), headers: { 'Content-Type': 'application/json' } })).json();
    check('…a made-up visitor code is turned into a scrambled code by the server', okR.ok && db.prepare('SELECT visitor_key FROM community_reactions').all().every((r) => /^v[0-9a-f]{24}$/.test(r.visitor_key)));
    const imp = await post('Admin Julie', 'Hello everyone');
    const imp2 = await post('New Way’s', 'Free readings tonight');
    check('nobody can comment as Admin Julie or New Way’s', imp.status === 422 && imp2.status === 422);
    const garyBadge = (await text(cardPath)).match(/class="nwc-official"/g);
    check('no visitor comment ever gets the green verified badge', !garyBadge && !db.prepare(`SELECT 1 FROM community_comments WHERE official != '' AND admin_user_id IS NULL AND approved_by IS NULL`).get());
  }

  console.log('\nOversized, unexpected and malformed requests');
  {
    const big = 'x'.repeat(40000);
    const r1 = await req(`/community/${pubId}/react`, { method: 'POST', body: JSON.stringify({ kind: 'like', pad: big }), headers: { 'Content-Type': 'application/json' } });
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode('x'.repeat(4000))); c.close(); } });
    const r2 = await fetch(base + `/community/${pubId}/react`, { method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Type': 'application/json', Origin: base } });
    check('large requests are refused, even without a stated size', r1.status === 413 && r2.status === 413, `${r1.status} ${r2.status}`);
    const fd = new FormData(); fd.append('image', new Blob([fix('community-sticker.png')], { type: 'image/png' }), 'x.png'); fd.append('kind', 'like');
    const r3 = await req(`/community/${pubId}/react`, { method: 'POST', body: fd });
    check('files can’t be sent to any public Community address', r3.status === 415);
    const r4 = await req(`/community/${pubId}/react`, { method: 'POST', body: '{"kind":', headers: { 'Content-Type': 'application/json' } });
    const j4 = await r4.text();
    check('broken requests get a short, plain answer (no internal details)', r4.status === 400 && j4 === '{"ok":false,"message":"Please try again."}');
    const noOrigin = await req(`/community/${pubId}/react`, { method: 'POST', origin: null, body: JSON.stringify({ kind: 'like' }), headers: { 'Content-Type': 'application/json' } });
    check('requests from other websites (or with no origin) are refused', noOrigin.status === 403 && (await req(`/community/${pubId}/react`, { method: 'POST', origin: 'https://evil.example', body: '{}', headers: { 'Content-Type': 'application/json' } })).status === 403);
    check('Community addresses can’t be used to reach anything else', (await req('/community/../admin/bookings')).status !== 200 && (await req('/community/%2e%2e/admin/settings')).status !== 200 && (await req(`/community/${pubId}/react/../../admin`)).status !== 200);
  }

  console.log('\nExcessive reactions, likes and reports');
  {
    const ip = { 'CF-Connecting-IP': '10.200.0.5' };
    let limited = 0;
    for (let i = 0; i < 18; i++) {
      const r = await req(`/community/${pubId}/react`, { method: 'POST', body: JSON.stringify({ kind: 'thanks', vid: 'R' + String(i).padStart(23, '0') }), headers: { 'Content-Type': 'application/json', ...ip } });
      if (r.status === 429) limited++;
    }
    const thanks = db.prepare(`SELECT COUNT(*) AS n FROM community_reactions WHERE post_id = ? AND kind = 'thanks'`).get(pubId).n;
    check('one connection changing its browser code can add only a few reactions to a card', limited > 0 && thanks <= 15, `limited ${limited}, thanks ${thanks}`);
    db.prepare(`INSERT INTO community_comments (post_id, name, body, status, visitor_key) VALUES (?, 'Lily', 'Lovely evening', 'published', 'vlily')`).run(pubId);
    const lily = db.prepare(`SELECT id FROM community_comments WHERE name = 'Lily'`).get().id;
    let lk = 0;
    for (let i = 0; i < 14; i++) {
      const r = await req(`/community/comment/${lily}/like`, { method: 'POST', body: JSON.stringify({ vid: 'L' + String(i).padStart(23, '0') }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.201.0.5' } });
      if (r.status === 429) lk++;
    }
    check('…and only a few likes to a comment', lk > 0 && db.prepare('SELECT like_count FROM community_comments WHERE id = ?').get(lily).like_count <= 10);
    for (let i = 0; i < 5; i++) await req(`/community/comment/${lily}/report`, { method: 'POST', body: JSON.stringify({ vid: 'P' + String(i).padStart(23, '0') }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.202.0.' + (i + 1) } });
    check('one person reporting 5 times with different browser codes from one network can’t hide a comment', db.prepare('SELECT status FROM community_comments WHERE id = ?').get(lily).status === 'published');
    check('…but Gary and Julie can see those reports', db.prepare('SELECT report_count FROM community_comments WHERE id = ?').get(lily).report_count >= 5);
  }

  console.log('\nUploads (Admin only) and stored pictures');
  {
    const tries = [
      ['an SVG with script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/svg+xml', 'x.svg'],
      ['an HTML page named .png', Buffer.from('<!doctype html><script>alert(1)</script>'), 'image/png', 'x.png'],
      ['a program file', Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), 'application/octet-stream', 'x.exe'],
      ['a script named .jpg', Buffer.from('alert(1)'), 'image/jpeg', '../../public/js/site.js']
    ];
    const bad = [];
    for (const [label, buf, type, name] of tries) {
      const r = await admin(g, '/admin/designer/library/upload', { kind: 'photo' }, { image: { buf, type, name } }, { Accept: 'application/json' });
      if (r.status !== 400) bad.push(label + ' -> ' + r.status);
    }
    check('even Gary can only upload real JPEG, PNG or WebP pictures (SVG, HTML, programs and scripts are refused)', bad.length === 0, bad.join(', '));
    const keys = db.prepare('SELECT key FROM media').all().map((r) => r.key);
    check('stored pictures get a random name chosen by the server, in the picture area only (never the uploader’s file name)', keys.length > 0 && keys.every((k) => /^img\/\d{4}\/\d{2}\/[a-z0-9-]+-[a-z0-9]{12,}\.(jpg|png|webp)$/.test(k)) && fs.readFileSync(path.join(root, 'public', 'js', 'site.js'), 'utf8').length > 100, keys.join(' '));
    const poly = Buffer.concat([fix('community-sticker.png'), Buffer.from('<script>alert(1)</script>')]);
    const pr = await (await admin(g, '/admin/designer/library/upload', { kind: 'photo' }, { image: { buf: poly, type: 'text/html', name: 'x.html' } }, { Accept: 'application/json' })).json();
    const served = await req(pr.item.src);
    check('a picture with something hidden after it is always served as a picture, never as a page', served.headers.get('content-type') === 'image/png' && served.headers.get('x-content-type-options') === 'nosniff');
    check('only the picture and sound areas of storage can be read', (await req('/media/backups/x.json')).status === 404 && (await req('/media/img/../settings')).status !== 200);
    const huge = await admin(g, '/admin/designer/library/upload', { kind: 'photo' }, { image: { buf: Buffer.alloc(9_500_000, 1), type: 'image/jpeg', name: 'big.jpg' } }, { Accept: 'application/json' });
    check('uploads over 8 MB are refused', huge.status === 413 || huge.status === 400);
    check('a design can’t point at pictures on other websites or other parts of storage', cleanDesign({ objects: [{ type: 'image', src: 'https://evil.example/a.png' }] }) === null &&
      cleanDesign({ objects: [{ type: 'image', src: '/media/img/../../admin' }] }) === null && cleanDesign({ objects: [{ type: 'image', src: '/media/audio/x.mp3' }] }) === null && cleanDesign({ background: { src: 'javascript:alert(1)' } }) === null);
    const art2 = await admin(g, `/admin/designer/${draftId}/publish`, { design }, { art: { buf: fix('community-sticker.png'), type: 'image/jpeg', name: 'a.jpg' }, share }, { Accept: 'application/json' });
    check('published artwork must be a real 1733 × 910 JPEG', art2.status === 400 && db.prepare('SELECT status FROM community_posts WHERE id = ?').get(draftId).status === 'draft');
    const pubPage = await text(cardPath);
    check('every published Designer card keeps the official badge layer on top of its artwork', pubPage.includes('class="nwc-card nwc-design') && pubPage.includes('data-role="badge"') && pubPage.indexOf('nwc-bg') < pubPage.indexOf('data-role="badge"'));
  }

  console.log('\nNotifications: only Gary or Julie can send, and only to real notification services');
  {
    check('a notification address on this computer is refused by the live website', cleanSubscription({ endpoint: 'http://localhost:8787/x', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } }, { SITE_URL: 'https://newwaysmediumshipdevelopmentcentre.com' }) === null);
    check('…as are other websites and internal addresses', ['https://evil.example/push', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com.evil.example/x', 'file:///etc/passwd'].every((e) => cleanSubscription({ endpoint: e, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } }, {}) === null));
    check('…while Google’s real service is accepted', !!cleanSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } }, {}));
    check('visitors can’t send or trigger a notification (there is no public address for it)', (await req(`/community/${pubId}/notify`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status >= 404 && !db.prepare('SELECT 1 FROM community_sends').get());
  }

  console.log('\nVerified Admin identity can’t be shared or taken over');
  {
    db.prepare(`INSERT INTO admin_users (email, name) VALUES ('julie.helper@example.test', 'Julie')`).run();
    const j = await signIn('julie');
    check('Julie’s own full Admin account has the Julie identity', (await text('/admin/community/launch', { jar: j })).includes('Admin Julie ✓ <span class="chip">Off</span></span>\n<span class="row-line">This is you.'));
    db.prepare(`INSERT INTO admin_users (email, name) VALUES ('second@example.test', 'Julie Two')`).run();
    await admin(j, '/admin/community/official/julie/on');
    check('if a second Admin account is also called Julie, neither can switch the Julie badge on', db.prepare(`SELECT value FROM community_config WHERE key = 'official_julie'`).get().value === '0');
    db.prepare(`UPDATE admin_users SET active = 0 WHERE email = 'second@example.test'`).run();
    await admin(j, '/admin/community/official/julie/on');
    check('…and once there is only one again, Julie can', db.prepare(`SELECT value FROM community_config WHERE key = 'official_julie'`).get().value === '1');
  }

  console.log('\nRedirects and what public responses reveal');
  {
    const r = await admin(g, `/admin/community/moderation/comment/${heldId}/approve`, { back: 'https://evil.example/phish' });
    check('moderation “go back” can only return to this website’s own Admin pages', r.status === 303 && r.headers.get('location').startsWith('/admin/community/moderation'));
    const lib = await text('/admin/designer/library?flash=Your%20session%20expired.%20Sign%20in%20at%20evil.example', { jar: g });
    check('Admin pages don’t display messages typed into their address', !lib.includes('evil.example'));
    const card = await req(cardPath);
    const html = await card.text();
    check('public Community pages set no cookies and contain no security tokens, email addresses or Admin links', !card.headers.get('set-cookie') && !html.includes('_csrf') && !/@example\.test|owner@/.test(html) && !html.includes('href="/admin'));
    const pubJs = ['community.js', 'site.js', 'designer.js', 'community-admin.js'].map((f) => fs.readFileSync(path.join(root, 'public', 'js', f), 'utf8')).join('\n');
    check('public scripts contain no keys, passwords or secrets', !/SESSION_SECRET|WORKOS_API_KEY|SQUARE_ACCESS_TOKEN|TURNSTILE_SECRET|vapid_private|sk_live|sq0atp|EAAA[A-Za-z0-9]{20}/.test(pubJs));
    const key = await (await req('/community/push/key')).json();
    check('the notification key given to visitors is only the public half', /^[A-Za-z0-9_-]{87}$/.test(key.key) && !JSON.stringify(key).includes('"d"'));
    const react = await (await req(`/community/${pubId}/react`, { method: 'POST', body: JSON.stringify({ kind: 'like', vid: 'Z'.repeat(24) }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.99.0.1' } })).json();
    check('public answers contain only what the page needs (no visitor codes or other records)', Object.keys(react).sort().join() === 'counts,ok,on' && !JSON.stringify(react).includes('v'.repeat(0) + 'visitor'));
    check('Community pages carry the same security rules as the rest of the website', card.headers.get('content-security-policy') === (await req('/events')).headers.get('content-security-policy') && /frame-ancestors 'none'|X-Frame-Options/i.test(card.headers.get('content-security-policy') + (card.headers.get('x-frame-options') ? 'X-Frame-Options' : '')));
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
