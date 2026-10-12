// Admin › Incomplete Bookings: private reading bookings where the customer gave their details to the booking
// assistant but didn't go on to payment. Every record disappears 24 hours after it was saved (and can be deleted now).
import { html } from '../lib/html.js';
import { textResponse, redirect } from '../lib/http.js';
import * as data from '../lib/data.js';
import { adminPage } from '../views/admin.js';
import { friendlyDateTime, longDate } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { listForAdmin, deleteOne, INACTIVE_MINUTES, KEEP_HOURS } from '../bookings/incomplete.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const STATE = {
  incomplete: ['INCOMPLETE', 'attention', 'Gave their details but didn’t go on to payment.'],
  in_progress: ['STILL BOOKING', 'soon', `Still using the booking assistant (counted as incomplete after ${INACTIVE_MINUTES} minutes without activity).`],
  paying: ['AT PAYMENT', 'soon', 'Went on to Square’s payment page.'],
  paid: ['BOOKED AND PAID', 'live', 'Completed: the reading is booked (see Bookings).'],
  not_paid: ['WENT TO PAYMENT, NOT PAID', 'past', 'Went on to Square’s payment page but didn’t pay (see Orders).']
};

function listPage({ rows, csrf, flash }) {
  return adminPage({
    title: 'Incomplete Bookings', csrf, signedIn: true,
    body: html`${flash === 'deleted' ? html`<p class="banner banner-ok" role="status">Deleted.</p>` : ''}
<p class="hint">Private reading bookings where the customer gave their name, WhatsApp mobile and email to the booking assistant. A record becomes incomplete after ${INACTIVE_MINUTES} minutes without activity if they didn’t go on to payment, and you get one email (without their details). For privacy, every record is deleted automatically ${KEEP_HOURS} hours after it was saved. These records never hold an appointment time.</p>
${rows.length ? html`<ul class="rows">${rows.map((d) => {
      const [label, chip, line] = STATE[d.state];
      return html`<li class="row-card"><div class="row-text">
<span class="row-title">${d.customer_name} · ${d.service_name}</span>
<span class="row-line">${longDate(d.date)} at ${friendlyTime(d.local_start)} (UK time)</span>
<span class="row-line">WhatsApp ${d.customer_phone} · ${d.customer_email}</span>
<span class="row-line">${line}${d.order_reference ? ` Order ${d.order_reference}.` : ''}</span>
<span class="row-line small">Saved ${friendlyDateTime(d.created_at)} · last active ${friendlyDateTime(d.last_active_at)} · deleted automatically ${friendlyDateTime(d.delete_after)}</span>
<span class="chips"><span class="chip chip-${chip}">${label}</span></span></div>
<div class="row-actions"><form method="post" action="/admin/incomplete/${d.id}/delete">${hidden(csrf)}
<button class="pill pill-danger" type="submit" data-confirm="Delete this record now? This can’t be undone.">Delete now</button></form></div></li>`;
    })}</ul>` : html`<p class="panel">No incomplete bookings in the last ${KEEP_HOURS} hours.</p>`}`
  });
}

export async function handleIncompleteAdmin({ env, url, method, path, page, csrf, admin }) {
  if (path !== '/admin/incomplete' && !path.startsWith('/admin/incomplete/')) return null;
  if (path === '/admin/incomplete') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return page(listPage({ rows: await listForAdmin(env), csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }
  const m = path.match(/^\/admin\/incomplete\/(\d{1,9})\/delete$/);
  if (!m || method !== 'POST') return null;
  const by = admin.role === 'owner' ? 'Gary' : admin.name || admin.email;
  // The audit entry says only that a record was deleted, never whose
  if (await deleteOne(env, Number(m[1]))) await data.audit(env, 'incomplete.delete', `An incomplete booking record was deleted by ${by}`).run();
  return redirect('/admin/incomplete?flash=deleted');
}
