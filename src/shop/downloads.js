// Secure meditation downloads: ONE download per purchase.
//
// - The customer has 24 hours (Admin setting) after purchase to START their one download.
// - Only on the device used to buy, or another device confirmed with an emailed code (see shop/devices.js).
// - Starting it uses the purchase's download. For the next 15 minutes the SAME download may continue or restart
//   (Android's download manager often asks for the file a second time, and connections drop); this never gives a
//   second, independent copy, because after those 15 minutes the link stops working completely.
// - Admin can always issue a fresh link for a genuine problem.
// The full recording stays private in R2 and is only ever sent through these checks.

export const DOWNLOADS_PER_PURCHASE = 1;
export const SAFETY_WINDOW_MINUTES = 15;
const WINDOW_MS = SAFETY_WINDOW_MINUTES * 60_000;

// 'available' | 'started' (used, but still inside the 15-minute window) | 'used' | 'expired' | 'gone'
export function downloadState(ent, nowMs = Date.now()) {
  if (!ent || ent.revoked_at) return 'gone';
  if (ent.attempts >= ent.max_attempts) {
    return ent.completed_at && Date.parse(ent.completed_at) + WINDOW_MS > nowMs ? 'started' : 'used';
  }
  return Date.parse(ent.expires_at) > nowMs ? 'available' : 'expired';
}

export const windowEndsAt = (ent) => (ent && ent.completed_at ? new Date(Date.parse(ent.completed_at) + WINDOW_MS).toISOString() : null);

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

// Sends the file if this entitlement allows it right now, otherwise returns null.
export async function deliver(request, env, ent) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const state = downloadState(ent, nowMs);
  const range = request.headers.get('Range');
  const product = await env.DB.prepare('SELECT title, by_line FROM products WHERE id = ?1').bind(ent.product_id).first();
  const headers = new Headers({
    // A generic file type plus "attachment" makes phones SAVE the file instead of opening it in the browser's player
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': contentDisposition(downloadFilename(product)),
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'
  });
  // Link checks (HEAD) never use the download
  if (request.method === 'HEAD') return state === 'available' || state === 'started' ? new Response(null, { headers }) : null;

  let row = null;
  if (state === 'started') {
    row = ent;                                   // inside the 15-minute window: continue or restart the same download
  } else if (state === 'available') {
    // The first genuine request uses the download (all-or-nothing, so two requests at once can't both count as first)
    row = await env.DB.prepare(`UPDATE download_entitlements SET attempts = attempts + 1, completed_at = ?1
      WHERE id = ?2 AND revoked_at IS NULL AND expires_at > ?1 AND attempts < max_attempts RETURNING *`).bind(now, ent.id).first();
    if (!row) {
      const fresh = await env.DB.prepare('SELECT * FROM download_entitlements WHERE id = ?1').bind(ent.id).first();
      row = downloadState(fresh, nowMs) === 'started' ? fresh : null;
    }
  }
  if (!row) return null;
  const object = await env.MEDIA.get(row.file_key, range ? { range: request.headers } : undefined);
  if (!object) return null;
  if (range && object.range) {
    const r = object.range;
    const offset = r.offset !== undefined ? r.offset : object.size - r.suffix;
    const length = r.length !== undefined ? r.length : object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}
