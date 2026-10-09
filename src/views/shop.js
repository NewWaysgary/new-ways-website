// Public screens for the Meditation Shop.
import { html, raw, formatText } from '../lib/html.js';
import { page } from './layout.js';
import { money } from '../notify.js';
import { testModeNotice } from './booking.js';

const media = (key) => '/media/' + encodeURIComponent(key);

function cover(p, cls = 'med-cover') {
  return p.cover_key ? html`<img class="${cls}" src="${media(p.cover_key)}" alt="Cover of ${p.title}" loading="lazy" decoding="async">` : '';
}

function preview(p) {
  return p.preview_key ? html`<div class="med-preview"><p class="small">Listen to a 1-minute preview</p><audio controls preload="none" src="/media/${p.preview_key}" aria-label="Preview of ${p.title}"></audio></div>` : '';
}

export function shopPage(ctx, { products, open, sandbox }) {
  const body = html`<p class="screen-sub">Guided meditations to download and keep.</p>
${testModeNotice(open && sandbox)}
${products.length ? html`<div class="med-grid">${products.map((p) => html`<article class="card-gold med-card" aria-labelledby="med-${p.id}">
${cover(p)}
<div class="med-body">
<h2 class="book-title" id="med-${p.id}">${p.title}</h2>
${p.by_line ? html`<p class="med-by">${p.by_line}</p>` : ''}
${p.narration_note ? html`<p class="small med-narration">${p.narration_note}</p>` : ''}
${p.short_description ? html`<p>${p.short_description}</p>` : ''}
${preview(p)}
<p class="med-price">${money(p.price_pence)}</p>
<a class="btn-gold press" href="/meditations/${p.slug}">${open ? 'More details and buy' : 'More details'}</a>
</div>
</article>`)}</div>` : html`<p class="empty-note">Meditations will be available here soon.</p>`}`;
  return page(ctx, { route: 'meditations', title: 'Meditations', body, mainClass: 'gap-26',
    description: 'Guided meditations by Medium Gary Findlay to download and keep, from New Way’s, Dundee.' });
}

export function productPage(ctx, { product: p, open, sandbox, terms, stamp, siteKey, values = {}, errors = {}, notice = '' }) {
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const body = html`<p class="screen-sub"><a class="link-gold" href="/meditations">All meditations</a></p>
${testModeNotice(open && sandbox)}
<article class="card-gold med-card med-single" aria-labelledby="med-title">
${cover(p, 'med-cover med-cover-lg')}
<div class="med-body">
<h2 class="book-title" id="med-title">${p.title}</h2>
${p.by_line ? html`<p class="med-by">${p.by_line}</p>` : ''}
${p.narration_note ? html`<p class="small med-narration">${p.narration_note}</p>` : ''}
${p.description ? html`<div class="prose">${formatText(p.description)}</div>` : p.short_description ? html`<p>${p.short_description}</p>` : ''}
${preview(p)}
<p class="med-price">${money(p.price_pence)}</p>
</div>
</article>
${open ? html`<section class="card-blue share-card" id="buy" aria-labelledby="buy-title">
<h2 class="card-title" id="buy-title">Buy this meditation</h2>
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
<form method="post" action="/meditations/${p.slug}/buy#buy" class="share-form" novalidate>
<input type="hidden" name="t" value="${stamp}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="form-field"><label for="m-name">Your name</label><input id="m-name" name="name" type="text" maxlength="80" autocomplete="name" value="${values.name || ''}" required${aria('name')}>${err('name')}</div>
<div class="form-field"><label for="m-email">Email address</label><input id="m-email" name="email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="email" inputmode="email" spellcheck="false" value="${values.email || ''}" required${aria('email')}>${err('email')}<p class="small">Your download link is sent here.</p></div>
<div class="form-field policy-box"><h3 class="policy-title">Personal-use terms</h3><div class="prose small">${formatText(terms)}</div></div>
<div class="form-field form-check"><label><input type="checkbox" name="terms" value="1"${values.terms ? raw(' checked') : ''}${aria('terms')}> I agree to these terms.</label>${err('terms')}</div>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="meditation" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit">Continue to secure payment</button>
<p class="small">You’ll pay ${money(p.price_pence)} on Square’s secure checkout page. New Way’s never sees your card details. See our <a href="/privacy">Privacy Notice</a>.</p>
</form>
</section>` : html`<section class="card-blue booking-closed"><p>Buying online will open here soon.</p></section>`}`;
  return page(ctx, { route: 'meditation', title: p.title, body, mainClass: 'gap-26 booking-main',
    description: (p.short_description || `${p.title}, a guided meditation by Medium Gary Findlay.`).slice(0, 300) });
}

const ukTime = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true })
  .format(new Date(iso)).replace(' at ', ', ');

// The download panel, used on the download page and the order page. It always shows the server's current state.
export function downloadPanel({ href, title, state, expires, windowEnds }) {
  if (state === 'available') {
    return html`<section class="card-blue order-state is-done download-panel" aria-labelledby="dl-title" data-download-state="available">
<h2 class="card-title" id="dl-title">${title}</h2>
<p class="download-count"><strong>1 download available</strong></p>
<p>Tap the button and the MP3 file will be saved to your phone or computer (usually in Downloads or My Files), so you can listen any time without coming back to the website.</p>
<a class="btn-gold press" href="${href}" rel="external" download data-download-once>Download your meditation</a>
<p class="small">You have until ${ukTime(expires)} (UK time) to start your one download.</p>
</section>`;
  }
  if (state === 'started') {
    return html`<section class="card-blue order-state download-panel" aria-labelledby="dl-title" data-download-state="started">
<h2 class="card-title" id="dl-title">DOWNLOAD LIMIT REACHED</h2>
<p>Your one download of “${title}” has started. Please check your Downloads or My Files.</p>
<p class="small">If the download didn’t finish, you can restart the same download until ${ukTime(windowEnds)} (UK time).</p>
<a class="btn-outline-gold press" href="${href}" rel="external" download data-download-once>Restart the download</a>
</section>`;
  }
  return html`<section class="card-blue order-state download-panel" aria-labelledby="dl-title" data-download-state="${state}">
<h2 class="card-title" id="dl-title">${state === 'used' ? 'DOWNLOAD LIMIT REACHED' : 'This download link has expired'}</h2>
<p>${state === 'used' ? `The one download included with “${title}” has been used.` : `The time to start the download of “${title}” has passed.`}</p>
<p class="small">If you had a problem with your download, please contact New Way’s and we’ll help.</p>
</section>`;
}

export function downloadPage(ctx, panel) {
  return page(ctx, { route: 'meditations', title: 'Your Download', body: downloadPanel(panel), mainClass: 'gap-26 booking-main', description: 'Download your meditation.' });
}
