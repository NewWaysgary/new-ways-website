// Admin > Wednesday door: the till (Gary and Julie, on their phones), checking in advance payments by QR code,
// Close night (cash count), each night's report, the till's buttons and prices, and emergency closures.
// Sales are recorded with the prices from the database at that moment (a later price change never alters a past
// night), each sale once only (the phone's own reference for the sale is unique), and never on a closed night.
import { textResponse, redirect } from '../lib/http.js';
import { ukToday, isIsoDate, longDate, friendlyDateTime } from '../lib/dates.js';
import * as data from '../lib/data.js';
import { csv } from './events.js';
import * as w from '../wednesday/model.js';
import { loadOrder, sendWedConfirmation, sendClosureNotices } from '../wednesday/payments.js';
import { prepaySettings } from '../wednesday/public.js';
import * as view from '../views/admin-door.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const dateFrom = (v) => (isIsoDate(v) ? v : ukToday());
const moneyIn = (v) => {
  const t = String(v ?? '').replace(/[£,\s]/g, '');
  if (t === '') return 0;
  return /^\d{1,6}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
};
const nowIso = () => new Date().toISOString();

async function doorSettings(env) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('pos_app_id', 'pos_handoff')`).all();
  const s = Object.fromEntries((results || []).map((r) => [r.key, r.value]));
  return { posAppId: /^[A-Za-z0-9_-]{6,80}$/.test(s.pos_app_id || '') ? s.pos_app_id : '', posHandoff: s.pos_handoff === '1' };
}

async function recentSales(env, date, limit = 30) {
  const [sales, lines] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM till_sales WHERE night_date = ?1 ORDER BY id DESC LIMIT ?2').bind(date, limit),
    env.DB.prepare(`SELECT l.* FROM till_sale_lines l WHERE l.sale_id IN (SELECT id FROM till_sales WHERE night_date = ?1 ORDER BY id DESC LIMIT ?2) ORDER BY l.id`).bind(date, limit)
  ]);
  const by = {};
  for (const l of lines.results || []) (by[l.sale_id] = by[l.sale_id] || []).push(l);
  return (sales.results || []).map((s) => ({ ...s, lines: by[s.id] || [] }));
}

async function ordersFor(env, date, q = '') {
  const binds = [date];
  let where = 'o.night_date = ?1';
  const text = String(q || '').trim().toLowerCase().slice(0, 80);
  if (text) { binds.push('%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); where += ` AND (lower(o.reference) LIKE ?2 ESCAPE '\\' OR lower(o.email) LIKE ?2 ESCAPE '\\')`; }
  const { results } = await env.DB.prepare(`SELECT o.* FROM wed_orders o WHERE ${where} AND o.status IN ('paid', 'needs_attention') ORDER BY o.paid_at DESC LIMIT 300`).bind(...binds).all();
  const list = results || [];
  if (!list.length) return list;
  const { results: lines } = await env.DB.prepare(`SELECT * FROM wed_order_lines WHERE order_id IN (${list.map((o) => Number(o.id)).join(', ')}) ORDER BY id`).all();
  for (const o of list) o.lines = (lines || []).filter((l) => l.order_id === o.id);
  return list;
}

async function nightsList(env) {
  const { results } = await env.DB.prepare(`SELECT night_date FROM (
      SELECT night_date FROM wed_nights UNION SELECT night_date FROM till_sales UNION SELECT night_date FROM wed_orders WHERE status IN ('paid', 'needs_attention'))
    ORDER BY night_date DESC LIMIT 60`).all();
  const out = [];
  for (const r of results || []) out.push({ ...(await w.night(env, r.night_date)), totals: await w.nightTotals(env, r.night_date) });
  return out;
}

export async function handleDoor({ request, env, url, method, path, form, page, csrf, admin }) {
  if (path !== '/admin/door' && !path.startsWith('/admin/door/')) return null;
  const by = admin.role === 'owner' ? 'Gary' : admin.name;
  const f = form.fields;

  // ---------- the till ----------
  if (path === '/admin/door' && method === 'GET') {
    const date = dateFrom(url.searchParams.get('date'));
    const [n, items, totals, sales, ds] = await Promise.all([w.night(env, date), w.tillItems(env, { enabledOnly: true }), w.nightTotals(env, date), recentSales(env, date), doorSettings(env)]);
    return page(view.tillPage({ date, night: n, items, totals, sales, csrf: csrf.token, flash: url.searchParams.get('flash'), detail: url.searchParams.get('detail') || '', settings: ds, today: ukToday() }));
  }
  if (path === '/admin/door/totals' && method === 'GET') {
    const t = await w.nightTotals(env, dateFrom(url.searchParams.get('date')));
    return json({ service: t.people.service, circle: t.people.circle, raffle: t.raffle.total, door: t.money.door, online: t.money.online, total: t.money.total });
  }
  if (path === '/admin/door/sale' && method === 'POST') {
    const date = dateFrom(f.date);
    const methodPaid = f.method === 'card' ? 'card' : f.method === 'cash' ? 'cash' : '';
    const ref = String(f.client_ref || '');
    if (!methodPaid || !/^[A-Za-z0-9_-]{8,64}$/.test(ref)) return json({ ok: false, error: 'That sale couldn’t be read. Please try again.' }, 400);
    const existing = await env.DB.prepare('SELECT id, total_pence, method FROM till_sales WHERE client_ref = ?1').bind(ref).first();
    if (existing) return json({ ok: true, saleId: existing.id, total: existing.total_pence, repeat: true });   // the same tap arriving twice
    let lines;
    try { lines = JSON.parse(String(f.lines || '[]')); } catch { lines = null; }
    const items = await w.tillItems(env, { enabledOnly: true });
    const basket = w.priceBasket(items, lines);
    if (basket.errors.length) return json({ ok: false, error: basket.errors[0] + ' Please clear the sale and start again.' }, 422);
    if (!basket.lines.length) return json({ ok: false, error: 'There is nothing in this sale.' }, 422);
    if (String(basket.total) !== String(f.expected_total)) return json({ ok: false, error: 'The prices have changed since this screen was opened. Please clear the sale, refresh the page and try again.' }, 409);
    const steps = [w.ensureNight(env, date),
      env.DB.prepare('INSERT INTO till_sales (night_date, method, total_pence, client_ref, created_by) VALUES (?1, ?2, ?3, ?4, ?5)').bind(date, methodPaid, basket.total, ref, by)];
    for (const l of basket.lines) {
      steps.push(env.DB.prepare(`INSERT INTO till_sale_lines (sale_id, item_id, label, category, unit_pence, qty, line_pence) VALUES ((SELECT id FROM till_sales WHERE client_ref = ?1), ?2, ?3, ?4, ?5, ?6, ?7)`)
        .bind(ref, l.item_id, l.label, l.category, l.unit_pence, l.qty, l.line_pence));
    }
    try {
      await env.DB.batch(steps);
    } catch (err) {
      const msg = String(err && err.message);
      if (/TILL_CLOSED/.test(msg)) return json({ ok: false, error: 'This night has been closed (cash counted). Reopen it from Close night to add sales.' }, 409);
      if (/UNIQUE/.test(msg)) { const again = await env.DB.prepare('SELECT id, total_pence FROM till_sales WHERE client_ref = ?1').bind(ref).first(); if (again) return json({ ok: true, saleId: again.id, total: again.total_pence, repeat: true }); }
      throw err;
    }
    const sale = await env.DB.prepare('SELECT id FROM till_sales WHERE client_ref = ?1').bind(ref).first();
    return json({ ok: true, saleId: sale.id, total: basket.total, method: methodPaid, summary: w.summaryText(basket.lines) });
  }
  const vm = path.match(/^\/admin\/door\/sale\/(\d{1,9})\/(void|unvoid)$/);
  if (vm && method === 'POST') {
    const sale = await env.DB.prepare('SELECT * FROM till_sales WHERE id = ?1').bind(Number(vm[1])).first();
    if (!sale) return redirect('/admin/door?flash=gone');
    const n = await w.night(env, sale.night_date);
    if (n.till_closed_at) return redirect(`/admin/door?date=${sale.night_date}&flash=closed`);
    if (vm[2] === 'void') {
      await env.DB.batch([env.DB.prepare('UPDATE till_sales SET voided_at = ?1, voided_by = ?2 WHERE id = ?3 AND voided_at IS NULL').bind(nowIso(), by, sale.id),
        data.audit(env, 'door.void', `Till sale ${sale.id} (${w.pounds(sale.total_pence)} ${sale.method}) cancelled by ${by}`)]);
      return redirect(`/admin/door?date=${sale.night_date}&flash=voided`);
    }
    await env.DB.batch([env.DB.prepare(`UPDATE till_sales SET voided_at = NULL, voided_by = '' WHERE id = ?1`).bind(sale.id),
      data.audit(env, 'door.unvoid', `Till sale ${sale.id} restored by ${by}`)]);
    return redirect(`/admin/door?date=${sale.night_date}&flash=restored`);
  }
  if (path === '/admin/door/square-callback' && method === 'GET') {
    const p = url.searchParams;
    const done = p.get('com.squareup.pos.SERVER_TRANSACTION_ID') || p.get('com.squareup.pos.CLIENT_TRANSACTION_ID');
    const error = p.get('com.squareup.pos.ERROR_CODE');
    return page(view.squareCallbackPage({ done: !!done, error: error ? String(error).slice(0, 80) : '', csrf: csrf.token }));
  }

  // ---------- advance payments at the door (scanned QR code, or search) ----------
  const find = path.match(/^\/admin\/door\/(?:find|w)\/([A-Za-z0-9_-]{0,64})$/);
  if (find && method === 'GET') {
    const o = w.isWedToken(find[1]) ? await env.DB.prepare('SELECT id FROM wed_orders WHERE checkin_token = ?1').bind(find[1]).first() : null;
    if (!o) return page(view.notRecognisedPage({ csrf: csrf.token, token: find[1] }), 404);
    return redirect(`/admin/door/order/${o.id}?scanned=1`);
  }
  if (path === '/admin/door/orders' && method === 'GET') {
    const date = dateFrom(url.searchParams.get('date'));
    const q = url.searchParams.get('q') || '';
    return page(view.ordersPage({ date, orders: await ordersFor(env, date, q), q, csrf: csrf.token, flash: url.searchParams.get('flash'), night: await w.night(env, date) }));
  }
  const om = path.match(/^\/admin\/door\/order\/(\d{1,9})(?:\/(admit|admit-all|unadmit|raffles|raffles-undo|resend|refunded|note))?$/);
  if (om) {
    const o = await loadOrder(env, 'id', Number(om[1]));
    if (!o) return page(view.notRecognisedPage({ csrf: csrf.token }), 404);
    const today = ukToday();
    const self = (flash) => redirect(`/admin/door/order/${o.id}?flash=${flash}`);
    if (!om[2]) {
      if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
      const scanned = url.searchParams.has('scanned');
      if (scanned && !o.first_scanned_at && o.status === 'paid') await env.DB.prepare('UPDATE wed_orders SET first_scanned_at = ?1 WHERE id = ?2 AND first_scanned_at IS NULL').bind(nowIso(), o.id).run();
      return page(view.orderPage({ order: await loadOrder(env, 'id', o.id), today, scanned, csrf: csrf.token, flash: url.searchParams.get('flash'), night: await w.night(env, o.night_date) }));
    }
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const valid = o.status === 'paid' && !o.refunded_at;
    if (['admit', 'admit-all', 'unadmit', 'raffles'].includes(om[2]) && (!valid || o.night_date !== today)) return self(valid ? 'other-night' : 'not-valid');
    if (om[2] === 'admit' || om[2] === 'unadmit') {
      const line = o.lines.find((l) => l.id === Number(f.line_id) && (l.category === 'entry' || l.category === 'development'));
      if (!line) return self('gone');
      const r = om[2] === 'admit'
        ? await env.DB.prepare('UPDATE wed_order_lines SET admitted = admitted + 1 WHERE id = ?1 AND admitted < qty').bind(line.id).run()
        : await env.DB.prepare('UPDATE wed_order_lines SET admitted = admitted - 1 WHERE id = ?1 AND admitted > 0').bind(line.id).run();
      if (om[2] === 'unadmit' && r.meta.changes) await data.audit(env, 'door.unadmit', `${o.reference}: one ${line.label} check-in undone by ${by}`).run();
      return self(r.meta.changes ? (om[2] === 'admit' ? 'admitted' : 'unadmitted') : om[2] === 'admit' ? 'all-in' : 'nothing');
    }
    if (om[2] === 'admit-all') {
      const r = await env.DB.prepare(`UPDATE wed_order_lines SET admitted = qty WHERE order_id = ?1 AND category IN ('entry', 'development') AND admitted < qty`).bind(o.id).run();
      return self(r.meta.changes ? 'admitted-all' : 'all-in');
    }
    if (om[2] === 'raffles') {
      const r = await env.DB.prepare(`UPDATE wed_orders SET raffles_given_at = ?1, raffles_given_by = ?2 WHERE id = ?3 AND raffles_given_at IS NULL`).bind(nowIso(), by, o.id).run();
      return self(r.meta.changes ? 'raffles-given' : 'raffles-already');
    }
    if (om[2] === 'raffles-undo') {
      await env.DB.batch([env.DB.prepare(`UPDATE wed_orders SET raffles_given_at = NULL, raffles_given_by = '' WHERE id = ?1`).bind(o.id),
        data.audit(env, 'door.raffles-undo', `${o.reference}: RAFFLES GIVEN undone by ${by}`)]);
      return self('raffles-undone');
    }
    if (om[2] === 'resend') {
      if (!valid || !o.email) return self('not-valid');
      const st = await sendWedConfirmation(env, o.id, 'customer_confirmation_resend_' + Date.now());
      return self(st === 'sent' ? 'resent' : 'resend-failed');
    }
    if (om[2] === 'refunded') {
      if (o.status !== 'paid') return self('not-valid');
      const undo = f.undo === '1';
      await env.DB.batch([env.DB.prepare('UPDATE wed_orders SET refunded_at = ?1 WHERE id = ?2').bind(undo ? null : nowIso(), o.id),
        data.audit(env, 'door.refunded', `${o.reference} ${undo ? 'no longer marked as refunded' : 'marked as refunded in Square'} by ${by}`)]);
      return self(undo ? 'unrefunded' : 'refunded');
    }
    if (om[2] === 'note') {
      const text = String(f.note || '').trim().slice(0, 500);
      if (text) await env.DB.prepare(`UPDATE wed_orders SET note = trim(note || char(10) || ?1) WHERE id = ?2`).bind(`${friendlyDateTime(nowIso())} (${by}): ${text}`, o.id).run();
      return self('noted');
    }
  }

  // ---------- Close night ----------
  if (path === '/admin/door/close') {
    const date = dateFrom(method === 'POST' ? f.date : url.searchParams.get('date'));
    const n = await w.night(env, date);
    if (method === 'GET') return page(view.closePage({ date, night: n, totals: await w.nightTotals(env, date), csrf: csrf.token, flash: url.searchParams.get('flash') }));
    if (f.action === 'reopen') {
      await env.DB.batch([w.ensureNight(env, date), env.DB.prepare(`UPDATE wed_nights SET till_closed_at = NULL, till_closed_by = '', updated_at = ?1 WHERE night_date = ?2`).bind(nowIso(), date),
        data.audit(env, 'door.reopen', `Till reopened for ${date} by ${by}`)]);
      return redirect(`/admin/door/close?date=${date}&flash=reopened`);
    }
    const floatP = moneyIn(f.float), counted = moneyIn(f.counted);
    const errors = {};
    if (floatP === null) errors.float = 'Enter an amount like 20 or 20.50.';
    if (counted === null || String(f.counted ?? '').trim() === '') errors.counted = 'Enter the cash counted at the end of the night, like 135.50.';
    if (Object.keys(errors).length) return page(view.closePage({ date, night: n, totals: await w.nightTotals(env, date), csrf: csrf.token, errors, values: f }), 422);
    const save = f.action === 'save';   // save the count without closing the till (e.g. a mid-night count)
    await env.DB.batch([w.ensureNight(env, date),
      env.DB.prepare(`UPDATE wed_nights SET float_pence = ?1, counted_cash_pence = ?2, close_note = ?3, ${save ? '' : 'till_closed_at = ?4, till_closed_by = ?5,'} updated_at = ?4 WHERE night_date = ?6`)
        .bind(floatP, counted, String(f.note || '').trim().slice(0, 1000), nowIso(), by, date),
      data.audit(env, save ? 'door.count' : 'door.close', `${save ? 'Cash count saved' : 'Night closed'} for ${date} by ${by}: counted ${w.pounds(counted)}`)]);
    return redirect(save ? `/admin/door/close?date=${date}&flash=saved` : `/admin/door/nights/${date}?flash=closed`);
  }

  // ---------- reports ----------
  if (path === '/admin/door/nights' && method === 'GET') return page(view.nightsPage({ nights: await nightsList(env), csrf: csrf.token }));
  const nm = path.match(/^\/admin\/door\/nights\/(\d{4}-\d{2}-\d{2})(\.csv)?$/);
  if (nm && method === 'GET' && isIsoDate(nm[1])) {
    const date = nm[1];
    const [n, totals, sales, orders] = await Promise.all([w.night(env, date), w.nightTotals(env, date), recentSales(env, date, 1000), ordersFor(env, date)]);
    if (nm[2]) {
      const rows = [['Night', date], [], ['Section', 'Item', 'Quantity', 'Amount (£)']];
      for (const l of totals.doorLines) rows.push(['Door', l.label + (l.category === 'gift' ? ` (${w.pounds(l.unit_pence)})` : ''), l.qty, (l.pence / 100).toFixed(2)]);
      for (const l of totals.onlineLines) rows.push(['Paid in advance', l.label, l.qty, (l.pence / 100).toFixed(2)]);
      rows.push([], ['Money', 'Cash at the door', '', (totals.money.cash / 100).toFixed(2)], ['Money', 'Card at the door', '', (totals.money.card / 100).toFixed(2)],
        ['Money', 'Paid in advance online', totals.money.onlineOrders, (totals.money.online / 100).toFixed(2)], ['Money', 'Total', '', (totals.money.total / 100).toFixed(2)]);
      if (totals.money.refunded) rows.push(['Money', 'Refunded advance payments (not included)', '', (totals.money.refunded / 100).toFixed(2)]);
      rows.push([], ['People', 'Service (door entries + advance payments let in)', totals.people.service, ''], ['People', 'Development Circle', totals.people.circle, ''],
        ['People', 'Paid in advance but not let in (entry)', totals.people.noShowEntry, ''], ['Raffle', 'Strips sold (door + advance)', totals.raffle.total, '']);
      if (n.counted_cash_pence !== null && n.counted_cash_pence !== undefined) {
        const expected = n.float_pence + totals.money.cash;
        rows.push([], ['Cash', 'Float', '', (n.float_pence / 100).toFixed(2)], ['Cash', 'Expected in the tin', '', (expected / 100).toFixed(2)], ['Cash', 'Counted', '', (n.counted_cash_pence / 100).toFixed(2)],
          ['Cash', 'Difference', '', ((n.counted_cash_pence - expected) / 100).toFixed(2)]);
      }
      rows.push([], ['Sales', 'Time', 'Paid by', 'Amount (£)', 'Items', 'Cancelled']);
      for (const s of sales.slice().reverse()) rows.push(['Sale ' + s.id, new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeStyle: 'short' }).format(new Date(s.created_at)), s.method, (s.total_pence / 100).toFixed(2), w.summaryText(s.lines), s.voided_at ? 'Yes' : '']);
      return new Response(csv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="wednesday-${date}.csv"`, 'Cache-Control': 'no-store' } });
    }
    return page(view.nightReportPage({ date, night: n, totals, sales, orders, csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }

  // ---------- the till's buttons and prices, advance payment settings, card handoff ----------
  if (path === '/admin/door/items') {
    if (method === 'GET') {
      const [items, prepay, ds, settings] = await Promise.all([w.tillItems(env), prepaySettings(env), doorSettings(env), data.getSettings(env)]);
      return page(view.itemsPage({ items, prepay, settings: ds, centre: settings, csrf: csrf.token, flash: url.searchParams.get('flash'), detail: url.searchParams.get('detail') || '' }));
    }
    if (f.action === 'settings') {
      const weeks = Math.min(12, Math.max(1, Number(f.wed_prepay_weeks) || 4));
      const cutoff = /^([01]\d|2[0-3]):[0-5]\d$/.test(f.wed_prepay_cutoff || '') ? f.wed_prepay_cutoff : '19:00';
      const appId = String(f.pos_app_id || '').trim();
      if (appId && !/^[A-Za-z0-9_-]{6,80}$/.test(appId)) return redirect('/admin/door/items?flash=bad-app-id');
      const upsert = (k, v) => env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(k, String(v));
      await env.DB.batch([upsert('wed_prepay_open', f.wed_prepay_open === '1' ? '1' : '0'), upsert('wed_prepay_weeks', weeks), upsert('wed_prepay_cutoff', cutoff),
        upsert('pos_app_id', appId), upsert('pos_handoff', f.pos_handoff === '1' && appId ? '1' : '0'), data.audit(env, 'door.settings', `Wednesday settings saved by ${by}`)]);
      return redirect('/admin/door/items?flash=saved');
    }
    // add a button, or save one
    const id = Number(f.id) || 0;
    const label = String(f.label || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const custom = f.custom_amount === '1' ? 1 : 0;
    const price = custom ? 0 : moneyIn(f.price);
    const category = w.CATEGORIES.some(([k]) => k === f.category) ? f.category : '';
    if (!label) return redirect('/admin/door/items?flash=need-label');
    if (!category) return redirect('/admin/door/items?flash=need-category');
    if (!custom && (price === null || price < 1 || price > w.MAX_CUSTOM_PENCE)) return redirect('/admin/door/items?flash=need-price');
    const enabled = f.enabled === '1' ? 1 : 0, online = f.online === '1' && !custom ? 1 : 0;
    if (id) {
      await env.DB.batch([env.DB.prepare(`UPDATE till_items SET label = ?1, price_pence = ?2, custom_amount = ?3, category = ?4, enabled = ?5, online = ?6, updated_at = ?7 WHERE id = ?8`)
        .bind(label, price, custom, category, enabled, online, nowIso(), id), data.audit(env, 'door.item', `Till button saved: ${label} ${custom ? '(amount typed in)' : w.pounds(price)} by ${by}`)]);
      return redirect(`/admin/door/items?flash=saved&detail=${encodeURIComponent(label)}`);
    }
    const next = (await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM till_items').first('n')) || 1;
    await env.DB.batch([env.DB.prepare('INSERT INTO till_items (label, price_pence, custom_amount, category, enabled, online, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(label, price, custom, category, enabled, online, next), data.audit(env, 'door.item', `Till button added: ${label} by ${by}`)]);
    return redirect(`/admin/door/items?flash=added&detail=${encodeURIComponent(label)}`);
  }
  const im = path.match(/^\/admin\/door\/items\/(\d{1,9})\/(up|down)$/);
  if (im && method === 'POST') {
    const items = await w.tillItems(env);
    const i = items.findIndex((x) => x.id === Number(im[1]));
    const j = im[2] === 'up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < items.length) {
      const order = items.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      await env.DB.batch(order.map((rid, k) => env.DB.prepare('UPDATE till_items SET sort_order = ?1 WHERE id = ?2').bind(k + 1, rid)));
    }
    return redirect('/admin/door/items?flash=moved');
  }

  // ---------- emergency closure of a Wednesday ----------
  if (path === '/admin/door/closure') {
    if (method === 'GET') {
      const list = await w.closures(env);
      const upcoming = w.nextWednesdays(8);
      const affected = {};
      for (const c of list) {
        const row = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_pence), 0) AS pence, COUNT(refunded_at) AS refunded FROM wed_orders WHERE night_date = ?1 AND status = 'paid'`).bind(c.night_date).first();
        const sent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM wed_email_log l JOIN wed_orders o ON o.id = l.order_id WHERE o.night_date = ?1 AND l.kind = 'closure_notice' AND l.status = 'sent'`).bind(c.night_date).first('n');
        affected[c.night_date] = { ...row, notified: sent };
      }
      return page(view.closurePage({ closures: list, upcoming, affected, csrf: csrf.token, flash: url.searchParams.get('flash'), detail: url.searchParams.get('detail') || '' }));
    }
    const date = String(f.date || '');
    if (!w.isWednesday(date) || date < ukToday()) return redirect('/admin/door/closure?flash=bad-date');
    if (f.action === 'close') {
      const reason = String(f.reason || '').trim().replace(/\s+/g, ' ').slice(0, 300);
      if (!reason) return redirect(`/admin/door/closure?flash=need-reason`);
      await env.DB.batch([w.ensureNight(env, date),
        env.DB.prepare(`UPDATE wed_nights SET closed_for_public = 1, closure_reason = ?1, closure_set_at = ?2, closure_set_by = ?3, updated_at = ?2 WHERE night_date = ?4`).bind(reason, nowIso(), by, date),
        data.audit(env, 'door.closure', `Wednesday ${date} CLOSED by ${by}: ${reason}`)]);
      return redirect(`/admin/door/closure?flash=closed&detail=${date}`);
    }
    if (f.action === 'open') {
      await env.DB.batch([env.DB.prepare(`UPDATE wed_nights SET closed_for_public = 0, updated_at = ?1 WHERE night_date = ?2`).bind(nowIso(), date),
        data.audit(env, 'door.closure', `Wednesday ${date} reopened by ${by}`)]);
      return redirect(`/admin/door/closure?flash=reopened&detail=${date}`);
    }
    if (f.action === 'notify') {
      const n = await w.night(env, date);
      if (!n.closed_for_public) return redirect('/admin/door/closure?flash=not-closed');
      const message = String(f.message || '').trim().slice(0, 1000) || n.closure_reason;
      const out = await sendClosureNotices(env, date, message);
      await data.audit(env, 'door.closure-emails', `Closure emails for ${date}: ${out.sent} sent, ${out.failed} not sent (by ${by})`).run();
      return redirect(`/admin/door/closure?flash=notified&detail=${encodeURIComponent(`${out.sent} sent${out.already ? `, ${out.already} already told` : ''}${out.failed ? `, ${out.failed} NOT sent` : ''}`)}`);
    }
    return redirect('/admin/door/closure');
  }
  return null;
}
