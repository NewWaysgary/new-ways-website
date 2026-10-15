// Private reading gift vouchers / reservation codes. Gary and Julie make them in Admin; a customer enters the code
// at the normal payment step of the Private Readings booking, and the reading is booked without Square.
// Every rule of the normal booking still applies (calendar, open and closed dates, length, break, notice, the
// database's refusal of any overlapping appointment); the voucher only replaces the payment.
import { randomToken } from '../lib/http.js';
import { ukToday, longDate } from '../lib/dates.js';
import { PdfPage, renderPdf, textWidth } from '../lib/pdf.js';
import { qrMatrix } from '../lib/qr.js';
import { LAYOUT, fitText } from './voucher-layout.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L: easy to read and type
export const STATUS_LABEL = { available: 'Available', reserved: 'Reserved', redeemed: 'Redeemed', expired: 'Expired', cancelled: 'Cancelled' };
export const MAX_BATCH = 50;
export const READINGS_PATH = '/private-readings';

// 12 random characters from 31 (about 59 bits): impossible to guess, and printed in three groups to read easily.
// Bytes from 248 up are skipped, so every character is exactly equally likely.
export function newCode() {
  const out = [];
  while (out.length < 12) {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    for (const b of a) if (b < 248 && out.length < 12) out.push(CODE_CHARS[b % CODE_CHARS.length]);
  }
  const c = out.join('');
  return `GV-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

// What a customer typed -> the stored form (GV-XXXX-XXXX-XXXX), or '' if it can't be a code. Spaces, dashes, lower case
// and a missing GV are all accepted.
export function normaliseCode(input) {
  let s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('GV') && s.length === 14) s = s.slice(2);
  if (s.length !== 12 || [...s].some((ch) => !CODE_CHARS.includes(ch))) return '';
  return `GV-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
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
  if (!code) return { problem: 'That doesn’t look like a New Way’s voucher code. Codes start with GV and have 12 letters and numbers, like GV-XXXX-XXXX-XXXX. Please check it and try again.' };
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

// ---------- the finished voucher: the approved design with the code, expiry date and QR code added ----------

// 31/12/2026 (or '' for no expiry)
export const expiryText = (v) => (v.expires_on ? v.expires_on.split('-').reverse().join('/') : '');

// Everything the voucher picture needs (the PNG is drawn by the Admin phone's browser from exactly this, then saved)
export function renderData(v, siteOrigin) {
  const link = siteOrigin + READINGS_PATH;
  return {
    id: v.id, code: v.code, expiry: expiryText(v), link, minutes: v.minutes,
    template: LAYOUT.templates[v.minutes] || LAYOUT.templates[30], width: LAYOUT.width, height: LAYOUT.height,
    regions: LAYOUT.regions, text: LAYOUT.text, qr: qrMatrix(link).map((row) => row.map((on) => (on ? '1' : '0')).join(''))
  };
}

// The printable PDF: A4 landscape, the approved voucher picture (exactly as supplied, not stretched or cropped) across
// the page, with the code and expiry date in Caladea Bold and the QR code as sharp vector squares, all placed with the
// same layout as the picture. templates: { 30, 60 } from pngForPdf(), and font: the Caladea Bold file (bytes).
function voucherPage(v, siteOrigin, templates) {
  const W = 841.89, H = 595.28, margin = 28.35;   // A4 landscape, 10 mm margins
  const p = new PdfPage(W, H);
  const pic = templates[v.minutes] || templates[30];
  const s = (W - 2 * margin) / LAYOUT.width;         // one scale for the picture and everything placed on it
  const ox = margin, oy = (H - LAYOUT.height * s) / 2;
  p.image(pic, ox, oy, LAYOUT.width * s, LAYOUT.height * s);
  const { regions, text } = LAYOUT;
  const place = (str, r, max) => {
    if (!str) return;
    const f = fitText(str, r, max, (t, size) => textWidth(t, 'caladea-bold', size));
    const spacing = f.size * text.tracking;
    // the capitals' height is centred in the box (codes and dates are capitals and figures only)
    const baseline = r.y + (r.h + f.size * text.capHeight) / 2;
    p.text(str, ox + (r.x + r.w / 2) * s, oy + baseline * s, { font: 'caladea-bold', size: f.size * s, color: text.colour, align: 'center', spacing: spacing * s });
  };
  place(v.code, regions.code, text.codeMax);
  place(expiryText(v), regions.expiry, text.expiryMax);
  const link = siteOrigin + READINGS_PATH;
  const q = regions.qr;
  // as on the picture: the box's grey square made white, the QR code filling it with a quiet zone of 4 modules
  p.qr(link, ox + q.x * s, oy + q.y * s, q.w * s, { dark: text.qrDark, light: '#FFFFFF', border: 4 });
  p.link(link, ox + q.x * s, oy + q.y * s, q.w * s, q.h * s);
  return p;
}

export function voucherPdf(list, siteOrigin, templates) {
  const all = Array.isArray(list) ? list : [list];
  return renderPdf(all.map((v) => voucherPage(v, siteOrigin, templates)), { title: all.length === 1 ? `New Way’s gift voucher ${all[0].code}` : `New Way’s gift vouchers (${all.length})`,
    author: 'New Way’s Mediumship Development Centre', fontFiles: { 'Caladea-Bold': templates.font } });
}
