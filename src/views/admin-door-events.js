// Wednesday till › ADD EVENT BOOKING screens: choose the event, the number of tickets, the details, then payment.
// Big touch buttons in the till's navy and gold. Every screen has "Back to the till".
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { pounds } from '../wednesday/model.js';
import { eventWhen } from '../events/model.js';
import { bookingFields } from './tickets.js';

const TILL_CSS = '/css/till.css?v=2';
const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const tillPage = (title, body, csrf) => adminPage({ title, csrf, signedIn: true, body: html`<link rel="stylesheet" href="${TILL_CSS}">${body}` });
const backToTill = (date) => html`<p class="tev-back"><a class="pill" href="/admin/door?date=${date}">‹ Back to the till</a></p>`;
const steps = (n) => html`<ol class="tev-steps" aria-label="Steps">${['Event', 'Tickets', 'Details', 'Payment'].map((s, i) => html`<li${i + 1 === n ? raw(' aria-current="step" class="is-now"') : i + 1 < n ? raw(' class="is-done"') : ''}>${s}</li>`)}</ol>`;
const placesText = (st) => (st.left === null ? 'No limit set' : `${st.left} ${st.left === 1 ? 'place' : 'places'} left`);
const eventHead = (event, st) => html`<section class="panel tev-event"><h2>${event.name}</h2><p>${eventWhen(event)}</p>
<p><strong>${pounds(event.price_pence)}</strong> a ticket · ${placesText(st)}</p></section>`;

// 1. the upcoming events
export function eventListPage({ date, events, csrf }) {
  return tillPage('Add event booking', html`${backToTill(date)}${steps(1)}
<h1 class="tev-title">Which event?</h1>
${events.length ? html`<ul class="tev-list">${events.map((e) => html`<li>${e.till.ok
    ? html`<a class="tev-pick" href="/admin/door/events/${e.id}?date=${date}"><span class="tev-name">${e.name}</span><span class="tev-when">${eventWhen(e)}</span>
<span class="tev-meta"><strong>${pounds(e.price_pence)}</strong> a ticket · ${placesText(e.till)}${e.visible ? '' : ' · not on the website'}</span></a>`
    : html`<div class="tev-pick is-off" aria-disabled="true"><span class="tev-name">${e.name}</span><span class="tev-when">${eventWhen(e)}</span>
<span class="tev-meta"><span class="chip ${e.till.why === 'SOLD OUT' ? 'chip-attention' : 'chip-past'}">${e.till.why}</span>${e.price_pence > 0 ? html` · ${pounds(e.price_pence)}` : ''}</span></div>`}</li>`)}</ul>`
    : html`<p class="panel">There are no upcoming events.</p>`}
<p class="hint">Complimentary or reduced-price tickets are added in Admin › Events › the event › Add a booking.</p>`, csrf);
}

// 2. how many tickets
export function ticketsPage({ date, event, state, csrf }) {
  if (!state.ok) {
    return tillPage('Add event booking', html`${backToTill(date)}${steps(2)}${eventHead(event, state)}
<p class="big-state is-bad" role="alert">${state.why === 'SOLD OUT' ? 'SOLD OUT' : 'CAN’T BE BOOKED AT THE TILL'}</p>
<p><a class="pill pill-gold" href="/admin/door/events?date=${date}">Choose another event</a></p>`, csrf);
  }
  const quick = Array.from({ length: Math.min(state.max, 8) }, (_, i) => i + 1);
  return tillPage('Add event booking', html`${backToTill(date)}${steps(2)}${eventHead(event, state)}
<h1 class="tev-title">How many tickets?</h1>
<div class="tev-qty">${quick.map((n) => html`<a class="tev-qty-btn" href="/admin/door/events/${event.id}/details?date=${date}&amp;qty=${n}"><span>${n}</span><small>${pounds(event.price_pence * n)}</small></a>`)}</div>
${state.max > 8 ? html`<form method="get" action="/admin/door/events/${event.id}/details" class="panel admin-form tev-more"><input type="hidden" name="date" value="${date}">
<div class="field"><label for="tev-qty">More tickets</label><select id="tev-qty" name="qty">${Array.from({ length: state.max - 8 }, (_, i) => i + 9).map((n) => html`<option value="${n}">${n} (${pounds(event.price_pence * n)})</option>`)}</select></div>
<button class="btn-gold" type="submit">Continue</button></form>` : ''}
<p><a class="link" href="/admin/door/events?date=${date}">Choose a different event</a></p>`, csrf);
}

// 3. the customer's and guests' details
export function detailsPage({ date, event, qty, questions, state, fields = {}, errors = {}, notice = '', csrf }) {
  const v = (k) => String(fields[k] ?? '');
  return tillPage('Add event booking', html`${backToTill(date)}${steps(3)}${eventHead(event, state)}
${notice ? html`<p class="banner banner-error" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Please check the highlighted details.</p>` : ''}
<p class="tev-sum"><strong>${qty} ${qty === 1 ? 'ticket' : 'tickets'}</strong> · <strong>${pounds(event.price_pence * qty)}</strong> <a class="link" href="/admin/door/events/${event.id}?date=${date}">Change</a></p>
<form method="post" action="/admin/door/events/${event.id}/details" class="admin-form share-form tev-form" novalidate>${hidden(csrf)}
<input type="hidden" name="date" value="${date}"><input type="hidden" name="qty" value="${qty}">
<fieldset class="guest-block"><legend>The customer</legend>
<div class="form-field${errors.p_name ? ' has-error' : ''}"><label for="p-name">Customer’s name</label><input id="p-name" name="p_name" type="text" maxlength="80" autocomplete="off" value="${v('p_name')}" required>${errors.p_name ? html`<p class="field-error">${errors.p_name}</p>` : ''}</div>
<div class="form-field${errors.p_email ? ' has-error' : ''}"><label for="p-email">Email address (for the confirmation and QR code)</label><input id="p-email" name="p_email" type="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="254" autocomplete="off" value="${v('p_email')}" required>${errors.p_email ? html`<p class="field-error">${errors.p_email}</p>` : ''}</div>
<div class="form-field${errors.p_phone ? ' has-error' : ''}"><label for="p-phone">Phone number (optional)</label><input id="p-phone" name="p_phone" type="tel" inputmode="tel" maxlength="24" autocomplete="off" value="${v('p_phone')}">${errors.p_phone ? html`<p class="field-error">${errors.p_phone}</p>` : ''}</div>
<div class="form-field form-check"><label><input type="checkbox" name="marketing" value="1"${v('marketing') === '1' ? raw(' checked') : ''}> The customer asked to join the mailing list</label></div>
</fieldset>
${raw(String(guestOnly(bookingFields({ qty, questions, fields, errors, admin: true }))))}
${errors.duplicate ? html`<div class="field field-check has-error"><p class="error">${errors.duplicate}</p><label><input type="checkbox" name="dup_ok" value="1"> Yes, this is a separate, additional booking</label></div>`
    : v('dup_ok') === '1' ? html`<input type="hidden" name="dup_ok" value="1">` : ''}
<p class="form-actions"><button class="btn-gold tev-go" type="submit">Continue to payment</button></p>
</form>`, csrf);
}
// The shared booking form ends with its own contact details block; on the till, the customer comes first instead.
const guestOnly = (h) => String(h).replace(/<fieldset class="guest-block">\s*<legend>Contact details \(if known\)<\/legend>[\s\S]*?<\/fieldset>\s*$/, '');

// 4. payment
export function payPage({ date, event, values, dupOk, clientRef, pos, notice = '', csrf }) {
  const total = pounds(event.price_pence * values.qty);
  const carry = html`${hidden(csrf)}<input type="hidden" name="date" value="${date}"><input type="hidden" name="client_ref" value="${clientRef}">${dupOk ? html`<input type="hidden" name="dup_ok" value="1">` : ''}
${carryFields(values).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}`;
  const action = `/admin/door/events/${event.id}/pay`;
  return tillPage('Add event booking', html`${backToTill(date)}${steps(4)}
${notice ? html`<p class="banner banner-error" role="alert">${notice}</p>` : ''}
<section class="panel tev-review" aria-labelledby="tev-r"><h2 id="tev-r">${event.name}</h2><p>${eventWhen(event)}</p>
<dl class="detail-list">
<div><dt>Customer</dt><dd>${values.purchaser.name}<br>${values.purchaser.email}${values.purchaser.phone ? html`<br>${values.purchaser.phone}` : ''}</dd></div>
<div><dt>${values.qty === 1 ? 'Guest' : `Guests (${values.qty})`}</dt><dd>${values.guests.map((g) => html`${g.name}${g.answers.filter((a) => a.value).length ? html` <span class="hint">(${g.answers.filter((a) => a.value).map((a) => a.value).join(', ')})</span>` : ''}<br>`)}</dd></div>
${values.answers.filter((a) => a.value).map((a) => html`<div><dt>${a.question_label}</dt><dd>${a.value}</dd></div>`)}
</dl>
<p class="till-grand">TO PAY <strong>${total}</strong></p>
<p class="hint">${values.qty} × ${pounds(event.price_pence)}. Nothing is booked until the payment below is confirmed.</p></section>

<section class="panel tev-pay" aria-labelledby="tev-cash"><h2 id="tev-cash">Cash</h2>
<form method="post" action="${action}">${carry}<input type="hidden" name="pay" value="cash">
<label class="field-check tev-tick"><input type="checkbox" name="cash_ok" value="1" required> I have taken <strong>${total}</strong> in cash</label>
<button class="till-method till-cash" type="submit">CASH RECEIVED: COMPLETE BOOKING</button></form></section>

<section class="panel tev-pay" aria-labelledby="tev-card"><h2 id="tev-card">Card</h2>
${pos.app ? html`<form method="post" action="${action}">${carry}<input type="hidden" name="pay" value="card_app">
<p class="hint">The places are held, then the Square app opens for exactly ${total}. The booking is completed only when Square confirms the payment.</p>
<button class="till-method till-card" type="submit">CARD: PAY IN THE SQUARE APP</button></form>`
    : html`<form method="post" action="${action}">${carry}<input type="hidden" name="pay" value="card">
<p class="hint">Take <strong>${total}</strong> on the card reader first. Only when it shows the payment APPROVED, tick and press the button.</p>
<label class="field-check tev-tick"><input type="checkbox" name="card_ok" value="1" required> The card reader shows <strong>${total}</strong> APPROVED</label>
<button class="till-method till-card" type="submit">CARD PAYMENT TAKEN ✓: COMPLETE BOOKING</button></form>`}
</section>
<p class="hint">The customer is emailed their confirmation with the QR ${values.qty === 1 ? 'code' : 'codes'} as soon as the booking is complete.</p>`, csrf);
}
function carryFields(values) {
  const out = [['qty', String(values.qty)], ['p_name', values.purchaser.name], ['p_email', values.purchaser.email], ['p_phone', values.purchaser.phone || '']];
  if (values.marketing) out.push(['marketing', '1']);
  for (const g of values.guests) {
    out.push([`g${g.position}_name`, g.name]);
    for (const a of g.answers) out.push([`g${g.position}_q${a.question_id}`, a.type === 'checkbox' ? (a.value ? '1' : '') : a.option_id ? String(a.option_id) : a.value]);
  }
  for (const a of values.answers) out.push([`b_q${a.question_id}`, a.type === 'checkbox' ? (a.value ? '1' : '') : a.option_id ? String(a.option_id) : a.value]);
  return out;
}

// The Square app step for a card booking (the places are held meanwhile)
export function squareStepPage({ r, row, pos, origin, csrf }) {
  const amount = pounds(r.total_pence);
  const link = pos.app ? 'intent:#Intent;action=com.squareup.pos.action.CHARGE;package=com.squareup;' +
    'S.com.squareup.pos.WEB_CALLBACK_URI=' + encodeURIComponent(origin + '/admin/door/square-callback') + ';' +
    'S.com.squareup.pos.CLIENT_ID=' + encodeURIComponent(pos.appId) + ';' +
    'S.com.squareup.pos.API_VERSION=v2.0;i.com.squareup.pos.TOTAL_AMOUNT=' + r.total_pence + ';' +
    'S.com.squareup.pos.CURRENCY_CODE=GBP;S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD;' +
    'S.com.squareup.pos.REQUEST_METADATA=' + r.ref + ';l.com.squareup.pos.AUTO_RETURN_TIMEOUT_MS=3200;' +
    (pos.locationId ? 'S.com.squareup.pos.LOCATION_ID=' + encodeURIComponent(pos.locationId) + ';' : '') +
    'S.com.squareup.pos.NOTE=' + encodeURIComponent(`New Way’s event booking ${row ? row.reference : ''}`.trim()) + ';end' : '';
  return tillPage('Card payment', html`${backToTill(r.night_date)}${steps(4)}
<p class="big-state is-done" role="status">TAKE ${amount} BY CARD</p>
<section class="panel"><p>${row ? html`Booking <strong>${row.reference}</strong>: ${row.qty} ${row.qty === 1 ? 'ticket' : 'tickets'}. ` : ''}The places are held while the card is taken.</p>
${link ? html`<p><a class="btn-gold btn-link till-pos" href="${link}">Open the Square app to take ${amount}</a></p>
<p class="hint">When Square confirms the payment, the booking is completed and the customer is emailed by itself. Nothing is booked if the payment is cancelled or declined.</p>`
    : html`<p class="banner banner-error" role="alert">The Square app can’t be opened from this device. Cancel below and use the card reader instead.</p>`}
<form method="post" action="/admin/door/event-card/cancel">${hidden(csrf)}<input type="hidden" name="ref" value="${r.ref}">
<button class="pill pill-danger" type="submit" data-confirm="Cancel this booking? Only do this if the card has NOT been taken.">Cancel: the card was not taken</button></form></section>`, csrf);
}
