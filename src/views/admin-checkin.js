// Admin screens for checking guests in at the door (Gary, and check-in helpers such as Julie), and for managing helpers.
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { longDate, friendlyDateTime } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { money } from '../notify.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '').toLowerCase();
const eventLine = (e) => `${longDate(e.date, '0000')}${e.start_time ? ', ' + friendlyTime(e.start_time) : e.time_text ? ', ' + e.time_text : ''}`;

export function checkinPage({ title, body, csrf, helper, scripts = false }) {
  return adminPage({ title, csrf, signedIn: true, back: !helper, scripts: scripts ? ['/js/checkin.js'] : [], body });
}

export function eventsPage({ events, csrf, helper }) {
  return checkinPage({
    title: 'Check in', csrf, helper,
    body: html`${helper ? html`<p class="hint">Signed in as ${helper}. You can check guests in at New Way’s events.</p>` : ''}
<p class="hint">Choose the event.</p>
${events.length ? html`<ul class="tiles">${events.map((e) => html`<li><a class="tile" href="/admin/checkin/${e.id}"><span class="tile-text"><span class="tile-label">${e.name}</span><span class="tile-sub">${eventLine(e)} · ${e.booked} booked, ${e.arrived} arrived</span></span></a></li>`)}</ul>`
      : html`<p class="panel">There are no events with bookings coming up.</p>`}
${helper ? '' : html`<p class="hint spaced"><a class="link" href="/admin/helpers">Check-in helpers</a>: people (such as Julie) who can help at the door. They can only use check-in.</p>`}`
  });
}

function stats(event, t) {
  return html`<div class="stats" aria-live="polite" data-totals="/admin/checkin/${event.id}/totals">
<p><strong data-k="booked">${t.booked}</strong> booked</p>
<p><strong data-k="arrived">${t.arrived}</strong> checked in</p>
<p><strong data-k="waiting">${t.waiting}</strong> still to arrive</p>
</div>`;
}

function guestRow(event, g, csrf, back, helper) {
  return html`<div class="guest-row${g.checked_in_at ? ' is-in' : ''}">
<div><span class="guest-name">${g.name}</span>
<span class="guest-meta"><br>${g.reference}${g.purchaser_name && g.purchaser_name !== g.name ? ` · booked by ${g.purchaser_name}` : ''}${g.quantity > 1 ? html` · <a class="link" href="/admin/checkin/${event.id}/booking/${g.booking_id}">party of ${g.quantity}</a>` : ''}
${g.payment_status === 'unpaid' ? html`<br><span class="chip chip-attention">${helper ? 'Still to pay: please check with Gary' : `To pay at the door: ${money(g.total_pence)}`}</span>` : ''}</span></div>
${g.checked_in_at
    ? html`<div><span class="in-label">Checked in ${clock(g.checked_in_at)}</span>
<form method="post" action="/admin/checkin/${event.id}/guest/${g.id}/undo">${hidden(csrf)}<input type="hidden" name="back" value="${back}"><button class="pill" type="submit" data-confirm="Undo the check-in for ${g.name}?">Undo</button></form></div>`
    : html`<form method="post" action="/admin/checkin/${event.id}/guest/${g.id}">${hidden(csrf)}<input type="hidden" name="back" value="${back}"><button class="btn-checkin" type="submit">Check in</button></form>`}
</div>`;
}

const VIEWS = [['all', 'All'], ['arrived', 'Arrived'], ['waiting', 'Not arrived']];

export function doorPage({ event, totals, guests, q, current, csrf, helper, flash }) {
  const back = `/admin/checkin/${event.id}?${new URLSearchParams({ q, view: current }).toString()}`;
  return checkinPage({
    title: 'Check in', csrf, helper, scripts: true,
    body: html`<p><a class="link" href="/admin/checkin">Choose another event</a>${helper ? '' : html` · <a class="link" href="/admin/events/${event.id}/manage">Event page</a>`}</p>
<h2>${event.name}</h2><p class="hint">${eventLine(event)}</p>
${flash ? html`<p class="big-state ${flash.kind}" role="status">${flash.text}</p>` : ''}
${stats(event, totals)}
<section class="panel" aria-labelledby="scan-h">
<h2 id="scan-h" class="sr-only">Scan</h2>
<button type="button" class="btn-gold scan-btn" data-scan data-event="${event.id}">SCAN QR CODE</button>
<div class="scan-box" hidden><video playsinline muted></video></div>
<p class="hint scan-status" aria-live="polite"></p>
<p class="hint scan-fallback" hidden>This browser can’t scan inside the page. Use the phone’s Camera app to scan the guest’s QR code (it opens their booking here), or search for the guest below.</p>
</section>
<form method="get" action="/admin/checkin/${event.id}" class="panel" role="search">
<label class="sr-only" for="ci-q">Search guest</label>
<div class="search-form"><input id="ci-q" name="q" type="search" value="${q}" placeholder="Guest or booking name, or reference" autocomplete="off"><button class="pill pill-gold" type="submit">SEARCH GUEST</button></div>
<input type="hidden" name="view" value="${current}">
</form>
<nav class="tabs" aria-label="Show guests">${VIEWS.map(([k, l]) => html`<a class="tab-link${k === current ? ' is-current' : ''}" href="/admin/checkin/${event.id}?${new URLSearchParams({ q, view: k }).toString()}"${k === current ? raw(' aria-current="page"') : ''}>${l}</a>`)}</nav>
<section class="panel" aria-label="Guests">
${guests.length ? guests.map((g) => guestRow(event, g, csrf, back, helper)) : html`<p>${q ? 'No guest matches that search.' : current === 'arrived' ? 'Nobody has arrived yet.' : current === 'waiting' ? 'Everyone has arrived.' : 'No bookings yet.'}</p>`}
</section>`
  });
}

export function partyPage({ event, b, guests, csrf, helper, flash, scanned }) {
  const waiting = guests.filter((g) => !g.checked_in_at);
  const valid = b.status === 'confirmed';
  let state;
  if (!valid) state = html`<p class="big-state is-bad" role="alert">NOT A VALID BOOKING<br><span class="hint">${b.status === 'cancelled' ? 'This booking was cancelled.' : b.status === 'held' ? 'This booking has not been paid.' : b.status === 'needs_attention' ? 'This booking needs Gary’s attention.' : 'This booking was not completed.'}</span></p>`;
  else if (!waiting.length) state = html`<p class="big-state is-done" role="status">ALREADY CHECKED IN<br><span class="hint">${guests.map((g) => `${g.name} at ${clock(g.checked_in_at)}${g.checked_in_by ? ' (' + g.checked_in_by + ')' : ''}`).join(' · ')}</span></p>`;
  else if (scanned) state = html`<p class="big-state is-good" role="status">VALID BOOKING: ${guests.length} ${guests.length === 1 ? 'guest' : 'guests'}${waiting.length < guests.length ? `, ${waiting.length} still to arrive` : ''}</p>`;
  const back = `/admin/checkin/${event.id}/booking/${b.id}`;
  return checkinPage({
    title: 'Check in', csrf, helper, scripts: true,
    body: html`<p><a class="link" href="/admin/checkin/${event.id}">Back to check-in</a></p>
${flash ? html`<p class="big-state ${flash.kind}" role="status">${flash.text}</p>` : ''}
${state || ''}
<section class="panel" aria-labelledby="party-h">
<h2 id="party-h">${b.purchaser_name || 'Booking'} · ${b.reference}</h2>
<p class="hint">${event.name}, ${eventLine(event)} · ${b.quantity} ${b.quantity === 1 ? 'ticket' : 'tickets'}</p>
${b.payment_status === 'unpaid' && valid ? html`<p class="banner banner-error" role="alert">${helper ? 'Still to pay: please check with Gary' : `To pay at the door: ${money(b.total_pence)}`}</p>` : ''}
${valid ? guests.map((g) => guestRow(event, g, csrf, back, helper)) : guests.map((g) => html`<div class="guest-row"><span class="guest-name">${g.name}</span></div>`)}
${valid && waiting.length > 1 ? html`<form method="post" action="/admin/checkin/${event.id}/booking/${b.id}/all" class="spaced">${hidden(csrf)}<button class="btn-gold" type="submit">Check in all ${waiting.length} not yet arrived</button></form>` : ''}
${helper ? '' : html`<p class="spaced"><a class="link" href="/admin/events/${event.id}/bookings/${b.id}">Open the full booking</a></p>`}
</section>
<p><button type="button" class="btn-gold scan-btn" data-scan data-event="${event.id}">SCAN NEXT QR CODE</button></p>
<div class="scan-box" hidden><video playsinline muted></video></div>
<p class="hint scan-status" aria-live="polite"></p>
<p class="hint scan-fallback" hidden>This browser can’t scan inside the page. Use the phone’s Camera app, or go back and search for the guest.</p>`
  });
}

export function otherEventPage({ event, other, b, csrf, helper }) {
  return checkinPage({
    title: 'Check in', csrf, helper,
    body: html`<p class="big-state is-bad" role="alert">THIS TICKET IS FOR ANOTHER EVENT</p>
<section class="panel"><p>${b.reference} is for <strong>${other.name}</strong>, ${eventLine(other)}.</p>
<p>You are checking in for ${event.name}.</p>
<p class="row-actions"><a class="pill pill-gold" href="/admin/checkin/${event.id}">Back to ${event.name}</a> <a class="pill" href="/admin/checkin/${other.id}/booking/${b.id}">Open ${other.name}</a></p></section>`
  });
}

export function notFoundPage({ csrf, helper, eventId }) {
  return checkinPage({
    title: 'Check in', csrf, helper,
    body: html`<p class="big-state is-bad" role="alert">QR CODE NOT RECOGNISED</p>
<section class="panel"><p>This code isn’t a New Way’s booking. Please search for the guest by name instead.</p>
<p><a class="pill pill-gold" href="${eventId ? `/admin/checkin/${eventId}` : '/admin/checkin'}">Back to check-in</a></p></section>`
  });
}

export function helperOnlyPage() {
  return adminPage({
    title: 'Check-in only', back: false,
    body: html`<div class="panel"><p>Your account can only be used for checking guests in.</p><p><a class="btn-gold btn-link" href="/admin/checkin">Go to check-in</a></p></div>`
  });
}

// ---------- helpers (owner only) ----------
export function helpersPage({ helpers, csrf, flash, errors = {}, values = {} }) {
  const FLASH = { added: 'Helper added. Ask them to sign in to Admin with that email address.', off: 'Switched off. They are signed out everywhere and can’t sign in.',
    on: 'Switched on again.', removed: 'Removed.' };
  const act = (h, a, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/helpers/${h.id}/${a}">${hidden(csrf)}<button class="${cls}" type="submit"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  return adminPage({
    title: 'Check-in helpers', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/checkin">Back to check-in</a></p>
<p class="hint">A helper can sign in to Admin and use <strong>check-in only</strong>: choose an event, scan QR codes, search the guest list and check guests in. They can’t see or change anything else (no payments, settings, mailing list, private readings, meditation sales or customer details beyond names).</p>
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
${helpers.length ? html`<ul class="rows">${helpers.map((h) => html`<li class="row-card"><div class="row-text"><span class="row-title">${h.name || h.email}</span><span class="row-line">${h.email}</span>
<span class="row-line">${h.last_signin_at ? 'Last signed in ' + friendlyDateTime(h.last_signin_at) : 'Not signed in yet'}</span>
<span class="chips">${h.active ? html`<span class="chip chip-live">Can check in</span>` : html`<span class="chip chip-hidden">Switched off</span>`}</span></div>
<div class="row-actions">${h.active ? act(h, 'off', 'Switch off', 'pill', 'Switch off this helper? They are signed out straight away.') : act(h, 'on', 'Switch on', 'pill pill-gold')}
${act(h, 'remove', 'Remove', 'pill pill-danger', 'Remove this helper?')}</div></li>`)}</ul>` : html`<p class="panel">No helpers yet.</p>`}
<form method="post" action="/admin/helpers" class="panel admin-form">${hidden(csrf)}
<h2>Add a helper</h2>
<div class="field${errors.name ? ' has-error' : ''}"><label for="h-name">Name</label><input id="h-name" name="name" type="text" maxlength="80" value="${values.name || ''}">${errors.name ? html`<p class="error">${errors.name}</p>` : ''}</div>
<div class="field${errors.email ? ' has-error' : ''}"><label for="h-email">Their email address</label><input id="h-email" name="email" type="email" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="254" value="${values.email || ''}">${errors.email ? html`<p class="error">${errors.email}</p>` : ''}</div>
<p class="hint">They sign in on the normal Admin sign-in page with this email address (the first time, they create a password there, or you invite them from the WorkOS dashboard). Their email must be verified.</p>
<p class="form-actions"><button class="btn-gold" type="submit">Add helper</button></p>
</form>`
  });
}
