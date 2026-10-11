// Wednesday till › Match up a card payment: a card payment that was taken in the Square app but never recorded in
// the till (for example the £1 test taken before the till confirmed payments by itself). The list comes from Square
// itself, so nothing is typed in by hand; each Square payment can only ever be recorded once, and nothing is charged.
import { html, raw } from '../lib/html.js';
import { textResponse, redirect } from '../lib/http.js';
import * as data from '../lib/data.js';
import * as w from '../wednesday/model.js';
import { adminPage } from '../views/admin.js';
import { isIsoDate, ukToday, londonLocalToUtc, longDate } from '../lib/dates.js';
import { posConfig, posPaymentsBetween, posPayment, SquareError } from '../payments/square.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '');
const ukDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));
const ID_RE = /^[A-Za-z0-9_-]{6,80}$/;

// Is this Square payment already counted anywhere on the website?
async function usedBy(env, pid) {
  const rows = await env.DB.batch([
    env.DB.prepare('SELECT id, night_date, total_pence FROM till_sales WHERE square_payment_id = ?1').bind(pid),
    env.DB.prepare(`SELECT ref FROM till_card_requests WHERE square_payment_id = ?1`).bind(pid),
    env.DB.prepare('SELECT reference FROM orders WHERE square_payment_id = ?1').bind(pid),
    env.DB.prepare('SELECT reference FROM event_bookings WHERE square_payment_id = ?1').bind(pid),
    env.DB.prepare('SELECT reference FROM wed_orders WHERE square_payment_id = ?1').bind(pid),
    env.DB.prepare('SELECT reference FROM donations WHERE square_payment_id = ?1').bind(pid)
  ]);
  const [sale, req, order, booking, wed, don] = rows.map((r) => (r.results || [])[0]);
  if (sale) return `Already in the till (${w.pounds(sale.total_pence)}, ${longDate(sale.night_date)})`;
  if (req) return 'Already in the till';
  if (order || booking || wed || don) return `A website payment (${(order || booking || wed || don).reference})`;
  return '';
}

function page({ date, rows, setUp, error, csrf, flash }) {
  return adminPage({
    title: 'Match up a card payment', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/door?date=${date}">Back to the till</a></p>
${flash === 'recorded' ? html`<p class="banner banner-ok" role="status">Recorded in the till. Nothing was charged.</p>` : ''}
<p class="hint">For a card payment taken in the Square app that is NOT in the till (for example, the test payment taken before the till recorded payments by itself). The payments below come straight from Square. Recording one adds it to the till as a card sale; nothing is charged, and each Square payment can only be recorded once.</p>
<form method="get" action="/admin/door/reconcile" class="panel admin-form"><div class="field"><label for="r-date">Day the card was taken</label><input id="r-date" name="date" type="date" value="${date}"></div><button class="pill" type="submit">Show that day</button></form>
${!setUp ? html`<p class="banner banner-error" role="alert">Checking with Square isn’t set up (SQUARE_POS_ACCESS_TOKEN), so Square’s payments can’t be listed here.</p>` : ''}
${error ? html`<p class="banner banner-error" role="alert">${error}</p>` : ''}
${setUp && !error ? (rows.length ? html`<ul class="rows">${rows.map((p) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${w.pounds(p.amount)} card · ${clock(p.created_at)}${p.last4 ? ` · card ending ${p.last4}` : ''}</span>
<span class="row-line">Square payment ${p.id} · ${p.status === 'COMPLETED' ? 'completed' : p.status.toLowerCase()}</span>
${p.used ? html`<span class="chips"><span class="chip chip-past">${p.used}</span></span>` : ''}</div>
${!p.used && p.status === 'COMPLETED' && p.currency === 'GBP' ? html`<div class="row-actions"><a class="pill pill-gold" href="/admin/door/reconcile/${p.id}?date=${date}">Record in the till</a></div>` : ''}</li>`)}</ul>`
      : html`<p class="panel">Square shows no card payments on ${longDate(date)}.</p>`) : ''}`
  });
}

function recordPage({ p, date, items, used, error, csrf, values = {} }) {
  const amount = Number(p.amount_money.amount);
  return adminPage({
    title: 'Record a card payment', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/door/reconcile?date=${date}">Back to the list</a></p>
<section class="panel"><h2>${w.pounds(amount)} card payment</h2><p>Taken ${longDate(ukDate(p.created_at))} at ${clock(p.created_at)} · Square payment ${p.id}</p></section>
${used ? html`<p class="banner banner-error" role="alert">${used}. It can’t be recorded again.</p>` : html`
${error ? html`<p class="banner banner-error" role="alert">${error}</p>` : ''}
<form method="post" action="/admin/door/reconcile/${p.id}" class="panel admin-form">${hidden(csrf)}
<p class="hint">What was it for? The items must add up to exactly ${w.pounds(amount)}.</p>
${items.map((i) => i.custom_amount ? html`<div class="field"><label for="ri-${i.id}">${i.label} (£, amount)</label><input id="ri-${i.id}" name="a${i.id}" type="text" inputmode="decimal" autocomplete="off" value="${values['a' + i.id] || ''}"></div>`
    : html`<div class="field"><label for="ri-${i.id}">${i.label} (${w.pounds(i.price_pence)} each)</label><select id="ri-${i.id}" name="q${i.id}">${Array.from({ length: 21 }, (_, n) => html`<option value="${n}"${String(values['q' + i.id] || '0') === String(n) ? raw(' selected') : ''}>${n}</option>`)}</select></div>`)}
<div class="field"><label for="r-night">Wednesday it belongs to</label><input id="r-night" name="night" type="date" value="${values.night || ukDate(p.created_at)}"></div>
<button class="btn-gold" type="submit" data-confirm="Record this ${w.pounds(amount)} card payment in the till? Nothing will be charged.">Record in the till</button></form>`}`
  });
}

export async function handleReconcile({ env, url, method, path, form, page: show, csrf, by }) {
  if (path !== '/admin/door/reconcile' && !path.startsWith('/admin/door/reconcile/')) return null;
  const cfg = posConfig(env);
  if (path === '/admin/door/reconcile') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const date = isIsoDate(url.searchParams.get('date')) ? url.searchParams.get('date') : ukToday();
    let rows = [], error = '';
    if (cfg) {
      try {
        const next = new Date(date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
        const list = await posPaymentsBetween(cfg, londonLocalToUtc(`${date}T00:00`), londonLocalToUtc(`${next.toISOString().slice(0, 10)}T00:00`));
        for (const p of list) {
          rows.push({ id: p.id, amount: Number(p.amount_money && p.amount_money.amount), currency: p.amount_money && p.amount_money.currency, status: p.status, created_at: p.created_at,
            last4: p.card_details && p.card_details.card ? p.card_details.card.last_4 : '', used: await usedBy(env, p.id) });
        }
      } catch (err) {
        error = err instanceof SquareError && (err.status === 401 || err.status === 403) ? 'Square refused the till’s checking access (SQUARE_POS_ACCESS_TOKEN).' : 'Square couldn’t be reached just now. Please try again.';
      }
    }
    return show(page({ date, rows, setUp: !!cfg, error, csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }
  const m = path.match(/^\/admin\/door\/reconcile\/([A-Za-z0-9_-]{6,80})$/);
  if (!m || !cfg) return redirect('/admin/door/reconcile');
  let p;
  try { p = await posPayment(cfg, m[1]); } catch { return redirect('/admin/door/reconcile'); }
  if (!p || (cfg.locationId && p.location_id !== cfg.locationId)) return redirect('/admin/door/reconcile');
  const items = await w.tillItems(env, { enabledOnly: true });
  const date = isIsoDate(url.searchParams.get('date')) ? url.searchParams.get('date') : ukDate(p.created_at);
  const used = await usedBy(env, p.id);
  if (method === 'GET') return show(recordPage({ p, date, items, used, csrf: csrf.token }));
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  const f = form.fields;
  const again = (error) => show(recordPage({ p, date, items, used, error, csrf: csrf.token, values: f }), 422);
  if (used) return again('');
  const amount = Number(p.amount_money && p.amount_money.amount);
  if (p.status !== 'COMPLETED' || p.amount_money.currency !== 'GBP') return again('Square says this payment did not complete, so it can’t be recorded.');
  const lines = [];
  for (const i of items) {
    if (i.custom_amount) {
      const t = String(f['a' + i.id] || '').replace(/[£,\s]/g, '');
      if (t && !/^\d{1,5}(\.\d{1,2})?$/.test(t)) return again(`Please enter the ${i.label} amount like 4.50.`);
      if (t && Number(t) > 0) lines.push({ item_id: i.id, qty: 1, amount_pence: Math.round(Number(t) * 100) });
    } else {
      const q = Number(f['q' + i.id] || 0);
      if (Number.isInteger(q) && q > 0) lines.push({ item_id: i.id, qty: q });
    }
  }
  const basket = w.priceBasket(items, lines);
  if (basket.errors.length) return again(basket.errors[0]);
  if (!basket.lines.length) return again('Please choose what the payment was for.');
  if (basket.total !== amount) return again(`Those items come to ${w.pounds(basket.total)}, but Square took ${w.pounds(amount)}. They must match exactly.`);
  const night = isIsoDate(f.night) ? f.night : ukDate(p.created_at);
  const ref = 'sq-' + p.id.slice(0, 56);
  const steps = [w.ensureNight(env, night),
    env.DB.prepare(`INSERT INTO till_sales (night_date, method, total_pence, client_ref, created_by, square_payment_id) VALUES (?1, 'card', ?2, ?3, ?4, ?5)`).bind(night, amount, ref, by, p.id)];
  for (const l of basket.lines) {
    steps.push(env.DB.prepare(`INSERT INTO till_sale_lines (sale_id, item_id, label, category, unit_pence, qty, line_pence) VALUES ((SELECT id FROM till_sales WHERE client_ref = ?1), ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(ref, l.item_id, l.label, l.category, l.unit_pence, l.qty, l.line_pence));
  }
  steps.push(data.audit(env, 'door.reconcile', `Square card payment ${p.id} (${w.pounds(amount)}, taken ${p.created_at}) recorded in the till for ${night} by ${by}; nothing charged`));
  try { await env.DB.batch(steps); }
  catch (err) {
    const msg = String(err && err.message);
    if (/TILL_CLOSED/.test(msg)) return again('That night has been closed (cash counted). Reopen it from Close night first.');
    if (/UNIQUE/.test(msg)) return again('This Square payment has already been recorded.');
    throw err;
  }
  return redirect(`/admin/door/reconcile?date=${ukDate(p.created_at)}&flash=recorded`);
}
