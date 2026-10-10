// Wednesday evenings: the door till's buttons, each night's record (float, close-night count, emergency closure),
// sales at the door, optional advance payments online, and the night's totals.
//
// Counting rules, so nothing is ever counted twice:
//   * MONEY: a door sale counts once, as cash or card, on its night. An advance payment counts once, as "online", on
//     the night it was bought for. Checking an advance payment in at the door adds NO money.
//   * PEOPLE: a door Entry (or Development) sale counts one person per item sold. An advance payment counts a person
//     only when they are let in at the door ("admitted"), never when it is bought. Paid but not used = no-show.
//   * RAFFLE STRIPS: sold at the door = given there and then. Paid in advance = given when RAFFLES GIVEN is pressed.
import { randomToken } from '../lib/http.js';
import { ukToday, isIsoDate, weekdayOf, londonLocalToUtc } from '../lib/dates.js';

export const CATEGORIES = [['entry', 'Entry (counts as attending the service)'], ['development', 'Development Circle (counts as attending the circle)'],
  ['raffle', 'Raffle (one per physical strip)'], ['gift', 'Gift Shop'], ['other', 'Other']];
export const CATEGORY_LABEL = { entry: 'Entry', development: 'Development', raffle: 'Raffle', gift: 'Gift Shop', other: 'Other' };
export const MAX_QTY = 99;
export const MAX_CUSTOM_PENCE = 50000;

export const pounds = (pence) => '£' + (Number(pence || 0) / 100).toFixed(2);

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newWedReference() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return 'WN-' + [...a].map((b) => REF_CHARS[b % REF_CHARS.length]).join('');
}
export const newWedToken = () => randomToken(16);
export const isWedToken = (t) => /^[A-Za-z0-9_-]{22}$/.test(String(t || ''));
export const wedCheckinUrl = (origin, token) => `${origin}/w/${token}`;

export async function tillItems(env, { enabledOnly = false, onlineOnly = false } = {}) {
  const where = [enabledOnly ? 'enabled = 1' : '', onlineOnly ? 'online = 1 AND custom_amount = 0' : ''].filter(Boolean);
  const { results } = await env.DB.prepare(`SELECT * FROM till_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort_order, id`).all();
  return results || [];
}

export async function night(env, date) {
  return (await env.DB.prepare('SELECT * FROM wed_nights WHERE night_date = ?1').bind(date).first())
    || { night_date: date, closed_for_public: 0, closure_reason: '', float_pence: 0, counted_cash_pence: null, till_closed_at: null, close_note: '', fresh: true };
}

export const ensureNight = (env, date) => env.DB.prepare('INSERT OR IGNORE INTO wed_nights (night_date) VALUES (?1)').bind(date);

// Wednesdays closed for the public (emergency closure), from today on
export async function closures(env, from = ukToday()) {
  const { results } = await env.DB.prepare('SELECT * FROM wed_nights WHERE closed_for_public = 1 AND night_date >= ?1 ORDER BY night_date').bind(from).all();
  return results || [];
}

export function nextWednesdays(count, today = ukToday()) {
  const out = [];
  const d = new Date(today + 'T12:00:00Z');
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < count; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
}
export const isWednesday = (date) => isIsoDate(date) && weekdayOf(date) === 3;

// Reads a basket of { item_id, qty, amount_pence } against the till's own prices. The browser never decides a price:
// fixed prices come from the database, and only a Gift Shop style button takes an amount typed at the door.
export function priceBasket(items, lines, { online = false } = {}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = [];
  const errors = [];
  for (const raw of Array.isArray(lines) ? lines.slice(0, 40) : []) {
    const item = byId.get(Number(raw && raw.item_id));
    const qty = Number(raw && raw.qty);
    if (!item || !item.enabled || (online && (!item.online || item.custom_amount))) { errors.push('An item is no longer available.'); continue; }
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) { errors.push(`Please choose a number from 0 to ${MAX_QTY}.`); continue; }
    if (!qty) continue;
    let unit = item.price_pence;
    if (item.custom_amount) {
      unit = Number(raw.amount_pence);
      if (!Number.isInteger(unit) || unit < 1 || unit > MAX_CUSTOM_PENCE) { errors.push(`Please enter the ${item.label} amount (up to ${pounds(MAX_CUSTOM_PENCE)}).`); continue; }
    }
    out.push({ item_id: item.id, label: item.label, category: item.category, unit_pence: unit, qty, line_pence: unit * qty });
  }
  const total = out.reduce((n, l) => n + l.line_pence, 0);
  return { lines: out, total, errors };
}

export const summaryText = (lines) => lines.map((l) => `${l.qty} × ${l.label}`).join(', ');
export const raffleStrips = (lines) => lines.filter((l) => l.category === 'raffle').reduce((n, l) => n + l.qty, 0);

// Can a customer still pay online for this Wednesday? (Not closed, not in the past, before the cut-off time.)
export function prepayCutoffUtc(date, time = '19:00') {
  return londonLocalToUtc(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '19:00'}`);
}

// Everything about one night: money by kind, people, raffle strips, advance payments. Used by the door screen,
// Close night, the night's report and its spreadsheet.
export async function nightTotals(env, date) {
  const [sales, lines, orders, olines] = await env.DB.batch([
    env.DB.prepare(`SELECT method, COUNT(*) AS n, COALESCE(SUM(total_pence), 0) AS pence FROM till_sales WHERE night_date = ?1 AND voided_at IS NULL GROUP BY method`).bind(date),
    env.DB.prepare(`SELECT l.category, l.label, l.unit_pence, SUM(l.qty) AS qty, SUM(l.line_pence) AS pence FROM till_sale_lines l JOIN till_sales s ON s.id = l.sale_id
      WHERE s.night_date = ?1 AND s.voided_at IS NULL GROUP BY l.category, l.label, l.unit_pence ORDER BY l.category, l.label`).bind(date),
    env.DB.prepare(`SELECT status, refunded_at, COUNT(*) AS n, COALESCE(SUM(total_pence), 0) AS pence, COUNT(raffles_given_at) AS raffled FROM wed_orders WHERE night_date = ?1 GROUP BY status, refunded_at IS NOT NULL`).bind(date),
    env.DB.prepare(`SELECT l.category, l.label, SUM(l.qty) AS qty, SUM(l.admitted) AS admitted, SUM(l.line_pence) AS pence,
        SUM(CASE WHEN o.raffles_given_at IS NOT NULL THEN l.qty ELSE 0 END) AS given
      FROM wed_order_lines l JOIN wed_orders o ON o.id = l.order_id WHERE o.night_date = ?1 AND o.status = 'paid' AND o.refunded_at IS NULL
      GROUP BY l.category, l.label ORDER BY l.category, l.label`).bind(date)
  ]);
  const by = (rows, cat) => (rows || []).filter((r) => r.category === cat).reduce((n, r) => n + (r.qty || 0), 0);
  const money = { cash: 0, card: 0, cashSales: 0, cardSales: 0 };
  for (const r of sales.results || []) { money[r.method] = r.pence; money[r.method + 'Sales'] = r.n; }
  const paid = (orders.results || []).filter((r) => r.status === 'paid' && !r.refunded_at);
  const refunded = (orders.results || []).filter((r) => r.status === 'paid' && r.refunded_at);
  money.online = paid.reduce((n, r) => n + r.pence, 0);
  money.onlineOrders = paid.reduce((n, r) => n + r.n, 0);
  money.refunded = refunded.reduce((n, r) => n + r.pence, 0);
  money.door = money.cash + money.card;
  money.total = money.door + money.online;
  const ol = olines.results || [];
  const admitted = (cat) => ol.filter((r) => r.category === cat).reduce((n, r) => n + (r.admitted || 0), 0);
  const people = {
    doorEntry: by(lines.results, 'entry'), doorDevelopment: by(lines.results, 'development'),
    prepaidEntry: by(ol, 'entry'), prepaidDevelopment: by(ol, 'development'),
    admittedEntry: admitted('entry'), admittedDevelopment: admitted('development')
  };
  people.service = people.doorEntry + people.admittedEntry;
  people.circle = people.doorDevelopment + people.admittedDevelopment;
  people.noShowEntry = people.prepaidEntry - people.admittedEntry;
  const raffle = {
    door: by(lines.results, 'raffle'), online: by(ol, 'raffle'),
    onlineGiven: ol.filter((r) => r.category === 'raffle').reduce((n, r) => n + (r.given || 0), 0)
  };
  raffle.total = raffle.door + raffle.online;
  // money by category (door and online), for the night's report
  const cats = {};
  for (const r of lines.results || []) { const c = (cats[r.category] = cats[r.category] || { door: 0, online: 0, doorQty: 0, onlineQty: 0 }); c.door += r.pence; c.doorQty += r.qty; }
  for (const r of ol) { const c = (cats[r.category] = cats[r.category] || { door: 0, online: 0, doorQty: 0, onlineQty: 0 }); c.online += r.pence; c.onlineQty += r.qty; }
  return { date, money, people, raffle, categories: cats, doorLines: lines.results || [], onlineLines: ol };
}
