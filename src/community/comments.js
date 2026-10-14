// New Way's Community: checking comments against the database, visitor codes, repeat offenders, reports and
// Admin's moderation actions. Public comments are switched on in Stage 5; everything here is built and tested now.
import { moderate, prepareLists, fingerprint } from './moderation.js';

// ---------- the visitor code (no accounts, no cookies needed) ----------
// A scrambled code made from the visitor's network (the first part of their IP address only) and their browser type,
// plus, from Stage 5, a random code their own browser keeps. The IP address itself is never stored. It is good enough
// to spot one person repeating themselves, but it is NOT proof of identity: people on the same mobile network or
// household Wi-Fi can share a code, and one person with two phones, or who clears their browser, gets two codes.
export async function visitorKey(env, request, browserCode = '') {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const network = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip.split('.').slice(0, 3).join('.');
  const ua = String(request.headers.get('User-Agent') || '').replace(/[\d.]+/g, '').slice(0, 160);
  const code = /^[A-Za-z0-9_-]{16,64}$/.test(browserCode) ? browserCode : '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.SESSION_SECRET || 'nw-community')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`community|${network}|${ua}|${code}`));
  return 'v' + [...new Uint8Array(sig)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- the word lists ----------
export async function wordRows(env) {
  const { results } = await env.DB.prepare('SELECT id, phrase, action, category, anywhere, source FROM community_words').all();
  return results || [];
}

async function mediumNames(env) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT name FROM mediums WHERE TRIM(name) != '' AND date >= date('now', '-400 days')`).all();
  return (results || []).map((r) => r.name);
}

// ---------- the one check used for real comments and for Admin's Test a Comment ----------
// live = false (Test a Comment): reads only. Nothing is stored, no visitor record or rate limit is touched,
// nothing is published and no notification is sent.
export async function screenComment(env, { name, text, postId = null, visitor = '' }, { live = false } = {}) {
  const [rows, mediums] = await Promise.all([wordRows(env), mediumNames(env)]);
  const print = await fingerprint(text);
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [mine, others, visitorRow] = await Promise.all([
    visitor ? env.DB.prepare(`SELECT COUNT(*) AS n FROM community_comments WHERE fingerprint = ?1 AND visitor_key = ?2 AND created_at >= ?3`).bind(print, visitor, since).first('n') : 0,
    env.DB.prepare(`SELECT COUNT(*) AS n FROM community_comments WHERE fingerprint = ?1 AND visitor_key != ?2 AND created_at >= ?3 AND status != 'rejected'`).bind(print, visitor || '-', since).first('n'),
    visitor ? env.DB.prepare('SELECT * FROM community_visitors WHERE visitor_key = ?1').bind(visitor).first() : null
  ]);
  const result = moderate({ name, text }, { lists: prepareLists(rows), mediumNames: mediums, sameFromVisitor: (mine || 0) > 0, sameFromOthers: others || 0, visitor: visitorRow });
  result.fingerprint = print;
  if (live && visitor) await recordOutcome(env, visitor, result.verdict, name);
  return result;
}

// Repeat offenders: three blocked attempts within a day means that visitor's comments are held for review for 7 days.
// Nobody is ever banned for one blocked comment: they can always change it and try again.
export const STRIKES_TO_HOLD = 3;
export const HOLD_DAYS = 7;
export async function recordOutcome(env, visitor, verdict, name = '') {
  if (verdict === 'allow') {
    await env.DB.prepare(`UPDATE community_visitors SET last_name = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE visitor_key = ?1`).bind(visitor, String(name || '').slice(0, 40)).run();
    return;
  }
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const holdUntil = new Date(now.getTime() + HOLD_DAYS * 86400_000).toISOString();
  await env.DB.prepare(`INSERT INTO community_visitors (visitor_key, strikes, blocked_total, held_total, last_strike_at, last_name)
      VALUES (?1, ?2, ?2, ?3, CASE WHEN ?2 = 1 THEN ?4 ELSE NULL END, ?6)
    ON CONFLICT(visitor_key) DO UPDATE SET
      strikes = CASE WHEN ?2 = 0 THEN strikes WHEN last_strike_at IS NULL OR last_strike_at < ?5 THEN 1 ELSE strikes + 1 END,
      blocked_total = blocked_total + ?2, held_total = held_total + ?3,
      last_strike_at = CASE WHEN ?2 = 1 THEN ?4 ELSE last_strike_at END, last_name = ?6, updated_at = ?4`)
    .bind(visitor, verdict === 'block' ? 1 : 0, verdict === 'hold' ? 1 : 0, now.toISOString(), dayAgo, String(name || '').slice(0, 40)).run();
  await env.DB.prepare(`UPDATE community_visitors SET hold_until = ?2 WHERE visitor_key = ?1 AND strikes >= ?3 AND (hold_until IS NULL OR hold_until < ?2)`)
    .bind(visitor, holdUntil, STRIKES_TO_HOLD).run();
}

// ---------- reports (the Report button arrives in Stage 5) ----------
// Three reports from three different visitor codes hide an ordinary published comment until Gary or Julie look at it.
// Reports never hide a verified Admin comment or a comment Gary or Julie have already approved or restored (they still
// appear in Admin). A visitor can only report a comment once, and reports from visitors whose reports Admin has chosen
// to ignore do not count.
export const REPORTS_TO_HIDE = 3;
export async function reportComment(env, commentId, reporter) {
  const comment = await env.DB.prepare('SELECT * FROM community_comments WHERE id = ?1').bind(commentId).first();
  if (!comment || comment.status !== 'published') return { ok: false, reason: 'not-found' };
  if (comment.visitor_key && comment.visitor_key === reporter) return { ok: false, reason: 'own-comment' };
  const ignored = await env.DB.prepare('SELECT reports_ignored FROM community_visitors WHERE visitor_key = ?1').bind(reporter).first('reports_ignored');
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO community_reports (comment_id, reporter_key, counted) VALUES (?1, ?2, ?3)`)
    .bind(commentId, reporter, ignored ? 0 : 1).run();
  if (!inserted.meta || !inserted.meta.changes) return { ok: true, duplicate: true, hidden: false };
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM community_reports WHERE comment_id = ?1 AND counted = 1').bind(commentId).first('n');
  const protectedComment = !!comment.official || !!comment.approved_by;
  await env.DB.prepare(`UPDATE community_comments SET report_count = ?2 WHERE id = ?1`).bind(commentId, count).run();
  if (count >= REPORTS_TO_HIDE && !protectedComment) {
    await env.DB.prepare(`UPDATE community_comments SET status = 'hidden', reasons = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND status = 'published'`)
      .bind(commentId, JSON.stringify([{ code: 'reports', action: 'hold', detail: `reported by ${count} different visitors` }])).run();
    return { ok: true, hidden: true, count };
  }
  return { ok: true, hidden: false, count, protected: protectedComment };
}

// ---------- Admin's moderation actions ----------
const stamp = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export async function moderateComment(env, id, action, who) {
  const c = await env.DB.prepare('SELECT * FROM community_comments WHERE id = ?1').bind(id).first();
  if (!c) return { ok: false, reason: 'not-found' };
  const allowed = {
    approve: ['held', 'hidden', 'rejected'],   // approve (or restore) a comment: published, and reports can no longer hide it
    reject: ['held'],                           // turn down a held comment (never shown)
    hide: ['published'],                        // take a published comment off the page
    delete: ['published', 'held', 'hidden', 'rejected']
  };
  if (!allowed[action] || !allowed[action].includes(c.status)) return { ok: false, reason: 'not-allowed', status: c.status };
  if (action === 'delete') {
    // Removing a comment also removes its replies and reports
    await env.DB.batch([
      env.DB.prepare('DELETE FROM community_reports WHERE comment_id IN (SELECT id FROM community_comments WHERE id = ?1 OR parent_id = ?1)').bind(id),
      env.DB.prepare('DELETE FROM community_comments WHERE id = ?1 OR parent_id = ?1').bind(id)
    ]);
    return { ok: true, comment: c };
  }
  const status = { approve: 'published', reject: 'rejected', hide: 'hidden' }[action];
  const reasons = action === 'hide' ? JSON.stringify([{ code: 'admin', action: 'hold', detail: 'hidden by ' + who }]) : c.reasons;
  await env.DB.prepare(`UPDATE community_comments SET status = ?2, reasons = ?4, moderated_by = ?3, moderated_at = ${stamp}, updated_at = ${stamp}
      ${action === 'approve' ? `, approved_by = ?3, approved_at = ${stamp}` : ''} WHERE id = ?1`).bind(id, status, who, reasons).run();
  return { ok: true, comment: c };
}

export async function moderationCounts(env) {
  try {
    const { results } = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM community_comments GROUP BY status`).all();
    const out = { held: 0, hidden: 0, published: 0, rejected: 0 };
    for (const r of results || []) out[r.status] = r.n;
    return out;
  } catch { return { held: 0, hidden: 0, published: 0, rejected: 0 }; }
}
