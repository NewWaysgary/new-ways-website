// Public screens for paying in advance for a Wednesday evening (optional), its confirmation page and its QR page.
// Same cards, buttons and colours as the rest of the site.
import { html, raw } from '../lib/html.js';
import { page } from './layout.js';
import { longDate } from '../lib/dates.js';
import { testModeNotice } from './booking.js';
import { pounds, raffleStrips } from '../wednesday/model.js';

export const PRINCIPLE = 'No booking required. Everyone is welcome to come along and pay at the door.';

const back = html`<p class="screen-sub"><a class="link-gold" href="/whos-on">Who’s On</a> <span aria-hidden="true">›</span> Pay in advance</p>`;

export function payPage(ctx, { nights, items, open, sandbox, settings, stamp, siteKey, values = {}, errors = {}, notice = '' }) {
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const usable = nights.filter((n) => !n.closed && !n.tooLate);
  const pick = values.night && usable.some((n) => n.date === values.night) ? values.night : (usable[0] ? usable[0].date : '');
  const intro = html`<section class="card-blue wed-note prepay-intro" aria-labelledby="prepay-title">
<h2 class="wed-note-title" id="prepay-title">Pay in advance (optional)</h2>
<p><strong>${PRINCIPLE}</strong></p>
<p>If you’d rather pay before you come, you can do it here. You’ll get a QR code by email to show at the door, and the same QR code again at 6pm on the evening.</p>
</section>`;
  const closedLines = nights.filter((n) => n.closed);
  const form = !open ? html`<section class="card-blue share-card"><p>Paying in advance online isn’t available at the moment. ${PRINCIPLE}</p><a class="btn-outline-gold press" href="/whos-on">See who’s on</a></section>`
    : !usable.length || !items.length ? html`<section class="card-blue share-card"><p>There’s no Wednesday to pay for online just now. ${PRINCIPLE}</p><a class="btn-outline-gold press" href="/whos-on">See who’s on</a></section>`
      : html`<section class="card-blue share-card" aria-labelledby="pay-form-title">
<h2 class="card-title" id="pay-form-title">What would you like to pay for?</h2>
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
<form method="post" action="/whos-on/pay" class="share-form" novalidate data-wed-form>
<input type="hidden" name="t" value="${stamp}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<fieldset class="form-field"><legend>Which Wednesday?</legend>
<div class="choice-list">${nights.map((n) => html`<label><input type="radio" name="night" value="${n.date}"${n.date === pick ? raw(' checked') : ''}${n.closed || n.tooLate ? raw(' disabled') : ''}${aria('night')}>
<span>${longDate(n.date)}${n.medium ? html`<br><span class="small">Guest medium: ${n.medium}</span>` : ''}${n.closed ? html`<br><span class="small prepay-closed">CLOSED${n.reason ? ': ' + n.reason : ''}</span>` : n.tooLate ? html`<br><span class="small">Online payment has closed for tonight: please pay at the door</span>` : ''}</span></label>`)}</div>${err('night')}</fieldset>
<fieldset class="form-field"><legend>How many of each?</legend>
<div class="prepay-items">${items.map((i) => html`<div class="prepay-item"><label for="q-${i.id}"><span>${i.label}</span><span class="small">${pounds(i.price_pence)} each${i.category === 'raffle' ? ' (one per raffle strip)' : ''}</span></label>
<select id="q-${i.id}" name="q${i.id}" data-price="${i.price_pence}">${Array.from({ length: 11 }, (_, n) => html`<option value="${n}"${String(n) === String((values.qty || {})[i.id] || '0') ? raw(' selected') : ''}>${n}</option>`)}</select></div>`)}</div>
${err('items')}
<p class="prepay-total" data-wed-total hidden>Total: <strong>£0.00</strong></p></fieldset>
<div class="form-field"><label for="p-email">Your email address</label>
<input id="p-email" name="email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="email" inputmode="email" spellcheck="false" value="${values.email || ''}" required${aria('email')}>${err('email')}
<p class="small">The only detail we ask for. Your confirmation and QR code are sent here, and again at 6pm on the evening.</p></div>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="wednesday" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit">Continue to secure payment</button>
<p class="small">You pay on Square’s secure checkout page; New Way’s never sees your card details. See our <a href="/privacy">Privacy Notice</a>.</p>
</form></section>`;
  const body = html`${back}${testModeNotice(sandbox && open)}${intro}
${closedLines.length ? html`<section class="card-gold wed-closure" aria-label="Closures">${closedLines.map((n) => html`<p><strong>CLOSED ${longDate(n.date)}</strong>${n.reason ? ': ' + n.reason : ''}</p>`)}</section>` : ''}
${form}`;
  return page(ctx, { route: 'whos-on', title: 'Pay in Advance', body, mainClass: 'gap-26 booking-main', canonicalPath: '/whos-on/pay',
    description: `Pay in advance for a Wednesday evening at New Way’s (optional). ${PRINCIPLE}` });
}

function linesList(order) {
  return html`<dl class="wed-list summary-list">
<div class="wed-row"><dt>Evening</dt><dd>${longDate(order.night_date)}</dd></div>
${order.lines.map((l) => html`<div class="wed-row"><dt>${l.label}</dt><dd>${l.qty} × ${pounds(l.unit_pence)}</dd></div>`)}
<div class="wed-row review-total"><dt>Total</dt><dd><strong>${pounds(order.total_pence)}</strong></dd></div>
<div class="wed-row"><dt>Reference</dt><dd>${order.reference}</dd></div></dl>`;
}

export function statusPage(ctx, { order, night, payUrl, self, checkFailed, sandbox, qr }) {
  const strips = raffleStrips(order.lines);
  let state;
  if (order.status === 'paid' && order.refunded_at) {
    state = html`<section class="card-blue order-state"><h2 class="card-title">This payment has been refunded</h2><p>If you have any questions, please contact New Way’s.</p></section>`;
  } else if (order.status === 'paid') {
    state = html`<section class="card-blue order-state is-done" aria-labelledby="st"><h2 class="card-title" id="st">You’ve paid. See you on ${longDate(order.night_date)}!</h2>
${night && night.closed_for_public ? html`<p class="notice-bad" role="alert"><strong>New Way’s is CLOSED that evening</strong>${night.closure_reason ? ': ' + night.closure_reason : ''}. We will be in touch about your payment.</p>` : ''}
<p>Your confirmation and QR code have been emailed to you${order.email ? html` at ${order.email}` : ''}, and will be sent again at 6pm on the evening.</p>
<div class="ticket-qr">${raw(qr)}</div>
<p class="small">Show this QR code at the door (on your phone or printed).${strips ? ` Your ${strips} raffle ${strips === 1 ? 'strip is' : 'strips are'} given to you at the door.` : ''}</p>
</section>`;
  } else if (order.status === 'needs_attention') {
    state = html`<section class="card-blue order-state"><h2 class="card-title">Thank you, your payment was received</h2><p>There was a problem confirming it automatically, so New Way’s will contact you.</p></section>`;
  } else if (order.status === 'pending') {
    state = html`<section class="card-blue order-state" aria-labelledby="st"><h2 class="card-title" id="st">${payUrl ? 'Waiting for your payment' : 'Checking your payment'}</h2>
${checkFailed ? html`<p class="notice-bad" role="alert">We couldn’t check with Square just now. If you have already paid, please wait a minute and check again.</p>` : ''}
${payUrl ? html`<a class="btn-gold press" href="${payUrl}" rel="external">Pay ${pounds(order.total_pence)} securely with Square</a>` : ''}
<a class="btn-outline-gold press" href="${self}">Already paid? Check again</a>${testModeNotice(sandbox)}</section>`;
  } else {
    state = html`<section class="card-blue order-state"><h2 class="card-title">This payment wasn’t completed</h2><p>No payment was taken. ${PRINCIPLE}</p><a class="btn-outline-gold press" href="/whos-on">See who’s on</a></section>`;
  }
  const body = html`${state}<section class="card-gold booking-card" aria-labelledby="sum"><h2 class="book-title" id="sum">Wednesday at New Way’s</h2>${linesList(order)}</section>`;
  return page(ctx, { route: 'whos-on', title: order.status === 'paid' ? 'Payment Confirmed' : 'Your Payment', body, mainClass: 'gap-26 booking-main', description: 'Your Wednesday advance payment.' });
}

export function qrPage(ctx, { order, valid, qr }) {
  const body = html`<section class="card-gold booking-card" aria-labelledby="qr-title">
<h2 class="book-title" id="qr-title">${valid ? 'Paid in advance' : 'Not valid'}</h2>
${valid ? html`<dl class="wed-list summary-list"><div class="wed-row"><dt>Evening</dt><dd>${longDate(order.night_date)}</dd></div>
${order.lines.map((l) => html`<div class="wed-row"><dt>${l.label}</dt><dd>${l.qty}</dd></div>`)}
<div class="wed-row"><dt>Reference</dt><dd>${order.reference}</dd></div></dl>
<div class="ticket-qr">${raw(qr)}</div><p>Show this QR code at the door.</p>`
    : html`<p>This payment is not valid. If you think this is wrong, please contact New Way’s.</p>`}
</section>
<p class="small staff-link"><a class="link-gold" href="/admin/door/find/${order.checkin_token}">New Way’s team: open at the door</a></p>`;
  return page(ctx, { route: 'whos-on', title: 'Your QR Code', body, mainClass: 'gap-26 booking-main', description: 'A New Way’s Wednesday payment.' });
}

export function messagePage(ctx, { title, message }) {
  const body = html`<section class="card-blue order-state"><h2 class="card-title">${title}</h2><p>${message}</p><a class="btn-outline-gold press" href="/whos-on">See who’s on</a></section>`;
  return page(ctx, { route: 'whos-on', title, body, mainClass: 'gap-26 booking-main', description: title });
}

// The card on Who’s On (and the closure notices shown there and on the Home screen)
export function prepayCard() {
  return html`<section class="card-blue wed-note prepay-card" aria-labelledby="prepay-card">
<h2 class="wed-note-title" id="prepay-card">Pay in advance (optional)</h2>
<p>${PRINCIPLE}</p>
<p class="small">If you’d rather pay before you come, you can pay online and show a QR code at the door.</p>
<a class="btn-outline-gold press" href="/whos-on/pay">Pay in advance</a>
</section>`;
}

export function closureNotices(list) {
  if (!list || !list.length) return '';
  return html`<section class="announcement announcement-urgent wed-closure" aria-label="Wednesday closures">${list.map((n) => html`<div><h2>CLOSED: ${longDate(n.night_date)}</h2>${n.closure_reason ? html`<p>${n.closure_reason}</p>` : ''}</div>`)}</section>`;
}
