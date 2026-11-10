// Gift vouchers bought on the public website (Gift Vouchers page). The purchase is recorded first ('pending'); the
// voucher itself is made ONLY when Square confirms the payment, and only once, however many times the payment is
// reported (Square's webhook and its retries, the purchaser's return page, the hourly check):
//   * the purchase moves from pending to paid in the same all-or-nothing database step that makes the voucher, and
//     the database allows only one voucher per purchase;
//   * each email is recorded before it is sent, so it is never sent twice (a failed one is tried again later, and the
//     voucher and payment are never lost because an email failed).
// A bought voucher covers the reading; a home visit with it has the normal travel charge (vouchers.js TRAVEL_COVER).
import { randomToken } from '../lib/http.js';
import { ukToday, longDate } from '../lib/dates.js';
import { squareConfig, paidPaymentForOrder, deletePaymentLink } from '../payments/square.js';
import { getBookingSettings, numberSetting } from './config.js';
import { emailConfigured, sendEmail } from '../lib/email.js';
import { build, context, money, deliverAdmin } from '../notify.js';
import { audit } from '../lib/data.js';
import * as vouchers from './vouchers.js';

const nowIso = () => new Date().toISOString();
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PURCHASE_REF_RE = /^NWV-[A-Z0-9]{6}$/;
export const VALID_MONTHS_DEFAULT = 12;
export const MESSAGE_MAX = 300;

export function newPurchaseReference() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return 'NWV-' + [...a].map((b) => REF_CHARS[b % REF_CHARS.length]).join('');
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The readings a voucher can be bought for: the active 30 and 60 minute readings (the two approved designs)
export async function voucherServices(env) {
  const { results } = await env.DB.prepare('SELECT * FROM reading_services WHERE active = 1 ORDER BY sort_order, id').all();
  return (results || []).filter((s) => [30, 60].includes(Number(s.minutes)) && s.price_pence > 0);
}

// How long a bought voucher can be used for (Admin > Booking settings), and its last day
export const validMonths = (settings) => numberSetting(settings, 'gift_voucher_valid_months') || VALID_MONTHS_DEFAULT;
export function expiryFor(months, today = ukToday()) {
  const [y, m, d] = today.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export const deliveryText = (p) => (p.delivery === 'recipient' ? `Emailed straight to the recipient${p.recipient_name ? `, ${p.recipient_name}` : ''}${p.recipient_email ? ` (${p.recipient_email})` : ''}` : 'Emailed to the purchaser, to print or pass on');

// The purchaser's own page: the private key in its link is only stored as a hash
export async function purchaseForCustomer(env, reference, key) {
  if (!PURCHASE_REF_RE.test(String(reference || '')) || !key || String(key).length > 100) return null;
  const p = await env.DB.prepare('SELECT * FROM voucher_purchases WHERE reference = ?1').bind(reference).first();
  if (!p) return null;
  return (await sha256Hex('voucher-purchase:' + key)) === p.access_hash ? p : null;
}
export async function newPurchaseKeys() {
  const key = randomToken(24);
  return { key, hash: await sha256Hex('voucher-purchase:' + key), printKey: randomToken(24) };
}
export const printLink = (p) => `${p.origin}/gift-vouchers/print/${p.print_key}`;

// The voucher, with who it is for and the gift message (shown under the picture on the printable voucher)
export function withPersonal(v, p) {
  if (!p || p.personal_data_removed_at) return v;
  return { ...v, personal: { to: p.recipient_name || '', from: p.recipient_name ? p.purchaser_name : '', message: p.message || '' } };
}

// ---------- payment confirmed: make the voucher (once) ----------

async function makeVoucher(env, p, paidAt, pid) {
  const settings = await getBookingSettings(env);
  const months = validMonths(settings);
  const expires = expiryFor(months);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = vouchers.newCode();
    try {
      const r = await env.DB.batch([
        env.DB.prepare(`UPDATE voucher_purchases SET status = 'paid', paid_at = COALESCE(paid_at, ?1), square_payment_id = COALESCE(square_payment_id, ?2) WHERE id = ?3 AND status IN ('pending', 'expired', 'paid') AND voucher_id IS NULL`).bind(paidAt, pid || null, p.id),
        env.DB.prepare(`INSERT INTO gift_vouchers (code, service_code, minutes, value_pence, expires_on, note, created_by, travel_cover, source, purchase_id)
          SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'Bought online', 'mileage_payable', 'purchase', ?7
          WHERE EXISTS (SELECT 1 FROM voucher_purchases WHERE id = ?7 AND status = 'paid' AND voucher_id IS NULL)`)
          .bind(code, p.service_code, p.minutes, p.amount_pence, expires, `Bought online (${p.reference})`, p.id),
        env.DB.prepare(`UPDATE voucher_purchases SET voucher_id = (SELECT id FROM gift_vouchers WHERE purchase_id = ?1) WHERE id = ?1 AND voucher_id IS NULL`).bind(p.id),
        env.DB.prepare(`INSERT INTO gift_voucher_log (voucher_id, what, done_by) SELECT id, ?2, 'Website' FROM gift_vouchers WHERE purchase_id = ?1 AND code = ?3`)
          .bind(p.id, `Bought online (${p.reference}) by ${p.purchaser_name}: ${p.minutes} minute reading, ${money(p.amount_pence)} paid by Square${pid ? ` (payment ${pid})` : ''}. Valid until ${expires.split('-').reverse().join('/')}. Covers WhatsApp or Home Visit (mileage payable). ${deliveryText(p)}.`, code),
        audit(env, 'vouchers.bought', `Gift voucher bought online: ${p.reference}, ${p.minutes} minute reading, ${money(p.amount_pence)}`)
      ]);
      return r[1].meta.changes > 0;
    } catch (err) {
      if (/gift_vouchers\.purchase_id|gift_vouchers_purchase/i.test(String(err && err.message))) return false;   // made a moment ago by another check
      if (!/UNIQUE/i.test(String(err && err.message)) || attempt === 4) throw err;   // a code already in use: try another
    }
  }
  return false;
}

// `payment` is a Square payment object (a verified webhook, or read from Square's API)
export async function markVoucherPaid(env, purchase, payment) {
  if (!purchase) return 'unknown purchase';
  const p = await env.DB.prepare('SELECT * FROM voucher_purchases WHERE id = ?1').bind(purchase.id).first();
  if (!p) return 'unknown purchase';
  if (p.voucher_id) { await followUp(() => sendPurchaseEmails(env, p.id)); return 'already done'; }
  if (p.status === 'needs_attention') return 'already done';
  if (payment?.status !== 'COMPLETED') return 'not completed';
  const cfg = squareConfig(env);
  const amount = Number(payment?.amount_money?.amount);
  const problems = [];
  if (amount !== Number(p.amount_pence) || payment.amount_money.currency !== 'GBP') problems.push(`Square shows £${(amount / 100).toFixed(2)} paid, but the voucher price was ${money(p.amount_pence)}.`);
  if (cfg && payment.location_id && payment.location_id !== cfg.locationId) problems.push('The payment was made to a different Square location.');
  const paidAt = nowIso();
  const pid = String(payment.id || '');
  if (problems.length) {
    const r = await env.DB.prepare(`UPDATE voucher_purchases SET status = 'needs_attention', paid_at = ?1, square_payment_id = ?2, note = ?3 WHERE id = ?4 AND status IN ('pending', 'expired')`)
      .bind(paidAt, pid || null, problems.join(' ') + ' No voucher has been made yet.', p.id).run();
    if (r.meta.changes) await followUp(() => purchaseNeedsAttention(env, p.id));
    return 'needs attention';
  }
  const made = await makeVoucher(env, p, paidAt, pid);
  await followUp(() => sendPurchaseEmails(env, p.id));
  return made ? 'voucher made' : 'already done';
}

async function followUp(step) {
  try { await step(); } catch (err) { console.error("New Way's: gift voucher follow-up failed (will be retried):", err && err.message ? err.message : err); }
}

// Square's webhook (already signature-checked): a payment for a gift voucher purchase? (null if not one of ours)
export async function voucherPaymentArrived(env, payment) {
  if (!payment || !payment.order_id) return null;
  const p = await env.DB.prepare('SELECT * FROM voucher_purchases WHERE square_order_id = ?1').bind(payment.order_id).first();
  return p ? markVoucherPaid(env, p, payment) : null;
}

// Asks Square directly (the purchaser's return page, and before an unpaid purchase is closed)
export async function checkPurchaseWithSquare(env, p) {
  const cfg = squareConfig(env);
  if (!cfg || !p.square_order_id || p.voucher_id) return null;
  const payment = await paidPaymentForOrder(cfg, p.square_order_id);
  return payment ? markVoucherPaid(env, p, payment) : 'unpaid';
}

// ---------- emails ----------

async function claim(env, purchaseId, kind, recipient) {
  const row = await env.DB.prepare(
    `INSERT INTO voucher_purchase_emails (purchase_id, kind, recipient, status, created_at) VALUES (?1, ?2, ?3, 'sending', ?4)
     ON CONFLICT(purchase_id, kind) DO UPDATE SET status = 'sending', recipient = excluded.recipient, created_at = excluded.created_at
     WHERE voucher_purchase_emails.status IN ('failed', 'not_configured')
     RETURNING id`).bind(purchaseId, kind, recipient, nowIso()).first();
  return !!row;
}
async function deliver(env, purchaseId, kind, msg) {
  if (!msg.to) return 'no address';
  if (!(await claim(env, purchaseId, kind, msg.to))) return 'already sent';
  const out = await sendEmail(env, msg);
  await env.DB.prepare('UPDATE voucher_purchase_emails SET status = ?1, provider_id = ?2 WHERE purchase_id = ?3 AND kind = ?4')
    .bind(out.status, out.id || out.error || '', purchaseId, kind).run();
  return out.status;
}

const TRAVEL_TERMS = [
  'WhatsApp Video Call: your gift voucher covers the full cost of the private reading. There are no additional travel charges.',
  'Home Visit (In Person): gift vouchers cover the reading itself. If the recipient chooses a Home Visit, an additional travel charge of 60p per mile applies to the complete return journey. Home Visits are available only within 20 driving miles one way of Gary’s home location. The travel charge is worked out from the address and shown before any payment.',
  'The recipient can choose a WhatsApp Video Call instead, with no additional charges.'
];

function voucherRows(v, p) {
  return [['Voucher code', v.code], ['Reading', `${v.minutes} minute private reading with Medium Gary Findlay`],
    ['Valid until', `${longDate(v.expires_on, '0000')} (book by this date)`], ['Covers', vouchers.coverLine(v)],
    ...(p.recipient_name ? [['For', p.recipient_name], ['From', p.purchaser_name]] : [])];
}
const howToUse = (p, v) => `To use it: go to ${p.origin}/private-readings, choose the ${v.minutes} minute reading, a date and a time, and enter the code ${v.code} at the payment step.`;

function voucherEmail(c, p, v) {
  const toRecipient = p.delivery === 'recipient';
  return build(c.centre, [
    `Dear ${toRecipient ? (p.recipient_name || 'friend') : p.purchaser_name},`,
    toRecipient ? `${p.purchaser_name} has sent you a New Way’s gift voucher for a ${v.minutes} minute private reading with Medium Gary Findlay.`
      : `Thank you for buying a New Way’s gift voucher. Here it is: a ${v.minutes} minute private reading with Medium Gary Findlay, ready to print and give.`,
    ...(toRecipient && p.message ? [`Their message: “${p.message}”`] : []),
    `Your gift voucher, ready to print on A4 paper (PDF):\n${printLink(p)}`
  ], [...voucherRows(v, p), ...(toRecipient ? [] : [['Amount paid', money(p.amount_pence)], ['Payment', 'Received by Square'], ['Purchase reference', p.reference], ['Date of purchase', longDate(p.paid_at.slice(0, 10), '0000')]])], {
    after: [howToUse(p, v), ...TRAVEL_TERMS, c.contact ? `If you have any questions, please ${c.contact}.` : ''].filter(Boolean)
  });
}

function receiptEmail(c, p, v) {
  return build(c.centre, [
    `Dear ${p.purchaser_name},`,
    `Thank you for buying a New Way’s gift voucher. Your payment has been received and the voucher has been emailed to ${p.recipient_name || 'the recipient'} at ${p.recipient_email}.`,
    `In case you would like your own copy to print, here it is (PDF):\n${printLink(p)}`
  ], [['Purchase reference', p.reference], ['Date of purchase', longDate(p.paid_at.slice(0, 10), '0000')], ['Amount paid', money(p.amount_pence)], ['Payment', 'Received by Square'],
    ['Delivery', deliveryText(p)], ...voucherRows(v, p)], {
    after: [...TRAVEL_TERMS, c.contact ? `If you have any questions, please ${c.contact}.` : ''].filter(Boolean)
  });
}

function adminEmail(c, p, v) {
  return build(c.centre, [`A gift voucher has been sold on the website.`, `See it in Admin: ${p.origin}/admin/readings/vouchers/${v.id}`],
    [['Purchaser', p.purchaser_name], ['Purchaser email', p.purchaser_email], ['Voucher', `${v.minutes} minute private reading`], ['Voucher code', v.code],
      ['Purchase reference', p.reference], ['Amount paid', money(p.amount_pence)], ['Date of purchase', longDate(p.paid_at.slice(0, 10), '0000')],
      ['Delivery', deliveryText(p)], ['Payment', `Confirmed by Square${p.square_payment_id ? ` (payment ${p.square_payment_id})` : ''}`],
      ['Covers', vouchers.TRAVEL_COVER[vouchers.coverOf(v)].short], ['Valid until', longDate(v.expires_on, '0000')]]);
}

// Every email for a paid purchase that hasn't been sent yet (safe to call any number of times)
export async function sendPurchaseEmails(env, purchaseId) {
  const p = await env.DB.prepare('SELECT * FROM voucher_purchases WHERE id = ?1').bind(purchaseId).first();
  if (!p || p.status !== 'paid' || !p.voucher_id || p.personal_data_removed_at) return;
  const v = await env.DB.prepare('SELECT * FROM gift_vouchers WHERE id = ?1').bind(p.voucher_id).first();
  if (!v) return;
  const c = await context(env);
  const toRecipient = p.delivery === 'recipient';
  const subject = toRecipient ? `A gift for you from ${p.purchaser_name}: a private reading with New Way’s` : `Your New Way’s gift voucher: ${v.minutes} minute private reading`;
  await deliver(env, p.id, 'voucher', { to: toRecipient ? p.recipient_email : p.purchaser_email, replyTo: c.replyTo, subject, ...voucherEmail(c, p, v) });
  if (toRecipient) await deliver(env, p.id, 'receipt', { to: p.purchaser_email, replyTo: c.replyTo, subject: `Your gift voucher purchase: ${p.reference}`, ...receiptEmail(c, p, v) });
  await deliverAdmin(env, c, p.id, 'admin_purchase', { subject: `Gift voucher sold: ${v.minutes} minute reading, ${money(p.amount_pence)} (${p.reference})`, ...adminEmail(c, p, v) }, { deliverFn: deliver });
}

// Admin: send the voucher email again (to the same address). Each resend is its own record.
export async function resendVoucherEmail(env, p) {
  const v = p.voucher_id ? await env.DB.prepare('SELECT * FROM gift_vouchers WHERE id = ?1').bind(p.voucher_id).first() : null;
  if (!v || p.personal_data_removed_at) return 'not possible';
  const c = await context(env);
  const n = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM voucher_purchase_emails WHERE purchase_id = ?1 AND kind LIKE 'voucher_resend_%'`).bind(p.id).first()).n + 1;
  const toRecipient = p.delivery === 'recipient';
  return deliver(env, p.id, 'voucher_resend_' + n, { to: toRecipient ? p.recipient_email : p.purchaser_email, replyTo: c.replyTo,
    subject: toRecipient ? `A gift for you from ${p.purchaser_name}: a private reading with New Way’s` : `Your New Way’s gift voucher: ${v.minutes} minute private reading`, ...voucherEmail(c, p, v) });
}

async function purchaseNeedsAttention(env, purchaseId) {
  const p = await env.DB.prepare('SELECT * FROM voucher_purchases WHERE id = ?1').bind(purchaseId).first();
  if (!p) return;
  const c = await context(env);
  const msg = build(c.centre, [`A gift voucher payment needs your attention (${p.reference}).`, p.note, `See it in Admin: ${p.origin}/admin/readings/vouchers`],
    [['Voucher', `${p.minutes} minute private reading`], ['Price', money(p.amount_pence)], ['Purchaser', p.purchaser_name], ['Email', p.purchaser_email], ['Square payment', p.square_payment_id || '']]);
  await deliverAdmin(env, c, p.id, 'admin_attention', { subject: `Needs attention: gift voucher payment ${p.reference}`, ...msg }, { deliverFn: deliver });
}

// ---------- every hour ----------
export async function voucherSalesHourlyJobs(env) {
  // 1. a payment recorded but no voucher made (for example the website stopped half way): make it now
  const { results: unfinished } = await env.DB.prepare(`SELECT * FROM voucher_purchases WHERE status = 'paid' AND voucher_id IS NULL LIMIT 5`).all();
  for (const p of unfinished || []) await followUp(async () => { await makeVoucher(env, p, p.paid_at || nowIso(), p.square_payment_id); await sendPurchaseEmails(env, p.id); });
  // 2. purchases not paid after a day: ask Square first (a late payment is never lost), then close the payment page
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { results: open } = await env.DB.prepare(`SELECT * FROM voucher_purchases WHERE status = 'pending' AND created_at < ?1 ORDER BY created_at LIMIT 5`).bind(cutoff).all();
  const cfg = squareConfig(env);
  for (const p of open || []) {
    try {
      if (cfg && p.square_order_id) {
        const outcome = await checkPurchaseWithSquare(env, p);
        if (outcome && outcome !== 'unpaid') continue;
        await deletePaymentLink(cfg, p.square_payment_link_id);
      }
    } catch (err) {
      if (!(err && err.status === 404) && Date.parse(p.created_at) > Date.now() - 3 * 86400_000) continue;
    }
    await env.DB.prepare(`UPDATE voucher_purchases SET status = 'expired' WHERE id = ?1 AND status = 'pending'`).bind(p.id).run();
  }
  // 3. emails that failed (or were never sent), over the week after the payment
  if (emailConfigured(env)) {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { results: retry } = await env.DB.prepare(`SELECT p.id FROM voucher_purchases p WHERE p.status = 'paid' AND p.voucher_id IS NOT NULL AND p.paid_at > ?1 AND p.personal_data_removed_at IS NULL
      AND (NOT EXISTS (SELECT 1 FROM voucher_purchase_emails e WHERE e.purchase_id = p.id AND e.kind = 'voucher')
        OR EXISTS (SELECT 1 FROM voucher_purchase_emails e WHERE e.purchase_id = p.id AND e.status IN ('failed', 'not_configured') AND e.kind NOT LIKE 'voucher_resend_%'))
      ORDER BY p.paid_at DESC LIMIT 10`).bind(since).all();
    for (const r of retry || []) await followUp(() => sendPurchaseEmails(env, r.id));
    const { results: attention } = await env.DB.prepare(`SELECT p.id FROM voucher_purchases p WHERE p.status = 'needs_attention' AND p.paid_at > ?1
      AND NOT EXISTS (SELECT 1 FROM voucher_purchase_emails e WHERE e.purchase_id = p.id AND e.kind = 'admin_attention' AND e.status IN ('sent', 'sending')) LIMIT 5`).bind(since).all();
    for (const r of attention || []) await followUp(() => purchaseNeedsAttention(env, r.id));
  }
  // 4. personal details (purchaser, recipient, message) removed after the record-keeping period, once the voucher has
  //    been used, cancelled or has expired (or the purchase was never paid). The payment record itself is kept.
  const months = numberSetting(await getBookingSettings(env), 'customer_retention_months');
  const old = new Date(Date.now() - months * 30.44 * 86400_000).toISOString();
  await env.DB.prepare(`UPDATE voucher_purchases SET purchaser_name = '', purchaser_email = '', recipient_name = '', recipient_email = '', message = '', personal_data_removed_at = ?1
    WHERE personal_data_removed_at IS NULL AND created_at < ?2 AND (status = 'expired' OR NOT EXISTS (SELECT 1 FROM gift_vouchers v WHERE v.id = voucher_purchases.voucher_id
      AND v.status IN ('available', 'reserved') AND (v.expires_on IS NULL OR v.expires_on >= ?3)))`).bind(nowIso(), old, ukToday()).run();
}
