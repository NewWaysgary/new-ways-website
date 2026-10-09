// Admin > System status: a GO-LIVE CHECK with GREEN / WARNING / RED for everything the website depends on, and the
// SEND TEST EMAIL TO ME button. Secrets are never shown: only whether each is set, and whether it works.
import { redirect, textResponse, siteOrigin } from '../lib/http.js';
import { allow } from '../lib/ratelimit.js';
import * as data from '../lib/data.js';
import { squareConfig, squareMode, checkLocation } from '../payments/square.js';
import { emailConfigured, sendEmail } from '../lib/email.js';
import { turnstileConfig } from '../lib/turnstile.js';
import { signInConfigured } from '../lib/auth.js';
import { getBookingSettings } from '../bookings/config.js';
import { build, context } from '../notify.js';
import { friendlyDateTime, ukToday } from '../lib/dates.js';
import * as view from '../views/admin-mailing.js';

const TABLES = ['settings', 'events', 'orders', 'bookings', 'products', 'download_entitlements', 'event_bookings', 'event_guests', 'event_questions',
  'event_answers', 'event_changes', 'event_email_log', 'mailing_list', 'checkin_helpers'];
const ok = (name, detail) => ({ name, state: 'green', detail });
const warn = (name, detail) => ({ name, state: 'warning', detail });
const bad = (name, detail) => ({ name, state: 'red', detail });

async function safe(name, fn) {
  try { return await fn(); } catch (err) { return bad(name, 'Could not be checked: ' + String(err && err.message ? err.message : err).slice(0, 120)); }
}

export async function runChecks(request, env) {
  const origin = new URL(request.url).origin;
  const settings = await getBookingSettings(env).catch(() => ({}));
  const checks = [];
  checks.push(ok('Website and Admin', 'This page loaded, so the website and Admin are running.'));
  checks.push(signInConfigured(request, env) ? ok('Admin sign-in', 'Sign-in is connected.') : bad('Admin sign-in', 'Sign-in is not connected.'));

  checks.push(await safe('Database', async () => {
    const { results } = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${TABLES.map((_, i) => '?' + (i + 1)).join(', ')})`).bind(...TABLES).all();
    const have = new Set((results || []).map((r) => r.name));
    const missing = TABLES.filter((t) => !have.has(t));
    return missing.length ? bad('Database', 'The latest database update has not been applied (missing: ' + missing.join(', ') + '). Run the deploy command again.') : ok('Database', 'Connected, and every database update has been applied.');
  }));

  checks.push(await safe('Storage (photos, music and recordings)', async () => {
    await env.MEDIA.list({ limit: 1 });
    return ok('Storage (photos, music and recordings)', 'Connected.');
  }));

  const sq = squareConfig(env);
  if (!sq) checks.push(bad('Square payments', 'Square is not connected (the access token or location ID is missing), so online booking and buying stay closed.'));
  else {
    checks.push(await safe('Square payments', async () => {
      const r = await checkLocation(sq);
      const mode = squareMode(env) === 'production' ? 'REAL payments (Production)' : 'TEST MODE (Sandbox): no real money is taken';
      if (r.ok && r.locationStatus && r.locationStatus !== 'ACTIVE') return bad('Square payments', `The Square location “${r.name}” is not active.`);
      if (r.ok) return squareMode(env) === 'production' ? ok('Square payments', `Connected to location “${r.name}”. ${mode}.`) : warn('Square payments', `Connected to location “${r.name}”. ${mode}. Switching to real payments is a separate step you approve.`);
      if (r.status === 401) return bad('Square payments', `Square did not accept the access token (${mode.split(':')[0]}). Check that the token is for the same environment and is current.`);
      if (r.status === 404 || r.status === 400) return bad('Square payments', 'Square accepted the access token, but the location ID does not belong to that Square account. Copy the location ID from the same account (Sandbox or Production) as the token.');
      if (r.status === 403) return bad('Square payments', 'Square refused access. The access token may not have the permissions needed.');
      return warn('Square payments', 'Square could not be reached just now. Try again in a minute.');
    }));
  }

  checks.push(await safe('Square payment notifications (webhook)', async () => {
    const name = 'Square payment notifications (webhook)';
    const url = `${origin}/webhooks/square`;
    if (!sq || !sq.signatureKey) return bad(name, `The webhook signature key is missing. In Square, subscribe ${url} to payment.created and payment.updated, then add its signature key in Cloudflare.`);
    const last = await env.DB.prepare('SELECT received_at FROM square_events ORDER BY received_at DESC LIMIT 1').first();
    if (!last) return warn(name, `The signature key is set. No notification has arrived yet (normal until the first payment). Square must send to: ${url}`);
    return ok(name, `Working. Last notification received ${friendlyDateTime(last.received_at)}. Address: ${url}`);
  }));

  checks.push(await safe('Email sending', async () => {
    const name = 'Email sending';
    if (!emailConfigured(env)) return bad(name, 'Email is not set up (the email key or sending address is missing), so no confirmation emails are sent.');
    const from = String(env.EMAIL_FROM || '');
    const testSender = /@resend\.dev>?\s*$/i.test(from);
    const [a, b] = await env.DB.batch([
      env.DB.prepare(`SELECT status, provider_id, created_at FROM email_log WHERE status IN ('sent', 'failed') ORDER BY created_at DESC LIMIT 1`),
      env.DB.prepare(`SELECT status, provider_id, created_at FROM event_email_log WHERE status IN ('sent', 'failed') ORDER BY created_at DESC LIMIT 1`)
    ]);
    const lastRow = [a.results?.[0], b.results?.[0]].filter(Boolean).sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0];
    const lastText = lastRow ? ` Last email ${lastRow.status === 'sent' ? 'sent' : 'FAILED'} ${friendlyDateTime(lastRow.created_at)}${lastRow.status === 'failed' && lastRow.provider_id ? ': ' + String(lastRow.provider_id).slice(0, 200) : ''}.` : '';
    if (testSender) return warn(name, `Using the email provider’s TEST sender (${from.replace(/^.*</, '').replace(/>$/, '')}). It only delivers to the email provider account’s own address, so customers won’t receive emails until your domain is verified.${lastText}`);
    if (lastRow && lastRow.status === 'failed') return warn(name, `Set up, but the last email failed.${lastText}`);
    return ok(name, `Set up. Sending from ${from}.${lastText}`);
  }));

  const notify = String(settings.notification_email || '');
  checks.push(notify ? ok('Your notification email address', `Notifications go to ${notify}.`) : bad('Your notification email address', 'Not set, so you won’t be told about new bookings and sales. Add it in Private Readings > Booking rules.'));

  checks.push(turnstileConfig(request, env) ? ok('Spam protection (Turnstile)', 'Connected.') : bad('Spam protection (Turnstile)', 'Not connected, so online booking, buying and the Join page’s spam check are not available.'));

  checks.push(await safe('Meditation downloads', async () => {
    const name = 'Meditation downloads';
    const { results } = await env.DB.prepare(`SELECT id, title, full_key FROM products WHERE status = 'published'`).all();
    const list = results || [];
    if (!list.length) return warn(name, 'No meditation is published at the moment.');
    const missing = [];
    for (const p of list.slice(0, 10)) {
      if (!p.full_key || !String(p.full_key).startsWith('private/') || !(await env.MEDIA.head(p.full_key))) missing.push(p.title);
    }
    if (missing.length) return bad(name, 'The full recording is missing for: ' + missing.join(', '));
    return ok(name, `${list.length} published; full recordings stored privately (one download per purchase, 48 hours to start it).`);
  }));

  checks.push(await safe('Events and tickets', async () => {
    const name = 'Events and tickets';
    const { results } = await env.DB.prepare(`SELECT id, name, sales_mode, capacity, start_time, price_pence, visible FROM events WHERE date >= ?1`).bind(ukToday()).all();
    const list = results || [];
    const online = list.filter((e) => e.sales_mode === 'online');
    const links = list.filter((e) => e.sales_mode === 'link');
    const broken = online.filter((e) => !(e.capacity > 0) || !e.start_time || !(e.price_pence >= 100));
    const summary = `${online.length} upcoming ${online.length === 1 ? 'event sells' : 'events sell'} tickets online here; ${links.length} ${links.length === 1 ? 'uses' : 'use'} a Square ticket link (unchanged).`;
    if (broken.length) return warn(name, `${summary} Check the ticket details (price, places, start time) for: ${broken.map((e) => e.name).join(', ')}`);
    if (online.length && (!sq || !turnstileConfig(request, env))) return bad(name, `${summary} Online tickets can’t be sold until Square and spam protection are connected.`);
    return ok(name, summary);
  }));

  checks.push(await safe('Scheduled jobs (reminders, holds, retries)', async () => {
    const name = 'Scheduled jobs (reminders, holds, retries)';
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'system_last_hourly'`).first();
    if (!row || !row.value) return warn(name, 'No hourly run recorded yet. This is normal within an hour of the first deploy of this version.');
    const age = Date.now() - Date.parse(row.value);
    return age < 2.5 * 3600_000 ? ok(name, `Running. Last run ${friendlyDateTime(row.value)}.`) : warn(name, `The hourly job last ran ${friendlyDateTime(row.value)}. Check Cron Triggers in Cloudflare.`);
  }));

  const environment = [['Address in use now', origin], ['Real website address (SITE_URL)', siteOrigin(request, env)],
    ['Payments', sq ? (squareMode(env) === 'production' ? 'Square Production (REAL money)' : 'Square Sandbox (test)') : 'Not connected']];
  return { checks, environment };
}

export async function handleStatusAdmin({ request, env, url, method, path, page, csrf, admin }) {
  if (path === '/admin/status') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const { checks, environment } = await runChecks(request, env);
    const t = url.searchParams.get('test');
    const to = (await getBookingSettings(env)).notification_email;
    const testResult = t === 'sent' ? { ok: true, text: `Test email sent to ${to}. If it hasn’t arrived in a few minutes, check the spam folder.` }
      : t === 'failed' ? { ok: false, text: 'The test email was NOT sent: ' + String(url.searchParams.get('why') || 'unknown problem').slice(0, 200) }
      : t === 'busy' ? { ok: false, text: 'Too many test emails in the last hour. Please try again later.' }
      : t === 'noaddress' ? { ok: false, text: 'Add your notification email address first (Private Readings > Booking rules).' } : null;
    return page(view.statusPage({ checks, environment, csrf: csrf.token, testResult }));
  }
  if (path === '/admin/status/test-email') {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const to = (await getBookingSettings(env)).notification_email;
    if (!to) return redirect('/admin/status?test=noaddress');
    if (!(await allow(env, request, 'test-email', 5, 3600))) return redirect('/admin/status?test=busy');
    const c = await context(env);
    const msg = build(c.centre, ['This is a test email from your New Way’s website.', 'If you are reading this, emails from the website are reaching you.',
      `Sent ${friendlyDateTime(new Date().toISOString())} from ${new URL(request.url).origin}.`]);
    const out = await sendEmail(env, { to, subject: 'New Way’s test email', ...msg });
    await data.audit(env, 'status.test-email', `Test email: ${out.status}`).run();
    if (out.status === 'sent') return redirect('/admin/status?test=sent');
    return redirect('/admin/status?test=failed&why=' + encodeURIComponent(out.status === 'not_configured' ? 'email is not set up yet (key or sending address missing).' : out.error || 'unknown problem'));
  }
  return null;
}
