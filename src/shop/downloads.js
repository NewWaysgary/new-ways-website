// Secure meditation downloads: ONE PURCHASE, ONE CLICK, ONE DOWNLOAD.
//
// 1. The customer presses DOWNLOAD YOUR MEDITATION (a form, after ticking "I understand this is a one-time
//    download"), on the order page they return to from Square or on the page their emailed link opens.
// 2. Before ANY of the file is sent, the server uses the purchase's one download in a single all-or-nothing database
//    step. Two presses at the same moment can't both succeed: only one gets through, the other is refused and recorded.
// 3. The browser that pressed is then given a private address for the file plus a matching private cookie. Only that
//    browser can fetch it, and only until the file has been sent completely (or 24 hours have passed).
// 4. Phones may use several connections at once for one download, and resume after a dropped signal; that is all
//    allowed. However many requests arrive, the server never sends more than the file's size plus a small allowance
//    in total (at most 16 MB, and less than the file), counted as the data is sent, so a second complete copy can't
//    be sent. Once the whole file has been sent, the address stops working for good.
// 5. The emailed link and the order page then only show the record: there is no second download and no code to
//    unlock one. A replacement can only be authorised by Gary or a full Admin, with a reason (Admin > the order).
//
// What "completed" means: the server sent every byte of the file to the customer's browser, by one request that
// finished, or by several requests whose counted parts join up (see countTransfers). The server cannot see whether
// the phone then saved the file, so nothing here claims that.
import { parseCookies, cookie, randomToken } from '../lib/http.js';
import { sha256Hex } from '../orders.js';
import { downloadTransferConfirmation } from '../notify.js';

export const DOWNLOADS_PER_PURCHASE = 1;
export const CLAIM_HOURS = 24;                         // how long an interrupted download can still be resumed
export const CLAIM_REQUESTS = 20;                      // requests allowed for one download (resumes after drops)
// Extra data allowed on top of one copy, for bytes sent twice: still on their way when a connection closed (a dropped
// signal, or a phone switching between its own connections). At most 16 MB, and always less than the file itself,
// so the total can never reach two complete copies.
export const MAX_ALLOWANCE_BYTES = 16 * 1024 * 1024;
export const allowanceFor = (size) => Math.min(MAX_ALLOWANCE_BYTES, Math.floor(Number(size) * 0.9));
const BLOCK_BYTES = 1024 * 1024;                       // permission to send is taken 1 MB at a time
export const CLAIM_COOKIE = 'nw_dlc';
const FLUSH_BYTES = 2 * 1024 * 1024;
const FLUSH_MS = 5000;
const EVENTS_PER_ORDER = 200;                          // refused attempts recorded per order (stops a flood)

const nowIso = () => new Date().toISOString();
const isHttps = (request) => new URL(request.url).protocol === 'https:';
const claimHash = (secret) => sha256Hex('claim:' + secret);
const cookieHash = (value) => sha256Hex('claim-cookie:' + value);

// 'available' | 'used' | 'expired' | 'gone'
export function downloadState(ent, nowMs = Date.now()) {
  if (!ent || ent.revoked_at) return 'gone';
  if (ent.attempts >= ent.max_attempts) return 'used';
  return Date.parse(ent.expires_at) > nowMs ? 'available' : 'expired';
}

// What happened to the file after the button was pressed: 'none' | 'in_progress' | 'completed' | 'interrupted'
export function transferState(ent, nowMs = Date.now()) {
  if (!ent || !ent.completed_at) return 'none';
  if (ent.transfer_status === 'completed') return 'completed';
  if (ent.transfer_status === 'in_progress') return 'in_progress';
  if (ent.transfer_status === 'interrupted') return 'interrupted';
  return 'none';
}

export const claimEndsAt = (ent) => (ent && ent.completed_at ? new Date(Date.parse(ent.completed_at) + CLAIM_HOURS * 3600_000).toISOString() : null);

// "43,620,123 bytes (43.62 MB)". MB here is 1,000,000 bytes, as Android phones show it.
export const megabytes = (bytes) => (Number(bytes) / 1_000_000).toFixed(2) + ' MB';
export const mebibytes = (bytes) => (Number(bytes) / 1_048_576).toFixed(2) + ' MiB';
export const bytesText = (bytes) => `${Number(bytes).toLocaleString('en-GB')} bytes (${megabytes(bytes)})`;

// "Feel It – Awaken the Spirit Within" + "By Medium Gary Findlay" -> "Feel It - Awaken the Spirit Within - Medium Gary Findlay.mp3"
export function downloadFilename(product) {
  const clean = (s) => String(s || '').replace(/[\u2012-\u2015]/g, '-').replace(/[’‘]/g, "'").replace(/[^A-Za-z0-9 .,'()&-]/g, '').replace(/\s+/g, ' ').trim();
  const title = clean(product && product.title) || 'Meditation';
  const by = clean(String((product && product.by_line) || '').replace(/^\s*by\s+/i, ''));
  return (by ? `${title} - ${by}` : title).slice(0, 150) + '.mp3';
}

function contentDisposition(name) {
  const ascii = name.replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// A refused attempt, kept for Admin (never more than EVENTS_PER_ORDER per order)
export async function recordEvent(env, ent, kind, detail = '') {
  if (!ent) return;
  try {
    await env.DB.prepare(`INSERT INTO download_events (order_id, entitlement_id, kind, detail)
      SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM download_events WHERE order_id = ?1) < ?5`)
      .bind(ent.order_id, ent.id, kind, String(detail).slice(0, 200), EVENTS_PER_ORDER).run();
  } catch (err) { console.error("New Way's: download event not recorded:", err && err.message); }
}

// Does this browser hold the cookie for this entitlement's claim?
export async function holdsClaim(request, ent) {
  const value = parseCookies(request)[CLAIM_COOKIE];
  return !!(ent && ent.claim_cookie_hash && value && /^[A-Za-z0-9_-]{30,60}$/.test(value) && (await cookieHash(value)) === ent.claim_cookie_hash);
}

// The size of the recording, read from R2 (null if it can't be found)
export async function fileSize(env, ent) {
  if (!ent) return null;
  if (ent.file_size) return ent.file_size;
  try { const h = await env.MEDIA.head(ent.file_key); return h ? h.size : null; } catch { return null; }
}

// The button was pressed. Uses the one download (all-or-nothing) and returns { location, setCookie }, or
// { refused: 'used' | 'expired' | 'gone' | 'simultaneous' | 'missing' }.
export async function claim(request, env, ent) {
  const state = downloadState(ent);
  if (state !== 'available') {
    await recordEvent(env, ent, state === 'used' ? 'blocked_repeat' : state === 'expired' ? 'blocked_expired' : 'blocked_replaced', 'Button pressed again');
    return { refused: state };
  }
  // The file must exist BEFORE the download is used, so a missing file never uses up the purchase
  let head = null;
  try { head = await env.MEDIA.head(ent.file_key); } catch { head = null; }
  if (!head) return { refused: 'missing' };
  const secret = randomToken(32);
  const cookieValue = randomToken(32);
  const now = nowIso();
  const row = await env.DB.prepare(`UPDATE download_entitlements
      SET attempts = attempts + 1, completed_at = ?1, claim_hash = ?2, claim_cookie_hash = ?3, file_size = ?4, claim_requests = 0,
          bytes_reserved = 0, bytes_sent = 0, transfer_status = ''
      WHERE id = ?5 AND revoked_at IS NULL AND expires_at > ?1 AND attempts < max_attempts RETURNING id`)
    .bind(now, await claimHash(secret), await cookieHash(cookieValue), head.size, ent.id).first();
  if (!row) {
    // Someone else's request used it a moment earlier (two presses, two phones at the same moment)
    const fresh = await env.DB.prepare('SELECT * FROM download_entitlements WHERE id = ?1').bind(ent.id).first();
    const recent = fresh && fresh.completed_at && Date.now() - Date.parse(fresh.completed_at) < 30_000;
    await recordEvent(env, ent, recent ? 'blocked_simultaneous' : 'blocked_repeat', recent ? 'A second press at the same moment' : 'Button pressed again');
    return { refused: recent ? 'simultaneous' : downloadState(fresh) };
  }
  return { location: `/download/file/${secret}`, setCookie: claimCookie(request, cookieValue) };
}

const claimCookie = (request, value) => cookie(CLAIM_COOKIE, value, { path: '/download/file/', maxAge: CLAIM_HOURS * 3600, secure: isHttps(request), sameSite: 'Lax' });

// The same browser, after an interruption, asks to continue: a fresh private address for the SAME download (the
// byte limit still applies, so this can never give a second copy). Returns { location } or null.
export async function continueClaim(request, env, ent) {
  if (!ent || ent.revoked_at || !(await holdsClaim(request, ent))) return null;
  if (transferState(ent) === 'completed' || Date.parse(claimEndsAt(ent)) <= Date.now()) return null;
  const secret = randomToken(32);
  const row = await env.DB.prepare(`UPDATE download_entitlements SET claim_hash = ?1 WHERE id = ?2 AND revoked_at IS NULL AND transfer_status != 'completed' RETURNING id`)
    .bind(await claimHash(secret), ent.id).first();
  return row ? { location: `/download/file/${secret}` } : null;
}

export const entitlementForClaim = async (env, secret) => /^[A-Za-z0-9_-]{30,60}$/.test(secret)
  ? env.DB.prepare('SELECT * FROM download_entitlements WHERE claim_hash = ?1').bind(await claimHash(secret)).first() : null;

// "bytes=a-b" | "bytes=a-" | "bytes=-n" -> { offset, length } | 'invalid' | null (no usable range: send everything)
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return String(header).includes(',') ? null : 'invalid';
  if (m[1] === '') {
    const n = Math.min(Number(m[2]), size);
    return n > 0 ? { offset: size - n, length: n } : 'invalid';
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return 'invalid';
  return { offset: start, length: end - start + 1 };
}

// Merged byte ranges [start, end) -> does it cover the whole file?
export function coversWholeFile(ranges, size) {
  const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let reach = 0;
  for (const [s, e] of sorted) { if (s > reach) break; reach = Math.max(reach, e); }
  return reach >= size;
}

// ---------- Which bytes each request can be counted for (the server's evidence) ----------
// A request that FINISHED (the server sent every byte it asked for) counts for its whole range.
// A request that STOPPED early counts only up to the point where another request for the same download takes over:
//   * phones download a big file over several connections at once and close the first one on purpose when it
//     reaches the start of a part another connection is fetching (Chrome for Android, Samsung Internet);
//   * after a dropped signal, the phone asks again from the byte it has got to.
// In both cases the browser itself asked for the file from that byte, and the server had already sent up to it.
// A stopped request with nothing taking over counts for nothing: bytes sent just before a connection drops may never
// have arrived, so they are never counted.
// A request still sending (heard from in the last STALE_MS) is not counted yet.
export const STALE_MS = 2 * 60_000;
export function countTransfers(transfers, nowMs = Date.now()) {
  const live = (t) => t.status === 'in_progress' && nowMs - Date.parse(t.updated_at) <= STALE_MS;
  return transfers.map((t) => {
    const start = Number(t.range_start), sent = Number(t.bytes_sent) || 0;
    if (t.status === 'completed' || t.status === 'part_sent') return { id: t.id, from: start, until: start + sent, takenOverAt: null, live: false };
    if (live(t)) return { id: t.id, from: start, until: start, takenOverAt: null, live: true };
    // stopped (or silent for over STALE_MS): find the earliest other request that starts inside what it sent
    const next = transfers.filter((o) => o.id !== t.id && Number(o.range_start) > start && Number(o.range_start) <= start + sent)
      .reduce((m, o) => Math.min(m, Number(o.range_start)), Infinity);
    return Number.isFinite(next) ? { id: t.id, from: start, until: next, takenOverAt: next, live: false } : { id: t.id, from: start, until: start, takenOverAt: null, live: false };
  });
}

// Looks at every request for this download and records the result. Called whenever a request finishes or stops,
// when the customer's page is opened, and by the hourly job (in case a request's end was never reported).
// Returns 'completed' | 'in_progress' | 'interrupted' | 'none'. Sends the confirmation email ONCE, only on completion.
export async function settle(env, entId, nowMs = Date.now()) {
  const ent = await env.DB.prepare('SELECT * FROM download_entitlements WHERE id = ?1').bind(entId).first();
  if (!ent || !ent.completed_at) return 'none';
  if (ent.transfer_status === 'completed') return 'completed';
  const { results } = await env.DB.prepare('SELECT * FROM download_transfers WHERE entitlement_id = ?1 ORDER BY id').bind(entId).all();
  const transfers = results || [];
  if (!transfers.length) return 'none';
  const size = Number(ent.file_size) || Number(transfers[0].file_size);
  const counted = countTransfers(transfers, nowMs);
  await env.DB.batch(counted.filter((c) => !c.live).map((c) => env.DB.prepare('UPDATE download_transfers SET counted_until = ?1, taken_over_at = ?2 WHERE id = ?3').bind(c.until, c.takenOverAt, c.id)));
  if (coversWholeFile(counted.map((c) => [c.from, c.until]), size)) {
    const used = counted.filter((c) => c.until > c.from);
    const single = used.length === 1 && used[0].from === 0 && used[0].until >= size;
    // when it completed: when the last request that is counted ended
    const at = transfers.filter((t) => used.some((u) => u.id === t.id)).map((t) => t.finished_at || t.updated_at).sort().pop() || nowIso();
    const won = await env.DB.prepare(`UPDATE download_entitlements SET transfer_status = 'completed', transfer_completed_at = ?1, completion_basis = ?2
        WHERE id = ?3 AND transfer_status != 'completed' RETURNING id`).bind(at, single ? 'one_connection' : 'several_connections', entId).first();
    if (won) {
      try { await sendConfirmation(env, entId); } catch (err) { console.error("New Way's: download confirmation not sent:", err && err.message); }
    }
    return 'completed';
  }
  if (counted.some((c) => c.live)) {
    await env.DB.prepare(`UPDATE download_entitlements SET transfer_status = 'in_progress' WHERE id = ?1 AND transfer_status != 'completed'`).bind(entId).run();
    return 'in_progress';
  }
  await env.DB.prepare(`UPDATE download_entitlements SET transfer_status = 'interrupted' WHERE id = ?1 AND transfer_status != 'completed'`).bind(entId).run();
  return 'interrupted';
}

async function sendConfirmation(env, entId) {
  const ent = await env.DB.prepare('SELECT * FROM download_entitlements WHERE id = ?1').bind(entId).first();
  const [order, product] = await Promise.all([
    env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(ent.order_id).first(),
    env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(ent.product_id).first()
  ]);
  await downloadTransferConfirmation(env, order, product, ent);
}

// The hourly job: downloads pressed in the last 7 days that aren't settled as completed are looked at again
export async function settleOpenDownloads(env, nowMs = Date.now()) {
  const { results } = await env.DB.prepare(`SELECT id FROM download_entitlements WHERE completed_at > ?1 AND transfer_status IN ('in_progress', 'interrupted')
      AND revoked_at IS NULL ORDER BY id LIMIT 50`).bind(new Date(nowMs - 7 * 86400_000).toISOString()).all();
  for (const { id } of results || []) await settle(env, id, nowMs);
}

// Sends the file (or the requested part of it) for a pressed download. Returns a Response, or
// { refused: reason, status } for the caller to show a page.
export async function serveClaim(request, env, ctx, ent) {
  if (!ent) return { refused: 'unknown', status: 410 };
  if (ent.revoked_at) { await recordEvent(env, ent, 'blocked_replaced', 'Old download address used'); return { refused: 'replaced', status: 410 }; }
  if (!(await holdsClaim(request, ent))) { await recordEvent(env, ent, 'blocked_other_browser', 'Download address opened in another browser or phone'); return { refused: 'other_browser', status: 403 }; }
  if (transferState(ent) === 'completed') { await recordEvent(env, ent, 'blocked_after_complete', 'The whole file had already been sent'); return { refused: 'completed', status: 410 }; }
  if (Date.parse(claimEndsAt(ent)) <= Date.now()) { await recordEvent(env, ent, 'blocked_late', 'Resume tried after 24 hours'); return { refused: 'late', status: 410 }; }

  let head = null;
  try { head = await env.MEDIA.head(ent.file_key); } catch { head = null; }
  if (!head) return { refused: 'missing', status: 410 };
  const size = head.size;
  const cap = size + allowanceFor(size);
  const etag = head.httpEtag || (head.etag ? `"${head.etag}"` : '');
  const product = await env.DB.prepare('SELECT title, by_line FROM products WHERE id = ?1').bind(ent.product_id).first();
  const headers = new Headers({
    // A generic file type plus "attachment" makes phones SAVE the file instead of opening it in the browser's player
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': contentDisposition(downloadFilename(product)),
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'
  });
  if (etag) headers.set('ETag', etag);
  // A link check (HEAD) sends nothing and counts for nothing
  if (request.method === 'HEAD') { headers.set('Content-Length', String(size)); return new Response(null, { headers }); }

  // Resume only if the file is unchanged (If-Range); otherwise the whole file is the request
  const ifRange = request.headers.get('If-Range');
  const range = ifRange && ifRange !== etag ? null : parseRange(request.headers.get('Range'), size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' } });
  const offset = range ? range.offset : 0;
  const length = range ? range.length : size;

  const counted = await env.DB.prepare(`UPDATE download_entitlements SET claim_requests = claim_requests + 1 WHERE id = ?1 AND claim_requests < ?2 RETURNING claim_requests`)
    .bind(ent.id, CLAIM_REQUESTS).first();
  if (!counted) { await recordEvent(env, ent, 'blocked_too_many', `More than ${CLAIM_REQUESTS} requests for one download`); return { refused: 'too_many', status: 429 }; }
  // Refused straight away if this request could never fit in what is left of one copy's worth of data, counting what
  // requests that have ENDED already sent. (Requests still sending are limited as they send, below.) So a request for
  // the whole file again after a long part has been sent is refused, and the rest can still be resumed.
  const fresh = await env.DB.prepare(`SELECT e.bytes_reserved, e.transfer_status,
      (SELECT COALESCE(SUM(t.bytes_sent), 0) FROM download_transfers t WHERE t.entitlement_id = e.id AND (t.status != 'in_progress' OR t.updated_at < ?2)) AS spent
      FROM download_entitlements e WHERE e.id = ?1`).bind(ent.id, new Date(Date.now() - STALE_MS).toISOString()).first();
  if (!fresh || fresh.transfer_status === 'completed' || fresh.bytes_reserved >= cap || fresh.spent + length > cap) {
    await recordEvent(env, ent, 'blocked_limit', range ? `Asked for bytes ${offset}-${offset + length - 1} after one copy’s worth had been sent` : 'Asked for the whole file after one copy’s worth had been sent');
    return { refused: fresh && fresh.transfer_status === 'completed' ? 'completed' : 'limit', status: 409 };
  }
  await env.DB.prepare(`UPDATE download_entitlements SET transfer_status = 'in_progress' WHERE id = ?1 AND transfer_status != 'completed'`).bind(ent.id).run();
  const ins = await env.DB.prepare(`INSERT INTO download_transfers (entitlement_id, order_id, range_start, range_length, file_size, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(ent.id, ent.order_id, offset, length, size, String(request.headers.get('User-Agent') || '').slice(0, 200)).run();
  const transferId = ins.meta.last_row_id;

  let object = null;
  try { object = await env.MEDIA.get(ent.file_key, range ? { range: { offset, length } } : undefined); } catch { object = null; }
  if (!object) {
    await env.DB.prepare(`UPDATE download_transfers SET status = 'interrupted', finished_at = ?1, updated_at = ?1 WHERE id = ?2`).bind(nowIso(), transferId).run();
    await settle(env, ent.id);
    return { refused: 'missing', status: 410 };
  }

  // ---- the counting stream ----
  // The one-copy limit is kept as the data is SENT, across every request for this download at once: each request
  // takes permission for the next block of bytes in one all-or-nothing database step, and never sends a byte it
  // hasn't got permission for. Permission not used (a request that stopped) is given back. So several connections
  // from the same phone work normally, but all of them together can never send more than the file plus the
  // allowance, which is less than two copies.
  let sent = 0, granted = 0, flushed = 0, lastFlush = Date.now(), ended = false;
  let queue = Promise.resolve();
  const later = (fn) => (queue = queue.then(fn).catch((err) => console.error("New Way's: download record not saved:", err && err.message)));
  const flush = () => later(async () => {
    const delta = sent - flushed;
    flushed = sent;
    lastFlush = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE download_transfers SET bytes_sent = ?1, updated_at = ?2 WHERE id = ?3`).bind(flushed, nowIso(), transferId),
      env.DB.prepare(`UPDATE download_entitlements SET bytes_sent = bytes_sent + ?1 WHERE id = ?2`).bind(delta, ent.id)
    ]);
  });
  const permit = async (needed) => {
    // ask for a 1 MB block (or just what is needed for this piece); refused if that would pass the limit
    for (const want of [Math.max(needed, Math.min(BLOCK_BYTES, length - granted)), needed]) {
      const ok = await env.DB.prepare(`UPDATE download_entitlements SET bytes_reserved = bytes_reserved + ?1
          WHERE id = ?2 AND revoked_at IS NULL AND transfer_status != 'completed' AND bytes_reserved + ?1 <= ?3 RETURNING id`).bind(want, ent.id, cap).first();
      if (ok) { granted += want; return true; }
    }
    return false;
  };
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const end = (how) => {
    if (ended) return;
    ended = true;
    flush();
    later(async () => {
      const at = nowIso();
      const whole = how === 'done' && sent === length;
      const status = whole ? (offset === 0 && length === size ? 'completed' : 'part_sent') : 'interrupted';
      await env.DB.batch([
        env.DB.prepare(`UPDATE download_transfers SET status = ?1, finished_at = ?2, updated_at = ?2 WHERE id = ?3`).bind(status, at, transferId),
        env.DB.prepare(`UPDATE download_entitlements SET bytes_reserved = MAX(0, bytes_reserved - ?1) WHERE id = ?2`).bind(granted - sent, ent.id)
      ]);
      if (how === 'limit') await recordEvent(env, ent, 'stopped_limit', 'Stopped: one copy’s worth of data had been sent');
      await settle(env, ent.id);
    });
    queue.then(() => finish());
  };
  const reader = object.body.getReader();
  const counting = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { controller.close(); end('done'); return; }
        if (sent + value.byteLength > granted && !(await permit(sent + value.byteLength - granted))) {
          try { reader.cancel().catch(() => {}); } catch { /* ignore */ }
          controller.error(new Error('download limit'));
          end('limit');
          return;
        }
        sent += value.byteLength;
        controller.enqueue(value);
        if (sent - flushed >= FLUSH_BYTES || Date.now() - lastFlush >= FLUSH_MS) await flush();
      } catch (err) {
        try { controller.error(err); } catch { /* already closed */ }
        end('error');
      }
    },
    cancel(reason) {
      // the phone closed this connection: a dropped signal, or (with several connections) on purpose
      try { reader.cancel(reason).catch(() => {}); } catch { /* ignore */ }
      end('cancelled');
    }
  }, { highWaterMark: 0 });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(finished);

  let body = counting;
  // On Cloudflare, a fixed-length stream keeps the exact size in the response, so the phone shows real progress
  if (typeof FixedLengthStream === 'function') {
    // eslint-disable-next-line no-undef
    const fixed = new FixedLengthStream(length);
    counting.pipeTo(fixed.writable).catch(() => end('cancelled'));
    body = fixed.readable;
  }
  headers.set('Content-Length', String(length));
  if (range) headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${size}`);
  return new Response(body, { status: range ? 206 : 200, headers });
}
