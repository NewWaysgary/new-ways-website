// Admin screens for Private Readings: prices, booking rules and availability.
import { html, raw } from '../lib/html.js';
import { adminPage, sectionField } from './admin.js';
import { longDate, ukToday } from '../lib/dates.js';
import { BOOKING_SETTINGS } from '../bookings/config.js';
import { WEEKDAYS, friendlyTime, fromMin } from '../bookings/availability.js';

export const pounds = (pence) => {
  const p = Number(pence) || 0;
  return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
};

// Every half hour of the day, for the time pickers
const TIMES = Array.from({ length: 48 }, (_, i) => fromMin(i * 30));

function timeSelect(id, name, value, label) {
  return html`<div class="field time-field"><label for="${id}">${label}</label>
<select id="${id}" name="${name}">${TIMES.map((t) => html`<option value="${t}"${t === value ? raw(' selected') : ''}>${friendlyTime(t)}</option>`)}</select></div>`;
}

const banner = (text, kind = 'ok') => text ? html`<p class="banner banner-${kind}" role="${kind === 'ok' ? 'status' : 'alert'}">${text}</p>` : '';
const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const errorsBanner = (errors) => {
  const n = Object.keys(errors || {}).length;
  return n ? banner(`Not saved yet. Please check the ${n === 1 ? 'highlighted detail' : n + ' highlighted details'}.`, 'error') : '';
};

const READINGS_FLASH = {
  prices: 'Prices saved. New bookings use the new prices. Bookings already made keep the price that was paid.',
  rules: 'Booking rules saved.'
};

export function readingsPage({ services, settings, priceValues = {}, priceErrors = {}, ruleValues, ruleErrors = {}, csrf, flash, top = '' }) {
  const rules = ruleValues || settings;
  return adminPage({
    title: 'Private Readings',
    csrf,
    signedIn: true,
    body: html`<p class="hint">Set the prices, the times you are available and the booking rules for private readings by WhatsApp video call.</p>
${banner(READINGS_FLASH[flash])}
${top}
<p><a class="btn-gold btn-link" href="/admin/readings/availability">Availability and calendar</a></p>
<form method="post" action="/admin/readings/prices" class="admin-form" data-unsaved-warning>
${hidden(csrf)}
<fieldset class="panel" id="prices">
<legend>Prices</legend>
${errorsBanner(priceErrors)}
<p class="hint">A new price applies to new bookings only. Anyone who has already booked keeps the price they paid.</p>
${services.map((s) => sectionField({ key: 'price_' + s.code, label: `${s.name} (£)`, type: 'money' },
      priceValues['price_' + s.code] ?? pounds(s.price_pence), priceErrors['price_' + s.code]))}
<p class="form-actions"><button class="btn-gold" type="submit">Save prices</button></p>
</fieldset>
</form>
<form method="post" action="/admin/readings/rules" class="admin-form" data-unsaved-warning>
${hidden(csrf)}
<fieldset class="panel" id="rules">
<legend>Booking rules</legend>
${errorsBanner(ruleErrors)}
${BOOKING_SETTINGS.map((f) => sectionField({ key: f.key, label: f.label, type: f.text ? 'textarea' : 'text', rows: 7, help: f.help }, rules[f.key] ?? f.default, ruleErrors[f.key]))}
<p class="form-actions"><button class="btn-gold" type="submit">Save booking rules</button></p>
</fieldset>
</form>`
  });
}

const AVAIL_FLASH = {
  'weekly-added': 'Weekly hours added.', 'weekly-removed': 'Weekly hours removed.',
  'date-added': 'Change for that date saved.', 'date-removed': 'Change for that date removed.',
  'block-added': 'Time blocked.', 'block-removed': 'Block removed.'
};

const MODE_TEXT = { closed: 'Closed all day', hours: 'Different hours', extra: 'Extra hours' };

function removeButton(action, csrf, label = 'Remove') {
  return html`<form method="post" action="${action}">${hidden(csrf)}<button type="submit" class="pill pill-danger" data-confirm="Remove this?">${label}</button></form>`;
}

const range = (r) => `${friendlyTime(r.start_time)} to ${friendlyTime(r.end_time)}`;
const windowsText = (windows) => windows.map(([s, e]) => `${friendlyTime(fromMin(s))} to ${friendlyTime(fromMin(e))}`).join(', ');

export function availabilityPage({ weekly, dates, blocks, overview, weeks, csrf, flash, errors = {}, values = {}, today = ukToday() }) {
  const v = (form, key, fallback) => (values.form === form && values[key] !== undefined ? values[key] : fallback);
  const err = (form) => (values.form === form ? errors : {});
  const fieldErr = (form, key) => err(form)[key] ? html`<p class="error">${err(form)[key]}</p>` : '';
  const dateField = (form, id) => html`<div class="field${err(form).date ? ' has-error' : ''}"><label for="${id}">Date</label>
<input id="${id}" name="date" type="date" min="${today}" value="${v(form, 'date', '')}">${fieldErr(form, 'date')}</div>`;
  const timePair = (form, prefix, start = '12:00', end = '17:00') => html`<div class="time-pair">
${timeSelect(prefix + '-start', 'start_time', v(form, 'start_time', start), 'From')}
${timeSelect(prefix + '-end', 'end_time', v(form, 'end_time', end), 'Until')}
</div>${fieldErr(form, 'times')}`;
  const note = (form, id) => html`<div class="field"><label for="${id}">Note for yourself (optional)</label>
<input id="${id}" name="note" type="text" maxlength="120" autocomplete="off" value="${v(form, 'note', '')}"></div>`;

  return adminPage({
    title: 'Availability',
    csrf,
    signedIn: true,
    body: html`<p><a class="link" href="/admin/readings">Back to Private Readings</a></p>
<p class="hint">All times are UK time. Readings can start on the hour or half hour, and must finish by the closing time. Changing your hours never cancels a booking that has already been made.</p>
${banner(AVAIL_FLASH[flash])}
${Object.keys(errors).length ? banner('Not saved yet. Please check the highlighted details.', 'error') : ''}

<section class="panel" aria-labelledby="a-weekly" id="weekly">
<h2 id="a-weekly">Normal weekly hours</h2>
${weekly.length ? html`<ul class="rows">${weekly.map((w) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${WEEKDAYS[w.weekday]}s</span><span class="row-line">${range(w)}</span></div>
<div class="row-actions">${removeButton(`/admin/readings/availability/weekly/${w.id}/delete`, csrf)}</div></li>`)}</ul>`
      : html`<p>No weekly hours set, so readings can only be booked on dates you open below.</p>`}
<form method="post" action="/admin/readings/availability/weekly" class="admin-form">
${hidden(csrf)}
<h3>Add weekly hours</h3>
<div class="field"><label for="w-day">Day</label>
<select id="w-day" name="weekday">${WEEKDAYS.map((d, i) => html`<option value="${i}"${String(i) === String(v('weekly', 'weekday', '0')) ? raw(' selected') : ''}>${d}</option>`)}</select></div>
${timePair('weekly', 'w')}
<button class="pill pill-gold" type="submit">Add these hours</button>
</form>
</section>

<section class="panel" aria-labelledby="a-dates" id="dates">
<h2 id="a-dates">Changes for a single date</h2>
<p class="hint">Close a day (for example a holiday), set different hours for one date, or open extra time on any day of the week.</p>
${dates.length ? html`<ul class="rows">${dates.map((d) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${longDate(d.date, today)}</span>
<span class="row-line">${MODE_TEXT[d.mode]}${d.mode === 'closed' ? '' : ': ' + range(d)}</span>
${d.note ? html`<span class="row-line">${d.note}</span>` : ''}</div>
<div class="row-actions">${removeButton(`/admin/readings/availability/dates/${d.id}/delete`, csrf)}</div></li>`)}</ul>` : ''}
<form method="post" action="/admin/readings/availability/dates" class="admin-form">
${hidden(csrf)}
<h3>Add a change</h3>
${dateField('dates', 'd-date')}
<fieldset class="field"><legend>What happens on that date</legend>
${['closed', 'hours', 'extra'].map((m) => html`<label class="field-check"><input type="radio" name="mode" value="${m}"${m === v('dates', 'mode', 'closed') ? raw(' checked') : ''}> ${{ closed: 'Closed all day (no readings)', hours: 'Different hours (replace the normal hours)', extra: 'Extra hours (as well as the normal hours)' }[m]}</label>`)}
${fieldErr('dates', 'mode')}</fieldset>
<p class="hint">The times below are only used for different or extra hours.</p>
${timePair('dates', 'd')}
${note('dates', 'd-note')}
<button class="pill pill-gold" type="submit">Save this change</button>
</form>
</section>

<section class="panel" aria-labelledby="a-blocks" id="blocks">
<h2 id="a-blocks">Block some time</h2>
<p class="hint">Block part of a day, or a single appointment time, without changing the rest of the day.</p>
${blocks.length ? html`<ul class="rows">${blocks.map((b) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${longDate(b.date, today)}</span><span class="row-line">Blocked ${range(b)}</span>
${b.note ? html`<span class="row-line">${b.note}</span>` : ''}</div>
<div class="row-actions">${removeButton(`/admin/readings/availability/blocks/${b.id}/delete`, csrf)}</div></li>`)}</ul>` : ''}
<form method="post" action="/admin/readings/availability/blocks" class="admin-form">
${hidden(csrf)}
<h3>Add a block</h3>
${dateField('blocks', 'b-date')}
${timePair('blocks', 'b', '12:00', '12:30')}
${note('blocks', 'b-note')}
<button class="pill pill-gold" type="submit">Block this time</button>
</form>
</section>

<section class="panel" aria-labelledby="a-cal" id="calendar">
<h2 id="a-cal">The next ${weeks} weeks</h2>
<p class="hint">What customers will be able to choose from, before any bookings are taken. Online booking also stops a set time before each reading (see Booking rules).</p>
${overview.length ? html`<ul class="rows day-list">${overview.map((d) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${longDate(d.date, today)}</span>
${d.closed ? html`<span class="row-line">Closed</span>` : d.windows.length ? html`<span class="row-line">${windowsText(d.windows)}</span>
<span class="row-line">${d.starts30.length} × 30-minute times${d.starts30.length ? `, last starts ${friendlyTime(d.starts30[d.starts30.length - 1])}` : ''}</span>
<span class="row-line">${d.starts60.length} × 60-minute times${d.starts60.length ? `, last starts ${friendlyTime(d.starts60[d.starts60.length - 1])}` : ''}</span>` : html`<span class="row-line">No times left after the blocks</span>`}
${d.changed ? html`<span class="chips"><span class="chip chip-soon">${d.closed ? 'CLOSED THIS DATE' : 'CHANGED THIS DATE'}</span></span>` : ''}
</div></li>`)}</ul>` : html`<p>No reading times in the next ${weeks} weeks.</p>`}
</section>`
  });
}

// The ON/OFF panel shown at the top of the Visitor experiences screen
export function reviewsSwitch({ open, csrf }) {
  return html`<section class="panel live-switch${open ? ' is-live' : ''}" aria-labelledby="share-state">
<h2 id="share-state">${open ? 'Sharing experiences is open' : 'Sharing experiences is closed'}</h2>
<p class="hint">${open ? 'Visitors can send their experiences from the website. Nothing is shown until you approve it.' : 'Visitors can still read approved experiences, but the website does not accept new ones.'}</p>
<form method="post" action="/admin/reviews/${open ? 'close' : 'open'}">${hidden(csrf)}
<button class="${open ? 'btn-danger' : 'btn-gold'}" type="submit">${open ? 'Close sharing' : 'Open sharing'}</button></form>
</section>`;
}
