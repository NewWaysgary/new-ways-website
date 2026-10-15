// Private reading gift vouchers / reservation codes. Gary and Julie make them in Admin; a customer enters the code
// at the normal payment step of the Private Readings booking, and the reading is booked without Square.
// Every rule of the normal booking still applies (calendar, open and closed dates, length, break, notice, the
// database's refusal of any overlapping appointment); the voucher only replaces the payment.
import { randomToken } from '../lib/http.js';
import { ukToday, longDate } from '../lib/dates.js';
import { PdfPage, renderPdf, textWidth } from '../lib/pdf.js';
import { LOGO_JPEG } from '../lib/voucher-logo.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L: easy to read and type
export const STATUS_LABEL = { available: 'Available', reserved: 'Reserved', redeemed: 'Redeemed', expired: 'Expired', cancelled: 'Cancelled' };
export const MAX_BATCH = 50;
export const READINGS_PATH = '/private-readings';

export function newCode() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  const c = [...a].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');   // 31 × 8 = 248, so % 31 is very nearly even
  return `GV-${c.slice(0, 4)}-${c.slice(4)}`;
}

// What a customer typed -> the stored form (GV-XXXX-XXXX), or '' if it can't be a code. Spaces, dashes, lower case
// and a missing GV are all accepted.
export function normaliseCode(input) {
  let s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('GV') && s.length === 10) s = s.slice(2);
  if (s.length !== 8 || [...s].some((ch) => !CODE_CHARS.includes(ch))) return '';
  return `GV-${s.slice(0, 4)}-${s.slice(4)}`;
}

// The status shown to Gary (expired and a lapsed short hold are worked out from the dates)
export function voucherStatus(v, now = Date.now(), today = ukToday()) {
  if (v.status === 'cancelled' || v.status === 'redeemed') return v.status;
  if (v.expires_on && v.expires_on < today) return 'expired';
  if (v.status === 'reserved' && v.reserved_until && Date.parse(v.reserved_until) > now) return 'reserved';
  return 'available';
}

export const logStep = (env, id, what, by = '') => env.DB.prepare('INSERT INTO gift_voucher_log (voucher_id, what, done_by) VALUES (?1, ?2, ?3)').bind(id, String(what).slice(0, 500), by);

// Checks a code for a chosen reading. Returns { voucher } or { problem } (a sentence for the customer).
export async function checkCode(env, raw, service) {
  const code = normaliseCode(raw);
  if (!code) return { problem: 'That doesn’t look like a New Way’s voucher code. Codes look like GV-ABCD-2345. Please check it and try again.' };
  const v = await env.DB.prepare('SELECT * FROM gift_vouchers WHERE code = ?1').bind(code).first();
  if (!v) return { problem: 'We couldn’t find that voucher code. Please check it and try again.' };
  const st = voucherStatus(v);
  if (st === 'cancelled') return { problem: 'This voucher code is no longer active. Please contact New Way’s.' };
  if (st === 'redeemed') return { problem: 'This voucher has already been used for a booking.' };
  if (st === 'expired') return { problem: `This voucher expired on ${longDate(v.expires_on, '0000')}.` };
  if (v.minutes !== service.minutes) return { problem: `This voucher is for a ${v.minutes} minute reading. Please choose the ${v.minutes} minute reading to use it.` };
  return { voucher: v };
}

// A short hold while the customer confirms (so nobody else can use the code at the same moment). Returns the hold's
// token, or null if someone else is using it right now. The hold simply lapses if they don't finish.
export async function holdVoucher(env, v, minutes) {
  const token = randomToken(16);
  const now = new Date().toISOString();
  const r = await env.DB.batch([
    env.DB.prepare(`UPDATE gift_vouchers SET status = 'reserved', reserved_until = ?1, reserved_token = ?2
      WHERE id = ?3 AND (expires_on IS NULL OR expires_on >= ?4) AND (status = 'available' OR (status = 'reserved' AND reserved_until < ?5))`)
      .bind(new Date(Date.now() + minutes * 60_000).toISOString(), token, v.id, ukToday(), now)
  ]);
  return r[0].meta.changes ? token : null;
}

export async function releaseHold(env, id, token) {
  if (!id || !token) return;
  await env.DB.prepare(`UPDATE gift_vouchers SET status = 'available', reserved_until = NULL, reserved_token = NULL WHERE id = ?1 AND status = 'reserved' AND reserved_token = ?2`).bind(id, token).run();
}

// Hourly: holds that lapsed (the customer didn't finish) make the voucher available again
export async function voucherHourlyJobs(env) {
  await env.DB.prepare(`UPDATE gift_vouchers SET status = 'available', reserved_until = NULL, reserved_token = NULL WHERE status = 'reserved' AND reserved_until < ?1`)
    .bind(new Date().toISOString()).run();
}

// The statement that redeems the voucher inside the booking's own all-or-nothing database step. It only changes the
// voucher if it is still usable by THIS customer (their hold, or nobody's), not expired, and for this length of
// reading; the order insert that follows depends on it, so a voucher can never cover two bookings.
export function redeemStatement(env, { voucherId, token, reference, minutes }) {
  const now = new Date().toISOString();
  return env.DB.prepare(`UPDATE gift_vouchers SET status = 'redeemed', redeemed_at = ?1, reserved_until = NULL, reserved_token = ?2
    WHERE id = ?3 AND minutes = ?4 AND (expires_on IS NULL OR expires_on >= ?5)
      AND (status = 'available' OR (status = 'reserved' AND (reserved_token = ?6 OR reserved_until < ?1)))`)
    .bind(now, 'order:' + reference, voucherId, minutes, ukToday(), token || '');
}

// ---------- the printable voucher (PDF) ----------
const NAVY = '#000428', NAVY2 = '#0A1450', GOLD = '#F8B709', GOLD_SOFT = '#E9C766', WHITE = '#FFFFFF', BLUE = '#9CC2FF';

export function voucherLines(v) {
  return {
    reading: `${v.minutes} MINUTE PRIVATE READING`,
    value: `Value £${(v.value_pence / 100).toFixed(v.value_pence % 100 ? 2 : 0)}`
  };
}

function voucherPage(v, siteOrigin) {
  const W = 842, H = 595;   // A4 landscape, in points
  const p = new PdfPage(W, H);
  const link = siteOrigin + READINGS_PATH;
  const { reading, value } = voucherLines(v);
  p.rect(0, 0, W, H, { fill: NAVY });
  p.rect(14, 14, W - 28, H - 28, { stroke: GOLD, lineWidth: 2.5 });
  p.rect(22, 22, W - 44, H - 44, { stroke: GOLD_SOFT, lineWidth: 0.8 });
  // left: the voucher itself
  const cx = 300;
  p.image(LOGO_JPEG, cx - 52, 40, 104, 104);
  p.text('NEW WAY’S MEDIUMSHIP DEVELOPMENT CENTRE', cx, 170, { font: 'times-bold', size: 15, color: GOLD, align: 'center', spacing: 0.6 });
  p.text('GIFT VOUCHER', cx, 222, { font: 'times-bold', size: 44, color: WHITE, align: 'center', spacing: 2 });
  p.line(cx - 150, 240, cx + 150, 240, { color: GOLD, lineWidth: 1 });
  p.text(reading, cx, 274, { font: 'helvetica-bold', size: 19, color: GOLD, align: 'center', spacing: 0.5 });
  p.text('WITH MEDIUM GARY FINDLAY', cx, 300, { font: 'helvetica-bold', size: 14, color: WHITE, align: 'center', spacing: 1 });
  p.text(value, cx, 342, { font: 'times-bold', size: 30, color: GOLD, align: 'center' });
  p.text('Private Reading by WhatsApp Video Call', cx, 370, { font: 'times-italic', size: 15, color: WHITE, align: 'center' });
  // the code
  const codeW = Math.max(250, textWidth(v.code, 'helvetica-bold', 26) + 60);
  p.rect(cx - codeW / 2, 392, codeW, 62, { fill: NAVY2, stroke: GOLD, lineWidth: 1.5 });
  p.text('YOUR VOUCHER CODE', cx, 410, { font: 'helvetica-bold', size: 9, color: BLUE, align: 'center', spacing: 1.5 });
  p.text(v.code, cx, 442, { font: 'helvetica-bold', size: 26, color: WHITE, align: 'center', spacing: 2 });
  p.text(v.expires_on ? `Valid until ${longDate(v.expires_on, '0000')} (book by this date)` : 'No expiry date', cx, 478, { font: 'helvetica', size: 11, color: WHITE, align: 'center' });
  const host = link.replace(/^https?:\/\//, '');
  p.text(host, cx, 512, { font: 'helvetica-bold', size: 11, color: GOLD, align: 'center' });
  const lw = textWidth(host, 'helvetica-bold', 11);
  p.link(link, cx - lw / 2, 500, lw, 16);
  p.text('One private reading per voucher.', cx, 548, { font: 'helvetica', size: 8.5, color: BLUE, align: 'center' });
  // right: how to book, with the QR code
  p.line(584, 50, 584, H - 50, { color: GOLD_SOFT, lineWidth: 0.6 });
  const rx = 712;
  p.text('HOW TO BOOK', rx, 72, { font: 'helvetica-bold', size: 13, color: GOLD, align: 'center', spacing: 1.5 });
  p.qr(link, rx - 68, 86, 136, { dark: NAVY, light: WHITE, border: 3 });
  p.link(link, rx - 68, 86, 136, 136);
  p.text('Scan to open the Private Readings page', rx, 240, { font: 'helvetica', size: 8.5, color: WHITE, align: 'center' });
  const steps = ['Visit our Private Readings page.', 'Choose your preferred available date and time.', 'Enter your details.', 'Enter your unique voucher code.', 'Confirm your booking. No payment required.'];
  let y = 278;
  steps.forEach((s, i) => {
    p.rect(604, y - 13, 18, 18, { fill: GOLD });
    p.text(String(i + 1), 613, y, { font: 'helvetica-bold', size: 11, color: NAVY, align: 'center' });
    // wrap to the column width
    const words = s.split(' ');
    let line = '';
    const lines = [];
    for (const w of words) { const t = line ? line + ' ' + w : w; if (textWidth(t, 'helvetica', 11) > 178 && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
    lines.forEach((l, k) => p.text(l, 632, y + k * 15, { font: 'helvetica', size: 11, color: WHITE }));
    y += 22 + (lines.length - 1) * 15 + 8;
  });
  p.text('Readings take place by WhatsApp', rx, 530, { font: 'helvetica', size: 9, color: BLUE, align: 'center' });
  p.text('video call, at UK times.', rx, 543, { font: 'helvetica', size: 9, color: BLUE, align: 'center' });
  return p;
}

// One voucher, or several (one per page), as a PDF file
export function voucherPdf(list, siteOrigin) {
  const all = Array.isArray(list) ? list : [list];
  return renderPdf(all.map((v) => voucherPage(v, siteOrigin)), { title: all.length === 1 ? `New Way’s gift voucher ${all[0].code}` : `New Way’s gift vouchers (${all.length})`,
    author: 'New Way’s Mediumship Development Centre' });
}
