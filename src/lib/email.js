// Sending email. The provider is swappable: everything else calls sendEmail() and never talks to a provider directly.
// Settings (Cloudflare secrets/variables, never in GitHub):
//   EMAIL_PROVIDER  "resend" (the default; free for up to 3,000 emails a month)
//   RESEND_API_KEY  the provider's key (a secret)
//   EMAIL_FROM      the sending address, e.g. New Way’s <bookings@your-domain>  (a domain verified with the provider)
const isLocal = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(u || ''));

const PROVIDERS = {
  async resend(env, msg) {
    if (!env.RESEND_API_KEY) return null;
    const base = isLocal(env.RESEND_API_BASE) ? String(env.RESEND_API_BASE).replace(/\/+$/, '') : 'https://api.resend.com';
    const res = await fetch(base + '/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + String(env.RESEND_API_KEY).trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, reply_to: msg.replyTo || undefined })
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw new Error(`email provider answered ${res.status}${data && data.message ? ': ' + data.message : ''}`);
    return { id: String(data.id || '') };
  }
};

export function emailConfigured(env) {
  const provider = PROVIDERS[String(env.EMAIL_PROVIDER || 'resend').toLowerCase()];
  return !!(provider && env.EMAIL_FROM && (String(env.EMAIL_PROVIDER || 'resend').toLowerCase() !== 'resend' || env.RESEND_API_KEY));
}

// Returns { status: 'sent' | 'not_configured' | 'failed', id, error }
export async function sendEmail(env, msg) {
  const name = String(env.EMAIL_PROVIDER || 'resend').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider || !env.EMAIL_FROM) return { status: 'not_configured' };
  try {
    const out = await provider(env, { ...msg, from: String(env.EMAIL_FROM) });
    if (!out) return { status: 'not_configured' };
    return { status: 'sent', id: out.id };
  } catch (err) {
    console.error("New Way's: email not sent:", err && err.message ? err.message : err);
    return { status: 'failed', error: String(err && err.message ? err.message : err).slice(0, 200) };
  }
}
