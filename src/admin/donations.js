// Admin › Donations: every donation, its payment, and taking a supporter off (or back onto) the public Supporters
// list. Taking someone off the list never changes or deletes the payment record.
import { html } from '../lib/html.js';
import { textResponse, redirect } from '../lib/http.js';
import * as data from '../lib/data.js';
import { adminPage } from '../views/admin.js';
import { testBanner } from '../views/admin-orders.js';
import { friendlyDateTime } from '../lib/dates.js';
import { squareMode } from '../payments/square.js';
import { pounds } from '../donations/model.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const STATUS = { paid: 'PAID', pending: 'AWAITING PAYMENT', needs_attention: 'NEEDS ATTENTION', cancelled: 'NOT COMPLETED', expired: 'NOT COMPLETED' };
const FLASH = { hidden: 'Taken off the public Supporters list. The donation record is unchanged.', shown: 'Shown on the Supporters list again.' };

function listPage({ rows, totals, csrf, mode, flash, show }) {
  return adminPage({
    title: 'Donations', csrf, signedIn: true,
    body: html`${testBanner(mode)}
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<p class="hint">Donations made on the <a class="link" href="/support" target="_blank" rel="noopener">Support New Way’s</a> page. A donation only counts as paid when Square confirms it. Donors who chose to be recognised appear on the Supporters list straight away; you can take anyone off the list (the payment record stays).</p>
<section class="panel"><p><strong>${pounds(totals.total)}</strong> received from ${totals.n} ${totals.n === 1 ? 'donation' : 'donations'}.</p>
<nav class="tabs" aria-label="Show"><a class="tab-link${show === 'paid' ? ' is-current' : ''}" href="/admin/donations">Paid</a><a class="tab-link${show === 'all' ? ' is-current' : ''}" href="/admin/donations?show=all">All, including unfinished</a></nav></section>
${rows.length ? html`<ul class="rows">${rows.map((d) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${pounds(d.amount_pence)} · ${d.donor_name || 'Details removed'}</span>
<span class="row-line">${d.donor_email || ''}${d.donor_email ? ' · ' : ''}${friendlyDateTime(d.paid_at || d.created_at)} · ${d.reference}${d.square_payment_id ? ` · Square ${d.square_payment_id}` : ''}</span>
<span class="row-line">${d.show_publicly ? (d.public_hidden_at ? `Taken off the Supporters list by ${d.public_hidden_by || 'Admin'}` : `On the Supporters list as “${d.public_name}”`) : 'Anonymous (their choice)'} · Thank-you email: ${d.email_status || 'not sent yet'}</span>
${d.note ? html`<span class="row-line">${d.note}</span>` : ''}
<span class="chips"><span class="chip chip-${d.status === 'paid' ? 'live' : d.status === 'needs_attention' ? 'attention' : d.status === 'pending' ? 'soon' : 'past'}">${STATUS[d.status] || d.status}</span></span></div>
${d.status === 'paid' && d.show_publicly ? html`<div class="row-actions"><form method="post" action="/admin/donations/${d.id}/${d.public_hidden_at ? 'show' : 'hide'}">${hidden(csrf)}
<button class="pill${d.public_hidden_at ? '' : ' pill-danger'}" type="submit"${d.public_hidden_at ? '' : html` data-confirm="Take this supporter off the public list? The donation record stays."`}>${d.public_hidden_at ? 'Show on the list again' : 'Take off the list'}</button></form></div>` : ''}
</li>`)}</ul>` : html`<p class="panel">No donations yet.</p>`}`
  });
}

export async function handleDonationsAdmin({ env, url, method, path, page, csrf, admin }) {
  if (path !== '/admin/donations' && !path.startsWith('/admin/donations/')) return null;
  const by = admin.role === 'owner' ? 'Gary' : admin.name || admin.email;
  if (path === '/admin/donations') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const show = url.searchParams.get('show') === 'all' ? 'all' : 'paid';
    const { results } = await env.DB.prepare(`SELECT d.*, (SELECT status FROM donation_email_log l WHERE l.donation_id = d.id AND l.kind = 'thank_you') AS email_status
        FROM donations d ${show === 'paid' ? `WHERE d.status IN ('paid', 'needs_attention')` : ''} ORDER BY COALESCE(d.paid_at, d.created_at) DESC LIMIT 300`).all();
    const totals = await env.DB.prepare(`SELECT COALESCE(SUM(amount_pence), 0) AS total, COUNT(*) AS n FROM donations WHERE status = 'paid'`).first();
    return page(listPage({ rows: results || [], totals, csrf: csrf.token, mode: squareMode(env), flash: url.searchParams.get('flash'), show }));
  }
  const m = path.match(/^\/admin\/donations\/(\d{1,9})\/(hide|show)$/);
  if (!m || method !== 'POST') return null;
  const d = await env.DB.prepare('SELECT * FROM donations WHERE id = ?1').bind(Number(m[1])).first();
  if (!d || !d.show_publicly) return redirect('/admin/donations');
  if (m[2] === 'hide') {
    await env.DB.batch([env.DB.prepare(`UPDATE donations SET public_hidden_at = ?1, public_hidden_by = ?2 WHERE id = ?3 AND public_hidden_at IS NULL`).bind(new Date().toISOString(), by, d.id),
      data.audit(env, 'donations.hide', `Supporter entry for donation ${d.reference} taken off the public list by ${by}`)]);
    return redirect('/admin/donations?flash=hidden');
  }
  await env.DB.batch([env.DB.prepare(`UPDATE donations SET public_hidden_at = NULL, public_hidden_by = '' WHERE id = ?1`).bind(d.id),
    data.audit(env, 'donations.show', `Supporter entry for donation ${d.reference} shown again by ${by}`)]);
  return redirect('/admin/donations?flash=shown');
}
