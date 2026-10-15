// Admin › Private Readings › Gift Vouchers / Reservation Codes
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { longDate, friendlyDateTime, ukToday } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { money } from '../notify.js';
import { STATUS_LABEL, MAX_BATCH, expiryText } from '../bookings/vouchers.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const CHIP = { available: 'live', reserved: 'soon', redeemed: 'past', expired: 'attention', cancelled: 'hidden' };
export const statusChip = (st) => html`<span class="chip chip-${CHIP[st] || 'past'}">${(STATUS_LABEL[st] || st).toUpperCase()}</span>`;
const FILTERS = [['', 'All'], ['available', 'Available'], ['reserved', 'Reserved'], ['redeemed', 'Redeemed'], ['expired', 'Expired'], ['cancelled', 'Cancelled']];
const FLASH = {
  cancelled: 'Voucher cancelled. Its code can no longer be used.',
  reactivated: 'The voucher can be used again for one reading.',
  'not-allowed': 'That can’t be done for this voucher now.'
};

// The finished voucher picture: shown if it has been saved; otherwise the Admin phone draws it (the approved design with
// the code, expiry date and QR code) at the design's full size and saves it against the voucher (public/js/admin.js).
export function voucherPicture(v, render, { compact = false } = {}) {
  const saved = !!v.image_key;
  return html`<div class="voucher-render" data-voucher-render="${JSON.stringify(render)}" data-saved="${saved ? '1' : '0'}" data-voucher-id="${v.id}">
<div class="voucher-shot" data-voucher-shot>${saved ? html`<img src="/admin/readings/vouchers/${v.id}.png?v=${encodeURIComponent(v.image_made_at || '')}" alt="Gift voucher ${v.code}" width="1983" height="793">` : html`<p class="hint">Making the voucher picture…</p>`}</div>
<p class="hint" data-voucher-status role="status">${saved ? 'Saved with this voucher.' : 'The picture is made on this phone and then saved with the voucher. Please keep this page open for a moment.'}</p>
${compact ? '' : html`<button type="button" class="pill" data-voucher-remake>Make the picture again</button>`}
</div>`;
}

function voucherRow(v) {
  return html`<li class="row-card"><div class="row-text">
<span class="row-title">${v.code}</span>
<span class="row-line">${v.minutes} minute reading · value ${money(v.value_pence)}${v.expires_on ? ` · valid until ${longDate(v.expires_on, '0000')}` : ' · no expiry'}</span>
${v.note ? html`<span class="row-line">${v.note}</span>` : ''}
${v.customer_name ? html`<span class="row-line">Used by ${v.customer_name}${v.bk_date ? ` for ${longDate(v.bk_date, '0000')} at ${friendlyTime(v.bk_start)}` : ''}${v.bk_status === 'cancelled' ? ' (that booking was cancelled)' : ''}</span>` : ''}
<span class="chips">${statusChip(v.shown)}</span></div>
<div class="row-actions"><a class="pill pill-gold" href="/admin/readings/vouchers/${v.id}">Open</a></div></li>`;
}

export function vouchersPage({ rows, services, filters, csrf, values = {}, errors = {}, made = [], counts = {} }) {
  const v = (k, d = '') => String(values[k] ?? d);
  const err = (k) => (errors[k] ? html`<p class="error">${errors[k]}</p>` : '');
  return adminPage({
    title: 'Gift Vouchers / Reservation Codes', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/readings">Back to Private Readings</a></p>
<p class="hint">A voucher covers one private reading of the length shown, with no payment. The customer books on the Private Readings page in the normal way (same dates, times, break and rules as everyone else) and enters the code at the payment step.</p>
${made.length ? html`<section class="panel banner-ok" aria-labelledby="made-title" data-vouchers-made>
<h2 id="made-title">${made.length === 1 ? 'Voucher made' : `${made.length} vouchers made`}</h2>
<ul class="rows">${made.map((m) => html`<li class="row-card voucher-made"><div class="row-text"><span class="row-title">${m.code}</span><span class="row-line">${m.minutes} minute reading · ${money(m.value_pence)}${m.expires_on ? ` · expires ${expiryText(m)}` : ' · no expiry'}${m.note ? ' · ' + m.note : ''}</span></div>
${voucherPicture(m, m.render, { compact: true })}
<div class="row-actions"><button type="button" class="pill pill-gold" data-copy="${m.code}">Copy code</button><a class="pill pill-gold" href="/admin/readings/vouchers/${m.id}">Open</a><a class="pill" href="/admin/readings/vouchers/${m.id}.png?download=1" data-needs-picture>Download PNG</a><a class="pill" href="/admin/readings/vouchers/${m.id}.pdf" target="_blank" rel="noopener">PDF</a></div></li>`)}</ul>
${made.length > 1 ? html`<p><a class="btn-gold btn-link" href="/admin/readings/vouchers/print.pdf?ids=${made.map((m) => m.id).join(',')}" target="_blank" rel="noopener">All ${made.length} vouchers as one PDF (one per page)</a></p>` : ''}
</section>` : ''}
<form method="post" action="/admin/readings/vouchers" class="panel admin-form" id="make">${hidden(csrf)}
<h2>Make vouchers</h2>
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not made yet. Please check the highlighted details.</p>` : ''}
<div class="field${errors.service ? ' has-error' : ''}"><label for="vc-service">Reading</label><select id="vc-service" name="service">
${services.map((s) => html`<option value="${s.code}"${v('service') === s.code ? raw(' selected') : ''}>${s.name} (value ${money(s.price_pence)})</option>`)}</select>${err('service')}</div>
<div class="field${errors.count ? ' has-error' : ''}"><label for="vc-count">How many vouchers</label><input id="vc-count" name="count" type="number" inputmode="numeric" min="1" max="${MAX_BATCH}" value="${v('count', '1')}">
<p class="hint">Each has its own code and covers one reading.</p>${err('count')}</div>
<div class="field${errors.expires ? ' has-error' : ''}"><label for="vc-expires">Expiry date (optional)</label><input id="vc-expires" name="expires_on" type="date" value="${v('expires_on')}" min="${ukToday()}">
<p class="hint">The booking must be made by the end of this day. Leave empty for no expiry.</p>${err('expires')}</div>
<div class="field"><label for="vc-note">Note (optional)</label><input id="vc-note" name="note" type="text" maxlength="120" value="${v('note')}" list="vc-notes" placeholder="e.g. Raffle Prize">
<datalist id="vc-notes"><option value="Raffle Prize"><option value="Gift"><option value="Complimentary Reading"></datalist><p class="hint">Only seen in Admin.</p></div>
<p class="form-actions"><button class="btn-gold" type="submit">Generate Voucher</button></p>
</form>
<section class="panel" aria-labelledby="vc-list">
<h2 id="vc-list">Issued vouchers</h2>
<p class="hint">${['available', 'reserved', 'redeemed', 'expired', 'cancelled'].map((k) => `${STATUS_LABEL[k]} ${counts[k] || 0}`).join(' · ')}</p>
<form method="get" action="/admin/readings/vouchers" class="search-form-wrap">
<div class="search-form"><label class="sr-only" for="vc-q">Search</label><input id="vc-q" name="q" type="search" value="${filters.q}" placeholder="Code, note or customer" autocomplete="off"><button class="pill pill-gold" type="submit">Search</button></div>
<div class="field"><label for="vc-show">Show</label><select id="vc-show" name="show">${FILTERS.map(([k, l]) => html`<option value="${k}"${filters.show === k ? raw(' selected') : ''}>${l}</option>`)}</select></div>
<button class="pill" type="submit">Show</button></form>
${rows.length ? html`<ul class="rows">${rows.map(voucherRow)}</ul>` : html`<p>No vouchers match.</p>`}
</section>`
  });
}

export function voucherPage({ v, shown, order, booking, log, csrf, flash, link, render }) {
  const act = (a, label, cls, confirm) => html`<form method="post" action="/admin/readings/vouchers/${v.id}/${a}">${hidden(csrf)}<button type="submit" class="${cls}" data-confirm="${confirm}">${label}</button></form>`;
  const bookingCancelled = booking && ['cancelled', 'expired'].includes(booking.status);
  return adminPage({
    title: `Voucher ${v.code}`, csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/readings/vouchers">Back to Gift Vouchers</a></p>
${FLASH[flash] ? html`<p class="banner ${flash === 'not-allowed' ? 'banner-error' : 'banner-ok'}" role="status">${FLASH[flash]}</p>` : ''}
<section class="panel" aria-labelledby="v-status"><h2 id="v-status">${statusChip(shown)}</h2>
<dl class="detail-list">
<div><dt>Code</dt><dd><strong>${v.code}</strong> <button type="button" class="pill pill-gold" data-copy="${v.code}">Copy code</button></dd></div>
<div><dt>Reading</dt><dd>${v.minutes} minute private reading</dd></div>
<div><dt>Value</dt><dd>${money(v.value_pence)}</dd></div>
<div><dt>Expiry</dt><dd>${v.expires_on ? `Book by ${longDate(v.expires_on, '0000')}` : 'No expiry'}</dd></div>
${v.note ? html`<div><dt>Note</dt><dd>${v.note}</dd></div>` : ''}
<div><dt>Made</dt><dd>${friendlyDateTime(v.created_at)}${v.created_by ? ` by ${v.created_by}` : ''}</dd></div>
${shown === 'reserved' ? html`<div><dt>Reserved</dt><dd>Someone is confirming a booking with it now (until ${friendlyDateTime(v.reserved_until)}). If they don’t finish, it becomes available again.</dd></div>` : ''}
${v.cancelled_at ? html`<div><dt>Cancelled</dt><dd>${friendlyDateTime(v.cancelled_at)}${v.cancelled_by ? ` by ${v.cancelled_by}` : ''}</dd></div>` : ''}
</dl></section>
${order ? html`<section class="panel" aria-labelledby="v-used"><h2 id="v-used">Redeemed</h2>
<dl class="detail-list">
<div><dt>Customer</dt><dd>${order.customer_name || 'Details removed'}</dd></div>
${order.customer_email ? html`<div><dt>Email</dt><dd>${order.customer_email}</dd></div>` : ''}
${order.customer_phone ? html`<div><dt>Mobile (WhatsApp)</dt><dd>${order.customer_phone}</dd></div>` : ''}
${booking ? html`<div><dt>Appointment</dt><dd>${longDate(booking.date, '0000')} at ${friendlyTime(booking.local_start)} (UK time), ${booking.minutes} minutes${bookingCancelled ? ' (CANCELLED)' : ''}</dd></div>` : ''}
<div><dt>Redeemed</dt><dd>${v.redeemed_at ? friendlyDateTime(v.redeemed_at) : '—'}</dd></div>
<div><dt>Booking</dt><dd><a class="link" href="/admin/orders/${order.id}">${order.reference}</a></dd></div>
</dl></section>` : ''}
<section class="panel" aria-labelledby="v-print"><h2 id="v-print">The voucher</h2>
${voucherPicture(v, render)}
<div class="row-actions">
<a class="btn-gold btn-link" href="/admin/readings/vouchers/${v.id}.png?download=1" data-needs-picture>Download PNG</a>
<a class="pill pill-gold" href="/admin/readings/vouchers/${v.id}.pdf" target="_blank" rel="noopener">Open the PDF (print or save)</a>
<a class="pill pill-gold" href="/admin/readings/vouchers/${v.id}.pdf?download=1">Download PDF</a>
<button type="button" class="pill pill-gold" data-share-file="/admin/readings/vouchers/${v.id}.png" data-share-type="image/png" data-share-name="New-Ways-gift-voucher-${v.code}.png" data-share-title="New Way’s gift voucher" hidden>Send the picture…</button>
<button type="button" class="pill pill-gold" data-share-file="/admin/readings/vouchers/${v.id}.pdf" data-share-name="New-Ways-gift-voucher-${v.code}.pdf" data-share-title="New Way’s gift voucher" hidden>Send the PDF…</button>
</div>
<p class="hint wrap-any">The approved ${v.minutes} minute design with this voucher’s own code${v.expires_on ? `, the expiry date ${expiryText(v)}` : ' (no expiry date)'} and a QR code that opens ${link}. The PNG is 1983 × 793 pixels, the design’s own size. The PDF is A4 landscape for printing. To send it: Send the picture… or Send the PDF… (WhatsApp, email and so on).</p>
</section>
<section class="panel" aria-labelledby="v-actions"><h2 id="v-actions">Actions</h2>
<div class="row-actions">
${['available', 'reserved', 'expired'].includes(shown) ? act('cancel', 'Cancel this voucher', 'pill pill-danger', `Cancel voucher ${v.code}? Its code will no longer work.`) : ''}
${shown === 'cancelled' || (v.status === 'redeemed' && (!order || bookingCancelled)) ? act('reactivate', 'Make this code usable again', 'pill pill-gold', `Make ${v.code} usable again for one reading?`) : ''}
</div>
${v.status === 'redeemed' && order && !bookingCancelled ? html`<p class="hint">This voucher has been used. If the booking is cancelled, you can choose here whether to let the code be used again.</p>` : ''}
${v.status === 'redeemed' && bookingCancelled ? html`<p class="hint">The booking made with this voucher was cancelled. The code is NOT usable again unless you choose to make it usable again.</p>` : ''}
</section>
<section class="panel" aria-labelledby="v-hist"><h2 id="v-hist">History</h2>
${log.length ? html`<ul class="todo history">${log.map((l) => html`<li>${friendlyDateTime(l.created_at)}: ${l.what}${l.done_by ? ` (${l.done_by})` : ''}</li>`)}</ul>` : html`<p>No history yet.</p>`}
</section>`
  });
}
