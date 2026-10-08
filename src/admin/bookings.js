// Admin for Private Readings (prices, booking rules, availability) and the Visitor Experiences ON/OFF switch.
// The router has already checked the owner's session and, for every change, the CSRF token.
import { textResponse, redirect } from '../lib/http.js';
import { ukToday, isIsoDate } from '../lib/dates.js';
import * as data from '../lib/data.js';
import { getBookingSettings, validateBookingSettings, saveSettingValues, numberSetting } from '../bookings/config.js';
import { isGridTime, toMin, addDays, overview, WEEKDAYS } from '../bookings/availability.js';
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

async function availabilityData(env, today) {
  const settings = await getBookingSettings(env);
  const weeks = numberSetting(settings, 'booking_horizon_weeks');
  const [weekly, dates, blocks] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM availability_weekly ORDER BY weekday, start_time'),
    env.DB.prepare('SELECT * FROM availability_dates WHERE date >= ?1 ORDER BY date, start_time').bind(today),
    env.DB.prepare('SELECT * FROM availability_blocks WHERE date >= ?1 ORDER BY date, start_time').bind(today)
  ]);
  return { weekly: weekly.results || [], dates: dates.results || [], blocks: blocks.results || [], weeks, overview: await overview(env, weeks, today) };
}

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

  // ----- Availability -----
  const today = ukToday();
  const showAvailability = async (extra = {}, status = 200) =>
    page(view.availabilityPage({ ...(await availabilityData(env, today)), csrf: csrf.token, today, flash: url.searchParams.get('flash'), ...extra }), status);

  if (path === '/admin/readings/availability') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return showAvailability();
  }
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });

  if (path === '/admin/readings/availability/weekly') {
    const errors = {};
    const weekday = String(f.weekday ?? '');
    if (!/^[0-6]$/.test(weekday)) errors.weekday = 'Please choose a day.';
    const { start, end } = checkTimes(f, errors);
    if (Object.keys(errors).length) return showAvailability({ errors, values: { ...f, form: 'weekly' }, flash: null }, 422);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO availability_weekly (weekday, start_time, end_time) VALUES (?1, ?2, ?3)').bind(Number(weekday), start, end),
      data.audit(env, 'readings.weekly.add', `Weekly reading hours added: ${WEEKDAYS[weekday]} ${start}–${end}`)
    ]);
    return redirect('/admin/readings/availability?flash=weekly-added#weekly');
  }
  if (path === '/admin/readings/availability/dates') {
    const errors = {};
    const date = checkDate(f, errors, today);
    const mode = String(f.mode || '');
    if (!['closed', 'hours', 'extra'].includes(mode)) errors.mode = 'Please choose what happens on that date.';
    let start = null, end = null;
    if (mode !== 'closed') ({ start, end } = checkTimes(f, errors));
    const note = String(f.note || '').trim().slice(0, 120);
    if (Object.keys(errors).length) return showAvailability({ errors, values: { ...f, form: 'dates' }, flash: null }, 422);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO availability_dates (date, mode, start_time, end_time, note) VALUES (?1, ?2, ?3, ?4, ?5)').bind(date, mode, start, end, note),
      data.audit(env, 'readings.date.add', `Reading hours for ${date}: ${mode}${start ? ` ${start}–${end}` : ''}`)
    ]);
    return redirect('/admin/readings/availability?flash=date-added#dates');
  }
  if (path === '/admin/readings/availability/blocks') {
    const errors = {};
    const date = checkDate(f, errors, today);
    const { start, end } = checkTimes(f, errors);
    const note = String(f.note || '').trim().slice(0, 120);
    if (Object.keys(errors).length) return showAvailability({ errors, values: { ...f, form: 'blocks' }, flash: null }, 422);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO availability_blocks (date, start_time, end_time, note) VALUES (?1, ?2, ?3, ?4)').bind(date, start, end, note),
      data.audit(env, 'readings.block.add', `Reading time blocked: ${date} ${start}–${end}`)
    ]);
    return redirect('/admin/readings/availability?flash=block-added#blocks');
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
    return redirect(`/admin/readings/availability?flash=${flashKey}#${del[1]}`);
  }
  return null;
}
