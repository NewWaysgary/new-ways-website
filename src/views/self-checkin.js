// The iPad's own pages: setting it up (once), and the self check-in screens guests use at the entrance.
// The check-in screens are one page; the script (public/js/selfcheckin.js) moves between them and asks the website
// for names only when a guest scans a QR code or types their full name.
import { html } from '../lib/html.js';
import { ASSET_VERSION } from '../lib/http.js';

function shell({ title, body, scripts = [] }) {
  return html`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#000428">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="New Way’s Check-in">
<meta name="format-detection" content="telephone=no">
<title>${title}</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&amp;family=Jost:wght@400;500;600&amp;display=swap" crossorigin>
<link rel="stylesheet" href="/css/selfcheckin.css?v=${ASSET_VERSION}">
${scripts.map((src) => html`<script src="${src}" defer></script>`)}
</head>
<body>
${body}
</body>
</html>`;
}

const brand = html`<div class="sc-brand"><img src="/images/logo-480.webp" alt="New Way’s Mediumship Development Centre" width="240" height="240"></div>`;

export function pairPage({ code = '', problem = '' } = {}) {
  return shell({
    title: 'Set up self check-in | New Way’s',
    body: html`<main class="sc-setup">
${brand}
<h1>Set up this iPad for self check-in</h1>
<p>On Gary’s or Julie’s phone, open <strong>Admin › Check in › iPad self check-in</strong> and tap <strong>Show setup code</strong>. Type the 8-digit code here.</p>
${problem ? html`<p class="sc-problem" role="alert">${problem}</p>` : ''}
<form method="post" action="/self-checkin/connect" class="sc-setup-form" autocomplete="off">
<label for="sc-code">Setup code</label>
<input id="sc-code" name="code" inputmode="numeric" pattern="[0-9 ]*" maxlength="9" value="${code}" autocomplete="one-time-code" required>
<button class="sc-btn sc-btn-gold" type="submit">Connect this iPad</button>
</form>
<p class="sc-small">This iPad will only be able to check guests in. It can’t open Admin, and it never shows email addresses, phone numbers or payments.</p>
</main>`
  });
}

export function kioskPage({ version }) {
  return shell({
    title: 'Check in | New Way’s',
    scripts: [`/js/vendor/jsqr-1.4.0.js?v=${version}`, `/js/selfcheckin.js?v=${version}`],
    body: html`<main class="sc-app" id="sc-app" data-version="${version}">

<section class="sc-screen is-active" data-screen="loading" aria-live="polite">
${brand}
<p class="sc-lead">Getting ready…</p>
</section>

<section class="sc-screen" data-screen="closed" aria-labelledby="sc-closed-h">
${brand}
<h1 id="sc-closed-h">Check-In Closed.</h1>
<p class="sc-lead sc-lead-big">Please See Julie.</p>
<p class="sc-staff" data-staff-note></p>
</section>

<section class="sc-screen" data-screen="paused" aria-labelledby="sc-paused-h">
${brand}
<h1 id="sc-paused-h">Check-In Temporarily Paused.</h1>
<p class="sc-lead sc-lead-big">Please See Julie.</p>
</section>

<section class="sc-screen" data-screen="welcome" aria-labelledby="sc-welcome-h">
${brand}
<h1 id="sc-welcome-h">Welcome to New Way’s</h1>
<p class="sc-event"><span data-event-name></span><span class="sc-event-when" data-event-when></span></p>
<p class="sc-lead">Please check in for tonight</p>
<div class="sc-choices">
<button type="button" class="sc-choice sc-choice-gold" data-go="scan"><span class="sc-choice-icon" aria-hidden="true"><svg viewBox="0 0 48 48" width="64" height="64"><path d="M6 16V8a2 2 0 0 1 2-2h8M32 6h8a2 2 0 0 1 2 2v8M42 32v8a2 2 0 0 1-2 2h-8M16 42H8a2 2 0 0 1-2-2v-8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><rect x="13" y="13" width="9" height="9" rx="1.5" fill="currentColor"/><rect x="26" y="13" width="9" height="9" rx="1.5" fill="currentColor"/><rect x="13" y="26" width="9" height="9" rx="1.5" fill="currentColor"/><path d="M27 27h3v3h-3zM32 32h3v3h-3zM27 33h2M33 27h2" stroke="currentColor" stroke-width="2.5"/></svg></span><span class="sc-choice-label">Scan QR Code</span><span class="sc-choice-sub">From your booking email</span></button>
<button type="button" class="sc-choice" data-go="name"><span class="sc-choice-icon" aria-hidden="true"><svg viewBox="0 0 48 48" width="64" height="64"><circle cx="24" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M8 42c1.5-9 8-13 16-13s14.5 4 16 13" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg></span><span class="sc-choice-label">Enter Your Name</span><span class="sc-choice-sub">No QR code with you?</span></button>
</div>
<p class="sc-help">Need help? Please see Julie.</p>
</section>

<section class="sc-screen" data-screen="scan" aria-labelledby="sc-scan-h">
<h1 id="sc-scan-h">Scan your QR code</h1>
<p class="sc-lead">Hold the QR code from your booking email up to the iPad’s camera (the small lens in the iPad’s frame), about a hand’s width away.</p>
<div class="sc-camera"><video playsinline muted autoplay data-video></video><div class="sc-frame" aria-hidden="true"></div></div>
<p class="sc-status" data-scan-status aria-live="polite"></p>
<div class="sc-actions">
<button type="button" class="sc-btn" data-go="name">Enter my name instead</button>
<button type="button" class="sc-btn sc-btn-quiet" data-go="welcome">Cancel</button>
</div>
</section>

<section class="sc-screen" data-screen="booking" aria-labelledby="sc-booking-h">
<h1 id="sc-booking-h">Who is checking in now?</h1>
<p class="sc-lead" data-booking-lead>Tap each person who is here, then tap Check In. Anyone arriving later can check in when they arrive.</p>
<div class="sc-guests" data-guests role="group" aria-labelledby="sc-booking-h"></div>
<p class="sc-status" data-retry-status aria-live="polite"></p>
<div class="sc-actions">
<button type="button" class="sc-btn" data-select-all hidden>Select everyone</button>
<button type="button" class="sc-btn sc-btn-green" data-checkin-selected disabled>Check In</button>
</div>
<div class="sc-actions"><button type="button" class="sc-btn sc-btn-quiet" data-go="welcome">Cancel</button></div>
</section>

<section class="sc-screen" data-screen="name" aria-labelledby="sc-name-h">
<h1 id="sc-name-h">Enter your full name</h1>
<p class="sc-lead">Your first name and surname, as it was booked.</p>
<form class="sc-name-form" data-name-form autocomplete="off" novalidate>
<label class="sr-only" for="sc-name">Your full name</label>
<input id="sc-name" name="name" type="text" maxlength="80" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" enterkeyhint="search" placeholder="First name and surname" data-name-input>
<p class="sc-status" data-name-status aria-live="polite"></p>
<div class="sc-actions">
<button type="submit" class="sc-btn sc-btn-gold">Find my booking</button>
<button type="button" class="sc-btn sc-btn-quiet" data-go="welcome">Cancel</button>
</div>
</form>
</section>

<section class="sc-screen" data-screen="one" aria-labelledby="sc-one-h">
<h1 id="sc-one-h">Welcome</h1>
<p class="sc-bigname" data-one-name></p>
<p class="sc-lead">Tap Check In to let us know you’re here.</p>
<div class="sc-actions sc-actions-stack">
<button type="button" class="sc-btn sc-btn-green sc-btn-huge" data-checkin-one>Check In</button>
<p class="sc-status" data-retry-status-one aria-live="polite"></p>
<button type="button" class="sc-btn sc-btn-quiet" data-go="name">This isn’t me</button>
</div>
</section>

<section class="sc-screen" data-screen="done" aria-labelledby="sc-done-h">
<div class="sc-tick" aria-hidden="true"><svg viewBox="0 0 64 64" width="140" height="140"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="4"/><path d="M19 33l9 9 17-19" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
<h1 id="sc-done-h" data-done-title>You’re checked in</h1>
<p class="sc-names" data-done-names></p>
<p class="sc-saved" data-done-saved hidden>Saved on this iPad while the internet connection is down. It is added to Julie’s list automatically as soon as the connection returns.</p>
<p class="sc-lead">Enjoy your evening at New Way’s.</p>
<div class="sc-timer" aria-hidden="true"><span data-timer></span></div>
</section>

<section class="sc-screen" data-screen="message" aria-labelledby="sc-msg-h">
${brand}
<h1 id="sc-msg-h" data-msg-title></h1>
<p class="sc-lead" data-msg-text></p>
<div class="sc-actions">
<button type="button" class="sc-btn sc-btn-gold" data-msg-retry hidden>Try again</button>
<button type="button" class="sc-btn" data-go="welcome">Back to the start</button>
</div>
<div class="sc-timer" aria-hidden="true"><span data-timer></span></div>
</section>

<p class="sc-net" data-net hidden role="status" aria-live="polite"></p>
<p class="sc-mode sc-mode-test" data-mode-test hidden>TEST MODE · practice only · nothing is recorded for real</p>
<p class="sc-mode sc-mode-live" data-mode-live hidden>Live check-in</p>
<noscript><p class="sc-offline">Please see Julie to check in.</p></noscript>
</main>`
  });
}
