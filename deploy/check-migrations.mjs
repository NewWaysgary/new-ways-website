// Before the live database is updated: the updates still to apply must ONLY add things (new tables, new indexes,
// new columns). Anything that could change or remove existing rows stops the deployment.
//   node deploy/check-migrations.mjs <output of "wrangler d1 migrations list new-ways --remote">
import fs from 'node:fs';
const listing = fs.readFileSync(process.argv[2], 'utf8');
const pending = [...new Set(listing.match(/\d{4}_[a-z0-9_]+\.sql/g) || [])].sort();
const expected = (process.env.EXPECTED_PENDING || '').split(',').filter(Boolean);
console.log('Database updates to apply: ' + (pending.join(', ') || 'none'));
if (expected.length && pending.join() !== expected.join()) { console.log('STOP: expected exactly ' + expected.join(', ')); process.exit(1); }
const ALLOWED = /^(CREATE TABLE(?! IF NOT EXISTS\s+\w+\s+AS)\s|CREATE (UNIQUE )?INDEX\s|ALTER TABLE \w+ ADD COLUMN\s)/i;
let bad = 0;
for (const f of pending) {
  const sql = fs.readFileSync('migrations/' + f, 'utf8').replace(/--.*$/gm, '');
  const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) {
    if (!ALLOWED.test(s) || /\b(DELETE|UPDATE|DROP|INSERT|REPLACE|TRIGGER)\b/i.test(s.replace(/'[^']*'/g, "''"))) { console.log(`STOP: ${f} has a statement that is not purely additive: ${s.slice(0, 80)}`); bad++; }
  }
  console.log(`  ${f}: ${stmts.length} statements, all additive`);
}
if (bad) process.exit(1);
console.log('OK: the database updates only add new tables, indexes and columns. No existing row is changed or removed.');
