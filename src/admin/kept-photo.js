// A photo chosen in an Admin form that couldn't be saved yet (a mistake elsewhere on the form): the photo is stored
// straight away and the form carries a signed note of it, so it doesn't have to be chosen again. The note is signed
// with the website's secret, so a form can only ever refer to a photo this website stored for that purpose.
const enc = new TextEncoder();
async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode('kept-photo:' + String(env.SESSION_SECRET || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function keepPhotoToken(env, mediaKey) {
  const at = Date.now();
  return `${mediaKey}|${at}|${await sign(env, `${mediaKey}|${at}`)}`;
}
// The media key, if the note is genuine, less than a day old and the photo is still stored
export async function readKeptPhoto(env, token) {
  const m = /^(img\/[A-Za-z0-9/._-]{1,200})\|(\d{13})\|([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!m || !env.SESSION_SECRET) return null;
  if (Date.now() - Number(m[2]) > 86400_000) return null;
  if (m[3] !== (await sign(env, `${m[1]}|${m[2]}`))) return null;
  const row = await env.DB.prepare('SELECT key FROM media WHERE key = ?1').bind(m[1]).first();
  return row ? m[1] : null;
}
