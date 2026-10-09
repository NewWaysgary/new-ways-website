// Public screens for booking event tickets, the customer's booking page, the ticket (QR) page,
// and the mailing list (Join page, unsubscribe). Same cards, buttons and colours as Private Readings.
import { html, raw, formatText } from '../lib/html.js';
import { longDate } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { page } from './layout.js';
import { money } from '../notify.js';
import { testModeNotice } from './booking.js';
import { eventVenue, CHOICE_TYPES } from '../events/model.js';
import { CHECKOUT_CONSENT } from '../mailing.js';

const ukDateTime = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true })
  .format(new Date(iso)).replace(/ ([ap]m)$/, '$1').replace(' at ', ', ');
const ukClock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '').toLowerCase();

export const STATE_TEXT = {
  sold_out: 'SOLD OUT', closed: 'Online booking has closed', past: 'This event has finished',
  not_open: 'Tickets are not on sale yet', off: 'Tickets are not sold online for this event'
};

// The event at the top of each booking screen
export function eventSummary(event, settings, extra = []) {
  const { venue, address } = eventVenue(event, settings);
  const rows = [['Date', longDate(event.date)],
    ...(event.start_time ? [['Starts', friendlyTime(event.start_time) + ' (UK time)']] : event.time_text ? [['Time', event.time_text]] : []),
    ...(event.doors_time ? [['Doors open', friendlyTime(event.doors_time)]] : []),
    ...(venue ? [['Venue', venue]] : []), ...(address ? [['Address', address]] : []),
    ...(event.price_pence ? [['Price', money(event.price_pence) + ' per ticket']] : []), ...extra];
  return html`<section class="card-gold booking-card" aria-labelledby="ev-title">
<h2 class="book-title" id="ev-title">${event.name}</h2>
<dl class="wed-list summary-list">${rows.map(([k, v]) => html`<div class="wed-row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
</section>`;
}

const back = (event) => html`<p class="screen-sub"><a class="link-gold" href="/events">Events</a> <span aria-hidden="true">›</span> ${event.name}</p>`;

export function closedPage(ctx, { event, state, settings, opensAt }) {
  const body = html`${back(event)}${eventSummary(event, settings)}
<section class="card-blue order-state" aria-labelledby="st"><h2 class="card-title" id="st">${STATE_TEXT[state] || 'Not available'}</h2>
${state === 'not_open' && opensAt ? html`<p>Tickets go on sale ${ukDateTime(opensAt)} (UK time).</p>` : ''}
${state === 'sold_out' ? html`<p>All the places for this event have been taken.</p>` : ''}
<a class="btn-outline-gold press" href="/events">Back to Events</a></section>`;
  return page(ctx, { route: 'events', title: 'Tickets', body, mainClass: 'gap-26 booking-main', description: `Tickets for ${event.name}.` });
}

// Step 1: how many tickets
export function quantityPage(ctx, { event, settings, max, left, sandbox, notice = '' }) {
  const options = Array.from({ length: max }, (_, i) => i + 1);
  const body = html`${back(event)}${testModeNotice(sandbox)}
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}${eventSummary(event, settings)}
${event.summary ? html`<div class="prose">${formatText(event.summary)}</div>` : ''}
<section class="card-blue share-card" aria-labelledby="qty-title">
<h2 class="card-title" id="qty-title">How many tickets?</h2>
<form method="get" action="/events/${event.id}/book" class="share-form">
<div class="form-field"><label for="t-qty">Number of tickets</label>
<select id="t-qty" name="qty" class="qty-select">${options.map((n) => html`<option value="${n}">${n} ${n === 1 ? 'ticket' : 'tickets'}${event.price_pence ? ` (${money(event.price_pence * n)})` : ''}</option>`)}</select></div>
${left !== Infinity && left <= 10 ? html`<p class="small">Only ${left} ${left === 1 ? 'place' : 'places'} left.</p>` : ''}
<p class="small">On the next screen you add the name of each guest, so everyone is on the guest list.</p>
<button class="btn-gold press" type="submit">Continue</button>
</form>
</section>`;
  return page(ctx, { route: 'events', title: 'Book Tickets', body, mainClass: 'gap-26 booking-main', description: `Book tickets for ${event.name}.` });
}

function questionControl(q, name, value, error) {
  const id = 'f-' + name;
  const aria = raw(`${error ? ` aria-invalid="true" aria-describedby="err-${name}"` : ''}${q.required ? ' required' : ''}`);
  const err = error ? html`<p class="field-error" id="err-${name}">${error}</p>` : '';
  const help = q.help ? html`<p class="small">${q.help}</p>` : '';
  const label = html`${q.label}${q.required ? '' : html` <span class="small">(optional)</span>`}`;
  if (q.type === 'checkbox') {
    return html`<div class="form-field form-check"><label><input type="checkbox" name="${name}" value="1"${value === '1' ? raw(' checked') : ''}${aria}> ${label}</label>${help}${err}</div>`;
  }
  if (q.type === 'choice') {
    return html`<fieldset class="form-field"><legend>${label}</legend>${help}<div class="choice-list">${q.activeOptions.map((o) => html`<label><input type="radio" name="${name}" value="${o.id}"${String(o.id) === value ? raw(' checked') : ''}${aria}> ${o.label}</label>`)}</div>${err}</fieldset>`;
  }
  let control;
  if (q.type === 'select') control = html`<select id="${id}" name="${name}"${aria}><option value="">Please choose…</option>${q.activeOptions.map((o) => html`<option value="${o.id}"${String(o.id) === value ? raw(' selected') : ''}>${o.label}</option>`)}</select>`;
  else if (q.type === 'long_text') control = html`<textarea id="${id}" name="${name}" rows="3" maxlength="1000"${aria}>${value}</textarea>`;
  else control = html`<input id="${id}" name="${name}" type="text" maxlength="200" value="${value}"${aria}>`;
  return html`<div class="form-field"><label for="${id}">${label}</label>${help}${control}${err}</div>`;
}

// The guests, the booking questions and the purchaser. Shared by the public form and Admin's form.
export function bookingFields({ qty, questions, fields = {}, errors = {}, admin = false }) {
  const v = (k) => String(fields[k] ?? '');
  const guestQs = questions.filter((q) => q.scope === 'guest');
  const bookingQs = questions.filter((q) => q.scope === 'booking');
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  return html`${Array.from({ length: qty }, (_, i) => i + 1).map((n) => html`<fieldset class="guest-block">
<legend>Guest ${n}${qty > 1 && n === 1 && !admin ? ' (this can be you)' : ''}</legend>
<div class="form-field"><label for="g${n}-name">Full name</label><input id="g${n}-name" name="g${n}_name" type="text" maxlength="80" autocomplete="${n === 1 && !admin ? 'name' : 'off'}" value="${v(`g${n}_name`)}" required${aria(`g${n}_name`)}>${err(`g${n}_name`)}</div>
${guestQs.map((q) => questionControl(q, `g${n}_q${q.id}`, v(`g${n}_q${q.id}`), errors[`g${n}_q${q.id}`]))}
</fieldset>`)}
${bookingQs.length ? html`<fieldset class="guest-block"><legend>About your booking</legend>${bookingQs.map((q) => questionControl(q, `b_q${q.id}`, v(`b_q${q.id}`), errors[`b_q${q.id}`]))}</fieldset>` : ''}
<fieldset class="guest-block">
<legend>${admin ? 'Contact details (if known)' : 'Your contact details'}</legend>
${admin ? '' : html`<p class="small">Your confirmation and check-in QR code are sent to this email address. Only you need to give contact details, not every guest.</p>`}
<div class="form-field"><label for="p-name">${admin ? 'Purchaser’s name' : 'Your name'}</label><input id="p-name" name="p_name" type="text" maxlength="80" autocomplete="${admin ? 'off' : 'name'}" value="${v('p_name')}"${admin ? '' : raw(' required')}${aria('p_name')}>${err('p_name')}${admin ? html`<p class="small">Leave empty to use Guest 1’s name.</p>` : ''}</div>
<div class="form-field"><label for="p-email">Email address${admin ? ' (optional)' : ''}</label><input id="p-email" name="p_email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="${admin ? 'off' : 'email'}" inputmode="email" spellcheck="false" value="${v('p_email')}"${admin ? '' : raw(' required')}${aria('p_email')}>${err('p_email')}</div>
<div class="form-field"><label for="p-phone">Phone number${admin ? ' (optional)' : ''}</label><input id="p-phone" name="p_phone" type="tel" maxlength="24" autocomplete="${admin ? 'off' : 'tel'}" inputmode="tel" value="${v('p_phone')}"${admin ? '' : raw(' required')}${aria('p_phone')}>${err('p_phone')}${admin ? '' : html`<p class="small">Only used if we need to contact you about this event.</p>`}</div>
</fieldset>`;
}

// Step 2: guest names, questions, contact details
export function detailsPage(ctx, { event, settings, qty, questions, fields = {}, errors = {}, notice = '', stamp, sandbox, max }) {
  const body = html`${back(event)}${testModeNotice(sandbox)}
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
${eventSummary(event, settings, [['Tickets', html`${qty} <a class="link-gold" href="/events/${event.id}/book">Change</a>`], ['Total', money(event.price_pence * qty)]])}
<section class="card-blue share-card" aria-labelledby="g-title">
<h2 class="card-title" id="g-title">Guest details</h2>
<form method="post" action="/events/${event.id}/book" class="share-form" novalidate>
<input type="hidden" name="t" value="${stamp}">
<input type="hidden" name="step" value="review">
<input type="hidden" name="qty" value="${qty}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
${bookingFields({ qty, questions, fields, errors })}
<div class="form-field form-check"><label><input type="checkbox" name="marketing" value="1"${fields.marketing === '1' ? raw(' checked') : ''}> ${CHECKOUT_CONSENT} <span class="small">(optional)</span></label>
<p class="small">Only your own email address is added, and only if you tick this. You can unsubscribe at any time. It doesn’t affect your booking.</p></div>
<button class="btn-gold press" type="submit">Review your booking</button>
<p class="small">You can check everything on the next screen before paying. ${max > 1 ? '' : ''}See our <a href="/privacy">Privacy Notice</a>.</p>
</form>
</section>`;
  return page(ctx, { route: 'events', title: 'Guest Details', body, mainClass: 'gap-26 booking-main', description: `Book tickets for ${event.name}.` });
}

export function reviewList(values, { totalPence, showPurchaser = true } = {}) {
  return html`<dl class="wed-list summary-list">
<div class="wed-row"><dt>Tickets</dt><dd>${values.qty}</dd></div>
${values.guests.map((g) => html`<div class="wed-row review-guest"><dt>Guest ${g.position}</dt><dd><strong>${g.name}</strong>${g.answers.filter((a) => a.value).map((a) => html`<br><span class="small">${a.question_label}: ${a.value}</span>`)}</dd></div>`)}
${values.answers.filter((a) => a.value).map((a) => html`<div class="wed-row"><dt>${a.question_label}</dt><dd>${a.value}</dd></div>`)}
${showPurchaser ? html`<div class="wed-row"><dt>Your name</dt><dd>${values.purchaser.name}</dd></div>
<div class="wed-row"><dt>Email</dt><dd>${values.purchaser.email}</dd></div>
<div class="wed-row"><dt>Phone</dt><dd>${values.purchaser.phone}</dd></div>
<div class="wed-row"><dt>Mailing list</dt><dd>${values.marketing ? 'Yes, keep me updated' : 'No'}</dd></div>` : ''}
${totalPence !== undefined ? html`<div class="wed-row review-total"><dt>Total</dt><dd><strong>${money(totalPence)}</strong></dd></div>` : ''}
</dl>`;
}

// Step 3: REVIEW YOUR BOOKING, then CONFIRM & PAY SECURELY
export function reviewPage(ctx, { event, settings, values, hidden, totalPence, holdMinutes, siteKey, sandbox, notice = '', termsError = '' }) {
  const fields = hidden.map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`);
  const body = html`${back(event)}${testModeNotice(sandbox)}
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
<section class="card-gold booking-card review-card" aria-labelledby="rv-title">
<h2 class="book-title" id="rv-title">REVIEW YOUR BOOKING</h2>
<p>Please check everything carefully${values.guests.some((g) => g.answers.some((a) => CHOICE_TYPES.includes(a.type) && a.value)) ? ', especially each guest’s choices' : ''}. This is exactly what will be booked.</p>
<dl class="wed-list summary-list">
<div class="wed-row"><dt>Event</dt><dd>${event.name}</dd></div>
<div class="wed-row"><dt>Date</dt><dd>${longDate(event.date)}${event.start_time ? ', ' + friendlyTime(event.start_time) : event.time_text ? ', ' + event.time_text : ''}</dd></div>
${eventVenue(event, settings).venue ? html`<div class="wed-row"><dt>Venue</dt><dd>${eventVenue(event, settings).venue}</dd></div>` : ''}
</dl>
${reviewList(values, { totalPence })}
</section>
<section class="card-blue share-card" aria-labelledby="pay-title">
<h2 class="card-title" id="pay-title">Confirm and pay</h2>
<form method="post" action="/events/${event.id}/book" class="share-form" novalidate>
${fields}
${event.booking_terms ? html`<div class="form-field policy-box"><h3 class="policy-title">Booking terms</h3><div class="prose small">${formatText(event.booking_terms)}</div></div>
<div class="form-field form-check"><label><input type="checkbox" name="terms" value="1"${termsError ? raw(' aria-invalid="true" aria-describedby="err-terms"') : ''}> I have read and agree to the booking terms.</label>${termsError ? html`<p class="field-error" id="err-terms">${termsError}</p>` : ''}</div>` : ''}
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="tickets" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit" name="step" value="confirm">CONFIRM &amp; PAY SECURELY</button>
<button class="btn-outline-gold press" type="submit" name="step" value="edit" formnovalidate>Change details</button>
<p class="small">Your places are held for ${holdMinutes} minutes while you pay ${money(totalPence)} on Square’s secure checkout page. New Way’s never sees your card details.</p>
</form>
</section>`;
  return page(ctx, { route: 'events', title: 'Review Your Booking', body, mainClass: 'gap-26 booking-main', description: 'Review your booking before paying.' });
}

// The customer's own booking page (after Square sends them back, or from the link on the page)
export function bookingPage(ctx, { event, settings, booking, values, key, payUrl, checkFailed, sandbox, qrSvg }) {
  const self = `/tickets/${booking.reference}?key=${encodeURIComponent(key)}`;
  let state;
  if (booking.status === 'confirmed') {
    state = html`<section class="card-blue order-state is-done" aria-labelledby="state"><h2 class="card-title" id="state">You’re booked</h2>
<p>Thank you, ${booking.purchaser_name}. Your payment has been received and your booking is confirmed. A confirmation has been emailed to ${booking.purchaser_email}.</p>
<p><strong>No physical ticket is required.</strong> Your confirmed names are on the New Way’s guest list.</p>
<div class="ticket-qr">${raw(qrSvg)}</div>
<p class="small">At the door, show this QR code (on your phone or printed), or just give your name. It is also in your confirmation email. Reference ${booking.reference}.</p>
${event.instructions ? html`<div class="policy-box"><h3 class="policy-title">Information for the event</h3><div class="prose small">${formatText(event.instructions)}</div></div>` : ''}
</section>`;
  } else if (booking.status === 'needs_attention') {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Thank you, your payment was received</h2>
<p>There was a problem confirming your places automatically, so New Way’s will contact you personally.</p></section>`;
  } else if (booking.status === 'held' && payUrl) {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Your places are held until ${ukClock(booking.hold_expires_at)}</h2>
${checkFailed ? html`<p class="notice-bad" role="alert">We couldn’t check with Square just now. If you have already paid, please wait a minute and check again.</p>` : ''}
<a class="btn-gold press" href="${payUrl}" rel="external">Pay ${money(booking.total_pence)} securely with Square</a>
<p class="small">If payment isn’t completed in time, the places are released for someone else. Already paid? <a class="link-gold" href="${self}">Check again</a></p>
${testModeNotice(sandbox)}</section>`;
  } else if (booking.status === 'held') {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Checking your payment</h2>
<p>We’re waiting for Square to confirm your payment. This usually takes a few seconds.</p>
<a class="btn-outline-gold press" href="${self}">Check again</a></section>`;
  } else {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">${booking.status === 'cancelled' ? 'This booking was cancelled' : 'This hold has run out'}</h2>
<p>No payment was taken. The places have been released.</p>
<a class="btn-gold press" href="/events">Back to Events</a></section>`;
  }
  const summary = html`<section class="card-gold booking-card" aria-labelledby="bk-summary"><h2 class="book-title" id="bk-summary">${event.name}</h2>
<dl class="wed-list summary-list"><div class="wed-row"><dt>Date</dt><dd>${longDate(event.date)}${event.start_time ? ', ' + friendlyTime(event.start_time) : ''}</dd></div>
${eventVenue(event, settings).venue ? html`<div class="wed-row"><dt>Venue</dt><dd>${eventVenue(event, settings).venue}</dd></div>` : ''}</dl>
${reviewList(values, { totalPence: booking.total_pence, showPurchaser: false })}</section>`;
  return page(ctx, { route: 'events', title: booking.status === 'confirmed' ? 'Booking Confirmed' : 'Your Booking', body: html`${state}${summary}`, mainClass: 'gap-26 booking-main',
    description: 'Your New Way’s event booking.' });
}

// /c/TOKEN: what a QR code opens. Shows the ticket without any personal details.
export function ticketPage(ctx, { event, booking, qrSvg, valid }) {
  const body = html`<section class="card-gold booking-card" aria-labelledby="tk-title">
<h2 class="book-title" id="tk-title">${valid ? 'New Way’s booking' : 'Booking not valid'}</h2>
${valid ? html`<dl class="wed-list summary-list"><div class="wed-row"><dt>Event</dt><dd>${event.name}</dd></div>
<div class="wed-row"><dt>Date</dt><dd>${longDate(event.date)}${event.start_time ? ', ' + friendlyTime(event.start_time) : ''}</dd></div>
<div class="wed-row"><dt>Tickets</dt><dd>${booking.quantity}</dd></div><div class="wed-row"><dt>Reference</dt><dd>${booking.reference}</dd></div></dl>
<div class="ticket-qr">${raw(qrSvg)}</div>
<p>Show this QR code at the door, or just give your name. No physical ticket is required: your confirmed names are on the New Way’s guest list.</p>`
    : html`<p>This booking is no longer valid. If you think this is wrong, please contact New Way’s.</p>`}
</section>
<p class="small staff-link"><a class="link-gold" href="/admin/checkin/find/${booking ? booking.checkin_token : ''}">New Way’s team: open check-in</a></p>`;
  return page(ctx, { route: 'events', title: 'Your Ticket', body, mainClass: 'gap-26 booking-main', description: 'A New Way’s event booking.' });
}

// ---------- mailing list ----------
export function joinPage(ctx, { wording, stamp, siteKey, values = {}, errors = {}, notice = '' }) {
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const body = html`<section class="card-blue share-card" aria-label="${wording.join_heading}">
<div class="prose">${formatText(wording.join_message)}</div>
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
<form method="post" action="/join" class="share-form" novalidate>
<input type="hidden" name="t" value="${stamp}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="form-field"><label for="j-name">Your name</label><input id="j-name" name="name" type="text" maxlength="80" autocomplete="name" value="${values.name || ''}" required${aria('name')}>${err('name')}</div>
<div class="form-field"><label for="j-email">Email address</label><input id="j-email" name="email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="email" inputmode="email" spellcheck="false" value="${values.email || ''}" required${aria('email')}>${err('email')}</div>
<div class="form-field form-check"><label><input type="checkbox" name="consent" value="1"${values.consent ? raw(' checked') : ''}${aria('consent')}> ${wording.join_consent}</label>${err('consent')}</div>
${siteKey ? html`<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="join" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>` : ''}
<button class="btn-gold press" type="submit">${wording.join_button}</button>
<p class="small">We only use your email address to send you New Way’s news. Every email has an unsubscribe link. See our <a href="/privacy">Privacy Notice</a>.</p>
</form>
</section>`;
  return page(ctx, { route: 'join', title: wording.join_heading, body, mainClass: 'gap-26 booking-main', description: 'Join the New Way’s mailing list for news of events and activities.' });
}

export function messagePage(ctx, { title, message, link = '/', linkText = 'Go to the home screen', done = false }) {
  const body = html`<section class="card-blue order-state${done ? ' is-done' : ''}"><h2 class="card-title">${title}</h2><p>${message}</p><a class="btn-outline-gold press" href="${link}">${linkText}</a></section>`;
  return page(ctx, { route: 'join', title, body, mainClass: 'gap-26 booking-main', description: title });
}

export function unsubscribePage(ctx, { token, email, done }) {
  const body = done
    ? html`<section class="card-blue order-state is-done"><h2 class="card-title">You’re unsubscribed</h2><p>${email} won’t receive New Way’s news emails any more. Emails about any bookings you make are not affected.</p><a class="btn-outline-gold press" href="/">Go to the home screen</a></section>`
    : html`<section class="card-blue order-state"><h2 class="card-title">Unsubscribe</h2><p>Stop New Way’s news emails to ${email}?</p>
<form method="post" action="/unsubscribe/${token}"><button class="btn-gold press" type="submit">Unsubscribe</button></form></section>`;
  return page(ctx, { route: 'join', title: 'Unsubscribe', body, mainClass: 'gap-26 booking-main', description: 'Unsubscribe from New Way’s emails.' });
}
