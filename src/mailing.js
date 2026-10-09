// The mailing list: ONLY people who actively chose to join (the unticked box at event checkout, the Join page, or
// Gary adding someone who asked him). It is separate from bookings: unsubscribing never touches a booking, and
// booking emails (confirmations, reminders, QR codes) are not marketing and don't depend on it.
// One row per email address (stored in lower case), so the same person can never be on the list twice.
import { randomToken } from './lib/http.js';
import { normaliseEmail } from './lib/emails.js';

export const CHECKOUT_CONSENT = 'Keep me updated by email about future New Way’s events and activities.';

export const JOIN_DEFAULTS = {
  join_heading: 'Join our mailing list',
  join_message: 'Would you like to hear about upcoming events and what’s happening at New Way’s Mediumship Development Centre?\n\nJoin our mailing list to receive information about future events, Psychic Suppers, evenings of mediumship, workshops and other activities.',
  join_button: 'Join mailing list',
  join_consent: 'Yes, please email me about future New Way’s events and activities. I can unsubscribe at any time.'
};
export const JOIN_FIELDS = [
  { key: 'join_heading', label: 'Heading', max: 120 },
  { key: 'join_message', label: 'Message', max: 2000, text: true },
  { key: 'join_button', label: 'Button wording', max: 40 },
  { key: 'join_consent', label: 'Consent tick-box wording', max: 300, text: true,
    help: 'The visitor must tick this to join. Keep it clear about what they are agreeing to.' }
];

export async function joinWording(env) {
  const keys = Object.keys(JOIN_DEFAULTS);
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map((_, i) => '?' + (i + 1)).join(', ')})`).bind(...keys).all();
  const stored = Object.fromEntries((results || []).filter((r) => String(r.value).trim()).map((r) => [r.key, r.value]));
  return { ...JOIN_DEFAULTS, ...stored };
}

// Adds or re-subscribes. Returns 'added' | 'rejoined' | 'already'.
export async function subscribe(env, { email, name = '', source = '', consent = '' }) {
  const e = normaliseEmail(email);
  if (!e) return null;
  const now = new Date().toISOString();
  const before = await env.DB.prepare('SELECT status FROM mailing_list WHERE email = ?1').bind(e).first();
  await env.DB.prepare(`INSERT INTO mailing_list (email, name, status, source, consent_text, unsubscribe_token, subscribed_at, updated_at)
      VALUES (?1, ?2, 'subscribed', ?3, ?4, ?5, ?6, ?6)
    ON CONFLICT(email) DO UPDATE SET
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE mailing_list.name END,
      subscribed_at = CASE WHEN mailing_list.status = 'unsubscribed' THEN excluded.subscribed_at ELSE mailing_list.subscribed_at END,
      source = CASE WHEN mailing_list.status = 'unsubscribed' THEN excluded.source ELSE mailing_list.source END,
      consent_text = CASE WHEN mailing_list.status = 'unsubscribed' THEN excluded.consent_text ELSE mailing_list.consent_text END,
      status = 'subscribed', unsubscribed_at = NULL, updated_at = excluded.updated_at`)
    .bind(e, String(name || '').trim().slice(0, 80), String(source).slice(0, 80), String(consent).slice(0, 400), randomToken(24), now).run();
  return !before ? 'added' : before.status === 'unsubscribed' ? 'rejoined' : 'already';
}

export async function unsubscribeByToken(env, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return null;
  const row = await env.DB.prepare('SELECT * FROM mailing_list WHERE unsubscribe_token = ?1').bind(token).first();
  if (!row) return null;
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE mailing_list SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, ?1), updated_at = ?1 WHERE id = ?2 AND status = 'subscribed'`)
    .bind(now, row.id).run();
  return row;
}

// For FUTURE promotional emails: every one must carry this link (and the matching List-Unsubscribe header)
export const unsubscribeUrl = (origin, subscriber) => `${origin}/unsubscribe/${subscriber.unsubscribe_token}`;
export function promotionalHeaders(origin, subscriber) {
  return { 'List-Unsubscribe': `<${unsubscribeUrl(origin, subscriber)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}
