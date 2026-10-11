// The Support New Way's page, and the donor's own page after paying. Same cards, buttons and colours as the rest of
// the site.
import { html, raw, formatText } from '../lib/html.js';
import { page } from './layout.js';
import { testModeNotice } from './booking.js';
import { pounds } from '../donations/model.js';

const when = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

export function supportPage(ctx, { open, sandbox, intro, thanks, supporters, stamp, siteKey, values = {}, errors = {}, notice = '' }) {
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const form = !open ? html`<section class="card-blue share-card"><p>Donations online aren’t available at the moment. Please contact New Way’s if you would like to make a donation.</p></section>`
    : html`<section class="card-blue share-card" aria-labelledby="donate-title">
<h2 class="card-title" id="donate-title">Make a donation</h2>
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
<form method="post" action="/support/donate" class="share-form" novalidate>
<input type="hidden" name="t" value="${stamp}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="form-field"><label for="d-amount">Your donation (£)</label>
<span class="price-input"><span aria-hidden="true">£</span><input id="d-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" maxlength="12" value="${values.amount || ''}" required${aria('amount')}></span>
<p class="small">Enter any amount you would like to give.</p>${err('amount')}</div>
<div class="form-field"><label for="d-name">Your name</label><input id="d-name" name="name" type="text" maxlength="80" autocomplete="name" value="${values.name || ''}" required${aria('name')}>${err('name')}</div>
<div class="form-field"><label for="d-email">Email address</label><input id="d-email" name="email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="email" inputmode="email" spellcheck="false" value="${values.email || ''}" required${aria('email')}>
<p class="small">We send your thank-you and confirmation here.</p>${err('email')}</div>
<fieldset class="form-field"><legend>On our Supporters list</legend>
<div class="choice-list">
<label><input type="radio" name="display" value="public"${values.display === 'public' ? raw(' checked') : ''}${aria('display')}> <span>Show my name and my donation on the Supporters list</span></label>
<label><input type="radio" name="display" value="anonymous"${values.display === 'anonymous' ? raw(' checked') : ''}${aria('display')}> <span>Keep my donation anonymous (not shown anywhere)</span></label>
</div>${err('display')}</fieldset>
<div class="form-field"><label for="d-public">Name to show on the list (optional)</label><input id="d-public" name="public_name" type="text" maxlength="60" value="${values.public_name || ''}"${aria('public_name')}>
<p class="small">Only used if you choose to be shown. Leave empty to use your name, or write it as you would like it, for example “Margaret, Dundee”.</p>${err('public_name')}</div>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="donation" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit">Continue to secure payment</button>
<p class="small">You pay on Square’s secure checkout page; New Way’s never sees your card details. See our <a href="/privacy">Privacy Notice</a>.</p>
</form></section>`;
  const body = html`${intro && intro.body ? html`<section class="card-gold text-card" aria-label="Support New Way’s"><div class="prose">${formatText(intro.body, { replaceTokens: ctx.fill })}</div></section>` : ''}
${testModeNotice(open && sandbox)}
${form}
<section class="card-gold text-card supporters" aria-labelledby="supporters-title">
<h2 class="card-title" id="supporters-title">Our Supporters</h2>
${supporters.length ? html`<ul class="supporter-list">${supporters.map((s) => html`<li><span class="supporter-name">${s.public_name}</span><span class="supporter-amount">${pounds(s.amount_pence)}</span></li>`)}</ul>`
    : html`<p class="small">Supporters who choose to be recognised will be listed here.</p>`}
${thanks && thanks.body ? html`<div class="prose supporters-thanks">${formatText(thanks.body, { replaceTokens: ctx.fill })}</div>` : ''}
</section>`;
  return page(ctx, { route: 'support', title: 'Support New Way’s', body, mainClass: 'gap-26 booking-main', canonicalPath: '/support',
    description: 'Make a donation to New Way’s Mediumship Development Centre in Dundee, and see our Supporters.' });
}

export function donationPage(ctx, { d, payUrl, self, checkFailed, sandbox, goToPay = false }) {
  let state;
  if (d.status === 'paid') {
    state = html`<section class="card-blue order-state is-done" aria-labelledby="st"><h2 class="card-title" id="st">Thank you, ${d.donor_name || 'friend'}</h2>
<p>Your donation of <strong>${pounds(d.amount_pence)}</strong> to New Way’s Mediumship Development Centre has been received. A thank-you has been emailed to you${d.donor_email ? html` at ${d.donor_email}` : ''}.</p>
<p>${d.show_publicly ? html`Your name (${d.public_name}) is now on our <a class="link-gold" href="/support">Supporters list</a>.` : 'As you asked, your donation is anonymous.'}</p>
<p class="small">Reference ${d.reference}</p></section>`;
  } else if (d.status === 'needs_attention') {
    state = html`<section class="card-blue order-state"><h2 class="card-title">Thank you, your payment was received</h2><p>There was a problem confirming it automatically, so New Way’s will be in touch.</p></section>`;
  } else if (d.status === 'pending') {
    state = html`<section class="card-blue order-state" aria-labelledby="st"><h2 class="card-title" id="st">${payUrl ? 'Your donation: waiting for payment' : 'Checking your payment'}</h2>
${checkFailed ? html`<p class="notice-bad" role="alert">We couldn’t check with Square just now. If you have already paid, please wait a minute and check again.</p>` : ''}
${payUrl && goToPay ? html`<p data-go-pay-note>Opening Square’s secure payment page… If it doesn’t open, press the button below.</p>` : ''}
${payUrl ? html`<a class="btn-gold press" href="${payUrl}" rel="external"${goToPay ? raw(' data-go-pay') : ''}>Donate ${pounds(d.amount_pence)} securely with Square</a>` : ''}
<a class="btn-outline-gold press" href="${self}">Already paid? Check again</a>${testModeNotice(sandbox)}</section>`;
  } else {
    state = html`<section class="card-blue order-state"><h2 class="card-title">This donation wasn’t completed</h2><p>No payment was taken.</p><a class="btn-outline-gold press" href="/support">Back to Support New Way’s</a></section>`;
  }
  return page(ctx, { route: 'support', title: d.status === 'paid' ? 'Thank You' : 'Your Donation', body: state, mainClass: 'gap-26 booking-main', canonicalPath: '/support',
    description: 'Your donation to New Way’s.' });
}

export function messagePage(ctx, { title, message }) {
  return page(ctx, { route: 'support', title, body: html`<section class="card-blue order-state"><h2 class="card-title">${title}</h2><p>${message}</p><a class="btn-outline-gold press" href="/support">Support New Way’s</a></section>`,
    mainClass: 'gap-26 booking-main', canonicalPath: '/support', description: title });
}

export { when };
