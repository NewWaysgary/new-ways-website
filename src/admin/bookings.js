// Admin for Private Readings (prices, booking rules, availability) and the Visitor Experiences ON/OFF switch.
// The router has already checked the owner's session and, for every change, the CSRF token.
import { textResponse, redirect } from '../lib/http.js';
import { ukToday, isIsoDate } from '../lib/dates.js';
import * as data from '../lib/data.js';
import { getBookingSettings, validateBookingSettings, saveSettingValues, numberSetting } from '../bookings/config.js';
import { isGridTime, toMin, addDays, loadRules, windowsFor, fitsHours, breakMinutes, BREAK_OPTIONS, friendlyTime } from '../bookings/availability.js';
import { releaseExpiredHolds } from '../orders.js';
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

// What Admin shows for each date. Only paid, confirmed appointments are "appointments"; everything else is listed
// separately so it can never be mistaken for one:
//   confirmed  - Square payment verified, booking confirmed
//   attention  - paid, but needs Gary (for example paid after the hold ran out)
//   hold       - went to Square, the 15-minute payment hold is still running
//   unpaid     - went to Square but didn't pay (the hold ran out or the order was closed)
//   incomplete - gave their details to the assistant but never went to Square (kept 24 hours, see Incomplete Bookings)
async function activity(env, from, to) {
  const now = new Date().toISOString();
  const [bk, dr] = await env.DB.batch([
    env.DB.prepare(`SELECT b.*, o.customer_name, o.reference, o.status AS order_status, o.square_payment_id FROM bookings b JOIN orders o ON o.id = b.order_id
      WHERE b.date >= ?1 AND b.date <= ?2 ORDER BY b.date, b.local_start`).bind(from, to),
    env.DB.prepare(`SELECT * FROM reading_drafts WHERE date >= ?1 AND date <= ?2 AND status IN ('in_progress', 'incomplete') AND delete_after > ?3 ORDER BY date, local_start`).bind(from, to, now)
  ]);
  const out = [];
  for (const b of bk.results || []) {
    let kind = null;
    if (b.status === 'confirmed' && b.order_status === 'paid') kind = 'confirmed';
    else if (b.status === 'needs_attention' || b.order_status === 'needs_attention') kind = 'attention';
    else if (b.status === 'held' && b.hold_expires_at && b.hold_expires_at > now) kind = 'hold';
    else if (!b.square_payment_id && ['expired', 'cancelled', 'pending'].includes(b.order_status) && ['held', 'expired', 'cancelled'].includes(b.status)) kind = 'unpaid';
    if (kind) out.push({ kind, date: b.date, local_start: b.local_start, minutes: b.minutes, service_name: b.service_name, customer_name: b.customer_name, reference: b.reference, status: b.status, order_status: b.order_status });
  }
  for (const d of dr.results || []) {
    out.push({ kind: 'incomplete', date: d.date, local_start: d.local_start, minutes: d.minutes, service_name: d.service_name, customer_name: d.customer_name, reference: '', status: d.status });
  }
  return out.sort((x, y) => (x.date + x.local_start < y.date + y.local_start ? -1 : 1));
}

// Appointments a change must never be made over without Gary confirming: confirmed and paid ones, and payment holds
// still running (someone may be paying right now)
const PROTECTED = ['confirmed', 'attention', 'hold'];

// Which of those would no longer sit inside the hours if a change were saved (change = a function that edits a copy
// of the rules). Nothing is ever cancelled: Admin warns, and Gary decides.
async function wouldAffect(env, today, change) {
  const appts = (await activity(env, today, addDays(today, 3 * 366))).filter((a) => PROTECTED.includes(a.kind));
  if (!appts.length) return [];
  const rules = await loadRules(env, today, appts[appts.length - 1].date);
  const next = change({ weekly: [], dates: [...rules.dates], blocks: [...rules.blocks] });
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
  const horizonEnd = addDays(today, weeks * 7);
  const selected = isIsoDate(url.searchParams.get('date')) ? url.searchParams.get('date') : null;
  const lastMonth = monthOf(addDays(today, 2 * 366));
  let month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : monthOf(selected || today);
  if (month < monthOf(today)) month = monthOf(today);
  if (month > lastMonth) month = lastMonth;
  const first = month + '-01', last = addDays(addMonth(month, 1) + '-01', -1);
  const [rules, acts, breakMin] = await Promise.all([loadRules(env, first, last), activity(env, first, last), breakMinutes(env)]);
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const w = windowsFor(d, rules);
    const mine = acts.filter((a) => a.date === d);
    days.push({ date: d, open: w.windows.length > 0, later: d > horizonEnd, past: d < today,
      confirmed: mine.filter((a) => a.kind === 'confirmed').length, other: mine.filter((a) => a.kind !== 'confirmed').length });
  }
  let day = null;
  if (selected && monthOf(selected) === month) {
    const w = windowsFor(selected, rules);
    const services = await activeServices(env);
    const starts = {};
    for (const s of services) starts[s.code] = { name: s.name, minutes: s.minutes, times: (await availability(env, settings, s.minutes, selected, selected)).byDate[selected] || [] };
    day = { date: selected, ...w, hoursRow: rules.dates.find((r) => r.date === selected && r.mode === 'hours') || null, blocks: rules.blocks.filter((b) => b.date === selected),
      acts: acts.filter((a) => a.date === selected), starts, past: selected < today, later: selected > horizonEnd, opensOn: addDays(selected, -weeks * 7) };
  }
  return { weeks, breakMin, month, months: { prev: month > monthOf(today) ? addMonth(month, -1) : null, next: month < lastMonth ? addMonth(month, 1) : null }, days, day, today,
    noticeHours: numberSetting(settings, 'booking_min_notice_hours') };
}

const KIND_TEXT = { confirmed: 'paid', attention: 'paid, needs your attention', hold: 'payment hold (someone may be paying now)' };
const apptText = (a) => `${friendlyTime(a.local_start)} ${a.service_name} (${a.minutes} minutes) for ${a.customer_name}, ${KIND_TEXT[a.kind] || a.kind}`;

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

  // ----- Availability Manager: every date is closed unless Gary makes it available -----
  const today = ukToday();
  const showManager = async (extra = {}, status = 200) =>
    page(view.availabilityManager({ ...(await managerData(env, today, extra.url || url)), csrf: csrf.token, flash: extra.url ? null : url.searchParams.get('flash'), ...extra }), status);
  const dayUrl = (date) => new URL(`/admin/readings/availability?month=${date.slice(0, 7)}&date=${date}`, url);

  if (path === '/admin/readings/availability') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    await releaseExpiredHolds(env, 20);   // a payment hold that has run out is never shown as one
    return showManager();
  }
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });

  // The break after every reading
  if (path === '/admin/readings/availability/break') {
    const n = Number(f.break_minutes);
    if (!BREAK_OPTIONS.includes(n) || String(f.break_minutes ?? '') === '') return showManager({ errors: { break: 'Please choose a break.' } }, 422);
    await saveSettingValues(env, { booking_break_minutes: String(n) }, data.audit(env, 'readings.break', `Break after each reading: ${n} minutes`));
    return redirect('/admin/readings/availability?flash=break#break');
  }

  // One date: Available (with these hours) or Closed
  if (path === '/admin/readings/availability/day') {
    const errors = {};
    const date = checkDate(f, errors, today);
    const choice = String(f.choice || '');
    if (!['available', 'closed'].includes(choice)) errors.choice = 'Please choose Available or Closed.';
    let start = null, end = null;
    if (choice === 'available') ({ start, end } = checkTimes(f, errors));
    const note = String(f.note || '').trim().slice(0, 120);
    const back = isIsoDate(date) ? dayUrl(date) : url;
    if (Object.keys(errors).length) return showManager({ url: back, errors, dayValues: f }, 422);
    const row = choice === 'available' ? { date, mode: 'hours', start_time: start, end_time: end, note } : null;
    const affected = await wouldAffect(env, today, (r) => ({ ...r, dates: [...r.dates.filter((x) => x.date !== date), ...(row ? [row] : [])], blocks: r.blocks.filter((x) => x.date !== date) }));
    if (affected.length && f.confirm !== '1') return showManager({ url: back, dayValues: f, dayWarning: affected.map(apptText) }, 409);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM availability_dates WHERE date = ?1').bind(date),
      env.DB.prepare('DELETE FROM availability_blocks WHERE date = ?1').bind(date),
      ...(row ? [env.DB.prepare('INSERT INTO availability_dates (date, mode, start_time, end_time, note) VALUES (?1, ?2, ?3, ?4, ?5)').bind(date, 'hours', start, end, note)] : []),
      data.audit(env, 'readings.day', `Reading hours for ${date}: ${row ? `available ${start}–${end}` : 'closed'}` +
        (affected.length ? ` (saved with ${affected.length} appointment(s) outside the new hours; those bookings are unchanged)` : ''))
    ]);
    return redirect(`/admin/readings/availability?month=${date.slice(0, 7)}&date=${date}&flash=day#day`);
  }
  return null;
}
