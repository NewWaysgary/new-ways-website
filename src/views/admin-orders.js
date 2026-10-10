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

// ---------- meditation download records ----------
const mb = (b) => (Number(b) / 1_000_000).toFixed(2) + ' MB';
const mib = (b) => (Number(b) / 1_048_576).toFixed(2) + ' MiB';
const bytes = (b) => (b === null || b === undefined ? 'not found in storage' : `${Number(b).toLocaleString('en-GB')} bytes (${mb(b)}; ${mib(b)})`);
const STALE_MS = 2 * 60_000;
export function entitlementStatus(d) {
  if (!d) return 'No download link';
  if (d.revoked_at) return 'Replaced';
  if (d.attempts >= d.max_attempts) return 'Used';
  return Date.parse(d.expires_at) < Date.now() ? 'Expired (not used)' : 'Available (not used yet)';
}
export function transferLabel(d, transfers = null) {
  if (!d || !d.completed_at) return 'Not started';
  if (d.transfer_status === 'completed') return 'Completed (the server sent the whole file)';
  if (d.transfer_status === 'in_progress') {
    const mine = (transfers || []).filter((t) => t.entitlement_id === d.id && t.status === 'in_progress');
    if (transfers && mine.length && mine.every((t) => Date.now() - Date.parse(t.updated_at) > STALE_MS)) return 'Stopped part-way (no data sent for over 2 minutes)';
    return 'In progress';
  }
  if (d.transfer_status === 'interrupted') return 'Interrupted (not completely sent)';
  return 'Button pressed, but the file was not requested';
}
const EVENT = {
  blocked_repeat: 'Download pressed again after it was used', blocked_simultaneous: 'Second press at the same moment (refused)',
  blocked_expired: 'Pressed after the time ran out', blocked_replaced: 'Old (replaced) link used', blocked_other_device: 'Pressed on a different phone or computer',
  blocked_other_browser: 'File address opened in another browser or phone', blocked_after_complete: 'File asked for again after it was completely sent',
  blocked_late: 'Resume tried after 24 hours', blocked_too_many: 'Too many requests for one download', blocked_limit: 'Asked for more than one copy’s worth of data (refused)',
  blocked_continue: 'Continue pressed, but not allowed'
};
const when = (iso) => (iso ? friendlyDateTime(iso) : '—');

export function salesListPage({ rows, csrf, mode }) {
  return adminPage({
    title: 'Meditation sales',
    csrf,
    signedIn: true,
    body: html`${testBanner(mode)}<p><a class="link" href="/admin/meditations">Back to Meditations</a></p>
<p class="hint">Each purchase has ONE download. “Completed” means the website’s server sent the whole file to the customer’s browser; it can’t prove the phone saved it. File sizes are read from storage (R2) each time this page opens. MB = 1,000,000 bytes, as Android phones show it.</p>
${rows.length ? html`<ul class="rows">${rows.map((r) => { const d = r.download; return html`<li class="row-card"><div class="row-text">
<span class="row-title">${r.item_name}</span>
<span class="row-line">${r.customer_name || 'Customer details removed'}${r.customer_email && !r.personal_data_removed_at ? html` · ${r.customer_email}` : ''}</span>
<span class="row-line">${r.reference} · Square payment ${r.square_payment_id || '—'} · ${money(r.amount_pence)} · Paid ${when(r.paid_at || r.created_at)}</span>
${d ? html`<span class="row-line">File: ${bytes(d.r2_size)}</span>
<span class="row-line">Download: ${entitlementStatus(d)}${d.completed_at ? html` · pressed ${when(d.completed_at)}` : ''} · ${transferLabel(d)}${d.completed_at ? html` · ${Number(d.bytes_sent || 0).toLocaleString('en-GB')} bytes sent` : ''}${d.transfer_completed_at ? html` · completed ${when(d.transfer_completed_at)}` : ''}</span>` : ''}
<span class="row-line">Blocked repeat attempts: ${r.blocked_count || 0} · Replacements authorised: ${r.replacement_count || 0}</span>
<span class="chips">${chip(r.status)}</span></div>
<div class="row-actions"><a class="pill pill-gold" href="/admin/orders/${r.id}">Details</a></div></li>`; })}</ul>` : html`<p class="panel">No meditations have been sold yet.</p>`}`
  });
}

function downloadRecords({ order, downloads, devices, transfers, events, replacements }) {
  return html`<section class="panel" aria-labelledby="o-dl"><h2 id="o-dl">Download records</h2>
<p class="hint">ONE download per purchase. “Bytes sent” counts what the server handed on for sending; if a connection drops, some of those may not have arrived. “Completed” means the server sent every byte of the file; it can’t prove the phone saved it.</p>
${downloads.map((d) => { const mine = transfers.filter((t) => t.entitlement_id === d.id); return html`<div class="note-box">
<p><strong>${entitlementStatus(d)}</strong>${d.any_device ? ' (works on any device)' : ''}</p>
<dl class="detail-list">
<div><dt>Link made</dt><dd>${when(d.created_at)}</dd></div>
<div><dt>Button deadline</dt><dd>${when(d.expires_at)}</dd></div>
<div><dt>File size (R2, now)</dt><dd>${bytes(d.r2_size)}</dd></div>
${d.file_size ? html`<div><dt>File size when pressed</dt><dd>${bytes(d.file_size)}</dd></div>` : ''}
<div><dt>Download pressed</dt><dd>${d.completed_at ? when(d.completed_at) : 'Not yet'}</dd></div>
<div><dt>Transfer</dt><dd>${transferLabel(d, transfers)}</dd></div>
${d.completed_at ? html`<div><dt>Bytes sent by the server</dt><dd>${bytes(d.bytes_sent || 0)}</dd></div>` : ''}
${d.transfer_completed_at ? html`<div><dt>Completed</dt><dd>${when(d.transfer_completed_at)}</dd></div>` : ''}
</dl>
${mine.length ? html`<ul class="todo">${mine.map((t) => html`<li>Request ${when(t.started_at)}: ${t.range_start || t.range_length !== t.file_size ? html`bytes ${Number(t.range_start).toLocaleString('en-GB')} to ${Number(t.range_start + t.range_length - 1).toLocaleString('en-GB')}` : 'whole file'}, ${Number(t.bytes_sent).toLocaleString('en-GB')} of ${Number(t.range_length).toLocaleString('en-GB')} bytes sent, ${{ completed: 'completed', part_sent: 'part sent in full (a resume)', interrupted: 'interrupted', in_progress: Date.now() - Date.parse(t.updated_at) > STALE_MS ? 'stopped (no data for over 2 minutes)' : 'in progress' }[t.status] || t.status}${t.finished_at ? html`, ended ${when(t.finished_at)}` : ''}</li>`)}</ul>` : ''}
</div>`; })}
${order.device_protected ? html`<p class="hint">Protected against forwarding: the button works only on the phone or computer used to buy (${devices} recorded). There are no codes to add another device.</p>` : html`<p class="hint">Bought before download protection was added: the button works on any device (still ONE download).</p>`}
<h3>Blocked repeat attempts (${events.length})</h3>
${events.length ? html`<ul class="todo">${events.map((e) => html`<li>${when(e.created_at)}: ${EVENT[e.kind] || e.kind}</li>`)}</ul>` : html`<p class="hint">None.</p>`}
<h3>Replacement downloads authorised (${replacements.length})</h3>
${replacements.length ? html`<ul class="todo">${replacements.map((r) => html`<li>${when(r.created_at)}: authorised by ${r.authorised_by}${r.any_device ? ' (any device)' : ''}. Reason: ${r.reason}. Email: ${r.email_status || '—'}</li>`)}</ul>` : html`<p class="hint">None.</p>`}
</section>`;
}

const FLASH = {
  cancelled: 'Booking cancelled. The time is free for others again. No refund has been made; if you decide to refund, do it in Square.',
  confirmed: 'Appointment kept. It now shows as booked.', resolved: 'Marked as dealt with.', noted: 'Note saved.', resent: 'Email sent again.',
  'resend-failed': 'The email could not be sent. Please check the email settings, or contact the customer directly.'
};

export function orderPage({ order, booking, product, emails, downloads, devices = 0, transfers = [], events = [], replacements = [], canKeep, csrf, flash, newLink, reissueError = '', mode }) {
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
${newLink ? html`<div class="banner banner-ok" role="status"><p>A replacement download link has been made${newLink.emailed ? ' and emailed to the customer' : ', but the email could not be sent'}. You can also copy it and send it yourself:</p><p class="copy-link">${newLink.url}</p><p class="hint">It is shown only now. It gives ONE download, for the usual time${newLink.anyDevice ? ', on any device' : ''}. The replacement is recorded below.</p></div>` : ''}
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
${!isReading && downloads.length ? downloadRecords({ order, downloads, devices, transfers, events, replacements }) : ''}
<section class="panel" aria-labelledby="o-actions"><h2 id="o-actions">Actions</h2>
<div class="row-actions">
${upcoming ? act('cancel', 'Cancel this booking', 'pill pill-danger', 'Cancel this booking and free the time? No refund is made automatically; if you decide to refund, do that in Square.') : ''}
${order.status === 'needs_attention' && canKeep ? act('keep', 'Keep this appointment', 'pill pill-gold', 'Keep this appointment as booked?') : ''}
${order.status === 'needs_attention' ? act('resolve', isReading ? 'Mark as dealt with (frees the time)' : 'Mark as dealt with', 'pill', 'Mark this as dealt with?') : ''}
${isReading && order.status === 'paid' && booking && booking.status === 'confirmed' && !order.personal_data_removed_at ? act('resend', 'Send the confirmation email again') : ''}
</div>
${!isReading && order.status === 'paid' && !order.personal_data_removed_at ? html`<form method="post" action="/admin/orders/${order.id}/reissue" class="admin-form spaced" id="reissue">${hidden(csrf)}
<h3>Authorise a replacement download</h3>
<p class="hint">Only for a genuine problem (for example, the download failed and the customer has no copy). It gives the customer ONE new download, switches off the old link, and is recorded with your name and the reason.</p>
${reissueError ? html`<p class="banner banner-error" role="alert">${reissueError}</p>` : ''}
<div class="field"><label for="o-reason">Reason (kept in the records)</label><textarea id="o-reason" name="reason" rows="2" maxlength="500" required></textarea></div>
<label class="field-check"><input type="checkbox" name="any_device" value="1"> Let the replacement work on any phone or computer</label>
<p class="hint">Leave this unticked normally: the replacement then works only on the phone or computer used to buy. Tick it if the customer needs to download on a different device.</p>
<button type="submit" class="pill pill-gold" data-confirm="Authorise ONE replacement download and email the new link? The old link stops working.">Authorise replacement download</button></form>` : ''}
<form method="post" action="/admin/orders/${order.id}/note" class="admin-form">${hidden(csrf)}
<div class="field"><label for="o-note">Add a private note</label><textarea id="o-note" name="note" rows="3" maxlength="1000"></textarea></div>
<button type="submit" class="pill">Save note</button></form>
</section>
${emails.length ? html`<section class="panel" aria-labelledby="o-emails"><h2 id="o-emails">Emails</h2>
<ul class="todo">${emails.map((e) => html`<li>${{ customer_confirmation: 'Confirmation to customer', admin_notification: 'Notification to you', customer_reminder: 'Reminder to customer', admin_attention: 'Attention notice to you', customer_download: 'Download link to customer', admin_notification_2: 'Notification to the second address', admin_attention_2: 'Attention notice to the second address' }[e.kind] || (e.kind.includes('reissue') ? 'Replacement download link to customer' : e.kind.startsWith('download_complete_') ? 'Download Transfer Confirmation to customer' : e.kind.includes('resend') ? 'Confirmation sent again' : e.kind)}: ${{ sent: 'sent', failed: 'NOT sent (failed)', not_configured: 'NOT sent (email not set up yet)', sending: 'sending', skipped: 'not sent (you dealt with it personally)' }[e.status] || e.status}, ${friendlyDateTime(e.created_at)}</li>`)}</ul></section>` : ''}`
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
