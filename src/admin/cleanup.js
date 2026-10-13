// Admin › Clear test data. Removes ONLY what Gary or Julie choose, after a clear confirmation:
//   * a test event with its test bookings (guests, answers, table places, emails, check-ins);
//   * test private-reading bookings (their appointment times are released);
//   * the visitor and app-install counters (set back to 0).
// Nothing is removed automatically. Before anything is removed, a complete copy of it is saved in cleanup_log (and
// the activity log says who did it), so a mistake can always be put right. Anything that could be REAL money is
// protected: online Square payments can only be removed while the website's payments are in Sandbox (test money),
// and payments recorded as cash, card or "other" need an extra tick saying they are test records.
import { html } from '../lib/html.js';
import { textResponse, redirect } from '../lib/http.js';
import * as data from '../lib/data.js';
import { adminPage } from '../views/admin.js';
import { friendlyDateTime, longDate } from '../lib/dates.js';
import { squareMode } from '../payments/square.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const money = (p) => '£' + (Number(p || 0) / 100).toFixed(2);
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
const FLASH = {
  event: 'The test event and its bookings have been removed. A full copy is kept in the clean-up record.',
  readings: 'The chosen reading bookings have been removed and their times released. A full copy is kept in the clean-up record.',
  counters: 'The visitor and app-install counters are back to 0.',
  'not-confirmed': 'Nothing was removed: please tick the confirmation and type REMOVE.',
  real: 'Nothing was removed: that would remove a real (Production) payment.'
};

// ---------- what an event's removal would take away ----------
async function eventRecords(env, id) {
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?1').bind(id).first();
  if (!event) return null;
  const bookings = await all(env, 'SELECT * FROM event_bookings WHERE event_id = ?1 ORDER BY id', id);
  const ids = bookings.map((b) => Number(b.id));
  const inB = ids.length ? `(${ids.join(',')})` : '(0)';
  const questions = await all(env, 'SELECT * FROM event_questions WHERE event_id = ?1', id);
  const qIds = questions.map((q) => Number(q.id));
  return {
    event, bookings,
    event_guests: await all(env, `SELECT * FROM event_guests WHERE booking_id IN ${inB} OR event_id = ?1`, id),
    event_answers: await all(env, `SELECT * FROM event_answers WHERE booking_id IN ${inB}`),
    event_changes: await all(env, `SELECT * FROM event_changes WHERE booking_id IN ${inB}`),
    event_email_log: await all(env, `SELECT * FROM event_email_log WHERE booking_id IN ${inB}`),
    event_tables: await all(env, 'SELECT * FROM event_tables WHERE event_id = ?1', id),
    event_table_guests: await all(env, 'SELECT * FROM event_table_guests WHERE event_id = ?1', id),
    event_medium_guests: await all(env, 'SELECT * FROM event_medium_guests WHERE event_id = ?1', id),
    event_questions: questions,
    event_question_options: qIds.length ? await all(env, `SELECT * FROM event_question_options WHERE question_id IN (${qIds.join(',')})`) : []
  };
}

// Could removing these bookings remove real money?
export function moneyCheck(env, bookings) {
  const sandbox = squareMode(env) === 'sandbox';
  const realOnline = bookings.filter((b) => b.payment_method === 'square_online' && b.square_payment_id && !sandbox);
  const recordedPaid = bookings.filter((b) => b.payment_status === 'paid' && b.payment_method !== 'square_online');
  return { realOnline, recordedPaid };
}

function homePage({ events, readings, counters, logs, csrf, flash, sandbox }) {
  return adminPage({
    title: 'Clear test data', csrf, signedIn: true,
    body: html`${FLASH[flash] ? html`<p class="banner ${['not-confirmed', 'real'].includes(flash) ? 'banner-error' : 'banner-ok'}" role="status">${FLASH[flash]}</p>` : ''}
<p class="hint">For removing test records before launch. Nothing is removed until you choose it and confirm. A complete copy of everything removed is kept (see the record at the bottom). Real upcoming events, guest mediums and bookings are not touched.${sandbox ? '' : html` <strong>The website now takes REAL payments: online payments can’t be removed here.</strong>`}</p>
<section class="panel" aria-labelledby="c-ev"><h2 id="c-ev">Events that have bookings</h2>
${events.length ? html`<ul class="rows">${events.map((e) => html`<li class="row-card"><div class="row-text"><span class="row-title">${e.name}</span>
<span class="row-line">${longDate(e.date)} · ${e.places} ${e.places === 1 ? 'place' : 'places'} booked in ${e.n} ${e.n === 1 ? 'booking' : 'bookings'}</span></div>
<div class="row-actions"><a class="pill" href="/admin/cleanup/event/${e.id}">Review removing it</a></div></li>`)}</ul>` : html`<p class="hint">No events have bookings.</p>`}
</section>
<section class="panel" aria-labelledby="c-rd"><h2 id="c-rd">Private reading bookings</h2>
${readings.length ? html`<form method="post" action="/admin/cleanup/readings" class="admin-form">${hidden(csrf)}
<p class="hint">Tick only TEST bookings. Their appointment times are released for real customers.</p>
<ul class="rows">${readings.map((r) => html`<li class="row-card"><label class="field-check"><input type="checkbox" name="r${r.order_id}" value="1">
<span><strong>${r.reference}</strong> · ${longDate(r.date)} ${r.local_start} · ${r.service_name} · ${r.customer_name || 'Details removed'} · ${money(r.amount_pence)} · ${r.status}${r.paid_at ? ' · paid ' + friendlyDateTime(r.paid_at) : ''}</span></label></li>`)}</ul>
<div class="field"><label class="field-check"><input type="checkbox" name="confirm" value="1"> I confirm the ticked bookings are test bookings</label></div>
<div class="field"><label for="c-r-word">Type REMOVE to confirm</label><input id="c-r-word" name="word" type="text" autocomplete="off"></div>
<button class="pill pill-danger" type="submit">Remove the ticked test bookings</button></form>` : html`<p class="hint">There are no private reading bookings.</p>`}
</section>
<section class="panel" aria-labelledby="c-ct"><h2 id="c-ct">Visitor and app-install counters</h2>
<p>Visitors: <strong>${counters.unique_visitors ?? 0}</strong> · App installs: <strong>${counters.app_installs ?? 0}</strong></p>
<form method="post" action="/admin/cleanup/counters" class="admin-form">${hidden(csrf)}
<div class="field"><label class="field-check"><input type="checkbox" name="confirm" value="1"> Set both counters back to 0 (for example, just before launch)</label></div>
<div class="field"><label for="c-c-word">Type REMOVE to confirm</label><input id="c-c-word" name="word" type="text" autocomplete="off"></div>
<button class="pill pill-danger" type="submit">Reset the counters</button></form></section>
<section class="panel" aria-labelledby="c-log"><h2 id="c-log">Clean-up record</h2>
${logs.length ? html`<ul class="todo">${logs.map((l) => html`<li>${friendlyDateTime(l.created_at)}: ${l.summary} (by ${l.done_by})</li>`)}</ul>` : html`<p class="hint">Nothing has been removed yet.</p>`}</section>`
  });
}

function eventPage({ rec, check, csrf, flash }) {
  const { event, bookings } = rec;
  const places = bookings.filter((b) => ['held', 'confirmed'].includes(b.status)).reduce((n, b) => n + b.quantity, 0);
  const blocked = check.realOnline.length > 0;
  return adminPage({
    title: 'Remove a test event', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/cleanup">Back to Clear test data</a></p>
${FLASH[flash] ? html`<p class="banner banner-error" role="alert">${FLASH[flash]}</p>` : ''}
<section class="panel"><h2>${event.name}</h2><p>${longDate(event.date)}${event.time_text ? ` · ${event.time_text}` : ''} · ${places} of ${event.capacity || (event.sales_mode === 'online' ? 0 : 'unlimited')} places booked · ${bookings.length} ${bookings.length === 1 ? 'booking' : 'bookings'}</p>
<p class="hint">Removing it takes away the event, all of these bookings, their guests, answers, table places, emails and check-ins. The poster image is kept. A complete copy is saved first.</p></section>
<section class="panel"><h2>The bookings</h2><ul class="todo">${bookings.map((b) => html`<li>${b.reference}: ${b.purchaser_name || 'no name'}${b.purchaser_email ? ` (${b.purchaser_email})` : ''} · ${b.quantity} × · ${money(b.total_pence)} · ${b.payment_method.replace('_', ' ')} · ${b.payment_status} · ${b.status}</li>`)}</ul></section>
${blocked ? html`<p class="banner banner-error" role="alert">This event has ${check.realOnline.length} REAL online ${check.realOnline.length === 1 ? 'payment' : 'payments'} (the website now takes real payments), so it can’t be removed here.</p>`
    : html`<form method="post" action="/admin/cleanup/event/${event.id}" class="panel admin-form">${hidden(csrf)}
${check.recordedPaid.length ? html`<p class="banner banner-error" role="alert">${check.recordedPaid.length} ${check.recordedPaid.length === 1 ? 'booking is' : 'bookings are'} recorded as PAID by cash, card or another way. Only continue if ${check.recordedPaid.length === 1 ? 'it is a test record' : 'they are test records'} (no real money).</p>
<div class="field"><label class="field-check"><input type="checkbox" name="paid_ok" value="1"> The bookings recorded as paid are test records, not real money</label></div>` : ''}
<div class="field"><label class="field-check"><input type="checkbox" name="confirm" value="1"> I confirm “${event.name}” is a TEST event and all ${bookings.length} bookings are test bookings</label></div>
<div class="field"><label for="c-e-word">Type REMOVE to confirm</label><input id="c-e-word" name="word" type="text" autocomplete="off"></div>
<button class="pill pill-danger" type="submit">Remove this test event and its bookings</button></form>`}`
  });
}

async function saveCopy(env, action, summary, snapshot, by) {
  return env.DB.prepare('INSERT INTO cleanup_log (action, summary, snapshot_json, done_by) VALUES (?1, ?2, ?3, ?4)').bind(action, summary, JSON.stringify(snapshot), by);
}

export async function handleCleanupAdmin({ env, url, method, path, form, page, csrf, admin }) {
  if (path !== '/admin/cleanup' && !path.startsWith('/admin/cleanup/')) return null;
  const by = admin.role === 'owner' ? 'Gary' : admin.name || admin.email;
  const f = form.fields;
  const confirmed = f.confirm === '1' && String(f.word || '').trim().toUpperCase() === 'REMOVE';
  const sandbox = squareMode(env) === 'sandbox';

  if (path === '/admin/cleanup') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const [events, readings, counters, logs] = await Promise.all([
      all(env, `SELECT e.id, e.name, e.date, COUNT(b.id) AS n, COALESCE(SUM(CASE WHEN b.status IN ('held', 'confirmed') THEN b.quantity ELSE 0 END), 0) AS places
        FROM events e JOIN event_bookings b ON b.event_id = e.id GROUP BY e.id ORDER BY e.date`),
      all(env, `SELECT o.id AS order_id, o.reference, o.customer_name, o.amount_pence, o.status, o.paid_at, b.date, b.local_start, b.service_name
        FROM orders o JOIN bookings b ON b.order_id = o.id WHERE o.kind = 'PRIVATE_READING' ORDER BY b.date, b.local_start LIMIT 200`),
      all(env, 'SELECT key, value FROM app_metrics'),
      all(env, 'SELECT action, summary, done_by, created_at FROM cleanup_log ORDER BY id DESC LIMIT 50')
    ]);
    return page(homePage({ events, readings, counters: Object.fromEntries(counters.map((c) => [c.key, c.value])), logs, csrf: csrf.token, flash: url.searchParams.get('flash'), sandbox }));
  }

  const ev = path.match(/^\/admin\/cleanup\/event\/(\d{1,9})$/);
  if (ev) {
    const rec = await eventRecords(env, Number(ev[1]));
    if (!rec) return redirect('/admin/cleanup');
    const check = moneyCheck(env, rec.bookings);
    if (method === 'GET') return page(eventPage({ rec, check, csrf: csrf.token, flash: url.searchParams.get('flash') }));
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    if (check.realOnline.length) return redirect('/admin/cleanup?flash=real');
    if (!confirmed || (check.recordedPaid.length && f.paid_ok !== '1')) return redirect(`/admin/cleanup/event/${rec.event.id}?flash=not-confirmed`);
    const id = rec.event.id;
    const ids = rec.bookings.map((b) => Number(b.id));
    const inB = ids.length ? `(${ids.join(',')})` : '(0)';
    const qIds = rec.event_questions.map((q) => Number(q.id));
    const summary = `Test event “${rec.event.name}” (${rec.event.date}) removed with ${ids.length} ${ids.length === 1 ? 'booking' : 'bookings'}`;
    await env.DB.batch([
      await saveCopy(env, 'event', summary, rec, by),
      env.DB.prepare(`DELETE FROM event_table_guests WHERE event_id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM event_medium_guests WHERE event_id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM event_tables WHERE event_id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM event_answers WHERE booking_id IN ${inB}`),
      env.DB.prepare(`DELETE FROM event_changes WHERE booking_id IN ${inB}`),
      env.DB.prepare(`DELETE FROM event_email_log WHERE booking_id IN ${inB}`),
      env.DB.prepare(`DELETE FROM event_guests WHERE booking_id IN ${inB} OR event_id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM event_bookings WHERE event_id = ?1`).bind(id),
      ...(qIds.length ? [env.DB.prepare(`DELETE FROM event_question_options WHERE question_id IN (${qIds.join(',')})`)] : []),
      env.DB.prepare(`DELETE FROM event_questions WHERE event_id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM events WHERE id = ?1`).bind(id),
      data.audit(env, 'cleanup.event', `${summary} by ${by} (a full copy is in the clean-up record)`)
    ]);
    return redirect('/admin/cleanup?flash=event');
  }

  if (path === '/admin/cleanup/readings' && method === 'POST') {
    const chosen = Object.keys(f).filter((k) => /^r\d{1,9}$/.test(k) && f[k] === '1').map((k) => Number(k.slice(1)));
    if (!confirmed || !chosen.length) return redirect('/admin/cleanup?flash=not-confirmed');
    const list = `(${chosen.join(',')})`;
    const orders = await all(env, `SELECT * FROM orders WHERE id IN ${list} AND kind = 'PRIVATE_READING'`);
    if (!sandbox && orders.some((o) => o.square_payment_id)) return redirect('/admin/cleanup?flash=real');
    const ids = orders.map((o) => Number(o.id));
    if (!ids.length) return redirect('/admin/cleanup');
    const inO = `(${ids.join(',')})`;
    const bookings = await all(env, `SELECT * FROM bookings WHERE order_id IN ${inO}`);
    const inBk = bookings.length ? `(${bookings.map((b) => Number(b.id)).join(',')})` : '(0)';
    const snapshot = { orders, bookings, booking_slots: await all(env, `SELECT * FROM booking_slots WHERE booking_id IN ${inBk}`), email_log: await all(env, `SELECT * FROM email_log WHERE order_id IN ${inO}`) };
    const summary = `${ids.length} test private reading ${ids.length === 1 ? 'booking' : 'bookings'} removed (${orders.map((o) => o.reference).join(', ')}); times released`;
    await env.DB.batch([
      await saveCopy(env, 'readings', summary, snapshot, by),
      env.DB.prepare(`DELETE FROM booking_slots WHERE booking_id IN ${inBk}`),
      env.DB.prepare(`DELETE FROM bookings WHERE order_id IN ${inO}`),
      env.DB.prepare(`DELETE FROM email_log WHERE order_id IN ${inO}`),
      env.DB.prepare(`UPDATE square_events SET order_id = NULL WHERE order_id IN ${inO}`),
      env.DB.prepare(`DELETE FROM orders WHERE id IN ${inO} AND kind = 'PRIVATE_READING'`),
      data.audit(env, 'cleanup.readings', `${summary} by ${by}`)
    ]);
    return redirect('/admin/cleanup?flash=readings');
  }

  if (path === '/admin/cleanup/counters' && method === 'POST') {
    if (!confirmed) return redirect('/admin/cleanup?flash=not-confirmed');
    const before = await all(env, 'SELECT key, value FROM app_metrics');
    const summary = `Visitor and app-install counters reset (were ${before.map((c) => `${c.key.replace('_', ' ')} ${c.value}`).join(', ')})`;
    await env.DB.batch([await saveCopy(env, 'counters', summary, before, by), env.DB.prepare('UPDATE app_metrics SET value = 0'), data.audit(env, 'cleanup.counters', `${summary} by ${by}`)]);
    return redirect('/admin/cleanup?flash=counters');
  }
  return null;
}

