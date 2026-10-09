// Meditation recordings in R2.
//   Public previews:   audio/previews/...      (served by /media like other audio; 1 minute or less)
//   Full recordings:   private/meditations/... (NEVER served by /media; only through a paid, time-limited download)
import { HttpError, randomToken } from '../lib/http.js';
import { mp3Duration } from '../lib/mp3.js';

export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
export const MAX_FULL_BYTES = 95 * 1024 * 1024;     // Cloudflare's free plan accepts uploads up to 100 MB
export const MAX_PREVIEW_SECONDS = 60;

const stamp = () => { const d = new Date(); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const rand = () => randomToken(12).toLowerCase().replace(/[^a-z0-9]/g, 'x');
const isMp3Start = (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);

export async function storePreview(env, request, originalName) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (!length) throw new HttpError(411, 'The preview did not arrive. Please try again.');
  if (length > MAX_PREVIEW_BYTES) throw new HttpError(413, 'That preview file is too large. A 1-minute MP3 is usually under 2 MB.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_PREVIEW_BYTES) throw new HttpError(413, 'That preview file is too large.');
  const seconds = mp3Duration(bytes);
  if (seconds === null) throw new HttpError(400, 'Please choose an MP3 file for the preview.');
  if (seconds > MAX_PREVIEW_SECONDS + 0.05) throw new HttpError(400, 'Preview audio must be 1 minute or less.');
  const key = `audio/previews/${stamp()}/preview-${rand()}.mp3`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=31536000, immutable' } });
  await env.DB.prepare('INSERT INTO media (key, kind, content_type, size_bytes, original_name) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(key, 'audio', 'audio/mpeg', bytes.length, String(originalName || '').slice(0, 120)).run();
  return { key, seconds };
}

// Streamed straight into private storage (no copy held in the Worker), then checked
export async function storeFull(env, request, originalName, productId) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (!length) throw new HttpError(411, 'The recording did not arrive. Please try again.');
  if (length > MAX_FULL_BYTES) throw new HttpError(413, 'That recording is too large. Please choose an MP3 under 95 MB.');
  const key = `private/meditations/${stamp()}/meditation-${rand()}.mp3`;
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: 'audio/mpeg' } });
  const head = await env.MEDIA.get(key, { range: { offset: 0, length: 16 } });
  if (!head || !isMp3Start(new Uint8Array(await head.arrayBuffer()))) {
    await env.MEDIA.delete(key);
    throw new HttpError(400, 'That file isn’t an MP3 recording. Please choose an MP3 file.');
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO product_files (key, product_id) VALUES (?1, ?2)').bind(key, productId),
    env.DB.prepare('INSERT INTO media (key, kind, content_type, size_bytes, original_name) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(key, 'audio', 'audio/mpeg', length, String(originalName || '').slice(0, 120))
  ]);
  return { key };
}

// Replaced full recordings are kept while any download link that uses them can still be used, then removed.
export async function removeRetiredRecordings(env) {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT f.key FROM product_files f WHERE f.retired_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.full_key = f.key)
       AND NOT EXISTS (SELECT 1 FROM download_entitlements d WHERE d.file_key = f.key AND d.revoked_at IS NULL
             AND ((d.expires_at > ?1 AND d.attempts < d.max_attempts) OR d.completed_at > ?2))
     LIMIT 20`).bind(now, new Date(Date.now() - 20 * 60_000).toISOString()).all();
  for (const { key } of results || []) {
    await env.MEDIA.delete(key);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM product_files WHERE key = ?1').bind(key),
      env.DB.prepare('DELETE FROM media WHERE key = ?1').bind(key)
    ]);
  }
}
