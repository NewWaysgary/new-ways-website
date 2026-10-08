// All database access goes through here (Cloudflare D1, which is SQLite).
import { SETTING_DEFAULTS } from './settings.js';
import { ukToday } from './dates.js';

export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const stored = Object.fromEntries((results || []).map((r) => [r.key, r.value]));
  return { ...SETTING_DEFAULTS, ...stored };
}

export async function saveSettings(env, values) {
  const statements = Object.entries(values).map(([key, value]) =>
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(key, value)
  );
  statements.push(audit(env, 'settings.update', 'Centre Settings saved'));
  await env.DB.batch(statements);
}

export async function getBlocks(env, keys) {
  const placeholders = keys.map((_, i) => '?' + (i + 1)).join(',');
  const { results } = await env.DB.prepare(`SELECT key, title, body, updated_at FROM content_blocks WHERE key IN (${placeholders})`)
    .bind(...keys).all();
  const map = Object.fromEntries((results || []).map((r) => [r.key, r]));
  for (const k of keys) if (!map[k]) map[k] = { key: k, title: '', body: '' };
  return map;
}

export async function getAllBlocks(env) {
  const { results } = await env.DB.prepare('SELECT key, title, body, updated_at FROM content_blocks').all();
  return results || [];
}

export async function saveBlock(env, key, title, body) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO content_blocks (key, title, body, updated_at) VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(key) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at`
    ).bind(key, title, body),
    audit(env, 'wording.update', `Wording saved: ${key}`)
  ]);
}

// Upcoming, visible mediums: anything dated before today (UK time) drops off automatically.
export async function upcomingMediums(env, limit = 52) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM mediums WHERE visible = 1 AND date >= ?1 ORDER BY date ASC, sort_order ASC, id ASC LIMIT ?2`
  ).bind(ukToday(), limit).all();
  return results || [];
}

export async function upcomingEvents(env, limit = 50) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM events WHERE visible = 1 AND date >= ?1 ORDER BY date ASC, sort_order ASC, id ASC LIMIT ?2`
  ).bind(ukToday(), limit).all();
  return results || [];
}

export async function charityTotals(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM charity_totals WHERE visible = 1 ORDER BY sort_order ASC, id ASC'
  ).all();
  return results || [];
}

export async function visibleFaqs(env) {
  const { results } = await env.DB.prepare('SELECT * FROM faqs WHERE visible = 1 ORDER BY sort_order ASC, id ASC').all();
  return results || [];
}

// Announcements switched on and inside their optional start and end times
export async function activeAnnouncements(env) {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT * FROM announcements
     WHERE active = 1 AND (starts_at IS NULL OR starts_at <= ?1) AND (ends_at IS NULL OR ends_at > ?1)
     ORDER BY CASE importance WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, id DESC LIMIT 3`
  ).bind(now).all();
  return results || [];
}

export async function liveStream(env) {
  return (await env.DB.prepare('SELECT * FROM live_stream WHERE id = 1').first()) || { is_live: 0 };
}

export async function featuredReviews(env, limit = 3) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, rating, body FROM reviews WHERE status = 'approved' AND consent = 1 AND featured = 1
     ORDER BY decided_at DESC, id DESC LIMIT ?1`
  ).bind(limit).all();
  return results || [];
}

export async function approvedReviews(env, limit = 100) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, rating, body, created_at FROM reviews WHERE status = 'approved' AND consent = 1
     ORDER BY featured DESC, decided_at DESC, id DESC LIMIT ?1`
  ).bind(limit).all();
  return results || [];
}

export async function visibleVideos(env) {
  const { results } = await env.DB.prepare('SELECT * FROM teaching_videos WHERE visible = 1 ORDER BY sort_order ASC, id DESC').all();
  return results || [];
}

export async function visibleGallery(env) {
  const { results } = await env.DB.prepare('SELECT * FROM gallery_photos WHERE visible = 1 ORDER BY sort_order ASC, id DESC').all();
  return results || [];
}

export async function socialLinks(env) {
  const { results } = await env.DB.prepare('SELECT * FROM social_links WHERE visible = 1 ORDER BY sort_order ASC, id ASC').all();
  return results || [];
}

export async function dashboardCounts(env) {
  const [pending, mediums, events] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'`),
    env.DB.prepare('SELECT COUNT(*) AS n FROM mediums WHERE visible = 1 AND date >= ?1').bind(ukToday()),
    env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE visible = 1 AND date >= ?1').bind(ukToday())
  ]);
  // The private counters are read separately, so the dashboard still works if they ever can't be read
  // (for example before migration 0005 has been applied).
  let visitors = null, installs = null;
  try {
    [visitors, installs] = await env.DB.batch([
      env.DB.prepare("SELECT value AS n FROM app_metrics WHERE key = 'unique_visitors'"),
      env.DB.prepare("SELECT value AS n FROM app_metrics WHERE key = 'app_installs'")
    ]);
  } catch (err) {
    console.error("New Way's: could not read the private counters:", err && err.message ? err.message : err);
  }
  // Bookings, read separately for the same reason (before migration 0006 is applied they simply show 0)
  let readings = null, attention = null;
  try {
    [readings, attention] = await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND end_utc > ?1`).bind(new Date().toISOString()),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'needs_attention'`)
    ]);
  } catch (err) {
    console.error("New Way's: could not read the booking counts:", err && err.message ? err.message : err);
  }
  return {
    upcomingReadings: readings?.results?.[0]?.n ?? 0,
    needsAttention: attention?.results?.[0]?.n ?? 0,
    pendingReviews: pending.results?.[0]?.n ?? 0,
    upcomingMediums: mediums.results?.[0]?.n ?? 0,
    upcomingEvents: events.results?.[0]?.n ?? 0,
    uniqueVisitors: visitors?.results?.[0]?.n ?? 0,
    appInstalls: installs?.results?.[0]?.n ?? 0
  };
}

export async function incrementMetric(env, key) {
  if (!['unique_visitors', 'app_installs'].includes(key)) return false;
  await env.DB.prepare('UPDATE app_metrics SET value = value + 1 WHERE key = ?1').bind(key).run();
  return true;
}

export function audit(env, action, summary) {
  return env.DB.prepare('INSERT INTO audit_log (action, summary) VALUES (?1, ?2)').bind(action, summary.slice(0, 300));
}

// ---------- Stage 3 ----------
export async function musicSettings(env) {
  return (await env.DB.prepare('SELECT * FROM music WHERE id = 1').first()) || { enabled: 0, track_key: '', default_volume: 40 };
}

export async function reviewCounts(env) {
  const { results } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status').all();
  return Object.fromEntries((results || []).map((r) => [r.status, r.n]));
}

export async function reviewsByStatus(env, status) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM reviews WHERE status = ?1 ORDER BY ${status === 'pending' ? 'created_at ASC' : 'COALESCE(decided_at, created_at) DESC'}, id DESC LIMIT 200`
  ).bind(status).all();
  return results || [];
}

export async function videoCategories(env) {
  const { results } = await env.DB.prepare("SELECT DISTINCT category FROM teaching_videos WHERE category <> '' ORDER BY category").all();
  return (results || []).map((r) => r.category);
}

// Housekeeping (daily, and whenever experiences are handled): keeps the privacy promises
export async function housekeeping(env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reviews WHERE status = 'rejected' AND decided_at < ?1`).bind(new Date(now - 30 * 86400_000).toISOString()),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(Math.floor(now / 1000) - 2 * 86400),
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?1').bind(new Date(now).toISOString())
  ]);
  // Kept separate, so the jobs above still run if this one ever can't (for example before migration 0006 is applied).
  try { await removeOldCustomerDetails(env, now); }
  catch (err) { console.error("New Way's: customer-detail clean-up did not run:", err && err.message ? err.message : err); }
}

// Customer contact details are kept for the retention period set in Admin (2 years to start with). After that the
// name, email address and phone number are blanked. The ORDER ITSELF IS NEVER DELETED: its date, item, amount paid
// and Square payment reference stay for the financial records. Orders marked as needing attention, and readings
// that haven't happened yet, are left alone.
export async function removeOldCustomerDetails(env, now = Date.now()) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'customer_retention_months'").first();
  const months = /^\d{1,3}$/.test(String(row?.value ?? '')) && Number(row.value) >= 6 ? Number(row.value) : 24;
  const cut = new Date(now);
  cut.setUTCMonth(cut.getUTCMonth() - months);
  const cutoff = cut.toISOString();
  const nowIso = new Date(now).toISOString();
  const due = `personal_data_removed_at IS NULL AND status != 'needs_attention' AND created_at < ?1
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.order_id = orders.id AND b.end_utc > ?1)`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE email_log SET recipient = '' WHERE recipient != '' AND order_id IN (SELECT id FROM orders WHERE ${due})`).bind(cutoff),
    env.DB.prepare(`UPDATE orders SET customer_name = '', customer_email = '', customer_phone = '', personal_data_removed_at = ?2 WHERE ${due}`).bind(cutoff, nowIso)
  ]);
}

// The Visitor Experiences ON/OFF switch (Admin > Visitor experiences). Open unless Gary has closed it.
export async function reviewsOpen(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'reviews_open'").first();
  return !row || row.value !== '0';
}
