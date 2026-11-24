// The weekly evening's actual date. Normally Wednesday; when Gary lists the week's medium on another day (for example
// Tuesday 15 December 2026), THAT day is the week's evening instead of the Wednesday, never as well as it.
//
// The rule, used everywhere (Who's On, paying in advance, the door, closures, the 6pm email):
//   * a week runs Monday to Sunday;
//   * if a Who's On listing in that week is on a day other than Wednesday, that day is the week's evening
//     (hidden listings count too: hiding a listing hides the medium, not the evening);
//   * otherwise the week's evening is the Wednesday, as always.
// Admin allows only one evening date per week (sections save checks it), so a week never has two evenings.
import { ukToday, isIsoDate, weekdayOf } from '../lib/dates.js';

const DAY_MS = 86400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (date, n) => iso(new Date(Date.parse(date + 'T12:00:00Z') + n * DAY_MS));

// Monday, Wednesday and Sunday of the week (Monday to Sunday) containing `date`
export function weekOf(date) {
  const back = (weekdayOf(date) + 6) % 7;   // days since Monday
  const mon = plus(date, -back);
  return { mon, wed: plus(mon, 2), sun: plus(mon, 6) };
}
export const sameWeek = (a, b) => isIsoDate(a) && isIsoDate(b) && weekOf(a).mon === weekOf(b).mon;

// The listings (any visibility) between two dates that are NOT on a Wednesday: the moved evenings
async function movedDates(env, from, to) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT date FROM mediums WHERE date BETWEEN ?1 AND ?2 AND strftime('%w', date) != '3' ORDER BY date`).bind(from, to).all();
  const byWeek = new Map();
  for (const r of results || []) { const k = weekOf(r.date).mon; if (!byWeek.has(k)) byWeek.set(k, r.date); }
  return byWeek;
}

// The evening of the week containing `date`
export async function weekEvening(env, date) {
  const w = weekOf(date);
  return (await movedDates(env, w.mon, w.sun)).get(w.mon) || w.wed;
}

// The next `count` weekly evenings, from today on (an evening already past this week is not included)
export async function eveningDates(env, count, today = ukToday()) {
  const first = weekOf(today).mon;
  const weeks = [];
  for (let i = 0; i <= count; i++) weeks.push(plus(first, i * 7));
  const moved = await movedDates(env, first, plus(weeks[weeks.length - 1], 6));
  return weeks.map((mon) => moved.get(mon) || plus(mon, 2)).filter((d) => d >= today).slice(0, count);
}

// Is this date a weekly evening? (Its week's evening is this date.)
export async function isEvening(env, date) {
  return isIsoDate(date) && (await weekEvening(env, date)) === date;
}

// When a week's evening moves (A to B, both from today on), what was booked for evening A goes with it:
// advance payments (their QR codes are unchanged and still work) and the evening's own record (a closure, say).
// Nothing is moved for an evening that has already begun at the till, or that is in the past.
export function moveEveningStatements(env, from, to) {
  return [
    env.DB.prepare(`UPDATE wed_orders SET night_date = ?2 WHERE night_date = ?1`).bind(from, to),
    env.DB.prepare(`UPDATE wed_nights SET night_date = ?2 WHERE night_date = ?1 AND NOT EXISTS (SELECT 1 FROM wed_nights x WHERE x.night_date = ?2)`).bind(from, to)
  ];
}

// What would moving evening A to B carry along? (for the check before saving and Gary's message afterwards)
export async function eveningActivity(env, date) {
  const [orders, sales] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM wed_orders WHERE night_date = ?1 AND status IN ('paid', 'pending', 'needs_attention')`).bind(date),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM till_sales WHERE night_date = ?1`).bind(date)
  ]);
  return { orders: orders.results[0].n, tillSales: sales.results[0].n };
}

// ---------- Admin: a Who's On listing being added, re-dated or deleted ----------
const listingNames = (rows) => [...new Set(rows.map((r) => r.name))].join(', ');

// The week's evening if this listing were gone (or moved to another week)
async function eveningWithout(env, date, id) {
  const w = weekOf(date);
  const r = await env.DB.prepare(`SELECT date FROM mediums WHERE date BETWEEN ?1 AND ?2 AND id != ?3 AND strftime('%w', date) != '3' ORDER BY date LIMIT 1`).bind(w.mon, w.sun, id || 0).first();
  return r ? r.date : w.wed;
}

// Checks a listing's date before it is saved, and works out which evenings move. Returns { error } or a plan:
//   carry: other listings of the same evening that move with it (a whole evening moved within its week);
//   moves: [{ from, to }] evenings that change date (from today on), whose advance payments go with them.
// `longDate` is passed in so this file needs no view code.
export async function planListingDate(env, { id, newDate, oldDate, longDate, today = ukToday() }) {
  const w = weekOf(newDate);
  const { results } = await env.DB.prepare(`SELECT id, name, date FROM mediums WHERE date BETWEEN ?1 AND ?2 AND id != ?3 AND date != ?4 ORDER BY date, sort_order, id`)
    .bind(w.mon, w.sun, id || 0, newDate).all();
  const others = results || [];
  let carry = [];
  if (others.length) {
    const wholeEvening = oldDate && sameWeek(oldDate, newDate) && others.every((o) => o.date === oldDate);
    if (!wholeEvening) {
      const d = others[0].date;
      return { error: `That week’s evening is already on ${longDate(d)} (${listingNames(others.filter((o) => o.date === d))}). There is one evening each week, so please choose ${longDate(d)}, or change the date of that listing first.` };
    }
    carry = others.map((o) => o.id);
  }
  if (id && oldDate && newDate !== oldDate && newDate < today) return { error: 'That date has already passed.' };
  const moves = [];
  const before = await weekEvening(env, newDate);
  if (before !== newDate) moves.push({ from: before, to: newDate });
  if (id && oldDate && !sameWeek(oldDate, newDate) && (await weekEvening(env, oldDate)) === oldDate) {
    const after = await eveningWithout(env, oldDate, id);
    if (after !== oldDate) moves.push({ from: oldDate, to: after });
  }
  const real = moves.filter((m) => m.from >= today);
  for (const m of real) {
    const a = await eveningActivity(env, m.from);
    if (a.tillSales) return { error: `The door till has already been used for ${longDate(m.from)}, so that evening can’t be moved now.` };
    m.orders = a.orders;
  }
  return { carry, moves: real };
}

// A listing being deleted: if it was what moved its week's evening, the evening goes back to the Wednesday
export async function planListingDelete(env, row, { today = ukToday() } = {}) {
  if ((await weekEvening(env, row.date)) !== row.date) return { moves: [] };
  const after = await eveningWithout(env, row.date, row.id);
  if (after === row.date || row.date < today) return { moves: [] };
  const a = await eveningActivity(env, row.date);
  if (a.tillSales) return { error: 'till' };
  return { moves: [{ from: row.date, to: after, orders: a.orders }] };
}

// After the listing is saved: the other listings of the evening and its advance payments follow it
export async function applyListingPlan(env, plan, newDate) {
  const steps = [];
  if (plan.carry && plan.carry.length) steps.push(env.DB.prepare(`UPDATE mediums SET date = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (${plan.carry.map(Number).join(',')})`).bind(newDate));
  for (const m of plan.moves || []) steps.push(...moveEveningStatements(env, m.from, m.to));
  if (steps.length) await env.DB.batch(steps);
}
