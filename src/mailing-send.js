// Emails to the mailing list (promotional): built, tested and sent from Admin › Mailing list › SEND EMAIL TO
// SUBSCRIBERS. Only subscribers with status 'subscribed' receive them, and each one carries its own unsubscribe link
// (and the one-click List-Unsubscribe header). Booking emails (confirmations, reminders, QR codes) are separate.
//
// Safe sending:
//  * Each subscriber gets one row per email (UNIQUE), so nobody is ever sent the same email twice. A row is claimed
//    ('sending') before it is sent; a row left 'sending' by an interruption is marked 'unknown' and NOT sent again.
//  * Before each send, the subscriber is checked again: anyone who unsubscribed meanwhile is skipped.
//  * Sent with Resend's batch sending (up to 50 an API call, with an idempotency key), within a daily limit that leaves
//    room for booking emails on Resend's free plan (100 a day). Anything over the limit carries on by itself the next
//    day (the hourly job), or with "Send the next batch now".
//  * Temporary failures are tried again (up to 3 times); permanent ones are recorded as failed with Resend's reason.
import { normaliseEmail } from './lib/emails.js';
import { unsubscribeUrl, promotionalHeaders } from './mailing.js';

export const DAILY_LIMIT_DEFAULT = 80;      // Resend's free plan: 100 emails a day in all; this leaves 20 for bookings
export const BATCH = 50;                    // emails per call to Resend
const CALLS_PER_RUN = 4;                    // calls per run (Cloudflare's free plan allows 50 outside requests)
const STALE_MINUTES = 15;
const nowIso = () => new Date().toISOString();
const isLocal = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(u || ''));
const apiBase = (env) => (isLocal(env.RESEND_API_BASE) ? String(env.RESEND_API_BASE).replace(/\/+$/, '') : 'https://api.resend.com');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function dailyLimit(env) {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'mail_daily_limit'`).first();
  const n = Number(row && row.value);
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : DAILY_LIMIT_DEFAULT;
}
// Mailing-list emails already sent today (Resend's day runs midnight to midnight UTC)
export async function sentToday(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM mail_campaign_recipients WHERE status IN ('sent', 'sending', 'unknown') AND COALESCE(sent_at, claimed_at) >= ?1`)
    .bind(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').first();
  return row.n;
}
export async function subscriberCount(env) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM mailing_list WHERE status = 'subscribed'`).first()).n;
}

// ---------- the email itself (navy and gold, like the booking emails) ----------
// `who` is the subscriber (for their unsubscribe link), or null for a test.
export function buildMessage({ campaign, centre, origin, who, contact = '', address = '' }) {
  const unsub = who ? unsubscribeUrl(origin, who) : `${origin}/join`;
  const paras = String(campaign.body || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const greeting = who && who.name ? `Dear ${who.name.split(/\s+/)[0]},` : '';
  const linkP = (p) => esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a style="color:#F8B709" href="$1">$1</a>');
  const button = campaign.link_url ? `<p class="mp-btn-wrap" style="margin:22px 0"><a class="mp-btn" href="${esc(campaign.link_url)}" style="display:inline-block;background:#F8B709;color:#000428;font-weight:bold;text-decoration:none;padding:14px 22px;border-radius:999px">${esc(campaign.link_label || 'Find out more')}</a></p>` : '';
  const footer = `You’re receiving this because you joined the ${centre} mailing list.`;
  const inner = `<p class="mp-centre" style="color:#F8B709;font-size:20px;font-family:Georgia,serif;margin:0 0 16px">${esc(centre)}</p>
${greeting ? `<p style="margin:0 0 14px">${esc(greeting)}</p>` : ''}
${paras.map((p) => `<p style="margin:0 0 14px">${linkP(p)}</p>`).join('')}
${button}
<hr class="mp-rule" style="border:0;border-top:1px solid #33416b;margin:26px 0 14px">
<p class="mp-small" style="margin:0 0 8px;font-size:13px;color:#9CC2FF">${esc(footer)}${contact ? ` To contact us, please ${esc(contact)}.` : ''}</p>
${address ? `<p class="mp-small" style="margin:0 0 8px;font-size:13px;color:#9CC2FF">${esc(address)}</p>` : ''}
<p class="mp-small" style="margin:0;font-size:13px"><a style="color:#F8B709" href="${esc(unsub)}">Unsubscribe from these emails</a>${who ? '' : ' (in the real email, each person’s own unsubscribe link goes here)'}</p>`;
  const html = `<!doctype html><html lang="en-GB"><body style="margin:0;padding:24px;background:#000428;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:560px;margin:0 auto">${inner}</div></body></html>`;
  const text = [centre, '', greeting, greeting ? '' : null, ...paras.flatMap((p) => [p, '']), campaign.link_url ? `${campaign.link_label || 'Find out more'}: ${campaign.link_url}` : null, campaign.link_url ? '' : null,
    '—', footer + (contact ? ` To contact us, please ${contact}.` : ''), address || null, `Unsubscribe: ${unsub}`].filter((x) => x !== null).join('\n');
  return { subject: campaign.subject, html, text, inner, headers: who ? promotionalHeaders(origin, who) : undefined };
}

async function resendBatch(env, emails, key) {
  const res = await fetch(apiBase(env) + '/emails/batch', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + String(env.RESEND_API_KEY).trim(), 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(emails)
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, data };
}

// Sends the next part of every email that is being sent (or of one). Returns a short summary.
export async function sendQueued(env, { campaignId = null, centre, origin, contact = '', address = '', replyTo } = {}) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { sent: 0, failed: 0, note: 'Email isn’t set up on this copy of the website, so nothing was sent.' };
  const now = nowIso();
  // an interruption: never send these again (they may already have gone), just record it
  await env.DB.prepare(`UPDATE mail_campaign_recipients SET status = 'unknown', error = 'Sending was interrupted. It may or may not have been delivered, so it was not sent again (to avoid sending it twice).'
    WHERE status = 'sending' AND claimed_at < ?1`).bind(new Date(Date.now() - STALE_MINUTES * 60_000).toISOString()).run();
  const camps = (await env.DB.prepare(`SELECT * FROM mail_campaigns WHERE status = 'sending' ${campaignId ? 'AND id = ?1' : ''} ORDER BY id`).bind(...(campaignId ? [campaignId] : [])).all()).results || [];
  let sent = 0, failed = 0, calls = 0, note = '';
  for (const c of camps) {
    // unsubscribed (or removed) since sending started: skipped, never sent
    await env.DB.prepare(`UPDATE mail_campaign_recipients SET status = 'skipped', error = 'Unsubscribed before it was sent.'
      WHERE campaign_id = ?1 AND status = 'queued' AND subscriber_id NOT IN (SELECT id FROM mailing_list WHERE status = 'subscribed')`).bind(c.id).run();
    while (calls < CALLS_PER_RUN) {
      const room = (await dailyLimit(env)) - (await sentToday(env));
      if (room <= 0) { note = 'Today’s sending limit has been reached. The rest are sent automatically after midnight.'; break; }
      const rows = (await env.DB.prepare(`SELECT r.id, r.attempts, m.id AS sid, m.email, m.name, m.unsubscribe_token, m.status AS mstatus FROM mail_campaign_recipients r JOIN mailing_list m ON m.id = r.subscriber_id
          WHERE r.campaign_id = ?1 AND r.status = 'queued' ORDER BY r.id LIMIT ?2`).bind(c.id, Math.min(BATCH, room)).all()).results || [];
      if (!rows.length) break;
      // claim them (only rows still queued: two runs at once can never both send the same row)
      const claimed = [];
      for (const r of rows) {
        const ok = await env.DB.prepare(`UPDATE mail_campaign_recipients SET status = 'sending', claimed_at = ?1, attempts = attempts + 1 WHERE id = ?2 AND status = 'queued'`).bind(nowIso(), r.id).run();
        if (ok.meta && ok.meta.changes === 1) claimed.push(r);
      }
      if (!claimed.length) break;
      const emails = claimed.map((r) => {
        const msg = buildMessage({ campaign: c, centre, origin, who: { name: r.name, unsubscribe_token: r.unsubscribe_token }, contact, address });
        return { from: String(env.EMAIL_FROM), to: [normaliseEmail(r.email)], subject: msg.subject, html: msg.html, text: msg.text, reply_to: replyTo || undefined, headers: msg.headers };
      });
      calls++;
      let out;
      try { out = await resendBatch(env, emails, `nw-mail-${c.id}-${claimed[0].id}-${claimed[claimed.length - 1].id}-${claimed.length}`); }
      catch (err) { out = { ok: false, status: 0, data: { message: String(err && err.message ? err.message : err) } }; }
      const ids = out.ok && out.data && Array.isArray(out.data.data) ? out.data.data : null;
      if (ids && ids.length === claimed.length) {
        const at = nowIso();
        await env.DB.batch(claimed.map((r, i) => env.DB.prepare(`UPDATE mail_campaign_recipients SET status = 'sent', provider_id = ?1, sent_at = ?2, error = '' WHERE id = ?3`).bind(String(ids[i].id || ''), at, r.id)));
        sent += claimed.length;
        continue;
      }
      const reason = `Resend answered ${out.status || 'nothing'}${out.data && out.data.message ? ': ' + String(out.data.message).slice(0, 160) : ''}`;
      const temporary = !out.status || out.status === 429 || out.status >= 500;
      await env.DB.batch(claimed.map((r) => (temporary && r.attempts + 1 < 3
        ? env.DB.prepare(`UPDATE mail_campaign_recipients SET status = 'queued', error = ?1 WHERE id = ?2`).bind(reason + ' (will try again)', r.id)
        : env.DB.prepare(`UPDATE mail_campaign_recipients SET status = 'failed', error = ?1 WHERE id = ?2`).bind(reason, r.id))));
      if (!temporary || claimed[0].attempts + 1 >= 3) failed += claimed.length;
      note = temporary ? 'Resend was busy or unreachable. The rest are tried again automatically.' : '';
      break;
    }
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM mail_campaign_recipients WHERE campaign_id = ?1 AND status IN ('queued', 'sending')`).bind(c.id).first();
    if (!left.n) await env.DB.prepare(`UPDATE mail_campaigns SET status = 'sent', finished_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'sending'`).bind(nowIso(), c.id).run();
  }
  return { sent, failed, note };
}

// Starts sending: fixes the list of subscribers, once. Returns how many it will go to (or null if already started).
export async function startSending(env, campaignId, by) {
  const now = nowIso();
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE mail_campaigns SET status = 'sending', started_at = ?1, updated_at = ?1, sent_by = ?2 WHERE id = ?3 AND status = 'draft'`).bind(now, by, campaignId),
    env.DB.prepare(`INSERT OR IGNORE INTO mail_campaign_recipients (campaign_id, subscriber_id)
      SELECT ?1, id FROM mailing_list WHERE status = 'subscribed' AND (SELECT status FROM mail_campaigns WHERE id = ?1) = 'sending' AND (SELECT started_at FROM mail_campaigns WHERE id = ?1) = ?2 ORDER BY id`).bind(campaignId, now),
    env.DB.prepare(`UPDATE mail_campaigns SET recipients = (SELECT COUNT(*) FROM mail_campaign_recipients WHERE campaign_id = ?1) WHERE id = ?1 AND started_at = ?2`).bind(campaignId, now)
  ]);
  if (!res[0].meta || res[0].meta.changes !== 1) return null;
  return (await env.DB.prepare('SELECT recipients FROM mail_campaigns WHERE id = ?1').bind(campaignId).first()).recipients;
}

// Asks Resend what happened to sent emails (delivered, bounced…). Up to `max` at a time.
export async function checkDelivery(env, campaignId, max = 40) {
  if (!env.RESEND_API_KEY) return 0;
  const rows = (await env.DB.prepare(`SELECT id, provider_id FROM mail_campaign_recipients WHERE campaign_id = ?1 AND status = 'sent' AND provider_id != ''
      AND delivery NOT IN ('delivered', 'bounced', 'complained') ORDER BY COALESCE(checked_at, '') LIMIT ?2`).bind(campaignId, max).all()).results || [];
  let n = 0;
  for (const r of rows) {
    try {
      const res = await fetch(apiBase(env) + '/emails/' + encodeURIComponent(r.provider_id), { headers: { Authorization: 'Bearer ' + String(env.RESEND_API_KEY).trim() } });
      if (!res.ok) continue;
      const d = await res.json();
      const ev = String(d.last_event || '').toLowerCase().replace(/[^a-z_]/g, '').slice(0, 30);
      await env.DB.prepare('UPDATE mail_campaign_recipients SET delivery = ?1, checked_at = ?2 WHERE id = ?3').bind(ev, nowIso(), r.id).run();
      n++;
    } catch { /* try again next time */ }
  }
  return n;
}
