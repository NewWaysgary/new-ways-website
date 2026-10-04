// Visitor experiences sent from the website. Every one is saved as "pending" and is NEVER shown
// until Gary approves it in Admin. Protection against spam: Cloudflare Turnstile (checked on the server),
// a hidden trap field, a signed time stamp, and limits per connection and per day.
import { htmlResponse, redirect, readForm } from './lib/http.js';
import { turnstileConfig, verifyTurnstile, stampAge } from './lib/turnstile.js';
import { allow } from './lib/ratelimit.js';
import * as data from './lib/data.js';
import * as pub from './views/public.js';

export async function submitExperience(request, env) {
  const cfg = turnstileConfig(request, env);
  const ctx = await pub.pageContext(request, env);
  const show = async (state, status) => htmlResponse(await pub.reviewsPage(ctx, state), { status });
  if (!cfg) return show({ notice: 'closed' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return show({ notice: 'error' }, 403);

  const f = await readForm(request, 20_000);
  const values = { name: String(f.name || '').trim(), body: String(f.body || '').replace(/\r\n?/g, '\n').trim(), rating: String(f.rating || ''), consent: f.consent === '1' };

  // Spam programs fill the hidden field or send the form instantly: pretend it worked, keep nothing.
  const age = await stampAge(cfg, f.t);
  if (String(f.website || '').trim() || (age !== null && age < 3000)) return redirect('/reviews?thanks=1#share');
  if (age === null || age > 2 * 3600_000) return show({ values, notice: 'expired' }, 400);

  const errors = {};
  if (values.name.length < 2) errors.name = 'Please enter your name.';
  else if (values.name.length > 60) errors.name = 'Please keep your name under 60 characters.';
  if (values.body.length < 10) errors.body = 'Please tell us a little more about your experience.';
  else if (values.body.length > 2000) errors.body = 'Please keep this under 2,000 characters.';
  if (values.rating && !/^[1-5]$/.test(values.rating)) errors.rating = 'Please choose from 1 to 5 stars, or leave it empty.';
  if (!values.consent) errors.consent = 'Please tick the box to agree, or we can’t show your experience.';
  if (Object.keys(errors).length) return show({ values, errors }, 422);

  if (!(await allow(env, request, 'experience', 3, 3600)) || !(await allow(env, { headers: new Headers() }, 'experience-all', 40, 86400))) {
    return show({ values, notice: 'busy' }, 429);
  }
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return show({ values, notice: 'check' }, 400);
  }

  await env.DB.prepare(`INSERT INTO reviews (name, rating, body, consent, status, featured) VALUES (?1, ?2, ?3, 1, 'pending', 0)`)
    .bind(values.name, values.rating ? Number(values.rating) : null, values.body).run();
  await data.housekeeping(env);
  return redirect('/reviews?thanks=1#share');
}
