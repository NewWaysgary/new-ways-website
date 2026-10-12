// Admin screens for Private Readings: prices, booking rules and availability.
import { html, raw } from '../lib/html.js';
import { adminPage, sectionField } from './admin.js';
import { longDate, ukToday } from '../lib/dates.js';
import { BOOKING_SETTINGS } from '../bookings/config.js';
import { WEEKDAYS, friendlyTime, fromMin, toMin } from '../bookings/availability.js';

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
<p><a class="btn-gold btn-link" href="/admin/readings/availability">Availability Manager: days, hours and breaks</a></p>
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
${BOOKING_SETTINGS.map((f) => sectionField({ key: f.key, label: f.label, type: f.options ? 'select' : f.text ? 'textarea' : 'text', options: f.options, rows: 7, help: f.help }, rules[f.key] ?? f.default, ruleErrors[f.key]))}
<p class="form-actions"><button class="btn-gold" type="submit">Save booking rules</button></p>
</fieldset>
</form>`
  });
}

const AVAIL_FLASH = {
  week: 'Regular weekly hours saved. The public booking calendar now uses them.', break: 'Break saved. It applies to new bookings.',
  day: 'Saved for this date. The public booking calendar now uses it.', 'block-added': 'Time blocked.', 'block-removed': 'Block removed.',
  'weekly-removed': 'Weekly hours removed.', 'date-removed': 'Change for that date removed.'
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const range = (r) => `${friendlyTime(r.start_time)} to ${friendlyTime(r.end_time)}`;
const windowsText = (windows) => windows.map(([s, e]) => `${friendlyTime(fromMin(s))} to ${friendlyTime(fromMin(e))}`).join(', ');
const q = (o) => '?' + new URLSearchParams(o).toString();

function removeButton(action, csrf, label = 'Remove') {
  return html`<form method="post" action="${action}">${hidden(csrf)}<button type="submit" class="pill pill-danger" data-confirm="Remove this?">${label}</button></form>`;
}

// A clear warning listing the appointments a change would leave outside the hours, with a tick to save anyway
function affectedWarning(list) {
  return list && list.length ? html`<div class="banner banner-error" role="alert"><p><strong>This change affects ${list.length === 1 ? 'an existing appointment' : list.length + ' existing appointments'}:</strong></p>
<ul>${list.map((a) => html`<li>${a}</li>`)}</ul>
<p>Saving will NOT cancel or change ${list.length === 1 ? 'it' : 'them'}: ${list.length === 1 ? 'it stays' : 'they stay'} booked. Contact the customer yourself if the time needs to change.</p></div>
<label class="field-check"><input type="checkbox" name="confirm" value="1"> I understand. Save the change and keep ${list.length === 1 ? 'this appointment' : 'these appointments'} as booked.</label>` : '';
}

export function availabilityManager({ weekly, weeks, breakMin, month, months, days, day, today, noticeHours, csrf, flash, errors = {}, weekValues, weekWarning, dayValues, dayWarning, blockValues, blockWarning }) {
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;     // weeks start on Monday
  const link = (o, hash = '') => `/admin/readings/availability${q(o)}${hash}`;
  // Regular weekly hours (first range for each day)
  const week = Array.from({ length: 7 }, (_, d) => {
    const r = weekly.filter((w) => Number(w.weekday) === d && Number(w.active));
    const wv = weekValues;
    return { d, on: wv ? wv['on_' + d] === '1' : r.length > 0, start: wv ? wv['start_' + d] : (r[0] ? r[0].start_time : '15:00'), end: wv ? wv['end_' + d] : (r[0] ? r[r.length - 1].end_time : '18:00'), several: r.length > 1 };
  });
  const order = [1, 2, 3, 4, 5, 6, 0];
  const dv = dayValues || {};
  const dayChoice = dv.choice || (day ? (day.dateRows.some((r) => r.mode === 'closed') ? 'closed' : day.dateRows.some((r) => r.mode === 'hours') ? 'open' : 'normal') : 'normal');
  const hoursRow = day ? day.dateRows.find((r) => r.mode === 'hours') : null;
  const regular = day ? weekly.filter((w) => Number(w.active) && Number(w.weekday) === new Date(day.date + 'T12:00:00Z').getUTCDay()) : [];
  const dayStart = dv.start_time || (hoursRow ? hoursRow.start_time : regular[0] ? regular[0].start_time : '15:00');
  const dayEnd = dv.end_time || (hoursRow ? hoursRow.end_time : regular[0] ? regular[regular.length - 1].end_time : '18:00');
  const bv = blockValues || {};

  return adminPage({
    title: 'Availability',
    csrf,
    signedIn: true,
    body: html`<p><a class="link" href="/admin/readings">Back to Private Readings</a></p>
<p class="hint">All times are UK time. Readings start on the hour or half hour and must finish by your finishing time. After every reading you have a break of ${breakMin} minutes before the next one can start (no break is needed after the last reading of the day). Changing your hours never cancels or changes a booking that has already been made.</p>
${banner(AVAIL_FLASH[flash])}
${errors.legacy ? banner('Not saved yet. Please check the details.', 'error') : ''}

<section class="panel" aria-labelledby="a-cal" id="calendar">
<div class="av-head">
${months.prev ? html`<a class="pill" href="${link({ month: months.prev }, '#calendar')}"><span aria-hidden="true">‹</span><span class="sr-only">Previous month</span></a>` : html`<span class="pill av-nav-off" aria-hidden="true">‹</span>`}
<h2 id="a-cal">${MONTHS[m - 1]} ${y}</h2>
<a class="pill" href="${link({ month: months.next }, '#calendar')}"><span aria-hidden="true">›</span><span class="sr-only">Next month</span></a>
</div>
<p class="hint">Tap a date to open or close it, change its hours, block time or see its appointments.</p>
<ol class="av-cal" role="list">
${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<li class="av-dow" aria-hidden="true">${d}</li>`)}
${Array.from({ length: lead }, () => html`<li class="av-empty" aria-hidden="true"></li>`)}
${days.map((d) => html`<li><a class="av-day${d.open ? ' is-open' : ' is-closed'}${d.changed ? ' is-changed' : ''}${d.past ? ' is-past' : ''}${day && day.date === d.date ? ' is-selected' : ''}" href="${link({ month, date: d.date }, '#day')}"${day && day.date === d.date ? raw(' aria-current="date"') : ''}
 aria-label="${longDate(d.date, today)}: ${d.open ? 'open' : 'closed'}${d.changed ? ', changed for this date' : ''}${d.appts ? `, ${d.appts} ${d.appts === 1 ? 'appointment' : 'appointments'}` : ''}"><span class="av-num">${Number(d.date.slice(8))}</span>${d.appts ? html`<span class="av-count" aria-hidden="true">${d.appts}</span>` : ''}</a></li>`)}
</ol>
<p class="av-key small"><span class="av-key-item"><span class="av-swatch is-open" aria-hidden="true"></span>Open</span> <span class="av-key-item"><span class="av-swatch is-closed" aria-hidden="true"></span>Closed</span> <span class="av-key-item"><span class="av-swatch is-changed" aria-hidden="true"></span>Changed for that date</span> <span class="av-key-item"><span class="av-count" aria-hidden="true">2</span>Appointments</span></p>
</section>

${day ? html`<section class="panel" aria-labelledby="a-day" id="day">
<h2 id="a-day">${longDate(day.date, today)}</h2>
<p><strong>${day.closed ? 'Closed' : day.windows.length ? 'Open ' + windowsText(day.windows) : 'Closed (no hours)'}</strong>${day.changed ? ' · changed for this date' : ' · regular weekly hours'}</p>
<h3>Appointments</h3>
${day.appts.length ? html`<ul class="rows">${day.appts.map((a) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${friendlyTime(a.local_start)} · ${a.service_name}</span>
<span class="row-line">${a.customer_name} · ${a.minutes} minutes · ${a.reference}</span>
<span class="chips"><span class="chip ${a.status === 'held' ? 'chip-soon' : a.status === 'needs_attention' ? 'chip-attention' : 'chip-live'}">${a.status === 'held' ? 'PAYMENT HOLD' : a.status === 'needs_attention' ? 'NEEDS ATTENTION' : 'PAID'}</span></span></div></li>`)}</ul>`
      : html`<p>No appointments on this date.</p>`}
${day.past ? '' : html`<h3>Times customers can book now</h3>
${Object.values(day.starts).map((s) => html`<p>${s.name}: ${s.times.length ? s.times.map(friendlyTime).join(', ') : 'none'}</p>`)}
<p class="hint">After your ${breakMin}-minute break, existing appointments and holds, and online booking closing ${noticeHours} hours before each reading.</p>

<form method="post" action="/admin/readings/availability/day" class="admin-form">
${hidden(csrf)}
<input type="hidden" name="date" value="${day.date}">
<fieldset class="field"><legend>Readings on this date</legend>
<label class="field-check"><input type="radio" name="choice" value="normal"${dayChoice === 'normal' ? raw(' checked') : ''}> Regular weekly hours${regular.length ? ` (${regular.map(range).join(', ')})` : ' (closed on this day of the week)'}</label>
<label class="field-check"><input type="radio" name="choice" value="open"${dayChoice === 'open' ? raw(' checked') : ''}> Open, with these hours:</label>
<div class="time-pair">${timeSelect('d-start', 'start_time', dayStart, 'From')}${timeSelect('d-end', 'end_time', dayEnd, 'Until')}</div>
${errors.times ? html`<p class="error">${errors.times}</p>` : ''}
<label class="field-check"><input type="radio" name="choice" value="closed"${dayChoice === 'closed' ? raw(' checked') : ''}> Closed (holiday, work or a day off)</label>
${errors.choice ? html`<p class="error">${errors.choice}</p>` : ''}${errors.date ? html`<p class="error">${errors.date}</p>` : ''}
</fieldset>
<div class="field"><label for="d-note">Note for yourself (optional)</label><input id="d-note" name="note" type="text" maxlength="120" autocomplete="off" value="${dv.note || (day.dateRows[0] && day.dateRows[0].note) || ''}"></div>
${affectedWarning(dayWarning)}
<button class="btn-gold" type="submit">Save this date</button>
</form>

<h3>Blocked time on this date</h3>
${day.blocks.length ? html`<ul class="rows">${day.blocks.map((b) => html`<li class="row-card"><div class="row-text"><span class="row-title">Blocked ${range(b)}</span>${b.note ? html`<span class="row-line">${b.note}</span>` : ''}</div>
<div class="row-actions">${removeButton(`/admin/readings/availability/blocks/${b.id}/delete`, csrf)}</div></li>`)}</ul>` : html`<p class="hint">No time blocked. Block part of the day without changing the rest of it.</p>`}
<form method="post" action="/admin/readings/availability/blocks" class="admin-form">
${hidden(csrf)}
<input type="hidden" name="date" value="${day.date}">
<div class="time-pair">${timeSelect('b-start', 'start_time', bv.start_time || dayStart, 'Block from')}${timeSelect('b-end', 'end_time', bv.end_time || fromMin(Math.min(toMin(dayStart) + 30, 1410)), 'Until')}</div>
${errors.block && errors.times ? html`<p class="error">${errors.times}</p>` : ''}
${affectedWarning(blockWarning)}
<button class="pill pill-gold" type="submit">Block this time</button>
</form>`}
</section>` : ''}

<form method="post" action="/admin/readings/availability/week" class="admin-form" id="week">
${hidden(csrf)}
<fieldset class="panel">
<legend>Regular weekly hours</legend>
<p class="hint">Tick the days you normally offer readings and set the hours. Any date can still be opened, closed or changed on its own in the calendar above.</p>
${order.map((d) => { const w = week[d]; return html`<div class="av-week-row">
<label class="field-check av-week-day"><input type="checkbox" name="on_${d}" value="1"${w.on ? raw(' checked') : ''}> ${WEEKDAYS[d]}</label>
<div class="time-pair">${timeSelect('w-start-' + d, 'start_' + d, w.start, 'From')}${timeSelect('w-end-' + d, 'end_' + d, w.end, 'Until')}</div>
${w.several ? html`<p class="hint">This day has more than one set of hours; saving keeps ${range({ start_time: w.start, end_time: w.end })}.</p>` : ''}
${errors['day_' + d] ? html`<p class="error">${errors['day_' + d]}</p>` : ''}</div>`; })}
${affectedWarning(weekWarning)}
<p class="form-actions"><button class="btn-gold" type="submit">Save regular hours</button></p>
</fieldset>
</form>

<form method="post" action="/admin/readings/availability/break" class="admin-form" id="break">
${hidden(csrf)}
<fieldset class="panel">
<legend>Break after each reading</legend>
<div class="field"><label for="a-break">Break after every reading (whatever its length)</label>
<select id="a-break" name="break_minutes">${[0, 30, 60, 90].map((n) => html`<option value="${n}"${n === breakMin ? raw(' selected') : ''}>${n ? n + ' minutes' : 'No break'}</option>`)}</select></div>
${errors.break ? html`<p class="error">${errors.break}</p>` : ''}
<p class="hint">For example, with 30 minutes: a 30-minute reading at 3pm means the next can start at 4pm; a 60-minute reading at 3pm means the next can start at 4:30pm.</p>
<p class="form-actions"><button class="btn-gold" type="submit">Save break</button></p>
</fieldset>
</form>`
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
