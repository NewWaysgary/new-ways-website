// Public Gift Vouchers page: the travel conditions first, then the purchase (no price until the purchaser's details are
// complete), the review with the total, and the purchaser's own page after Square.
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { longDate } from '../lib/dates.js';
import { page } from './layout.js';
import { money } from '../notify.js';
import { testModeNotice } from './booking.js';
import { inAppWarning, paymentHelp } from './payment-help.js';
import { TRAVEL_COVER } from '../bookings/vouchers.js';
import { deliveryText } from '../bookings/voucher-sales.js';

const trap = html`<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>`;

function contactLine(s) {
  const bits = [s.phone && html`<a href="tel:${s.phone.replace(/[^\d+]/g, '')}">${s.phone}</a>`, s.email && html`<a href="mailto:${s.email}">${s.email}</a>`].filter(Boolean);
  return bits.length ? html`<p class="small">To contact Gary: ${bits.map((b, i) => html`${i ? ' or ' : ''}${b}`)}</p>` : '';
}

// The conditions, exactly as agreed, shown before anything is chosen or typed
export function conditionsPanel({ compact = false } = {}) {
  return html`<section class="card-gold gv-conditions" aria-labelledby="gv-cond-title">
<h2 class="book-title" id="gv-cond-title">${compact ? 'Travel conditions' : 'Please read before you buy'}</h2>
<div class="gv-cond">
<h3 class="gv-cond-title">${icon('phone', 20, 'icon-gold')} WhatsApp Video Call</h3>
<p>Your gift voucher covers the full cost of the private reading. <strong>There are no additional travel charges.</strong></p>
</div>
<div class="gv-cond">
<h3 class="gv-cond-title">${icon('car', 20, 'icon-gold')} Home Visit (In Person)</h3>
<p>Gift vouchers cover the reading itself. If the recipient chooses a Home Visit, <strong>an additional travel charge of 60p per mile applies to the complete return journey.</strong></p>
<p>Home Visits are available only within <strong>20 driving miles one way</strong> of Gary’s home location.</p>
<p>The recipient can choose a <strong>WhatsApp Video Call</strong> instead, with no additional charges.</p>
</div>
</section>`;
}

export function giftVouchersPage(ctx, { services, open, values = {}, errors = {}, notice = '', stamp = '', sandbox = false, validMonths = 12, status = 200 }) {
  const v = (k) => String(values[k] ?? '');
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const body = html`<div class="gv-hero">
<span class="gv-hero-icon" aria-hidden="true">${icon('gift', 34)}</span>
<p class="gv-lead">Give someone special a private reading with Medium Gary Findlay.</p>
<p>A New Way’s gift voucher is for one 30 minute or 60 minute private reading. It is sent by email, ready to print at home on A4 paper, or straight to the person you are giving it to.</p>
</div>
${conditionsPanel()}
${open ? html`${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
<section class="card-blue share-card gv-buy" aria-labelledby="gv-buy-title">
<h2 class="card-title" id="gv-buy-title">Buy a gift voucher</h2>
<form method="post" action="/gift-vouchers/review" class="share-form gv-form" novalidate>
<input type="hidden" name="t" value="${stamp}">
${trap}
<div class="form-field form-check${errors.conditions ? ' has-error' : ''}"><label><input type="checkbox" name="conditions" value="1"${v('conditions') === '1' ? raw(' checked') : ''} required${aria('conditions')}> <span>I have read and understand the WhatsApp Video Call and Home Visit conditions above.</span></label>${err('conditions')}</div>
<fieldset class="form-field gv-fieldset"${aria('reading')}><legend class="gv-legend">1. Choose the reading</legend>
<div class="method-choice">
${services.map((s) => html`<label class="method-option"><input type="radio" name="reading" value="${s.code}"${v('reading') === s.code ? raw(' checked') : ''} required> <span><strong>${s.minutes} minute private reading</strong><span class="small">With Medium Gary Findlay</span></span></label>`)}
</div>${err('reading')}</fieldset>
<fieldset class="form-field gv-fieldset"><legend class="gv-legend">2. Your details</legend>
<div class="form-field"><label for="gv-name">Your full name</label><input id="gv-name" name="name" type="text" maxlength="80" autocomplete="name" value="${v('name')}" required${aria('name')}>${err('name')}</div>
<div class="form-field"><label for="gv-email">Your email address</label><input id="gv-email" name="email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="email" inputmode="email" spellcheck="false" value="${v('email')}" required${aria('email')}><p class="small">Your receipt is sent here.</p>${err('email')}</div>
</fieldset>
<fieldset class="form-field gv-fieldset"${aria('delivery')}><legend class="gv-legend">3. How should the voucher be delivered?</legend>
<div class="method-choice">
<label class="method-option"><input type="radio" name="delivery" value="purchaser"${v('delivery') === 'purchaser' ? raw(' checked') : ''} required> <span><strong>Send the voucher to me</strong><span class="small">Emailed to you, with a print-ready A4 copy to download. Ideal for a card or a wrapped present.</span></span></label>
<label class="method-option"><input type="radio" name="delivery" value="recipient"${v('delivery') === 'recipient' ? raw(' checked') : ''}> <span><strong>Send it straight to the recipient</strong><span class="small">Emailed to them after payment. You still get your receipt.</span></span></label>
</div>${err('delivery')}</fieldset>
<fieldset class="form-field gv-fieldset"><legend class="gv-legend">4. Who is it for? (optional)</legend>
<div class="form-field"><label for="gv-rname">Recipient’s name</label><input id="gv-rname" name="recipient_name" type="text" maxlength="80" autocomplete="off" value="${v('recipient_name')}"${aria('recipient_name')}><p class="small">Printed on the voucher. Needed if you choose Send it straight to the recipient.</p>${err('recipient_name')}</div>
<div class="form-field"><label for="gv-remail">Recipient’s email address</label><input id="gv-remail" name="recipient_email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="off" inputmode="email" spellcheck="false" value="${v('recipient_email')}"${aria('recipient_email')}><p class="small">Only if you choose Send it straight to the recipient.</p>${err('recipient_email')}</div>
</fieldset>
<button class="btn-gold press" type="submit">Review my gift voucher</button>
<p class="small">The price is shown on the next screen, before any payment. Vouchers are valid for ${validMonths} months. See our <a href="/privacy">Privacy Notice</a> for how your details are used.</p>
</form>
</section>
${testModeNotice(sandbox)}` : html`<section class="card-blue booking-closed" aria-labelledby="gv-closed">
<h2 class="card-title" id="gv-closed">Buying a gift voucher</h2>
<p>Gift vouchers can’t be bought online just now. Please contact Gary.</p>
${contactLine(ctx.settings)}
</section>`}`;
  return page(ctx, { route: 'gift-vouchers', title: 'Gift Vouchers', body, mainClass: 'gap-26 booking-main gv-main',
    description: 'Give a private reading with Medium Gary Findlay: a New Way’s gift voucher for a 30 or 60 minute reading, sent by email or printed at home.' });
}

// The review: everything given, the price and the total, then agree and pay
export function reviewPage(ctx, { service, values, stamp, siteKey, validMonths, expiresOn, errors = {}, notice = '', sandbox = false }) {
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const keep = html`<input type="hidden" name="t" value="${stamp}">
${['reading', 'name', 'email', 'delivery', 'recipient_name', 'recipient_email', 'conditions'].map((k) => html`<input type="hidden" name="${k}" value="${String(values[k] ?? '')}">`)}`;
  const rows = [['Gift voucher', `${service.minutes} minute private reading with Medium Gary Findlay`],
    ...(values.recipient_name ? [['For', values.recipient_name]] : []),
    ['Delivery', values.delivery === 'recipient' ? `Emailed straight to ${values.recipient_name} at ${values.recipient_email}` : `Emailed to you at ${values.email}, ready to print`],
    ['Your name', values.name], ['Your email', values.email],
    ['Valid until', `${longDate(expiresOn, '0000')} (${validMonths} months)`], ['Covers', TRAVEL_COVER.mileage_payable.line(service.minutes)]];
  const body = html`${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
${testModeNotice(sandbox)}
<section class="card-gold booking-card" aria-labelledby="gv-review-title">
<h2 class="book-title" id="gv-review-title">Your gift voucher</h2>
<dl class="wed-list summary-list">${rows.map(([k, val]) => html`<div class="wed-row"><dt>${k}</dt><dd>${val}</dd></div>`)}</dl>
<dl class="wed-list summary-list price-review"><div class="wed-row"><dt>${service.minutes} minute private reading</dt><dd>${money(service.price_pence)}</dd></div>
<div class="wed-row price-total"><dt><strong>Total to pay</strong></dt><dd><strong class="assistant-price">${money(service.price_pence)}</strong></dd></div></dl>
<form method="post" action="/gift-vouchers/review" class="assistant-change">${keep}<input type="hidden" name="edit" value="1"><button class="link-gold link-button" type="submit">Change my details</button></form>
</section>
${conditionsPanel({ compact: true })}
${inAppWarning(ctx.request, { restartPath: '/gift-vouchers' })}<section class="card-blue share-card" aria-labelledby="gv-pay-title">
<h2 class="card-title" id="gv-pay-title">Secure payment</h2>
<form method="post" action="/gift-vouchers/buy" class="share-form" novalidate>
${keep}
${trap}
<div class="form-field form-check"><label><input type="checkbox" name="agree" value="1"${errors.agree ? raw(' aria-invalid="true" aria-describedby="err-agree"') : ''}> <span>I agree to pay <strong>${money(service.price_pence)}</strong> for this gift voucher, and I understand that it covers the reading; a Home Visit has the travel charge described above.</span></label>${err('agree')}</div>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="gift-voucher" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit">Proceed to Secure Payment: ${money(service.price_pence)}</button>
<p class="small">You pay on Square’s secure checkout page. New Way’s never sees your card details. Your voucher is made and sent as soon as your payment is confirmed.</p>
</form>
</section>
${paymentHelp(ctx.settings)}`;
  return page(ctx, { route: 'gift-vouchers', title: 'Gift Vouchers', body, mainClass: 'gap-26 booking-main gv-main', description: 'Your gift voucher.', canonicalPath: '/gift-vouchers' });
}

// The purchaser's own page (also where Square sends them back)
export function purchasePage(ctx, { p, voucher, self, payUrl, checkFailed, sandbox }) {
  const rows = [['Gift voucher', `${p.minutes} minute private reading`], ['Delivery', deliveryText(p)], ['Total', money(p.amount_pence)], ['Reference', p.reference]];
  let state;
  if (p.status === 'paid' && voucher) {
    state = html`<section class="card-blue order-state is-done" aria-labelledby="state"><h2 class="card-title" id="state">Thank you: your gift voucher is ready</h2>
<p>Your payment has been received. ${p.delivery === 'recipient' ? `The voucher has been emailed to ${p.recipient_name} at ${p.recipient_email}, and your receipt to ${p.purchaser_email}.` : `It has been emailed to you at ${p.purchaser_email}.`}</p>
<dl class="wed-list summary-list"><div class="wed-row"><dt>Voucher code</dt><dd><strong>${voucher.code}</strong></dd></div><div class="wed-row"><dt>Valid until</dt><dd>${longDate(voucher.expires_on, '0000')}</dd></div><div class="wed-row"><dt>Covers</dt><dd>${TRAVEL_COVER.mileage_payable.line(voucher.minutes)}</dd></div></dl>
<a class="btn-gold press" href="/gift-vouchers/print/${p.print_key}" target="_blank" rel="noopener">Download or print the voucher (A4 PDF)</a>
<p class="small">To use it, the recipient books on the Private Readings page and enters the code at the payment step.</p></section>`;
  } else if (p.status === 'paid' || p.status === 'needs_attention') {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Thank you, your payment was received</h2>
<p>${p.status === 'needs_attention' ? 'There was a problem preparing your voucher automatically, so Gary will check it and contact you personally.' : 'Your voucher is being prepared. Please check again in a moment.'}</p>
${p.status === 'paid' ? html`<a class="btn-outline-gold press" href="${self}">Check again</a>` : contactLine(ctx.settings)}</section>`;
  } else if (p.status === 'pending' && payUrl) {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Ready to pay</h2>
${checkFailed ? html`<p class="notice-bad" role="alert">We couldn’t check with Square just now. If you have already paid, please wait a minute and check again.</p>` : ''}
<a class="btn-gold press" href="${payUrl}" rel="external">Pay ${money(p.amount_pence)} securely with Square</a>
<p class="small">No voucher is made until your payment is confirmed. Already paid? <a class="link-gold" href="${self}">Check again</a></p>
${testModeNotice(sandbox)}</section>
${paymentHelp(ctx.settings)}`;
  } else if (p.status === 'pending') {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Checking your payment</h2>
<p>We’re waiting for Square to confirm your payment. This usually takes a few seconds.</p>
<a class="btn-outline-gold press" href="${self}">Check again</a></section>`;
  } else {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">This purchase was not completed</h2>
<p>No payment was taken and no voucher was made.</p><a class="btn-outline-gold press" href="/gift-vouchers">Buy a gift voucher</a></section>`;
  }
  const body = html`<section class="card-gold booking-card" aria-labelledby="gv-sum"><h2 class="book-title" id="gv-sum">Your gift voucher purchase</h2>
<dl class="wed-list summary-list">${rows.map(([k, val]) => html`<div class="wed-row"><dt>${k}</dt><dd>${val}</dd></div>`)}</dl></section>
${state}`;
  return page(ctx, { route: 'gift-vouchers', title: 'Gift Vouchers', body, mainClass: 'gap-26 booking-main gv-main', description: 'Your gift voucher purchase.', canonicalPath: '/gift-vouchers' });
}
