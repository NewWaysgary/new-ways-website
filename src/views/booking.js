// Public screens for booking a private reading and for the customer's order page.
import { html, raw, formatText } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { longDate } from '../lib/dates.js';
import { friendlyTime, WEEKDAYS } from '../bookings/availability.js';
import { page } from './layout.js';
import { money } from '../notify.js';
import { downloadPanel } from './shop.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const q = (params) => '?' + new URLSearchParams(params).toString();

export function testModeNotice(sandbox) {
  return sandbox ? html`<p class="notice test-mode" role="note"><strong>Test mode.</strong> Payments go to Square’s test system (Sandbox), so no real money is taken.</p>` : '';
}

function contactLine(s) {
  const bits = [s.phone && html`<a href="tel:${s.phone.replace(/[^\d+]/g, '')}">${s.phone}</a>`, s.email && html`<a href="mailto:${s.email}">${s.email}</a>`].filter(Boolean);
  return bits.length ? html`<p class="small">To contact Gary: ${bits.map((b, i) => html`${i ? ' or ' : ''}${b}`)}</p>` : '';
}

// ---------- Private Readings page ----------
export function readingsPage(ctx, { block, services, open, sandbox }) {
  const body = html`<div class="halo halo-readings">
<div class="halo-glow breathe" aria-hidden="true"></div>
<div class="halo-arc-gold spin" aria-hidden="true"></div>
<div class="halo-arc-blue spin-back" aria-hidden="true"></div>
<span class="readings-core">${icon('lotus', 34)}</span>
</div>
<div class="readings-text">${formatText(block.body, { replaceTokens: ctx.fill })}</div>
${open ? html`<section class="stack-10 reading-choices" aria-labelledby="choose-reading">
<h2 class="card-title" id="choose-reading">Choose your reading</h2>
${services.map((s) => html`<a class="btn-gold press reading-choice" href="/private-readings/book${q({ reading: s.code })}"><span>${s.name}</span><span class="choice-price">${money(s.price_pence).replace('.00', '')}</span></a>`)}
<p class="small">Choose a date and time on the next screen. Readings take place by WhatsApp video call.</p>
${testModeNotice(sandbox)}
</section>` : html`<section class="card-blue booking-closed" aria-labelledby="booking-soon">
<h2 class="card-title" id="booking-soon">Online booking</h2>
<p>Online booking will open here soon.</p>
${contactLine(ctx.settings)}
</section>`}`;
  return page(ctx, { route: 'private-readings', title: 'Private Readings', body, mainClass: 'readings-main',
    description: 'Book a private reading with Medium Gary Findlay by WhatsApp video call. Choose an available date and time and book securely online.' });
}

// ---------- step 1 and 2: date and time ----------
export function calendarPage(ctx, { service, services, month, months, days, selected, times, sandbox }) {
  const [y, m] = month.split('-').map(Number);
  const idx = months.indexOf(month);
  const prev = idx > 0 ? months[idx - 1] : null, next = idx < months.length - 1 ? months[idx + 1] : null;
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();          // 0 = Sunday
  const lead = (first + 6) % 7;                                         // weeks start on Monday
  const cells = [...Array(lead).fill(null), ...days];
  const nav = (target, label, cls) => target
    ? html`<a class="cal-nav ${cls} press" href="/private-readings/book${q({ reading: service.code, month: target })}">${label}</a>`
    : html`<span class="cal-nav ${cls}" aria-hidden="true"></span>`;
  const anyThisMonth = days.some((d) => d.count);
  const body = html`<p class="screen-sub"><a class="link-gold" href="/private-readings">Private Readings</a> <span aria-hidden="true">›</span> Choose a date and time</p>
${testModeNotice(sandbox)}
<section class="card-gold booking-card" aria-labelledby="your-reading">
<h2 class="book-title" id="your-reading">${service.name}</h2>
<p class="book-sub">${money(service.price_pence)} · ${service.minutes} minutes · WhatsApp video call</p>
${services.length > 1 ? html`<p class="small">${services.filter((s) => s.code !== service.code).map((s) => html`<a class="link-gold" href="/private-readings/book${q({ reading: s.code, month })}">Switch to the ${s.name.toLowerCase()} (${money(s.price_pence)})</a>`)}</p>` : ''}
</section>
<section class="card-blue cal" aria-labelledby="cal-title">
<div class="cal-head">
${nav(prev, html`${icon('chev', 20, 'flip')}<span class="sr-only">Previous month</span>`, 'cal-prev')}
<h2 class="cal-title" id="cal-title">${MONTHS[m - 1]} ${y}</h2>
${nav(next, html`${icon('chev', 20)}<span class="sr-only">Next month</span>`, 'cal-next')}
</div>
<ol class="cal-grid" role="list">
${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<li class="cal-dow" aria-hidden="true">${d}</li>`)}
${cells.map((d) => !d ? html`<li class="cal-empty" aria-hidden="true"></li>` : d.count
      ? html`<li><a class="cal-day is-open${d.date === selected ? ' is-selected' : ''} press" href="/private-readings/book${q({ reading: service.code, month, date: d.date })}#times"${d.date === selected ? raw(' aria-current="date"') : ''} aria-label="${longDate(d.date)}, ${d.count} ${d.count === 1 ? 'time' : 'times'} available">${Number(d.date.slice(8))}</a></li>`
      : html`<li><span class="cal-day" aria-label="${longDate(d.date)}, not available">${Number(d.date.slice(8))}</span></li>`)}
</ol>
${!anyThisMonth ? html`<p class="small cal-none">No times are available in ${MONTHS[m - 1]}.${next ? ' Try the next month.' : ''}</p>` : html`<p class="small">Dates with a gold ring have times available.</p>`}
</section>
${selected ? html`<section class="card-blue times-card" id="times" aria-labelledby="times-title">
<h2 class="card-title" id="times-title">${longDate(selected)}</h2>
${times.length ? html`<p class="small">Choose a start time (UK time).</p>
<ul class="time-list">${times.map((t) => html`<li><a class="time-btn press" href="/private-readings/book/details${q({ reading: service.code, date: selected, time: t })}">${friendlyTime(t)}</a></li>`)}</ul>`
        : html`<p>There are no times left on this date. Please choose another date.</p>`}
</section>` : ''}`;
  return page(ctx, { route: 'private-readings', title: 'Book a Reading', body, mainClass: 'gap-26 booking-main',
    description: 'Choose a date and time for a private reading with Medium Gary Findlay.' });
}

// ---------- step 3: review, details and agreement ----------
export function detailsPage(ctx, { service, date, time, policy, holdMinutes, stamp, siteKey, values = {}, errors = {}, notice = '', sandbox }) {
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const body = html`<p class="screen-sub"><a class="link-gold" href="/private-readings/book${q({ reading: service.code, month: date.slice(0, 7), date })}#times">Back to dates and times</a></p>
${testModeNotice(sandbox)}
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
<section class="card-gold booking-card" aria-labelledby="review-title">
<h2 class="book-title" id="review-title">Your reading</h2>
<dl class="wed-list summary-list">
<div class="wed-row"><dt>Reading</dt><dd>${service.name}</dd></div>
<div class="wed-row"><dt>Length</dt><dd>${service.minutes} minutes</dd></div>
<div class="wed-row"><dt>Date</dt><dd>${longDate(date)}</dd></div>
<div class="wed-row"><dt>Time</dt><dd>${friendlyTime(time)} (UK time)</dd></div>
<div class="wed-row"><dt>Price</dt><dd>${money(service.price_pence)}</dd></div>
<div class="wed-row"><dt>How</dt><dd>WhatsApp video call</dd></div>
</dl>
</section>
<section class="card-blue share-card" aria-labelledby="details-title">
<h2 class="card-title" id="details-title">Your details</h2>
<form method="post" action="/private-readings/book" class="share-form" novalidate>
<input type="hidden" name="t" value="${stamp}">
<input type="hidden" name="reading" value="${service.code}">
<input type="hidden" name="date" value="${date}">
<input type="hidden" name="time" value="${time}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="form-field"><label for="b-name">Your name</label><input id="b-name" name="name" type="text" maxlength="80" autocomplete="name" value="${values.name || ''}" required${aria('name')}>${err('name')}</div>
<div class="form-field"><label for="b-email">Email address</label><input id="b-email" name="email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="email" inputmode="email" spellcheck="false" value="${values.email || ''}" required${aria('email')}>${err('email')}<p class="small">Your confirmation is sent here.</p></div>
<div class="form-field"><label for="b-phone">Mobile number connected to WhatsApp</label><input id="b-phone" name="phone" type="tel" maxlength="24" autocomplete="tel" inputmode="tel" value="${values.phone || ''}" required${aria('phone')}>${err('phone')}<p class="small">Your reading takes place by WhatsApp video call on this number.</p></div>
<div class="form-field policy-box" aria-labelledby="policy-title">
<h3 class="policy-title" id="policy-title">Cancelling or rearranging</h3>
<div class="prose small">${formatText(policy)}</div>
</div>
<div class="form-field form-check"><label><input type="checkbox" name="policy" value="1"${values.policy ? raw(' checked') : ''}${aria('policy')}> I understand how cancelling and rearranging works.</label>${err('policy')}</div>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="booking" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit">Continue to secure payment</button>
<p class="small">Your time is held for ${holdMinutes} minutes while you pay on Square’s secure checkout page. New Way’s never sees your card details. See our <a href="/privacy">Privacy Notice</a>.</p>
</form>
</section>`;
  return page(ctx, { route: 'private-readings', title: 'Your Reading', body, mainClass: 'gap-26 booking-main',
    description: 'Check your private reading and add your details.' });
}

// ---------- the customer's order page (held, paid, run out) ----------
export function orderPage(ctx, { order, booking, product, key, sandbox, payUrl, holdUntil, checkFailed, download }) {
  const isReading = order.kind === 'PRIVATE_READING';
  const self = `/order/${order.reference}?key=${encodeURIComponent(key)}`;
  const rows = isReading && booking ? [['Reading', booking.service_name], ['Date', longDate(booking.date)], ['Time', friendlyTime(booking.local_start) + ' (UK time)'],
    ['Length', booking.minutes + ' minutes'], ['How', 'WhatsApp video call'], ['Price', money(order.amount_pence)], ['Reference', order.reference]]
    : [['Meditation', order.item_name], ['Price', money(order.amount_pence)], ['Reference', order.reference]];
  const summary = html`<section class="card-gold booking-card" aria-labelledby="order-summary">
<h2 class="book-title" id="order-summary">${isReading ? 'Your reading' : 'Your meditation'}</h2>
<dl class="wed-list summary-list">${rows.map(([k, v]) => html`<div class="wed-row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
</section>`;
  let state;
  if (order.status === 'paid') {
    state = isReading
      ? html`<section class="card-blue order-state is-done" aria-labelledby="state"><h2 class="card-title" id="state">Your reading is booked</h2>
<p>Thank you, ${order.customer_name}. Your payment has been received and your reading is confirmed.</p>
<p>A confirmation has been emailed to ${order.customer_email}. Your reading will take place by WhatsApp video call on ${order.customer_phone}.</p></section>`
      : html`<section class="card-blue order-state is-done" aria-labelledby="state"><h2 class="card-title" id="state">Thank you</h2>
<p>Your payment has been received. Your download link has also been emailed to ${order.customer_email}.</p></section>
${download ? downloadPanel({ ...download, action: `/order/${order.reference}/download?key=${encodeURIComponent(key)}`, title: order.item_name }) : ''}`;
  } else if (order.status === 'needs_attention') {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Thank you, your payment was received</h2>
<p>${isReading ? 'There was a problem confirming your appointment time automatically, so Gary will contact you personally to arrange it.' : 'There was a problem preparing your download automatically, so New Way’s will contact you personally.'}</p>
${contactLine(ctx.settings)}</section>`;
  } else if (order.status === 'pending' && payUrl) {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">${isReading ? `Your time is held until ${holdUntil}` : 'Ready to pay'}</h2>
${checkFailed ? html`<p class="notice-bad" role="alert">We couldn’t check with Square just now. If you have already paid, please wait a minute and check again.</p>` : ''}
<a class="btn-gold press" href="${payUrl}" rel="external">Pay ${money(order.amount_pence)} securely with Square</a>
<p class="small">${isReading ? 'If payment isn’t completed in time, the time is released for someone else. ' : ''}Already paid? <a class="link-gold" href="${self}">Check again</a></p>
${testModeNotice(sandbox)}</section>`;
  } else if (order.status === 'pending') {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Checking your payment</h2>
<p>We’re waiting for Square to confirm your payment. This usually takes a few seconds.</p>
<a class="btn-outline-gold press" href="${self}">Check again</a></section>`;
  } else {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">${isReading ? 'This hold has run out' : 'This order has closed'}</h2>
<p>No payment was taken.${isReading ? ' The time has been released.' : ''}</p>
<a class="btn-gold press" href="${isReading ? '/private-readings' : '/meditations'}">${isReading ? 'Choose a time again' : 'Back to Meditations'}</a></section>`;
  }
  const body = html`${state}${summary}`;
  return page(ctx, { route: isReading ? 'private-readings' : 'meditations', title: order.status === 'paid' ? (isReading ? 'Booking Confirmed' : 'Thank You') : 'Your Order', body, mainClass: 'gap-26 booking-main',
    description: 'Your New Way’s order.' });
}

export function simpleMessage(ctx, { route = 'private-readings', title, message, link = '/private-readings', linkText = 'Back to Private Readings' }) {
  const body = html`<section class="card-blue order-state"><p>${message}</p><a class="btn-outline-gold press" href="${link}">${linkText}</a></section>`;
  return page(ctx, { route, title, body, mainClass: 'gap-26', description: title });
}

export { WEEKDAYS };
