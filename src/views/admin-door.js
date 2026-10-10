// Admin screens for Wednesday evenings: the door till (big buttons for a phone), checking in advance payments,
// Close night, reports, the till's buttons and prices, and emergency closures. Same navy and gold as the rest of Admin.
import { html, raw, formatText } from '../lib/html.js';
import { adminPage } from './admin.js';
import { longDate, friendlyDateTime } from '../lib/dates.js';
import { formatPrice } from '../lib/settings.js';
import { pounds, CATEGORIES, CATEGORY_LABEL, raffleStrips, summaryText } from '../wednesday/model.js';
import { icon } from '../lib/icons.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '').toLowerCase();
const doorPage = (title, body, csrf, scripts = []) => adminPage({ title, csrf, signedIn: true, scripts, body });
const banner = (map, flash, detail) => {
  const f = map[flash];
  return f ? html`<p class="banner ${f[0] === 'ok' ? 'banner-ok' : 'banner-error'}" role="${f[0] === 'ok' ? 'status' : 'alert'}">${f[1].replace('{d}', detail || '')}</p>` : '';
};
const nav = (date) => html`<nav class="tabs" aria-label="Wednesday door">
<a class="tab-link" href="/admin/door?date=${date}">Till</a>
<a class="tab-link" href="/admin/door/orders?date=${date}">Paid in advance</a>
<a class="tab-link" href="/admin/door/close?date=${date}">Close night</a>
<a class="tab-link" href="/admin/door/nights">Nights &amp; reports</a>
<a class="tab-link" href="/admin/door/items">Buttons &amp; prices</a>
<a class="tab-link" href="/admin/door/closure">Emergency closure</a></nav>`;

function liveStats(date, t) {
  return html`<div class="stats stats-4" aria-live="polite" data-door-totals="/admin/door/totals?date=${date}">
<p><strong data-k="service">${t.people.service}</strong> at the service</p>
<p><strong data-k="circle">${t.people.circle}</strong> at the circle</p>
<p><strong data-k="raffle">${t.raffle.total}</strong> raffle strips</p>
<p><strong data-k="total">${pounds(t.money.total)}</strong> taken</p>
</div>`;
}

const TILL_FLASH = { voided: ['ok', 'Sale cancelled. It no longer counts.'], restored: ['ok', 'Sale restored.'], closed: ['bad', 'This night has been closed, so its sales can’t be changed. Reopen it from Close night first.'], gone: ['bad', 'That sale no longer exists.'] };

export function tillPage({ date, night, items, totals, sales, csrf, flash, detail, settings, today }) {
  const closedTill = !!night.till_closed_at;
  return doorPage('Wednesday door', html`
<p class="door-date"><strong>${longDate(date, '0000')}</strong>${date !== today ? html` <span class="chip chip-warn">not today</span> <a class="link" href="/admin/door">Go to today</a>` : ''}${new Date(date + 'T12:00:00Z').getUTCDay() !== 3 ? html` <span class="chip chip-soon">not a Wednesday</span>` : ''}</p>
${nav(date)}
${banner(TILL_FLASH, flash, detail)}
${night.closed_for_public ? html`<p class="banner banner-error" role="alert"><strong>CLOSED to the public tonight</strong>${night.closure_reason ? ': ' + night.closure_reason : ''}. The till still works if you need it.</p>` : ''}
${closedTill ? html`<p class="banner banner-error" role="alert">This night was closed at ${clock(night.till_closed_at)}${night.till_closed_by ? ' by ' + night.till_closed_by : ''} (cash counted), so no more sales can be added. <a class="link" href="/admin/door/close?date=${date}">Reopen it</a> if you need to.</p>` : ''}
${liveStats(date, totals)}
<section class="panel" aria-labelledby="scan-h">
<h2 id="scan-h" class="sr-only">Scan a QR code</h2>
<button type="button" class="btn-gold scan-btn" data-door-scan>SCAN QR CODE</button>
<div class="scan-box" hidden><video playsinline muted></video></div>
<p class="hint scan-status" aria-live="polite"></p>
<p class="hint scan-fallback" hidden>This browser can’t scan inside the page. Use the phone’s Camera app to scan the QR code (it opens the payment here), or find it under <a class="link" href="/admin/door/orders?date=${date}">Paid in advance</a>.</p>
</section>
${closedTill ? '' : html`<section class="panel till" aria-labelledby="till-h" data-till data-date="${date}" data-csrf="${csrf}"${settings.posHandoff && settings.posAppId ? html` data-pos-app="${settings.posAppId}"` : ''}>
<h2 id="till-h">Till</h2>
${items.length ? html`<div class="till-grid">${items.map((i) => html`<button type="button" class="till-btn till-${i.category}" data-item="${i.id}" data-label="${i.label}" data-price="${i.price_pence}" data-custom="${i.custom_amount ? '1' : '0'}">
<span class="till-label">${i.label}</span><span class="till-price">${i.custom_amount ? 'Enter amount' : pounds(i.price_pence)}</span><span class="till-count" data-count hidden></span></button>`)}</div>`
    : html`<p>No till buttons are switched on. <a class="link" href="/admin/door/items">Set up the buttons</a>.</p>`}
<div class="till-custom" data-custom-panel hidden>
<label for="till-amount">Amount for <span data-custom-label></span> (£)</label>
<div class="search-form"><input id="till-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 4.50"><button type="button" class="pill pill-gold" data-custom-add>Add</button><button type="button" class="pill" data-custom-cancel>Cancel</button></div>
</div>
<div class="till-sale" aria-live="polite">
<h3 class="sr-only">This sale</h3>
<ul class="till-lines" data-lines><li class="hint" data-empty>Tap the buttons above. Tap again for more.</li></ul>
<p class="till-total">Total <strong data-total>£0.00</strong></p>
<div class="row-actions"><button type="button" class="pill" data-undo disabled>Undo</button><button type="button" class="pill pill-danger" data-clear disabled>Clear</button></div>
</div>
<div class="till-pay">
<button type="button" class="till-method till-cash" data-pay="cash" disabled>CASH</button>
<button type="button" class="till-method till-card" data-pay="card" disabled>CARD</button>
</div>
<section class="till-confirm" data-confirm-panel hidden aria-labelledby="confirm-h" tabindex="-1">
<h3 id="confirm-h" data-confirm-title>Check the total</h3>
<ul class="till-lines" data-confirm-lines></ul>
<p class="till-grand">GRAND TOTAL <strong data-confirm-total></strong></p>
<p class="hint" data-confirm-hint></p>
<button type="button" class="btn-gold" data-confirm-pay></button>
<a class="btn-gold btn-link till-pos" data-pos-link hidden>Open the Square app to take this payment</a>
<button type="button" class="pill" data-confirm-back>Back to the sale</button>
</section>
<p class="till-message" data-message role="status" aria-live="assertive"></p>
</section>`}
<section class="panel" aria-labelledby="sales-h"><h2 id="sales-h">Sales tonight</h2>
${sales.length ? html`<ul class="rows">${sales.map((s) => html`<li class="row-card till-sale-row${s.voided_at ? ' is-void' : ''}"><div class="row-text">
<span class="row-title">${pounds(s.total_pence)} ${s.method === 'cash' ? 'cash' : 'card'} · ${clock(s.created_at)}${s.created_by ? ' · ' + s.created_by : ''}</span>
<span class="row-line">${summaryText(s.lines)}</span>${s.voided_at ? html`<span class="chips"><span class="chip chip-attention">CANCELLED${s.voided_by ? ' by ' + s.voided_by : ''}</span></span>` : ''}</div>
${closedTill ? '' : html`<form method="post" action="/admin/door/sale/${s.id}/${s.voided_at ? 'unvoid' : 'void'}">${hidden(csrf)}<button class="pill${s.voided_at ? '' : ' pill-danger'}" type="submit"${s.voided_at ? '' : html` data-confirm="Cancel this ${pounds(s.total_pence)} sale? It will no longer count. (Any card refund is done in Square.)"`}>${s.voided_at ? 'Restore' : 'Cancel sale'}</button></form>`}
</li>`)}</ul>` : html`<p class="hint">No sales yet tonight.</p>`}
</section>`, csrf, ['/js/door.js']);
}

export function squareCallbackPage({ done, error, csrf }) {
  return doorPage('Square app', html`<p class="big-state ${done ? 'is-good' : 'is-bad'}" role="status">${done ? 'SQUARE SAYS THE CARD PAYMENT WAS TAKEN' : 'THE CARD PAYMENT WAS NOT COMPLETED'}</p>
<section class="panel"><p>${done ? 'Go back to the till and press “Card payment taken ✓” to record the sale.' : `Square said: ${error || 'the payment was cancelled'}. Nothing has been recorded. Go back to the till to try again, or take cash.`}</p>
<p><a class="btn-gold btn-link" href="/admin/door">Back to the till</a></p></section>`, csrf);
}

export function notRecognisedPage({ csrf }) {
  return doorPage('Wednesday door', html`<p class="big-state is-bad" role="alert">QR CODE NOT RECOGNISED</p>
<section class="panel"><p>This isn’t a New Way’s Wednesday payment. If it’s an event ticket, use <a class="link" href="/admin/checkin">Check in</a> for that event.</p>
<p><a class="pill pill-gold" href="/admin/door">Back to the till</a></p></section>`, csrf);
}

// ---------- an advance payment at the door ----------
const ORDER_FLASH = {
  admitted: ['ok', 'Let in.'], 'admitted-all': ['ok', 'CHECKED IN: everyone on this payment.'], unadmitted: ['ok', 'Undone.'], 'all-in': ['bad', 'Everyone on this payment has already been let in.'],
  'raffles-given': ['ok', 'RAFFLES GIVEN ✓'], 'raffles-already': ['bad', 'The raffle strips were already given.'], 'raffles-undone': ['ok', 'Raffles given: undone.'],
  'other-night': ['bad', 'This payment is for a different evening, so nothing was changed.'], 'not-valid': ['bad', 'This payment is not valid, so nothing was changed.'],
  resent: ['ok', 'The confirmation and QR code were emailed again.'], 'resend-failed': ['bad', 'The email could not be sent.'],
  refunded: ['ok', 'Marked as refunded. It no longer counts in the night’s money.'], unrefunded: ['ok', 'No longer marked as refunded.'], noted: ['ok', 'Note saved.'], nothing: ['ok', 'Nothing to undo.'], gone: ['bad', 'That line no longer exists.']
};

export function orderPage({ order: o, today, scanned, csrf, flash, night }) {
  const valid = o.status === 'paid' && !o.refunded_at;
  const tonight = o.night_date === today;
  const people = o.lines.filter((l) => l.category === 'entry' || l.category === 'development');
  const waiting = people.reduce((n, l) => n + (l.qty - l.admitted), 0);
  const admittedAny = people.some((l) => l.admitted > 0);
  const strips = raffleStrips(o.lines);
  let state;
  if (!valid) state = html`<p class="big-state is-bad" role="alert">NOT VALID<br><span class="hint">${o.refunded_at ? 'This payment was refunded.' : o.status === 'pending' ? 'This payment was not completed.' : o.status === 'needs_attention' ? 'This payment needs attention.' : 'This payment was not completed.'}</span></p>`;
  else if (!tonight) state = html`<p class="big-state is-bad" role="alert">THIS IS FOR ANOTHER EVENING<br><span class="hint">${longDate(o.night_date, '0000')}</span></p>`;
  else if (!waiting && people.length) state = html`<p class="big-state is-done" role="status">ALREADY CHECKED IN${o.first_scanned_at ? html`<br><span class="hint">First scanned at ${clock(o.first_scanned_at)}</span>` : ''}</p>`;
  else if (scanned) state = html`<p class="big-state is-good" role="status">VALID: PAID IN ADVANCE<br><span class="hint">${summaryText(o.lines)}</span></p>`;
  const can = valid && tonight;
  return doorPage('Paid in advance', html`<p><a class="link" href="/admin/door">Back to the till</a> · <a class="link" href="/admin/door/orders?date=${o.night_date}">All advance payments</a></p>
${banner(ORDER_FLASH, flash)}
${state || ''}
${night && night.closed_for_public ? html`<p class="banner banner-error" role="alert">This evening is CLOSED to the public${night.closure_reason ? ': ' + night.closure_reason : ''}.</p>` : ''}
<section class="panel" aria-labelledby="o-h">
<h2 id="o-h">${o.reference} · ${pounds(o.total_pence)}</h2>
<p class="hint">${longDate(o.night_date, '0000')} · paid ${o.paid_at ? friendlyDateTime(o.paid_at) : '—'}</p>
${people.map((l) => html`<div class="guest-row"><div><span class="guest-name">${l.label}: ${l.qty}</span><br><span class="guest-meta">${l.admitted} of ${l.qty} let in</span></div>
${can ? html`<div class="row-actions">${l.admitted < l.qty ? html`<form method="post" action="/admin/door/order/${o.id}/admit">${hidden(csrf)}<input type="hidden" name="line_id" value="${l.id}"><button class="btn-checkin" type="submit">Let 1 in</button></form>` : html`<span class="in-label">All in ✓</span>`}
${l.admitted > 0 ? html`<form method="post" action="/admin/door/order/${o.id}/unadmit">${hidden(csrf)}<input type="hidden" name="line_id" value="${l.id}"><button class="pill" type="submit" data-confirm="Undo one ${l.label} check-in?">Undo 1</button></form>` : ''}</div>` : ''}</div>`)}
${can && waiting > 1 ? html`<form method="post" action="/admin/door/order/${o.id}/admit-all" class="spaced">${hidden(csrf)}<button class="btn-gold" type="submit">CHECK IN EVERYONE (${waiting})</button></form>` : ''}
${o.lines.filter((l) => l.category !== 'entry' && l.category !== 'development' && l.category !== 'raffle').map((l) => html`<div class="guest-row"><span class="guest-name">${l.label}: ${l.qty}</span></div>`)}
</section>
${strips ? html`<section class="panel raffle-panel${o.raffles_given_at ? ' is-given' : ''}" aria-labelledby="r-h">
<h2 id="r-h" class="sr-only">Raffle</h2>
${o.raffles_given_at ? html`<p class="big-state is-done" role="status">RAFFLES GIVEN ✓<br><span class="hint">${strips} ${strips === 1 ? 'strip' : 'strips'} at ${clock(o.raffles_given_at)}${o.raffles_given_by ? ' by ' + o.raffles_given_by : ''}</span></p>
<form method="post" action="/admin/door/order/${o.id}/raffles-undo">${hidden(csrf)}<button class="pill" type="submit" data-confirm="Undo RAFFLES GIVEN? Only do this if the strips were NOT handed over.">Undo</button></form>`
    : html`<p class="big-state is-raffle" role="alert">GIVE ${strips} RAFFLE ${strips === 1 ? 'STRIP' : 'STRIPS'}</p>
${can ? html`<form method="post" action="/admin/door/order/${o.id}/raffles">${hidden(csrf)}<button class="btn-gold" type="submit">RAFFLES GIVEN ✓</button></form>` : ''}`}
</section>` : ''}
<section class="panel" aria-labelledby="o-more"><h2 id="o-more">More</h2>
${o.email ? html`<p>Email: <a class="link" href="mailto:${o.email}">${o.email}</a></p>` : html`<p class="hint">No email address kept.</p>`}
${o.note ? html`<div class="note-box">${formatText(o.note)}</div>` : ''}
<div class="row-actions">
${valid && o.email ? html`<form method="post" action="/admin/door/order/${o.id}/resend">${hidden(csrf)}<button class="pill" type="submit">Email the QR code again</button></form>` : ''}
${o.status === 'paid' ? html`<form method="post" action="/admin/door/order/${o.id}/refunded">${hidden(csrf)}${o.refunded_at ? html`<input type="hidden" name="undo" value="1">` : ''}<button class="pill" type="submit" data-confirm="${o.refunded_at ? 'Unmark this payment as refunded?' : 'Have you refunded this payment in Square? This only records it here; it does not refund anything.'}">${o.refunded_at ? 'Not refunded after all' : 'Mark as refunded in Square'}</button></form>` : ''}
</div>
<form method="post" action="/admin/door/order/${o.id}/note" class="admin-form spaced">${hidden(csrf)}
<div class="field"><label for="o-note">Add a private note</label><input id="o-note" name="note" type="text" maxlength="500"></div><button class="pill" type="submit">Save note</button></form>
</section>
<p><a class="btn-gold btn-link" href="/admin/door">Back to the till</a></p>`, csrf);
}

export function ordersPage({ date, orders, q, csrf, flash, night }) {
  const paid = orders.filter((o) => o.status === 'paid' && !o.refunded_at);
  return doorPage('Paid in advance', html`<p class="door-date"><strong>${longDate(date, '0000')}</strong></p>
${nav(date)}
${night.closed_for_public ? html`<p class="banner banner-error" role="alert">This evening is CLOSED to the public. Mark each payment once you have refunded it in Square.</p>` : ''}
<p class="hint">${paid.length} ${paid.length === 1 ? 'payment' : 'payments'}, ${pounds(paid.reduce((n, o) => n + o.total_pence, 0))}. Advance payments count as “online” money for this night, and people count when they are let in at the door.</p>
<form method="get" action="/admin/door/orders" class="panel" role="search"><input type="hidden" name="date" value="${date}">
<label class="sr-only" for="o-q">Search</label><div class="search-form"><input id="o-q" name="q" type="search" value="${q}" placeholder="Reference or email" autocomplete="off"><button class="pill pill-gold" type="submit">SEARCH</button></div></form>
${orders.length ? html`<ul class="rows">${orders.map((o) => {
    const people = o.lines.filter((l) => l.category === 'entry' || l.category === 'development');
    const left = people.reduce((n, l) => n + (l.qty - l.admitted), 0);
    const strips = raffleStrips(o.lines);
    return html`<li class="row-card"><a class="row-text plain-link" href="/admin/door/order/${o.id}"><span class="row-title">${o.reference} · ${pounds(o.total_pence)}</span>
<span class="row-line">${summaryText(o.lines)}</span><span class="row-line">${o.email || 'email removed'}</span>
<span class="chips">${o.refunded_at ? html`<span class="chip chip-hidden">Refunded</span>` : o.status === 'needs_attention' ? html`<span class="chip chip-attention">Needs attention</span>`
      : people.length ? (left ? html`<span class="chip chip-soon">${left} to let in</span>` : html`<span class="chip chip-ok">All in ✓</span>`) : ''}
${strips && !o.refunded_at ? (o.raffles_given_at ? html`<span class="chip chip-ok">Raffles given ✓</span>` : html`<span class="chip chip-warn">Give ${strips} raffle ${strips === 1 ? 'strip' : 'strips'}</span>`) : ''}</span></a></li>`;
  })}</ul>` : html`<p class="panel">No advance payments${q ? ' match that search' : ' for this evening'}.</p>`}`, csrf);
}

// ---------- Close night ----------
const CLOSE_FLASH = { saved: ['ok', 'Cash count saved. The till is still open.'], reopened: ['ok', 'Night reopened: sales can be added and changed again.'] };

export function closePage({ date, night, totals, csrf, flash, errors = {}, values = {} }) {
  const t = totals;
  const floatV = values.float ?? (night.float_pence ? (night.float_pence / 100).toFixed(2) : '');
  const counted = values.counted ?? (night.counted_cash_pence !== null && night.counted_cash_pence !== undefined ? (night.counted_cash_pence / 100).toFixed(2) : '');
  const expected = (night.float_pence || 0) + t.money.cash;
  const field = (k, label, v, hint = '') => html`<div class="field${errors[k] ? ' has-error' : ''}"><label for="c-${k}">${label}</label><span class="price-input"><span aria-hidden="true">£</span><input id="c-${k}" name="${k}" type="text" inputmode="decimal" autocomplete="off" value="${v}"></span>${hint ? html`<p class="hint">${hint}</p>` : ''}${errors[k] ? html`<p class="error">${errors[k]}</p>` : ''}</div>`;
  return doorPage('Close night', html`<p class="door-date"><strong>${longDate(date, '0000')}</strong></p>
${nav(date)}
${banner(CLOSE_FLASH, flash)}
${night.till_closed_at ? html`<p class="banner banner-ok" role="status">This night was closed at ${clock(night.till_closed_at)}${night.till_closed_by ? ' by ' + night.till_closed_by : ''}.</p>` : ''}
<section class="panel" aria-labelledby="money-h"><h2 id="money-h">Tonight’s money</h2>
<dl class="detail-list">
<div><dt>Cash at the door (${t.money.cashSales} ${t.money.cashSales === 1 ? 'sale' : 'sales'})</dt><dd>${pounds(t.money.cash)}</dd></div>
<div><dt>Card at the door (${t.money.cardSales} ${t.money.cardSales === 1 ? 'sale' : 'sales'})</dt><dd>${pounds(t.money.card)}</dd></div>
<div><dt>Paid in advance online (${t.money.onlineOrders})</dt><dd>${pounds(t.money.online)}</dd></div>
<div><dt><strong>Total</strong></dt><dd><strong>${pounds(t.money.total)}</strong></dd></div>
</dl>
<p class="hint">Card and online payments go to Square. Only cash should be in the tin.</p></section>
<section class="panel" aria-labelledby="people-h"><h2 id="people-h">People and raffle</h2>
<dl class="detail-list">
<div><dt>Service (${t.people.doorEntry} paid at the door + ${t.people.admittedEntry} paid in advance)</dt><dd>${t.people.service}</dd></div>
<div><dt>Development Circle (${t.people.doorDevelopment} + ${t.people.admittedDevelopment})</dt><dd>${t.people.circle}</dd></div>
${t.people.noShowEntry ? html`<div><dt>Paid in advance but not let in</dt><dd>${t.people.noShowEntry}</dd></div>` : ''}
<div><dt>Raffle strips (${t.raffle.door} at the door + ${t.raffle.online} paid in advance, ${t.raffle.onlineGiven} of those given)</dt><dd>${t.raffle.total}</dd></div>
</dl></section>
<form method="post" action="/admin/door/close" class="panel admin-form">${hidden(csrf)}<input type="hidden" name="date" value="${date}">
<h2>Count the cash</h2>
${field('float', 'Float (cash in the tin at the start)', floatV, 'Leave as 0 if there was no float.')}
${field('counted', 'Cash counted at the end', counted)}
<p class="hint">Expected in the tin: float + cash sales${night.float_pence ? ` = ${pounds(expected)}` : ''}.${night.counted_cash_pence !== null && night.counted_cash_pence !== undefined ? ` Last count: ${pounds(night.counted_cash_pence)} (${night.counted_cash_pence - expected >= 0 ? 'over' : 'short'} by ${pounds(Math.abs(night.counted_cash_pence - expected))}).` : ''}</p>
<div class="field"><label for="c-note">Note (optional)</label><textarea id="c-note" name="note" rows="2" maxlength="1000">${values.note ?? night.close_note ?? ''}</textarea></div>
<div class="row-actions">${night.till_closed_at ? '' : html`<button class="btn-gold" type="submit" name="action" value="close" data-confirm="Close tonight? No more sales can be added unless you reopen it.">CLOSE NIGHT</button>`}
<button class="pill" type="submit" name="action" value="save">${night.till_closed_at ? 'Save the corrected count' : 'Save the count without closing'}</button></div>
</form>
${night.till_closed_at ? html`<form method="post" action="/admin/door/close" class="panel">${hidden(csrf)}<input type="hidden" name="date" value="${date}"><input type="hidden" name="action" value="reopen">
<p class="hint">Reopen only to correct a mistake. Everything is recorded in the change history.</p><button class="pill" type="submit" data-confirm="Reopen this night so sales can be changed?">Reopen this night</button></form>` : ''}
<p><a class="link" href="/admin/door/nights/${date}">See the full report for this night</a></p>`, csrf);
}

// ---------- reports ----------
export function nightsPage({ nights, csrf }) {
  return doorPage('Nights and reports', html`${nav(nights[0] ? nights[0].night_date : '')}
${nights.length ? html`<ul class="rows">${nights.map((n) => html`<li class="row-card"><a class="row-text plain-link" href="/admin/door/nights/${n.night_date}">
<span class="row-title">${longDate(n.night_date, '0000')}</span>
<span class="row-line">${pounds(n.totals.money.total)} taken · ${n.totals.people.service} at the service · ${n.totals.people.circle} at the circle</span>
<span class="chips">${n.closed_for_public ? html`<span class="chip chip-attention">Closed to the public</span>` : ''}${n.till_closed_at ? html`<span class="chip chip-ok">Cash counted ✓</span>` : n.totals.money.door ? html`<span class="chip chip-warn">Not closed yet</span>` : ''}</span></a></li>`)}</ul>`
    : html`<p class="panel">No Wednesday nights recorded yet.</p>`}`, csrf);
}

export function nightReportPage({ date, night, totals: t, sales, orders, csrf, flash }) {
  const expected = (night.float_pence || 0) + t.money.cash;
  const counted = night.counted_cash_pence;
  return doorPage('Night report', html`<p class="door-date"><strong>${longDate(date, '0000')}</strong></p>
${nav(date)}
${flash === 'closed' ? html`<p class="banner banner-ok" role="status">Night closed. Here is the report.</p>` : ''}
<p class="row-actions"><a class="pill pill-gold" href="/admin/door/nights/${date}.csv">Download as a spreadsheet (CSV)</a></p>
<section class="panel"><h2>Money</h2><dl class="detail-list">
<div><dt>Cash at the door</dt><dd>${pounds(t.money.cash)}</dd></div><div><dt>Card at the door</dt><dd>${pounds(t.money.card)}</dd></div>
<div><dt>Paid in advance online</dt><dd>${pounds(t.money.online)}</dd></div><div><dt><strong>Total</strong></dt><dd><strong>${pounds(t.money.total)}</strong></dd></div>
${t.money.refunded ? html`<div><dt>Refunded advance payments (not counted)</dt><dd>${pounds(t.money.refunded)}</dd></div>` : ''}</dl></section>
<section class="panel"><h2>By item</h2><dl class="detail-list">${Object.entries(t.categories).map(([k, c]) => html`<div><dt>${CATEGORY_LABEL[k] || k}: ${c.doorQty} at the door${c.onlineQty ? `, ${c.onlineQty} in advance` : ''}</dt><dd>${pounds(c.door + c.online)}</dd></div>`)}</dl></section>
<section class="panel"><h2>People and raffle</h2><dl class="detail-list">
<div><dt>Service</dt><dd>${t.people.service}</dd></div><div><dt>Development Circle</dt><dd>${t.people.circle}</dd></div>
${t.people.noShowEntry ? html`<div><dt>Paid in advance but not let in</dt><dd>${t.people.noShowEntry}</dd></div>` : ''}
<div><dt>Raffle strips</dt><dd>${t.raffle.total}</dd></div></dl></section>
<section class="panel"><h2>Cash</h2>${counted !== null && counted !== undefined ? html`<dl class="detail-list">
<div><dt>Float</dt><dd>${pounds(night.float_pence)}</dd></div><div><dt>Expected in the tin</dt><dd>${pounds(expected)}</dd></div>
<div><dt>Counted</dt><dd>${pounds(counted)}</dd></div><div><dt>Difference</dt><dd>${counted - expected === 0 ? 'None' : (counted > expected ? 'Over by ' : 'Short by ') + pounds(Math.abs(counted - expected))}</dd></div></dl>
${night.close_note ? html`<div class="note-box">${formatText(night.close_note)}</div>` : ''}` : html`<p>The cash hasn’t been counted yet. <a class="link" href="/admin/door/close?date=${date}">Close night</a></p>`}</section>
<details class="panel help"><summary>Every sale (${sales.length})</summary><ul class="todo">${sales.map((s) => html`<li>${clock(s.created_at)} ${s.method}: ${pounds(s.total_pence)} (${summaryText(s.lines)})${s.voided_at ? ' — CANCELLED' : ''}</li>`)}</ul></details>
<details class="panel help"><summary>Advance payments (${orders.length})</summary><ul class="todo">${orders.map((o) => html`<li><a class="link" href="/admin/door/order/${o.id}">${o.reference}</a>: ${pounds(o.total_pence)} (${summaryText(o.lines)})${o.refunded_at ? ' — refunded' : ''}</li>`)}</ul></details>`, csrf);
}

// ---------- buttons and prices ----------
const ITEMS_FLASH = { saved: ['ok', 'Saved{d}.'], added: ['ok', 'Button added: {d}.'], moved: ['ok', 'Moved.'], 'need-label': ['bad', 'Please give the button a name.'],
  'need-category': ['bad', 'Please choose what the button is for.'], 'need-price': ['bad', 'Please enter a price from £0.01 to £500, or tick “amount typed in at the door”.'],
  'bad-app-id': ['bad', 'That Square application ID doesn’t look right. Copy it from the Square Developer Dashboard.'] };

function itemForm(i, csrf) {
  const id = i ? i.id : 'new';
  return html`<form method="post" action="/admin/door/items" class="admin-form till-item-form">${hidden(csrf)}${i ? html`<input type="hidden" name="id" value="${i.id}">` : ''}
<div class="field"><label for="i-label-${id}">Button name</label><input id="i-label-${id}" name="label" type="text" maxlength="40" value="${i ? i.label : ''}"></div>
<div class="field"><label for="i-price-${id}">Price</label><span class="price-input"><span aria-hidden="true">£</span><input id="i-price-${id}" name="price" type="text" inputmode="decimal" value="${i && !i.custom_amount ? (i.price_pence / 100).toFixed(2) : ''}"></span></div>
<label class="field-check"><input type="checkbox" name="custom_amount" value="1"${i && i.custom_amount ? raw(' checked') : ''}> Amount typed in at the door (for example the Gift Shop)</label>
<div class="field"><label for="i-cat-${id}">What is it for?</label><select id="i-cat-${id}" name="category">${!i ? html`<option value="">Please choose…</option>` : ''}${CATEGORIES.map(([k, l]) => html`<option value="${k}"${i && i.category === k ? raw(' selected') : ''}>${l}</option>`)}</select></div>
<label class="field-check"><input type="checkbox" name="enabled" value="1"${!i || i.enabled ? raw(' checked') : ''}> Show on the till</label>
<label class="field-check"><input type="checkbox" name="online" value="1"${i && i.online ? raw(' checked') : ''}> Can also be paid for in advance online</label>
<button class="pill pill-gold" type="submit">${i ? 'Save' : 'Add button'}</button></form>`;
}

export function itemsPage({ items, prepay, settings, centre, csrf, flash, detail }) {
  const entry = items.find((i) => i.category === 'entry' && i.enabled);
  const dev = items.find((i) => i.category === 'development' && i.enabled);
  const mismatch = [entry && formatPrice(centre.entry_price) && formatPrice(centre.entry_price) !== formatPrice(entry.price_pence / 100) ? `Entry is ${formatPrice(centre.entry_price)} in Centre Settings but ${pounds(entry.price_pence)} on the till.` : '',
    dev && formatPrice(centre.circle_price) && formatPrice(centre.circle_price) !== formatPrice(dev.price_pence / 100) ? `The Development Circle is ${formatPrice(centre.circle_price)} in Centre Settings but ${pounds(dev.price_pence)} on the till.` : ''].filter(Boolean);
  return doorPage('Till buttons and prices', html`${nav('')}
${banner(ITEMS_FLASH, flash, detail ? ': ' + detail : '')}
<p class="hint">These buttons are on the till, in this order. The ones marked “in advance” can also be paid for online from the Who’s On page, at the same price. A price change only affects new sales: past nights keep the prices they were sold at.</p>
${mismatch.length ? html`<p class="banner banner-error" role="alert">${mismatch.join(' ')} The website shows the Centre Settings price, so you may want them to match.</p>` : ''}
<ul class="rows">${items.map((i, k) => html`<li class="row-card"><div class="row-text"><span class="row-title">${i.label} · ${i.custom_amount ? 'amount typed in' : pounds(i.price_pence)}</span>
<span class="chips"><span class="chip">${CATEGORY_LABEL[i.category]}</span>${i.enabled ? html`<span class="chip chip-live">On the till</span>` : html`<span class="chip chip-hidden">Switched off</span>`}${i.online ? html`<span class="chip chip-soon">In advance online</span>` : ''}</span></div>
<details class="help"><summary>Change</summary>${itemForm(i, csrf)}</details>
<div class="row-actions">${k > 0 ? html`<form method="post" action="/admin/door/items/${i.id}/up">${hidden(csrf)}<button class="pill" type="submit"><span aria-hidden="true">↑</span> Move up</button></form>` : ''}
${k < items.length - 1 ? html`<form method="post" action="/admin/door/items/${i.id}/down">${hidden(csrf)}<button class="pill" type="submit"><span aria-hidden="true">↓</span> Move down</button></form>` : ''}</div></li>`)}</ul>
<details class="panel help"><summary>Add a button</summary>${itemForm(null, csrf)}</details>
<form method="post" action="/admin/door/items" class="panel admin-form">${hidden(csrf)}<input type="hidden" name="action" value="settings">
<h2>Paying in advance online</h2>
<label class="field-check"><input type="checkbox" name="wed_prepay_open" value="1"${prepay.open ? raw(' checked') : ''}> Let people pay in advance online (optional for them; the Who’s On page always says no booking is needed)</label>
<div class="time-pair"><div class="field time-field"><label for="s-weeks">How many Wednesdays ahead</label><input id="s-weeks" name="wed_prepay_weeks" type="text" inputmode="numeric" value="${prepay.weeks}"></div>
<div class="field time-field"><label for="s-cut">Online payment stops at (UK time, on the evening)</label><input id="s-cut" name="wed_prepay_cutoff" type="time" value="${prepay.cutoff}"></div></div>
<h2>Card payments: Square app handoff (optional, off)</h2>
<p class="hint">When this is on, the CARD screen also shows a button that opens the Square Point of Sale app on the same Android phone with the total already filled in. It needs your Square <strong>application ID</strong>, and the address <code>/admin/door/square-callback</code> registered as the web callback in the Square Developer Dashboard (Point of Sale API). It only works with the real (Production) Square app, so it <strong>can’t be tested in Sandbox</strong> and has NOT been tested. Without it, the till works fully: take the card payment on your card reader as now, then press “Card payment taken ✓”.</p>
<div class="field"><label for="s-app">Square application ID</label><input id="s-app" name="pos_app_id" type="text" autocomplete="off" spellcheck="false" value="${settings.posAppId}"></div>
<label class="field-check"><input type="checkbox" name="pos_handoff" value="1"${settings.posHandoff ? raw(' checked') : ''}> Show “Open the Square app” on the CARD screen</label>
<button class="btn-gold" type="submit">Save settings</button></form>`, csrf);
}

// ---------- emergency closure ----------
const CLOSURE_FLASH = { closed: ['ok', 'Wednesday {d} is now shown as CLOSED, and nobody can pay in advance for it.'], reopened: ['ok', 'Wednesday {d} is open again.'],
  notified: ['ok', 'Closure emails: {d}.'], 'need-reason': ['bad', 'Please give a short reason. It is shown on the website.'], 'bad-date': ['bad', 'Please choose a Wednesday from today on.'],
  'not-closed': ['bad', 'That evening isn’t closed.'] };

export function closurePage({ closures, upcoming, affected, csrf, flash, detail }) {
  return doorPage('Emergency closure', html`${nav('')}
${banner(CLOSURE_FLASH, flash, detail)}
<p class="hint">Close one Wednesday, for example for bad weather. The website shows it as CLOSED with your reason (on Who’s On and the Home screen), and nobody can pay in advance for it. Everything else on the website keeps working, and nothing already recorded is deleted.</p>
${closures.length ? closures.map((c) => {
    const a = affected[c.night_date] || { n: 0, pence: 0, refunded: 0, notified: 0 };
    return html`<section class="panel" aria-label="${longDate(c.night_date, '0000')}">
<h2>CLOSED: ${longDate(c.night_date, '0000')}</h2><p>${c.closure_reason}</p><p class="hint">Set ${c.closure_set_at ? friendlyDateTime(c.closure_set_at) : ''}${c.closure_set_by ? ' by ' + c.closure_set_by : ''}</p>
${a.n ? html`<div class="banner banner-error"><p><strong>${a.n} ${a.n === 1 ? 'person has' : 'people have'} paid in advance (${pounds(a.pence)}).</strong> Refunds are NOT made automatically. Refund each payment in the Square Dashboard (or offer to carry it over), then mark it as refunded on <a class="link" href="/admin/door/orders?date=${c.night_date}">Paid in advance</a>. ${a.refunded} marked as refunded so far. ${a.notified} emailed about the closure.</p></div>
<form method="post" action="/admin/door/closure" class="admin-form">${hidden(csrf)}<input type="hidden" name="date" value="${c.night_date}"><input type="hidden" name="action" value="notify">
<div class="field"><label for="msg-${c.night_date}">Message for them (optional)</label><textarea id="msg-${c.night_date}" name="message" rows="3" maxlength="1000" placeholder="${c.closure_reason}"></textarea></div>
<button class="pill pill-gold" type="submit" data-confirm="Email everyone who paid in advance for this evening? Each person is only emailed once.">Email everyone who paid in advance</button></form>` : html`<p class="hint">Nobody has paid in advance for this evening.</p>`}
<form method="post" action="/admin/door/closure">${hidden(csrf)}<input type="hidden" name="date" value="${c.night_date}"><input type="hidden" name="action" value="open"><button class="pill" type="submit" data-confirm="Reopen this Wednesday?">Reopen this Wednesday</button></form>
</section>`;
  }) : html`<p class="panel">No Wednesdays are closed.</p>`}
<form method="post" action="/admin/door/closure" class="panel admin-form">${hidden(csrf)}<input type="hidden" name="action" value="close">
<h2>Close a Wednesday</h2>
<div class="field"><label for="cl-date">Which Wednesday?</label><select id="cl-date" name="date">${upcoming.map((d) => html`<option value="${d}">${longDate(d, '0000')}</option>`)}</select></div>
<div class="field"><label for="cl-reason">Reason (shown on the website)</label><input id="cl-reason" name="reason" type="text" maxlength="300" placeholder="e.g. Closed due to snow. Stay safe, see you next week."></div>
<button class="btn-gold" type="submit" data-confirm="Close this Wednesday? It shows as CLOSED on the website straight away.">CLOSE THIS WEDNESDAY</button></form>`, csrf);
}

export { icon };
