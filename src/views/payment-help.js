// Help shown before and during payment on Square's secure checkout page (event tickets, reservations and private
// readings): what to do if the bank's approval request doesn't arrive, and a warning for people using the browser
// built into Facebook, Messenger or Instagram, where switching to a banking app and back can break the approval step.
import { html } from '../lib/html.js';

// Facebook / Messenger / Instagram's own browser (as the apps describe themselves to websites)
export function inAppBrowser(request) {
  const ua = String(request?.headers?.get('User-Agent') || '');
  if (!/FBAN|FBAV|FB_IAB|FB4A|FBIOS|FBSS|Instagram|MessengerForiOS|\bMessenger\b/i.test(ua)) return null;
  return { android: /Android/i.test(ua), iphone: /iPhone|iPad|iPod/i.test(ua) };
}

// Opens the same page in Chrome on Android (Android's own way of choosing the app for a link)
function chromeIntent(url) {
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

// restartPath: for a page that is the answer to a form (POST), the page to open in Chrome instead (the details typed
// so far can't come along, so the customer is told they will need to fill them in again)
export function inAppWarning(request, { restartPath = '', note = '' } = {}) {
  const where = inAppBrowser(request);
  if (!where) return '';
  const url = new URL(request.url);
  const posted = request.method !== 'GET';
  const target = posted ? (restartPath ? new URL(restartPath, url.origin) : null) : url;
  const here = target && (target.protocol === 'https:' || target.hostname === 'localhost') ? target.href : '';
  return html`<section class="card-blue notice-inapp" role="note" aria-labelledby="inapp-title" data-inapp-warning>
<h2 class="card-title" id="inapp-title">Please open this page in ${where.iphone ? 'Safari' : 'Chrome'} before paying</h2>
<p>You seem to be using the browser inside Facebook${where.iphone ? ', Messenger or Instagram' : ' or Messenger'}. When your bank asks you to approve the payment in its app, switching to the banking app and back can stop the payment finishing here.</p>
${where.android && here ? html`<p><a class="btn-gold press" href="${chromeIntent(here)}" rel="external">Open in Chrome</a></p>` : ''}
<p class="small">${where.iphone ? 'Tap the ••• (or the compass) at the top or bottom of the screen, then choose Open in Safari (or Open in browser).' : 'Or tap the ⋮ at the top right of the screen, then choose Open in Chrome (or Open in external browser).'} ${note || (posted ? 'You will need to fill in your details again there.' : 'Nothing has been booked or paid yet.')}</p>
</section>`;
}

// What to do if the bank's approval doesn't arrive. holdText: e.g. "Your places are held until 7:15pm."
export function paymentHelp(settings = {}, { holdText = '' } = {}) {
  const contact = [settings.phone && html`call <a href="tel:${String(settings.phone).replace(/[^\d+]/g, '')}">${settings.phone}</a>`,
    settings.email && html`email <a href="mailto:${settings.email}">${settings.email}</a>`].filter(Boolean);
  return html`<section class="card-blue pay-help" aria-labelledby="pay-help-title" data-payment-help>
<h2 class="card-title" id="pay-help-title">If your bank’s approval doesn’t arrive</h2>
${holdText ? html`<p><strong>${holdText}</strong></p>` : ''}
<p class="small">Some banks ask you to approve a payment in their app. If the approval request doesn’t appear:</p>
<ol class="pay-help-list small">
<li>Open your banking app yourself and look for the approval request (it may be under notifications or messages). Keep this page open.</li>
<li>Try Google Pay or Apple Pay, if Square shows it on the payment page and your phone has it set up.</li>
<li>Try a different debit or credit card.</li>
<li>If you still can’t pay, please contact New Way’s${contact.length ? html`: ${contact.map((c, i) => html`${i ? ' or ' : ''}${c}`)}` : ''}. You are only charged if a payment is completed.</li>
</ol>
</section>`;
}
