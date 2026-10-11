// The Support New Way's page (/support): making a donation, and the donor's own page afterwards.
import { htmlResponse, redirect, readForm, textResponse } from '../lib/http.js';
import { turnstileConfig, verifyTurnstile, formStamp, stampAge } from '../lib/turnstile.js';
import { allow } from '../lib/ratelimit.js';
import * as pub from '../views/public.js';
import * as data from '../lib/data.js';
import * as view from '../views/support.js';
import { EMAIL_RE } from '../bookings/config.js';
import { normaliseEmail } from '../lib/emails.js';
import { squareConfig, squareMode, createPaymentLink, SquareError } from '../payments/square.js';
import { newAccessKey, sha256Hex } from '../orders.js';
import * as d from './model.js';

const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
export const donationsOpen = (request, env) => !!(squareConfig(env) && turnstileConfig(request, env));

async function supportPage(request, env, state = {}) {
  const ctx = await pub.pageContext(request, env);
  const cfg = turnstileConfig(request, env);
  const open = donationsOpen(request, env);
  const [blocks, list] = await Promise.all([data.getBlocks(env, ['support_intro', 'support_thanks']), d.supporters(env)]);
  return htmlResponse(await view.supportPage(ctx, { open, sandbox: squareMode(env) === 'sandbox', intro: blocks.support_intro, thanks: blocks.support_thanks, supporters: list,
    stamp: open ? await formStamp(cfg) : '', siteKey: cfg ? cfg.siteKey : '', ...state }), { status: state.status || 200 });
}

async function donate(request, env) {
  const cfg = turnstileConfig(request, env);
  const sq = squareConfig(env);
  if (!cfg || !sq) return redirect('/support');
  const here = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== here) return textResponse('Forbidden', { status: 403 });
  const f = await readForm(request, 20_000);
  const values = { name: String(f.name || '').trim().replace(/\s+/g, ' '), email: normaliseEmail(f.email), amount: String(f.amount || '').trim(),
    display: f.display === 'public' ? 'public' : f.display === 'anonymous' ? 'anonymous' : '', public_name: String(f.public_name || '').trim().replace(/\s+/g, ' ') };
  const again = (state) => supportPage(request, env, { values, ...state });
  const age = await stampAge(cfg, f.t);
  if (String(f.website || '').trim() || (age !== null && age < 3000)) return redirect('/support');
  if (age === null || age > 3 * 3600_000) return again({ notice: 'This page was open for a long time. Please check your details and try again.', status: 400 });
  const errors = {};
  if (values.name.length < 2) errors.name = 'Please enter your name.';
  else if (values.name.length > 80) errors.name = 'Please keep your name under 80 characters.';
  if (values.email.length > 254 || !EMAIL_RE.test(values.email)) errors.email = 'Please enter your full email address, so we can thank you.';
  const pence = d.parseAmount(values.amount);
  if (pence === null) errors.amount = 'Please enter the amount you would like to give, for example 10 or 12.50.';
  else if (pence < d.MIN_PENCE) errors.amount = `The smallest donation that can be made online is ${d.pounds(d.MIN_PENCE)}.`;
  else if (pence > d.MAX_PENCE) errors.amount = `For a donation over ${d.pounds(d.MAX_PENCE)}, please contact New Way’s, who will be glad to help.`;
  if (!values.display) errors.display = 'Please choose whether to be shown on our Supporters list or to stay anonymous.';
  if (values.public_name.length > 60) errors.public_name = 'Please keep this under 60 characters.';
  if (Object.keys(errors).length) return again({ errors, status: 422 });
  if (!(await allow(env, request, 'donation', 6, 3600))) return again({ notice: 'We have received several donations from this connection. Please try again later.', status: 429 });
  if (!(await verifyTurnstile(cfg, f['cf-turnstile-response'], request.headers.get('CF-Connecting-IP')))) {
    return again({ notice: 'The security check didn’t complete. Please wait for it to finish, then try again.', status: 400 });
  }
  const reference = d.newDonationReference();
  const access = await newAccessKey();
  const isPublic = values.display === 'public';
  await env.DB.prepare(`INSERT INTO donations (reference, amount_pence, donor_name, donor_email, show_publicly, public_name, access_hash, origin)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(reference, pence, values.name, values.email, isPublic ? 1 : 0, isPublic ? (values.public_name || values.name) : '', await sha256Hex('donation:' + access.key), here).run();
  const self = `/support/donation/${reference}?key=${encodeURIComponent(access.key)}`;
  try {
    const link = await createPaymentLink(sq, { reference, itemName: 'Donation to New Way’s Mediumship Development Centre', amountPence: pence, buyerEmail: values.email,
      idempotencyKey: reference, redirectUrl: here + self });
    await env.DB.prepare('UPDATE donations SET square_payment_link_id = ?1, square_payment_url = ?2, square_order_id = ?3 WHERE reference = ?4').bind(link.id, link.url, link.orderId, reference).run();
  } catch (err) {
    console.error("New Way's: Square payment link not created (donation):", err instanceof SquareError ? `${err.message} ${err.detail}` : err);
    await env.DB.prepare(`UPDATE donations SET status = 'cancelled', note = 'The Square payment page could not be created.' WHERE reference = ?1`).bind(reference).run();
    return again({ notice: 'Sorry, the secure payment page couldn’t be opened just now, so nothing has been charged. Please try again in a few minutes.', status: 503 });
  }
  // To the donor's own page on this website first, which opens Square's page (a form here may only answer to this
  // website: see the Wednesday payment page for the same reason)
  return redirect(self + '&go=1');
}

async function donationStatus(request, env, url, reference) {
  const key = url.searchParams.get('key') || '';
  const ctx = await pub.pageContext(request, env);
  let row = /^ND-[A-Z0-9]{6}$/.test(reference) && key && key.length < 100 ? await env.DB.prepare('SELECT * FROM donations WHERE reference = ?1').bind(reference).first() : null;
  if (!row || (await sha256Hex('donation:' + key)) !== row.access_hash) {
    return htmlResponse(await view.messagePage(ctx, { title: 'Donation not found', message: 'This link isn’t complete or has expired. Please contact New Way’s if you need help.' }), { status: 404, headers: PRIVATE });
  }
  let checkFailed = false;
  if (row.status === 'pending' && row.square_order_id) {
    try { await d.checkDonationWithSquare(env, row); } catch (err) { checkFailed = true; console.error("New Way's: could not check a donation with Square:", err && err.message); }
    row = await env.DB.prepare('SELECT * FROM donations WHERE id = ?1').bind(row.id).first();
  }
  return htmlResponse(await view.donationPage(ctx, { d: row, checkFailed, sandbox: squareMode(env) === 'sandbox', self: `/support/donation/${row.reference}?key=${encodeURIComponent(key)}`,
    goToPay: url.searchParams.get('go') === '1', payUrl: row.status === 'pending' && /^(https:\/\/|http:\/\/localhost[:/])/.test(row.square_payment_url) ? row.square_payment_url : '' }),
  { headers: PRIVATE });
}

export async function handleSupportRoutes(request, env, url, method, path) {
  if (path === '/support') return method === 'GET' ? supportPage(request, env) : null;
  if (path === '/support/donate' && method === 'POST') return donate(request, env);
  const s = path.match(/^\/support\/donation\/(ND-[A-Z0-9]{6})$/);
  if (s && method === 'GET') return donationStatus(request, env, url, s[1]);
  return null;
}
