// Donations to New Way's Mediumship Development Centre (the Support New Way's page).
// The donor types their own amount (there are no preset or suggested amounts) and pays on Square's secure page. Only a
// payment Square itself confirms marks a donation as paid; the donor then gets a personal thank-you email (once),
// and, if they chose to be recognised, appears on the Supporters list straight away. Gary or Julie can take any entry
// off the list in Admin without touching the payment record.
import { squareConfig, paidPaymentForOrder, deletePaymentLink } from '../payments/square.js';
import { sendEmail, emailConfigured } from '../lib/email.js';
import { build, context } from '../notify.js';
import { audit } from '../lib/data.js';

export const MIN_PENCE = 100;          // £1 (the smallest amount it is sensible to take by card)
export const MAX_PENCE = 500_000;      // £5,000 (a typing slip, such as 10000 for 100.00, is caught)
const nowIso = () => new Date().toISOString();
export const pounds = (p) => '£' + (Number(p || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: Number(p) % 100 ? 2 : 0, maximumFractionDigits: 2 });

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newDonationReference() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return 'ND-' + Array.from(a, (b) => REF_CHARS[b % REF_CHARS.length]).join('');
}

// "12", "12.5", "£12.50", "1,000" -> pence, or null
export function parseAmount(text) {
  const t = String(text ?? '').trim().replace(/^£\s*/, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

// The Supporters list: paid donations whose donors chose to be recognised, and not taken off the list
export async function supporters(env, limit = 200) {
  const { results } = await env.DB.prepare(`SELECT public_name, amount_pence, paid_at FROM donations
      WHERE status = 'paid' AND show_publicly = 1 AND public_hidden_at IS NULL AND public_name != '' ORDER BY paid_at DESC, id DESC LIMIT ?1`).bind(limit).all();
  return results || [];
}

// ---------- emails (each recorded, so it is only ever sent once) ----------
async function claim(env, id, kind, recipient) {
  const row = await env.DB.prepare(
    `INSERT INTO donation_email_log (donation_id, kind, recipient, status, created_at) VALUES (?1, ?2, ?3, 'sending', ?4)
     ON CONFLICT(donation_id, kind) DO UPDATE SET status = 'sending', recipient = excluded.recipient, created_at = excluded.created_at
     WHERE donation_email_log.status IN ('failed', 'not_configured')
     RETURNING id`).bind(id, kind, recipient, nowIso()).first();
  return !!row;
}

export async function sendThankYou(env, id) {
  const d = await env.DB.prepare('SELECT * FROM donations WHERE id = ?1').bind(id).first();
  if (!d || d.status !== 'paid' || !d.donor_email || d.personal_data_removed_at) return 'no address';
  if (!(await claim(env, d.id, 'thank_you', d.donor_email))) return 'already sent';
  const c = await context(env);
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'long' }).format(new Date(d.paid_at || Date.now()));
  const msg = build(c.centre, [
    `Dear ${d.donor_name || 'friend'},`,
    `Thank you so much for your donation of ${pounds(d.amount_pence)} to New Way’s Mediumship Development Centre. It means a great deal to all of us.`,
    'Your support helps us keep our doors open and keep welcoming everyone to our Wednesday evenings, development circles and events.',
    d.show_publicly ? `As you asked, your name (${d.public_name}) and your donation are shown on the Supporters list on our website: ${d.origin}/support`
      : 'As you asked, your donation is anonymous: your name is not shown anywhere on our website.',
    'With warmest thanks from everyone at New Way’s.'
  ], [['Donation', pounds(d.amount_pence)], ['Date', when], ['Reference', d.reference]],
  { after: [c.contact ? `If you have any questions about your donation, please ${c.contact}.` : ''].filter(Boolean) });
  const out = await sendEmail(env, { to: d.donor_email, replyTo: c.replyTo, subject: 'Thank you for your donation to New Way’s', ...msg });
  await env.DB.prepare('UPDATE donation_email_log SET status = ?1, provider_id = ?2 WHERE donation_id = ?3 AND kind = ?4').bind(out.status, out.id || out.error || '', d.id, 'thank_you').run();
  return out.status;
}

// ---------- payment (only a payment Square itself confirms) ----------
async function flag(env, d, pid, note) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE donations SET status = 'needs_attention', paid_at = ?1, square_payment_id = ?2, note = ?3 WHERE id = ?4 AND status IN ('pending', 'expired', 'cancelled')`).bind(nowIso(), pid || null, note, d.id),
    audit(env, 'donations.attention', `Donation ${d.reference} needs attention: ${note}`)
  ]);
  return 'needs attention';
}

export async function donationPaid(env, d, payment) {
  if (!d) return 'unknown donation';
  if (d.status === 'paid' || (d.status === 'needs_attention' && d.square_payment_id)) return 'already done';
  if (payment?.status !== 'COMPLETED') return 'not completed';
  const cfg = squareConfig(env);
  const amount = Number(payment?.amount_money?.amount);
  const pid = String(payment.id || '');
  if (amount !== Number(d.amount_pence) || payment.amount_money.currency !== 'GBP') return flag(env, d, pid, `Square shows ${pounds(amount)} paid, but the donation was ${pounds(d.amount_pence)}.`);
  if (cfg && payment.location_id && payment.location_id !== cfg.locationId) return flag(env, d, pid, 'The payment was made to a different Square location.');
  const r = await env.DB.prepare(`UPDATE donations SET status = 'paid', paid_at = ?1, square_payment_id = ?2 WHERE id = ?3 AND status IN ('pending', 'expired', 'cancelled')`)
    .bind(nowIso(), pid, d.id).run();
  if (!r.meta.changes) return 'already done';
  try { await sendThankYou(env, d.id); } catch (err) { console.error("New Way's: donation thank-you not sent (will be retried):", err && err.message); }
  return 'confirmed';
}

export async function donationPaymentArrived(env, payment) {
  if (!payment || !payment.order_id) return 'no order';
  const d = await env.DB.prepare('SELECT * FROM donations WHERE square_order_id = ?1').bind(payment.order_id).first();
  if (!d) return 'unknown order';
  return donationPaid(env, d, payment);
}

export async function checkDonationWithSquare(env, d) {
  const cfg = squareConfig(env);
  if (!cfg || !d.square_order_id || d.status === 'paid') return null;
  const payment = await paidPaymentForOrder(cfg, d.square_order_id);
  return payment ? donationPaid(env, d, payment) : 'unpaid';
}

// ---------- hourly: unpaid donations, and thank-yous that couldn't be sent ----------
export async function donationHourlyJobs(env) {
  const cut = new Date(Date.now() - 2 * 3600_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT * FROM donations WHERE status = 'pending' AND created_at < ?1 ORDER BY created_at LIMIT 10`).bind(cut).all();
  const cfg = squareConfig(env);
  for (const d of results || []) {
    try {
      if (cfg && d.square_order_id) {
        const outcome = await checkDonationWithSquare(env, d);
        if (outcome && outcome !== 'unpaid') continue;
        await deletePaymentLink(cfg, d.square_payment_link_id);
      }
    } catch (err) {
      if (!(err && err.status === 404) && Date.parse(d.created_at) > Date.now() - 3 * 86400_000) continue;
    }
    await env.DB.prepare(`UPDATE donations SET status = 'expired' WHERE id = ?1 AND status = 'pending'`).bind(d.id).run();
  }
  if (!emailConfigured(env)) return;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { results: due } = await env.DB.prepare(`SELECT d.id FROM donations d WHERE d.status = 'paid' AND d.paid_at > ?1 AND d.donor_email != '' AND (
      NOT EXISTS (SELECT 1 FROM donation_email_log l WHERE l.donation_id = d.id AND l.kind = 'thank_you')
      OR EXISTS (SELECT 1 FROM donation_email_log l WHERE l.donation_id = d.id AND l.kind = 'thank_you' AND l.status IN ('failed', 'not_configured')))
    ORDER BY d.paid_at DESC LIMIT 20`).bind(since).all();
  for (const r of due || []) {
    try { await sendThankYou(env, r.id); } catch (err) { console.error("New Way's: donation thank-you retry failed:", err && err.message); }
  }
}

// Daily: the donor's name and email are removed once the retention period has passed. The payment record is kept,
// and so is the name they chose to show publicly (it is already public, by their choice).
export async function removeOldDonorDetails(env, now = Date.now()) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'customer_retention_months'").first();
  const months = /^\d{1,3}$/.test(String(row?.value ?? '')) && Number(row.value) >= 6 ? Number(row.value) : 24;
  const cut = new Date(now);
  cut.setUTCMonth(cut.getUTCMonth() - months);
  await env.DB.batch([
    env.DB.prepare(`UPDATE donation_email_log SET recipient = '' WHERE donation_id IN (SELECT id FROM donations WHERE personal_data_removed_at IS NULL AND created_at < ?1 AND status != 'needs_attention')`).bind(cut.toISOString()),
    env.DB.prepare(`UPDATE donations SET donor_email = '', donor_name = '', personal_data_removed_at = ?2 WHERE personal_data_removed_at IS NULL AND created_at < ?1 AND status != 'needs_attention'`).bind(cut.toISOString(), new Date(now).toISOString())
  ]);
}
