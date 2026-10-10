// The table planner (phone-first) and its printable version (one round table per page, then the catering totals).
import { html, raw, esc } from '../lib/html.js';
import { adminPage } from './admin.js';
import { longDate } from '../lib/dates.js';
import { friendlyTime } from '../bookings/availability.js';
import { ASSET_VERSION } from '../lib/http.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const eventLine = (e) => `${longDate(e.date, '0000')}${e.start_time ? ', ' + friendlyTime(e.start_time) : e.time_text ? ', ' + e.time_text : ''}`;

const FLASH = {
  'set-up': ['ok', 'Tables set up.'], saved: ['ok', 'Table saved.'], removed: ['ok', 'Table removed.'], nothing: ['ok', 'Nothing needed changing.'],
  seated: ['ok', 'Seated: {d}.'], 'seated-split': ['warn', 'Seated: {d}. This booking is now split across tables (see the warning below).'],
  moved: ['ok', 'Moved {d}.'], unseated: ['ok', 'Taken off the table. They are back in the drop-downs.'],
  'mediums-added': ['ok', 'Mediums’ table added. Add each medium and their food choices on it.'], 'medium-added': ['ok', 'Medium added.'], 'medium-removed': ['ok', 'Medium removed.'],
  'too-many': ['bad', 'Not enough seats: {d}. Nobody was moved. Choose a table with more free seats, or seat people individually.'],
  full: ['bad', '{d} is full. Nobody was added.'], already: ['bad', 'That guest is already at a table, or no longer on the guest list.'],
  'seats-too-few': ['bad', 'Not changed: {d} already has more people than that.'], 'seats-invalid': ['bad', 'Please enter the number of seats (1 to 40).'],
  'setup-invalid': ['bad', 'Please enter the number of tables (1 to 40) and seats at each (1 to 40).'], 'not-empty': ['bad', '{d} still has people at it, so it can’t be removed.'],
  'medium-name': ['bad', 'Please enter the medium’s name.'], 'mediums-only': ['bad', 'The Mediums’ table is for mediums only.'], gone: ['bad', 'That table or guest no longer exists.']
};

// A small picture of a round table: one dot per seat, gold when taken
function tableDrawing(t, size = 92) {
  const r = size / 2 - 10, c = size / 2;
  const dots = Array.from({ length: t.seats }, (_, i) => {
    const a = (i / t.seats) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${(c + r * Math.cos(a)).toFixed(1)}" cy="${(c + r * Math.sin(a)).toFixed(1)}" r="${t.seats > 16 ? 3 : 5}" class="${i < t.used ? 'seat-taken' : 'seat-free'}"></circle>`;
  }).join('');
  return raw(`<svg class="table-drawing" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r - 12}" class="table-top"></circle>${dots}</svg>`);
}

function choicesLine(plan, person) {
  const bits = plan.questions.map((q, i) => (person.choices[i] ? `${q.label}: ${person.choices[i]}` : '')).filter(Boolean);
  return bits.length ? html`<span class="guest-meta">${bits.join(' · ')}</span>` : '';
}

function totalsList(totals, { compact = false } = {}) {
  if (!totals.length) return '';
  return html`<div class="${compact ? 'plan-totals plan-totals-compact' : 'plan-totals'}">${totals.map((t) => html`<div><span class="plan-total-label">${t.label}</span>
${t.rows.length ? t.rows.map((r) => html`<span class="plan-total-row"><span>${r.value}</span><strong>${r.count}</strong></span>`) : html`<span class="hint">None chosen yet</span>`}
${t.missing ? html`<span class="plan-total-row plan-missing"><span>Not chosen</span><strong>${t.missing}</strong></span>` : ''}</div>`)}</div>`;
}

// The drop-down ON a table: whole bookings (still unseated) first, then individual guests
function addControl(plan, t, csrf) {
  const groups = plan.groups.map((g) => ({ ...g, left: g.guests.filter((x) => !x.tableId) })).filter((g) => g.left.length);
  if (!groups.length) return html`<p class="hint">Everyone on the guest list has a table.</p>`;
  if (t.free < 1) return html`<p class="hint">This table is full.</p>`;
  return html`<form method="post" action="/admin/events/${plan.event.id}/tables/${t.id}/assign" class="plan-add">${hidden(csrf)}
<label class="sr-only" for="add-${t.id}">Add to ${t.name}</label>
<select id="add-${t.id}" name="who" data-autosubmit>
<option value="">Add to ${t.name}…</option>
<optgroup label="Whole bookings">${groups.map((g) => html`<option value="b:${g.bookingId}"${g.left.length > t.free ? raw(' disabled') : ''}>${g.purchaser || g.left[0].name} (${g.reference}): ${g.left.length < g.guests.length ? `remaining ${g.left.length} of ${g.guests.length}` : `${g.left.length} ${g.left.length === 1 ? 'guest' : 'guests'}`}${g.left.length > t.free ? ' – not enough seats' : ''}</option>`)}</optgroup>
<optgroup label="One guest at a time">${groups.flatMap((g) => g.left).sort((a, b) => a.name.localeCompare(b.name)).map((x) => html`<option value="g:${x.id}">${x.name}${x.groupSize > 1 ? ` (with ${x.purchaser || x.reference})` : ''}</option>`)}</optgroup>
</select>
<button class="pill pill-gold" type="submit">Add</button>
</form>`;
}

function guestRow(plan, t, g, csrf) {
  const others = plan.tables.filter((x) => !x.is_mediums && x.id !== t.id);
  const withHim = plan.guests.filter((x) => x.bookingId === g.bookingId && x.tableId === t.id).length;
  return html`<li class="plan-guest">
<div><span class="guest-name">${g.name}</span>${plan.splitIds.has(g.bookingId) ? html` <span class="chip chip-warn">booking split</span>` : ''}
<br><span class="guest-meta">${g.reference}${g.purchaser && g.purchaser !== g.name ? ` · booked by ${g.purchaser}` : ''}</span>
${plan.questions.length ? html`<br>${choicesLine(plan, g)}` : ''}</div>
<div class="row-actions">
${others.length ? html`<form method="post" action="/admin/events/${plan.event.id}/tables/guest/${g.id}/move" class="plan-move">${hidden(csrf)}
<label class="sr-only" for="mv-${g.id}">Move ${g.name}</label>
<select id="mv-${g.id}" name="table_id" data-autosubmit><option value="">Move to…</option>${others.map((x) => html`<option value="${x.id}"${x.free < 1 ? raw(' disabled') : ''}>${x.name} (${x.free} free)</option>`)}</select>
${withHim > 1 ? html`<label class="field-check plan-whole"><input type="checkbox" name="whole" value="1"> Move all ${withHim} from this booking</label>` : ''}
<button class="pill" type="submit">Move</button></form>` : ''}
<form method="post" action="/admin/events/${plan.event.id}/tables/guest/${g.id}/unseat">${hidden(csrf)}<button class="pill" type="submit">Take off table</button></form>
</div></li>`;
}

function mediumForm(plan, t, csrf) {
  if (t.free < 1) return html`<p class="hint">The Mediums’ table is full. Add seats to add more mediums.</p>`;
  return html`<form method="post" action="/admin/events/${plan.event.id}/tables/${t.id}/medium" class="admin-form plan-medium-form">${hidden(csrf)}
<div class="field"><label for="md-name">Medium’s name</label><input id="md-name" name="name" type="text" maxlength="80"></div>
${plan.questions.map((q) => q.type === 'checkbox'
    ? html`<label class="field-check"><input type="checkbox" name="q${q.id}" value="1"> ${q.label}</label>`
    : html`<div class="field"><label for="md-q${q.id}">${q.label}</label><select id="md-q${q.id}" name="q${q.id}"><option value="">Not chosen yet</option>${q.activeOptions.map((o) => html`<option value="${o.id}">${o.label}</option>`)}</select></div>`)}
<div class="field"><label for="md-note">Note (optional)</label><input id="md-note" name="note" type="text" maxlength="200" placeholder="e.g. no onions"></div>
<button class="pill pill-gold" type="submit">Add medium</button>
</form>`;
}

function tableCard(plan, t, csrf) {
  return html`<li class="plan-table${t.is_mediums ? ' is-mediums' : ''}${t.free < 0 ? ' is-over' : ''}" id="table-${t.id}">
<div class="plan-table-head">${tableDrawing(t)}
<div><h3>${t.name}</h3>
<p class="plan-seats"><strong>${t.used}</strong> of ${t.seats} seats taken · <strong>${Math.max(0, t.free)}</strong> free</p>
${t.is_mediums ? html`<p class="hint">Mediums are counted for catering, not as paid places.</p>` : ''}
${t.free < 0 ? html`<p class="error">More people than seats: please move someone.</p>` : ''}</div></div>
${t.guests.length || t.mediums.length ? html`<ul class="plan-guests">
${t.guests.map((g) => guestRow(plan, t, g, csrf))}
${t.mediums.map((md) => html`<li class="plan-guest"><div><span class="guest-name">${md.name}</span> <span class="chip chip-live">Medium</span>
${plan.questions.length ? html`<br>${choicesLine(plan, md)}` : ''}${md.note ? html`<br><span class="guest-meta">${md.note}</span>` : ''}</div>
<form method="post" action="/admin/events/${plan.event.id}/tables/medium/${md.id}/remove">${hidden(csrf)}<button class="pill" type="submit" data-confirm="Remove ${md.name} from the Mediums’ table?">Remove</button></form></li>`)}
</ul>` : html`<p class="hint">Nobody at this table yet.</p>`}
${t.is_mediums ? mediumForm(plan, t, csrf) : addControl(plan, t, csrf)}
${totalsList(t.totals, { compact: true })}
<details class="help"><summary>Change this table</summary>
<form method="post" action="/admin/events/${plan.event.id}/tables/${t.id}/edit" class="admin-form">${hidden(csrf)}
<div class="field"><label for="tn-${t.id}">Name</label><input id="tn-${t.id}" name="name" type="text" maxlength="60" value="${t.name}"></div>
<div class="field"><label for="ts-${t.id}">Seats</label><input id="ts-${t.id}" name="seats" type="text" inputmode="numeric" value="${t.seats}"></div>
<button class="pill pill-gold" type="submit">Save</button></form>
${t.used ? '' : html`<form method="post" action="/admin/events/${plan.event.id}/tables/${t.id}/remove">${hidden(csrf)}<button class="pill pill-danger" type="submit" data-confirm="Remove ${t.name}?">Remove this table</button></form>`}
</details>
</li>`;
}

export function plannerPage({ plan, csrf, flash, detail }) {
  const { event, counts } = plan;
  const f = FLASH[flash];
  const normal = plan.tables.filter((t) => !t.is_mediums);
  return adminPage({
    title: 'Table plan', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/events/${event.id}/manage">Back to this event</a></p>
<h2>${event.name}</h2><p class="hint">${eventLine(event)}</p>
${f ? html`<p class="banner ${f[0] === 'ok' ? 'banner-ok' : 'banner-error'}" role="${f[0] === 'ok' ? 'status' : 'alert'}">${f[1].replace('{d}', detail)}</p>` : ''}
<div class="stats stats-4" aria-label="Seating">
<p><strong>${counts.guests}</strong> booked guests</p>
<p><strong>${counts.seated}</strong> seated</p>
<p><strong>${counts.unseated}</strong> not seated yet</p>
<p><strong>${counts.seats}</strong> seats at ${normal.length} ${normal.length === 1 ? 'table' : 'tables'}</p>
</div>
${plan.splits.length ? html`<section class="panel plan-warning" aria-labelledby="splits"><h2 id="splits">Bookings split up</h2>
<p class="hint">These bookings are not all at the same table. That’s fine if it’s what they wanted.</p>
<ul class="todo">${plan.splits.map((s) => html`<li><strong>${s.purchaser || s.reference}</strong> (${s.reference}): ${s.tables.join(', ')}${s.unseated ? `, and ${s.unseated} not seated yet` : ''}</li>`)}</ul></section>` : ''}
${!normal.length ? html`<section class="panel" aria-labelledby="setup"><h2 id="setup">Set up the tables</h2>
<p class="hint">For example 9 tables of 8. You can change any table’s name or seats afterwards, and add more.</p>` : html`<details class="panel help"><summary>Add tables or change all seats</summary>`}
<form method="post" action="/admin/events/${event.id}/tables/setup" class="admin-form">${hidden(csrf)}
<div class="time-pair"><div class="field time-field"><label for="pt-count">Number of round tables</label><input id="pt-count" name="count" type="text" inputmode="numeric" value="${normal.length || 9}"></div>
<div class="field time-field"><label for="pt-seats">Seats at each table</label><input id="pt-seats" name="seats" type="text" inputmode="numeric" value="${normal[0] ? normal[0].seats : 8}"></div></div>
${normal.length ? html`<label class="field-check"><input type="checkbox" name="apply_seats" value="1"> Also change every table to this number of seats</label>` : ''}
<button class="btn-gold" type="submit">${normal.length ? 'Update tables' : 'Set up tables'}</button></form>
${!normal.length ? html`</section>` : html`</details>`}
${normal.length ? html`<p class="row-actions"><a class="pill pill-gold" href="/admin/events/${event.id}/tables/print" target="_blank" rel="noopener">Printable plan (PDF)</a>
<a class="pill" href="/admin/events/${event.id}/tables.csv">Spreadsheet (CSV)</a></p>` : ''}
<ul class="plan-grid">${plan.tables.map((t) => tableCard(plan, t, csrf))}</ul>
${plan.mediumsTable ? '' : html`<form method="post" action="/admin/events/${event.id}/tables/mediums-table" class="panel admin-form">${hidden(csrf)}
<h2>Mediums’ table (optional)</h2>
<p class="hint">A separate table for the evening’s mediums, with their food choices. They are included in the catering totals, but are not tickets and don’t use any paid places.</p>
<div class="field"><label for="pm-seats">Seats</label><input id="pm-seats" name="seats" type="text" inputmode="numeric" value="8"></div>
<button class="pill pill-gold" type="submit">Add a Mediums’ table</button></form>`}
${plan.unseated.length ? html`<section class="panel" aria-labelledby="unseated"><h2 id="unseated">Not seated yet (${plan.unseated.length})</h2>
<ul class="todo">${plan.unseated.map((g) => html`<li>${g.name} <span class="hint">(${g.reference}${g.purchaser && g.purchaser !== g.name ? ', booked by ' + g.purchaser : ''})</span></li>`)}</ul></section>` : ''}
<section class="panel" aria-labelledby="cat"><h2 id="cat">Catering totals for the whole event</h2>
<p class="hint">Every booked guest${counts.mediums ? ` plus ${counts.mediums} ${counts.mediums === 1 ? 'medium' : 'mediums'}` : ''}: ${counts.guests + counts.mediums} meals in total.</p>
${plan.questions.length ? totalsList(plan.totals) : html`<p>This event has no meal or dessert questions yet. Add them under Questions for guests.</p>`}</section>`
  });
}

// ---------- printable plan: white paper, one table per page, then the catering totals ----------

function printTableSvg(t) {
  const people = [...t.guests.map((g) => g.name), ...t.mediums.map((md) => md.name)];
  const size = 420, c = size / 2, r = 120;
  const seats = Math.max(t.seats, 1);
  const parts = [`<circle cx="${c}" cy="${c}" r="${r - 34}" fill="#F7F1DC" stroke="#C67809" stroke-width="3"></circle>`,
    `<text x="${c}" y="${c + 8}" text-anchor="middle" font-size="24" font-family="Georgia, serif" fill="#000428">${esc(t.name)}</text>`];
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2 - Math.PI / 2;
    const x = c + r * Math.cos(a), y = c + r * Math.sin(a);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="${people[i] ? '#F8B709' : '#FFFFFF'}" stroke="#000428" stroke-width="1.5"></circle>`);
    if (people[i]) {
      const lx = c + (r + 26) * Math.cos(a), ly = c + (r + 26) * Math.sin(a) + 4;
      const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
      const name = people[i].length > 18 ? people[i].slice(0, 17) + '…' : people[i];
      parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" font-size="13" font-family="Arial, sans-serif" fill="#000428">${esc(name)}</text>`);
    }
  }
  return raw(`<svg class="print-table" viewBox="-110 0 ${size + 220} ${size}" role="img" aria-label="${esc(t.name)}">${parts.join('')}</svg>`);
}

function printTotals(plan, totals) {
  if (!plan.questions.length) return html`<p>No meal or dessert questions.</p>`;
  return html`<table class="print-grid"><tbody>${totals.map((t) => html`<tr><th scope="row">${t.label}</th><td>${t.rows.map((r) => html`<span class="print-chip">${r.value}: <strong>${r.count}</strong></span>`)}${t.missing ? html`<span class="print-chip">Not chosen: <strong>${t.missing}</strong></span>` : ''}</td></tr>`)}</tbody></table>`;
}

export function printPage({ plan, centre }) {
  const { event } = plan;
  const head = html`<p class="print-head">${centre} · ${event.name} · ${eventLine(event)}</p>`;
  const tables = plan.tables.filter((t) => t.guests.length || t.mediums.length || !t.is_mediums);
  return html`<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Table plan: ${event.name}</title>
<link rel="stylesheet" href="/css/print.css?v=${ASSET_VERSION}">
<script src="/js/admin.js?v=${ASSET_VERSION}" defer></script>
</head><body>
<div class="no-print print-bar"><a href="/admin/events/${event.id}/tables">Back to the table plan</a>
<button type="button" data-print>Print or save as PDF</button>
<p>On an Android phone: tap the button, then choose <strong>Save as PDF</strong> as the printer.</p></div>
${tables.map((t) => html`<section class="print-page">
${head}
<h1>${t.name}</h1>
<p class="print-sub">${t.used} of ${t.seats} seats${t.is_mediums ? ' · Mediums (not paid places)' : ''}</p>
${printTableSvg(t)}
<table class="print-grid"><thead><tr><th scope="col">Guest</th>${plan.questions.map((q) => html`<th scope="col">${q.label}</th>`)}</tr></thead>
<tbody>${t.guests.map((g) => html`<tr><td>${g.name}<br><span class="print-small">${g.reference}${g.purchaser && g.purchaser !== g.name ? ' · ' + g.purchaser : ''}</span></td>${g.choices.map((c) => html`<td>${c || '–'}</td>`)}</tr>`)}
${t.mediums.map((md) => html`<tr><td>${md.name} (medium)${md.note ? html`<br><span class="print-small">${md.note}</span>` : ''}</td>${md.choices.map((c) => html`<td>${c || '–'}</td>`)}</tr>`)}
${!t.guests.length && !t.mediums.length ? html`<tr><td colspan="${plan.questions.length + 1}">Nobody at this table yet.</td></tr>` : ''}</tbody></table>
<h2>This table</h2>${printTotals(plan, t.totals)}
</section>`)}
<section class="print-page">
${head}
<h1>Catering totals</h1>
<p class="print-sub">${plan.counts.guests} booked ${plan.counts.guests === 1 ? 'guest' : 'guests'}${plan.counts.mediums ? ` + ${plan.counts.mediums} ${plan.counts.mediums === 1 ? 'medium' : 'mediums'}` : ''} = ${plan.counts.guests + plan.counts.mediums} meals${plan.counts.unseated ? ` (${plan.counts.unseated} not seated yet)` : ''}</p>
<h2>Whole event</h2>${printTotals(plan, plan.totals)}
${plan.counts.mediums ? html`<h2>Of which, mediums</h2>${printTotals(plan, plan.mediumTotals)}` : ''}
<h2>By table</h2>
<table class="print-grid"><thead><tr><th scope="col">Table</th><th scope="col">People</th>${plan.questions.map((q) => html`<th scope="col">${q.label}</th>`)}</tr></thead>
<tbody>${plan.tables.map((t) => html`<tr><td>${t.name}</td><td>${t.used}</td>${t.totals.map((x) => html`<td>${x.rows.map((r) => `${r.value}: ${r.count}`).join(', ') || '–'}${x.missing ? ` (not chosen: ${x.missing})` : ''}</td>`)}</tr>`)}</tbody></table>
${plan.unseated.length ? html`<h2>Not seated yet</h2><p>${plan.unseated.map((g) => g.name).join(', ')}</p>` : ''}
</section>
</body></html>`;
}
