// Automated tests for New Way's Community. Stage 2: the nine approved backgrounds, the thank-you card (wording and the
// official badge as separate layers, the badge's gold shimmer, the soft text shadow), the hidden public card page and
// its Facebook details, the Admin-only preview, the nine-design rotation, and that nothing else changes.
// Stage 3: the card editor (drafts, Who's On suggestions, lettering, colours, positions, badge, Next Design), Publish
// with its Facebook picture, Save and update, Copy Facebook Link, Move back to drafts, Delete, and who may do what.
// Run with: npm test (after the other suites), or on its own: node tests/community.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { BACKGROUNDS, cleanLayout, parseLayout, renderCard, sampleLayout, backgroundSources, COMMUNITY_CSS } from '../src/community/card.js';
import { suggestBackground, afterUsing, slugify, postPath } from '../src/community/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 300) : '')); }
}

function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `community-${port}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: `http://localhost:${port}` }, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start on ' + port)), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('local test copy')) { clearTimeout(timer); resolve({ child, base: `http://localhost:${port}`, dbFile }); } });
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
async function req(base, p, { jar, method = 'GET', body, headers = {} } = {}) {
  const h = { ...headers };
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET') h.Origin = base;
  const res = await fetch(base + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}
const text = async (base, p, opts) => (await req(base, p, opts)).text();
async function signIn(srv, who) {
  const jar = new Jar();
  const login = await req(srv.base, '/admin/login', { jar });
  const authPage = await (await fetch(login.headers.get('location'))).text();
  const link = (authPage.match(new RegExp(`id="as-${who}" href="([^"]+)"`)) || [])[1];
  const cb = new URL(link.replace(/&amp;/g, '&'));
  const res = await req(srv.base, cb.pathname + cb.search, { jar });
  return { jar, res };
}

const EXPECTED_CHECKS = 114;   // the total in a complete run, so an early stop is reported as checks not run
const servers = [];
try {
  console.log('\nDatabase update 0018: only adds the two Community tables');
  {
    const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const sql = fs.readFileSync(path.join(root, 'migrations', '0018_community_cards.sql'), 'utf8');
    const code = sql.replace(/--.*$/gm, '');
    check('0018 is the newest database update', files[files.length - 1] === '0018_community_cards.sql');
    check('it never drops, deletes, alters or updates anything', !/\b(DROP|DELETE|ALTER|UPDATE)\b/i.test(code));
    check('it only creates community_posts and community_rotation (and their index and first row)',
      JSON.stringify([...code.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1])) === '["community_posts","community_rotation"]' &&
      [...code.matchAll(/INSERT INTO (\w+)/g)].every((m) => m[1] === 'community_rotation'));
    const db = new DatabaseSync(':memory:');
    for (const f of files.filter((f) => f < '0018')) db.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    db.exec(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'fixtures.sql'), 'utf8'));
    const tables = () => db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name);
    const before = Object.fromEntries(tables().map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all())]));
    db.exec(sql);
    const after = tables();
    check('applied to an existing database, every existing table and record is exactly as it was',
      Object.entries(before).every(([t, rows]) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()) === rows));
    check('…and the only new tables are the two Community tables', JSON.stringify(after.filter((t) => !(t in before))) === '["community_posts","community_rotation"]');
    let refused = false;
    try { db.exec(`INSERT INTO community_posts (status) VALUES ('live')`); } catch { refused = true; }
    check('a card can only be a draft or published (the database refuses anything else)', refused);
  }

  console.log('\nThe nine approved backgrounds (optimised website copies)');
  {
    check('exactly nine designs: 01-06, 08, 09 and 10 (07 is not part of the set)', JSON.stringify(BACKGROUNDS) === '["01","02","03","04","05","06","08","09","10"]');
    const dir = path.join(root, 'public', 'images', 'community');
    const files = fs.readdirSync(dir).sort();
    check('four sizes of each design (editor thumbnail, phone, larger screens, full) and nothing else (36 files)', files.length === 36 && BACKGROUNDS.every((b) => ['thumb', '800', '1200', 'full'].every((s) => files.includes(`bg-${b}-${s}.webp`))));
    const webpWidth = (buf) => {   // reads the picture's real width from the WebP file
      const chunk = buf.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return buf.readUInt16LE(26) & 0x3fff;
      if (chunk === 'VP8L') return 1 + (((buf[22] & 0x3f) << 8) | buf[21]);
      if (chunk === 'VP8X') return 1 + buf.readUIntLE(24, 3);
      return 0;
    };
    const info = files.map((f) => { const buf = fs.readFileSync(path.join(dir, f)); return { f, buf, w: webpWidth(buf) }; });
    check('every file is a real WebP picture', info.every((i) => i.buf.toString('latin1', 0, 4) === 'RIFF' && i.buf.toString('latin1', 8, 12) === 'WEBP'));
    check('sizes are 240, 800 and 1200 pixels wide, and the full copies keep the original width (never enlarged)',
      info.every((i) => (i.f.endsWith('-thumb.webp') ? i.w === 240 : i.f.endsWith('-800.webp') ? i.w === 800 : i.f.endsWith('-1200.webp') ? i.w === 1200 : (i.w === 1733 || i.w === 1732))));
    const total = info.reduce((n, i) => n + i.buf.length, 0);
    check('they are light enough for phones (each under 600 KB, all 36 under 8 MB)', info.every((i) => i.buf.length < 600 * 1024) && total < 8 * 1024 * 1024, Math.round(total / 1024) + ' KB');
    const s = backgroundSources('02');
    check('the card offers the phone and desktop sizes, with the right width for each', s.srcset === '/images/community/bg-02-800.webp 800w, /images/community/bg-02-1200.webp 1200w, /images/community/bg-02-full.webp 1732w');
  }

  console.log('\nThe nine-design rotation');
  {
    let rot = { used: [], last: '' };
    const firstRound = [];
    for (let i = 0; i < 9; i++) { const b = suggestBackground(rot); firstRound.push(b); rot = afterUsing(rot, b); }
    check('nine cards in a row use all nine designs, each once', JSON.stringify([...firstRound].sort()) === JSON.stringify(BACKGROUNDS));
    check('after all nine, a new round begins', rot.used.length === 0 && rot.last === '10');
    check('…and never with the design that was just used', suggestBackground(rot) !== rot.last);
    let r2 = { used: [], last: '' };
    r2 = afterUsing(r2, '05');   // picked by hand
    check('a design picked by hand counts as used in this round', r2.used.includes('05') && suggestBackground(r2) === '01' && suggestBackground(afterUsing(afterUsing(afterUsing(afterUsing(r2, '01'), '02'), '03'), '04')) === '06');
    let rr = { used: [], last: '' }, prev = '', twice = false, seq = [];
    for (let i = 0; i < 60; i++) {
      const pick = i % 7 === 3 ? BACKGROUNDS[(i * 5) % 9] : suggestBackground(rr);   // sometimes chosen by hand
      if (pick === prev && i % 7 !== 3) twice = true;
      seq.push(pick); prev = pick; rr = afterUsing(rr, pick);
    }
    check('the rotation never suggests the same design twice in a row (60 cards, some picked by hand)', !twice);
    check('a design outside the nine (such as 07) is never used', suggestBackground({ used: ['07'], last: '07' }) === '01' && afterUsing({ used: [], last: '' }, '07').used.length === 0);
  }

  console.log('\nThe card: wording and the official badge as separate layers');
  {
    const L = cleanLayout({ background: '07', texts: [{ lines: ['Hello\u0000 <b>there</b>', 'a'.repeat(300), '', 'x', 'y', 'z', 'w', 'v'], x: 9999, y: -5, font: 'Comic Sans', size: 999, weight: 900, color: 'red', anchor: 'left' }],
      badge: { x: 'abc', size: 5 } });
    const t = L.texts[0];
    check('an unknown background (such as 07) falls back to design 01', L.background === '01');
    check('positions and sizes are kept inside the card', t.x === 1200 && t.y === 0 && t.size === 160 && L.badge.size === 40 && L.badge.x === 1040);
    check('only the approved fonts, weights, alignments and proper colours are accepted', t.font === 'cinzel' && t.weight === 600 && t.anchor === 'middle' && t.color === '#FFFFFF');
    check('hidden characters are removed, each line is limited to 120 characters and a block to 6 lines', t.lines[0] === 'Hello <b>there</b>' && t.lines[1].length === 120 && t.lines.length === 6);
    check('a damaged saved layout still draws safely', parseLayout('{not json').texts.length === 0 && parseLayout(null).background === '01');
    const card = String(renderCard(L, { uid: 't1' }));
    check('wording is shown as text, never as page code', card.includes('Hello &lt;b&gt;there&lt;/b&gt;') && !card.includes('<b>there'));
    check('no inline styles (the website’s security rules stay exactly as they are)', !/\sstyle=/.test(card) && !/<style/i.test(card) && !/<script/i.test(card));
    const on = String(renderCard(sampleLayout('03', { shimmer: true, shadow: true }), { uid: 'on' }));
    const off = String(renderCard(sampleLayout('03', { shimmer: false, shadow: false }), { uid: 'off' }));
    check('the background is its own picture, under the wording', /<img class="nwc-bg" src="\/images\/community\/bg-03-1200\.webp"/.test(on));
    check('the official badge is its own layer (the existing logo), shown as a circle', on.includes('<g class="nwc-badge" data-role="badge">') && on.includes('href="/images/logo-720.webp"') && /<clipPath id="nwc-bc-on"><circle/.test(on));
    check('Animate Logo on: the badge has its gold shimmer', on.includes('nwc-card nwc-animate') && on.includes('class="nwc-shine"'));
    check('Animate Logo off: the badge is still (no shimmer at all)', !off.includes('nwc-animate') && !off.includes('nwc-shine') && off.includes('<g class="nwc-badge" data-role="badge">'));
    check('Text shadow on: every line of wording has the soft shadow', (on.match(/<text [^>]*filter="url\(#nwc-sh-on\)"/g) || []).length === 3 && on.includes('<feDropShadow'));
    check('Text shadow off: no shadow', !off.includes('filter=') && !off.includes('feDropShadow'));
    check('the card describes its wording for screen readers', /role="img" aria-label="Thank You\. Sample Medium Name\. for a wonderful Wednesday evening at New Way’s"/.test(on));
    const two = String(renderCard(sampleLayout('01'), { uid: 'x1' })) + String(renderCard(sampleLayout('02'), { uid: 'x2' }));
    check('several cards on one page never share drawing names', two.includes('id="nwc-bc-x1"') && two.includes('id="nwc-bc-x2"'));
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'community.css'), 'utf8');
    check('visitors who ask their phone for less motion see the badge still', /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.nwc-animate \.nwc-shine[^}]*animation: none;[^}]*\}\s*\.nwc-shine \{ display: none; \}/.test(css));
    check('the shimmer runs continuously (repeats for as long as the card is open)', /\.nwc-animate \.nwc-shine \{ animation: nwc-sweep [\d.]+s ease-in-out infinite; \}/.test(css));
    check('the Community styles are in their own file, versioned, and the website’s own styles and scripts are untouched',
      /^\/css\/community\.css\?v=\d+$/.test(COMMUNITY_CSS) && !fs.readFileSync(path.join(root, 'public', 'css', 'site.css'), 'utf8').includes('nwc-'));
    check('addresses: readable, safe and short', slugify('Thank you, Siobhán O’Neil!') === 'thank-you-siobhan-oneil' && postPath({ id: 7, slug: 'thank-you-x' }) === '/community/7-thank-you-x');
  }

  const dev = await start(8930); servers.push(dev);
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');

  console.log('\nThe hidden public card page');
  {
    const none = await req(dev.base, '/community/1');
    check('with no published card, the address is simply “not found”', none.status === 404 && none.headers.get('x-robots-tag') === 'noindex, nofollow');
    const layout = JSON.stringify(sampleLayout('04'));
    db.prepare(`INSERT INTO community_posts (id, slug, status, title, medium_name, wed_date, background, layout_json, animate_logo, text_shadow)
      VALUES (5, 'thank-you-test-medium', 'draft', 'Thank you, [Test] Medium', '[Test] Medium', '2026-10-14', '04', ?, 1, 1)`).run(layout);
    check('a draft card is never shown to the public', (await req(dev.base, '/community/5-thank-you-test-medium')).status === 404);
    db.exec(`UPDATE community_posts SET status = 'published', published_at = '2026-10-14T21:00:00.000Z' WHERE id = 5`);
    const res = await req(dev.base, '/community/5-thank-you-test-medium');
    const page = await res.text();
    check('a published card has its own page', res.status === 200 && page.includes('<h1 class="screen-title" tabindex="-1">Thank you, [Test] Medium</h1>') && page.includes('class="nwc-card nwc-animate"'));
    check('while hidden, the page asks Google not to list it', page.includes('<meta name="robots" content="noindex, nofollow">') && res.headers.get('x-robots-tag') === 'noindex, nofollow');
    check('its Facebook link is the card’s own address, not the home page',
      page.includes('<meta property="og:url" content="http://localhost:8930/community/5-thank-you-test-medium">') && page.includes('<link rel="canonical" href="http://localhost:8930/community/5-thank-you-test-medium">'));
    check('its Facebook title is the card’s title', page.includes('<meta property="og:title" content="Thank you, [Test] Medium">'));
    check('before a Facebook picture is made (Stage 3), the usual New Way’s picture is used', page.includes('/images/share-1200x630.jpg'));
    db.exec(`UPDATE community_posts SET share_key = 'community/share-5-abc.jpg' WHERE id = 5`);
    const withShare = await text(dev.base, '/community/5-thank-you-test-medium');
    check('once a Facebook picture exists, the preview uses it at 1200 × 630', withShare.includes('<meta property="og:image" content="http://localhost:8930/media/community/share-5-abc.jpg">') &&
      withShare.includes('<meta property="og:image:width" content="1200">') && withShare.includes('<meta property="og:image:height" content="630">'));
    const moved = await req(dev.base, '/community/5');
    check('a short or old address goes to the card’s full address', moved.status === 301 && moved.headers.get('location') === '/community/5-thank-you-test-medium');
    check('the Community styles load with the card (and also after moving between pages in the app)', page.includes(`<link rel="stylesheet" href="${COMMUNITY_CSS.replace('&', '&amp;')}">`) && page.indexOf('community.css') > page.indexOf('id="page"'));
    db.exec(`UPDATE community_posts SET animate_logo = 0, text_shadow = 0 WHERE id = 5`);
    const still = await text(dev.base, '/community/5-thank-you-test-medium');
    check('the card’s own Animate Logo and Text shadow settings are followed', !still.includes('nwc-shine') && !still.includes('feDropShadow'));
    check('the card page has the same security rules as every other page', (await req(dev.base, '/community/5-thank-you-test-medium')).headers.get('content-security-policy') === (await req(dev.base, '/events')).headers.get('content-security-policy'));
    check('nothing can be sent to a Community address', (await req(dev.base, '/community/5-thank-you-test-medium', { method: 'POST', body: 'x=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 405);
    check('/community itself does not exist yet', (await req(dev.base, '/community')).status === 404);
    const home = await text(dev.base, '/');
    const sitemap = await text(dev.base, '/sitemap.xml');
    check('the Community is not in the menu, the tab bar or the sitemap', !home.includes('/community') && !(await text(dev.base, '/events')).includes('href="/community') && !sitemap.includes('/community'));
    check('other pages do not load the Community styles', !home.includes('community.css'));
  }

  console.log('\nAdmin: Community preview (Gary and Julie only)');
  {
    const out = await req(dev.base, '/admin/community/preview');
    check('signed out: the preview asks for sign-in', out.status === 401 && !(await out.text()).includes('nwc-card'));
    const { jar: g } = await signIn(dev, 'owner');
    const home = await text(dev.base, '/admin', { jar: g });
    check('Admin home has a Community cards button', home.includes('href="/admin/community"') && home.includes('Community cards'));
    const pv = await text(dev.base, '/admin/community/preview', { jar: g });
    check('the preview shows all nine designs, each with the sample card', BACKGROUNDS.every((b) => pv.includes(`<h2>Design ${b}</h2>`)) && !pv.includes('Design 07') && (pv.match(/class="nwc-card/g) || []).length === 9);
    check('it says clearly that it is not public, and the wording is a sample', pv.includes('Not public yet.') && pv.includes('Sample Medium Name'));
    check('Animate Logo and Text shadow start On', pv.includes('aria-pressed="true">Animate Logo: On') && pv.includes('aria-pressed="true">Text shadow: On') && (pv.match(/nwc-shine/g) || []).length >= 9);
    const noShimmer = await text(dev.base, '/admin/community/preview?shimmer=0&shadow=1', { jar: g });
    check('Animate Logo Off: all nine badges are still', !noShimmer.includes('class="nwc-shine"') && noShimmer.includes('Animate Logo: Off') && noShimmer.includes('feDropShadow'));
    const noShadow = await text(dev.base, '/admin/community/preview?shimmer=1&shadow=0', { jar: g });
    check('Text shadow Off: no shadow on any card', !noShadow.includes('feDropShadow') && noShadow.includes('Text shadow: Off') && noShadow.includes('class="nwc-shine"'));
    check('it suggests the next design from the rotation', pv.includes('the next card would start with <strong>Design 01</strong>'));
    db.prepare(`INSERT INTO admin_users (email, name) VALUES ('julie.helper@example.test', 'Julie')`).run();
    const julie = await signIn(dev, 'julie');
    check('Julie (full Admin) can open the preview', (await req(dev.base, '/admin/community/preview', { jar: julie.jar })).status === 200);
    db.prepare(`INSERT INTO checkin_helpers (email, name) VALUES ('someone.else@example.test', 'Door helper')`).run();
    const helper = await signIn(dev, 'other');
    const hp = await req(dev.base, '/admin/community/preview', { jar: helper.jar });
    check('a check-in helper cannot', hp.status === 403 && !(await hp.text()).includes('nwc-card'));
    const backup = await (await req(dev.base, '/admin/backups/download', { jar: g })).json();
    check('backups include the Community cards and rotation', Array.isArray(backup.tables.community_posts) && backup.tables.community_posts.length === 1 && Array.isArray(backup.tables.community_rotation));
  }

  console.log('\nStage 3: the thank-you card editor (drafts, publishing, Facebook picture and link)');
  {
    const { jar: g } = await signIn(dev, 'owner');
    const fix = (f) => fs.readFileSync(path.join(root, 'tests', 'fixtures', f));
    const csrfOf = async (jar) => jar.c.nw_csrf || (((await text(dev.base, '/admin', { jar })).match(/name="_csrf" value="([^"]+)"/) || [])[1]);
    const post = async (jar, p, fields = {}, files = {}, withCsrf = true) => {
      const fd = new FormData();
      if (withCsrf) fd.append('_csrf', await csrfOf(jar));
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.buf], { type: f.type }), f.name);
      return req(dev.base, p, { jar, method: 'POST', body: fd });
    };
    const share = { buf: fix('community-share-1200x630.jpg'), type: 'image/jpeg', name: 'facebook-preview.jpg' };
    const row = (id) => db.prepare('SELECT * FROM community_posts WHERE id = ?').get(id);
    // the editor's form, as the phone sends it (every control has a value)
    const editorFields = (overrides = {}) => {
      const base = { medium_name: 'Jane Smith', wed_date: '2026-10-14', background: '03', animate_logo: '1', text_shadow: '1', badge_show: '1', badge_x: '1062', badge_y: '132', badge_size: '180',
        heading_text: 'Thank You', message_text: 'for a wonderful Wednesday evening\nat New Way’s', date_text: 'Wednesday 14 October 2026' };
      for (const r of ['heading', 'name', 'message', 'date']) Object.assign(base, { [r + '_font']: r === 'message' || r === 'date' ? 'jost' : 'cinzel', [r + '_size']: '40', [r + '_weight']: '600', [r + '_color']: '#ffffff', [r + '_anchor']: 'middle', [r + '_x']: '640', [r + '_y']: String({ heading: 180, name: 262, message: 322, date: 420 }[r]) });
      return { ...base, ...overrides };
    };

    const list = await text(dev.base, '/admin/community', { jar: g });
    check('Admin › Community cards lists drafts and published cards, with New thank-you card', list.includes('New thank-you card') && list.includes('<h2 class="nwc-h2">Drafts</h2>') && list.includes('not public yet'));
    const noToken = await post(g, '/admin/community/new', {}, {}, false);
    const before = db.prepare('SELECT COUNT(*) AS n FROM community_posts').get().n;
    check('nothing can be made without the page’s security token', noToken.status === 403 && db.prepare('SELECT COUNT(*) AS n FROM community_posts').get().n === before);

    const made = await post(g, '/admin/community/new');
    const id = Number((made.headers.get('location') || '').match(/\/admin\/community\/(\d+)/)?.[1]);
    const card = row(id);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const expected = db.prepare(`SELECT name, date FROM mediums WHERE visible = 1 AND date <= ? ORDER BY date DESC LIMIT 1`).get(today);
    check('New thank-you card makes a draft (never published automatically)', made.status === 303 && card && card.status === 'draft' && !card.published_at);
    check('the guest medium’s name and Wednesday date come from Who’s On', card.medium_name === expected.name && card.wed_date === expected.date && card.title === 'Thank you, ' + expected.name);
    const rotationNow = db.prepare('SELECT used, last FROM community_rotation WHERE id = 1').get();
    check('the background is the next design in the rotation', card.background === suggestBackground({ used: JSON.parse(rotationNow.used), last: rotationNow.last }));
    const L0 = JSON.parse(card.layout_json);
    check('it starts from the approved design: heading, name, message, date line and the badge', JSON.stringify(L0.texts.map((t) => t.role)) === '["heading","name","message","date"]' && L0.texts[1].lines[0] === expected.name && L0.badge.show === true);
    check('a draft is never shown to the public', (await req(dev.base, `/community/${id}`)).status === 404);

    const ed = await text(dev.base, `/admin/community/${id}`, { jar: g });
    check('the editor has the live card, the move buttons and every control', ed.includes('data-preview') && ed.includes('class="nwc-card') && ed.includes('data-nudge="0,-6"') && ed.includes('data-resize="0.08"') &&
      ed.includes('name="heading_font"') && ed.includes('name="heading_size"') && ed.includes('name="heading_color"') && ed.includes('name="badge_size"') && ed.includes('name="badge_x"') &&
      ed.includes('name="animate_logo"') && ed.includes('name="text_shadow"'));
    check('all nine backgrounds can be chosen, and there is a Next Design button', BACKGROUNDS.every((b) => ed.includes(`name="background" value="${b}"`)) && ed.includes('data-next-design>Next Design</button>'));
    check('Who’s On mediums are offered to choose from', ed.includes('data-whos-on') && ed.includes(`data-name="${expected.name}"`));
    check('it has Save draft and Publish (no Copy Facebook Link until published)', ed.includes('>Save draft</button>') && ed.includes('data-publish>Publish</button>') && !ed.includes('data-copy-link'));
    check('Download Facebook Image is there for drafts too', ed.includes('data-download hidden>Download Facebook Image</button>'));
    check('the editor’s scripts are loaded from this website only (no inline scripts or styles)', ed.includes('<script src="/js/community-card.js?v=') && ed.includes('<script src="/js/community-editor.js?v=') && !/<script>(?!<\/script>)/.test(ed) && !/\sstyle="/.test(ed));

    // Save a draft with the wording, lettering, colour and positions changed
    const saved = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'save', heading_text: 'With Love & <Thanks>', heading_font: 'vibes', heading_size: '120', heading_color: '#F8B709', heading_x: '600', heading_y: '170', heading_anchor: 'start', badge_size: '220', badge_x: '150', animate_logo: '', text_shadow: '' }));
    const c1 = row(id), L1 = JSON.parse(c1.layout_json), h1 = L1.texts.find((t) => t.role === 'heading');
    check('Save draft keeps every change and stays a draft', saved.status === 303 && saved.headers.get('location') === `/admin/community/${id}?flash=saved` && c1.status === 'draft' &&
      h1.lines[0] === 'With Love & <Thanks>' && h1.font === 'vibes' && h1.size === 120 && h1.color === '#F8B709' && h1.x === 600 && h1.anchor === 'start' && L1.badge.size === 220 && L1.badge.x === 150);
    check('the name and date are saved, and the medium’s name is on the card', c1.medium_name === 'Jane Smith' && c1.wed_date === '2026-10-14' && c1.title === 'Thank you, Jane Smith' && L1.texts.find((t) => t.role === 'name').lines[0] === 'Jane Smith');
    check('Animate Logo and Text shadow can be switched off', c1.animate_logo === 0 && c1.text_shadow === 0 && L1.shimmer === false && L1.shadow === false);
    check('saving a draft needs no Facebook picture', !c1.share_key);
    const ed2 = await text(dev.base, `/admin/community/${id}`, { jar: g });
    check('wording typed in is always shown as text, never as page code', ed2.includes('With Love &amp; &lt;Thanks&gt;') && !ed2.includes('<Thanks>'));
    const bad = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'save', heading_font: 'Comic Sans', heading_color: 'red', heading_size: '999', badge_x: '-50', message_text: 'a\nb\nc\nd\ne' }));
    check('too many message lines are refused, and nothing is saved', bad.status === 422 && (await bad.text()).includes('no more than 4 lines') && row(id).layout_json === c1.layout_json);
    await post(g, `/admin/community/${id}/save`, editorFields({ action: 'save', heading_font: 'Comic Sans', heading_color: 'red', heading_size: '999', badge_x: '-50' }));
    const L2 = JSON.parse(row(id).layout_json), h2 = L2.texts.find((t) => t.role === 'heading');
    check('unknown lettering, colours and out-of-range sizes are corrected on the server', h2.font === 'cinzel' && h2.color === '#FFFFFF' && h2.size === 160 && L2.badge.x === 0);
    const noName = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'save', medium_name: '   ' }));
    check('a card needs the guest medium’s name', noName.status === 422 && (await noName.text()).includes('Please enter the guest medium’s name.') && row(id).medium_name === 'Jane Smith');
    const emptyDate = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'save', date_text: '' }));
    check('leaving a line’s wording empty simply leaves it off the card', emptyDate.status === 303 && !JSON.parse(row(id).layout_json).texts.some((t) => t.role === 'date'));
    const beforeNext = row(id).layout_json;
    const next = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'next', background: '10' }));
    const nextPage = await next.text();
    check('Next Design moves through the designs (10 goes round to 01) without saving anything', next.status === 200 && nextPage.includes('name="background" value="01" checked') && row(id).layout_json === beforeNext);

    // Publishing needs the finished Facebook picture (made on the phone from the same layout)
    const noPic = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'publish' }));
    check('Publish without the Facebook picture is refused, and nothing is published', noPic.status === 400 && (await noPic.text()).includes('nothing was published') && row(id).status === 'draft');
    const wrongSize = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'publish' }), { share_image: { buf: fix('community-share-wrong-size.jpg'), type: 'image/jpeg', name: 'x.jpg' } });
    const png = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'publish' }), { share_image: { buf: fix('community-share.png'), type: 'image/jpeg', name: 'x.jpg' } });
    check('the Facebook picture must really be a 1200 × 630 JPEG', wrongSize.status === 400 && png.status === 400 && row(id).status === 'draft' && !row(id).share_key);
    const pub = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'publish' }), { share_image: share });
    const c3 = row(id);
    check('Publish (with the picture) publishes the card', pub.status === 303 && pub.headers.get('location') === `/admin/community/${id}?flash=published` && c3.status === 'published' && !!c3.published_at);
    check('its address is fixed from the title', c3.slug === 'thank-you-jane-smith');
    const media = db.prepare('SELECT * FROM media WHERE key = ?').get(c3.share_key);
    check('the Facebook picture is stored with the website’s photos', /^img\/\d{4}\/\d{2}\/community-share-[a-z0-9]+\.jpg$/.test(c3.share_key) && media && media.width === 1200 && media.height === 630 && media.content_type === 'image/jpeg');
    const r3 = db.prepare('SELECT used, last FROM community_rotation WHERE id = 1').get();
    check('publishing crosses the design off in the rotation', JSON.parse(r3.used).includes('03') && r3.last === '03');
    const pubRes = await req(dev.base, `/community/${id}-thank-you-jane-smith`);
    const pubPage = await pubRes.text();
    check('the published card has its own Community page', pubRes.status === 200 && pubPage.includes('Thank you, Jane Smith') && pubPage.includes('class="nwc-card'));
    check('its Facebook preview uses the finished card picture, and links to this card (not the home page)', pubPage.includes(`<meta property="og:image" content="${dev.base}/media/${c3.share_key}">`) &&
      pubPage.includes(`<meta property="og:url" content="${dev.base}/community/${id}-thank-you-jane-smith">`));
    const picture = await req(dev.base, `/media/${c3.share_key}`);
    check('…and that picture can be fetched (as Facebook will)', picture.status === 200 && picture.headers.get('content-type') === 'image/jpeg' && Buffer.from(await picture.arrayBuffer()).equals(share.buf));
    check('the Community is still not in the menu or sitemap', !(await text(dev.base, '/')).includes('/community') && !(await text(dev.base, '/sitemap.xml')).includes('/community'));

    const ed3 = await text(dev.base, `/admin/community/${id}`, { jar: g });
    check('once published: Copy Facebook Link with the card’s full address, Download Facebook Image, and Save and update', ed3.includes('data-copy-link>Copy Facebook Link</button>') &&
      ed3.includes(`value="${dev.base}/community/${id}-thank-you-jane-smith" readonly data-link-input`) && ed3.includes('Download Facebook Image') && ed3.includes('>Save and update published card</button>') && !ed3.includes('data-publish>'));

    // Changing a published card: the Facebook picture must be updated too
    const noPic2 = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'save', heading_text: 'Changed' }));
    check('a published card can’t be changed without its new Facebook picture', noPic2.status === 400 && JSON.parse(row(id).layout_json).texts[0].lines[0] !== 'Changed');
    const oldKey = c3.share_key;
    const upd = await post(g, `/admin/community/${id}/save`, editorFields({ action: 'save', heading_text: 'Changed', medium_name: 'Jane Smith-Jones' }), { share_image: share });
    const c4 = row(id);
    check('Save and update changes the published card and its Facebook picture', upd.status === 303 && upd.headers.get('location') === `/admin/community/${id}?flash=updated` && c4.status === 'published' &&
      JSON.parse(c4.layout_json).texts[0].lines[0] === 'Changed' && c4.share_key !== oldKey && c4.published_at === c3.published_at);
    check('the old Facebook picture is removed', !db.prepare('SELECT 1 FROM media WHERE key = ?').get(oldKey) && !fs.existsSync(path.join(root, 'dev', '.local', 'media', oldKey)));
    check('links already shared keep working (the address does not change when the name is edited)', c4.slug === 'thank-you-jane-smith' && (await req(dev.base, `/community/${id}-thank-you-jane-smith`)).status === 200);
    check('a published card can’t be deleted', (await post(g, `/admin/community/${id}/delete`)).status === 409 && !!row(id));
    const un = await post(g, `/admin/community/${id}/unpublish`);
    check('Move back to drafts hides its Community page', un.status === 303 && row(id).status === 'draft' && (await req(dev.base, `/community/${id}-thank-you-jane-smith`)).status === 404);

    // Julie (full Admin) can make and publish cards; a check-in helper can't
    const julie = await signIn(dev, 'julie');
    const jm = await post(julie.jar, '/admin/community/new');
    const jid = Number((jm.headers.get('location') || '').match(/\/admin\/community\/(\d+)/)?.[1]);
    const jp = await post(julie.jar, `/admin/community/${jid}/save`, editorFields({ action: 'publish', medium_name: 'Julie’s Medium' }), { share_image: share });
    check('Julie can create and publish cards too (and it records who did it)', jm.status === 303 && jp.status === 303 && row(jid).status === 'published' && /julie/i.test(row(jid).created_by + row(jid).updated_by));
    const helper = await signIn(dev, 'other');
    check('a check-in helper can’t see or make cards', (await req(dev.base, '/admin/community', { jar: helper.jar })).status === 403 && (await post(helper.jar, '/admin/community/new')).status === 403);
    check('signed out, nothing can be seen or changed', (await req(dev.base, '/admin/community')).status === 401 && (await req(dev.base, `/admin/community/${jid}/unpublish`, { method: 'POST', body: '' })).status === 403);

    const dm = await post(g, '/admin/community/new');
    const did = Number((dm.headers.get('location') || '').match(/\/admin\/community\/(\d+)/)?.[1]);
    const del = await post(g, `/admin/community/${did}/delete`);
    check('a draft can be deleted', del.status === 303 && !row(did));
    const audit = db.prepare(`SELECT action FROM audit_log WHERE action LIKE 'community.%'`).all().map((r) => r.action);
    check('every publish, update, move back and delete is recorded', ['community.new', 'community.publish', 'community.update', 'community.unpublish', 'community.delete'].every((a) => audit.includes(a)));
    const listAfter = await text(dev.base, '/admin/community', { jar: g });
    check('the list shows drafts and published cards', listAfter.includes('Thank you, Jane Smith-Jones') && listAfter.includes('chip-live'));
  }

  console.log('\nStage 3: one set of drawing rules for the website, the editor and the Facebook picture');
  {
    const shared = fs.readFileSync(path.join(root, 'public', 'js', 'community-card.js'), 'utf8');
    const serverCard = fs.readFileSync(path.join(root, 'src', 'community', 'card.js'), 'utf8');
    check('the website and the editor use the same drawing file', serverCard.includes("import '../../public/js/community-card.js';") && shared.includes('root.NWCard'));
    check('the Facebook image is drawn from the same layout, with the badge still (no shimmer)', /function paint\(ctx, L, width, height, bgImg, logoImg\)/.test(shared) && !shared.slice(shared.indexOf('function paint')).split('function exportJpeg')[0].includes('shine'));
    check('the downloaded picture is 1733 × 910 (the backgrounds’ own sharpness, ≈1.9:1), the link preview 1200 × 630', fs.readFileSync(path.join(root, 'public', 'js', 'community-editor.js'), 'utf8').includes('{ width: 1733, height: 910, quality: 0.92 }') &&
      fs.readFileSync(path.join(root, 'public', 'js', 'community-editor.js'), 'utf8').includes('{ width: 1200, height: 630, quality: 0.9 }'));
    const editorJs = fs.readFileSync(path.join(root, 'public', 'js', 'community-editor.js'), 'utf8');
    check('Publish and updating a published card always ask first', editorJs.includes("window.confirm(question)") && editorJs.includes('Publish this thank-you card now?'));
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
