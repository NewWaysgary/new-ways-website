// Backups. A backup is one JSON file containing all the website's content and settings
// (not sign-in sessions or security records). Photos and music stay in R2 and are listed in the file.
const TABLES = ['settings', 'content_blocks', 'mediums', 'events', 'charity_totals', 'faqs', 'gallery_photos', 'reviews',
  'announcements', 'live_stream', 'teaching_videos', 'social_links', 'music', 'media', 'owner',
  'reading_services', 'availability_weekly', 'availability_dates', 'availability_blocks', 'orders', 'bookings', 'booking_slots',
  'square_events', 'products', 'product_files', 'download_entitlements', 'email_log',
  'event_questions', 'event_question_options', 'event_bookings', 'event_guests', 'event_answers', 'event_changes', 'event_email_log', 'mailing_list', 'checkin_helpers',
  'admin_users', 'order_devices', 'download_transfers', 'download_events', 'download_replacements', 'event_tables', 'event_table_guests', 'event_medium_guests', 'till_items', 'till_sales', 'till_sale_lines', 'wed_nights',
  'wed_orders', 'wed_order_lines', 'wed_email_log', 'chat_sessions', 'chat_messages', 'tour_stops'];
const KEEP_AUTOMATIC = 8;
// Never put in a backup file: the website's private key for phone notifications (phones simply turn notifications on again)
const SECRET_SETTINGS = /^vapid_/;

export async function buildBackup(env) {
  const results = await env.DB.batch(TABLES.map((t) => env.DB.prepare(`SELECT * FROM ${t}`)));
  const tables = {};
  TABLES.forEach((t, i) => { tables[t] = results[i].results || []; });
  tables.settings = tables.settings.filter((r) => !SECRET_SETTINGS.test(r.key));
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
