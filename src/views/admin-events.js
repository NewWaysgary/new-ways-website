// Admin screens for event tickets: the event's own page, questions, guest list, totals, bookings.
import { html, raw, formatText } from '../lib/html.js';
import { adminPage } from './admin.js';
import { longDate, friendlyDateTime } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { money } from '../notify.js';
import { testBanner } from './admin-orders.js';
import { bookingFields } from './tickets.js';
import { QUESTION_TYPES, CHOICE_TYPES, PAYMENT_METHODS, methodLabel, PAYMENT_STATUS_LABEL } from '../events/model.js';
import { EMAIL_KINDS } from '../events/emails.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const typeLabel = (t) => (QUESTION_TYPES.find(([k]) => k === t) || [t, t])[1];
const BOOKING_STATUS = {
  held: ['soon', 'BEING PAID FOR'], confirmed: ['live', 'BOOKED'], cancelled: ['past', 'CANCELLED'], expired: ['past', 'NOT PAID (HOLD RAN OUT)'], needs_attention: ['attention', 'NEEDS ATTENTION']
};
export const bookingChip = (s) => { const [k, t] = BOOKING_STATUS[s] || ['past', s]; return html`<span class="chip chip-${k}">${t}</span>`; };
const payChip = (b) => html`<span class="chip chip-${b.payment_status === 'unpaid' ? 'attention' : b.payment_status === 'pending' ? 'soon' : 'live'}">${PAYMENT_STATUS_LABEL[b.payment_status] || b.payment_status}: ${methodLabel(b.payment_method)}</span>`;
const eventLine = (e) => `${longDate(e.date, '0000')}${e.start_time ? ', ' + friendlyTime(e.start_time) : e.time_text ? ', ' + e.time_text : ''}`;
const backTo = (e, label = 'Back to this event') => html`<p><a class="link" href="/admin/events/${e.id}/manage">${label}</a></p>`;
const SALES = { open: ['live', 'ON SALE'], sold_out: ['attention', 'SOLD OUT'], not_open: ['soon', 'NOT ON SALE YET'], closed: ['past', 'ONLINE SALES CLOSED'], past: ['past', 'FINISHED'],
  off: ['hidden', 'NOT SOLD ONLINE'] };

// ---------- the event's own page ----------
export function hubPage({ event, counts, checkin, state, questions, csrf, mode, ticketsReady, flash, shareUrl = '' }) {
  const [k, t] = SALES[state] || ['hidden', state];
  const left = event.capacity > 0 ? Math.max(0, event.capacity - counts.taken) : null;
  return adminPage({
    title: event.name, csrf, signedIn: true,
    body: html`${testBanner(mode)}<p><a class="link" href="/admin/events">Back to Events</a></p>
${flash === 'booked' ? html`<p class="banner banner-ok" role="status">Booking added. It is on the guest list now.</p>` : ''}
<section class="panel" aria-labelledby="ev-sum">
<h2 id="ev-sum">${eventLine(event)}</h2>
<p class="chips"><span class="chip chip-${k}">${t}</span>${event.visible ? '' : html`<span class="chip chip-hidden">DRAFT (not on the website)</span>`}</p>
<div class="stats stats-4" aria-label="Places">
<p><strong>${event.capacity || '–'}</strong> capacity</p>
<p><strong>${counts.confirmed}</strong> booked</p>
<p><strong>${counts.held}</strong> being paid for</p>
<p><strong>${left === null ? '–' : left}</strong> remaining</p>
</div>
<p class="hint">Online and Admin bookings both count. ${event.sales_mode === 'online' ? (ticketsReady ? '' : 'Online booking opens once Square and the spam check are connected.') : event.sales_mode === 'link' ? 'Tickets for this event are sold through your Square ticket link. You can still add bookings here, for example cash bookings, and use the guest list and check-in.' : 'This event has no tickets to buy. You can still add bookings here.'}</p>
<p><strong>${checkin.arrived}</strong> of ${checkin.booked} guests checked in.</p>
</section>
<p><a class="btn-gold btn-link" href="/admin/checkin/${event.id}">Check in</a></p>
${shareUrl ? html`<section class="panel" aria-labelledby="ev-share">
<h2 id="ev-share">Share this event</h2>
${event.visible ? '' : html`<p class="banner banner-error" role="alert">This event is a draft, so its link shows “page not found” until you publish it (Edit event, then tick Published).</p>`}
<p class="copy-link">${shareUrl}</p>
<div class="row-actions"><button type="button" class="pill pill-gold" data-copy="${shareUrl}">Copy link</button>
<button type="button" class="pill pill-gold" data-share-url="${shareUrl}" data-share-title="${event.name}" hidden>Share…</button>
<a class="pill" href="${shareUrl}" target="_blank" rel="noopener">Open the event page</a></div>
<p class="hint">Paste this link into Facebook, WhatsApp or a message. The preview shows the poster, the event name, the date and the short information. A poster saved before this update has no JPEG copy yet: save the poster again (Edit event) for the most reliable WhatsApp preview.</p>
</section>` : ''}
<ul class="tiles">
<li><a class="tile" href="/admin/events/${event.id}/tables"><span class="tile-text"><span class="tile-label">Table plan</span><span class="tile-sub">Round tables, Mediums’ table, catering report to print</span></span></a></li>
<li><a class="tile" href="/admin/events/${event.id}/guests"><span class="tile-text"><span class="tile-label">Guest list</span><span class="tile-sub">Search, filter, open bookings</span></span></a></li>
<li><a class="tile" href="/admin/events/${event.id}/bookings/new"><span class="tile-text"><span class="tile-label">Add a booking</span><span class="tile-sub">Cash, card, complimentary or other</span></span></a></li>
<li><a class="tile" href="/admin/events/${event.id}/questions"><span class="tile-text"><span class="tile-label">Questions for guests</span><span class="tile-sub">${questions.length ? `${questions.length} ${questions.length === 1 ? 'question' : 'questions'}, e.g. meal choice` : 'Only guest names are asked. Add questions such as meal choice.'}</span></span></a></li>
<li><a class="tile" href="/admin/events/${event.id}/totals"><span class="tile-text"><span class="tile-label">Meal and option totals</span><span class="tile-sub">How many chose each option, and who</span></span></a></li>
<li><a class="tile" href="/admin/events/${event.id}"><span class="tile-text"><span class="tile-label">Edit event</span><span class="tile-sub">Details, price, places, online sales</span></span></a></li>
<li><a class="tile" href="/admin/events/${event.id}/guests.csv"><span class="tile-text"><span class="tile-label">Download the guest list</span><span class="tile-sub">A spreadsheet file (CSV)</span></span></a></li>
${event.sales_mode === 'online' && event.visible ? html`<li><a class="tile" href="/events/${event.id}/book" target="_blank" rel="noopener"><span class="tile-text"><span class="tile-label">See the booking page</span><span class="tile-sub">As customers see it</span></span></a></li>` : ''}
</ul>`
  });
}

// ---------- questions ----------
export function questionsPage({ event, questions, answerCounts, others, csrf, flash }) {
  const FLASH = { saved: 'Saved.', added: 'Question added.', deleted: 'Question deleted.', toggled: 'Updated.', moved: 'Order changed.', copied: 'Questions copied.' };
  const act = (q, a, label, cls = 'pill', confirm = '', extra = '') => html`<form method="post" action="/admin/events/${event.id}/questions/${q.id}/${a}">${hidden(csrf)}${raw(extra)}<button type="submit" class="${cls}"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  return adminPage({
    title: 'Questions for guests', csrf, signedIn: true,
    body: html`${backTo(event)}
<p class="hint">Every ticket always asks for the guest’s name. Add any other questions this event needs, for example a meal choice for a Psychic Supper. Questions can be asked for each guest, or once for the whole booking.</p>
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<p><a class="btn-gold btn-link" href="/admin/events/${event.id}/questions/new">Add a question</a></p>
${questions.length ? html`<ul class="rows">${questions.map((q, i) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${q.label}</span>
<span class="row-line">${typeLabel(q.type)} · ${q.scope === 'guest' ? 'asked for each guest' : 'asked once per booking'} · ${q.required ? 'must be answered' : 'optional'}</span>
${CHOICE_TYPES.includes(q.type) ? html`<span class="row-line">Options: ${q.options.filter((o) => o.active).map((o) => o.label).join(', ') || 'none yet'}</span>` : ''}
<span class="chips">${q.active ? '' : html`<span class="chip chip-hidden">Not asked any more</span>`}${answerCounts[q.id] ? html`<span class="chip chip-soon">${answerCounts[q.id]} answered</span>` : ''}</span>
</div>
<div class="row-actions">
<a class="pill pill-gold" href="/admin/events/${event.id}/questions/${q.id}">Edit</a>
${act(q, 'toggle', q.active ? 'Stop asking' : 'Ask again')}
${i > 0 ? act(q, 'move', html`<span aria-hidden="true">↑</span> Move up`, 'pill', '', '<input type="hidden" name="dir" value="up">') : ''}
${i < questions.length - 1 ? act(q, 'move', html`<span aria-hidden="true">↓</span> Move down`, 'pill', '', '<input type="hidden" name="dir" value="down">') : ''}
${answerCounts[q.id] ? '' : act(q, 'delete', 'Delete', 'pill pill-danger', 'Delete this question?')}
</div></li>`)}</ul>` : html`<p class="panel">No questions yet: only guest names are asked.</p>`}
${others.length ? html`<form method="post" action="/admin/events/${event.id}/questions" class="panel admin-form">${hidden(csrf)}
<h2>Copy questions from another event</h2>
<p class="hint">Handy when you run the same kind of event again. The questions are added to any already here.</p>
<div class="field"><label for="copy-from">Event</label><select id="copy-from" name="copy_from">${others.map((o) => html`<option value="${o.id}">${o.name}, ${longDate(o.date, '0000')} (${o.n} ${o.n === 1 ? 'question' : 'questions'})</option>`)}</select></div>
<button class="pill pill-gold" type="submit">Copy questions</button></form>` : ''}`
  });
}

export function questionEditPage({ event, question, values, errors = {}, csrf, answered }) {
  const err = (k) => (errors[k] ? html`<p class="error">${errors[k]}</p>` : '');
  const opts = values.options ?? '';
  return adminPage({
    title: question ? 'Edit question' : 'Add a question', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/events/${event.id}/questions">Back to questions</a></p>
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the highlighted details.</p>` : ''}
<form method="post" action="/admin/events/${event.id}/questions/${question ? question.id : 'new'}" class="admin-form" data-unsaved-warning>${hidden(csrf)}
<div class="panel">
<div class="field${errors.label ? ' has-error' : ''}"><label for="q-label">Question</label><input id="q-label" name="label" type="text" maxlength="150" value="${values.label || ''}" placeholder="e.g. Meal choice" required>${err('label')}</div>
<div class="field"><label for="q-help">Extra help (optional)</label><input id="q-help" name="help" type="text" maxlength="300" value="${values.help || ''}" placeholder="e.g. Please tell us about any allergies"></div>
<div class="field${errors.type ? ' has-error' : ''}"><label for="q-type">Type of answer</label>
<select id="q-type" name="type"${answered ? raw(' disabled') : ''}>${QUESTION_TYPES.map(([k, l]) => html`<option value="${k}"${values.type === k ? raw(' selected') : ''}>${l}</option>`)}</select>
${answered ? html`<input type="hidden" name="type" value="${values.type}"><p class="hint">The type can’t be changed because guests have already answered.</p>` : ''}${err('type')}</div>
<div class="field${errors.options ? ' has-error' : ''}"><label for="q-options">Options (for drop-down and multiple choice)</label>
<textarea id="q-options" name="options" rows="5" aria-describedby="q-options-help">${opts}</textarea>
<p class="hint" id="q-options-help">One option per line, for example Steak Pie, Chicken, Vegetarian. Removing an option stops it being offered; answers already given keep it.</p>${err('options')}</div>
<div class="field"><label for="q-scope">Ask this</label><select id="q-scope" name="scope">
<option value="guest"${values.scope !== 'booking' ? raw(' selected') : ''}>For each guest</option>
<option value="booking"${values.scope === 'booking' ? raw(' selected') : ''}>Once for the whole booking</option></select></div>
<div class="field field-check"><label><input type="checkbox" name="required" value="1"${Number(values.required) ? raw(' checked') : ''}> Must be answered before booking</label><p class="hint">For a tick box, this means it must be ticked (for example to confirm something).</p></div>
</div>
<p class="form-actions"><button class="btn-gold" type="submit">${question ? 'Save changes' : 'Add this question'}</button></p>
</form>`
  });
}

// ---------- guest list ----------
export function guestListPage({ event, bookings, filters, questions, counts, csrf, flash }) {
  const opts = [];
  for (const q of questions.filter((x) => CHOICE_TYPES.includes(x.type) || x.type === 'checkbox')) {
    if (q.type === 'checkbox') opts.push([`q${q.id}:Yes`, `${q.label}: ticked`]);
    for (const o of q.options) opts.push([`q${q.id}:${o.label}`, `${q.label}: ${o.label}`]);
  }
  const sel = (name, value, list, label) => html`<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${list.map(([k, l]) => html`<option value="${k}"${k === value ? raw(' selected') : ''}>${l}</option>`)}</select></div>`;
  const guestCount = bookings.reduce((n, b) => n + b.shown.length, 0);
  return adminPage({
    title: 'Guest list', csrf, signedIn: true,
    body: html`${backTo(event)}
<p class="hint">${event.name}, ${eventLine(event)}. ${counts.confirmed} booked${event.capacity ? ` of ${event.capacity}` : ''}.</p>
${flash ? html`<p class="banner banner-ok" role="status">${flash}</p>` : ''}
<form method="get" action="/admin/events/${event.id}/guests" class="panel">
<div class="search-form"><label class="sr-only" for="f-q">Search</label><input id="f-q" name="q" type="search" value="${filters.q}" placeholder="Name, email or reference" autocomplete="off"><button class="pill pill-gold" type="submit">Search</button></div>
<div class="filters">
${sel('status', filters.status, [['booked', 'Booked'], ['attention', 'Needs attention'], ['held', 'Being paid for'], ['cancelled', 'Cancelled or not paid'], ['all', 'All']], 'Bookings')}
${sel('pay', filters.pay, [['', 'Any payment'], ['unpaid', 'Still to pay'], ...PAYMENT_METHODS], 'Payment')}
${sel('arrived', filters.arrived, [['', 'Everyone'], ['yes', 'Arrived'], ['no', 'Not arrived']], 'Check-in')}
${opts.length ? sel('answer', filters.answer, [['', 'Any answers'], ...opts], 'Answer') : ''}
</div>
<button class="pill" type="submit">Show</button> <a class="link" href="/admin/events/${event.id}/guests.csv?${new URLSearchParams(filters).toString()}">Download this list (CSV)</a>
</form>
<p class="hint">${guestCount} ${guestCount === 1 ? 'guest' : 'guests'} in ${bookings.length} ${bookings.length === 1 ? 'booking' : 'bookings'}.</p>
${bookings.length ? html`<ul class="rows">${bookings.map((b) => html`<li class="row-card">
<div class="row-text">
<span class="row-title">${b.purchaser_name || 'Details removed'} · ${b.quantity} ${b.quantity === 1 ? 'ticket' : 'tickets'}</span>
<span class="row-line">${b.reference}${b.purchaser_email ? ' · ' + b.purchaser_email : ''}${b.purchaser_phone ? ' · ' + b.purchaser_phone : ''}</span>
<span class="chips">${bookingChip(b.status)}${payChip(b)}${b.marketing_opt_in ? html`<span class="chip chip-soon">Mailing list</span>` : ''}</span>
</div>
<div>${b.shown.map((g) => html`<div class="guest-row${g.checked_in_at ? ' is-in' : ''}"><div><span class="guest-name">${g.name}</span>
${g.answers.filter((a) => a.value).length ? html`<ul class="answers-list">${g.answers.filter((a) => a.value).map((a) => html`<li>${a.question_label}: ${a.value}${a.original_value && a.original_value !== a.value ? html` <span class="chip chip-attention">changed from ${a.original_value}</span>` : ''}</li>`)}</ul>` : ''}</div>
<span class="guest-meta">${g.checked_in_at ? `Arrived ${friendlyDateTime(g.checked_in_at)}` : 'Not arrived'}</span></div>`)}</div>
${b.answers.filter((a) => a.value).length ? html`<ul class="answers-list">${b.answers.filter((a) => a.value).map((a) => html`<li>${a.question_label}: ${a.value}</li>`)}</ul>` : ''}
${b.note ? html`<div class="note-box">${formatText(b.note)}</div>` : ''}
<div class="row-actions"><a class="pill pill-gold" href="/admin/events/${event.id}/bookings/${b.id}">Open booking</a></div>
</li>`)}</ul>` : html`<p class="panel">No bookings match.</p>`}`
  });
}

// ---------- totals ----------
export function totalsPage({ event, totals, csrf }) {
  return adminPage({
    title: 'Meal and option totals', csrf, signedIn: true,
    body: html`${backTo(event)}
<p class="hint">${event.name}, ${eventLine(event)}. Counted from booked guests only (not cancelled or unpaid holds). Tap a total to see who chose it.</p>
${totals.length ? totals.map((t) => html`<section class="panel" aria-label="${t.label}">
<h2>${t.label}</h2>
<p class="hint">${t.scope === 'guest' ? 'Per guest' : 'Per booking'}${t.missing ? ` · ${t.missing} not answered` : ''}</p>
${t.rows.length ? t.rows.map((r) => html`<details class="help"><summary class="option-total"><span>${r.value}</span><strong>${r.count}</strong></summary>
<ul class="todo">${r.people.map((p) => html`<li>${p.name} <span class="hint">(${p.reference}${p.purchaser && p.purchaser !== p.name ? ', booked by ' + p.purchaser : ''})</span></li>`)}</ul></details>`) : html`<p>No answers yet.</p>`}
</section>`) : html`<p class="panel">This event has no multiple-choice or tick-box questions, so there are no totals. Add one under Questions for guests.</p>`}`
  });
}

// ---------- one booking ----------
const B_FLASH = { cancelled: 'Booking cancelled. The places are free again. No refund has been made; if you decide to refund, do it in Square (or in person).',
  paid: 'Marked as paid.', sent: 'Confirmation email sent.', 'send-failed': 'The email could not be sent. Please check the email settings (Admin > System status).', noted: 'Note saved.',
  saved: 'Changes saved. The original answers are kept in the history below.', confirmed: 'Booking confirmed.', resolved: 'Marked as dealt with.', full: 'There aren’t enough places left to confirm this booking. Raise the maximum number of places first.',
  added: 'Booking added.', 'added-sent': 'Booking added, and the confirmation email with the QR code has been sent.', 'added-not-sent': 'Booking added, but the confirmation email could not be sent.' };

export function bookingPage({ event, b, changes, emails, csrf, flash, mode }) {
  let snap = null;
  try { snap = b.confirmed_snapshot ? JSON.parse(b.confirmed_snapshot) : null; } catch { snap = null; }
  const act = (a, label, cls = 'pill', confirm = '', extra = '') => html`<form method="post" action="/admin/events/${event.id}/bookings/${b.id}/${a}">${hidden(csrf)}${raw(extra)}<button type="submit" class="${cls}"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  const sentBefore = emails.some((e) => e.kind === 'customer_confirmation' && e.status === 'sent');
  const rows = [['Reference', b.reference], ['Event', `${event.name}, ${eventLine(event)}`], ['Tickets', String(b.quantity)],
    ['Amount', b.payment_status === 'free' ? 'Complimentary' : money(b.total_pence)], ['Payment', `${PAYMENT_STATUS_LABEL[b.payment_status] || b.payment_status} (${methodLabel(b.payment_method)})`],
    ['Booked', friendlyDateTime(b.created_at) + (b.source === 'admin' ? ' in Admin' : ' online')], ...(b.paid_at ? [['Paid', friendlyDateTime(b.paid_at)]] : []),
    ...(b.square_payment_id ? [['Square payment', b.square_payment_id]] : []), ...(b.square_order_id ? [['Square order', b.square_order_id]] : [])];
  return adminPage({
    title: 'Event booking', csrf, signedIn: true,
    body: html`${testBanner(mode)}<p><a class="link" href="/admin/events/${event.id}/guests">Back to the guest list</a></p>
${B_FLASH[flash] ? html`<p class="banner ${flash === 'full' || flash === 'send-failed' || flash === 'added-not-sent' ? 'banner-error' : 'banner-ok'}" role="status">${B_FLASH[flash]}</p>` : ''}
<section class="panel" aria-labelledby="b-status"><h2 id="b-status">${bookingChip(b.status)} ${payChip(b)}</h2>
${b.note ? html`<div class="note-box">${formatText(b.note)}</div>` : ''}
<dl class="detail-list">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></section>
<section class="panel" aria-labelledby="b-who"><h2 id="b-who">Purchaser</h2>
${b.personal_data_removed_at ? html`<p>Contact details were removed on ${friendlyDateTime(b.personal_data_removed_at)}, as set in Booking rules. The booking record is kept.</p>` : html`<dl class="detail-list">
<div><dt>Name</dt><dd>${b.purchaser_name || '—'}</dd></div>
<div><dt>Email</dt><dd>${b.purchaser_email ? html`<a class="link" href="mailto:${b.purchaser_email}">${b.purchaser_email}</a>` : '—'}</dd></div>
<div><dt>Phone</dt><dd>${b.purchaser_phone ? html`<a class="link" href="tel:${b.purchaser_phone}">${b.purchaser_phone}</a>` : '—'}</dd></div>
<div><dt>Mailing list</dt><dd>${b.marketing_opt_in ? 'Asked to join' : 'No'}</dd></div></dl>`}</section>
<section class="panel" aria-labelledby="b-guests"><h2 id="b-guests">Guests</h2>
${b.guests.map((g) => html`<div class="guest-row${g.checked_in_at ? ' is-in' : ''}"><div><span class="guest-name">${g.name}</span>
${g.answers.filter((a) => a.value || a.original_value).length ? html`<ul class="answers-list">${g.answers.filter((a) => a.value || a.original_value).map((a) => html`<li>${a.question_label}: ${a.value || '(none)'}${a.original_value !== a.value ? html` <span class="chip chip-attention">customer chose: ${a.original_value || '(nothing)'}</span>` : ''}</li>`)}</ul>` : ''}</div>
<span class="guest-meta">${g.checked_in_at ? `Arrived ${friendlyDateTime(g.checked_in_at)}${g.checked_in_by ? ' (' + g.checked_in_by + ')' : ''}` : 'Not arrived'}</span></div>`)}
${b.answers.filter((a) => a.value || a.original_value).length ? html`<ul class="answers-list">${b.answers.filter((a) => a.value || a.original_value).map((a) => html`<li>${a.question_label}: ${a.value || '(none)'}${a.original_value !== a.value ? html` <span class="chip chip-attention">customer chose: ${a.original_value || '(nothing)'}</span>` : ''}</li>`)}</ul>` : ''}
${!b.personal_data_removed_at && b.status !== 'cancelled' && b.status !== 'expired' ? html`<p><a class="pill pill-gold" href="/admin/events/${event.id}/bookings/${b.id}/edit">Change names or answers</a></p>` : ''}
</section>
<section class="panel" aria-labelledby="b-actions"><h2 id="b-actions">Actions</h2>
<div class="row-actions">
${b.status === 'confirmed' && b.payment_status === 'unpaid' ? html`<form method="post" action="/admin/events/${event.id}/bookings/${b.id}/paid">${hidden(csrf)}
<label class="sr-only" for="pay-method">Paid by</label><select id="pay-method" name="method">${PAYMENT_METHODS.filter(([k]) => k !== 'complimentary').map(([k, l]) => html`<option value="${k}"${k === b.payment_method ? raw(' selected') : ''}>${l}</option>`)}</select>
<button class="pill pill-gold" type="submit">Mark as paid</button></form>` : ''}
${b.status === 'confirmed' && b.purchaser_email && !b.personal_data_removed_at ? act('send', sentBefore ? 'Send the confirmation email again' : 'Send the confirmation email and QR code', 'pill pill-gold') : ''}
${b.status === 'needs_attention' ? act('keep', 'Confirm this booking (if places are free)', 'pill pill-gold', 'Confirm this booking and send the confirmation email?') : ''}
${b.status === 'needs_attention' ? act('resolve', 'Mark as dealt with (frees the places)', 'pill', 'Mark this as dealt with?') : ''}
${b.status === 'confirmed' || b.status === 'held' ? act('cancel', 'Cancel this booking', 'pill pill-danger', 'Cancel this booking and free the places? No refund is made automatically.') : ''}
</div>
<form method="post" action="/admin/events/${event.id}/bookings/${b.id}/note" class="admin-form">${hidden(csrf)}
<div class="field"><label for="b-note">Add a private note</label><textarea id="b-note" name="note" rows="3" maxlength="1000"></textarea></div>
<button type="submit" class="pill">Save note</button></form>
</section>
${snap ? html`<section class="panel" aria-labelledby="b-snap"><h2 id="b-snap">${b.source === 'online' ? 'What the customer confirmed' : 'What was recorded'}</h2>
<p class="hint">${b.source === 'online' ? 'Shown to the customer on the REVIEW YOUR BOOKING screen and confirmed' : 'Recorded in Admin'} ${friendlyDateTime(snap.confirmed_at)}. This record never changes.</p>
<ul class="todo">${(snap.guests || []).map((g) => html`<li>Guest ${g.guest}: ${g.name}${(g.answers || []).map((a) => html`<br><span class="hint">${a.question}: ${a.answer}</span>`)}</li>`)}
${(snap.booking_answers || []).map((a) => html`<li>${a.question}: ${a.answer}</li>`)}
<li>Total: ${money(snap.total_pence || 0)}</li></ul>
${snap.terms ? html`<details class="help"><summary>Booking terms agreed</summary><div class="terms-text">${formatText(snap.terms)}</div></details>` : ''}
</section>` : ''}
${changes.length ? html`<section class="panel" aria-labelledby="b-hist"><h2 id="b-hist">Change history</h2>
<ul class="todo history">${changes.map((c) => html`<li>${friendlyDateTime(c.changed_at)}: ${c.what} changed from “${c.old_value || '(nothing)'}” to “${c.new_value || '(nothing)'}”${c.changed_by ? ' by ' + c.changed_by : ''}</li>`)}</ul></section>` : ''}
${emails.length ? html`<section class="panel" aria-labelledby="b-emails"><h2 id="b-emails">Emails</h2>
<ul class="todo">${emails.map((e) => html`<li>${EMAIL_KINDS[e.kind] || (e.kind.startsWith('resend') ? 'Confirmation sent again' : e.kind)}: ${{ sent: 'sent', failed: 'NOT sent (failed)', not_configured: 'NOT sent (email not set up yet)', sending: 'sending', skipped: 'not sent' }[e.status] || e.status}, ${friendlyDateTime(e.created_at)}</li>`)}</ul></section>` : ''}`
  });
}

export function bookingEditPage({ event, b, questions, fields, errors = {}, csrf }) {
  return adminPage({
    title: 'Change names or answers', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/events/${event.id}/bookings/${b.id}">Back to the booking</a></p>
<p class="hint">Changes are recorded: the customer’s original choices are always kept and shown in the booking’s history.</p>
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the highlighted details.</p>` : ''}
<form method="post" action="/admin/events/${event.id}/bookings/${b.id}/edit" class="admin-form share-form" novalidate>${hidden(csrf)}
<input type="hidden" name="qty" value="${b.quantity}">
${bookingFields({ qty: b.quantity, questions, fields, errors, admin: true })}
<p class="form-actions"><button class="btn-gold" type="submit">Save changes</button></p>
</form>`
  });
}

export function addBookingPage({ event, questions, qty, fields = {}, errors = {}, notice = '', csrf, left }) {
  if (!qty) {
    return adminPage({
      title: 'Add a booking', csrf, signedIn: true,
      body: html`${backTo(event)}
<p class="hint">For cash, card, complimentary or any other booking made directly with you. It counts towards the places and appears on the guest list. ${left === null ? '' : `${left} ${left === 1 ? 'place' : 'places'} left.`}</p>
<form method="get" action="/admin/events/${event.id}/bookings/new" class="panel admin-form">
<div class="field"><label for="a-qty">Number of tickets</label><select id="a-qty" name="qty">${Array.from({ length: 20 }, (_, i) => i + 1).map((n) => html`<option value="${n}">${n}</option>`)}</select></div>
<button class="btn-gold" type="submit">Continue</button></form>`
    });
  }
  const v = (k) => String(fields[k] ?? '');
  const pm = v('method') || 'cash';
  return adminPage({
    title: 'Add a booking', csrf, signedIn: true,
    body: html`${backTo(event)}
${notice ? html`<p class="banner banner-error" role="alert">${notice}</p>` : ''}
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the highlighted details.</p>` : ''}
<p class="hint">${qty} ${qty === 1 ? 'ticket' : 'tickets'} for ${event.name}. <a class="link" href="/admin/events/${event.id}/bookings/new">Change</a>. Questions can be left empty if you don’t know the answer yet.</p>
<form method="post" action="/admin/events/${event.id}/bookings/new" class="admin-form share-form" novalidate>${hidden(csrf)}
<input type="hidden" name="qty" value="${qty}">
${bookingFields({ qty, questions, fields, errors, admin: true })}
<fieldset class="guest-block"><legend>Payment</legend>
<div class="field"><label for="a-method">How was it paid?</label><select id="a-method" name="method">${PAYMENT_METHODS.map(([k, l]) => html`<option value="${k}"${k === pm ? raw(' selected') : ''}>${l}</option>`)}</select></div>
<div class="field"><label for="a-paid">Payment</label><select id="a-paid" name="paid"><option value="paid"${v('paid') !== 'unpaid' ? raw(' selected') : ''}>Paid already</option><option value="unpaid"${v('paid') === 'unpaid' ? raw(' selected') : ''}>Still to pay (e.g. at the door)</option></select><p class="hint">Not used for complimentary bookings.</p></div>
<div class="field${errors.amount ? ' has-error' : ''}"><label for="a-amount">Total amount (optional)</label><span class="price-input"><span aria-hidden="true">£</span><input id="a-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" value="${v('amount')}" placeholder="${(event.price_pence * qty / 100).toFixed(2)}"></span>
<p class="hint">Leave empty for the normal price (${money(event.price_pence * qty)}).</p>${errors.amount ? html`<p class="error">${errors.amount}</p>` : ''}</div>
</fieldset>
<div class="field"><label for="a-note">Private note (optional)</label><textarea id="a-note" name="note" rows="3" maxlength="1000">${v('note')}</textarea></div>
<div class="field field-check"><label><input type="checkbox" name="marketing" value="1"${v('marketing') === '1' ? raw(' checked') : ''}> The purchaser asked to join the mailing list</label></div>
<div class="field field-check"><label><input type="checkbox" name="send" value="1"${v('send') === '1' ? raw(' checked') : ''}> Email the confirmation and QR code to the purchaser (needs an email address)</label></div>
<p class="form-actions"><button class="btn-gold" type="submit">Add this booking</button></p>
</form>`
  });
}
