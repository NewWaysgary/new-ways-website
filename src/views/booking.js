// Public screens for booking a private reading and for the customer's order page.
import { milesText, visitAddress } from '../bookings/travel.js';
import { html, raw, formatText } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { longDate } from '../lib/dates.js';
import { friendlyTime, WEEKDAYS } from '../bookings/availability.js';
import { page } from './layout.js';
import { money } from '../notify.js';
import { downloadPanel } from './shop.js';
import { inAppWarning, paymentHelp } from './payment-help.js';

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
export function readingsPage(ctx, { block, services, open, sandbox, homeVisits = false }) {
  const body = html`<div class="halo halo-readings">
<div class="halo-glow breathe" aria-hidden="true"></div>
<div class="halo-arc-gold spin" aria-hidden="true"></div>
<div class="halo-arc-blue spin-back" aria-hidden="true"></div>
<span class="readings-core">${icon('lotus', 34)}</span>
</div>
<div class="readings-text">${formatText(block.body, { replaceTokens: ctx.fill })}</div>
${open ? html`<section class="stack-10 reading-choices" aria-labelledby="choose-reading">
<h2 class="card-title" id="choose-reading">Choose your reading</h2>
${services.map((s) => html`<a class="btn-gold press reading-choice" href="/private-readings/book${q({ reading: s.code })}"><span>${s.name}</span></a>`)}
<p class="small">${homeVisits ? 'Choose a date and time on the next screen, then choose a WhatsApp video call or a home visit.' : 'Choose a date and time on the next screen. Readings take place by WhatsApp video call.'}</p>
${testModeNotice(sandbox)}
</section>` : html`<section class="card-blue booking-closed" aria-labelledby="booking-soon">
<h2 class="card-title" id="booking-soon">Online booking</h2>
<p>Online booking will open here soon.</p>
${contactLine(ctx.settings)}
</section>`}`;
  return page(ctx, { route: 'private-readings', title: 'Private Readings', body, mainClass: 'readings-main',
    description: homeVisits ? 'Book a private reading with Medium Gary Findlay by WhatsApp video call or in your own home. Choose an available date and time and book securely online.' : 'Book a private reading with Medium Gary Findlay by WhatsApp video call. Choose an available date and time and book securely online.' });
}

// ---------- step 1 and 2: date and time ----------
export function calendarPage(ctx, { service, services, month, months, days, selected, times, sandbox, homeVisits = false }) {
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
<p class="book-sub">${service.minutes} minutes · ${homeVisits ? 'WhatsApp video call or home visit' : 'WhatsApp video call'}</p>
${services.length > 1 ? html`<p class="small">${services.filter((s) => s.code !== service.code).map((s) => html`<a class="link-gold" href="/private-readings/book${q({ reading: s.code, month })}">Switch to the ${s.name.toLowerCase()}</a>`)}</p>` : ''}
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

// ---------- step 3: the booking assistant asks for the customer's details (no price is shown or sent yet) ----------
const bot = (body) => html`<li class="chat-msg chat-staff"><p class="chat-who">New Way’s booking assistant</p><div class="chat-body">${body}</div></li>`;
const ask = (body) => html`<div class="chat-msg chat-staff"><p class="chat-who">New Way’s booking assistant</p><div class="chat-body">${body}</div></div>`;
const you = (body) => html`<li class="chat-msg chat-you"><p class="chat-who">You</p><div class="chat-body">${body}</div></li>`;
const METHOD = { whatsapp: 'WhatsApp Video Call', home: 'Home Visit (In Person)' };
const chosen = (service, date, time, method = null) => html`You’ve chosen a <strong>${service.name}</strong> on <strong>${longDate(date)}</strong> at <strong>${friendlyTime(time)}</strong> (UK time)${method === 'home' ? html`, as a <strong>home visit</strong>: Gary comes to your home` : method === 'whatsapp' || method === null ? ', by WhatsApp video call' : ''}.`;
const poundsOf = (p) => money(p);

export function detailsPage(ctx, { service, date, time, stamp, values = {}, errors = {}, notice = '', sandbox, homeVisits = false, alternatives = null }) {
  const m = values.method === 'home' ? 'home' : values.method === 'whatsapp' ? 'whatsapp' : '';
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const body = html`<p class="screen-sub"><a class="link-gold" href="/private-readings/book${q({ reading: service.code, month: date.slice(0, 7), date })}#times">Back to dates and times</a></p>
${testModeNotice(sandbox)}
${inAppWarning(ctx.request, { restartPath: `/private-readings/book/details${q({ reading: service.code, date, time })}` })}
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${alternatives ? otherTimes(service, values, stamp, alternatives) : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">${!homeVisits && errors.method ? errors.method : 'Please check the highlighted details.'}</p>` : ''}
<section class="card-gold chat-card booking-assistant" aria-labelledby="assistant-title">
<h2 class="book-title" id="assistant-title">Your booking</h2>
<form method="post" action="/private-readings/book/details" class="share-form" novalidate data-assistant>
<input type="hidden" name="t" value="${stamp}">
<input type="hidden" name="reading" value="${service.code}">
<input type="hidden" name="date" value="${date}">
<input type="hidden" name="time" value="${time}">
${values.draft ? html`<input type="hidden" name="draft" value="${values.draft}">` : ''}
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<ol class="chat-list assistant-list" aria-live="polite">
${bot(html`<p>Hello, and thank you for choosing a private reading with Medium Gary Findlay.</p><p>${chosen(service, date, time, homeVisits ? '' : 'whatsapp')}</p><p>I just need a few details to complete your booking.</p>`)}
${homeVisits ? html`<li class="assistant-step" data-step data-step-kind="method" data-msg="Please choose how you would like your reading.">${ask(html`<p id="b-method-q"><strong>How would you like your reading?</strong></p>`)}
<div class="form-field assistant-answer method-choice" role="radiogroup" aria-labelledby="b-method-q"${errors.method ? raw(' aria-invalid="true" aria-describedby="err-method"') : ''}>
<label class="method-option"><input type="radio" name="method" value="whatsapp"${m === 'whatsapp' ? raw(' checked') : ''} required> <span><strong>WhatsApp Video Call</strong><span class="small">Your reading by video call on WhatsApp, wherever you are.</span></span></label>
<label class="method-option"><input type="radio" name="method" value="home"${m === 'home' ? raw(' checked') : ''}> <span><strong>Home Visit (In Person)</strong><span class="small">Gary comes to your home for your reading. A travel charge is added, worked out from your address.</span></span></label>
${err('method')}</div></li>` : html`<input type="hidden" name="method" value="whatsapp">`}
<li class="assistant-step" data-step data-msg="Please enter your full name.">${ask(html`<label for="b-name">What is your full name?</label>`)}
<div class="form-field assistant-answer"><input id="b-name" name="name" type="text" maxlength="80" autocomplete="name" value="${values.name || ''}" required${aria('name')}>${err('name')}</div></li>
<li class="assistant-step" data-step data-msg="Please enter your mobile number, for example 07700 900123.">${ask(html`<label for="b-phone"><span data-for-method="whatsapp"${m === 'home' ? raw(' hidden') : ''}>Thank you. What is the mobile number connected to your WhatsApp?</span><span data-for-method="home"${m === 'home' ? '' : raw(' hidden')}>Thank you. What is the best mobile number to contact you on?</span></label><p class="small" data-for-method="whatsapp"${m === 'home' ? raw(' hidden') : ''}>${homeVisits ? 'For a WhatsApp reading, it takes place by video call on this number.' : 'Your reading takes place by WhatsApp video call on this number.'}</p><p class="small" data-for-method="home"${m === 'home' ? '' : raw(' hidden')}>Gary will use this if he needs to contact you about your visit.</p>`)}
<div class="form-field assistant-answer"><input id="b-phone" name="phone" type="tel" maxlength="24" autocomplete="tel" inputmode="tel" value="${values.phone || ''}" required${aria('phone')}>${err('phone')}</div></li>
<li class="assistant-step" data-step data-msg="Please enter your full email address.">${ask(html`<label for="b-email"><span data-for-method="whatsapp"${m === 'home' ? raw(' hidden') : ''}>And finally, your email address?</span><span data-for-method="home"${m === 'home' ? '' : raw(' hidden')}>Your email address?</span></label><p class="small">Your confirmation is sent here.</p><p class="small">If you don’t finish booking, these details are kept for up to 24 hours so we can check the booking system is working, then deleted. We won’t use them to contact you or for marketing.</p>`)}
<div class="form-field assistant-answer"><input id="b-email" name="email" type="email" autocapitalize="none" autocorrect="off" maxlength="254" autocomplete="email" inputmode="email" spellcheck="false" value="${values.email || ''}" required${aria('email')}>${err('email')}</div></li>
${homeVisits ? html`<li class="assistant-step" data-step data-only-method="home" data-msg="Please enter your house or flat number (or property name), your street name and your town."${m === 'whatsapp' ? raw(' hidden') : ''}>${ask(html`<p><strong>${m ? '' : html`<span data-no-method>(Home visits only) </span>`}What is your home address?</strong></p><p class="small">This is where Gary will come for your reading, so please give the exact property.</p>`)}
<div class="form-field assistant-answer${errors.house ? ' has-error' : ''}"><label for="b-house">House or flat number, or property name</label><input id="b-house" name="house" data-msg="Please enter your house or flat number, or your property’s name, so Gary knows exactly where to come." type="text" maxlength="60" autocomplete="off" placeholder="e.g. 57, Flat 2/1 or Rose Cottage" value="${values.house || ''}"${aria('house')}>${err('house')}</div>
<div class="form-field assistant-answer${errors.street ? ' has-error' : ''}"><label for="b-street">Street name</label><input id="b-street" name="street" data-msg="Please enter your street name." type="text" maxlength="80" autocomplete="off" placeholder="e.g. Findhorn Place" value="${values.street || ''}"${aria('street')}>${err('street')}</div>
<div class="form-field assistant-answer${errors.town ? ' has-error' : ''}"><label for="b-town">Town or city</label><input id="b-town" name="town" data-msg="Please enter your town or city." type="text" maxlength="60" autocomplete="address-level2" value="${values.town || ''}"${aria('town')}>${err('town')}</div></li>
<li class="assistant-step" data-step data-only-method="home" data-msg="Please enter your full UK postcode, for example DD2 2SJ."${m === 'whatsapp' ? raw(' hidden') : ''}>${ask(html`<label for="b-postcode">${m ? '' : html`<span data-no-method>(Home visits only) </span>`}And your postcode?</label><p class="small">The travel charge is worked out from the driving distance to your postcode and back.</p>`)}
<div class="form-field assistant-answer"><input id="b-postcode" name="postcode" type="text" maxlength="10" autocomplete="postal-code" autocapitalize="characters" spellcheck="false" value="${values.postcode || ''}"${aria('postcode')}>${err('postcode')}</div></li>` : ''}
</ol>
<button class="btn-gold press" type="submit" data-step-done>Continue</button>
<p class="small">See our <a href="/privacy">Privacy Notice</a> for how your details are used.</p>
</form>
</section>`;
  return page(ctx, { route: 'private-readings', title: 'Your Reading', body, mainClass: 'gap-26 booking-main',
    description: 'Add your details for your private reading.' });
}

// Other times that suit this home visit: each one sends the same details again with the new time (nothing retyped)
function otherTimes(service, values, stamp, alternatives) {
  const keep = (t) => html`<input type="hidden" name="t" value="${stamp}"><input type="hidden" name="reading" value="${service.code}"><input type="hidden" name="date" value="${t.date}"><input type="hidden" name="time" value="${t.time}"><input type="hidden" name="method" value="home"><input type="hidden" name="name" value="${values.name}"><input type="hidden" name="phone" value="${values.phone}"><input type="hidden" name="email" value="${values.email}"><input type="hidden" name="house" value="${values.house}"><input type="hidden" name="street" value="${values.street}"><input type="hidden" name="town" value="${values.town}"><input type="hidden" name="postcode" value="${values.postcode}">${values.draft ? html`<input type="hidden" name="draft" value="${values.draft}">` : ''}<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>`;
  return html`<section class="card-gold share-card other-times" aria-labelledby="ot-h"><h2 class="book-title" id="ot-h">Times that suit a home visit to you</h2>
${alternatives.length ? html`<p class="small">Tap a time to continue with the same details.</p>
<div class="other-times-list">${alternatives.map((t) => html`<form method="post" action="/private-readings/book/details">${keep(t)}<button class="btn-outline-gold press" type="submit">${t.label}</button></form>`)}</div>`
    : html`<p class="small">There’s no time in the next two weeks that suits a home visit to your address.</p>`}
<p><a class="link-gold" href="/private-readings/book${q({ reading: service.code, month: values.date.slice(0, 7), date: values.date })}#times">See all dates and times</a></p></section>`;
}

// ---------- a home visit outside Gary's 20-mile area: offer a WhatsApp video reading instead (no price yet) ----------
export function outsideAreaPage(ctx, { service, date, time, stamp, values, sandbox }) {
  const keep = html`<input type="hidden" name="t" value="${stamp}">
<input type="hidden" name="reading" value="${service.code}"><input type="hidden" name="date" value="${date}"><input type="hidden" name="time" value="${time}">
<input type="hidden" name="name" value="${values.name}"><input type="hidden" name="phone" value="${values.phone}"><input type="hidden" name="email" value="${values.email}">
${values.draft ? html`<input type="hidden" name="draft" value="${values.draft}">` : ''}`;
  const body = html`<p class="screen-sub"><a class="link-gold" href="/private-readings/book${q({ reading: service.code, month: date.slice(0, 7), date })}#times">Back to dates and times</a></p>
${testModeNotice(sandbox)}
<section class="card-gold chat-card booking-assistant" aria-labelledby="assistant-title">
<h2 class="book-title" id="assistant-title">Your booking</h2>
<ol class="chat-list assistant-list" aria-live="polite">
${you(html`<p>Home Visit (In Person)<br>${visitAddress(values)}, ${values.postcode}</p>`)}
${bot(html`<p>Thank you for your interest in booking a private reading with Gary.</p><p>Unfortunately, your address is outside Gary’s 20-mile home-visit area.</p><p>However, Gary also offers private readings through WhatsApp video call, so you can still enjoy your reading from the comfort of your own home, wherever you live.</p><p><strong>Would you like to continue with a WhatsApp video reading instead?</strong></p>`)}
</ol>
<form method="post" action="/private-readings/book/details" class="share-form" data-outside-area>${keep}<input type="hidden" name="method" value="whatsapp">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<p class="small">Your ${service.minutes} minute reading on ${longDate(date)} at ${friendlyTime(time)} (UK time), with your name, ${values.phone} and ${values.email}, is kept. The reading takes place by WhatsApp video call on this number, so please make sure it is connected to WhatsApp.</p>
<button class="btn-gold press" type="submit">YES — SWITCH TO WHATSAPP VIDEO CALL</button>
</form>
<a class="btn-outline-gold press cancel-booking" href="/private-readings">NO — CANCEL BOOKING</a>
<p class="small">Nothing has been booked or charged.</p>
</section>`;
  return page(ctx, { route: 'private-readings', title: 'Your Reading', body, mainClass: 'gap-26 booking-main', description: 'Your private reading.' });
}

// ---------- step 4: the price of the chosen reading, the cancellation policy, then Square ----------
export function payStepPage(ctx, { service, date, time, policy, holdMinutes, stamp, siteKey, values, errors = {}, notice = '', sandbox, voucher = null, quote = null }) {
  const home = values.method === 'home' && quote;
  // A gift voucher accepted: for a home visit, what the voucher covers decides whether the travel is free or payable
  const accepted = voucher && voucher.accepted && (!home || voucher.cover === 'free_mileage' || voucher.cover === 'mileage_payable');
  const travelDue = accepted && home && voucher.cover === 'mileage_payable' ? quote.travelPence : 0;
  const total = accepted ? travelDue : service.price_pence + (home ? quote.travelPence : 0);
  const err = (k) => (errors[k] ? html`<p class="field-error" id="err-${k}">${errors[k]}</p>` : '');
  const aria = (k) => (errors[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const keep = html`<input type="hidden" name="t" value="${stamp}">
<input type="hidden" name="reading" value="${service.code}">
<input type="hidden" name="date" value="${date}">
<input type="hidden" name="time" value="${time}">
<input type="hidden" name="name" value="${values.name}">
<input type="hidden" name="phone" value="${values.phone}">
<input type="hidden" name="email" value="${values.email}">
<input type="hidden" name="method" value="${home ? 'home' : 'whatsapp'}">
${home ? html`<input type="hidden" name="house" value="${values.house}"><input type="hidden" name="street" value="${values.street}"><input type="hidden" name="town" value="${values.town}"><input type="hidden" name="postcode" value="${quote.postcode}">
<input type="hidden" name="q_postcode" value="${quote.postcode}"><input type="hidden" name="q_miles" value="${String(quote.oneWayMiles)}"><input type="hidden" name="q_return" value="${String(quote.returnMiles)}"><input type="hidden" name="q_pence" value="${String(quote.travelPence)}"><input type="hidden" name="q_minutes" value="${String(quote.travelMinutes)}"><input type="hidden" name="q_at" value="${String(quote.at)}"><input type="hidden" name="q_sig" value="${quote.sig}">` : ''}
${values.draft ? html`<input type="hidden" name="draft" value="${values.draft}">` : ''}`;
  const first = String(values.name).trim().split(/\s+/)[0];
  const body = html`<p class="screen-sub"><a class="link-gold" href="/private-readings/book${q({ reading: service.code, month: date.slice(0, 7), date })}#times">Back to dates and times</a></p>
${testModeNotice(sandbox)}
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
<section class="card-gold chat-card booking-assistant" aria-labelledby="assistant-title">
<h2 class="book-title" id="assistant-title">Your booking</h2>
<ol class="chat-list assistant-list">
${bot(html`<p>${chosen(service, date, time, home ? 'home' : 'whatsapp')}</p>`)}
${you(html`<p>${home ? 'Home Visit (In Person)' : 'WhatsApp Video Call'}<br>${values.name}<br>${values.phone}<br>${values.email}${home ? html`<br>${visitAddress(values)}, ${quote.postcode}` : ''}</p>`)}
${accepted && home ? bot(html`<p>Thank you, ${first}. Here is your booking review:</p><dl class="wed-list summary-list price-review"><div class="wed-row"><dt>${service.minutes} minute reading</dt><dd>Covered by your gift voucher</dd></div><div class="wed-row"><dt>Return travel</dt><dd>${quote.returnMiles} miles</dd></div><div class="wed-row"><dt>Travel charge at £0.60 a mile</dt><dd>${travelDue ? money(travelDue) : html`<s>${money(quote.travelPence)}</s> FREE with your voucher`}</dd></div><div class="wed-row price-total"><dt><strong>Total to pay</strong></dt><dd><strong class="assistant-price">${money(travelDue)}</strong></dd></div></dl><p class="small">Return travel: ${quote.returnMiles} miles (${milesText(quote.oneWayMiles)} miles each way by road, there and back, rounded up to a whole mile).</p><p class="small">Gary will come to <strong>${visitAddress(values)}, ${quote.postcode}</strong>.</p>`)
    : accepted ? bot(html`<p>Thank you, ${first}. Your gift voucher covers your ${service.minutes} minute reading, so there is nothing to pay.</p>`)
    : home ? bot(html`<p>Thank you, ${first}. Here is your booking review:</p><dl class="wed-list summary-list price-review"><div class="wed-row"><dt>${service.minutes} minute reading</dt><dd>${money(service.price_pence)}</dd></div><div class="wed-row"><dt>Return travel</dt><dd>${quote.returnMiles} miles</dd></div><div class="wed-row"><dt>Travel charge at £0.60 a mile</dt><dd>${money(quote.travelPence)}</dd></div><div class="wed-row price-total"><dt><strong>Total to pay</strong></dt><dd><strong class="assistant-price">${money(total)}</strong></dd></div></dl><p class="small">Return travel: ${quote.returnMiles} miles (${milesText(quote.oneWayMiles)} miles each way by road, there and back, rounded up to a whole mile).</p><p class="small">Gary will come to <strong>${visitAddress(values)}, ${quote.postcode}</strong>.</p>`)
    : bot(html`<p>Thank you, ${first}. The price of your ${service.minutes} minute reading is <strong class="assistant-price">${money(service.price_pence)}</strong>.</p>`)}
</ol>
<form method="post" action="/private-readings/book/details" class="assistant-change">${keep}<input type="hidden" name="edit" value="1"><button class="link-gold link-button" type="submit">Change my details</button></form>
</section>
${accepted ? html`<section class="card-gold share-card voucher-accepted" aria-labelledby="voucher-ok" data-voucher-accepted>
<h2 class="card-title" id="voucher-ok">${travelDue ? `Voucher Accepted. Your Private Reading Is Covered. Travel Charge to Pay: ${money(travelDue)}.` : home ? 'Voucher Accepted. Your Reading and Home Visit Travel Are Fully Covered. No Payment Required.' : 'Voucher Accepted. Your Private Reading Is Fully Covered. No Payment Required.'}</h2>
<p class="small">${travelDue ? `Voucher ${voucher.code} covers your reading. For a home visit, this voucher has the normal travel charge: ${money(travelDue)} (${quote.returnMiles} miles at 60p a mile), paid securely with Square. Your voucher is only used once that payment is confirmed. Your time is held for ${holdMinutes} minutes while you pay.`
    : `Voucher ${voucher.code}. Press Confirm My Booking to book ${longDate(date)} at ${friendlyTime(time)}. Your voucher is kept for you for ${voucher.holdMinutes || holdMinutes} minutes while you confirm.`}</p>
<form method="post" action="/private-readings/book" class="share-form" novalidate>
${keep}
<input type="hidden" name="voucher_id" value="${voucher.id}"><input type="hidden" name="voucher_token" value="${voucher.token}"><input type="hidden" name="voucher_code" value="${voucher.code}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="form-field policy-box" aria-labelledby="policy-title">
<h3 class="policy-title" id="policy-title">Cancelling or rearranging</h3>
<div class="prose small">${formatText(policy)}</div>
</div>
<div class="form-field form-check"><label><input type="checkbox" name="policy" value="1"${values.policy ? raw(' checked') : ''}${aria('policy')}> I understand how cancelling and rearranging works.</label>${err('policy')}</div>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="booking" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit">${travelDue ? `Proceed to Secure Payment: ${money(travelDue)}` : 'Confirm My Booking'}</button>
<p class="small">${travelDue ? 'You pay on Square’s secure checkout page. New Way’s never sees your card details.' : 'No payment is taken.'} See our <a href="/privacy">Privacy Notice</a>.</p>
</form>
<form method="post" action="/private-readings/book/voucher" class="assistant-change">${keep}<input type="hidden" name="remove" value="1"><input type="hidden" name="voucher_id" value="${voucher.id}"><input type="hidden" name="voucher_token" value="${voucher.token}">
<button class="link-gold link-button" type="submit">Don’t use the voucher: pay with Square instead</button></form>
</section>` : html`<section class="card-blue share-card voucher-card" aria-labelledby="voucher-title" data-voucher>
<details${voucher && voucher.error ? raw(' open') : ''}><summary class="card-title" id="voucher-title">Have a Gift Voucher or Reservation Code?</summary>
<form method="post" action="/private-readings/book/voucher" class="share-form" novalidate>
${keep}
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="form-field"><label for="v-code">Voucher or reservation code</label>
<input id="v-code" name="code" type="text" maxlength="40" autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="GV-XXXX-XXXX-XXXX" value="${voucher ? voucher.code || '' : ''}"${voucher && voucher.error ? raw(' aria-invalid="true" aria-describedby="err-voucher"') : ''}>
${voucher && voucher.error ? html`<p class="field-error" id="err-voucher" role="alert">${voucher.error} You can still pay with Square below if you wish.</p>` : ''}</div>
<button class="btn-outline-gold press" type="submit">Apply voucher</button>
</form>
</details>
</section>`}
${accepted ? '' : html`${inAppWarning(ctx.request, { restartPath: `/private-readings/book/details${q({ reading: service.code, date, time })}` })}<section class="card-blue share-card" aria-labelledby="pay-title">
<h2 class="card-title" id="pay-title">Secure payment</h2>
<form method="post" action="/private-readings/book" class="share-form" novalidate>
${keep}
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="form-field policy-box" aria-labelledby="policy-title">
<h3 class="policy-title" id="policy-title">Cancelling or rearranging</h3>
<div class="prose small">${formatText(policy)}</div>
</div>
<div class="form-field form-check"><label><input type="checkbox" name="policy" value="1"${values.policy ? raw(' checked') : ''}${aria('policy')}> I understand how cancelling and rearranging works.</label>${err('policy')}</div>
<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="booking" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit">${home ? `Proceed to Secure Payment: ${money(total)}` : 'Proceed to Secure Payment'}</button>
<p class="small">Your time is held for ${holdMinutes} minutes while you pay on Square’s secure checkout page. New Way’s never sees your card details. See our <a href="/privacy">Privacy Notice</a>.</p>
</form>
</section>
${paymentHelp(ctx.settings, { holdText: `Your time is held for ${holdMinutes} minutes once you press Proceed to Secure Payment.` })}`}`;
  return page(ctx, { route: 'private-readings', title: 'Your Reading', body, mainClass: 'gap-26 booking-main',
    description: 'Your private reading: price and secure payment.' });
}

// ---------- the customer's order page (held, paid, run out) ----------
export function orderPage(ctx, { order, booking, product, key, sandbox, payUrl, holdUntil, checkFailed, download }) {
  const isReading = order.kind === 'PRIVATE_READING';
  const byVoucher = order.payment_method === 'gift_voucher';
  const voucherTravel = order.payment_method === 'gift_voucher_travel';
  const self = `/order/${order.reference}?key=${encodeURIComponent(key)}`;
  const rows = isReading && booking ? [['Reading', booking.service_name], ['Date', longDate(booking.date)], ['Time', friendlyTime(booking.local_start) + ' (UK time)'],
    ['Length', booking.minutes + ' minutes'], ['How', booking.reading_method === 'home' ? 'Home Visit (In Person): Gary comes to your home' : 'WhatsApp video call'],
    ...(booking.reading_method === 'home' && (byVoucher || voucherTravel) ? [['Your address', `${booking.visit_address}, ${booking.visit_postcode}`], ['Reading', 'Covered by your gift voucher'],
      [`Travel (${booking.travel_return_miles} miles there and back at £0.60 a mile)`, byVoucher ? `${money(booking.travel_pence)}: FREE with your voucher` : money(order.amount_pence)], [byVoucher ? 'Amount due' : 'Total', byVoucher ? money(0) : money(order.amount_pence)]]
      : booking.reading_method === 'home' ? [['Your address', `${booking.visit_address}, ${booking.visit_postcode}`], ['Reading', money(booking.price_pence)],
      [`Travel (${booking.travel_return_miles} miles there and back at £0.60 a mile)`, money(booking.travel_pence)], ['Total', money(order.amount_pence)]]
      : byVoucher ? [['Payment method', 'Gift voucher'], ['Amount due', money(0)]] : [['Price', money(order.amount_pence)]]), ['Reference', order.reference]]
    : [['Meditation', order.item_name], ['Price', money(order.amount_pence)], ['Reference', order.reference]];
  const summary = html`<section class="card-gold booking-card" aria-labelledby="order-summary">
<h2 class="book-title" id="order-summary">${isReading ? 'Your reading' : 'Your meditation'}</h2>
<dl class="wed-list summary-list">${rows.map(([k, v]) => html`<div class="wed-row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
</section>`;
  let state;
  if (order.status === 'paid') {
    state = isReading
      ? html`<section class="card-blue order-state is-done" aria-labelledby="state"><h2 class="card-title" id="state">Your reading is booked</h2>
<p>Thank you, ${order.customer_name}. ${byVoucher ? 'Your gift voucher has been accepted and your reading is confirmed. There is nothing to pay.' : voucherTravel ? 'Your travel payment has been received, your gift voucher has been used for the reading, and your reading is confirmed.' : 'Your payment has been received and your reading is confirmed.'}</p>
<p>A confirmation has been emailed to ${order.customer_email}. ${booking && booking.reading_method === 'home' ? `Gary will come to your home: ${booking.visit_address}, ${booking.visit_postcode}.` : `Your reading will take place by WhatsApp video call on ${order.customer_phone}.`}</p></section>`
      : html`<section class="card-blue order-state is-done" aria-labelledby="state"><h2 class="card-title" id="state">Thank you</h2>
<p>Your payment has been received. Your download link has also been emailed to ${order.customer_email}.</p></section>
${download ? downloadPanel({ ...download, action: `/order/${order.reference}/download?key=${encodeURIComponent(key)}`, title: order.item_name }) : ''}`;
  } else if (order.status === 'needs_attention') {
    state = html`<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">Thank you, your payment was received</h2>
<p>${isReading ? 'There was a problem confirming your appointment time automatically, so Gary will contact you personally to arrange it.' : 'There was a problem preparing your download automatically, so New Way’s will contact you personally.'}</p>
${contactLine(ctx.settings)}</section>`;
  } else if (order.status === 'pending' && payUrl) {
    state = html`${isReading ? inAppWarning(ctx.request, { note: 'Your time stays held while you switch.' }) : ''}<section class="card-blue order-state" aria-labelledby="state"><h2 class="card-title" id="state">${isReading ? `Your time is held until ${holdUntil}` : 'Ready to pay'}</h2>
${checkFailed ? html`<p class="notice-bad" role="alert">We couldn’t check with Square just now. If you have already paid, please wait a minute and check again.</p>` : ''}
<a class="btn-gold press" href="${payUrl}" rel="external">Pay ${money(order.amount_pence)} securely with Square</a>
<p class="small">${isReading ? 'If payment isn’t completed in time, the time is released for someone else. ' : ''}Already paid? <a class="link-gold" href="${self}">Check again</a></p>
${testModeNotice(sandbox)}</section>
${isReading ? paymentHelp(ctx.settings, { holdText: `Your time is held until ${holdUntil}.` }) : ''}`;
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
