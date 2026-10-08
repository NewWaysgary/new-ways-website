// Admin screens for bookings and orders.
import { html, raw, formatText } from '../lib/html.js';
import { adminPage } from './admin.js';
import { longDate, friendlyDateTime } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { money } from '../notify.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const STATUS = {
  held: ['soon', 'AWAITING PAYMENT'], confirmed: ['live', 'BOOKED'], cancelled: ['past', 'CANCELLED'], expired: ['past', 'HOLD RAN OUT'],
  needs_attention: ['attention', 'NEEDS ATTENTION'], paid: ['live', 'PAID'], pending: ['soon', 'AWAITING PAYMENT']
};
const chip = (status) => { const [k, t] = STATUS[status] || ['past', status.toUpperCase()]; return html`<span class="chip chip-${k}">${t}</span>`; };

export function testBanner(mode) {
  return mode === 'sandbox' ? html`<p class="banner banner-test" role="note"><strong>TEST MODE:</strong> payments use Square Sandbox, so no real money is taken. Switching to real payments is a separate step you approve.</p>` : '';
}

const TABS = [['upcoming', 'Upcoming'], ['attention', 'Needs attention'], ['held', 'Awaiting payment'], ['past', 'Past'], ['closed', 'Cancelled or not paid']];

export function bookingsListPage({ rows, current, counts, csrf, mode, today }) {
  return adminPage({
    title: 'Bookings',
    csrf,
    signedIn: true,
    body: html`${testBanner(mode)}
<p class="hint">Private readings booked on the website. Customers contact you directly to cancel or rearrange; nothing is cancelled or refunded automatically.</p>
<nav class="tabs" aria-label="Show bookings">${TABS.map(([k, label]) => html`<a class="tab-link${k === current ? ' is-current' : ''}" href="/admin/bookings?show=${k}"${k === current ? raw(' aria-current="page"') : ''}>${label} <span class="count">${counts[k] ?? 0}</span></a>`)}</nav>
${rows.length ? html`<ul class="rows">${rows.map((r) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${longDate(r.date, today)}, ${friendlyTime(r.local_start)}</span>
<span class="row-line">${r.service_name} · ${r.customer_name || 'Customer details removed'}</span>
<span class="chips">${chip(r.booking_status)}</span>
</div>
<div class="row-actions"><a class="pill pill-gold" href="/admin/orders/${r.order_id}">Details</a></div></li>`)}</ul>`
      : html`<p class="panel">${current === 'upcoming' ? 'No upcoming bookings yet.' : 'Nothing here.'}</p>`}`
  });
}

export function salesListPage({ rows, csrf, mode }) {
  return adminPage({
    title: 'Meditation sales',
    csrf,
    signedIn: true,
    body: html`${testBanner(mode)}<p><a class="link" href="/admin/meditations">Back to Meditations</a></p>
${rows.length ? html`<ul class="rows">${rows.map((r) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${r.item_name}</span>
<span class="row-line">${r.customer_name || 'Customer details removed'} · ${money(r.amount_pence)} · ${friendlyDateTime(r.paid_at || r.created_at)}</span>
<span class="chips">${chip(r.status)}</span></div>
<div class="row-actions"><a class="pill pill-gold" href="/admin/orders/${r.id}">Details</a></div></li>`)}</ul>` : html`<p class="panel">No meditations have been sold yet.</p>`}`
  });
}

const FLASH = {
  cancelled: 'Booking cancelled. The time is free for others again. No refund has been made; if you decide to refund, do it in Square.',
  confirmed: 'Appointment kept. It now shows as booked.', resolved: 'Marked as dealt with.', noted: 'Note saved.', resent: 'Email sent again.',
  'resend-failed': 'The email could not be sent. Please check the email settings, or contact the customer directly.'
};

export function orderPage({ order, booking, product, emails, downloads, canKeep, csrf, flash, newLink, mode }) {
  const isReading = order.kind === 'PRIVATE_READING';
  const phone = order.customer_phone;
  const wa = phone ? 'https://wa.me/' + phone.replace(/[^\d]/g, '') : '';
  const rows = [
    ['Reference', order.reference],
    ...(isReading && booking ? [['Reading', booking.service_name], ['Date', longDate(booking.date, '0000')], ['Time', friendlyTime(booking.local_start) + ' (UK time)'], ['Length', booking.minutes + ' minutes']] : [['Meditation', order.item_name]]),
    ['Price', money(order.amount_pence)],
    ['Ordered', friendlyDateTime(order.created_at)],
    ['Paid', order.paid_at ? friendlyDateTime(order.paid_at) : 'Not paid'],
    ['Square payment', order.square_payment_id || '—'],
    ['Square order', order.square_order_id || '—']
  ];
  const act = (action, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/orders/${order.id}/${action}">${hidden(csrf)}<button type="submit" class="${cls}"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  const upcoming = isReading && booking && booking.status === 'confirmed' && Date.parse(booking.end_utc) > Date.now();
  return adminPage({
    title: isReading ? 'Booking' : 'Meditation order',
    csrf,
    signedIn: true,
    body: html`${testBanner(mode)}<p><a class="link" href="${isReading ? '/admin/bookings' : '/admin/meditations/sales'}">Back to ${isReading ? 'Bookings' : 'Meditation sales'}</a></p>
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
${newLink ? html`<div class="banner banner-ok" role="status"><p>A new download link has been made${newLink.emailed ? ' and emailed to the customer' : ', but the email could not be sent'}. You can also copy it and send it yourself:</p><p class="copy-link">${newLink.url}</p><p class="hint">It is shown only now, and works for the usual time and number of downloads.</p></div>` : ''}
<section class="panel" aria-labelledby="o-status">
<h2 id="o-status">${chip(isReading && booking ? booking.status : order.status)} ${order.status === 'paid' && isReading && booking && booking.status === 'cancelled' ? html`<span class="chip chip-live">PAID</span>` : ''}</h2>
${order.note ? html`<div class="note-box">${formatText(order.note)}</div>` : ''}
<dl class="detail-list">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
</section>
<section class="panel" aria-labelledby="o-customer">
<h2 id="o-customer">Customer</h2>
${order.personal_data_removed_at ? html`<p>The customer’s contact details were removed on ${friendlyDateTime(order.personal_data_removed_at)}, as set in Booking rules. The payment record is kept.</p>`
      : html`<dl class="detail-list">
<div><dt>Name</dt><dd>${order.customer_name}</dd></div>
<div><dt>Email</dt><dd><a class="link" href="mailto:${order.customer_email}">${order.customer_email}</a></dd></div>
${phone ? html`<div><dt>Mobile (WhatsApp)</dt><dd><a class="link" href="tel:${phone}">${phone}</a> · <a class="link" href="${wa}" target="_blank" rel="noopener">Open in WhatsApp</a></dd></div>` : ''}
</dl>`}
</section>
${order.terms_text ? html`<section class="panel" aria-labelledby="o-terms"><h2 id="o-terms">Terms agreed before payment</h2>
<p class="hint">Agreed ${order.terms_accepted_at ? friendlyDateTime(order.terms_accepted_at) : ''}</p><div class="terms-text">${formatText(order.terms_text)}</div></section>` : ''}
${!isReading && downloads.length ? html`<section class="panel" aria-labelledby="o-dl"><h2 id="o-dl">Download links</h2>
<ul class="todo">${downloads.map((d) => html`<li>${d.revoked_at ? 'Replaced' : Date.parse(d.expires_at) < Date.now() ? 'Expired' : 'Active'}: ${d.attempts} of ${d.max_attempts} downloads used, ${Date.parse(d.expires_at) < Date.now() ? 'expired' : 'expires'} ${friendlyDateTime(d.expires_at)}</li>`)}</ul></section>` : ''}
<section class="panel" aria-labelledby="o-actions"><h2 id="o-actions">Actions</h2>
<div class="row-actions">
${upcoming ? act('cancel', 'Cancel this booking', 'pill pill-danger', 'Cancel this booking and free the time? No refund is made automatically; if you decide to refund, do that in Square.') : ''}
${order.status === 'needs_attention' && canKeep ? act('keep', 'Keep this appointment', 'pill pill-gold', 'Keep this appointment as booked?') : ''}
${order.status === 'needs_attention' ? act('resolve', isReading ? 'Mark as dealt with (frees the time)' : 'Mark as dealt with', 'pill', 'Mark this as dealt with?') : ''}
${isReading && order.status === 'paid' && booking && booking.status === 'confirmed' && !order.personal_data_removed_at ? act('resend', 'Send the confirmation email again') : ''}
${!isReading && order.status === 'paid' && !order.personal_data_removed_at ? act('reissue', 'Send a new download link', 'pill pill-gold', 'Make a new download link and email it? The old link stops working.') : ''}
</div>
<form method="post" action="/admin/orders/${order.id}/note" class="admin-form">${hidden(csrf)}
<div class="field"><label for="o-note">Add a private note</label><textarea id="o-note" name="note" rows="3" maxlength="1000"></textarea></div>
<button type="submit" class="pill">Save note</button></form>
</section>
${emails.length ? html`<section class="panel" aria-labelledby="o-emails"><h2 id="o-emails">Emails</h2>
<ul class="todo">${emails.map((e) => html`<li>${{ customer_confirmation: 'Confirmation to customer', admin_notification: 'Notification to you', customer_reminder: 'Reminder to customer', admin_attention: 'Attention notice to you', customer_download: 'Download link to customer' }[e.kind] || (e.kind.includes('reissue') ? 'New download link to customer' : e.kind.includes('resend') ? 'Confirmation sent again' : e.kind)}: ${{ sent: 'sent', failed: 'NOT sent (failed)', not_configured: 'NOT sent (email not set up yet)', sending: 'sending', skipped: 'not sent (you dealt with it personally)' }[e.status] || e.status}, ${friendlyDateTime(e.created_at)}</li>`)}</ul></section>` : ''}`
  });
}

// The panel at the top of Private Readings: what is connected
export function connectionsPanel({ square, mode, webhookReady, email, notification, webhookUrl }) {
  const line = (ok, good, bad) => html`<li class="${ok ? 'is-ok' : 'is-missing'}"><span aria-hidden="true">${ok ? '✓' : '!'}</span> ${ok ? good : bad}</li>`;
  return html`<section class="panel" aria-labelledby="conn">
<h2 id="conn">Online booking</h2>
${testBanner(square ? mode : '')}
<ul class="status-list">
${line(square, html`Square is connected (${mode === 'production' ? 'REAL payments' : 'Sandbox test payments'}).`, 'Square is not connected yet, so online booking stays closed.')}
${line(webhookReady, 'Square payment notifications are set up.', 'Square payment notifications are not set up yet (payments are still checked when customers return).')}
${line(email, 'Emails to customers are set up.', 'Emails are not set up yet, so customers won’t receive confirmation emails.')}
${line(notification, 'Your notification email address is set.', html`Add your notification email address in <a class="link" href="#rules">Booking rules</a>.`)}
</ul>
<p class="hint">Square notification address (for the Square Developer Dashboard): <span class="copy-link">${webhookUrl}</span></p>
<p><a class="btn-gold btn-link" href="/admin/bookings">See bookings</a></p>
</section>`;
}
