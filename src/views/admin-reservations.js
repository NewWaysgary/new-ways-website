// Admin › Events › an event › Reservations: tickets reserved for customers until they pay, the event's places in
// full (allocated before the website, paid, reserved, being paid for, still available), and every change recorded.
import { html, raw, formatText } from '../lib/html.js';
import { adminPage } from './admin.js';
import { longDate, friendlyDateTime } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { money } from '../notify.js';
import { testBanner } from './admin-orders.js';
import { RESERVE_KINDS, RESERVE_PAY, reservePayLabel, MAX_RESERVE, methodLabel } from '../events/model.js';
import { qrSvg } from '../lib/qr.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const eventLine = (e) => `${longDate(e.date, '0000')}${e.start_time ? ', ' + friendlyTime(e.start_time) : e.time_text ? ', ' + e.time_text : ''}`;
const kindLabel = (k) => ({ new: 'New reservation', previous: 'Allocated before the website', override: 'Admin Override (additional places)' }[k] || k);
const ukInput = (iso) => {
  if (!iso) return { date: '', time: '' };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
};

export function reservationState(b, now = Date.now()) {
  if (b.status === 'held') return b.reserve_deadline && Date.parse(b.reserve_deadline) <= now ? ['attention', 'DEADLINE PASSED (STILL RESERVED)', 'outstanding'] : ['soon', 'RESERVED, NOT PAID YET', 'outstanding'];
  if (b.status === 'confirmed') return ['live', b.payment_status === 'paid' ? 'PAID' : 'BOOKED', 'paid'];
  if (b.status === 'needs_attention') return ['attention', 'NEEDS ATTENTION', 'outstanding'];
  if (b.status === 'cancelled') return ['past', 'CANCELLED', 'cancelled'];
  return ['past', b.reserve_closed === 'expired' ? 'RELEASED AT THE DEADLINE' : 'RELEASED TO PUBLIC SALE', 'released'];
}
const stateChip = (b) => { const [k, t] = reservationState(b); return html`<span class="chip chip-${k}">${t}</span>`; };

// The event's places, every kind shown separately
export function placesPanel(event, counts, state) {
  const capacity = Number(event.capacity) || 0;
  const available = capacity > 0 ? Math.max(0, capacity - counts.taken) : null;
  const publicNow = state === 'open' ? available : 0;
  const rows = [
    ['Maximum (total places)', capacity > 0 ? capacity : (event.sales_mode === 'online' ? 0 : 'No maximum set')],
    ['Allocated before the website (not on the website’s guest list)', counts.legacy],
    ['Booked on the website (on the guest list)', counts.confirmed],
    ['Reserved for customers, not paid yet', counts.reserved],
    ['Being paid for online right now (15-minute holds)', counts.paying],
    ['Still available', available === null ? '–' : available]
  ];
  return html`<section class="panel" aria-labelledby="pl-title"><h2 id="pl-title">Places</h2>
<table class="alloc-table"><tbody>${rows.map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}</tbody></table>
<p class="hint">${event.sales_mode === 'online'
    ? (state === 'sold_out' ? html`The public sees <strong>SOLD OUT</strong>${Number(event.sold_out) === 1 ? ' (the SOLD OUT switch is on: it stays on until you switch it off on the event’s page)' : ''}, so the public can buy 0 places now.` : state === 'open' ? html`The public can buy up to <strong>${publicNow}</strong> ${publicNow === 1 ? 'place' : 'places'} now.` : 'Online tickets are not on sale to the public just now.')
    : 'This event’s tickets are not sold on the website.'} Reservations are never blocked by SOLD OUT.</p></section>`;
}

export function reservationsPage({ event, counts, state, list, log, csrf, flash, mode, allocValues = {}, allocError = '' }) {
  const groups = { outstanding: [], paid: [], released: [], cancelled: [] };
  for (const b of list) groups[reservationState(b)[2]].push(b);
  const FLASH = { allocations: 'Saved. The places are updated.', released: 'Reservation released to public sale.', cancelled: 'Reservation cancelled.' };
  const row = (b) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${b.purchaser_name || 'Customer'} · ${b.quantity} ${b.quantity === 1 ? 'ticket' : 'tickets'} · ${money(b.total_pence)}</span>
<span class="row-line">${b.reference} · ${kindLabel(b.reservation_kind)} · ${reservePayLabel(b.reserve_pay)}</span>
<span class="row-line">${b.status === 'held' ? `Pay by ${friendlyDateTime(b.reserve_deadline)}${b.reserve_auto_release ? ' (released automatically then)' : ' (released only when you choose)'}` : b.paid_at ? `Paid ${friendlyDateTime(b.paid_at)} (${methodLabel(b.payment_method)})` : ''}${b.reserve_details_at ? ' · names given' : b.status === 'held' ? ' · names not given yet' : ''}</span>
<span class="chips">${stateChip(b)}</span></div>
<div class="row-actions"><a class="pill pill-gold" href="/admin/events/${event.id}/reservations/${b.id}">Open</a></div></li>`;
  const section = (title, items, empty) => html`<section class="panel"><h2>${title} (${items.length})</h2>${items.length ? html`<ul class="rows">${items.map(row)}</ul>` : html`<p class="hint">${empty}</p>`}</section>`;
  return adminPage({
    title: 'Reservations', csrf, signedIn: true,
    body: html`${testBanner(mode)}<p><a class="link" href="/admin/events/${event.id}/manage">Back to this event</a></p>
<p class="hint">${event.name}, ${eventLine(event)}. ${event.price_pence ? money(event.price_pence) + ' per ticket.' : ''}</p>
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
${placesPanel(event, counts, state)}
<p><a class="btn-gold btn-link" href="/admin/events/${event.id}/reservations/new">Reserve tickets</a></p>
${section('Outstanding (not paid yet)', groups.outstanding, 'No reservations are waiting for payment.')}
${section('Paid', groups.paid, 'No reservations have been paid yet.')}
${section('Released', groups.released, 'None.')}
${section('Cancelled', groups.cancelled, 'None.')}
${allocationsForm(event, counts, csrf, allocValues, allocError)}
<section class="panel" aria-labelledby="al-hist"><h2 id="al-hist">Record of changes to places</h2>
${log.length ? html`<ul class="todo history">${log.map((l) => html`<li>${friendlyDateTime(l.created_at)}: ${ALLOC_TEXT[l.action] || l.action}${l.places ? ` (${l.places})` : ''}${l.capacity_before !== l.capacity_after ? ` · maximum ${l.capacity_before} → ${l.capacity_after}` : ''}${l.legacy_before !== l.legacy_after ? ` · allocated before the website ${l.legacy_before} → ${l.legacy_after}` : ''}${l.reason ? ` · ${l.reason}` : ''}${l.done_by ? ` (${l.done_by})` : ''}</li>`)}</ul>` : html`<p class="hint">Nothing yet.</p>`}
</section>`
  });
}

const ALLOC_TEXT = { allocations: 'Places allocated before the website recorded', reserve_new: 'Reserved (new places)', reserve_previous: 'Reserved from places allocated before the website',
  reserve_override: 'Admin Override: places added and reserved', reservation_released: 'Reservation released to public sale', reservation_cancelled: 'Reservation cancelled', reservation_expired: 'Reservation released at its deadline' };

function allocationsForm(event, counts, csrf, values = {}, error = '') {
  return html`<form method="post" action="/admin/events/${event.id}/reservations/allocations" class="panel admin-form" id="allocations">${hidden(csrf)}
<h2>Places allocated before the website</h2>
<p class="hint">For tickets given out before online booking was used (paper lists, an old Square link, word of mouth). They count towards the maximum, so the website never sells them again, but they are not on the website’s guest list. Record the event’s real maximum and how many of those places were allocated outside the website. When one of those customers is ready to pay through the website, use Reserve tickets › “Places allocated before the website”: the places move into the reservation and are never counted twice.</p>
${error ? html`<p class="banner banner-error" role="alert">${error}</p>` : ''}
<div class="field"><label for="al-cap">Maximum number of places (total)</label><input id="al-cap" name="capacity" type="number" inputmode="numeric" min="0" max="5000" value="${values.capacity ?? event.capacity}"></div>
<div class="field"><label for="al-legacy">Places allocated before the website, not yet on the website</label><input id="al-legacy" name="legacy" type="number" inputmode="numeric" min="0" max="5000" value="${values.legacy ?? counts.legacy}">
<p class="hint">Now on the website: ${counts.confirmed} booked, ${counts.reserved} reserved, ${counts.paying} being paid for.</p></div>
<div class="field"><label for="al-reason">Reason (kept in the records)</label><input id="al-reason" name="reason" type="text" maxlength="300" value="${values.reason || ''}" required></div>
<p class="form-actions"><button class="pill pill-gold" type="submit" data-confirm="Save these figures for ${event.name}?">Save these figures</button></p>
</form>`;
}
export { allocationsForm };

export function newReservationPage({ event, counts, state, csrf, values = {}, errors = {}, notice = '' }) {
  const v = (k, d = '') => String(values[k] ?? d);
  const err = (k) => (errors[k] ? html`<p class="error">${errors[k]}</p>` : '');
  const kind = v('kind', counts.legacy > 0 ? 'previous' : 'new');
  return adminPage({
    title: 'Reserve tickets', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/events/${event.id}/reservations">Back to reservations</a></p>
<p class="hint">${event.name}, ${eventLine(event)}. The tickets are taken out of public sale as soon as you press Reserve. ${event.price_pence ? `${money(event.price_pence)} per ticket.` : ''}</p>
${placesPanel(event, counts, state)}
${notice ? html`<p class="banner banner-error" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not reserved yet. Please check the highlighted details.</p>` : ''}
<form method="post" action="/admin/events/${event.id}/reservations/new" class="panel admin-form" novalidate>${hidden(csrf)}
<fieldset class="field${errors.kind ? ' has-error' : ''}"><legend>What kind of reservation is this?</legend>
${RESERVE_KINDS.map(([k, l]) => html`<label class="field-check"><input type="radio" name="kind" value="${k}"${kind === k ? raw(' checked') : ''}> ${l}</label>`)}
<p class="hint">Allocated before the website: ${counts.legacy} ${counts.legacy === 1 ? 'place' : 'places'} recorded (see Places allocated before the website). Admin Override raises the maximum by exactly the number reserved; it is recorded with your reason, and if the reservation is released or cancelled those extra places are taken off again.</p>${err('kind')}</fieldset>
<div class="field${errors.qty ? ' has-error' : ''}"><label for="r-qty">Number of tickets</label><input id="r-qty" name="qty" type="number" inputmode="numeric" min="1" max="${MAX_RESERVE}" value="${v('qty', '1')}" required>${err('qty')}</div>
<div class="field${errors.name ? ' has-error' : ''}"><label for="r-name">Reserved for (name)</label><input id="r-name" name="name" type="text" maxlength="80" value="${v('name')}" autocomplete="off" required>${err('name')}</div>
<div class="field${errors.email ? ' has-error' : ''}"><label for="r-email">Their email address (optional)</label><input id="r-email" name="email" type="email" maxlength="254" value="${v('email')}" autocomplete="off" autocapitalize="none" spellcheck="false">${err('email')}</div>
<div class="field${errors.phone ? ' has-error' : ''}"><label for="r-phone">Their phone number (optional)</label><input id="r-phone" name="phone" type="tel" maxlength="24" value="${v('phone')}" autocomplete="off">${err('phone')}</div>
${payFields(values, errors)}
<div class="field${errors.reason ? ' has-error' : ''}"><label for="r-reason">Reason (required for “allocated before the website” and Admin Override)</label><input id="r-reason" name="reason" type="text" maxlength="500" value="${v('reason')}">${err('reason')}</div>
<div class="field"><label for="r-note">Private note (optional)</label><textarea id="r-note" name="note" rows="2" maxlength="1000">${v('note')}</textarea></div>
<div class="field field-check${errors.send ? ' has-error' : ''}"><label><input type="checkbox" name="send" value="1"${v('send') === '1' ? raw(' checked') : ''}> Email the private link to them now (needs their email address)</label>${err('send')}</div>
<p class="form-actions"><button class="btn-gold" type="submit">Reserve these tickets</button></p>
</form>`
  });
}

function payFields(values, errors, current = null) {
  const v = (k, d = '') => String(values[k] ?? d);
  const dl = current ? ukInput(current.reserve_deadline) : { date: '', time: '18:00' };
  const pay = v('pay', current ? current.reserve_pay : 'square_online');
  const auto = values.auto_release !== undefined ? values.auto_release === '1' : current ? !!current.reserve_auto_release : false;
  return html`<div class="field${errors.pay ? ' has-error' : ''}"><label for="r-pay">How will they pay?</label><select id="r-pay" name="pay">${RESERVE_PAY.map(([k, l]) => html`<option value="${k}"${pay === k ? raw(' selected') : ''}>${l}</option>`)}</select>
<p class="hint">Square online: they use the private link to give every guest’s name (and meals or other choices) and pay. Cash or card in person: they can still use the link to give the names; the tickets are issued only when you press “Payment received”.</p>${errors.pay ? html`<p class="error">${errors.pay}</p>` : ''}</div>
<fieldset class="field${errors.deadline ? ' has-error' : ''}"><legend>Payment deadline (UK time)</legend>
<div class="time-pair"><div class="field"><label for="r-date">Date</label><input id="r-date" name="deadline_date" type="date" value="${v('deadline_date', dl.date)}"></div>
<div class="field"><label for="r-time">Time</label><input id="r-time" name="deadline_time" type="time" value="${v('deadline_time', dl.time)}"></div></div>
${errors.deadline ? html`<p class="error">${errors.deadline}</p>` : ''}
<label class="field-check"><input type="checkbox" name="auto_release" value="1"${auto ? raw(' checked') : ''}> Release the tickets automatically if not paid by the deadline</label>
<p class="hint">Unticked: after the deadline the private link stops working, but the tickets stay reserved until you release them or change the deadline.</p></fieldset>`;
}

export function reservationPage({ event, b, link, csrf, flash, mode, emails, values = {}, errors = {}, problem = '' }) {
  const [, , group] = reservationState(b);
  const open = b.status === 'held';
  const FLASH = {
    made: 'Tickets reserved. They are out of public sale now. Share the private link or QR code below.', 'made-sent': 'Tickets reserved, and the private link has been emailed.',
    'made-not-sent': 'Tickets reserved, but the email could not be sent. Share the link below instead.', saved: 'Saved.', link: 'New private link made. The previous link no longer works.',
    sent: 'Private link emailed.', 'send-failed': 'The email could not be sent. Please check the email settings, or share the link yourself.',
    paid: 'Payment recorded. The tickets are confirmed and on the guest list.', 'paid-sent': 'Payment recorded. The tickets are confirmed, and the confirmation email with the QR code has been sent.',
    'already-paid': 'This reservation had just been paid online through Square, so it is now confirmed. Nothing else was changed.',
    released: 'Reservation released to public sale. The private link no longer works.', cancelled: 'Reservation cancelled. The private link no longer works.'
  };
  const act = (a, label, cls, confirm, extra = '') => html`<form method="post" action="/admin/events/${event.id}/reservations/${b.id}/${a}">${hidden(csrf)}${raw(extra)}<button type="submit" class="${cls}" data-confirm="${confirm}">${label}</button></form>`;
  const placeholders = b.guests.filter((g) => /^Guest \d+$/.test(g.name)).length;
  return adminPage({
    title: 'Reservation', csrf, signedIn: true,
    body: html`${testBanner(mode)}<p><a class="link" href="/admin/events/${event.id}/reservations">Back to reservations</a></p>
${FLASH[flash] ? html`<p class="banner ${/failed|not-sent/.test(flash) ? 'banner-error' : 'banner-ok'}" role="status">${FLASH[flash]}</p>` : ''}
${problem ? html`<p class="banner banner-error" role="alert">${problem}</p>` : ''}
<section class="panel" aria-labelledby="rs-status"><h2 id="rs-status">${stateChip(b)}</h2>
${b.note ? html`<div class="note-box">${formatText(b.note)}</div>` : ''}
<dl class="detail-list">
<div><dt>Reference</dt><dd>${b.reference}</dd></div>
<div><dt>Event</dt><dd>${event.name}, ${eventLine(event)}</dd></div>
<div><dt>Reserved for</dt><dd>${b.purchaser_name || '—'}${b.purchaser_email ? ` · ${b.purchaser_email}` : ''}${b.purchaser_phone ? ` · ${b.purchaser_phone}` : ''}</dd></div>
<div><dt>Tickets</dt><dd>${b.quantity} (${money(b.total_pence)})</dd></div>
<div><dt>Kind</dt><dd>${kindLabel(b.reservation_kind)}${b.reserve_capacity_added ? ` (${b.reserve_capacity_added} ${b.reserve_capacity_added === 1 ? 'place' : 'places'} added to the maximum${b.reserve_capacity_returned ? ', since taken off again' : ''})` : ''}</dd></div>
${b.reserve_reason ? html`<div><dt>Reason</dt><dd>${b.reserve_reason}</dd></div>` : ''}
<div><dt>Payment</dt><dd>${b.status === 'confirmed' ? `Paid (${methodLabel(b.payment_method)})${b.paid_at ? ', ' + friendlyDateTime(b.paid_at) : ''}` : reservePayLabel(b.reserve_pay)}</dd></div>
${b.reserve_deadline ? html`<div><dt>Payment deadline</dt><dd>${friendlyDateTime(b.reserve_deadline)} (${b.reserve_auto_release ? 'released automatically if not paid' : 'released only when you choose'})</dd></div>` : ''}
<div><dt>Guest names</dt><dd>${b.reserve_details_at ? `Given by the customer ${friendlyDateTime(b.reserve_details_at)}` : placeholders ? 'Not given yet' : 'Given'}</dd></div>
<div><dt>Made</dt><dd>${friendlyDateTime(b.created_at)}${b.reserve_by ? ` by ${b.reserve_by}` : ''}</dd></div>
${b.square_order_id ? html`<div><dt>Square order</dt><dd>${b.square_order_id}</dd></div>` : ''}${b.square_payment_id ? html`<div><dt>Square payment</dt><dd>${b.square_payment_id}</dd></div>` : ''}
</dl>
<p><a class="pill" href="/admin/events/${event.id}/bookings/${b.id}">Guests, answers and emails (booking page)</a></p>
</section>
${open && link ? html`<section class="panel" aria-labelledby="rs-link"><h2 id="rs-link">Private link</h2>
${Date.parse(b.reserve_deadline) <= Date.now() ? html`<p class="banner banner-error" role="alert">The payment deadline has passed, so this link doesn’t work now. Change the deadline below to open it again, or release the tickets.</p>` : ''}
<p class="hint">Only for this customer: it opens the normal booking form on the New Way’s website for exactly these ${b.quantity} ${b.quantity === 1 ? 'ticket' : 'tickets'}${b.reserve_pay === 'square_online' ? ', then Square’s secure checkout' : ''}. It can be completed once; it stops working if the reservation is released, cancelled or given a new link.</p>
<p class="copy-link">${link}</p>
<div class="reserve-qr">${raw(qrSvg(link, { label: 'QR code for the private reservation link' }))}</div>
<div class="row-actions">
<button type="button" class="pill pill-gold" data-copy="${link}">Copy link</button>
<button type="button" class="pill pill-gold" data-share-url="${link}" data-share-title="Your reserved tickets: ${event.name}" hidden>Share…</button>
<a class="pill" href="/admin/events/${event.id}/reservations/${b.id}/qr.png" download="reservation-${b.reference}.png">Download the QR code</a>
${b.purchaser_email ? act('email', 'Email the link to ' + b.purchaser_email, 'pill', `Email the private link to ${b.purchaser_email}?`) : ''}
${act('link', 'Make a new link (the old one stops working)', 'pill', 'Make a new private link? The current link and QR code will stop working at once.')}
</div></section>` : ''}
${open ? html`<section class="panel" aria-labelledby="rs-pay"><h2 id="rs-pay">Payment received in person</h2>
<p class="hint">Only once you have the money. The tickets are then confirmed, the guests are on the guest list, and the QR code works at the door.${placeholders ? ` ${placeholders} guest ${placeholders === 1 ? 'name is' : 'names are'} not given yet (shown as Guest 1, Guest 2…): you can add them on the booking page afterwards.` : ''}</p>
<form method="post" action="/admin/events/${event.id}/reservations/${b.id}/paid" class="admin-form">${hidden(csrf)}
<div class="field"><label for="rp-method">Paid by</label><select id="rp-method" name="method"><option value="cash"${b.reserve_pay === 'cash' ? raw(' selected') : ''}>Cash</option><option value="card"${b.reserve_pay !== 'cash' ? raw(' selected') : ''}>Card in person</option></select></div>
<label class="field-check"><input type="checkbox" name="send" value="1"${b.purchaser_email ? raw(' checked') : raw(' disabled')}> Email the confirmation and QR code${b.purchaser_email ? ` to ${b.purchaser_email}` : ' (no email address given)'}</label>
<p class="form-actions"><button type="submit" class="btn-gold" data-confirm="Confirm that ${money(b.total_pence)} has been received for ${b.quantity} ${b.quantity === 1 ? 'ticket' : 'tickets'}?">Payment received: issue the tickets</button></p>
</form></section>
<form method="post" action="/admin/events/${event.id}/reservations/${b.id}/update" class="panel admin-form" novalidate>${hidden(csrf)}
<h2>Deadline and payment</h2>
${payFields(values, errors, b)}
<p class="form-actions"><button type="submit" class="pill pill-gold">Save</button></p>
</form>
<section class="panel" aria-labelledby="rs-end"><h2 id="rs-end">Release or cancel</h2>
<p class="hint">Both stop the private link at once and free the places.${b.reserve_capacity_added && !b.reserve_capacity_returned ? ` The ${b.reserve_capacity_added} extra places added for this reservation are taken off the maximum again.` : ''} Released places go back on public sale only if the event is not switched to SOLD OUT.</p>
<div class="row-actions">
${act('release', 'Release to public sale', 'pill pill-gold', 'Release these tickets? The private link will stop working.')}
${act('cancel', 'Cancel this reservation', 'pill pill-danger', 'Cancel this reservation? The private link will stop working.')}
</div></section>` : ''}
${group === 'paid' ? html`<p class="hint">Paid reservations are ordinary bookings now: use the booking page for names, emails and check-in.</p>` : ''}
${emails.length ? html`<section class="panel"><h2>Emails</h2><ul class="todo">${emails.map((e) => html`<li>${e.kind.startsWith('reservation_link') ? 'Private link to customer' : e.kind === 'customer_confirmation' ? 'Confirmation to customer' : e.kind}: ${e.status}, ${friendlyDateTime(e.created_at)}</li>`)}</ul></section>` : ''}`
  });
}
