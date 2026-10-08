// Backups. A backup is one JSON file containing all the website's content and settings
// (not sign-in sessions or security records). Photos and music stay in R2 and are listed in the file.
const TABLES = ['settings', 'content_blocks', 'mediums', 'events', 'charity_totals', 'faqs', 'gallery_photos', 'reviews',
  'announcements', 'live_stream', 'teaching_videos', 'social_links', 'music', 'media', 'owner',
  'reading_services', 'availability_weekly', 'availability_dates', 'availability_blocks', 'orders', 'bookings', 'booking_slots',
  'square_events', 'products', 'product_files', 'download_entitlements', 'email_log'];
const KEEP_AUTOMATIC = 8;

export async function buildBackup(env) {
  const results = await env.DB.batch(TABLES.map((t) => env.DB.prepare(`SELECT * FROM ${t}`)));
  const tables = {};
  TABLES.forEach((t, i) => { tables[t] = results[i].results || []; });
  const media = tables.media.reduce((sum, m) => sum + (m.size_bytes || 0), 0);
  return {
    format: 'new-ways-backup', version: 1, created_at: new Date().toISOString(),
    summary: Object.fromEntries(TABLES.map((t) => [t, tables[t].length])),
    media_bytes: media,
    note: 'Photos and music are stored separately in Cloudflare R2 under the keys listed in the media table.',
    tables
  };
}

export const backupName = (date = new Date()) => `new-ways-backup-${date.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;

export async function listStoredBackups(env) {
  const listed = await env.MEDIA.list({ prefix: 'backups/' });
  return (listed.objects || []).map((o) => ({ key: o.key, name: o.key.slice(8), size: o.size, uploaded: o.uploaded ? new Date(o.uploaded).toISOString() : '' }))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

export async function storeBackup(env) {
  const backup = await buildBackup(env);
  const key = 'backups/' + backupName();
  await env.MEDIA.put(key, JSON.stringify(backup), { httpMetadata: { contentType: 'application/json' } });
  const all = await listStoredBackups(env);
  for (const old of all.slice(KEEP_AUTOMATIC)) await env.MEDIA.delete(old.key);
  return key;
}

// Weekly: called by the daily housekeeping job, makes a copy if the newest is 6 days old or more
export async function weeklyBackup(env) {
  const all = await listStoredBackups(env);
  const newest = all[0] && all[0].uploaded ? Date.parse(all[0].uploaded) : 0;
  if (Date.now() - newest >= 6 * 86400_000) await storeBackup(env);
}

export async function storageUsed(env) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(*) AS files FROM media').first();
  return { bytes: row.bytes, files: row.files };
}
