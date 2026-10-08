// Private Reading availability. All hours are UK local time (Europe/London); summer time is handled when a local
// date and time is turned into an exact moment (londonLocalToUtc).
//
// For each date:
//   1. a 'closed' change for that date  -> no readings that day
//   2. 'hours' changes for that date    -> replace the normal weekly hours (any weekday can be opened this way)
//      otherwise                        -> the normal weekly hours for that weekday
//   3. 'extra' changes for that date    -> added on top
//   4. blocks for that date             -> removed
// Appointment start times are every half hour inside the result, and an appointment must END by the closing time,
// so with 12:00 to 17:00 the last 30-minute reading starts at 16:30 and the last 60-minute one at 16:00.
import { londonLocalToUtc, isIsoDate, weekdayOf, ukToday } from '../lib/dates.js';

export const STEP = 30;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "12:00" or "12:30" only, so every appointment lines up with the half-hour slots the database protects
export const isGridTime = (t) => /^([01]\d|2[0-3]):(00|30)$/.test(String(t || ''));
export const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// "16:30" -> "4:30pm", "12:00" -> "12 noon"
export function friendlyTime(t) {
  const m = toMin(t);
  if (m === 12 * 60) return '12 noon';
  let h = Math.floor(m / 60);
  const min = m % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}${min ? ':' + String(min).padStart(2, '0') : ''}${suffix}`;
}

function merge(intervals) {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function subtract(intervals, cuts) {
  let result = intervals;
  for (const [cs, ce] of cuts) {
    const next = [];
    for (const [s, e] of result) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    result = next;
  }
  return result;
}

// rules = { weekly: [...availability_weekly rows], dates: [...availability_dates rows], blocks: [...availability_blocks rows] }
export function windowsFor(date, rules) {
  const dateRows = rules.dates.filter((d) => d.date === date);
  if (dateRows.some((d) => d.mode === 'closed')) return { windows: [], closed: true, changed: true };
  const hours = dateRows.filter((d) => d.mode === 'hours');
  const base = hours.length ? hours : rules.weekly.filter((w) => Number(w.active) && Number(w.weekday) === weekdayOf(date));
  const extra = dateRows.filter((d) => d.mode === 'extra');
  const open = merge([...base, ...extra].map((r) => [toMin(r.start_time), toMin(r.end_time)]));
  const blocks = rules.blocks.filter((b) => b.date === date).map((b) => [toMin(b.start_time), toMin(b.end_time)]);
  return { windows: subtract(open, blocks), closed: false, changed: dateRows.length > 0 || blocks.length > 0 };
}

export function startTimes(windows, minutes) {
  const starts = [];
  for (const [s, e] of windows) {
    for (let t = Math.ceil(s / STEP) * STEP; t + minutes <= e; t += STEP) starts.push(fromMin(t));
  }
  return starts;
}

// The exact moment (UTC, ISO) of a UK local date and time
export const momentOf = (date, time) => londonLocalToUtc(`${date}T${time}`);

// The half hours (UTC, ISO) an appointment occupies: what booking_slots stores
export function slotsFor(startUtc, minutes) {
  const t0 = Date.parse(startUtc);
  return Array.from({ length: minutes / STEP }, (_, k) => new Date(t0 + k * STEP * 60_000).toISOString());
}

export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function datesAhead(fromDate, weeks) {
  return Array.from({ length: weeks * 7 + 1 }, (_, i) => addDays(fromDate, i));
}

export async function loadRules(env, fromDate, toDate) {
  const [weekly, dates, blocks] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM availability_weekly ORDER BY weekday, start_time'),
    env.DB.prepare('SELECT * FROM availability_dates WHERE date >= ?1 AND date <= ?2 ORDER BY date, start_time').bind(fromDate, toDate),
    env.DB.prepare('SELECT * FROM availability_blocks WHERE date >= ?1 AND date <= ?2 ORDER BY date, start_time').bind(fromDate, toDate)
  ]);
  return { weekly: weekly.results || [], dates: dates.results || [], blocks: blocks.results || [] };
}

// Start times a customer may book for one date: inside the hours, at least `noticeHours` away, and with none of the
// appointment's half hours already held or booked (`taken` = a Set of slot_utc values).
export function bookableStarts(date, rules, minutes, { nowMs = Date.now(), noticeHours = 24, taken = new Set() } = {}) {
  const { windows } = windowsFor(date, rules);
  const earliest = nowMs + noticeHours * 3600_000;
  return startTimes(windows, minutes).filter((t) => {
    const start = momentOf(date, t);
    if (!start || Date.parse(start) < earliest) return false;
    return slotsFor(start, minutes).every((s) => !taken.has(s));
  });
}

// For the Admin overview: every date in the coming weeks that has reading hours (or a change), with what results.
export async function overview(env, weeks, today = ukToday()) {
  const to = addDays(today, weeks * 7);
  const rules = await loadRules(env, today, to);
  return datesAhead(today, weeks).map((date) => {
    const w = windowsFor(date, rules);
    const s30 = startTimes(w.windows, 30);
    const s60 = startTimes(w.windows, 60);
    return { date, ...w, starts30: s30, starts60: s60,
      dateRows: rules.dates.filter((d) => d.date === date), blocks: rules.blocks.filter((b) => b.date === date) };
  }).filter((d) => d.windows.length || d.changed);
}

export { isIsoDate };
