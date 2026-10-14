// Automated tests for the Wednesday till's night "by item" totals (each button: how many, cash, card, total) on the
// till, Close night, the night's report and its spreadsheet, and the cash "change to give" on the till.
// Run with: npm test, or on its own: node tests/till.test.mjs
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
  else { failed++; console.log('  FAIL ' + name + (detail !== '' ? '  -> ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : '')); }
}
function start(port) {
  const dbFile = path.join(root, 'dev', '.local', `till-${port}.sqlite`);
  const child = spawn(process.execPath, ['--no-warnings', 'dev/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), MOCK_PORT: String(port + 100), DB_FILE: dbFile, TEST_FIXTURES: '1', SITE_URL: `http://localhost:${port}` }, stdio: ['ignore', 'pipe', 'pipe']
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
async function req(p, { jar, method = 'GET', body } = {}) {
  const h = {};
  if (jar) h.Cookie = jar.header();
  if (method !== 'GET') h.Origin = base;
  const res = await fetch(base + p, { method, body, headers: h, redirect: 'manual' });
  if (jar) jar.add(res);
  return res;
}
const text = async (p, o) => (await req(p, o)).text();

const EXPECTED_CHECKS = 14;
const servers = [];
try {
  const dev = await start(8905); servers.push(dev);
  base = dev.base;
  const db = new DatabaseSync(dev.dbFile);
  db.exec('PRAGMA busy_timeout = 5000');
  const g = new Jar();
  const login = await req('/admin/login', { jar: g });
  const auth = await (await fetch(login.headers.get('location'))).text();
  const cb = new URL(auth.match(/id="as-owner" href="([^"]+)"/)[1].replace(/&amp;/g, '&'));
  await req(cb.pathname + cb.search, { jar: g });
  db.prepare(`INSERT INTO till_items (label, price_pence, custom_amount, category, enabled, online, sort_order) VALUES ('Juice', 100, 0, 'other', 1, 0, 99)`).run();
  const items = Object.fromEntries(db.prepare('SELECT * FROM till_items').all().map((i) => [i.label, i]));
  const page = await text('/admin/door', { jar: g });
  const csrf = page.match(/data-csrf="([^"]+)"/)[1];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  const sale = async (method, lines, expected) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ _csrf: csrf, date: today, method, client_ref: crypto.randomBytes(8).toString('hex'), expected_total: String(expected), lines: JSON.stringify(lines) })) fd.append(k, v);
    return (await req('/admin/door/sale', { jar: g, method: 'POST', body: fd })).json();
  };
  // Tonight: cash 2 Entry + 1 Gift Shop £4 + 1 Juice; card 1 Entry + 2 Development; a cancelled cash sale of 3 raffle strips
  await sale('cash', [{ item_id: items.Entry.id, qty: 2 }, { item_id: items['Gift Shop'].id, qty: 1, amount_pence: 400 }, { item_id: items.Juice.id, qty: 1 }], 1500);
  await sale('card', [{ item_id: items.Entry.id, qty: 1 }, { item_id: items.Development.id, qty: 2 }], 1100);
  const voided = await sale('cash', [{ item_id: items['Raffle strip'].id, qty: 3 }], 300);
  const fdv = new FormData(); fdv.append('_csrf', csrf);
  await req(`/admin/door/sale/${voided.saleId}/void`, { jar: g, method: 'POST', body: fdv });

  console.log('\nTonight by item');
  {
    const t = await (await req('/admin/door/totals?date=' + today, { jar: g })).json();
    const by = Object.fromEntries(t.items.map((i) => [i.label, i]));
    check('every button has its own line: how many, cash, card and total', by.Entry.qty === 3 && by.Entry.cash === 1000 && by.Entry.card === 500 && by.Entry.total === 1500 && by.Development.qty === 2 && by.Development.card === 600 && by.Development.cash === 0, t.items);
    check('Gift Shop and Juice are shown on their own (not lumped together)', by['Gift Shop'].total === 400 && by['Gift Shop'].cash === 400 && by.Juice.total === 100 && by.Juice.qty === 1);
    check('a cancelled sale doesn’t count', !by['Raffle strip']);
    check('in the till’s order (Entry, Development, …, Gift Shop, Other)', t.items.map((i) => i.label).join(',') === 'Entry,Development,Gift Shop,Juice');
    check('the totals add up: cash £15.00, card £11.00, total £26.00', t.cash === 1500 && t.card === 1100 && t.total === 2600 && t.items.reduce((n, i) => n + i.total, 0) === t.door);
    const till = await text('/admin/door', { jar: g });
    check('the till shows “Tonight so far, by item” with the table', till.includes('data-door-items') && till.includes('Tonight so far, by item: <strong data-items-total>£26.00</strong>') && till.includes('<th scope="row">Gift Shop</th><td>1</td><td>£4.00</td><td>£0.00</td><td>£4.00</td>'));
    check('…and the total line', till.includes('<tr class="till-items-total"><th scope="row">Total</th><td></td><td>£15.00</td><td>£11.00</td><td>£26.00</td></tr>'));
    const close = await text('/admin/door/close?date=' + today, { jar: g });
    check('Close night shows the same table', close.includes('Tonight by item') && close.includes('<th scope="row">Juice</th><td>1</td><td>£1.00</td><td>£0.00</td><td>£1.00</td>'));
    const report = await text(`/admin/door/nights/${today}`, { jar: g });
    check('the night’s report shows it by item, with cash and card', report.includes('<h2>By item</h2>') && report.includes('<th scope="row">Development</th><td>2</td><td>£0.00</td><td>£6.00</td><td>£6.00</td>'));
    const csv = await text(`/admin/door/nights/${today}.csv`, { jar: g });
    check('the spreadsheet has a “By item” section with cash and card', csv.includes('By item,Item,Sold,Cash (£),Card (£),Total (£)') && csv.includes('By item,Entry,3,10.00,5.00,15.00') && csv.includes('By item,Total,,15.00,11.00,26.00'), csv.slice(0, 600));
  }

  console.log('\nChange for cash sales');
  {
    const till = await text('/admin/door', { jar: g });
    check('the cash screen has “Cash given” with Exact, £5, £10, £20 and £50, and a change line', till.includes('data-change hidden') && till.includes('Cash given (optional)') && ['exact', '500', '1000', '2000', '5000'].every((v) => till.includes(`data-give="${v}"`)) && till.includes('data-change-out'));
    const js = fs.readFileSync(path.join(root, 'public', 'js', 'door.js'), 'utf8');
    check('change = cash given − total; less than the total shows “still to pay”; cash only', /'CHANGE ' \+ money\(g - due\)/.test(js) && /still to pay/.test(js) && /changeBox\.hidden = method !== 'cash'/.test(js));
    check('the phones load the new till script (its own version number)', till.includes('/js/door.js?v=17-2') && till.includes('/css/till.css?v=1'));
    check('only Gary and Julie can see the figures', (await req('/admin/door/totals?date=' + today)).status === 403 || (await req('/admin/door/totals?date=' + today)).status === 401);
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
