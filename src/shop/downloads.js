// Secure meditation downloads: ONE PURCHASE, ONE CLICK, ONE DOWNLOAD.
//
// 1. The customer presses DOWNLOAD YOUR MEDITATION (a form, after ticking "I understand this is a one-time
//    download"), on the order page they return to from Square or on the page their emailed link opens.
// 2. Before ANY of the file is sent, the server uses the purchase's one download in a single all-or-nothing database
//    step. Two presses at the same moment can't both succeed: only one gets through, the other is refused and recorded.
// 3. The browser that pressed is then given a private address for the file plus a matching private cookie. Only that
//    browser can fetch it, and only until the file has been sent completely (or 24 hours have passed).
// 4. However many requests arrive (phones' download managers resume an interrupted download from where it stopped),
//    the server never sends more than the file's size plus a small allowance in total (at most 16 MB, and less than
//    half the file), so a second complete copy can't be sent. Once the whole file has been sent, the address stops
//    working for good.
// 5. The emailed link and the order page then only show the record: there is no second download and no code to
//    unlock one. A replacement can only be authorised by Gary or a full Admin, with a reason (Admin > the order).
//
// What "completed" means: the server sent every byte of the file to the customer's browser. The server cannot see
// whether the phone then saved the file, so nothing here claims that.
import { parseCookies, cookie, randomToken } from '../lib/http.js';
import { sha256Hex } from '../orders.js';

export const DOWNLOADS_PER_PURCHASE = 1;
export const CLAIM_HOURS = 24;                         // how long an interrupted download can still be resumed
export const CLAIM_REQUESTS = 20;                      // requests allowed for one download (resumes after drops)
// Overlap allowed when a dropped download resumes (bytes already sent but not received are sent again): at most
// 16 MB, and never more than 45% of the file, so the total can never reach two complete copies.
export const MAX_ALLOWANCE_BYTES = 16 * 1024 * 1024;
export const allowanceFor = (size) => Math.min(MAX_ALLOWANCE_BYTES, Math.floor(Number(size) * 0.45));
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

// Sends the file (or the requested part of it) for a pressed download. Returns a Response, or
// { refused: reason, status } for the caller to show a page.
export async function serveClaim(request, env, ctx, ent, { onCompleted } = {}) {
  if (!ent) return { refused: 'unknown', status: 410 };
  if (ent.revoked_at) { await recordEvent(env, ent, 'blocked_replaced', 'Old download address used'); return { refused: 'replaced', status: 410 }; }
  if (!(await holdsClaim(request, ent))) { await recordEvent(env, ent, 'blocked_other_browser', 'Download address opened in another browser or phone'); return { refused: 'other_browser', status: 403 }; }
  if (transferState(ent) === 'completed') { await recordEvent(env, ent, 'blocked_after_complete', 'The whole file had already been sent'); return { refused: 'completed', status: 410 }; }
  if (Date.parse(claimEndsAt(ent)) <= Date.now()) { await recordEvent(env, ent, 'blocked_late', 'Resume tried after 24 hours'); return { refused: 'late', status: 410 }; }

  let head = null;
  try { head = await env.MEDIA.head(ent.file_key); } catch { head = null; }
  if (!head) return { refused: 'missing', status: 410 };
  const size = head.size;
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
  let range = ifRange && ifRange !== etag ? null : parseRange(request.headers.get('Range'), size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' } });
  const offset = range ? range.offset : 0;
  const length = range ? range.length : size;

  const counted = await env.DB.prepare(`UPDATE download_entitlements SET claim_requests = claim_requests + 1 WHERE id = ?1 AND claim_requests < ?2 RETURNING claim_requests`)
    .bind(ent.id, CLAIM_REQUESTS).first();
  if (!counted) { await recordEvent(env, ent, 'blocked_too_many', `More than ${CLAIM_REQUESTS} requests for one download`); return { refused: 'too_many', status: 429 }; }
  // Reserve the bytes all-or-nothing: requests at the same moment can't add up to more than one copy
  const reserved = await env.DB.prepare(`UPDATE download_entitlements SET bytes_reserved = bytes_reserved + ?1, transfer_status = 'in_progress'
      WHERE id = ?2 AND revoked_at IS NULL AND transfer_status != 'completed' AND bytes_reserved + ?1 <= ?3 RETURNING id`)
    .bind(length, ent.id, size + allowanceFor(size)).first();
  if (!reserved) {
    await recordEvent(env, ent, 'blocked_limit', range ? `Asked for bytes ${offset}-${offset + length - 1}` : 'Asked for the whole file again while it was already being sent');
    return { refused: 'limit', status: 409 };
  }
  const ins = await env.DB.prepare(`INSERT INTO download_transfers (entitlement_id, order_id, range_start, range_length, file_size, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(ent.id, ent.order_id, offset, length, size, String(request.headers.get('User-Agent') || '').slice(0, 200)).run();
  const transferId = ins.meta.last_row_id;

  let object = null;
  try { object = await env.MEDIA.get(ent.file_key, range ? { range: { offset, length } } : undefined); } catch { object = null; }
  if (!object) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE download_entitlements SET bytes_reserved = MAX(0, bytes_reserved - ?1) WHERE id = ?2`).bind(length, ent.id),
      env.DB.prepare(`UPDATE download_transfers SET status = 'interrupted', finished_at = ?1, updated_at = ?1 WHERE id = ?2`).bind(nowIso(), transferId)
    ]);
    return { refused: 'missing', status: 410 };
  }

  // ---- the counting stream: records what was sent, and how the transfer ended ----
  let sent = 0, flushed = 0, lastFlush = Date.now(), ended = false;
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
        // bytes reserved but never sent are given back, so the same download can resume after a drop
        env.DB.prepare(`UPDATE download_entitlements SET bytes_reserved = MAX(0, bytes_reserved - ?1) WHERE id = ?2`).bind(length - sent, ent.id)
      ]);
      let completedNow = false;
      if (whole) {
        const { results } = await env.DB.prepare(`SELECT range_start, bytes_sent FROM download_transfers WHERE entitlement_id = ?1`).bind(ent.id).all();
        if (coversWholeFile((results || []).map((t) => [t.range_start, t.range_start + t.bytes_sent]), size)) {
          completedNow = !!(await env.DB.prepare(`UPDATE download_entitlements SET transfer_status = 'completed', transfer_completed_at = ?1
              WHERE id = ?2 AND transfer_status != 'completed' RETURNING id`).bind(at, ent.id).first());
        }
      }
      if (!completedNow) {
        // still incomplete: 'interrupted' unless another request for the same download is still sending
        await env.DB.prepare(`UPDATE download_entitlements SET transfer_status = 'interrupted' WHERE id = ?1 AND transfer_status = 'in_progress'
            AND NOT EXISTS (SELECT 1 FROM download_transfers WHERE entitlement_id = ?1 AND status = 'in_progress')`).bind(ent.id).run();
      }
      if (completedNow && onCompleted) await onCompleted(ent.id);
    });
    queue.then(() => finish());
  };
  const reader = object.body.getReader();
  const counting = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { controller.close(); end('done'); return; }
        sent += value.byteLength;
        controller.enqueue(value);
        if (sent - flushed >= FLUSH_BYTES || Date.now() - lastFlush >= FLUSH_MS) await flush();
      } catch (err) {
        try { controller.error(err); } catch { /* already closed */ }
        end('error');
      }
    },
    cancel(reason) {
      // the phone stopped the download, or the connection dropped
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
