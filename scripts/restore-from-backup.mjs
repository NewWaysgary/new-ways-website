// Restore tool (for a developer). Turns a New Way's backup file into SQL that replaces the website's content.
//   node scripts/restore-from-backup.mjs new-ways-backup-....json > restore.sql
//   npx wrangler d1 execute new-ways --remote --file restore.sql
// Sign-in sessions and security records are not touched. Photos and music stay in R2 (keys are listed in the backup).
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/restore-from-backup.mjs <backup.json>'); process.exit(1); }
const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
if (backup.format !== 'new-ways-backup' || backup.version !== 1 || !backup.tables) { console.error('This is not a New Way’s backup file.'); process.exit(1); }

const ORDER = ['settings', 'content_blocks', 'mediums', 'events', 'charity_totals', 'faqs', 'gallery_photos', 'reviews',
  'announcements', 'live_stream', 'teaching_videos', 'social_links', 'music', 'media', 'owner',
  'reading_services', 'availability_weekly', 'availability_dates', 'availability_blocks', 'orders', 'bookings', 'booking_slots',
  'square_events', 'products', 'product_files', 'download_entitlements', 'email_log',
  'event_questions', 'event_question_options', 'event_bookings', 'event_guests', 'event_answers', 'event_changes', 'event_email_log', 'mailing_list', 'checkin_helpers',
  'admin_users', 'order_devices', 'download_transfers', 'download_events', 'download_replacements', 'event_tables', 'event_table_guests', 'event_medium_guests', 'till_items',
  // till sales go in BEFORE the nights, because the database refuses a new sale on a night already closed
  'till_sales', 'till_sale_lines', 'wed_nights', 'wed_orders', 'wed_order_lines', 'wed_email_log', 'chat_sessions', 'chat_messages', 'tour_stops'];
// Payment and booking records are MERGED, never deleted: restoring an older backup must not remove orders paid since.
const MERGE = new Set(['products', 'orders', 'bookings', 'booking_slots', 'square_events', 'product_files', 'download_entitlements', 'email_log',
  'event_questions', 'event_question_options', 'event_bookings', 'event_guests', 'event_answers', 'event_changes', 'event_email_log', 'mailing_list', 'checkin_helpers',
  'admin_users', 'order_devices', 'download_transfers', 'download_events', 'download_replacements', 'event_tables', 'event_table_guests', 'event_medium_guests', 'till_sales', 'till_sale_lines', 'wed_nights', 'wed_orders', 'wed_order_lines',
  'wed_email_log', 'chat_sessions', 'chat_messages']);
const literal = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const ident = (n) => { if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error('Unexpected column name: ' + n); return n; };

const out = ['-- New Way’s restore, from backup made ' + backup.created_at];
for (const table of ORDER) {
  const rows = backup.tables[table];
  if (!Array.isArray(rows)) continue;
  if (!MERGE.has(table)) out.push(`DELETE FROM ${table};`);
  for (const row of rows) {
    const cols = Object.keys(row).map(ident);
    out.push(`INSERT${MERGE.has(table) ? ' OR IGNORE' : ''} INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => literal(row[c])).join(', ')});`);
  }
}
process.stdout.write(out.join('\n') + '\n');
