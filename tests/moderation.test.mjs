// Automated tests for New Way's Community, Stage 4: comment protection and moderation.
// The language check (with disguises and innocent words), links and contact details, scams, ticket sales and
// advertising, names, repeats, repeat offenders, reports, Admin's moderation screens, Test a Comment (which must never
// store, publish or send anything), the word lists, who may do what, and that nothing public has been switched on.
// Run with: npm test (after the other suites), or on its own: node tests/moderation.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { moderate, prepareLists, findLinks, checkName, tokenise, MESSAGES, fingerprint } from '../src/community/moderation.js';
import { reportComment, recordOutcome, moderateComment, visitorKey, screenComment, REPORTS_TO_HIDE } from '../src/community/comments.js';
import { makeD1 } from './support/d1.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 400) : '')); }
}

const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const freshDb = (file) => {
  if (fs.existsSync(file)) fs.rmSync(file);
  const db = new DatabaseSync(file);
  for (const f of migrations) db.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
  return db;
};
fs.mkdirSync(path.join(root, 'dev', '.local'), { recursive: true });
const unitFile = path.join(root, 'dev', '.local', 'moderation-unit.sqlite');
const unitDb = freshDb(unitFile);
const lists = prepareLists(unitDb.prepare('SELECT * FROM community_words').all());
const verdict = (text, extra = {}) => moderate({ text, ...extra }, { lists, ...(extra.ctx || {}) });
const all = (texts, want) => texts.map((t) => [t, verdict(t).verdict]).filter(([, v]) => v !== want);

function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `moderation-${port}.sqlite`);
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
  await req(srv.base, cb.pathname + cb.search, { jar });
  return jar;
}

const EXPECTED_CHECKS = 90;
const servers = [];
try {
  console.log('\nDatabase update 0019: only adds the moderation tables and the starter word lists');
  {
    const sql = fs.readFileSync(path.join(root, 'migrations', '0019_community_moderation.sql'), 'utf8').replace(/--.*$/gm, '');
    check('0019 comes straight after 0018', migrations.indexOf('0019_community_moderation.sql') === migrations.indexOf('0018_community_cards.sql') + 1);
    check('it never drops, deletes, alters or updates anything', !/(?:^|;)\s*(DROP|DELETE|ALTER|UPDATE)\b/i.test(sql));
    check('it creates only the four Community moderation tables', JSON.stringify([...sql.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1])) === '["community_words","community_comments","community_reports","community_visitors"]');
    const old = new DatabaseSync(':memory:');
    for (const f of migrations.filter((f) => f < '0019')) old.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    old.exec(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'fixtures.sql'), 'utf8'));
    const tables = () => old.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all().map((r) => r.name);
    const before = Object.fromEntries(tables().map((t) => [t, JSON.stringify(old.prepare(`SELECT * FROM ${t}`).all())]));
    old.exec(fs.readFileSync(path.join(root, 'migrations', '0019_community_moderation.sql'), 'utf8'));
    check('applied to an existing database, every existing record is exactly as it was', Object.entries(before).every(([t, rows]) => JSON.stringify(old.prepare(`SELECT * FROM ${t}`).all()) === rows));
    const n = old.prepare('SELECT action, COUNT(*) AS n FROM community_words GROUP BY action').all();
    check('the starter lists have block, hold and allow words', n.length === 3 && n.every((r) => r.n > 20), JSON.stringify(n));
    let refused = false;
    try { old.exec(`INSERT INTO community_comments (post_id, status) VALUES (1, 'live')`); } catch { refused = true; }
    let badge = false;
    try { old.exec(`INSERT INTO community_comments (post_id, status, official) VALUES (1, 'published', 'someone')`); } catch { badge = true; }
    check('the database only accepts proper comment states, and only Gary or Julie as official names', refused && badge);
  }

  console.log('\nThe language check');
  {
    const clean = ['Thank you so much Jane, what a wonderful evening! My mum came through and I was in tears. Love Jean xxx',
      'THANK YOU FOR A LOVELY NIGHT AT NEW WAYS, SEE YOU NEXT WEEK', 'My dad who died last year came through, it was so comforting.',
      'What the hell happened to the sound', 'Bloody brilliant night!', 'Amazing!!! Thank you!', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'Loved it, see you at 7.30pm next Wednesday!',
      'Thanks to Julie and Gary for a great night', 'My gran used to say "damn it" all the time and she said it tonight!'];
    check('normal thank-you messages are allowed (including capitals, kisses, passed loved ones)', all(clean, 'allow').length === 0, JSON.stringify(all(clean, 'allow')));
    const genuine = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'community-genuine-comments.txt'), 'utf8').split('\n').filter(Boolean);
    check(`${genuine.length} realistic thank-you messages (loved ones who passed, tickets questions, “bloody hell”, fundraising) are all allowed`, genuine.length >= 30 && all(genuine, 'allow').length === 0, JSON.stringify(all(genuine, 'allow')));
    const innocent = ['The cocktail bar in Scunthorpe was lovely, we stayed in Essex', 'I couldn’t help but snigger when the spirit mentioned his old Arsenal shirt',
      'We had a classic night, no time to kill', 'A blue tit flew into the window during the reading', 'Fat chance of me missing next week!', 'I hate that I missed last week',
      'Spotted dick and custard was my grandad’s favourite and she mentioned it!', 'He was a great passenger on the Titanic tour, so says the therapist from Sussex', 'Hello from Penistone and Middlesex',
      'Her assessment was spot on', 'She mentioned grapes and a glass of Shiite tea', 'Moby Dick was his favourite book', 'We read Dickens at school', 'They rapped on the table'];
    check('innocent words that contain a strong word are never blocked or held (Scunthorpe, cocktail, snigger, Essex, blue tit…)', all(innocent, 'allow').length === 0, JSON.stringify(all(innocent, 'allow')));
    const swear = ['What a load of shit', 'You are full of sh1t', 'You are full of $hit', 'what a sh!te night', 'f**k this place', 'fuuuuuck that', 'What a f u c k i n g joke', 'f.u.c.k off', 'f_u_c_k',
      'FUCK', 'fück', 'ｆｕｃｋ', 'fu ck that', 'motherfuckers', 'Absolute c*nt', 'you tw4t', 'b1tch', 'wank3r', 'phuck', 'sh​it', 'shіt'];
    check('swearing is blocked, however it is disguised (numbers, symbols, spaces, dots, stretched letters, accents, look-alike letters, hidden characters)', all(swear, 'block').length === 0, JSON.stringify(all(swear, 'block')));
    check('…and the visitor is told exactly the agreed message', verdict('You are full of sh1t').message === MESSAGES.language && MESSAGES.language.includes('Please remove the inappropriate wording before posting.'));
    const hate = ['go back to your country', 'you p4ki', 'what a retard', 'n1gger', 'stupid spastic'];
    check('racist, discriminatory and hateful words are blocked', all(hate, 'block').length === 0, JSON.stringify(all(hate, 'block')));
    const sexual = ['send nudes', 'check my onlyfans', 'porn', 'what a slut', 'wh0re'];
    check('sexually explicit words are blocked', all(sexual, 'block').length === 0, JSON.stringify(all(sexual, 'block')));
    const threats = ['I know where you live', 'I hope you die', 'k i l l you', 'kys', 'watch your back', 'I will kill you'];
    check('threats are blocked', all(threats, 'block').length === 0, JSON.stringify(all(threats, 'block')));
    const unkind = ['You’re an idiot', 'This medium is a fake', 'What a fraud and a liar', 'Total waste of money', 'what a joke'];
    check('bullying, insults and accusations are held for Admin to look at (not published straight away)', all(unkind, 'hold').length === 0, JSON.stringify(all(unkind, 'hold')));
    const mild = ['I was pissed off I missed it', 'Moby Dick fan here, Dick Smith'];
    check('borderline words (such as a name that is also a rude word) are held, not blocked', mild.every((t) => verdict(t).verdict !== 'block'));
    const r = verdict('You are full of sh1t');
    check('Admin is told why, without spelling the word out', r.reasons.some((x) => x.detail.includes('“s**t”') && x.detail.includes('disguised')));
    check('the reasons say how it was hidden (symbols, split up, inside another word)', verdict('f**k').reasons[0].detail.includes('hidden with symbols') && verdict('fu ck').reasons[0].detail.includes('split up') && verdict('motherfuckers').reasons.some((x) => x.detail.includes('inside')));
    check('wording is broken into words in a way that keeps disguised letters together', JSON.stringify(tokenise('Sh1t! $hit, f.u.c.k')) === '["sh1t","$hit","fuck"]', JSON.stringify(tokenise('Sh1t! $hit, f.u.c.k')));
  }

  console.log('\nLinks, contact details and pictures');
  {
    const links = ['Visit www.mypsychic.com', 'https://example.org', 'check out mypsychic dot com', 'mypsychic(dot)co(dot)uk', 'mypsychic . com', 'bit.ly/abc', 'linktr.ee/reader',
      'wa.me/447700900123', 't.me/reader', 'paypal.me/reader', 'email me at jo@gmail.com', 'jo (at) hotmail dot com', 'my gmail is jo.reads', 'Call me on 07700 900123', 'ring +44 7700 900 123',
      'text 07700-900-123', 'see photo.jpg', '<img src=x>', 'mysite.online'];
    check('web addresses, short links, emails, phone numbers and pictures are blocked (also when spelled out)', all(links, 'block').length === 0, JSON.stringify(all(links, 'block')));
    check('…with the agreed message', verdict('Visit www.mypsychic.com').message === MESSAGES.link && MESSAGES.link === 'Links are not permitted in New Way’s Community comments. Please remove the link before posting.');
    const fine = ['Loved it, see you at 7.30pm next Wednesday!', 'It was on 14/10/2026 at 7pm', 'Amazing night.Me and my sister loved every minute', 'Table no. 12 was lovely', 'e.g. the bit about the dog',
      'Raised £250.50 for charity', 'She said 1999 was a big year'];
    check('times, dates, prices and a missing space after a full stop are not mistaken for links or phone numbers', all(fine, 'allow').length === 0, JSON.stringify(all(fine, 'allow')));
    check('something that might be a web address (evening.it) is held, not blocked', verdict('Go to evening.it for more').verdict === 'hold');
  }

  console.log('\nScams, ticket sales, money and advertising');
  {
    const scams = ['I have 2 spare tickets for Friday, message me', 'Selling my ticket for the Friday event £15', 'Can’t make Friday, anyone want my ticket? DM me', 'Got spare tickets, whatsapp me',
      '2 tickets going spare for the psychic supper', 'Tickets for sale', 'I do readings too, book a reading with me on my facebook page', 'Psychic readings £20, inbox me', 'Tarot readings only £10 message for details',
      'send me money on paypal', 'Donate to me please, my sort code is 12-34-56', 'Love the bitcoin opportunity, DM me', 'sp4re t1ckets, m3ssage me', 'Selling 2 seats for Friday, pay by bank transfer'];
    check('fake ticket sales, transfers, priced readings and requests for money are blocked (also when disguised)', all(scams, 'block').length === 0, JSON.stringify(all(scams, 'block')));
    check('…with the agreed message', verdict('Tickets for sale').message === MESSAGES.advert && MESSAGES.advert.startsWith('Your comment cannot be posted because it may contain advertising, ticket sales'));
    const questions = ['Are there any tickets left for the psychic supper on Friday?', 'How much are tickets for the Christmas night?', 'Is there parking at Thomson Park?', 'I’ll donate to the charity night next month',
      'Loved the private readings at New Way’s', 'Can I book a table for 4 at the psychic supper?'];
    check('ordinary questions about events, tickets and donations are allowed', all(questions, 'allow').length === 0, JSON.stringify(all(questions, 'allow')));
    const unsure = ['Is there a spare ticket for Friday?', 'Free readings this week only, link in bio', 'Earn money from home', 'Join my group for spiritual chats', 'This is Gary from New Way’s, please message me', 'Find me on Instagram'];
    check('suspicious messages that are not clearly scams are held for Admin', all(unsure, 'hold').length === 0, JSON.stringify(all(unsure, 'hold')));
  }

  console.log('\nVisitor names');
  {
    const n = (name, mediumNames = []) => moderate({ name, text: 'Thank you, lovely night' }, { lists, mediumNames });
    const reserved = ['Admin Gary', 'AdminJulie', 'Admin', 'Gary Findlay', 'Medium Gary', 'New Way’s', 'NewWays', 'New Ways Team', 'New Way’s Mediumship Development Centre', 'Official', 'Staff', 'Moderator',
      'Gary ✓', 'Julie ✔', 'Jean ✅', 'A d m i n', '4dmin Gary', 'Аdmin Julie'];
    const bad = reserved.filter((x) => n(x).verdict !== 'block');
    check('names that impersonate Admin, New Way’s, its staff, or use a tick or badge, are blocked (also disguised)', bad.length === 0, JSON.stringify(bad));
    check('…with a friendly message asking for a different name', n('Admin Gary').message === MESSAGES.name);
    const ok = ['Jean', 'Margaret Smith', 'Gary', 'Julie', 'Jo from Dundee', 'Mary-Ann O’Neil', 'Siobhán'];
    check('ordinary names are fine (including people who are simply called Gary or Julie)', ok.every((x) => n(x).verdict === 'allow'), JSON.stringify(ok.map((x) => [x, n(x).verdict])));
    check('a name matching one of the guest mediums is held for review', n('Jane Smith', ['Jane Smith']).verdict === 'hold' && n('jane  smith', ['Jane Smith']).verdict === 'hold' && n('Jane', ['Jane Smith']).verdict === 'allow');
    check('names with swearing or links are not accepted', n('Big Sh1t').verdict === 'block' && n('www.reader.com').verdict === 'block');
    check('a name is needed, and kept to 40 characters', n('').verdict === 'block' && n('x'.repeat(41)).verdict === 'block');
  }

  console.log('\nLength, repeats and repeat offenders');
  {
    check('an empty comment is not accepted, nor one over 1,000 characters', verdict('   ').verdict === 'block' && verdict('a'.repeat(1001)).message === MESSAGES.tooLong);
    check('the same visitor posting the same comment again is stopped', moderate({ text: 'Lovely night' }, { lists, sameFromVisitor: true }).verdict === 'block');
    check('the same wording from other visitors (copied spam) is held', moderate({ text: 'Lovely night' }, { lists, sameFromOthers: 2 }).verdict === 'hold');
    check('copied comments are recognised despite capitals, spaces and punctuation', (await fingerprint('Lovely night!!')) === (await fingerprint('  lovely   NIGHT ')) && (await fingerprint('Lovely night')) !== (await fingerprint('Lovely evening')));
    check('a visitor Admin has marked is always held', moderate({ text: 'Lovely night' }, { lists, visitor: { always_hold: 1 } }).verdict === 'hold');
    const env = { DB: makeD1(unitFile), SESSION_SECRET: 'x'.repeat(40) };
    for (let i = 0; i < 2; i++) await recordOutcome(env, 'vaaaa', 'block', 'Sam');
    const after2 = unitDb.prepare(`SELECT * FROM community_visitors WHERE visitor_key = 'vaaaa'`).get();
    check('one or two blocked comments never lead to holding (people can just change their wording)', after2.strikes === 2 && !after2.hold_until);
    await recordOutcome(env, 'vaaaa', 'block', 'Sam');
    const after3 = unitDb.prepare(`SELECT * FROM community_visitors WHERE visitor_key = 'vaaaa'`).get();
    check('three blocked comments within a day: that visitor’s comments are held for 7 days (never a permanent ban)', after3.strikes === 3 && Date.parse(after3.hold_until) > Date.now() + 6.9 * 86400_000 && Date.parse(after3.hold_until) < Date.now() + 7.1 * 86400_000);
    check('…and their next comment is held, with the reason shown to Admin', moderate({ text: 'Lovely night' }, { lists, visitor: after3 }).reasons.some((r) => r.code === 'visitor' && r.action === 'hold'));
    unitDb.prepare(`UPDATE community_visitors SET last_strike_at = ?, strikes = 2, hold_until = NULL WHERE visitor_key = 'vaaaa'`).run(new Date(Date.now() - 2 * 86400_000).toISOString());
    await recordOutcome(env, 'vaaaa', 'block', 'Sam');
    check('old blocked attempts (over a day ago) are not counted', unitDb.prepare(`SELECT strikes, hold_until FROM community_visitors WHERE visitor_key = 'vaaaa'`).get().strikes === 1);
    const mkReq = (ip, ua) => new Request('https://x.test/', { headers: { 'CF-Connecting-IP': ip, 'User-Agent': ua } });
    const k1 = await visitorKey(env, mkReq('81.2.69.160', 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0'));
    const k2 = await visitorKey(env, mkReq('81.2.69.161', 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0'));
    const k3 = await visitorKey(env, mkReq('81.2.70.160', 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0'));
    const k4 = await visitorKey(env, mkReq('81.2.69.160', 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0'), 'abcdefghijklmnop1234');
    check('the visitor code is a scrambled code, never the IP address', /^v[0-9a-f]{24}$/.test(k1) && !k1.includes('81.2'));
    check('…a browser update or a neighbouring address on the same network gives the same code; another network or the browser’s own code gives a different one', k1 === k2 && k1 !== k3 && k1 !== k4);
  }

  console.log('\nReports (the Report button arrives in Stage 5)');
  {
    const env = { DB: makeD1(unitFile) };
    const add = (fields) => Number(unitDb.prepare(`INSERT INTO community_comments (post_id, name, body, status, visitor_key, official, approved_by) VALUES (1, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .get(fields.name || 'Jo', fields.body || 'Lovely', fields.status || 'published', fields.visitor || 'vowner', fields.official || '', fields.approved_by || '').id);
    const c = add({});
    await reportComment(env, c, 'vr1'); await reportComment(env, c, 'vr1');
    await reportComment(env, c, 'vr2');
    check('one visitor reporting twice counts once', unitDb.prepare('SELECT report_count, status FROM community_comments WHERE id = ?').get(c).report_count === 2 && unitDb.prepare('SELECT status FROM community_comments WHERE id = ?').get(c).status === 'published');
    const third = await reportComment(env, c, 'vr3');
    const hiddenRow = unitDb.prepare('SELECT * FROM community_comments WHERE id = ?').get(c);
    check(`${REPORTS_TO_HIDE} reports from different visitors hide an ordinary comment until Admin looks at it`, third.hidden && hiddenRow.status === 'hidden' && JSON.parse(hiddenRow.reasons)[0].detail === 'reported by 3 different visitors');
    const own = add({ visitor: 'vself' });
    check('people can’t report their own comment', (await reportComment(env, own, 'vself')).reason === 'own-comment');
    const official = add({ official: 'gary', name: 'Admin Gary' });
    const approved = add({ approved_by: 'Julie' });
    for (const id of [official, approved]) for (const r of ['vx1', 'vx2', 'vx3', 'vx4']) await reportComment(env, id, r);
    check('reports alone never hide a verified Admin comment or one Admin has approved', ['published', 'published'].join() === [official, approved].map((id) => unitDb.prepare('SELECT status FROM community_comments WHERE id = ?').get(id).status).join());
    unitDb.prepare(`INSERT INTO community_visitors (visitor_key, reports_ignored) VALUES ('vabuser', 1)`).run();
    const c2 = add({});
    await reportComment(env, c2, 'vabuser'); await reportComment(env, c2, 'vy1'); await reportComment(env, c2, 'vy2');
    check('reports from a visitor whose reports Admin ignores do not count', unitDb.prepare('SELECT status, report_count FROM community_comments WHERE id = ?').get(c2).status === 'published');
    const held = add({ status: 'held' });
    check('a comment that isn’t published can’t be reported', (await reportComment(env, held, 'vz')).reason === 'not-found');
    const ap = await moderateComment(env, c, 'approve', 'Gary');
    check('Approve and restore publishes a hidden comment and protects it from further reports', ap.ok && unitDb.prepare('SELECT status, approved_by FROM community_comments WHERE id = ?').get(c).approved_by === 'Gary' && unitDb.prepare('SELECT status FROM community_comments WHERE id = ?').get(c).status === 'published');
  }

  const dev = await start(8940); servers.push(dev);
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn(dev, 'owner');
  const csrfOf = async (jar) => jar.c.nw_csrf || (((await text(dev.base, '/admin', { jar })).match(/name="_csrf" value="([^"]+)"/) || [])[1]);
  const post = async (jar, p, fields = {}, withCsrf = true) => {
    const fd = new FormData();
    if (withCsrf) fd.append('_csrf', await csrfOf(jar));
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return req(dev.base, p, { jar, method: 'POST', body: fd });
  };
  const counts = () => JSON.stringify(['community_comments', 'community_visitors', 'community_reports', 'community_words', 'rate_limits', 'audit_log', 'app_metrics'].map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n));

  console.log('\nAdmin: Test a Comment (the same checks as real comments; nothing stored, published or sent)');
  {
    const home = await text(dev.base, '/admin', { jar: g });
    check('Admin home has a Community moderation button', home.includes('href="/admin/community/moderation"') && home.includes('Community moderation'));
    const before = counts();
    const swear = await (await post(g, '/admin/community/moderation/test', { name: 'Sam', text: 'You are full of sh1t' })).text();
    check('BLOCK, with the reason and the message the visitor would see', swear.includes('nwc-verdict-block') && swear.includes('>BLOCK<') && swear.includes('“s**t”') && swear.includes(MESSAGES.language.replace(/’/g, '’')));
    const ok = await (await post(g, '/admin/community/moderation/test', { name: 'Jean', text: 'Thank you so much, lovely night xxx' })).text();
    check('ALLOW for a normal thank-you', ok.includes('nwc-verdict-allow') && ok.includes('>ALLOW<') && ok.includes('No problems found.'));
    const hold = await (await post(g, '/admin/community/moderation/test', { text: 'This medium is a fake' })).text();
    check('HOLD for something Admin should look at', hold.includes('nwc-verdict-hold') && hold.includes('>HOLD<'));
    const name = await (await post(g, '/admin/community/moderation/test', { name: 'Admin Gary', text: 'Hello' })).text();
    check('names are tested too', name.includes('>BLOCK<') && name.includes('administrator'));
    const medium = db.prepare(`SELECT name FROM mediums WHERE TRIM(name) != '' LIMIT 1`).get().name;
    check('a guest medium’s name (from Who’s On) is held', (await (await post(g, '/admin/community/moderation/test', { name: medium, text: 'Hello' })).text()).includes('>HOLD<'));
    const ex = await text(dev.base, '/admin/community/moderation/test?example=5', { jar: g });
    check('the example buttons fill in the box and test it straight away', ex.includes('>BLOCK<') && ex.includes('spare tickets'));
    check('the wording typed in is shown safely, never as page code', (await (await post(g, '/admin/community/moderation/test', { text: '<script>alert(1)</script>' })).text()).includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    check('testing stores nothing: no comment, visitor record, report, word, spam-limit, log entry or statistic', counts() === before, before + ' -> ' + counts());
  }

  console.log('\nAdmin: word lists');
  {
    const page = await text(dev.base, '/admin/community/moderation/words', { jar: g });
    check('the lists are shown, closed until opened (they contain offensive words)', page.includes('Blocked words and phrases (') && page.includes('Held for review (') && page.includes('Allowed (innocent) words (') && !/<details class="nwc-sec" open>/.test(page));
    const add = await post(g, '/admin/community/moderation/words/add', { phrase: '  Cheeky   MONKEY ', action: 'block', category: 'other' });
    const row = db.prepare(`SELECT * FROM community_words WHERE phrase = 'cheeky monkey'`).get();
    check('Gary or Julie can add a word or phrase (tidied to small letters and single spaces)', add.status === 303 && row && row.action === 'block' && row.source === 'admin' && row.added_by);
    check('…and Test a Comment uses it straight away (also disguised)', (await (await post(g, '/admin/community/moderation/test', { text: 'you ch33ky m0nkey!' })).text()).includes('>BLOCK<'));
    await post(g, '/admin/community/moderation/words/add', { phrase: 'cheeky monkey', action: 'hold', category: 'other' });
    check('adding a word that is already listed changes what happens to it', db.prepare(`SELECT action FROM community_words WHERE phrase = 'cheeky monkey'`).get().action === 'hold');
    const shite = db.prepare(`SELECT id FROM community_words WHERE phrase = 'shite'`).get().id;
    await post(g, `/admin/community/moderation/words/${shite}/delete`);
    check('removing a word takes effect straight away', !db.prepare(`SELECT 1 FROM community_words WHERE id = ?`).get(shite) && (await (await post(g, '/admin/community/moderation/test', { text: 'what a shite night' })).text()).includes('>ALLOW<'));
    await post(g, '/admin/community/moderation/words/add', { phrase: 'Grassmarket', action: 'allow', category: 'innocent' });
    check('innocent words can be allowed', db.prepare(`SELECT action FROM community_words WHERE phrase = 'grassmarket'`).get().action === 'allow');
    const bad = await post(g, '/admin/community/moderation/words/add', { phrase: 'x', action: 'block' });
    check('a single letter is refused', bad.status === 422 && !db.prepare(`SELECT 1 FROM community_words WHERE phrase = 'x'`).get());
    const found = await text(dev.base, '/admin/community/moderation/words?q=cheeky', { jar: g });
    check('Find a word opens the lists at the matches', found.includes('cheeky monkey') && found.includes('<details class="nwc-sec" open>'));
    check('changes to the lists are recorded', db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'community.words.%'`).get().n >= 3);
  }

  console.log('\nAdmin: held, hidden and published comments');
  {
    const ins = (status, extra = {}) => Number(db.prepare(`INSERT INTO community_comments (post_id, name, body, status, reasons, visitor_key) VALUES (1, ?, ?, ?, ?, 'vtest') RETURNING id`)
      .get(extra.name || 'Jo', extra.body || 'Lovely <b>night</b>', status, JSON.stringify(extra.reasons || [{ code: 'word', action: 'hold', detail: 'held word “f**e” (abuse)' }])).id);
    const h = ins('held');
    const list = await text(dev.base, '/admin/community/moderation', { jar: g });
    check('held comments are listed with the reason they were held', list.includes('Held for review (1)') && list.includes('held word “f**e” (abuse)') && list.includes('Lovely &lt;b&gt;night&lt;/b&gt;'));
    check('approve and reject buttons for held comments', list.includes(`/admin/community/moderation/comment/${h}/approve`) && list.includes(`/admin/community/moderation/comment/${h}/reject`));
    const noToken = await post(g, `/admin/community/moderation/comment/${h}/approve`, {}, false);
    check('nothing changes without the page’s security token', noToken.status === 403 && db.prepare('SELECT status FROM community_comments WHERE id = ?').get(h).status === 'held');
    await post(g, `/admin/community/moderation/comment/${h}/approve`);
    check('Approve publishes it and records who approved it', db.prepare('SELECT status, approved_by FROM community_comments WHERE id = ?').get(h).status === 'published' && !!db.prepare('SELECT approved_by FROM community_comments WHERE id = ?').get(h).approved_by);
    const r = ins('held');
    await post(g, `/admin/community/moderation/comment/${r}/reject`);
    check('Reject turns it down', db.prepare('SELECT status FROM community_comments WHERE id = ?').get(r).status === 'rejected');
    const p = ins('published');
    await post(g, `/admin/community/moderation/comment/${p}/hide`);
    check('Hide takes a published comment off the page', db.prepare('SELECT status FROM community_comments WHERE id = ?').get(p).status === 'hidden');
    const reply = Number(db.prepare(`INSERT INTO community_comments (post_id, parent_id, name, body, status) VALUES (1, ?, 'Ann', 'Agreed', 'published') RETURNING id`).get(p).id);
    await post(g, `/admin/community/moderation/comment/${p}/delete`);
    check('Delete removes a comment completely, with its replies', !db.prepare('SELECT 1 FROM community_comments WHERE id IN (?, ?)').get(p, reply));
    const twice = await post(g, `/admin/community/moderation/comment/${r}/reject`);
    check('an action that no longer applies is refused politely', twice.headers.get('location').includes('flash=not-allowed'));
    check('moderation actions are recorded', db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'community.comment.%'`).get().n === 4);
  }

  console.log('\nAdmin: repeat visitors');
  {
    db.prepare(`INSERT INTO community_visitors (visitor_key, strikes, blocked_total, last_name, last_strike_at, hold_until) VALUES ('v0123456789abcdef01234567', 3, 3, 'Spammy', ?, ?)`).run(new Date().toISOString(), new Date(Date.now() + 86400_000).toISOString());
    const page = await text(dev.base, '/admin/community/moderation/visitors', { jar: g });
    check('repeat visitors are listed (by the name they used and a short code, never an IP address)', page.includes('Spammy') && page.includes('v01234567') && page.includes('Held until'));
    await post(g, '/admin/community/moderation/visitors/v0123456789abcdef01234567/always-hold');
    await post(g, '/admin/community/moderation/visitors/v0123456789abcdef01234567/ignore-reports');
    const v = db.prepare(`SELECT * FROM community_visitors WHERE visitor_key = 'v0123456789abcdef01234567'`).get();
    check('Admin can hold all their comments and ignore their reports', v.always_hold === 1 && v.reports_ignored === 1);
    await post(g, '/admin/community/moderation/visitors/v0123456789abcdef01234567/clear');
    check('Clear record removes it', !db.prepare(`SELECT 1 FROM community_visitors WHERE visitor_key = 'v0123456789abcdef01234567'`).get());
  }

  console.log('\nWho can use moderation, and nothing public has been switched on');
  {
    db.prepare(`INSERT INTO admin_users (email, name) VALUES ('julie.helper@example.test', 'Julie')`).run();
    const julie = await signIn(dev, 'julie');
    check('Julie has exactly the same moderation screens', (await req(dev.base, '/admin/community/moderation', { jar: julie })).status === 200 &&
      (await req(dev.base, '/admin/community/moderation/words', { jar: julie })).status === 200 && (await (await post(julie, '/admin/community/moderation/test', { text: 'Lovely' })).text()).includes('>ALLOW<'));
    db.prepare(`INSERT INTO checkin_helpers (email, name) VALUES ('someone.else@example.test', 'Door helper')`).run();
    const helper = await signIn(dev, 'other');
    check('check-in helpers cannot open or use any of it', (await req(dev.base, '/admin/community/moderation', { jar: helper })).status === 403 &&
      (await req(dev.base, '/admin/community/moderation/test', { jar: helper })).status === 403 && (await post(helper, '/admin/community/moderation/words/add', { phrase: 'zzz', action: 'allow' })).status === 403);
    check('signed out, nothing can be seen', (await req(dev.base, '/admin/community/moderation/test')).status === 401);
    check('there is still no public way to post, report or react', (await req(dev.base, '/community/1/comments', { method: 'POST', body: 'x' })).status >= 404 && (await req(dev.base, '/community/comment', { method: 'POST', body: 'x' })).status >= 404);
    const home = await text(dev.base, '/');
    check('the Community is still not in the menu or sitemap', !home.includes('/community') && !(await text(dev.base, '/sitemap.xml')).includes('/community'));
    const backup = await (await req(dev.base, '/admin/backups/download', { jar: g })).json();
    check('backups include the word lists and moderation records', ['community_words', 'community_comments', 'community_reports', 'community_visitors'].every((t) => Array.isArray(backup.tables[t])) && backup.tables.community_words.length > 300);
  }

  console.log('\nThe live check (for Stage 5) uses the database the same way as the test');
  {
    const env = { DB: makeD1(dev.dbFile), SESSION_SECRET: 'x'.repeat(40) };
    db.prepare(`INSERT INTO community_comments (post_id, name, body, status, visitor_key, fingerprint) VALUES (1, 'A', 'Copied words here', 'published', 'vother', ?)`).run(await fingerprint('Copied words here'));
    const copied = await screenComment(env, { text: 'copied WORDS here!', name: 'B' }, { live: false });
    check('copied wording from another visitor is held', copied.verdict === 'hold' && copied.reasons.some((r) => r.code === 'copied'));
    const mine = await screenComment(env, { text: 'copied words here', name: 'A', visitor: 'vother' }, { live: false });
    check('the same visitor repeating themselves is stopped', mine.verdict === 'block' && mine.message === MESSAGES.repeat);
    const before = db.prepare('SELECT COUNT(*) AS n FROM community_visitors').get().n;
    await screenComment(env, { text: 'sh1t', name: 'B', visitor: 'vlive' }, { live: true });
    check('a real (live) blocked comment is counted against that visitor; a test never is', db.prepare('SELECT COUNT(*) AS n FROM community_visitors').get().n === before + 1);
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
