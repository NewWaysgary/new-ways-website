// Automated tests for New Way's Community: the launch switch, public reactions, comments, replies, likes and reports
// (with every Stage 4 protection), verified Admin comments and their switches, the welcome panel and Facebook-browser
// help, Wednesday notifications (opt-in, separate from Admin chat, sent only by Admin, once, in batches), private visitor
// statistics, and the Designer (projects, saving, publishing, the picture library, templates).
// Run with: npm test, or on its own: node tests/launch.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { b64url } from '../src/lib/webpush.js';
import { MESSAGES } from '../src/community/moderation.js';
import { cleanDesign } from '../src/admin/designer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const subtle = crypto.webcrypto.subtle;
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 400) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `launch-${port}.sqlite`);
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
async function signIn(srv, who) {
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
const pjson = (p, data, extra = {}) => req(p, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(extra.headers || {}) }, origin: extra.origin });
const fix = (f) => fs.readFileSync(path.join(root, 'tests', 'fixtures', f));

const EXPECTED_CHECKS = 102;
const servers = [];
try {
  console.log('\nDatabase update 0020: only adds');
  {
    const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const sql = fs.readFileSync(path.join(root, 'migrations', '0020_community_launch.sql'), 'utf8').replace(/--.*$/gm, '');
    check('0020 comes straight after 0019', files.indexOf('0020_community_launch.sql') === files.indexOf('0019_community_moderation.sql') + 1);
    check('it never drops, deletes or updates anything, and only adds columns to community_posts', !/(?:^|;)\s*(DROP|DELETE|UPDATE)\b/i.test(sql) && [...sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN/g)].every((m) => m[1] === 'community_posts'));
    const old = new DatabaseSync(':memory:');
    for (const f of files.filter((f) => f < '0020')) old.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    old.exec(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'fixtures.sql'), 'utf8'));
    old.exec(`INSERT INTO community_posts (status, title, layout_json) VALUES ('published', 'Old card', '{}')`);
    const tables = old.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'community_posts'`).all().map((r) => r.name);
    const before = Object.fromEntries(tables.map((t) => [t, JSON.stringify(old.prepare(`SELECT * FROM ${t}`).all())]));
    old.exec(fs.readFileSync(path.join(root, 'migrations', '0020_community_launch.sql'), 'utf8'));
    check('existing records are untouched, and cards made before are “card” kind', Object.entries(before).every(([t, rows]) => JSON.stringify(old.prepare(`SELECT * FROM ${t}`).all()) === rows) &&
      old.prepare(`SELECT kind, title FROM community_posts`).get().kind === 'card');
    check('the Community starts switched OFF, with both official commenting switches off', old.prepare(`SELECT value FROM community_config WHERE key = 'launch'`).get().value === 'off' &&
      old.prepare(`SELECT COUNT(*) AS n FROM community_config WHERE key LIKE 'official_%' AND value = '0'`).get().n === 2);
  }

  const dev = await start(8950); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn(dev, 'owner');
  db.prepare(`INSERT INTO admin_users (email, name) VALUES ('julie.helper@example.test', 'Julie')`).run();
  const j = await signIn(dev, 'julie');
  db.prepare(`INSERT INTO checkin_helpers (email, name) VALUES ('someone.else@example.test', 'Door helper')`).run();
  const helper = await signIn(dev, 'other');

  console.log('\nThe Designer');
  db.exec(`UPDATE community_config SET value = 'testing' WHERE key = 'launch'`);   // so the published card's page can be checked
  {
    const home = await text('/admin', { jar: g });
    check('Admin home has Designer and Community launch buttons', home.includes('href="/admin/designer"') && home.includes('href="/admin/community/launch"'));
    const made = await admin(g, '/admin/designer/new');
    const id = Number((made.headers.get('location') || '').split('/').pop());
    const row = () => db.prepare('SELECT * FROM community_posts WHERE id = ?').get(id);
    check('New thank-you card makes a Designer draft with the guest medium from Who’s On', made.status === 303 && row().kind === 'design' && row().status === 'draft' && JSON.parse(row().design_json).objects.some((o) => o.text === row().medium_name) && !!row().medium_name);
    const ed = await text(`/admin/designer/${id}`, { jar: g });
    check('the Designer page loads its tools, the drawing library and the design (no inline scripts or styles)', ed.includes('data-dz-stage') && ed.includes('/js/vendor/konva-9.3.22.min.js') && ed.includes('/js/designer.js?v=') &&
      ed.includes('<script type="application/json" id="dz-boot">') && !/<script>/.test(ed) && !/\sstyle="/.test(ed) && ['background', 'text', 'photo', 'sticker', 'shape', 'frame', 'effect', 'badge', 'layers'].every((t) => ed.includes(`data-dz-tool="${t}"`)));
    check('the editor has Download Facebook Image, Publish, Undo and Redo', ed.includes('data-dz-download>Download Facebook Image') && ed.includes('data-dz-publish') && ed.includes('data-dz-undo') && ed.includes('data-dz-redo'));
    check('the drawing library is the official one, licensed for free use (MIT)', fs.readFileSync(path.join(root, 'public', 'js', 'vendor', 'konva-LICENSE.txt'), 'utf8').startsWith('MIT License') && fs.statSync(path.join(root, 'public', 'js', 'vendor', 'konva-9.3.22.min.js')).size > 150000);
    const design = JSON.parse(row().design_json);
    design.objects.push({ id: 'x1', type: 'text', text: 'With love <b>always</b>', x: 400, y: 300, font: 'Great Vibes', size: 90, curve: 40 });
    const save = await admin(g, `/admin/designer/${id}/save`, { design: JSON.stringify(design), medium_name: 'Jane Smith', wed_date: '2026-10-14', title: 'Thank you, Jane Smith' }, {}, { Accept: 'application/json' });
    const sj = await save.json();
    check('Save keeps the design, name, date and title (still a draft)', sj.ok && row().status === 'draft' && row().medium_name === 'Jane Smith' && JSON.parse(row().design_json).objects.some((o) => o.id === 'x1' && o.curve === 40));
    const evil = clone(design); evil.background.src = 'https://evil.example/x.jpg';
    const bad = await admin(g, `/admin/designer/${id}/save`, { design: JSON.stringify(evil), medium_name: 'x' }, {}, { Accept: 'application/json' });
    check('a design can only use this website’s own pictures', bad.status === 400 && cleanDesign(evil) === null && cleanDesign(design) !== null);
    const noPics = await admin(g, `/admin/designer/${id}/publish`, { design: JSON.stringify(design), medium_name: 'Jane Smith', title: 'Thank you, Jane Smith' }, {}, { Accept: 'application/json' });
    check('Publish without the finished pictures is refused, and nothing is published', noPics.status === 400 && row().status === 'draft');
    const art = { buf: fix('community-art-1733x910.jpg'), type: 'image/jpeg', name: 'art.jpg' };
    const share = { buf: fix('community-share-1200x630.jpg'), type: 'image/jpeg', name: 'share.jpg' };
    const wrong = await admin(g, `/admin/designer/${id}/publish`, { design: JSON.stringify(design) }, { art: share, share }, { Accept: 'application/json' });
    check('the artwork must really be 1733 × 910 and the link picture 1200 × 630', wrong.status === 400 && row().status === 'draft');
    const pub = await (await admin(g, `/admin/designer/${id}/publish`, { design: JSON.stringify(design), medium_name: 'Jane Smith', wed_date: '2026-10-14', title: 'Thank you, Jane Smith' }, { art, share }, { Accept: 'application/json' })).json();
    const p = row();
    check('Publish stores the finished artwork and Facebook picture and publishes the card', pub.ok && p.status === 'published' && /community-art/.test(p.art_key) && /community-share/.test(p.share_key) && pub.link === `${base}/community/${id}-thank-you-jane-smith`);
    const page = await text(`/community/${id}-thank-you-jane-smith`);
    check('its page shows the finished artwork with the official badge as its own shimmering layer', page.includes(`<img class="nwc-bg" src="/media/${p.art_key}"`) && page.includes('class="nwc-card nwc-design nwc-animate"') && page.includes('data-role="badge"') && page.includes('class="nwc-shine"'));
    check('…and the wording is given to screen readers (safely)', /aria-label="Thank You\. [^"]*Wednesday 14 October 2026\. With love &lt;b&gt;always&lt;\/b&gt;"/.test(page) && page.includes('With love &lt;b&gt;always&lt;/b&gt;'), (page.match(/aria-label="[^"]*"/g)||[]).join(' | '));
    check('its Facebook preview is the finished picture, linking to this card', page.includes(`<meta property="og:image" content="${base}/media/${p.share_key}">`) && page.includes(`<meta property="og:url" content="${base}/community/${id}-thank-you-jane-smith">`));
    const oldArt = p.art_key;
    const upd = await (await admin(g, `/admin/designer/${id}/publish`, { design: JSON.stringify({ ...design, shimmer: false }), medium_name: 'Jane Smith', title: 'Thank you, Jane Smith' }, { art, share }, { Accept: 'application/json' })).json();
    check('updating replaces the pictures, keeps the address, and Animate Logo off removes the shimmer', upd.ok && row().art_key !== oldArt && !db.prepare('SELECT 1 FROM media WHERE key = ?').get(oldArt) && row().slug === 'thank-you-jane-smith' && !(await text(`/community/${id}-thank-you-jane-smith`)).includes('nwc-shine'));
    const tpl = await (await admin(g, `/admin/designer/${id}/template`, { design: JSON.stringify(design), name: 'Wednesday gold' }, {}, { Accept: 'application/json' })).json();
    const tid = db.prepare(`SELECT id FROM community_templates WHERE name = 'Wednesday gold'`).get();
    const fromT = await admin(g, '/admin/designer/new', { template: String(tid && tid.id) });
    const tId = Number((fromT.headers.get('location') || '').split('/').pop());
    check('a design can be saved as a template and reused', tpl.ok && tid && JSON.parse(db.prepare('SELECT design_json FROM community_posts WHERE id = ?').get(tId).design_json).objects.some((o) => o.id === 'x1'));
    const up = await admin(g, '/admin/designer/library/upload', { kind: 'sticker', name: 'Gold circle', folder: 'Shapes' }, { image: { buf: fix('community-sticker.png'), type: 'image/png', name: 's.png' } }, { Accept: 'application/json' });
    const uj = await up.json();
    const lib = await (await req('/admin/designer/library.json', { jar: g })).json();
    check('pictures can be uploaded to the library and are listed for the Designer (with folder)', uj.ok && lib.items.some((i) => i.name === 'Gold circle' && i.kind === 'sticker' && i.folder === 'Shapes' && i.src.startsWith('/media/img/')));
    const notPic = await admin(g, '/admin/designer/library/upload', { kind: 'photo' }, { image: { buf: Buffer.from('<svg onload=alert(1)>'), type: 'image/svg+xml', name: 'x.svg' } }, { Accept: 'application/json' });
    check('only real JPEG, PNG or WebP pictures are accepted (no SVG files)', notPic.status === 400);
    const libPage = await text('/admin/designer/library', { jar: g });
    check('the library page shows the storage used and the 8 GB limit', libPage.includes('Storage used:') && /8(\.0)? GB|8192/.test(libPage), libPage.match(/Storage used:[^<]*/));
    const del = await admin(g, `/admin/designer/${tId}/delete`);
    check('a draft project can be deleted; a published one can’t', del.status === 303 && !db.prepare('SELECT 1 FROM community_posts WHERE id = ?').get(tId) && (await admin(g, `/admin/designer/${id}/delete`)).headers.get('location').includes('published-no-delete'));
    check('Julie can use the Designer; a check-in helper can’t', (await req('/admin/designer', { jar: j })).status === 200 && (await req('/admin/designer', { jar: helper })).status === 403 && (await admin(helper, '/admin/designer/new')).status === 403);
    check('the original card editor sends Designer cards to the Designer', (await req(`/admin/community/${id}`, { jar: g })).headers.get('location') === `/admin/designer/${id}`);
    globalThis.cardId = id;
  }
  const cardId = globalThis.cardId;
  const cardPath = `/community/${cardId}-thank-you-jane-smith`;

  console.log('\nThe launch switch');
  {
    await admin(g, '/admin/community/launch', { state: 'off' });
    const offCard = await req(cardPath);
    check('OFF: the Community page doesn’t exist', (await req('/community')).status === 404);
    check('OFF: even a published card’s own link is “not found” (nothing of the Community is shown)', offCard.status === 404 && !(await offCard.text()).includes('nwc-card'));
    check('OFF: nothing can be posted', (await pjson(`/community/${cardId}/react`, { kind: 'like', vid: 'a'.repeat(24) })).status === 403 && (await req('/community/push/key')).status === 404);
    check('OFF: not in the menu or sitemap', !(await text('/')).includes('href="/community"') && !(await text('/sitemap.xml')).includes('/community'));
    const lpage = await text('/admin/community/launch', { jar: g });
    check('the launch page reminds Gary and Julie to add the Community to the Privacy Notice (without changing it)', lpage.includes('data-nwc-privacy-note') && lpage.includes('href="/admin/wording/privacy_notice"') && !/community/i.test(db.prepare(`SELECT body FROM content_blocks WHERE key = 'privacy_notice'`).get()?.body || ''));
    check('only Gary or Julie can change it, with the page’s security token', (await admin(helper, '/admin/community/launch', { state: 'live' })).status === 403 &&
      (await req('/admin/community/launch', { jar: g, method: 'POST', body: new URLSearchParams({ state: 'live' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 403);
    await admin(g, '/admin/community/launch', { state: 'testing' });
    const list = await req('/community');
    const lp = await list.text();
    check('TESTING: the Community page works, with the welcome panel, Install Our App and Enable Wednesday Notifications', list.status === 200 && lp.includes('Welcome to New Way’s Community') && lp.includes('Install Our App') && lp.includes('Enable Wednesday Notifications') && lp.includes('data-install-app'));
    check('TESTING: still out of Google, the menu and the sitemap', lp.includes('<meta name="robots" content="noindex, nofollow">') && list.headers.get('x-robots-tag') === 'noindex, nofollow' && !(await text('/')).includes('href="/community"') && !(await text('/sitemap.xml')).includes('/community'));
    check('links to Community pages open fully (so its own script always loads)', lp.includes(`href="${cardPath}" rel="external"`));
    const card = await text(cardPath);
    check('TESTING: a card has reactions, comments and the comment form (with the spam check)', card.includes('data-react="like"') && card.includes('data-react="love"') && card.includes('data-react="thanks"') && card.includes('id="comment-form"') && card.includes('class="cf-turnstile"'));
    check('nobody needs an account: only a name and a comment', !/type="(email|password|tel)"/.test(card) && card.includes('name="name"') && card.includes('name="text"'));
  }

  console.log('\nFacebook visitors');
  {
    const fbUa = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0;]';
    const fb = await text(cardPath + '?fbclid=x', { headers: { 'User-Agent': fbUa } });
    check('inside Facebook’s browser on Android: a clear Open in Chrome button, plus steps if it doesn’t work', /<section class="nwc-fbhelp" data-nwc-fbhelp aria-label/.test(fb) && fb.includes('intent://localhost:8950' + cardPath) && fb.includes('package=com.android.chrome') && fb.includes('Open in external browser'));
    const ios = await text(cardPath, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]' } });
    check('on iPhone: steps to open it in Safari', ios.includes('Open in Safari') && /data-nwc-fb-android hidden/.test(ios) && !/data-nwc-fb-ios hidden/.test(ios));
    check('everyone else doesn’t see the Facebook help', /data-nwc-fbhelp hidden/.test(await text(cardPath)));
    check('Facebook visitors can still react and comment there', fb.includes('data-react="like"') && fb.includes('id="comment-form"'));
  }

  console.log('\nReactions');
  {
    const v1 = 'A'.repeat(24), v2 = 'B'.repeat(24);
    const r1 = await (await pjson(`/community/${cardId}/react`, { kind: 'love', vid: v1 })).json();
    const r2 = await (await pjson(`/community/${cardId}/react`, { kind: 'love', vid: v2 })).json();
    check('Like, Love and Thank You can be added (one per visitor)', r1.ok && r1.on && r2.counts.love === 2);
    const r3 = await (await pjson(`/community/${cardId}/react`, { kind: 'love', vid: v1 })).json();
    check('tapping again takes it away', r3.ok && !r3.on && r3.counts.love === 1);
    check('only Like, Love or Thank You', (await pjson(`/community/${cardId}/react`, { kind: 'angry', vid: v1 })).status === 400);
    check('only from this website’s own pages', (await pjson(`/community/${cardId}/react`, { kind: 'like', vid: v1 }, { origin: 'https://evil.example' })).status === 403);
    check('the count shows on the card', (await text(cardPath)).includes('data-react-count="love">1<'));
  }

  console.log('\nComments and replies (every Stage 4 protection applies)');
  {
    const page = await text(cardPath);
    const stamp = page.match(/name="t" value="([^"]+)"/)[1];
    await sleep(2700);
    const post = (fields, ip = '10.9.0.1', asJson = true) => req(`/community/${cardId}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip, ...(asJson ? { Accept: 'application/json' } : {}) },
      body: new URLSearchParams({ t: stamp, website: '', vid: 'v' + ip.replace(/\D/g, '').padEnd(23, '0'), 'cf-turnstile-response': TOKEN, ...fields }).toString() });
    const count = () => db.prepare('SELECT COUNT(*) AS n FROM community_comments').get().n;
    const before = count();
    const ok = await post({ name: 'Jean', text: 'Thank you so much, a wonderful night! Love Jean xxx' });
    const okj = await ok.json();
    check('a friendly comment is published straight away', ok.status === 200 && okj.ok && okj.status === 'published' && (await text(cardPath)).includes('a wonderful night! Love Jean xxx'));
    const sw = await post({ name: 'Sam', text: 'You are full of sh1t' }, '10.9.0.2');
    check('swearing is blocked with the agreed message (nothing stored)', sw.status === 422 && (await sw.json()).message === MESSAGES.language && count() === before + 1);
    const ln = await post({ name: 'Rose', text: 'Visit www.mypsychic.com' }, '10.9.0.2');
    check('links are blocked with the agreed message', ln.status === 422 && (await ln.json()).message === MESSAGES.link);
    const tk = await post({ name: 'Kelly', text: 'Got 2 spare tickets for Friday, message me' }, '10.9.0.3');
    check('fake ticket sales are blocked with the agreed message', tk.status === 422 && (await tk.json()).message === MESSAGES.advert);
    const nm = await post({ name: 'Admin Gary', text: 'Hello all' }, '10.9.0.3');
    check('nobody can post as Admin Gary', nm.status === 422 && (await nm.json()).message === MESSAGES.name);
    const held = await (await post({ name: 'Pat', text: 'This medium is a fake' }, '10.9.0.4')).json();
    check('suspicious comments are held privately for Gary and Julie', held.ok && held.status === 'held' && !(await text(cardPath)).includes('This medium is a fake') && (await text('/admin/community/moderation', { jar: g })).includes('This medium is a fake'));
    check('without the “I’m human” check, nothing is posted', (await post({ name: 'Bot', text: 'Hello', 'cf-turnstile-response': '' }, '10.9.0.5')).status === 400);
    const trap = await (await post({ name: 'Bot', text: 'Buy now', website: 'http://spam' }, '10.9.0.5')).json();
    check('spam programs filling the hidden trap field are quietly ignored', trap.ok && !db.prepare(`SELECT 1 FROM community_comments WHERE name = 'Bot'`).get());
    const parent = db.prepare(`SELECT id FROM community_comments WHERE name = 'Jean'`).get().id;
    const rep = await (await post({ name: 'Ann', text: 'Agreed, she was brilliant', parent: String(parent) }, '10.9.0.6')).json();
    const reply = db.prepare(`SELECT * FROM community_comments WHERE name = 'Ann'`).get();
    check('replies are posted under the comment', rep.ok && reply && reply.parent_id === parent && (await text(cardPath)).includes('class="nwc-comment nwc-reply"'), JSON.stringify(rep) + JSON.stringify(reply));
    check('replies to replies are not allowed', (await post({ name: 'Bo', text: 'Me too', parent: String(reply.id) }, '10.9.0.6')).status === 400);
    const nojs = await post({ name: 'Sam', text: 'What a load of sh1te' }, '10.9.0.7', false);
    const nojsPage = await nojs.text();
    check('without JavaScript a blocked comment shows the message and keeps the wording in the box', nojs.status === 422 && nojsPage.includes('What a load of sh1te</textarea>') && nojsPage.includes('not permitted in New Way’s Community'));
    const nojsOk = await post({ name: 'Lily', text: 'Lovely evening, thank you' }, '10.9.0.8', false);
    check('without JavaScript a good comment goes back to the card', nojsOk.status === 303 && nojsOk.headers.get('location').startsWith(cardPath + '?posted=1#c'), nojsOk.status + ' ' + nojsOk.headers.get('location'));
    let limited = false;
    for (let i = 0; i < 8; i++) { const r = await post({ name: 'Fast', text: 'Lovely night number ' + i }, '10.9.0.99'); if (r.status === 429) { limited = true; break; } }
    check('posting a lot in a short time is slowed down', limited);
    check('comments show names and text safely', !(await text(cardPath)).includes('<script>'));
  }

  console.log('\nLikes and reports');
  {
    const c = db.prepare(`SELECT id FROM community_comments WHERE name = 'Jean'`).get().id;
    const l1 = await (await pjson(`/community/comment/${c}/like`, { vid: 'L'.repeat(24) })).json();
    const l2 = await (await pjson(`/community/comment/${c}/like`, { vid: 'M'.repeat(24) })).json();
    const l3 = await (await pjson(`/community/comment/${c}/like`, { vid: 'L'.repeat(24) })).json();
    check('comments can be liked (once per visitor; tapping again takes it away)', l1.likes === 1 && l2.likes === 2 && l3.likes === 1 && !l3.on);
    const target = db.prepare(`SELECT id FROM community_comments WHERE name = 'Lily'`).get().id;
    const rep = (vid, ip) => req(`/community/comment/${target}/report`, { method: 'POST', body: JSON.stringify({ vid }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip } });
    await rep('R'.repeat(24), '10.7.0.1'); await rep('R'.repeat(24), '10.7.0.1'); await rep('S'.repeat(24), '10.71.0.2');
    check('two reports (one repeated) don’t hide a comment', db.prepare('SELECT status FROM community_comments WHERE id = ?').get(target).status === 'published');
    await rep('Q'.repeat(24), '10.7.0.44'); await rep('P'.repeat(24), '10.7.0.45');
    check('one person using several browsers on the same network can’t hide it (those reports still show for Admin)', db.prepare('SELECT status, report_count FROM community_comments WHERE id = ?').get(target).status === 'published' && db.prepare('SELECT report_count FROM community_comments WHERE id = ?').get(target).report_count === 4);
    const third = await (await rep('T'.repeat(24), '10.72.0.3')).json();
    check('three different visitors on different networks hide it until Gary or Julie look at it', third.ok && db.prepare('SELECT status FROM community_comments WHERE id = ?').get(target).status === 'hidden' && !(await text(cardPath)).includes('Lovely evening, thank you'));
    let slowed = false;
    for (let i = 0; i < 7; i++) { const r = await rep(String(i).repeat(24), '10.7.0.9'); if (r.status === 429) { slowed = true; break; } }
    check('one connection can’t send lots of reports', slowed);
  }

  console.log('\nVerified Admin comments');
  {
    const cfg = (k) => db.prepare('SELECT value FROM community_config WHERE key = ?').get(k).value;
    const view = await text(`/admin/community/${cardId}/view`, { jar: g });
    check('the Admin Community view shows the card, comments, moderation buttons and the official comment box', view.includes('nwc-card') && view.includes('Agreed, she was brilliant') && view.includes('/moderation/comment/') && view.includes('official commenting is off'));
    await admin(j, '/admin/community/official/gary/on');
    check('Julie can’t switch Gary’s official commenting on', cfg('official_gary') === '0');
    await admin(g, '/admin/community/official/gary/on');
    check('Gary switches his own on', cfg('official_gary') === '1');
    await admin(j, '/admin/community/official/gary/off');
    check('Julie can switch Gary’s off in an emergency', cfg('official_gary') === '0');
    const refused = await admin(g, `/admin/community/${cardId}/official-comment`, { text: 'Hello from Gary' });
    check('with it off, no official comment can be posted', refused.headers.get('location').includes('official-off') && !db.prepare(`SELECT 1 FROM community_comments WHERE official != ''`).get());
    await admin(g, '/admin/community/official/gary/on');
    await admin(j, '/admin/community/official/julie/on');
    await admin(g, `/admin/community/${cardId}/official-comment`, { text: 'Thank you all, see you next Wednesday! https://newwaysmediumshipdevelopmentcentre.com/events', name: 'Admin Julie' });
    await admin(j, `/admin/community/${cardId}/official-comment`, { text: 'Lovely to see you all', official: 'gary' });
    const g1 = db.prepare(`SELECT * FROM community_comments WHERE body LIKE 'Thank you all%'`).get(), j1 = db.prepare(`SELECT * FROM community_comments WHERE body = 'Lovely to see you all'`).get();
    check('each Admin login can only post as itself, whatever is typed (both switches on)', g1.official === 'gary' && g1.name === 'Admin Gary' && j1.official === 'julie' && j1.name === 'Admin Julie');
    const pub = await text(cardPath);
    check('visitors see the green verified Admin Gary ✓ and Admin Julie ✓', pub.includes('<span class="nwc-official">Admin Gary <span class="nwc-tick" aria-label="verified New Way’s Admin">✓</span></span>') && pub.includes('<span class="nwc-official">Admin Julie <span class="nwc-tick"'));
    check('official comments may contain a link; visitors’ comments never become links', pub.includes('<a href="https://newwaysmediumshipdevelopmentcentre.com/events" rel="noopener" target="_blank">') && (pub.match(/class="nwc-official"/g) || []).length === 2);
    const asGary = await req(`/community/${cardId}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'CF-Connecting-IP': '10.6.0.1' },
      body: new URLSearchParams({ t: (await text(cardPath)).match(/name="t" value="([^"]+)"/)[1], vid: 'G'.repeat(24), name: 'Gary', text: 'Great night', 'cf-turnstile-response': TOKEN }).toString() });
    await sleep(0);
    const garyRow = db.prepare(`SELECT official FROM community_comments WHERE name = 'Gary'`).get();
    check('a visitor typing the name Gary never gets the badge', (!garyRow || garyRow.official === '') && ((await text(cardPath)).match(/class="nwc-official"/g) || []).length === 2, asGary.status);
    check('reports can’t hide an official comment', await (async () => { for (const v of ['X', 'Y', 'Z', 'W']) await req(`/community/comment/${g1.id}/report`, { method: 'POST', body: JSON.stringify({ vid: v.repeat(24) }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.5.0.' + v.charCodeAt(0) } }); return db.prepare('SELECT status FROM community_comments WHERE id = ?').get(g1.id).status === 'published'; })());
    check('a check-in helper can’t post officially or change the switches', (await admin(helper, `/admin/community/${cardId}/official-comment`, { text: 'x' })).status === 403 && (await admin(helper, '/admin/community/official/julie/off')).status === 403);
    const hid = await admin(g, `/admin/community/moderation/comment/${j1.id}/hide`, { back: `/admin/community/${cardId}/view` });
    check('moderating from the Admin Community view returns there', hid.headers.get('location') === `/admin/community/${cardId}/view?flash=hide`);
  }

  console.log('\nWednesday notifications');
  {
    const key = await (await req('/community/push/key')).json();
    check('the page can get the website’s public notification key', key.ok && /^[A-Za-z0-9_-]{80,90}$/.test(key.key));
    const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const sub = (id) => ({ endpoint: `${dev.mock}/__push/send/${id}`, keys: { p256dh: b64url(subtle.exportKey ? new Uint8Array(0) : 0), auth: b64url(crypto.randomBytes(16)) } });
    const pk = b64url(await subtle.exportKey('raw', ua.publicKey));
    const s1 = { endpoint: `${dev.mock}/__push/send/visitor-1`, keys: { p256dh: pk, auth: b64url(crypto.randomBytes(16)) } };
    const s2 = { endpoint: `${dev.mock}/__push/send/visitor-2`, keys: { p256dh: pk, auth: b64url(crypto.randomBytes(16)) } };
    const r1 = await (await pjson('/community/push/subscribe', { subscription: s1 })).json();
    await pjson('/community/push/subscribe', { subscription: s2 });
    check('visitors can turn on Wednesday notifications (no account)', r1.ok && r1.subscribed && db.prepare('SELECT COUNT(*) AS n FROM community_subscribers').get().n === 2);
    check('…kept completely separate from Admin chat notifications', db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n === 0);
    check('a notification address that isn’t a real push service is refused', (await pjson('/community/push/subscribe', { subscription: { ...s1, endpoint: 'https://evil.example/x' } })).status === 400);
    check('the page can check whether this phone has them on', (await (await pjson('/community/push/status', { endpoint: s1.endpoint })).json()).subscribed === true);
    await pjson('/community/push/unsubscribe', { endpoint: s2.endpoint });
    check('turning them off removes only this phone from the list', db.prepare('SELECT COUNT(*) AS n FROM community_subscribers').get().n === 1 && (await (await pjson('/community/push/status', { endpoint: s2.endpoint })).json()).subscribed === false);
    check('publishing never sends anything by itself', (await (await fetch(dev.mock + '/__push/state')).json()).filter((p) => /visitor-/.test(p.id)).length === 0 && !db.prepare('SELECT 1 FROM community_sends').get());
    const before = (await (await fetch(dev.mock + '/__push/state')).json()).length;
    const send = await admin(g, `/admin/community/${cardId}/notify`);
    const pushes = (await (await fetch(dev.mock + '/__push/state')).json()).slice(before);
    check('Gary or Julie press Send notification: each subscribed phone gets one', send.status === 303 && pushes.length === 1 && pushes[0].id === 'visitor-1');
    const again = await admin(j, `/admin/community/${cardId}/notify`);
    check('the same card can never be sent twice', again.headers.get('location').includes('already-sent') && (await (await fetch(dev.mock + '/__push/state')).json()).slice(before).length === 1);
    const st = db.prepare('SELECT * FROM community_sends').get();
    check('the send is recorded as finished, with each phone’s result', !!st.finished_at && db.prepare(`SELECT status FROM community_deliveries WHERE send_id = ?`).get(st.id).status === 'sent');
    const batch = await (await admin(g, `/admin/community/${cardId}/notify/batch`, {}, {}, { Accept: 'application/json' })).json();
    check('progress can be checked (and a finished send sends nothing more)', batch.ok && batch.done && batch.counts.sent === 1 && (await (await fetch(dev.mock + '/__push/state')).json()).slice(before).length === 1);
    check('the notification opens the card (its address is in the message)', st.url === cardPath && st.title === 'New Way’s Community');
    const view = await text(`/admin/community/${cardId}/view`, { jar: g });
    check('the Admin view shows the result instead of the button', view.includes('Finished: 1 sent') && !view.includes('>Send notification</button>'));
    const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
    check('the existing app’s helper already opens the address sent (unchanged)', sw.includes("typeof data.url === 'string' && data.url.startsWith('/')") && sw.includes("const VERSION = 'nw-v17'"));
  }

  console.log('\nPrivate visitor statistics');
  {
    const day = db.prepare(`SELECT * FROM community_stats WHERE post_id = -1`).get();
    const before = day ? day.visits : 0;
    await req(cardPath, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/128 Mobile Safari/537.36 unique-a', 'CF-Connecting-IP': '81.2.3.4' } });
    await req(cardPath, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/128 Mobile Safari/537.36 unique-a', 'CF-Connecting-IP': '81.2.3.4' } });
    await req(cardPath + '?fbclid=abc', { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Mobile Safari unique-b', 'CF-Connecting-IP': '81.2.3.5' } });
    await req(cardPath, { headers: { 'User-Agent': 'facebookexternalhit/1.1', 'CF-Connecting-IP': '81.2.3.6' } });
    await req(`/admin/community/${cardId}/view`, { jar: g });
    const after = db.prepare(`SELECT * FROM community_stats WHERE post_id = -1`).get();
    check('visits are counted once per visitor per page per day (refreshing, Facebook’s link reader and Admin views are not)', after.visits - before === 2, after.visits - before);
    check('each visitor is counted once a day, and arrivals from Facebook are counted', after.uniques >= 2 && after.facebook >= 1);
    check('no IP addresses or cookies are stored, only scrambled codes that are deleted after two days', db.prepare('SELECT code FROM community_seen').all().every((r) => /^[0-9a-f]{20}$/.test(r.code)) &&
      !JSON.stringify(db.prepare('SELECT * FROM community_seen').all()).includes('81.2.3') && !(await req(cardPath)).headers.get('set-cookie'));
    const sp = await text('/admin/community/stats', { jar: g });
    check('Gary and Julie see visits today, 7 and 30 days, all time, Facebook and each card', sp.includes('Visits today') && sp.includes('Last 7 days') && sp.includes('Last 30 days') && sp.includes('From Facebook') && sp.includes('Thank you, Jane Smith'));
    check('the statistics are private', (await req('/admin/community/stats')).status === 401 && (await req('/admin/community/stats', { jar: helper })).status === 403);
  }

  console.log('\nGoing live');
  {
    await admin(g, '/admin/community/launch', { state: 'live' });
    const home = await text('/');
    const list = await req('/community');
    check('LIVE: New Way’s Community appears in the menu', home.includes('<a class="site-menu-link press" href="/community" rel="external">'));
    check('LIVE: it is in the sitemap with each card, and Google may list it', (await text('/sitemap.xml')).includes(`${base}/community</loc>`) && (await text('/sitemap.xml')).includes(cardPath) && !(await list.text()).includes('noindex') && !list.headers.get('x-robots-tag'));
    await admin(g, '/admin/community/launch', { state: 'off' });
    check('switching it OFF again hides it straight away', (await req('/community')).status === 404 && !(await text('/')).includes('href="/community"'));
    check('every launch change is recorded', db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'community.launch'`).get().n === 4);
  }

  console.log('\nThe rest of the website is unaffected');
  {
    for (const p of ['/', '/whos-on', '/events', '/private-readings', '/bookings', '/meditations', '/about', '/chat', '/support', '/reviews']) {
      const r = await req(p);
      if (r.status !== 200) { check('page ' + p + ' still works', false, r.status); }
    }
    check('main pages still load', true);
    check('the website’s own styles, scripts, app helper and manifests are unchanged (version 17)', (await text('/')).includes('/css/site.css?v=17') && fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8').includes("'nw-v17'"));
    const backup = await (await req('/admin/backups/download', { jar: g })).json();
    check('backups include the Community (but never notification addresses)', ['community_config', 'community_reactions', 'community_library', 'community_templates', 'community_stats'].every((t) => Array.isArray(backup.tables[t])) && !('community_subscribers' in backup.tables));
  }
} catch (err) {
  console.log('Test run stopped: ' + (err && err.stack ? err.stack : err));
  failed++;
} finally {
  for (const s of servers) s.child.kill();
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
const notRun = Math.max(0, EXPECTED_CHECKS - passed - failed);
console.log(`\n${passed} passed, ${failed} failed, ${notRun} not run (skipped)`);
process.exit(failed || notRun ? 1 : 0);
