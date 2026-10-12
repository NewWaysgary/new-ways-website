// Incomplete private reading bookings.
// When the booking assistant accepts a customer's name, WhatsApp mobile and email, they are saved here with the
// reading, date and time. If the customer is inactive for 30 minutes without pressing Proceed to Secure Payment, the
// record becomes INCOMPLETE and Gary gets ONE email with no personal details in it (the details are only in Admin).
// Every record is deleted 24 hours after it was first saved, whatever happened. These records never hold an
// appointment time: only the existing 15-minute payment hold does that.
import { randomToken } from '../lib/http.js';
import { sendEmail } from '../lib/email.js';
import { build, context } from '../notify.js';
import { longDate } from '../lib/dates.js';
import { friendlyTime } from './availability.js';

export const INACTIVE_MINUTES = 30;
export const KEEP_HOURS = 24;

const nowIso = () => new Date().toISOString();
async function hashOf(key) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('draft:' + key));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const validKey = (key) => /^[A-Za-z0-9_-]{20,64}$/.test(String(key || ''));

// Removes every record older than 24 hours. Run before anything is read, and every hour.
export async function deleteExpired(env) {
  await env.DB.prepare('DELETE FROM reading_drafts WHERE delete_after <= ?1').bind(nowIso()).run();
}

// The customer gave their details (or changed them). Returns the key for their browser.
export async function saveDetails(env, { key, service, date, time, name, phone, email, origin }) {
  await deleteExpired(env);
  const now = nowIso();
  if (validKey(key)) {
    // The same customer changing their details: update their own record (it stays in progress, its 24 hours unchanged)
    const row = await env.DB.prepare(`UPDATE reading_drafts SET service_code = ?1, service_name = ?2, minutes = ?3, date = ?4, local_start = ?5, customer_name = ?6,
        customer_phone = ?7, customer_email = ?8, last_active_at = ?9, status = CASE WHEN status = 'checkout' THEN status ELSE 'in_progress' END
      WHERE token_hash = ?10 RETURNING id`)
      .bind(service.code, service.name, service.minutes, date, time, name, phone, email, now, await hashOf(key)).first();
    if (row) return key;
  }
  const fresh = randomToken(24);
  await env.DB.prepare(`INSERT INTO reading_drafts (token_hash, service_code, service_name, minutes, date, local_start, customer_name, customer_phone, customer_email, origin,
      status, created_at, last_active_at, delete_after) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'in_progress', ?11, ?11, ?12)`)
    .bind(await hashOf(fresh), service.code, service.name, service.minutes, date, time, name, phone, email, origin, now,
      new Date(Date.now() + KEEP_HOURS * 3600_000).toISOString()).run();
  return fresh;
}

// The customer is still using the booking assistant: the 30 minutes start again
export async function stillActive(env, key) {
  if (!validKey(key)) return false;
  const row = await env.DB.prepare(`UPDATE reading_drafts SET last_active_at = ?1, status = CASE WHEN status = 'incomplete' THEN 'in_progress' ELSE status END
    WHERE token_hash = ?2 AND delete_after > ?1 RETURNING id`).bind(nowIso(), await hashOf(key)).first();
  return !!row;
}

// The customer pressed Proceed to Secure Payment and their order was made: never incomplete from now on
export async function wentToPayment(env, key, reference) {
  if (!validKey(key)) return;
  await env.DB.prepare(`UPDATE reading_drafts SET status = 'checkout', order_reference = ?1, last_active_at = ?2 WHERE token_hash = ?3 AND delete_after > ?2`)
    .bind(reference, nowIso(), await hashOf(key)).run();
}

// Every hour: delete old records, mark inactive ones incomplete, and tell Gary once about each
export async function incompleteHourlyJobs(env) {
  await deleteExpired(env);
  const cutoff = new Date(Date.now() - INACTIVE_MINUTES * 60_000).toISOString();
  await env.DB.prepare(`UPDATE reading_drafts SET status = 'incomplete', incomplete_at = ?1 WHERE status = 'in_progress' AND last_active_at <= ?2`).bind(nowIso(), cutoff).run();
  const { results } = await env.DB.prepare(`SELECT * FROM reading_drafts WHERE status = 'incomplete' AND notify_status IN ('', 'failed') ORDER BY id LIMIT 20`).all();
  let c = null;
  for (const d of results || []) {
    // Claim it first, so the email can only ever be sent once
    const claimed = await env.DB.prepare(`UPDATE reading_drafts SET notify_status = 'sending' WHERE id = ?1 AND notify_status IN ('', 'failed') RETURNING id`).bind(d.id).first();
    if (!claimed) continue;
    c = c || await context(env);
    const to = c.b.notification_email;
    if (!to) { await env.DB.prepare(`UPDATE reading_drafts SET notify_status = 'no_address' WHERE id = ?1`).bind(d.id).run(); continue; }
    // No personal details in the email: they are only in Admin, and deleted after 24 hours
    const when = `${longDate(d.date, '0000')} at ${friendlyTime(d.local_start)} (UK time)`;
    const msg = build(c.centre, ['An incomplete booking: a customer gave their details for a private reading but did not go on to payment.',
      `Reading: ${d.service_name}, ${when}.`,
      `See Admin › Incomplete Bookings: ${d.origin || ''}/admin/incomplete`,
      'For privacy, the customer’s details are only shown in Admin, and are deleted automatically 24 hours after they were given.']);
    let out;
    try { out = await sendEmail(env, { to, subject: `Incomplete booking: ${d.service_name}, ${longDate(d.date, '0000')}`, ...msg }); }
    catch { out = { status: 'failed' }; }
    await env.DB.prepare('UPDATE reading_drafts SET notify_status = ?1 WHERE id = ?2').bind(out.status === 'sent' ? 'sent' : out.status === 'not_configured' ? 'not_configured' : 'failed', d.id).run();
  }
}

// For Admin: every record still within its 24 hours, with what happened to it
export async function listForAdmin(env) {
  await deleteExpired(env);
  const { results } = await env.DB.prepare(`SELECT d.*, o.status AS order_status FROM reading_drafts d LEFT JOIN orders o ON o.reference = d.order_reference
    WHERE d.delete_after > ?1 ORDER BY d.created_at DESC LIMIT 200`).bind(nowIso()).all();
  const cutoff = Date.now() - INACTIVE_MINUTES * 60_000;
  return (results || []).map((d) => {
    let state;
    if (d.status === 'checkout') state = d.order_status === 'paid' ? 'paid' : d.order_status === 'pending' ? 'paying' : 'not_paid';
    else if (d.status === 'incomplete' || Date.parse(d.last_active_at) <= cutoff) state = 'incomplete';
    else state = 'in_progress';
    return { ...d, state };
  });
}

export async function deleteOne(env, id) {
  const row = await env.DB.prepare('DELETE FROM reading_drafts WHERE id = ?1 RETURNING id').bind(id).first();
  return !!row;
}
