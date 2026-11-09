// Admin screens for checking guests in at the door (Gary, and check-in helpers such as Julie), and for managing helpers.
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { longDate, friendlyDateTime } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { money } from '../notify.js';
import { qrSvg } from '../lib/qr.js';
import { TABLET_BY, HELP_LABEL, STATE_LABEL, tabletOnline, PAIR_MINUTES } from '../selfcheckin/model.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const modeField = (test) => (test ? html`<input type="hidden" name="mode" value="test">` : '');
const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '').toLowerCase();
const eventLine = (e) => `${longDate(e.date, '0000')}${e.start_time ? ', ' + friendlyTime(e.start_time) : e.time_text ? ', ' + e.time_text : ''}`;

const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m === 1 ? '1 minute ago' : m < 60 ? `${m} minutes ago` : clock(iso);
};
const byLabel = (by) => (by === TABLET_BY ? 'on the iPad' : by === TABLET_BY + ' (offline)' ? 'on the iPad (offline, sent later)' : by ? `by ${by}` : '');
const withMode = (href, test) => (test ? href + (href.includes('?') ? '&' : '?') + 'mode=test' : href);

export function checkinPage({ title, body, csrf, helper, scripts = false }) {
  // The QR reader (jsQR) is loaded too, so SCAN QR CODE also works on iPhones and iPads (Safari has no built-in reader)
  return adminPage({ title, csrf, signedIn: true, back: !helper, scripts: scripts ? ['/js/vendor/jsqr-1.4.0.js', '/js/checkin.js'] : [], body });
}

// ---------- the iPad's status, in words ----------
export function tabletStatus(t, event) {
  const online = tabletOnline(t);
  const state = !t.token_hash ? 'Waiting to be set up' : !event ? 'No event chosen' : STATE_LABEL[t.state] || t.state;
  const working = online && t.state === 'active' && !!event;
  return {
    online, working, mode: t.mode === 'live' ? 'LIVE' : 'TEST', state,
    pending: Number(t.pending_count) || 0,
    display: t.display_mode === 'app' ? 'Full-screen app (Home Screen)' : t.display_mode === 'browser' ? 'In a Safari tab: not locked full screen (open it from the Home Screen icon instead)' : '',
    line: !t.token_hash ? 'Waiting to be set up with a code'
      : `${online ? 'Online' : 'Offline (not heard from in the last 90 seconds: if check-in is open it carries on by itself and saves check-ins on the iPad; check Julie’s hotspot is on)'} · ${working ? 'operational' : 'not taking check-ins'}`
  };
}
const modeChip = (t) => (t.mode === 'live' ? html`<span class="chip chip-live-mode">LIVE MODE</span>` : html`<span class="chip chip-test-mode">TEST MODE</span>`);
const stateChip = (t) => html`<span class="chip chip-state-${t.state}">${STATE_LABEL[t.state] || t.state}</span>`;

// The buttons for one iPad that is set to this event
function controls(t, event, csrf, back) {
  const act = (action, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/checkin/tablets/${t.id}/control">${hidden(csrf)}<input type="hidden" name="action" value="${action}"><input type="hidden" name="back" value="${back}"><button class="${cls}" type="submit"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  const live = html`<a class="pill pill-live" href="/admin/checkin/tablets/${t.id}/live?back=${encodeURIComponent(back)}">${t.state === 'active' && t.mode === 'test' ? 'Switch to LIVE…' : 'Start LIVE check-in…'}</a>`;
  const out = [];
  if (t.state === 'disconnected') out.push(act('reconnect', 'Reconnect', 'pill pill-gold'));
  else {
    if (t.state === 'closed') { out.push(act('test', 'Start TEST check-in', 'pill pill-gold')); out.push(live); }
    if (t.state === 'active') {
      out.push(act('pause', 'Pause', 'pill pill-gold'));
      if (t.mode === 'test') out.push(live);
      else out.push(act('test', 'Switch to TEST', 'pill', 'Switch the iPad to TEST MODE? Check-ins on the iPad will stop counting as real attendance.'));
    }
    if (t.state === 'paused') out.push(act('resume', `Resume (${t.mode === 'live' ? 'LIVE' : 'TEST'})`, 'pill pill-gold'));
    if (t.state !== 'closed') out.push(act('close', 'Close check-in', 'pill', 'Close check-in on the iPad? Nothing is deleted.'));
    out.push(act('disconnect', 'Disconnect', 'pill pill-danger', 'Disconnect the iPad? It stays set up, and nothing is deleted. Use Reconnect to use it again.'));
  }
  return html`<div class="row-actions">${out}</div>`;
}

export function eventsPage({ events, tablets = [], all = false, csrf, helper }) {
  return checkinPage({
    title: 'Check in', csrf, helper,
    body: html`${helper ? html`<p class="hint">Signed in as ${helper}. You can check guests in at New Way’s events.</p>` : ''}
<ul class="tiles"><li><a class="tile" href="/admin/checkin/tablets"><span class="tile-text"><span class="tile-label">iPad self check-in</span><span class="tile-sub">${tablets.some((t) => t.token_hash)
      ? tablets.filter((t) => t.token_hash).map((t) => `${t.name}: ${tabletOnline(t) ? 'online' : 'offline'}, ${STATE_LABEL[t.state] || t.state}, ${t.mode === 'live' ? 'LIVE' : 'TEST'} mode`).join(' · ')
      : 'Set up the iPad at the entrance, choose its event, test it'}</span></span></a></li></ul>
<p class="hint spaced">${all ? 'Every event, any date (coming events first).' : 'Choose the event.'} <a class="link" href="${all ? '/admin/checkin' : '/admin/checkin?all=1'}">${all ? 'Show only events with bookings coming up' : 'Show every event (any date)'}</a></p>
${events.length ? html`<ul class="tiles">${events.map((e) => html`<li><a class="tile" href="/admin/checkin/${e.id}"><span class="tile-text"><span class="tile-label">${e.name}</span><span class="tile-sub">${eventLine(e)} · ${e.booked} booked, ${e.arrived} arrived</span></span></a></li>`)}</ul>`
      : html`<p class="panel">There are no events with bookings coming up.</p>`}
${helper ? '' : html`<p class="hint spaced"><a class="link" href="/admin/helpers">Check-in helpers</a>: people (such as Julie) who can help at the door. They can only use check-in.</p>`}`
  });
}

function stats(event, t, test) {
  return html`<div class="stats" aria-live="polite" data-totals="${withMode(`/admin/checkin/${event.id}/totals`, test)}">
<p><strong data-k="booked">${t.booked}</strong> expected</p>
<p><strong data-k="arrived">${t.arrived}</strong> ${test ? 'test check-ins' : 'arrived'}</p>
<p><strong data-k="waiting">${t.waiting}</strong> outstanding</p>
</div>
${Number(event.legacy_places) > 0 ? html`<p class="hint">Plus ${event.legacy_places} ${Number(event.legacy_places) === 1 ? 'place' : 'places'} allocated before the website, not on the guest list (not counted above). To include them, add their names with Admin › Events › Import a paper list.</p>` : ''}`;
}

function guestRow(event, g, csrf, back, helper, test = false) {
  return html`<div class="guest-row${g.checked_in_at ? ' is-in' : ''}">
<div><span class="guest-name">${g.name}</span>
<span class="guest-meta"><br>${g.reference}${g.purchaser_name && g.purchaser_name !== g.name ? ` · booked by ${g.purchaser_name}` : ''}${g.quantity > 1 ? html` · <a class="link" href="${withMode(`/admin/checkin/${event.id}/booking/${g.booking_id}`, test)}">party of ${g.quantity}</a>` : ''}
${g.payment_status === 'unpaid' ? html`<br><span class="chip chip-attention">${helper ? 'Still to pay: please check with Gary' : `To pay at the door: ${money(g.total_pence)}`}</span>` : ''}</span></div>
${g.checked_in_at
    ? html`<div><span class="in-label">${test ? 'Test check-in' : 'Checked in'} ${clock(g.checked_in_at)}</span>${g.checked_in_by === TABLET_BY ? html` <span class="chip">iPad</span>` : g.checked_in_by === TABLET_BY + ' (offline)' ? html` <span class="chip">iPad · offline</span>` : ''}
<form method="post" action="/admin/checkin/${event.id}/guest/${g.id}/undo">${hidden(csrf)}${modeField(test)}<input type="hidden" name="back" value="${back}"><button class="pill" type="submit" data-confirm="Undo the ${test ? 'test ' : ''}check-in for ${g.name}?">Undo</button></form></div>`
    : html`<form method="post" action="/admin/checkin/${event.id}/guest/${g.id}">${hidden(csrf)}${modeField(test)}<input type="hidden" name="back" value="${back}"><button class="btn-checkin" type="submit">${test ? 'Test check in' : 'Check in'}</button></form>`}
</div>`;
}

const VIEWS = [['all', 'All'], ['arrived', 'Arrived'], ['waiting', 'Not arrived']];

// What the iPad has sent to Julie, live
function helpPanel(event, help, csrf, back, test) {
  return html`<section class="panel help-panel${help.length ? ' has-help' : ''}" aria-labelledby="help-h" data-live="help">
<h2 id="help-h">${help.length ? `Needs Julie (${help.length})` : 'Needs Julie'}</h2>
${help.length ? html`<ul class="help-list">${help.map((h) => html`<li class="help-item">
<div><strong>${HELP_LABEL[h.kind] || 'Help needed'}</strong>
${h.typed_name ? html`<br>Typed: “${h.typed_name}”` : ''}${h.reference ? html`<br>${h.purchaser_name || 'Booking'} · ${h.reference}` : ''}
<br><span class="hint">${ago(h.created_at)}</span></div>
<div class="row-actions">${h.typed_name ? html`<a class="pill pill-gold" href="/admin/checkin/${event.id}?${new URLSearchParams({ q: h.typed_name.split(' ').pop(), view: 'all', ...(test ? { mode: 'test' } : {}) }).toString()}">Find</a>` : ''}
${h.booking_id ? html`<a class="pill pill-gold" href="${withMode(`/admin/checkin/${event.id}/booking/${h.booking_id}`, test)}">Open booking</a>` : ''}
<form method="post" action="/admin/checkin/${event.id}/help/${h.id}/done">${hidden(csrf)}<input type="hidden" name="back" value="${back}"><button class="pill" type="submit">Done</button></form></div>
</li>`)}</ul>` : html`<p class="hint">Nothing at the moment. When the iPad sends a guest to you (two guests with the same name, a name not on the list, a booking you need to see), it appears here straight away.</p>`}
</section>`;
}

function sameNamePanel(event, same, csrf, back, helper, test) {
  if (!same.length) return html`<div data-live="same"></div>`;
  return html`<section class="panel" aria-labelledby="same-h" data-live="same">
<h2 id="same-h">Same name (${same.length})</h2>
<p class="hint">These guests share exactly the same name, so the iPad asks them to see you. Check who is who by the booking (reference and who booked), then check in the right one.</p>
${same.map((list) => html`<div class="same-group">${list.map((g) => guestRow(event, g, csrf, back, helper, test))}</div>`)}
</section>`;
}

function partialPanel(event, partial, test) {
  if (!partial.length) return html`<div data-live="partial"></div>`;
  return html`<section class="panel" aria-labelledby="partial-h" data-live="partial">
<h2 id="partial-h">Groups partly arrived (${partial.length})</h2>
<ul class="recent-list">${partial.map((p) => html`<li><a class="link" href="${withMode(`/admin/checkin/${event.id}/booking/${p.booking_id}`, test)}">${p.purchaser_name || 'Booking'} · ${p.reference}</a>: ${p.arrived.length} of ${p.total} arrived
<br><span class="hint">Still to come: ${p.waiting.map((g) => g.name).join(', ')}</span></li>`)}</ul>
</section>`;
}

function recentPanel(recent, test) {
  return html`<section class="panel" aria-labelledby="recent-h" data-live="recent">
<h2 id="recent-h">${test ? 'Recent test check-ins' : 'Just arrived'}</h2>
${recent.length ? html`<ul class="recent-list">${recent.map((g) => html`<li><span>${g.name}</span> <span class="hint">${clock(g.checked_in_at)} ${byLabel(g.checked_in_by)}</span></li>`)}</ul>` : html`<p class="hint">Nobody yet.</p>`}
</section>`;
}

function tabletPanel(event, tablets, tabletEvents, csrf, back, offline = { in: 0, already: 0, rejected: 0 }) {
  const ready = tablets.filter((t) => t.token_hash);
  return html`<section class="panel ipad-panel" aria-labelledby="ipad-h" data-live="tablet">
<h2 id="ipad-h">iPad self check-in</h2>
${ready.length ? ready.map((t) => {
    const e = t.event_id ? tabletEvents[t.event_id] : null;
    const here = e && e.id === event.id;
    const st = tabletStatus(t, e);
    return html`<div class="ipad-row${here && t.mode === 'live' && t.state === 'active' ? ' is-live' : ''}">
<p><span class="guest-name">${t.name}</span> <span class="chip ${st.online ? 'chip-online' : 'chip-offline'}">${st.online ? 'Online' : 'Offline'}</span> ${here ? html`${modeChip(t)} ${stateChip(t)}` : ''}</p>
<p class="hint">${st.line}${st.display ? html`<br>Showing as: ${t.display_mode === 'app' ? st.display : html`<strong class="pending-note">${st.display}</strong>`}` : ''}<br>${st.pending ? html`<strong class="pending-note">${st.pending} offline ${st.pending === 1 ? 'check-in is' : 'check-ins are'} saved on the iPad, waiting to be sent${t.pending_since ? ` (since ${clock(t.pending_since)})` : ''}. They are sent by themselves when the connection returns.</strong><br>` : ''}${t.last_sync_at ? `Last sent offline check-ins: ${ago(t.last_sync_at)}. ` : ''}${here ? 'Set to this event.' : e ? `Set to ${e.name} (${eventLine(e)}), ${STATE_LABEL[t.state] || t.state}, ${t.mode === 'live' ? 'LIVE' : 'TEST'} mode.` : 'No event chosen yet.'}</p>
${here ? controls(t, event, csrf, back) : html`<form method="post" action="/admin/checkin/tablets/${t.id}/control">${hidden(csrf)}<input type="hidden" name="action" value="use"><input type="hidden" name="event_id" value="${event.id}"><input type="hidden" name="back" value="${back}"><button class="pill pill-gold" type="submit"${e && t.state !== 'closed' && t.state !== 'disconnected' ? html` data-confirm="${t.name} is ${STATE_LABEL[t.state]} for ${e.name}. Move it to ${event.name}? It will be closed until you start check-in."` : ''}>Use the iPad for this event</button></form>`}
</div>`;
  }) : html`<p class="hint">No iPad is set up yet. <a class="link" href="/admin/checkin/tablets">Set up the iPad</a>.</p>`}
${offline.in || offline.already || offline.rejected ? html`<p class="hint">Offline check-ins received for this event: ${offline.in} accepted${offline.already ? `, ${offline.already} already checked in (counted once)` : ''}${offline.rejected ? html`, <strong>${offline.rejected} not accepted (see Needs Julie)</strong>` : ''}.</p>` : ''}
<p class="hint"><a class="link" href="/admin/checkin/tablets">Manage iPads</a> (set up, rename, remove)</p>
</section>`;
}

export function doorPage({ event, totals, guests, q, current, csrf, helper, flash, help = [], same = [], partial = [], recent = [], tablets = [], tabletEvents = {}, test = false, offline }) {
  const params = (extra = {}) => new URLSearchParams({ q, view: current, ...(test ? { mode: 'test' } : {}), ...extra }).toString();
  const back = `/admin/checkin/${event.id}?${params()}`;
  const here = tablets.filter((t) => t.token_hash && t.event_id === event.id);
  const testRunning = here.some((t) => t.mode === 'test' && t.state !== 'closed' && t.state !== 'disconnected');
  return checkinPage({
    title: 'Check in', csrf, helper, scripts: true,
    body: html`<p><a class="link" href="/admin/checkin">Choose another event</a>${helper ? '' : html` · <a class="link" href="/admin/events/${event.id}/manage">Event page</a>`}</p>
<h2>${event.name}</h2><p class="hint">${eventLine(event)}</p>
<nav class="tabs mode-tabs" aria-label="Attendance"><a class="tab-link${test ? '' : ' is-current'}" href="/admin/checkin/${event.id}"${test ? '' : raw(' aria-current="page"')}>Live attendance</a><a class="tab-link tab-test${test ? ' is-current' : ''}" href="/admin/checkin/${event.id}?mode=test"${test ? raw(' aria-current="page"') : ''}>Test Mode</a></nav>
${test ? html`<div class="banner banner-test" role="note"><strong>TEST MODE</strong>: practice check-ins only. Real attendance and bookings are not changed.
<form method="post" action="/admin/checkin/${event.id}/test-reset" class="spaced">${hidden(csrf)}<button class="pill" type="submit" data-confirm="Clear every TEST check-in for ${event.name}? Real attendance is not touched.">Reset test check-ins</button></form></div>`
      : testRunning ? html`<p class="banner banner-test" role="note">The iPad is in <strong>TEST MODE</strong> for this event: its check-ins appear under <a class="link" href="/admin/checkin/${event.id}?mode=test">Test Mode</a>, not here.</p>` : ''}
${flash ? html`<p class="big-state ${flash.kind}" role="status">${flash.text}</p>` : ''}
${stats(event, totals, test)}
<div data-live-root data-live-url="${withMode(`/admin/checkin/${event.id}/live`, test)}">
${tabletPanel(event, tablets, tabletEvents, csrf, back, offline)}
${helpPanel(event, help, csrf, back, test)}
${sameNamePanel(event, same, csrf, back, helper, test)}
${partialPanel(event, partial, test)}
</div>
<section class="panel" aria-labelledby="scan-h">
<h2 id="scan-h" class="sr-only">Scan</h2>
<button type="button" class="btn-gold scan-btn" data-scan data-event="${event.id}"${test ? raw(' data-mode="test"') : ''}>SCAN QR CODE</button>
<div class="scan-box" hidden><video playsinline muted></video></div>
<p class="hint scan-status" aria-live="polite"></p>
<p class="hint scan-fallback" hidden>This browser can’t scan inside the page. Use the phone’s Camera app to scan the guest’s QR code (it opens their booking here), or search for the guest below.</p>
</section>
<form method="get" action="/admin/checkin/${event.id}" class="panel" role="search">
<label class="sr-only" for="ci-q">Search guest</label>
<div class="search-form"><input id="ci-q" name="q" type="search" value="${q}" placeholder="Guest or booking name, or reference" autocomplete="off"><button class="pill pill-gold" type="submit">SEARCH GUEST</button></div>
<input type="hidden" name="view" value="${current}">${test ? html`<input type="hidden" name="mode" value="test">` : ''}
</form>
<nav class="tabs" aria-label="Show guests">${VIEWS.map(([k, l]) => html`<a class="tab-link${k === current ? ' is-current' : ''}" href="/admin/checkin/${event.id}?${params({ view: k })}"${k === current ? raw(' aria-current="page"') : ''}>${l}</a>`)}</nav>
<section class="panel" aria-label="Guests" data-live="guests">
${guests.length ? guests.map((g) => guestRow(event, g, csrf, back, helper, test)) : html`<p>${q ? 'No guest matches that search.' : current === 'arrived' ? 'Nobody has arrived yet.' : current === 'waiting' ? 'Everyone has arrived.' : 'No bookings yet.'}</p>`}
</section>
${recentPanel(recent, test)}`
  });
}

export function partyPage({ event, b, guests, csrf, helper, flash, scanned, test = false }) {
  const waiting = guests.filter((g) => !g.checked_in_at);
  const valid = b.status === 'confirmed';
  let state;
  if (!valid) state = html`<p class="big-state is-bad" role="alert">NOT A VALID BOOKING<br><span class="hint">${b.status === 'cancelled' ? 'This booking was cancelled.' : b.status === 'held' ? 'This booking has not been paid.' : b.status === 'needs_attention' ? 'This booking needs Gary’s attention.' : 'This booking was not completed.'}</span></p>`;
  else if (!waiting.length) state = html`<p class="big-state is-done" role="status">ALREADY CHECKED IN<br><span class="hint">${guests.map((g) => `${g.name} at ${clock(g.checked_in_at)}${g.checked_in_by ? ' (' + g.checked_in_by + ')' : ''}`).join(' · ')}</span></p>`;
  else if (scanned) state = html`<p class="big-state is-good" role="status">VALID BOOKING: ${guests.length} ${guests.length === 1 ? 'guest' : 'guests'}${waiting.length < guests.length ? `, ${waiting.length} still to arrive` : ''}</p>`;
  const back = withMode(`/admin/checkin/${event.id}/booking/${b.id}`, test);
  return checkinPage({
    title: 'Check in', csrf, helper, scripts: true,
    body: html`<p><a class="link" href="${withMode(`/admin/checkin/${event.id}`, test)}">Back to check-in</a></p>
${test ? html`<p class="banner banner-test" role="note"><strong>TEST MODE</strong>: practice check-ins only. Real attendance is not changed.</p>` : ''}
${flash ? html`<p class="big-state ${flash.kind}" role="status">${flash.text}</p>` : ''}
${state || ''}
<section class="panel" aria-labelledby="party-h">
<h2 id="party-h">${b.purchaser_name || 'Booking'} · ${b.reference}</h2>
<p class="hint">${event.name}, ${eventLine(event)} · ${b.quantity} ${b.quantity === 1 ? 'ticket' : 'tickets'}</p>
${b.payment_status === 'unpaid' && valid ? html`<p class="banner banner-error" role="alert">${helper ? 'Still to pay: please check with Gary' : `To pay at the door: ${money(b.total_pence)}`}</p>` : ''}
${valid ? guests.map((g) => guestRow(event, g, csrf, back, helper, test)) : guests.map((g) => html`<div class="guest-row"><span class="guest-name">${g.name}</span></div>`)}
${valid && waiting.length > 1 ? html`<form method="post" action="/admin/checkin/${event.id}/booking/${b.id}/all" class="spaced">${hidden(csrf)}${modeField(test)}<button class="btn-gold" type="submit">${test ? 'Test check in' : 'Check in'} all ${waiting.length} not yet arrived</button></form>` : ''}
${helper ? '' : html`<p class="spaced"><a class="link" href="/admin/events/${event.id}/bookings/${b.id}">Open the full booking</a></p>`}
</section>
<p><button type="button" class="btn-gold scan-btn" data-scan data-event="${event.id}"${test ? raw(' data-mode="test"') : ''}>SCAN NEXT QR CODE</button></p>
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

// ---------- iPad self check-in: Admin › Check in › iPad self check-in ----------
export function tabletsPage({ tablets, events, csrf, flash, origin }) {
  const FLASH = { renamed: 'Name saved.', removed: 'Removed. That iPad can no longer check anyone in; it shows the setup screen. Nothing else was deleted.',
    tablet: 'The iPad now uses that event. It is closed until you start check-in.', test: 'TEST MODE check-in is open on the iPad. Nothing real is recorded.',
    live: 'LIVE check-in is open on the iPad.', paused: 'Check-in is paused.', resumed: 'Check-in has resumed.', closed: 'Check-in is closed. Nothing has been deleted.',
    disconnected: 'Disconnected. The iPad stays set up; use Reconnect when you need it. Nothing has been deleted.', reconnected: 'Reconnected. Check-in is closed until you start it.',
    noevent: 'Choose an event for the iPad first.' };
  const link = `${origin}/self-checkin`;
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  const back = '/admin/checkin/tablets';
  return checkinPage({
    title: 'iPad self check-in', csrf, helper: '',
    body: html`<p><a class="link" href="/admin/checkin">Back to check-in</a></p>
${FLASH[flash] ? html`<p class="banner ${flash === 'noevent' ? 'banner-error' : 'banner-ok'}" role="status">${FLASH[flash]}</p>` : ''}
<p class="hint">Guests check themselves in on the iPad at the entrance: by scanning the QR code from their booking email, or by typing their full name. Choose any event (any date), then start check-in in <strong>TEST MODE</strong> to try everything out (nothing real is recorded), or <strong>LIVE</strong> on the night. You can pause, resume or close it at any time; nothing is ever deleted.</p>
${tablets.length ? html`<ul class="rows">${tablets.map((t) => {
    const e = t.event_id ? byId[t.event_id] : null;
    const st = tabletStatus(t, e);
    return html`<li class="row-card ipad-card${t.mode === 'live' && t.state === 'active' ? ' is-live' : ''}"><div class="row-text"><span class="row-title">${t.name} ${t.token_hash ? html`<span class="chip ${st.online ? 'chip-online' : 'chip-offline'}">${st.online ? 'Online' : 'Offline'}</span> ${modeChip(t)} ${stateChip(t)}` : ''}</span>
<span class="row-line">${st.line}${t.last_seen_at && !st.online ? ` · last seen ${friendlyDateTime(t.last_seen_at)}` : ''}</span>
${st.display ? html`<span class="row-line${t.display_mode === 'app' ? '' : ' pending-note'}">Showing as: ${st.display}</span>` : ''}
${st.pending ? html`<span class="row-line pending-note">${st.pending} offline ${st.pending === 1 ? 'check-in is' : 'check-ins are'} saved on the iPad, waiting to be sent.</span>` : ''}
${t.token_hash ? html`<span class="row-line">${e ? html`Event: <strong>${e.name}</strong>, ${eventLine(e)} · <a class="link" href="/admin/checkin/${e.id}${t.mode === 'test' ? '?mode=test' : ''}">Open its check-in screen</a>` : 'No event chosen yet.'}</span>` : ''}</div>
${t.token_hash ? html`<form method="post" action="/admin/checkin/tablets/${t.id}/control" class="admin-form">${hidden(csrf)}<input type="hidden" name="action" value="use"><input type="hidden" name="back" value="${back}">
<div class="field"><label for="te-${t.id}">Event for this iPad</label>
<select id="te-${t.id}" name="event_id">${e ? '' : html`<option value="" selected>Choose an event…</option>`}
${events.map((x) => html`<option value="${x.id}"${t.event_id === x.id ? ' selected' : ''}>${x.name}, ${eventLine(x)} (${x.booked} booked)</option>`)}</select></div>
<p class="hint">Any event, any date. Choosing an event closes check-in and puts the iPad in TEST MODE, so nothing opens for real by accident.</p>
<p class="form-actions"><button class="pill pill-gold" type="submit"${e && t.state === 'active' ? html` data-confirm="Check-in is open for ${e.name}. Change the iPad’s event? It will close first."` : ''}>Use this event</button></p></form>
${e ? controls(t, e, csrf, back) : ''}` : ''}
<div class="row-actions">
<form method="post" action="/admin/checkin/tablets/${t.id}/code">${hidden(csrf)}<button class="pill" type="submit"${t.token_hash ? html` data-confirm="Set up ${t.name} again with a new code? Its current key stops working when the new code is used."` : ''}>${t.token_hash ? 'Set up again (new code)' : 'Show setup code'}</button></form>
<form method="post" action="/admin/checkin/tablets/${t.id}/remove">${hidden(csrf)}<button class="pill pill-danger" type="submit" data-confirm="${Number(t.pending_count) ? `WARNING: ${t.pending_count} offline check-ins are still saved on ${t.name} and haven’t been sent. Removing it now means they can’t be sent. ` : ''}Remove ${t.name}? Use this only for a lost or replaced iPad: it would need a new setup code. Bookings and attendance are not affected.">Remove iPad</button></form>
</div>
<form method="post" action="/admin/checkin/tablets/${t.id}/rename" class="search-form">${hidden(csrf)}<label class="sr-only" for="tn-${t.id}">Name</label><input id="tn-${t.id}" name="name" type="text" maxlength="60" value="${t.name}"><button class="pill" type="submit">Rename</button></form>
</li>`;
  })}</ul>` : html`<p class="panel">No iPad is set up yet.</p>`}
<form method="post" action="/admin/checkin/tablets" class="panel admin-form">${hidden(csrf)}
<h2>Set up an iPad</h2>
<p class="hint">Only needed once per iPad. After that, use Close, Disconnect and Reconnect: no new code.</p>
<div class="field"><label for="tn-new">Name for this iPad</label><input id="tn-new" name="name" type="text" maxlength="60" value="Entrance iPad"></div>
<p class="form-actions"><button class="btn-gold" type="submit">Add iPad and show setup code</button></p>
</form>
<section class="panel"><h2>On the iPad</h2>
<p>Open Safari on the iPad and go to <strong class="copy-link">${link}</strong>, or scan the QR code on the setup-code screen with the iPad’s Camera app. Type the setup code once. The iPad then stays set up, even after it is restarted.</p>
<p class="hint">Recommended on the iPad: Settings › Display &amp; Brightness › Auto-Lock › Never; in Safari, tap ᴀA › Website Settings › Camera › Allow; and Settings › Accessibility › Guided Access, so guests can’t leave the check-in screen (triple-click the top button to start or end it). Don’t use a Private tab.</p></section>`
  });
}

// Starting LIVE check-in: always confirmed with a tick, so testing can never open an event for real by accident
export function liveConfirmPage({ tablet, event, totals, today, back, csrf }) {
  return checkinPage({
    title: 'Start LIVE check-in', csrf, helper: '',
    body: html`<p><a class="link" href="${back}">Back</a></p>
<section class="panel live-confirm">
<p class="big-state is-bad" role="alert">LIVE check-in: guests’ check-ins will be real attendance</p>
<h2>${event.name}</h2>
<p>${eventLine(event)} · ${totals.booked} guests expected, ${totals.arrived} arrived so far.</p>
${event.date !== today ? html`<p class="banner banner-error" role="alert">This event is <strong>not today</strong>. If you only want to try the iPad, go back and use <strong>Start TEST check-in</strong> instead.</p>` : ''}
<form method="post" action="/admin/checkin/tablets/${tablet.id}/control" class="admin-form">${hidden(csrf)}
<input type="hidden" name="action" value="live"><input type="hidden" name="back" value="${back}">
<div class="field"><label class="check"><input type="checkbox" name="confirm" value="yes" required> Yes: guests are arriving for real, and ${tablet.name} should record real attendance for ${event.name}</label></div>
<p class="form-actions"><button class="btn-gold btn-live" type="submit">Start LIVE check-in</button></p>
</form>
<p class="hint">You can pause, close or switch back to TEST at any time. Nothing is ever deleted.</p>
</section>`
  });
}

export function tabletCodePage({ tablet, code, origin, csrf }) {
  const link = `${origin}/self-checkin?code=${code}`;
  return checkinPage({
    title: 'Setup code', csrf, helper: '',
    body: html`<p><a class="link" href="/admin/checkin/tablets">Back to iPad self check-in</a></p>
<section class="panel setup-code">
<h2>${tablet.name}</h2>
<p>On the iPad, open Safari and go to</p>
<p class="copy-link">${origin}/self-checkin</p>
<p>and type this code:</p>
<p class="setup-digits" aria-label="Setup code ${code.split('').join(' ')}">${code.slice(0, 4)} ${code.slice(4)}</p>
<p class="hint">Setting up the locked Home Screen app? Open <strong>New Way’s Check-in</strong> from the iPad’s Home Screen and type the code there. The QR code below opens Safari instead, which is fine for a quick test but isn’t the locked set-up.</p>
<p class="hint">For a quick test in Safari: point the iPad’s Camera app at this QR code and tap the link it shows. The code is filled in for you.</p>
<div class="setup-qr">${raw(qrSvg(link, { label: 'Setup link for the iPad' }))}</div>
<p class="hint">The code works once, for ${PAIR_MINUTES} minutes. Don’t share it: anyone with it could set up a device to check guests in (it still couldn’t see any customer details).</p>
<p><a class="btn-gold btn-link" href="/admin/checkin/tablets">Done</a></p>
</section>`
  });
}
