// Admin for Private Readings (prices, booking rules, availability) and the Visitor Experiences ON/OFF switch.
// The router has already checked the owner's session and, for every change, the CSRF token.
import { textResponse, redirect } from '../lib/http.js';
import { ukToday, isIsoDate } from '../lib/dates.js';
import * as data from '../lib/data.js';
import { getBookingSettings, validateBookingSettings, saveSettingValues, numberSetting } from '../bookings/config.js';
import { isGridTime, toMin, addDays, WEEKDAYS, loadRules, windowsFor, fitsHours, breakMinutes, BREAK_OPTIONS, friendlyTime } from '../bookings/availability.js';
import { availability, activeServices } from '../bookings/public.js';
import * as view from '../views/admin-bookings.js';
import { connectionsPanel } from '../views/admin-orders.js';
import { squareConfig, squareMode } from '../payments/square.js';
import { emailConfigured } from '../lib/email.js';

const MAX_PRICE_PENCE = 100_000; // £1,000

// "40", "40.00", "£65.5" -> pence, or null
export function parsePrice(raw) {
  const s = String(raw ?? '').trim().replace(/^£\s*/, '').replace(/,/g, '');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return null;
  const pence = Math.round(Number(s) * 100);
  return pence >= 100 && pence <= MAX_PRICE_PENCE ? pence : null;
}

async function services(env) {
  const { results } = await env.DB.prepare('SELECT * FROM reading_services ORDER BY sort_order, id').all();
  return results || [];
}

// The times part of the weekly / date / block forms
function checkTimes(f, errors) {
  const start = String(f.start_time || ''), end = String(f.end_time || '');
  if (!isGridTime(start) || !isGridTime(end)) errors.times = 'Please choose times on the hour or half hour.';
  else if (toMin(start) >= toMin(end)) errors.times = 'The finishing time must be after the starting time.';
  return { start, end };
}

function checkDate(f, errors, today) {
  const date = String(f.date || '').trim();
  if (!isIsoDate(date)) errors.date = 'Please choose a date.';
  else if (date < today) errors.date = 'Please choose today or a later date.';
  else if (date > addDays(today, 2 * 366)) errors.date = 'Please choose a date within the next two years.';
  return date;
}

// Appointments that hold their time: paid ones, ones needing Gary's attention, and payment holds still running
const ACTIVE = `(b.status IN ('confirmed', 'needs_attention') OR (b.status = 'held' AND EXISTS (SELECT 1 FROM booking_slots s WHERE s.booking_id = b.id)))`;
async function appointments(env, from, to) {
  const { results } = await env.DB.prepare(`SELECT b.*, o.customer_name, o.reference, o.status AS order_status FROM bookings b JOIN orders o ON o.id = b.order_id
    WHERE b.date >= ?1 AND b.date <= ?2 AND ${ACTIVE} ORDER BY b.date, b.local_start`).bind(from, to).all();
  return results || [];
}

// Which appointments would no longer sit inside the hours if a change were saved (change = a function that edits a
// copy of the rules). Nothing is ever cancelled: Admin warns, and Gary decides.
async function wouldAffect(env, today, change) {
  const appts = await appointments(env, today, addDays(today, 3 * 366));
  if (!appts.length) return [];
  const rules = await loadRules(env, today, appts[appts.length - 1].date);
  const next = change({ weekly: [...rules.weekly], dates: [...rules.dates], blocks: [...rules.blocks] });
  return appts.filter((b) => fitsHours(b, rules) && !fitsHours(b, next));   // only those the change itself would move outside
}

const monthOf = (iso) => iso.slice(0, 7);
function addMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

async function managerData(env, today, url) {
  const settings = await getBookingSettings(env);
  const weeks = numberSetting(settings, 'booking_horizon_weeks');
  const selected = isIsoDate(url.searchParams.get('date')) ? url.searchParams.get('date') : null;
  let month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : monthOf(selected || today);
  if (month < monthOf(today)) month = monthOf(today);
  if (month > monthOf(addDays(today, 2 * 366))) month = monthOf(addDays(today, 2 * 366));
  const first = month + '-01', last = addDays(addMonth(month, 1) + '-01', -1);
  const [rules, appts, breakMin] = await Promise.all([loadRules(env, first, last), appointments(env, first, last), breakMinutes(env)]);
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const w = windowsFor(d, rules);
    days.push({ date: d, open: w.windows.length > 0, closed: w.closed, changed: w.changed, past: d < today, appts: appts.filter((a) => a.date === d).length });
  }
  let day = null;
  if (selected && monthOf(selected) === month) {
    const w = windowsFor(selected, rules);
    const services = await activeServices(env);
    const starts = {};
    for (const s of services) starts[s.code] = { name: s.name, minutes: s.minutes, times: (await availability(env, settings, s.minutes, selected, selected)).byDate[selected] || [] };
    day = { date: selected, ...w, dateRows: rules.dates.filter((r) => r.date === selected), blocks: rules.blocks.filter((b) => b.date === selected),
      appts: appts.filter((a) => a.date === selected), starts, past: selected < today };
  }
  return { weekly: rules.weekly, weeks, breakMin, month, months: { prev: month > monthOf(today) ? addMonth(month, -1) : null, next: addMonth(month, 1) }, days, day, today, noticeHours: numberSetting(settings, 'booking_min_notice_hours') };
}

const apptText = (a) => `${friendlyTime(a.local_start)} ${a.service_name} (${a.minutes} minutes) for ${a.customer_name}, ${a.status === 'held' ? 'payment hold' : a.status === 'needs_attention' ? 'needs attention' : 'paid'}`;

export async function handleBookingsAdmin(ctx) {
  const { env, url, method, path, form, page, csrf, request } = ctx;
  const f = form.fields;
  const connections = (settings) => connectionsPanel({ square: !!squareConfig(env), mode: squareMode(env), webhookReady: !!(squareConfig(env) && env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    email: emailConfigured(env), notification: !!settings.notification_email, webhookUrl: new URL(request.url).origin + '/webhooks/square' });

  // ----- Visitor Experiences ON/OFF -----
  const sw = path.match(/^\/admin\/reviews\/(open|close)$/);
  if (sw) {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const open = sw[1] === 'open';
    await saveSettingValues(env, { reviews_open: open ? '1' : '0' },
      data.audit(env, 'reviews.' + sw[1], open ? 'Sharing visitor experiences opened' : 'Sharing visitor experiences closed'));
    return redirect('/admin/reviews?flash=' + (open ? 'opened' : 'closed'));
  }

  if (path !== '/admin/readings' && !path.startsWith('/admin/readings/')) return null;

  // ----- Prices and booking rules -----
  if (path === '/admin/readings') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const [list, settings] = await Promise.all([services(env), getBookingSettings(env)]);
    return page(view.readingsPage({ services: list, settings, csrf: csrf.token, flash: url.searchParams.get('flash'), top: connections(settings) }));
  }
  if (path === '/admin/readings/prices') {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const list = await services(env);
    const errors = {}, prices = {};
    for (const s of list) {
      const pence = parsePrice(f['price_' + s.code]);
      if (pence === null) errors['price_' + s.code] = 'Enter a price from £1 to £1,000, for example 40 or 40.00.';
      else prices[s.code] = pence;
    }
    if (Object.keys(errors).length) {
      return page(view.readingsPage({ services: list, settings: await getBookingSettings(env), priceValues: f, priceErrors: errors, csrf: csrf.token }), 422);
    }
    const changed = list.filter((s) => prices[s.code] !== s.price_pence);
    if (changed.length) {
      await env.DB.batch([
        ...changed.map((s) => env.DB.prepare(`UPDATE reading_services SET price_pence = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2`).bind(prices[s.code], s.id)),
        data.audit(env, 'readings.prices', 'Reading prices: ' + changed.map((s) => `${s.name} £${view.pounds(s.price_pence)} → £${view.pounds(prices[s.code])}`).join('; '))
      ]);
    }
    return redirect('/admin/readings?flash=prices');
  }
  if (path === '/admin/readings/rules') {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const { values, errors } = validateBookingSettings(f);
    if (Object.keys(errors).length) {
      return page(view.readingsPage({ services: await services(env), settings: await getBookingSettings(env), ruleValues: values, ruleErrors: errors, csrf: csrf.token }), 422);
    }
    await saveSettingValues(env, values, data.audit(env, 'readings.rules', 'Booking rules saved'));
    return redirect('/admin/readings?flash=rules#rules');
  }

  // ----- Availability Manager -----
  const today = ukToday();
  const showManager = async (extra = {}, status = 200) =>
    page(view.availabilityManager({ ...(await managerData(env, today, extra.url || url)), csrf: csrf.token, flash: extra.url ? null : url.searchParams.get('flash'), ...extra }), status);
  const backTo = (date, flash) => redirect(`/admin/readings/availability?${date ? `month=${date.slice(0, 7)}&date=${date}&` : ''}flash=${flash}${date ? '#day' : '#week'}`);
  const dayUrl = (date) => new URL(`/admin/readings/availability?month=${date.slice(0, 7)}&date=${date}`, url);
  const warnAffected = (list) => list.map(apptText);

  if (path === '/admin/readings/availability') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return showManager();
  }
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });

  // The break after every reading
  if (path === '/admin/readings/availability/break') {
    const n = Number(f.break_minutes);
    if (!BREAK_OPTIONS.includes(n) || String(f.break_minutes ?? '') === '') return showManager({ errors: { break: 'Please choose a break.' } }, 422);
    await saveSettingValues(env, { booking_break_minutes: String(n) }, data.audit(env, 'readings.break', `Break after each reading: ${n} minutes`));
    return backTo(null, 'break');
  }

  // Regular weekly hours: every day of the week in one form
  if (path === '/admin/readings/availability/week') {
    const errors = {}, rows = [];
    for (let d = 0; d < 7; d++) {
      if (f['on_' + d] !== '1') continue;
      const start = String(f['start_' + d] || ''), end = String(f['end_' + d] || '');
      if (!isGridTime(start) || !isGridTime(end)) errors['day_' + d] = 'Please choose times on the hour or half hour.';
      else if (toMin(start) >= toMin(end)) errors['day_' + d] = 'The finishing time must be after the starting time.';
      else rows.push({ weekday: d, start_time: start, end_time: end, active: 1 });
    }
    if (Object.keys(errors).length) return showManager({ errors, weekValues: f }, 422);
    const affected = await wouldAffect(env, today, (r) => ({ ...r, weekly: rows }));
    if (affected.length && f.confirm !== '1') return showManager({ weekValues: f, weekWarning: warnAffected(affected) }, 409);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM availability_weekly'),
      ...rows.map((r) => env.DB.prepare('INSERT INTO availability_weekly (weekday, start_time, end_time) VALUES (?1, ?2, ?3)').bind(r.weekday, r.start_time, r.end_time)),
      data.audit(env, 'readings.week', 'Regular reading hours: ' + (rows.map((r) => `${WEEKDAYS[r.weekday]} ${r.start_time}–${r.end_time}`).join(', ') || 'none') +
        (affected.length ? ` (saved with ${affected.length} appointment(s) outside the new hours; those bookings are unchanged)` : ''))
    ]);
    return backTo(null, 'week');
  }

  // One date: the regular hours, open with these hours, or closed
  if (path === '/admin/readings/availability/day') {
    const errors = {};
    const date = checkDate(f, errors, today);
    const choice = String(f.choice || '');
    if (!['normal', 'open', 'closed'].includes(choice)) errors.choice = 'Please choose what happens on this date.';
    let start = null, end = null;
    if (choice === 'open') ({ start, end } = checkTimes(f, errors));
    const note = String(f.note || '').trim().slice(0, 120);
    const back = isIsoDate(date) ? dayUrl(date) : url;
    if (Object.keys(errors).length) return showManager({ url: back, errors, dayValues: f }, 422);
    const row = choice === 'normal' ? null : { date, mode: choice === 'open' ? 'hours' : 'closed', start_time: start, end_time: end, note };
    const affected = await wouldAffect(env, today, (r) => ({ ...r, dates: [...r.dates.filter((x) => x.date !== date), ...(row ? [row] : [])] }));
    if (affected.length && f.confirm !== '1') return showManager({ url: back, dayValues: f, dayWarning: warnAffected(affected) }, 409);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM availability_dates WHERE date = ?1').bind(date),
      ...(row ? [env.DB.prepare('INSERT INTO availability_dates (date, mode, start_time, end_time, note) VALUES (?1, ?2, ?3, ?4, ?5)').bind(date, row.mode, start, end, note)] : []),
      data.audit(env, 'readings.day', `Reading hours for ${date}: ${choice === 'normal' ? 'regular weekly hours' : choice === 'open' ? `open ${start}–${end}` : 'closed'}` +
        (affected.length ? ` (saved with ${affected.length} appointment(s) outside the new hours; those bookings are unchanged)` : ''))
    ]);
    return backTo(date, 'day');
  }

  // (The forms below are kept from the earlier Availability screen: weekly hours, single-date changes and blocks.)
  if (path === '/admin/readings/availability/weekly') {
    const errors = {};
    const weekday = String(f.weekday ?? '');
    if (!/^[0-6]$/.test(weekday)) errors.weekday = 'Please choose a day.';
    const { start, end } = checkTimes(f, errors);
    if (Object.keys(errors).length) return showManager({ errors: { ...errors, legacy: true } }, 422);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO availability_weekly (weekday, start_time, end_time) VALUES (?1, ?2, ?3)').bind(Number(weekday), start, end),
      data.audit(env, 'readings.weekly.add', `Weekly reading hours added: ${WEEKDAYS[weekday]} ${start}–${end}`)
    ]);
    return backTo(null, 'week');
  }
  if (path === '/admin/readings/availability/dates') {
    const errors = {};
    const date = checkDate(f, errors, today);
    const mode = String(f.mode || '');
    if (!['closed', 'hours', 'extra'].includes(mode)) errors.mode = 'Please choose what happens on that date.';
    let start = null, end = null;
    if (mode !== 'closed') ({ start, end } = checkTimes(f, errors));
    const note = String(f.note || '').trim().slice(0, 120);
    if (Object.keys(errors).length) return showManager({ errors: { ...errors, legacy: true } }, 422);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO availability_dates (date, mode, start_time, end_time, note) VALUES (?1, ?2, ?3, ?4, ?5)').bind(date, mode, start, end, note),
      data.audit(env, 'readings.date.add', `Reading hours for ${date}: ${mode}${start ? ` ${start}–${end}` : ''}`)
    ]);
    return backTo(date, 'day');
  }
  if (path === '/admin/readings/availability/blocks') {
    const errors = {};
    const date = checkDate(f, errors, today);
    const { start, end } = checkTimes(f, errors);
    const note = String(f.note || '').trim().slice(0, 120);
    const back = isIsoDate(date) ? dayUrl(date) : url;
    if (Object.keys(errors).length) return showManager({ url: back, errors: { ...errors, block: true }, blockValues: f }, 422);
    const affected = await wouldAffect(env, today, (r) => ({ ...r, blocks: [...r.blocks, { date, start_time: start, end_time: end }] }));
    if (affected.length && f.confirm !== '1') return showManager({ url: back, blockValues: f, blockWarning: warnAffected(affected) }, 409);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO availability_blocks (date, start_time, end_time, note) VALUES (?1, ?2, ?3, ?4)').bind(date, start, end, note),
      data.audit(env, 'readings.block.add', `Reading time blocked: ${date} ${start}–${end}` + (affected.length ? ` (over ${affected.length} appointment(s); those bookings are unchanged)` : ''))
    ]);
    return backTo(date, 'block-added');
  }
  const del = path.match(/^\/admin\/readings\/availability\/(weekly|dates|blocks)\/(\d{1,9})\/delete$/);
  if (del) {
    const table = { weekly: 'availability_weekly', dates: 'availability_dates', blocks: 'availability_blocks' }[del[1]];
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?1`).bind(Number(del[2])).first();
    if (row) {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(row.id),
        data.audit(env, `readings.${del[1]}.remove`, `Reading availability removed (${del[1]}: ${row.date || WEEKDAYS[row.weekday]} ${row.start_time || 'closed'}${row.end_time ? '–' + row.end_time : ''})`)
      ]);
    }
    const flashKey = { weekly: 'weekly-removed', dates: 'date-removed', blocks: 'block-removed' }[del[1]];
    return backTo(row && row.date ? row.date : null, flashKey);
  }
  return null;
}
