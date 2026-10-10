// For the automated tests only: a stand-in for Cloudflare D1 on a local SQLite file, so a test can call a scheduled
// job (such as the 6pm Wednesday email) directly at a chosen time. Binds parameters exactly as dev/server.mjs does.
import { DatabaseSync } from 'node:sqlite';

function bindForNode(sql, params) {
  let out = '', i = 0, largest = 0;
  const slots = [];
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === close) { if (sql[j + 1] === close && close !== ']') { j += 2; continue; } break; } j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); const j = e === -1 ? sql.length : e; out += sql.slice(i, j); i = j; continue; }
    if (c === '?') {
      let j = i + 1;
      while (j < sql.length && sql[j] >= '0' && sql[j] <= '9') j++;
      const index = j > i + 1 ? Number(sql.slice(i + 1, j)) : largest + 1;
      largest = Math.max(largest, index);
      slots.push(index);
      out += '?'; i = j; continue;
    }
    out += c; i++;
  }
  if (params.length !== largest) throw new Error(`D1_ERROR: Wrong number of parameter bindings (expected ${largest}, got ${params.length})`);
  return { sql: out, values: slots.map((n) => (typeof params[n - 1] === 'boolean' ? Number(params[n - 1]) : params[n - 1])) };
}

export function makeD1(file) {
  const sqlite = new DatabaseSync(file);
  const run = (sql, params, method) => { const b = bindForNode(sql, params); return sqlite.prepare(b.sql)[method](...b.values); };
  const plain = (r) => (r ? { ...r } : null);
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    async first(column) { const row = plain(run(this.sql, this.params, 'get')); return column ? (row ? row[column] : null) : row; }
    async all() { return { success: true, results: run(this.sql, this.params, 'all').map(plain), meta: {} }; }
    async run() { const r = run(this.sql, this.params, 'run'); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  }
  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) {
          if (/^\s*(SELECT|WITH)\b/i.test(s.sql)) out.push({ success: true, results: run(s.sql, s.params, 'all').map(plain), meta: {} });
          else { const r = run(s.sql, s.params, 'run'); out.push({ success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }); }
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
    close: () => sqlite.close()
  };
}
