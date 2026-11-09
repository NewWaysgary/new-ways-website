// A fingerprint of every row in the LIVE database, taken just before the update and compared just after it, so we
// can prove that no existing booking, payment, guest, answer, QR code or anything else was lost or changed.
//
//   node deploy/fingerprint.mjs take  pre.json     records each table's columns and a SHA-256 of every row
//   node deploy/fingerprint.mjs check pre.json     reads the database again (only the columns that existed before)
//                                                  and compares, row by row
//
// Only table names, column names, row numbers and counts are ever printed: never names, emails, codes or amounts
// (this repository and its logs are public). The fingerprint file itself is kept privately (Cloudflare storage).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const DB = process.env.FP_DB || 'new-ways';
const CONFIG = process.env.FP_CONFIG ? ['--config', process.env.FP_CONFIG] : [];
// Customer and money records: any change to an existing row here is shown as ATTENTION; a missing row stops the check
export const PROTECTED = ['event_bookings', 'event_guests', 'event_answers', 'event_changes', 'events', 'event_questions', 'event_question_options',
  'event_tables', 'event_table_guests', 'event_medium_guests', 'event_allocation_log', 'event_email_log', 'gift_vouchers', 'gift_voucher_log',
  'orders', 'bookings', 'booking_slots', 'wed_orders', 'wed_order_lines', 'wed_nights', 'till_sales', 'till_sale_lines', 'till_card_requests', 'till_items',
  'donations', 'mailing_list', 'mediums', 'products', 'download_entitlements', 'admin_users', 'checkin_helpers', 'settings'];
// Things that change by themselves while the website runs (visits, sign-ins, the activity log): counted, not compared
const VOLATILE = /^(sessions|admin_sessions|audit_log|rate_limits|app_metrics|community_stats|community_visitors|community_seen|community_deliveries|chat_|push_|reading_drafts|login_|security_|order_devices|download_events|cleanup_log|square_events|checkin_)/;

function sql(command) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', ...CONFIG, '--json', '--command', command], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  return parsed.map((r) => r.results || []);
}
const q = (name) => '"' + name.replace(/"/g, '""') + '"';
const hashRow = (cols, row) => crypto.createHash('sha256').update(JSON.stringify(cols.map((c) => row[c] === undefined ? null : row[c]))).digest('hex').slice(0, 32);

function tables() {
  return sql(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name`)[0]
    .map((t) => ({ name: t.name, rowid: !/WITHOUT\s+ROWID/i.test(t.sql || '') }));
}
function columns(name) { return sql(`PRAGMA table_info(${q(name)})`)[0].map((c) => c.name); }

function read(name, cols, rowid) {
  const out = {};
  const rows = sql(`SELECT ${rowid ? 'rowid AS "__rid", ' : ''}${cols.map(q).join(', ')} FROM ${q(name)}`)[0];
  rows.forEach((r, i) => { const h = hashRow(cols, r); out[rowid ? String(r.__rid) : h + ':' + i] = h; });
  return out;
}
function readByColumn(name, cols, rowid) {
  const out = {};
  const rows = sql(`SELECT ${rowid ? 'rowid AS "__rid", ' : ''}${cols.map(q).join(', ')} FROM ${q(name)}`)[0];
  for (const r of rows) out[rowid ? String(r.__rid) : hashRow(cols, r)] = Object.fromEntries(cols.map((c) => [c, crypto.createHash('sha256').update(JSON.stringify(r[c] ?? null)).digest('hex').slice(0, 16)]));
  return out;
}

const [mode, file] = process.argv.slice(2);
if (mode === 'take') {
  const fp = { taken_at: new Date().toISOString(), tables: {} };
  for (const t of tables()) {
    const cols = columns(t.name);
    fp.tables[t.name] = { columns: cols, rowid: t.rowid, rows: read(t.name, cols, t.rowid), cells: PROTECTED.includes(t.name) ? readByColumn(t.name, cols, t.rowid) : undefined };
  }
  fs.writeFileSync(file, JSON.stringify(fp));
  const p = PROTECTED.filter((t) => fp.tables[t]);
  console.log(`Fingerprint taken of ${Object.keys(fp.tables).length} tables.`);
  for (const t of p) console.log(`  ${t}: ${Object.keys(fp.tables[t].rows).length} rows`);
} else if (mode === 'check') {
  const fp = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = new Set(tables().map((t) => t.name));
  let missingProtected = 0, changedProtected = 0;
  for (const [name, t] of Object.entries(fp.tables)) {
    if (!now.has(name)) { console.log(`STOP  ${name}: the table is MISSING`); if (PROTECTED.includes(name)) missingProtected++; continue; }
    const after = read(name, t.columns, t.rowid);
    const before = t.rows;
    const keys = Object.keys(before);
    const missing = keys.filter((k) => !(k in after));
    const changed = keys.filter((k) => k in after && after[k] !== before[k]);
    const added = Object.keys(after).filter((k) => !(k in before)).length;
    const prot = PROTECTED.includes(name);
    if (VOLATILE.test(name) && !prot) { console.log(`info  ${name}: ${keys.length} before, ${Object.keys(after).length} now (changes by itself)`); continue; }
    if (!missing.length && !changed.length) { console.log(`ok    ${name}: all ${keys.length} existing rows unchanged${added ? `; ${added} new` : ''}`); continue; }
    if (prot) { missingProtected += missing.length; changedProtected += changed.length; }
    console.log(`${prot ? 'ATTENTION' : 'info '} ${name}: ${keys.length} existing rows, ${missing.length} missing${missing.length ? ' (rows ' + missing.slice(0, 20).join(', ') + ')' : ''}, ${changed.length} changed${added ? `, ${added} new` : ''}`);
    if (changed.length && t.cells) {
      const cellsNow = readByColumn(name, t.columns, t.rowid);
      for (const k of changed.slice(0, 20)) {
        const cols = t.columns.filter((c) => t.cells[k] && cellsNow[k] && t.cells[k][c] !== cellsNow[k][c]);
        console.log(`        row ${k}: changed columns ${cols.join(', ')}`);
      }
    }
  }
  console.log(`\nSUMMARY: ${missingProtected} customer or payment rows missing, ${changedProtected} changed.`);
  if (missingProtected) { console.log('STOP: rows are missing.'); process.exit(2); }
} else {
  console.log('Use: take FILE | check FILE'); process.exit(1);
}
