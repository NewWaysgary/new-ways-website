// Local test copy of New Way's (no internet needed).
// Stands in for Cloudflare: D1 -> Node's built-in SQLite, R2 -> a local folder, static files -> ./public,
// and for WorkOS: a local sign-in stand-in (dev/mock-workos.mjs). Never used on Cloudflare.
// NO_SIGNIN=1 starts it with sign-in not configured, to check that Admin stays locked.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { startMockWorkOS } from './mock-workos.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const localDir = path.join(root, 'dev', '.local');
fs.mkdirSync(path.join(localDir, 'media'), { recursive: true });

// ---------- D1 stand-in ----------
const dbPath = process.env.DB_FILE || path.join(localDir, 'test.sqlite');
if (!process.env.KEEP_DB && fs.existsSync(dbPath)) fs.rmSync(dbPath);
const sqlite = new DatabaseSync(dbPath);
const fresh = !sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
if (fresh) {
  for (const f of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
  }
}
if (fresh && process.env.TEST_FIXTURES === '1') {
  sqlite.exec(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'fixtures.sql'), 'utf8'));
  for (const [file, key] of [['test-portrait.jpg', 'test/portrait.jpg'], ['test-poster.jpg', 'test/poster.jpg']]) {
    const dest = path.join(localDir, 'media', key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, 'tests', 'fixtures', file), dest);
    fs.writeFileSync(dest + '.meta.json', JSON.stringify({ contentType: 'image/jpeg' }));
  }
}
const plain = (row) => (row ? { ...row } : null);

// D1 binds "ordered" (?1, ?2) and "anonymous" (?) parameters by SQLite's rules. Node's own SQLite binds ?1 wrongly
// in some versions (before Node 24.7.0, nodejs/node#59340: "column index out of range"), so this stand-in never
// passes numbered parameters to Node: it rewrites them as plain ? and orders the values itself, following SQLite:
// ?NNN uses value NNN; a bare ? uses one more than the largest number used so far.
// Like D1, it refuses a statement given the wrong number of values.
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
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); const j = e === -1 ? sql.length : e + 2; out += sql.slice(i, j); i = j; continue; }
    if (c === '?') {
      let j = i + 1;
      while (j < sql.length && sql[j] >= '0' && sql[j] <= '9') j++;
      const index = j > i + 1 ? Number(sql.slice(i + 1, j)) : largest + 1;
      if (index < 1) throw new Error('D1_ERROR: invalid parameter number');
      largest = Math.max(largest, index);
      slots.push(index);
      out += '?'; i = j; continue;
    }
    if ((c === ':' || c === '@' || c === '$') && /[A-Za-z_]/.test(sql[i + 1] || '') && !/[A-Za-z0-9_%]/.test(sql[i - 1] || '')) {
      throw new Error('D1_ERROR: named parameters are not supported by D1');
    }
    out += c; i++;
  }
  if (params.length !== largest) throw new Error(`D1_ERROR: Wrong number of parameter bindings for SQL query (expected ${largest}, got ${params.length})`);
  for (const v of params) if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  return { sql: out, values: slots.map((n) => params[n - 1]) };
}

// Development-only fault injection for tests: FAIL_SQL is a pattern; matching queries throw, as if the database failed.
const failSql = process.env.FAIL_SQL ? new RegExp(process.env.FAIL_SQL) : null;
function runSql(sql, params, method) {
  if (failSql && failSql.test(sql)) throw new Error('D1_ERROR: simulated database failure (FAIL_SQL)');
  const b = bindForNode(sql, params);
  return sqlite.prepare(b.sql)[method](...b.values);
}

class Statement {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.sql, params.map((p) => (typeof p === 'boolean' ? Number(p) : p))); }
  async first(column) {
    const row = plain(runSql(this.sql, this.params, 'get'));
    if (!column) return row;
    if (row && !(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row ? row[column] : null;
  }
  async all() { return { success: true, results: runSql(this.sql, this.params, 'all').map(plain), meta: {} }; }
  async run() {
    const r = runSql(this.sql, this.params, 'run');
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async raw() { return runSql(this.sql, this.params, 'all').map((r) => Object.values(r)); }
}

// Self-check at start-up: numbered, repeated and anonymous parameters must bind exactly as D1 binds them.
{
  const probe = bindForNode("SELECT ?2 AS b, ?1 AS a, ?1 AS a2, ? AS c, '?9' AS text -- ?7\n", ['one', 'two', 'three']);
  const got = sqlite.prepare(probe.sql).get(...probe.values);
  if (got.a !== 'one' || got.a2 !== 'one' || got.b !== 'two' || got.c !== 'three' || got.text !== '?9') {
    console.error('Local D1 stand-in self-check failed: parameters did not bind like D1.', got);
    process.exit(1);
  }
}

const DB = {
  prepare: (sql) => new Statement(sql),
  // Like D1, a batch is one all-or-nothing transaction. It runs without pausing, so another request can never
  // run its own statements in the middle of it.
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const out = [];
      for (const s of statements) {
        const isRead = /^\s*(SELECT|WITH)\b/i.test(s.sql);
        if (isRead) out.push({ success: true, results: runSql(s.sql, s.params, 'all').map(plain), meta: {} });
        else {
          const r = runSql(s.sql, s.params, 'run');
          out.push({ success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } });
        }
      }
      sqlite.exec('COMMIT');
      return out;
    } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
  async exec(sql) { sqlite.exec(sql); return { count: 1 }; }
};

// ---------- R2 stand-in ----------
const mediaDir = path.join(localDir, 'media');
const safe = (key) => path.join(mediaDir, key.replace(/[^a-z0-9._\-/]/gi, '_'));
const MEDIA = {
  async put(key, value, opts = {}) {
    const file = safe(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (value && typeof value.getReader === 'function') value = Buffer.from(await new Response(value).arrayBuffer());
    const buf = Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    fs.writeFileSync(file, buf);
    fs.writeFileSync(file + '.meta.json', JSON.stringify(opts.httpMetadata || {}));
    return { key, size: buf.length };
  },
  async get(key, opts = {}) {
    const file = safe(key);
    if (!fs.existsSync(file)) return null;
    const whole = fs.readFileSync(file);
    const meta = JSON.parse(fs.readFileSync(file + '.meta.json', 'utf8'));
    let range;
    if (opts.range && typeof opts.range.get === 'function') {
      const m = /^bytes=(\d*)-(\d*)$/.exec(opts.range.get('Range') || '');
      if (m && m[1] !== '') range = { offset: +m[1], length: (m[2] !== '' ? Math.min(+m[2], whole.length - 1) : whole.length - 1) - +m[1] + 1 };
      else if (m && m[2] !== '') range = { suffix: +m[2] };
    } else if (opts.range) range = { offset: opts.range.offset || 0, length: opts.range.length ?? whole.length - (opts.range.offset || 0) };
    const buf = !range ? whole : range.suffix !== undefined ? whole.subarray(whole.length - range.suffix) : whole.subarray(range.offset, range.offset + range.length);
    return {
      key, size: whole.length, range, httpEtag: '"' + whole.length + '-' + fs.statSync(file).mtimeMs + '"', httpMetadata: meta,
      body: new Blob([buf]).stream(),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
      writeHttpMetadata(h) { if (meta.contentType) h.set('Content-Type', meta.contentType); }
    };
  },
  async delete(key) { for (const f of [safe(key), safe(key) + '.meta.json']) if (fs.existsSync(f)) fs.rmSync(f); },
  async list({ prefix = '' } = {}) {
    const objects = [];
    const walk = (dir, rel) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name), key = rel ? rel + '/' + name : name;
        if (fs.statSync(full).isDirectory()) walk(full, key);
        else if (!name.endsWith('.meta.json') && key.startsWith(prefix)) objects.push({ key, size: fs.statSync(full).size, uploaded: fs.statSync(full).mtime });
      }
    };
    walk(mediaDir, '');
    return { objects, truncated: false };
  }
};

const env = {
  DB, MEDIA,
  SITE_URL: process.env.SITE_URL || 'https://newwaysmediumshipdevelopmentcentre.com'
};
let signInNote = 'sign-in not configured, Admin locked';
const mockPort = Number(process.env.MOCK_PORT || PORT + 12);
const ownerEmail = 'owner@example.test';
const mock = await startMockWorkOS({ port: mockPort, clientId: 'client_local_test', apiKey: 'sk_local_test', ownerEmail });
env.YOUTUBE_OEMBED_URL = mock.base + '/oembed';
if (process.env.NO_SIGNIN !== '1') {
  Object.assign(env, {
    WORKOS_CLIENT_ID: 'client_local_test', WORKOS_API_KEY: 'sk_local_test', OWNER_EMAIL: ownerEmail,
    SESSION_SECRET: 'local-test-secret-not-for-real-use-0123456789', WORKOS_API_BASE: mock.base
  });
  signInNote = 'sign-in via the local WorkOS stand-in at ' + mock.base;
}
if (process.env.NO_TURNSTILE !== '1') {
  // Cloudflare's published always-pass test keys
  Object.assign(env, { TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA', TURNSTILE_VERIFY_URL: mock.base + '/turnstile/v0/siteverify' });
}

if (process.env.NO_SQUARE !== '1') {
  // Square Sandbox stand-in (local only). The real keys are Cloudflare secrets and are never in the code.
  Object.assign(env, { SQUARE_ENVIRONMENT: 'sandbox', SQUARE_ACCESS_TOKEN: 'sq_local_test', SQUARE_LOCATION_ID: 'LOCAL_LOCATION',
    SQUARE_WEBHOOK_SIGNATURE_KEY: 'local-webhook-signature-key', SQUARE_API_BASE: mock.base });
}
if (process.env.NO_EMAIL !== '1') {
  Object.assign(env, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_local_test', EMAIL_FROM: 'New Way’s <bookings@example.test>', RESEND_API_BASE: mock.base });
}

// ---------- static files (Cloudflare serves these before the Worker runs) ----------
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
function staticFile(pathname) {
  if (pathname === '/' || pathname.includes('..') || pathname.startsWith('/_')) return null;
  const file = path.join(root, 'public', decodeURIComponent(pathname));
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
    if (url.pathname === '/__dev/cron') {        // local copy only: run the daily housekeeping job now
      const waits = [];
      await worker.scheduled({ cron: url.searchParams.get('cron') || 'manual' }, env, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    const file = (req.method === 'GET' || req.method === 'HEAD') && staticFile(url.pathname);
    if (file) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const request = new Request(url, { method: req.method, headers, body: chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined });
    const response = await worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
    const outHeaders = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') outHeaders[k] = v; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outHeaders['set-cookie'] = cookies;
    res.writeHead(response.status, outHeaders);
    res.end(response.body && req.method !== 'HEAD' ? Buffer.from(await response.arrayBuffer()) : undefined);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Local server error: ' + err.message);
  }
});
server.listen(PORT, () => console.log(`New Way's local test copy: http://localhost:${PORT}  (${signInNote})`));
