// Photos, posters and logos in R2.
// Photos are resized and compressed on Gary's phone before upload (see public/js/admin.js).
// The server checks every file really is a JPEG, PNG or WebP image (by its content, not its name)
// and stores it under a new random address, so phones and Cloudflare can cache it for ever.
import { HttpError, randomToken } from './http.js';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

// Works out the real type and size of an image from its first bytes.
export function imageInfo(bytes) {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { type: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length > 30 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...b.slice(12, 16));
    if (chunk === 'VP8X') return { type: 'image/webp', ext: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === 'VP8 ') return { type: 'image/webp', ext: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: 'image/webp', ext: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'image/jpeg', ext: 'jpg', width: u16be(b, i + 7), height: u16be(b, i + 5) };
      }
      i += 2 + len;
    }
    return { type: 'image/jpeg', ext: 'jpg', width: 0, height: 0 };
  }
  return null;
}

export async function storeImage(env, file, purpose) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, 'That photo is too large. Please choose one under 8 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = imageInfo(bytes);
  if (!info) throw new HttpError(400, 'That file isn’t a photo this site can use. Please choose a JPEG, PNG or WebP image.');
  if (info.width > 12000 || info.height > 12000) throw new HttpError(400, 'That photo is unusually large. Please choose a smaller one.');
  const d = new Date();
  const key = `img/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${purpose}-${randomToken(12).toLowerCase().replace(/[^a-z0-9]/g, 'x')}.${info.ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: info.type, cacheControl: 'public, max-age=31536000, immutable' } });
  await env.DB.prepare('INSERT INTO media (key, kind, content_type, size_bytes, width, height, original_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(key, 'image', info.type, bytes.length, info.width, info.height, String(file.name || '').slice(0, 120)).run();
  return key;
}

export async function deleteMedia(env, key) {
  if (!key) return;
  await env.MEDIA.delete(key);
  await env.DB.prepare('DELETE FROM media WHERE key = ?1').bind(key).run();
}

// ---------- background music (audio) ----------
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_TYPES = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/ogg': 'ogg' };

function audioKind(b) {
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return { type: 'audio/mpeg', ext: 'mp3' };                 // ID3 tag
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { type: 'audio/mpeg', ext: 'mp3' };                          // MPEG frame
  if (String.fromCharCode(...b.slice(4, 8)) === 'ftyp') return { type: 'audio/mp4', ext: 'm4a' };                  // MP4 / M4A
  if (String.fromCharCode(...b.slice(0, 4)) === 'OggS') return { type: 'audio/ogg', ext: 'ogg' };
  return null;
}

// The file is streamed straight into R2 (no copy held in the Worker), then its first bytes are checked.
export async function storeAudioStream(env, request, originalName) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (!length) throw new HttpError(411, 'The music file did not arrive. Please try again.');
  if (length > MAX_AUDIO_BYTES) throw new HttpError(413, 'That music file is too large. Please choose one under 20 MB.');
  const declared = AUDIO_TYPES[(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()];
  if (!declared) throw new HttpError(415, 'Please choose an MP3, M4A or OGG music file.');
  const d = new Date();
  const key = `audio/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/music-${randomToken(12).toLowerCase().replace(/[^a-z0-9]/g, 'x')}.${declared}`;
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: request.headers.get('Content-Type'), cacheControl: 'public, max-age=31536000, immutable' } });
  const head = await env.MEDIA.get(key, { range: { offset: 0, length: 16 } });
  const kind = head ? audioKind(new Uint8Array(await head.arrayBuffer())) : null;
  if (!kind) {
    await env.MEDIA.delete(key);
    throw new HttpError(400, 'That file isn’t a music file this site can play. Please choose an MP3, M4A or OGG file.');
  }
  await env.DB.prepare('INSERT INTO media (key, kind, content_type, size_bytes, original_name) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(key, 'audio', kind.type, length, String(originalName || '').slice(0, 120)).run();
  return key;
}
