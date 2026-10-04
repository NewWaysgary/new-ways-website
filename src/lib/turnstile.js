// Cloudflare Turnstile (free): checks that a visitor experience was sent by a person, not a spam program.
// The site key is public; the secret key stays on the server.
export function turnstileConfig(request, env) {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) return null;
  const host = new URL(request.url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  return {
    siteKey: String(env.TURNSTILE_SITE_KEY),
    secret: String(env.TURNSTILE_SECRET_KEY),
    verifyUrl: local && env.TURNSTILE_VERIFY_URL ? env.TURNSTILE_VERIFY_URL : 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
  };
}

export async function verifyTurnstile(cfg, token, ip) {
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: cfg.secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch(cfg.verifyUrl, { method: 'POST', body });
    const data = await res.json();
    return data && data.success === true;
  } catch {
    return false;
  }
}

// A signed time stamp in the form: very fast submissions are from programs, very old forms have expired.
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('nw-form:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function formStamp(cfg) {
  const t = String(Date.now());
  return t + '.' + (await hmac(cfg.secret, t));
}
export async function stampAge(cfg, stamp) {
  const [t, sig] = String(stamp || '').split('.');
  if (!/^\d{13}$/.test(t || '') || sig !== (await hmac(cfg.secret, t))) return null;
  return Date.now() - Number(t);
}
