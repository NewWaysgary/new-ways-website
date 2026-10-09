import { normaliseEmail } from '../lib/emails.js';
// Booking, shop and record-keeping settings. Stored in the existing `settings` table (separate from the Centre
// Settings form, so saving Centre Settings never changes them). Every value here is editable in Admin.

export const DEFAULT_CANCELLATION_POLICY = [
  'If you need to cancel or rearrange, please contact Gary directly, giving 48 hours’ notice where possible. At least 24 hours’ notice is needed.',
  '',
  'Cancellations or changes made less than 24 hours before your reading are treated as late and aren’t automatically refunded, though Gary will always consider genuine exceptional circumstances personally.'
].join('\n');

export const BOOKING_SETTINGS = [
  { key: 'booking_hold_minutes', label: 'Hold an appointment while the customer pays (minutes)', default: '15', min: 5, max: 60 },
  { key: 'booking_min_notice_hours', label: 'Stop online booking this many hours before a reading', default: '24', min: 0, max: 336 },
  { key: 'booking_horizon_weeks', label: 'Show appointments this many weeks ahead', default: '12', min: 1, max: 52 },
  { key: 'customer_retention_months', label: 'Keep customer contact details for (months)', default: '24', min: 6, max: 120,
    help: 'After this, a customer’s name, email and phone are removed from their order. The order itself (date, amount paid and payment reference) is always kept for your financial records.' },
  { key: 'booking_cancellation_policy', label: 'Cancellation and rearrangement policy', default: DEFAULT_CANCELLATION_POLICY, text: true, maxLength: 2000,
    help: 'Shown before payment, where the customer must tick to accept it, and in the booking confirmation. A blank line starts a new paragraph.' },
  { key: 'notification_email', label: 'Send booking and sales notifications to this email address', default: '', email: true,
    help: 'You get an email for every new booking and every meditation sold, and if a payment needs your attention. Only you see this address.' }
];

export const DEFAULT_MEDITATION_TERMS = [
  'This meditation is for your own personal use only. Please don’t copy, share, resell or play it publicly.',
  '',
  'Your purchase includes one download. Your secure download link is sent by email straight after payment and must be used within 48 hours. Because the recording is available to you immediately, you agree that you lose the right to cancel once your download is ready.'
].join('\n');

export const SHOP_SETTINGS = [
  { key: 'download_expiry_hours', label: 'Time to start the download (hours)', default: '48', min: 1, max: 168,
    help: 'Each purchase includes ONE download. The customer must start it within this time. Once started, the same download can be restarted for 15 minutes if it is interrupted, then the link stops working.' },
  { key: 'meditation_terms', label: 'Personal-use terms', default: DEFAULT_MEDITATION_TERMS, text: true, maxLength: 2000,
    help: 'Shown before payment, where the customer must tick to accept them, and in the email with the download link.' }
];

export const OTHER_DEFAULTS = {
  reviews_open: '1'
};

const ALL_DEFAULTS = { ...Object.fromEntries([...BOOKING_SETTINGS, ...SHOP_SETTINGS].map((s) => [s.key, s.default])), ...OTHER_DEFAULTS };
const KEYS = Object.keys(ALL_DEFAULTS);

export async function getBookingSettings(env) {
  const placeholders = KEYS.map((_, i) => '?' + (i + 1)).join(', ');
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).bind(...KEYS).all();
  const stored = Object.fromEntries((results || []).map((r) => [r.key, r.value]));
  return { ...ALL_DEFAULTS, ...stored };
}

export function numberSetting(settings, key) {
  const n = Number(settings[key]);
  return Number.isFinite(n) ? n : Number(ALL_DEFAULTS[key]);
}

export const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;

export function validateBookingSettings(input, list = BOOKING_SETTINGS) {
  const values = {};
  const errors = {};
  for (const s of list) {
    let raw = String(input[s.key] ?? '').replace(/\r\n?/g, '\n').trim();
    if (s.email) {
      raw = normaliseEmail(raw);
      if (raw && (raw.length > 254 || !EMAIL_RE.test(raw))) errors[s.key] = 'Please enter a full email address, or leave this empty.';
      values[s.key] = raw;
    } else if (s.text) {
      if (!raw) errors[s.key] = 'This is needed.';
      else if (raw.length > s.maxLength) errors[s.key] = `Please keep this under ${s.maxLength.toLocaleString('en-GB')} characters.`;
      values[s.key] = raw;
    } else {
      if (!/^\d{1,4}$/.test(raw) || Number(raw) < s.min || Number(raw) > s.max) errors[s.key] = `Enter a whole number from ${s.min} to ${s.max}.`;
      values[s.key] = raw;
    }
  }
  return { values, errors };
}

export async function saveSettingValues(env, values, auditStatement) {
  const statements = Object.entries(values).map(([key, value]) =>
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(key, String(value))
  );
  if (auditStatement) statements.push(auditStatement);
  await env.DB.batch(statements);
}
