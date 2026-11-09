// Automated tests for emails to mailing-list subscribers (Admin › Mailing list › SEND EMAIL TO SUBSCRIBERS):
// only subscribers, never twice, test first, each with its own unsubscribe link, daily limit, failures, delivery news,
// and the clearer (never pre-ticked) invitation at checkout.
// Run with: npm test, or on its own: node tests/mailing.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== '' ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
}
const PORT = 8965;
function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `mailing-${port}.sqlite`);
  for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: `http://localhost:${port}` }, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', (d) => { if (String(d).includes('local test copy')) { clearTimeout(timer); resolve({ child, base: `http://localhost:${port}`, mock: `http://localhost:${port + 100}`, dbFile }); } });
    child.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  });
}
class Jar {
  constructor() { this.c = {}; }
  add(res) { for (const sc of res.headers.getSetCookie()) { const [p] = sc.split(';'); const i = p.indexOf('='); const v = p.slice(i + 1).trim(); if (v) this.c[p.slice(0, i).trim()] = v; else delete this.c[p.slice(0, i).trim()]; } }
  header() { return Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join('; '); }
}
let base = '';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
async function req(p, { jar, method = 'GET', body, ua } = {}) {
  const h = {};
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET') h.Origin = base;
  if (ua) h['User-Agent'] = ua;
  const res = await fetch(base + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}
const text = async (p, o) => (await req(p, o)).text();
async function signIn(who) {
  const jar = new Jar();
  const login = await req('/admin/login', { jar });
  const auth = await (await fetch(login.headers.get('location'))).text();
  const link = (auth.match(new RegExp(`id="as-${who}" href="([^"]+)"`)) || [])[1];
  const cb = new URL(link.replace(/&amp;/g, '&'));
  await req(cb.pathname + cb.search, { jar });
  return jar;
}
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// The hidden fields of the first form on a page whose pay value is `pay`
function payForm(htmlText, pay) {
  const forms = htmlText.split('<form').slice(1);
  const f = forms.find((x) => x.includes(`name="pay" value="${pay}"`));
  if (!f) return null;
  const out = {};
  for (const m of f.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) out[m[1]] = unesc(m[2]);
  return out;
}
const post = async (p, fields, opts = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return req(p, { method: 'POST', body: fd, ...opts });
};


const servers = [];
try {
  const dev = await start(PORT); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = await signIn('owner');
  const csrf = g.c.nw_csrf || (await text('/admin/door', { jar: g })).match(/data-csrf="([^"]+)"/)[1];
  const emails = async () => (await (await fetch(dev.mock + '/__emails')).json());
  const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const E = Number(db.prepare(`INSERT INTO events (name, date, start_time, sales_mode, price_pence, capacity, visible) VALUES ('Psychic Supper', ?, '19:00', 'online', 2500, 40, 1)`).run(future).lastInsertRowid);
  const M = Number(db.prepare(`INSERT INTO mediums (date, name, location, visible) VALUES (?, 'Mary Medium', 'Glasgow', 1)`).run(future).lastInsertRowid);
  db.exec(`DELETE FROM mailing_list`);
  const add = (email, name, status = 'subscribed') => db.prepare(`INSERT INTO mailing_list (email, name, status, source, consent_text, unsubscribe_token, subscribed_at, updated_at)
    VALUES (?, ?, ?, 'Join page', 'Yes please', ?, datetime('now'), datetime('now'))`).run(email, name, status, 'tok' + Math.random().toString(36).slice(2).padEnd(24, 'x'));
  add('anne@example.test', 'Anne Smith'); add('bob@example.test', ''); add('carol@example.test', 'Carol Jones'); add('gone@example.test', 'Gone Person', 'unsubscribed');
  // a customer who booked but did NOT tick the box: never emailed
  db.prepare(`INSERT INTO event_bookings (event_id, reference, source, status, purchaser_name, purchaser_email, quantity, total_pence, checkin_token, marketing_opt_in)
    VALUES (?, 'EV-NOTICK', 'online', 'confirmed', 'No Tick', 'notick@example.test', 1, 2500, 'NoTickToken0000000000a', 0)`).run(E);
  const mine = (all, id) => all.filter((m) => m.batch && String(m.idempotency).startsWith(`nw-mail-${id}-`));
  const newEmail = async (fields) => post('/admin/mailing-list/emails/new', { _csrf: csrf, ...fields }, { jar: g });
  const act = (id, a, f = {}) => post(`/admin/mailing-list/emails/${id}/${a}`, { _csrf: csrf, ...f }, { jar: g });

  console.log('\nThe button and writing an email');
  {
    const ml = await text('/admin/mailing-list', { jar: g });
    check('Admin › Mailing list has SEND EMAIL TO SUBSCRIBERS', ml.includes('href="/admin/mailing-list/emails"') && ml.includes('SEND EMAIL TO SUBSCRIBERS'));
    const list = await text('/admin/mailing-list/emails', { jar: g });
    check('…which says how many subscribers it goes to (only those who chose to join)', list.includes('<strong>3 people</strong>') && list.includes('WRITE A NEW EMAIL'));
    const form = await text('/admin/mailing-list/emails/new', { jar: g });
    check('an upcoming event and a Who’s On listing can be chosen for the link button', form.includes(`value="event:${E}"`) && form.includes(`value="medium:${M}"`) && form.includes('Psychic Supper'));
    const bad = await newEmail({ subject: '', body: 'x' });
    check('a subject and message are required', bad.status === 422 && (await bad.text()).includes('Please write a subject.'));
    const helper = await signIn('other');
    const hs = await req('/admin/mailing-list/emails', { jar: helper });
    check('nobody else can open it', hs.status !== 200 || !(await hs.text()).includes('WRITE A NEW EMAIL'));
  }

  let C;
  console.log('\nPreview and test');
  {
    const r = await newEmail({ subject: 'Psychic Supper on Friday', body: 'Join us for an evening of mediumship.\n\nMore details at https://example.test/info', link_ref: `event:${E}`, link_label: '' });
    C = Number((r.headers.get('location').match(/emails\/(\d+)/) || [])[1]);
    const pv = await text(`/admin/mailing-list/emails/${C}`, { jar: g });
    check('saved as a draft, with a preview: greeting, paragraphs, the gold button to the event, the unsubscribe link', r.status === 303 && pv.includes('Dear Mary,') && pv.includes('Join us for an evening of mediumship.') &&
      pv.includes(`href="${base}/events/${E}"`) && pv.includes('Find out more and book') && pv.includes('Unsubscribe from these emails') && pv.includes('Draft: not sent'));
    check('it shows how many it will go to: 3 subscribers', pv.includes('It will go to <strong>3 subscribers</strong>'));
    const early = await act(C, 'send', { checked: '1' });
    check('it can’t be sent before a test', early.headers.get('location').includes('flash=test-first') && (await emails()).filter((m) => m.batch).length === 0);
    const before = (await emails()).length;
    const t = await act(C, 'test', { to: 'gary@example.test' });
    const all = await emails();
    const test = all[all.length - 1];
    check('Send test email: one email to the address given, marked [TEST]', t.headers.get('location').includes('flash=tested') && all.length === before + 1 && String(test.to) === 'gary@example.test' && test.subject === '[TEST] Psychic Supper on Friday');
    check('…in the navy-and-gold style with the button', test.html.includes('#000428') && test.html.includes('#F8B709') && test.html.includes(`/events/${E}`));
    const noTick = await act(C, 'send', {});
    check('sending needs the tick (checked the test)', noTick.headers.get('location').includes('flash=tick') && (await emails()).filter((m) => m.batch).length === 0);
    // a change after the test means another test is needed
    await post(`/admin/mailing-list/emails/${C}/edit`, { _csrf: csrf, subject: 'Psychic Supper on Friday 4 December', body: 'Join us for an evening of mediumship.', link_ref: `event:${E}`, link_label: 'Book your place' }, { jar: g });
    check('after a change, a new test is needed', (await act(C, 'send', { checked: '1' })).headers.get('location').includes('flash=test-first'));
    await act(C, 'test', { to: 'gary@example.test' });
  }

  console.log('\nSending');
  {
    const s = await act(C, 'send', { checked: '1' });
    const sent = mine(await emails(), C);
    const to = sent.map((m) => m.to[0]).sort();
    check('sent to the 3 subscribers only (not the unsubscribed, not customers who didn’t tick)', s.headers.get('location').includes('flash=sending') && to.join() === 'anne@example.test,bob@example.test,carol@example.test', to);
    const anne = sent.find((m) => m.to[0] === 'anne@example.test');
    const tok = db.prepare(`SELECT unsubscribe_token FROM mailing_list WHERE email = 'anne@example.test'`).get().unsubscribe_token;
    check('each has their own unsubscribe link, and the one-click unsubscribe header', anne.html.includes(`/unsubscribe/${tok}`) && anne.text.includes(`/unsubscribe/${tok}`) && anne.headers['List-Unsubscribe'] === `<${base}/unsubscribe/${tok}>` && anne.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
    check('…addressed by first name, with the button wording chosen', anne.html.includes('Dear Anne,') && anne.html.includes('Book your place') && !sent.find((m) => m.to[0] === 'bob@example.test').html.includes('Dear ,'));
    const page = await text(`/admin/mailing-list/emails/${C}`, { jar: g });
    check('the email’s page shows it was sent, to how many, and each person', page.includes('<dt>Sent</dt><dd>3</dd>') && page.includes('Each person (3)') && db.prepare(`SELECT status FROM mail_campaigns WHERE id = ?`).get(C).status === 'sent');
    const again = await act(C, 'send', { checked: '1' });
    check('it can never be sent twice (pressing again does nothing)', again.headers.get('location').includes('flash=locked') && mine(await emails(), C).length === 3);
    check('…nor changed after sending', (await req(`/admin/mailing-list/emails/${C}/edit`, { jar: g })).headers.get('location').includes('flash=locked'));
    const list = await text('/admin/mailing-list/emails', { jar: g });
    check('previous emails are listed with what happened', list.includes('Psychic Supper on Friday 4 December') && list.includes('3 of 3 sent'));
    const d = await act(C, 'delivery');
    check('Update delivery news asks Resend what happened (delivered)', d.headers.get('location').includes('flash=checked') && (await text(`/admin/mailing-list/emails/${C}`, { jar: g })).includes('Delivered: 3'));
  }

  console.log('\nUnsubscribing');
  {
    const tok = db.prepare(`SELECT unsubscribe_token FROM mailing_list WHERE email = 'carol@example.test'`).get().unsubscribe_token;
    const look = await req('/unsubscribe/' + tok);
    check('the link in the email opens a page asking to confirm (so a link checker can’t unsubscribe someone by accident)', look.status === 200 && (await look.text()).includes('Unsubscribe') && db.prepare(`SELECT status FROM mailing_list WHERE email = 'carol@example.test'`).get().status === 'subscribed');
    const oneClick = await fetch(base + '/unsubscribe/' + tok, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    check('one-click unsubscribe (from the email app, no cookies or Origin) works and updates the mailing list', oneClick.status === 200 && db.prepare(`SELECT status FROM mailing_list WHERE email = 'carol@example.test'`).get().status === 'unsubscribed');
    check('…and the count goes down to 2', (await text('/admin/mailing-list/emails', { jar: g })).includes('<strong>2 people</strong>'));
  }

  console.log('\nLimits, failures and never twice');
  {
    add('dave@example.test', 'Dave'); add('erin@example.test', 'Erin'); add('bounce@example.test', 'Bouncy');
    // 3 already sent today; a limit of 5 leaves room for 2 now
    db.prepare(`INSERT INTO settings (key, value) VALUES ('mail_daily_limit', '5') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    const r = await newEmail({ subject: 'Second news', body: 'Another evening coming up.', link_ref: `medium:${M}` });
    const C2 = Number(r.headers.get('location').match(/emails\/(\d+)/)[1]);
    await act(C2, 'test', { to: 'gary@example.test' });
    await act(C2, 'send', { checked: '1' });
    check('the Who’s On button opens the medium’s own page', mine(await emails(), C2)[0].html.includes(`/whos-on/${M}`) && mine(await emails(), C2)[0].html.includes('See Mary Medium on Who’s On'));
    const n1 = mine(await emails(), C2).length;
    const page = await text(`/admin/mailing-list/emails/${C2}`, { jar: g });
    check('the daily limit is kept (2 sent now, 3 left for later), and it says so', n1 === 2 && page.includes('Still to send') && db.prepare(`SELECT status FROM mail_campaigns WHERE id = ?`).get(C2).status === 'sending');
    // someone unsubscribes before their turn: skipped
    const queued = db.prepare(`SELECT m.email FROM mail_campaign_recipients r JOIN mailing_list m ON m.id = r.subscriber_id WHERE r.campaign_id = ? AND r.status = 'queued' ORDER BY r.id`).all(C2).map((x) => x.email);
    db.prepare(`UPDATE mailing_list SET status = 'unsubscribed' WHERE email = ?`).run(queued[0]);
    db.prepare(`UPDATE settings SET value = '80' WHERE key = 'mail_daily_limit'`).run();
    // Resend is busy once: tried again later, never sent twice
    await fetch(dev.mock + '/__emails/fail-next?count=1');
    await act(C2, 'continue');
    check('a temporary failure at Resend: nothing marked sent, tried again', mine(await emails(), C2).length === n1 && db.prepare(`SELECT COUNT(*) AS n FROM mail_campaign_recipients WHERE campaign_id = ? AND status = 'queued'`).get(C2).n === 2);
    await act(C2, 'continue');
    const after = mine(await emails(), C2).map((m) => m.to[0]);
    check('…then sent, and someone who unsubscribed before their turn is skipped', after.length === 4 && !after.includes(queued[0]) && db.prepare(`SELECT r.status FROM mail_campaign_recipients r JOIN mailing_list m ON m.id = r.subscriber_id WHERE r.campaign_id = ? AND m.email = ?`).get(C2, queued[0]).status === 'skipped');
    check('nobody got the same email twice', new Set(after).size === after.length);
    check('the email is now complete', db.prepare(`SELECT status FROM mail_campaigns WHERE id = ?`).get(C2).status === 'sent');
    await act(C2, 'delivery');
    check('a bounced address shows as bounced', (await text(`/admin/mailing-list/emails/${C2}`, { jar: g })).includes('Bounced (address not working)'));

    // Resend refuses (permanent): recorded as failed with the reason
    const r3 = await newEmail({ subject: 'Third', body: 'A third message here.' });
    const C3 = Number(r3.headers.get('location').match(/emails\/(\d+)/)[1]);
    await act(C3, 'test', { to: 'gary@example.test' });
    await fetch(dev.mock + '/__emails/reject-next?count=1');
    await act(C3, 'send', { checked: '1' });
    const p3 = await text(`/admin/mailing-list/emails/${C3}`, { jar: g });
    check('a permanent refusal is recorded as failed, with Resend’s reason, and not retried', p3.includes('<dt>Failed</dt>') && p3.includes('Resend answered 422') && mine(await emails(), C3).length === 0);

    // an interruption mid-send: never sent again
    const r4 = await newEmail({ subject: 'Fourth', body: 'A fourth message here.' });
    const C4 = Number(r4.headers.get('location').match(/emails\/(\d+)/)[1]);
    await act(C4, 'test', { to: 'gary@example.test' });
    db.prepare(`UPDATE mail_campaigns SET status = 'sending', started_at = datetime('now'), recipients = 1 WHERE id = ?`).run(C4);
    const sid = db.prepare(`SELECT id FROM mailing_list WHERE email = 'anne@example.test'`).get().id;
    db.prepare(`INSERT INTO mail_campaign_recipients (campaign_id, subscriber_id, status, claimed_at, attempts) VALUES (?, ?, 'sending', ?, 1)`).run(C4, sid, new Date(Date.now() - 20 * 60000).toISOString());
    await act(C4, 'continue');
    check('an interrupted send is marked “interrupted” and NOT sent again (no duplicate)', db.prepare(`SELECT status FROM mail_campaign_recipients WHERE campaign_id = ?`).get(C4).status === 'unknown' && mine(await emails(), C4).length === 0);
  }

  console.log('\nThe hourly job carries on by itself');
  {
    add('fred@example.test', 'Fred');
    const r = await newEmail({ subject: 'Fifth', body: 'A fifth message here.' });
    const C5 = Number(r.headers.get('location').match(/emails\/(\d+)/)[1]);
    await act(C5, 'test', { to: 'gary@example.test' });
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'mail_daily_limit'`).run();
    await act(C5, 'send', { checked: '1' });
    const sentNow = mine(await emails(), C5).length;
    db.prepare(`UPDATE settings SET value = '80' WHERE key = 'mail_daily_limit'`).run();
    await fetch(base + '/__dev/cron?cron=' + encodeURIComponent('0 * * * *'));
    const later = mine(await emails(), C5);
    check('over the limit: the rest are sent by the hourly job, once each', sentNow === 0 && later.length === db.prepare(`SELECT COUNT(*) AS n FROM mailing_list WHERE status = 'subscribed'`).get().n && new Set(later.map((m) => m.to[0])).size === later.length, [sentNow, later.length]);
  }

  console.log('\nCheckout invitation and the public sign-up');
  {
    const book = await text(`/events/${E}/book?qty=1`);
    const form = book.includes('optin-box') ? book : await text(`/events/${E}/book`);
    check('the checkout invitation is clear (its own gold box) and never ticked for the customer', /class="optin-box"[\s\S]*?name="marketing" value="1">/.test(form) && !/name="marketing" value="1" checked/.test(form) && form.includes('Hear about future events?'));
    const join = await req('/join');
    check('anyone can join from the public Join page (linked in every page’s footer)', join.status === 200 && (await text('/')).includes('href="/join"'));
  }
} catch (err) {
  failed++;
  console.log('  FAIL the test run stopped: ' + (err && err.stack ? err.stack : err));
} finally {
  for (const s of servers) s.child.kill();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
