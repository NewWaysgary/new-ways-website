// Admin › Events › (event) › Import a paper list
import { html } from '../lib/html.js';
import { adminPage } from './admin.js';
import { money } from '../notify.js';
import { PAY_CHOICES } from '../admin/paper-import.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const backTo = (e) => html`<p><a class="link" href="/admin/events/${e.id}/manage">Back to this event</a></p>`;
const payLabel = (k) => (PAY_CHOICES.find(([x]) => x === k) || [k, k])[1];

function options(event, values) {
  return html`<div class="field"><label for="pi-pay">Payment for everyone on this list</label>
<select id="pi-pay" name="pay">${PAY_CHOICES.map(([k, l]) => html`<option value="${k}"${values.pay === k ? ' selected' : ''}>${l}</option>`)}</select>
<p class="hint">${event.price_pence ? `Each ticket is ${money(event.price_pence)}. ` : ''}“To pay at the door” shows on the check-in screen, and the iPad sends those guests to Julie. Import different payments as separate lists.</p></div>
${Number(event.legacy_places) > 0 ? html`<div class="field"><label class="check"><input type="checkbox" name="legacy" value="1"${values.fromLegacy ? ' checked' : ''}> These are places already allocated before the website (${event.legacy_places} recorded), not new places</label>
<p class="hint">Ticked: the places move from “allocated before the website” onto the guest list, so they are never counted twice.</p></div>` : ''}
<div class="field"><label for="pi-note">Private note on each booking (optional)</label><input id="pi-note" name="note" type="text" maxlength="300" value="${values.note || ''}" placeholder="e.g. From the booking sheet at reception"></div>`;
}

export function importPage({ event, left, csrf, values = {}, problems = [] }) {
  return adminPage({
    title: 'Import a paper list', csrf, signedIn: true,
    body: html`${backTo(event)}
<p class="hint"><strong>${event.name}</strong>. Bookings taken on paper, by phone or in person: type or paste them here, so the guests are on the guest list, count towards the places, and can check themselves in on the iPad by name. Nothing is emailed and nobody is charged.${left === null ? '' : ` ${left} ${left === 1 ? 'place' : 'places'} left.`}</p>
${problems.length ? html`<div class="banner banner-error" role="alert">${problems.map((p) => html`<p>${p}</p>`)}</div>` : ''}
<form method="post" action="/admin/events/${event.id}/bookings/import" class="panel admin-form" novalidate>${hidden(csrf)}
<div class="field"><label for="pi-list">One booking on each line; separate the guests on a booking with commas</label>
<textarea id="pi-list" name="list" rows="12" autocapitalize="words" spellcheck="false" placeholder="Mary Smith, John Smith&#10;Anne-Marie O’Neill&#10;Sandra Brown, Lynn Brown, Tom Brown">${values.list || ''}</textarea>
<p class="hint">Use each guest’s full name (first name and surname), as they will type it on the iPad.</p></div>
${options(event, values)}
<input type="hidden" name="step" value="preview">
<p class="form-actions"><button class="btn-gold" type="submit">Check the list</button></p>
</form>`
  });
}

export function previewPage({ event, bookings, guests, values, warnings, needsTick = false, untick = false, csrf }) {
  const warn = (list, text) => (list.length ? html`<p class="banner" role="note">${text} ${list.join(', ')}</p>` : '');
  return adminPage({
    title: 'Import a paper list', csrf, signedIn: true,
    body: html`${backTo(event)}
<p class="big-state is-done" role="status">${bookings.length} ${bookings.length === 1 ? 'booking' : 'bookings'}, ${guests} ${guests === 1 ? 'guest' : 'guests'}: nothing is added until you tap Import</p>
${untick ? html`<p class="banner banner-error" role="alert">Nothing was added. Please tick the box to confirm the possible duplicates, or change the list.</p>` : ''}
${warn(warnings.onList, 'Already on this event’s guest list (check these aren’t the same people):')}
${warn(warnings.twice, 'Appear more than once on this list:')}
${warn(warnings.noSurname, 'No surname, so they can’t check in by name on the iPad (Julie can still check them in):')}
<section class="panel"><h2>${payLabel(values.pay)}${values.fromLegacy ? ' · from places allocated before the website' : ''}</h2>
<ol class="todo">${bookings.map((b) => html`<li>${b.names.join(', ')}${b.names.length > 1 ? html` <span class="hint">(${b.names.length} guests, one booking)</span>` : ''}</li>`)}</ol>
</section>
<form method="post" action="/admin/events/${event.id}/bookings/import" class="admin-form">${hidden(csrf)}
<textarea name="list" hidden>${values.list}</textarea><input type="hidden" name="pay" value="${values.pay}">${values.fromLegacy ? html`<input type="hidden" name="legacy" value="1">` : ''}
<input type="hidden" name="note" value="${values.note}"><input type="hidden" name="step" value="import">
${needsTick ? html`<p class="field"><label class="check"><input type="checkbox" name="dups" value="yes" required> I have checked the possible duplicates above: add them anyway (or tap Change the list to remove them)</label></p>` : ''}
<button class="btn-gold" type="submit">Import ${guests} ${guests === 1 ? 'guest' : 'guests'}</button>
</form>
<form method="post" action="/admin/events/${event.id}/bookings/import" class="spaced">${hidden(csrf)}
<textarea name="list" hidden>${values.list}</textarea><input type="hidden" name="pay" value="${values.pay}">${values.fromLegacy ? html`<input type="hidden" name="legacy" value="1">` : ''}
<input type="hidden" name="note" value="${values.note}"><input type="hidden" name="step" value="edit">
<button class="pill" type="submit">Change the list</button>
</form>`
  });
}
