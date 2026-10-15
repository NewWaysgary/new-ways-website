// Admin screens for Private Readings: prices, booking rules and availability.
import { html, raw } from '../lib/html.js';
import { adminPage, sectionField } from './admin.js';
import { longDate, ukToday } from '../lib/dates.js';
import { BOOKING_SETTINGS } from '../bookings/config.js';
import { friendlyTime, fromMin } from '../bookings/availability.js';

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
<p><a class="btn-gold btn-link" href="/admin/readings/availability">Availability: open or close dates</a></p>
<p><a class="btn-gold btn-link" href="/admin/readings/vouchers">Gift Vouchers / Reservation Codes</a></p>
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
  day: 'Saved for this date.', break: 'Break saved. It applies to new bookings.'
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const range = (r) => `${friendlyTime(r.start_time)} to ${friendlyTime(r.end_time)}`;
const windowsText = (windows) => windows.map(([s, e]) => `${friendlyTime(fromMin(s))} to ${friendlyTime(fromMin(e))}`).join(', ');
const q = (o) => '?' + new URLSearchParams(o).toString();

// A clear warning listing the appointments a change would leave outside the hours, with a tick to save anyway
function affectedWarning(list) {
  return list && list.length ? html`<div class="banner banner-error" role="alert"><p><strong>This change affects ${list.length === 1 ? 'an existing appointment' : list.length + ' existing appointments'}:</strong></p>
<ul>${list.map((a) => html`<li>${a}</li>`)}</ul>
<p>Saving will NOT cancel or change ${list.length === 1 ? 'it' : 'them'}: ${list.length === 1 ? 'it stays' : 'they stay'} booked. Contact the customer yourself if the time needs to change.</p></div>
<label class="field-check"><input type="checkbox" name="confirm" value="1"> I understand. Save the change and keep ${list.length === 1 ? 'this appointment' : 'these appointments'} as booked.</label>` : '';
}

// What happened on a date, kept apart so nothing unpaid ever looks like an appointment
const KINDS = [
  ['confirmed', 'Confirmed appointments', 'Paid with Square and confirmed.', 'chip-live', 'PAID'],
  ['attention', 'Paid, needs your attention', 'Paid, but the booking couldn’t be confirmed automatically (see Bookings).', 'chip-attention', 'NEEDS ATTENTION'],
  ['hold', 'Payment holds', 'At Square’s payment page now. The time is held for 15 minutes, then released if they don’t pay.', 'chip-soon', 'PAYMENT HOLD'],
  ['unpaid', 'Unpaid orders', 'Went to Square’s payment page but didn’t pay. Not booked; the time is free.', 'chip-past', 'NOT PAID'],
  ['incomplete', 'Incomplete bookings', 'Gave their details but never went to payment. Not booked; deleted 24 hours after they were given.', 'chip-past', 'INCOMPLETE']
];

export function availabilityManager({ weeks, breakMin, month, months, days, day, today, noticeHours, csrf, flash, errors = {}, dayValues, dayWarning }) {
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;     // weeks start on Monday
  const link = (o, hash = '') => `/admin/readings/availability${q(o)}${hash}`;
  const dv = dayValues || {};
  const isOpen = day && day.windows.length > 0;
  const choice = dv.choice || (isOpen ? 'available' : 'closed');
  const dayStart = dv.start_time || (day && day.hoursRow ? day.hoursRow.start_time : '15:00');
  const dayEnd = dv.end_time || (day && day.hoursRow ? day.hoursRow.end_time : '18:00');
  const cellLabel = (d) => `${longDate(d.date, today)}: ${d.open ? (d.later ? 'available, not bookable yet' : 'available') : 'closed'}` +
    `${d.confirmed ? `, ${d.confirmed} confirmed ${d.confirmed === 1 ? 'appointment' : 'appointments'}` : ''}${d.other ? ', other booking activity (not confirmed)' : ''}`;

  return adminPage({
    title: 'Availability',
    csrf,
    signedIn: true,
    body: html`<p><a class="link" href="/admin/readings">Back to Private Readings</a></p>
<p class="hint">Every date is closed unless you make it available. Customers can book up to ${weeks} weeks ahead (${weeks * 7} days), rolling forward each day; you can set dates further ahead now and they open to customers when they come within ${weeks} weeks. All times are UK time. After every reading there is a ${breakMin}-minute break before the next one can start (none is needed after the last reading of the day).</p>
${banner(AVAIL_FLASH[flash])}
${errors.date ? banner('Not saved. ' + errors.date, 'error') : ''}

<section class="panel" aria-labelledby="a-cal" id="calendar">
<div class="av-head">
${months.prev ? html`<a class="pill" href="${link({ month: months.prev }, '#calendar')}"><span aria-hidden="true">‹</span><span class="sr-only">Previous month</span></a>` : html`<span class="pill av-nav-off" aria-hidden="true">‹</span>`}
<h2 id="a-cal">${MONTHS[m - 1]} ${y}</h2>
${months.next ? html`<a class="pill" href="${link({ month: months.next }, '#calendar')}"><span aria-hidden="true">›</span><span class="sr-only">Next month</span></a>` : html`<span class="pill av-nav-off" aria-hidden="true">›</span>`}
</div>
<p class="hint">Tap a date to make it available or closed, and to see its bookings.</p>
<ol class="av-cal" role="list">
${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<li class="av-dow" aria-hidden="true">${d}</li>`)}
${Array.from({ length: lead }, () => html`<li class="av-empty" aria-hidden="true"></li>`)}
${days.map((d) => html`<li><a class="av-day${d.open ? ' is-open' : ' is-closed'}${d.open && d.later ? ' is-later' : ''}${d.past ? ' is-past' : ''}${day && day.date === d.date ? ' is-selected' : ''}" href="${link({ month, date: d.date }, '#day')}"${day && day.date === d.date ? raw(' aria-current="date"') : ''}
 aria-label="${cellLabel(d)}"><span class="av-num">${Number(d.date.slice(8))}</span>${d.confirmed ? html`<span class="av-count" aria-hidden="true">${d.confirmed}</span>` : ''}${d.other ? html`<span class="av-other" aria-hidden="true"></span>` : ''}</a></li>`)}
</ol>
<p class="av-key small"><span class="av-key-item"><span class="av-swatch is-open" aria-hidden="true"></span>Available</span> <span class="av-key-item"><span class="av-swatch is-later" aria-hidden="true"></span>Available, not bookable yet</span> <span class="av-key-item"><span class="av-swatch is-closed" aria-hidden="true"></span>Closed</span> <span class="av-key-item"><span class="av-count" aria-hidden="true">1</span>Confirmed appointments</span> <span class="av-key-item"><span class="av-other av-other-key" aria-hidden="true"></span>Not confirmed (holds, unpaid, incomplete)</span></p>
</section>

${day ? html`<section class="panel" aria-labelledby="a-day" id="day">
<h2 id="a-day">${longDate(day.date, today)}</h2>
<p><strong>${isOpen ? 'Available ' + windowsText(day.windows) : 'Closed'}</strong></p>
${isOpen && day.later ? html`<p class="hint">Not bookable yet: opens to customers on ${longDate(day.opensOn, today)} (${weeks} weeks before).</p>` : ''}
${KINDS.map(([kind, title, help, chip, label]) => { const list = day.acts.filter((a) => a.kind === kind); return kind === 'confirmed' || list.length ? html`<h3>${title}</h3>
${list.length ? html`<p class="hint">${help}</p><ul class="rows">${list.map((a) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${friendlyTime(a.local_start)} · ${a.service_name}</span>
<span class="row-line">${a.customer_name} · ${a.minutes} minutes${a.reference ? ` · ${a.reference}` : ''}</span>
<span class="chips"><span class="chip ${chip}">${label}</span></span></div></li>`)}</ul>` : html`<p>No confirmed appointments on this date.</p>`}` : ''; })}
${day.past ? '' : html`${isOpen && !day.later ? html`<h3>Times customers can book now</h3>
${Object.values(day.starts).map((s) => html`<p>${s.name}: ${s.times.length ? s.times.map(friendlyTime).join(', ') : 'none'}</p>`)}
<p class="hint">After the ${breakMin}-minute break after each reading, existing appointments and payment holds, and online booking closing ${noticeHours} hours before each reading.</p>` : ''}

<form method="post" action="/admin/readings/availability/day" class="admin-form">
${hidden(csrf)}
<input type="hidden" name="date" value="${day.date}">
<div class="field"><label for="d-choice">Private readings on this date</label>
<select id="d-choice" name="choice"><option value="available"${choice === 'available' ? raw(' selected') : ''}>Available</option><option value="closed"${choice === 'closed' ? raw(' selected') : ''}>Closed</option></select>
${errors.choice ? html`<p class="error">${errors.choice}</p>` : ''}${errors.date ? html`<p class="error">${errors.date}</p>` : ''}</div>
<p class="hint">If Available: your starting and finishing times. The last reading must finish by the finishing time.</p>
<div class="time-pair">${timeSelect('d-start', 'start_time', dayStart, 'Starting time')}${timeSelect('d-end', 'end_time', dayEnd, 'Finishing time')}</div>
${errors.times ? html`<p class="error">${errors.times}</p>` : ''}
<div class="field"><label for="d-note">Note for yourself (optional)</label><input id="d-note" name="note" type="text" maxlength="120" autocomplete="off" value="${dv.note || (day.hoursRow && day.hoursRow.note) || ''}"></div>
${affectedWarning(dayWarning)}
<button class="btn-gold" type="submit">Save this date</button>
</form>`}
</section>` : ''}

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
