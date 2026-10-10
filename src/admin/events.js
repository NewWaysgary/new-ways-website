// Admin: event tickets. The event's own page, questions, guest list (and spreadsheet), meal and option totals,
// bookings added by Gary (cash, card, complimentary...), and each booking's details, changes and actions.
// Nothing here refunds money: any refund is Gary's decision, made in Square or in person.
import { textResponse, redirect } from '../lib/http.js';
import * as data from '../lib/data.js';
import { squareMode, squareConfig, deletePaymentLink } from '../payments/square.js';
import { turnstileConfig } from '../lib/turnstile.js';
import * as m from '../events/model.js';
import * as mail from '../events/emails.js';
import { afterConfirmed } from '../events/payments.js';
import { subscribe } from '../mailing.js';
import * as view from '../views/admin-events.js';
import { handleTables } from './tables.js';

const nowIso = () => new Date().toISOString();
const stampNow = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());

// ---------- guest list ----------
const STATUS_FILTER = { booked: `b.status = 'confirmed'`, attention: `b.status = 'needs_attention'`, held: `b.status = 'held'`, cancelled: `b.status IN ('cancelled', 'expired')`, all: '1 = 1' };

export async function guestList(env, eventId, filters) {
  const where = [`b.event_id = ?1`, STATUS_FILTER[filters.status] || STATUS_FILTER.booked];
  const binds = [eventId];
  if (filters.pay === 'unpaid') where.push(`b.payment_status = 'unpaid'`);
  else if (m.PAYMENT_METHODS.some(([k]) => k === filters.pay)) { binds.push(filters.pay); where.push(`b.payment_method = ?${binds.length}`); }
  const [bk, gs, ans] = await env.DB.batch([
    env.DB.prepare(`SELECT b.* FROM event_bookings b WHERE ${where.join(' AND ')} ORDER BY b.purchaser_name COLLATE NOCASE, b.id LIMIT 1000`).bind(...binds),
    env.DB.prepare('SELECT * FROM event_guests WHERE event_id = ?1 ORDER BY booking_id, position').bind(eventId),
    env.DB.prepare(`SELECT a.* FROM event_answers a JOIN event_bookings b ON b.id = a.booking_id LEFT JOIN event_questions q ON q.id = a.question_id
      WHERE b.event_id = ?1 ORDER BY q.sort_order, a.question_id`).bind(eventId)
  ]);
  const guestsBy = {}, answersBy = {};
  for (const a of ans.results || []) (answersBy[a.booking_id + ':' + a.guest_id] = answersBy[a.booking_id + ':' + a.guest_id] || []).push(a);
  for (const g of gs.results || []) (guestsBy[g.booking_id] = guestsBy[g.booking_id] || []).push({ ...g, answers: answersBy[g.booking_id + ':' + g.id] || [] });
  const q = String(filters.q || '').trim().toLowerCase();
  const [aq, av] = String(filters.answer || '').match(/^q(\d+):(.*)$/s)?.slice(1) || [];
  const out = [];
  for (const b of bk.results || []) {
    b.guests = guestsBy[b.id] || [];
    b.answers = answersBy[b.id + ':0'] || [];
    const bookingHit = !q || [b.purchaser_name, b.purchaser_email, b.purchaser_phone, b.reference].some((x) => String(x || '').toLowerCase().includes(q));
    const bookingAnswerHit = aq && b.answers.some((a) => String(a.question_id) === aq && a.value === av);
    b.shown = b.guests.filter((g) => {
      if (q && !bookingHit && !g.name.toLowerCase().includes(q)) return false;
      if (filters.arrived === 'yes' && !g.checked_in_at) return false;
      if (filters.arrived === 'no' && g.checked_in_at) return false;
      if (aq && !bookingAnswerHit && !g.answers.some((a) => String(a.question_id) === aq && a.value === av)) return false;
      return true;
    });
    if (b.shown.length) out.push(b);
  }
  return out;
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // so a spreadsheet never treats a name as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const csvResponse = (body, name) => new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });

async function guestCsv(env, event, filters) {
  const bookings = await guestList(env, event.id, filters);
  const questions = await m.questionsFor(env, event.id, { activeOnly: false });
  const head = ['Reference', 'Booking', 'Payment', 'Paid by', 'Amount', 'Purchaser', 'Email', 'Phone', 'Mailing list', 'Guest', 'Guest name', ...questions.map((q) => q.label), 'Checked in', 'Note'];
  const rows = [head];
  for (const b of bookings) {
    for (const g of b.shown) {
      rows.push([b.reference, b.status, m.PAYMENT_STATUS_LABEL[b.payment_status] || b.payment_status, m.methodLabel(b.payment_method),
        b.payment_status === 'free' ? '0.00' : (b.total_pence / 100).toFixed(2), b.purchaser_name, b.purchaser_email, b.purchaser_phone, b.marketing_opt_in ? 'Yes' : 'No',
        g.position, g.name, ...questions.map((q) => ((q.scope === 'guest' ? g.answers : b.answers).find((a) => a.question_id === q.id) || {}).value || ''),
        g.checked_in_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }).format(new Date(g.checked_in_at)) : '', b.note]);
    }
  }
  return csvResponse(csv(rows), `guest-list-${event.date}-${String(event.name).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}.csv`);
}

// ---------- totals ----------
async function totals(env, event) {
  const questions = (await m.questionsFor(env, event.id, { activeOnly: false })).filter((q) => m.CHOICE_TYPES.includes(q.type) || q.type === 'checkbox');
  const bookings = await guestList(env, event.id, { status: 'booked' });
  return questions.map((q) => {
    const groups = {};
    let missing = 0;
    for (const b of bookings) {
      const units = q.scope === 'guest' ? b.guests.map((g) => ({ name: g.name, a: g.answers.find((x) => x.question_id === q.id) }))
        : [{ name: b.purchaser_name || (b.guests[0] && b.guests[0].name) || b.reference, a: b.answers.find((x) => x.question_id === q.id) }];
      for (const u of units) {
        const value = u.a && u.a.value;
        if (!value) { missing++; continue; }
        (groups[value] = groups[value] || []).push({ name: u.name, reference: b.reference, purchaser: b.purchaser_name });
      }
    }
    const order = q.options.map((o) => o.label);
    const rows = Object.entries(groups).map(([value, people]) => ({ value: q.type === 'checkbox' ? 'Ticked' : value, count: people.length, people }))
      .sort((a, b) => (order.indexOf(a.value) + 1 || 999) - (order.indexOf(b.value) + 1 || 999));
    return { label: q.label, scope: q.scope, rows, missing: q.type === 'checkbox' ? 0 : missing };
  });
}

// ---------- questions ----------
function readQuestion(fields) {
  const values = {
    label: String(fields.label || '').trim().replace(/\s+/g, ' '), help: String(fields.help || '').trim().replace(/\s+/g, ' '),
    type: String(fields.type || ''), scope: fields.scope === 'booking' ? 'booking' : 'guest', required: fields.required === '1' ? 1 : 0,
    options: String(fields.options || '').replace(/\r\n?/g, '\n')
  };
  const errors = {};
  if (!values.label) errors.label = 'Please enter the question.';
  else if (values.label.length > 150) errors.label = 'Please keep this under 150 characters.';
  if (values.help.length > 300) values.help = values.help.slice(0, 300);
  if (!m.QUESTION_TYPES.some(([k]) => k === values.type)) errors.type = 'Please choose a type.';
  const lines = [...new Set(values.options.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean))];
  if (m.CHOICE_TYPES.includes(values.type)) {
    if (lines.length < 2) errors.options = 'Please add at least two options, one per line.';
    else if (lines.length > 30 || lines.some((l) => l.length > 100)) errors.options = 'Please use up to 30 options, each under 100 characters.';
  }
  values.lines = m.CHOICE_TYPES.includes(values.type) ? lines : [];
  return { values, errors };
}

async function saveQuestion(env, eventId, question, values) {
  let qid = question && question.id;
  if (question) {
    await env.DB.prepare('UPDATE event_questions SET label = ?1, help = ?2, type = ?3, scope = ?4, required = ?5 WHERE id = ?6')
      .bind(values.label, values.help, values.type, values.scope, values.required, qid).run();
  } else {
    const next = (await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM event_questions WHERE event_id = ?1').bind(eventId).first('n')) || 1;
    const r = await env.DB.prepare('INSERT INTO event_questions (event_id, label, help, type, scope, required, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(eventId, values.label, values.help, values.type, values.scope, values.required, next).run();
    qid = r.meta.last_row_id;
  }
  // Options: same wording keeps the same option; removed ones stop being offered (answers already given keep them)
  const { results } = await env.DB.prepare('SELECT * FROM event_question_options WHERE question_id = ?1').bind(qid).all();
  const existing = results || [];
  const steps = [];
  values.lines.forEach((label, i) => {
    const found = existing.find((o) => o.label === label);
    if (found) steps.push(env.DB.prepare('UPDATE event_question_options SET active = 1, sort_order = ?1 WHERE id = ?2').bind(i, found.id));
    else steps.push(env.DB.prepare('INSERT INTO event_question_options (question_id, label, sort_order) VALUES (?1, ?2, ?3)').bind(qid, label, i));
  });
  for (const o of existing) if (!values.lines.includes(o.label)) steps.push(env.DB.prepare('UPDATE event_question_options SET active = 0 WHERE id = ?1').bind(o.id));
  if (steps.length) await env.DB.batch(steps);
  return qid;
}

async function answerCounts(env, eventId) {
  const { results } = await env.DB.prepare(`SELECT a.question_id, COUNT(*) AS n FROM event_answers a JOIN event_questions q ON q.id = a.question_id
    WHERE q.event_id = ?1 AND a.value != '' GROUP BY a.question_id`).bind(eventId).all();
  return Object.fromEntries((results || []).map((r) => [r.question_id, r.n]));
}

async function handleQuestions({ env, url, method, path, form, page, csrf, event }) {
  const base = `/admin/events/${event.id}/questions`;
  if (path === base) {
    if (method === 'POST') {
      const from = Number(form.fields.copy_from);
      const src = from && from !== event.id ? await m.questionsFor(env, from, { activeOnly: true }) : [];
      for (const q of src) {
        await saveQuestion(env, event.id, null, { label: q.label, help: q.help, type: q.type, scope: q.scope, required: q.required, lines: q.activeOptions.map((o) => o.label) });
      }
      return redirect(`${base}?flash=copied`);
    }
    const [questions, counts, others] = await Promise.all([m.questionsFor(env, event.id, { activeOnly: false }), answerCounts(env, event.id),
      env.DB.prepare(`SELECT e.id, e.name, e.date, COUNT(q.id) AS n FROM events e JOIN event_questions q ON q.event_id = e.id AND q.active = 1 WHERE e.id != ?1
        GROUP BY e.id ORDER BY e.date DESC LIMIT 30`).bind(event.id).all()]);
    return page(view.questionsPage({ event, questions, answerCounts: counts, others: others.results || [], csrf: csrf.token, flash: url.searchParams.get('flash') }));
  }
  const qm = path.match(/^\/admin\/events\/\d+\/questions\/(new|\d{1,9})(?:\/(toggle|delete|move))?$/);
  if (!qm) return null;
  const question = qm[1] === 'new' ? null : await env.DB.prepare('SELECT * FROM event_questions WHERE id = ?1 AND event_id = ?2').bind(Number(qm[1]), event.id).first();
  if (qm[1] !== 'new' && !question) return null;
  const counts = await answerCounts(env, event.id);
  const answered = question ? !!counts[question.id] : false;
  if (qm[2]) {
    if (method !== 'POST' || !question) return textResponse('Method not allowed', { status: 405 });
    if (qm[2] === 'toggle') await env.DB.prepare('UPDATE event_questions SET active = 1 - active WHERE id = ?1').bind(question.id).run();
    if (qm[2] === 'delete') {
      if (answered) return redirect(`${base}?flash=toggled`);
      await env.DB.batch([env.DB.prepare('DELETE FROM event_question_options WHERE question_id = ?1').bind(question.id),
        env.DB.prepare('DELETE FROM event_answers WHERE question_id = ?1').bind(question.id),
        env.DB.prepare('DELETE FROM event_questions WHERE id = ?1').bind(question.id)]);
      return redirect(`${base}?flash=deleted`);
    }
    if (qm[2] === 'move') {
      const all = await m.questionsFor(env, event.id, { activeOnly: false });
      const ids = all.map((q) => q.id);
      const i = ids.indexOf(question.id), j = form.fields.dir === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < ids.length) {
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await env.DB.batch(ids.map((id, k) => env.DB.prepare('UPDATE event_questions SET sort_order = ?1 WHERE id = ?2').bind(k + 1, id)));
      }
      return redirect(`${base}?flash=moved`);
    }
    return redirect(`${base}?flash=toggled`);
  }
  if (method === 'GET') {
    const full = question ? (await m.questionsFor(env, event.id, { activeOnly: false })).find((q) => q.id === question.id) : null;
    const values = full ? { ...full, options: full.options.filter((o) => o.active).map((o) => o.label).join('\n') } : { type: 'select', scope: 'guest', required: 1, options: '' };
    return page(view.questionEditPage({ event, question, values, csrf: csrf.token, answered }));
  }
  const { values, errors } = readQuestion(form.fields);
  if (answered && values.type !== question.type) errors.type = 'The type can’t be changed because guests have already answered.';
  if (Object.keys(errors).length) return page(view.questionEditPage({ event, question, values, errors, csrf: csrf.token, answered }), 422);
  await saveQuestion(env, event.id, question, values);
  return redirect(`${base}?flash=${question ? 'saved' : 'added'}`);
}

// ---------- adding a booking in Admin ----------
async function addBooking({ env, url, method, form, page, csrf, event, admin, request }) {
  const counts = await m.placeCounts(env, event.id);
  const left = event.capacity > 0 ? Math.max(0, event.capacity - counts.taken) : null;
  const questions = await m.questionsFor(env, event.id);
  if (method === 'GET') {
    const qty = Number(url.searchParams.get('qty'));
    return page(view.addBookingPage({ event, questions, qty: Number.isInteger(qty) && qty >= 1 && qty <= m.MAX_TICKETS ? qty : 0, csrf: csrf.token, left }));
  }
  const f = form.fields;
  const qty = Number(f.qty);
  const again = (state, status = 422) => page(view.addBookingPage({ event, questions, qty, fields: f, csrf: csrf.token, left, ...state }), status);
  const { values, errors } = m.readBookingForm(f, event, questions, { admin: true });
  if (errors.qty) return redirect(`/admin/events/${event.id}/bookings/new`);
  const method2 = m.PAYMENT_METHODS.some(([k]) => k === f.method) ? f.method : 'cash';
  let total = event.price_pence * qty;
  const amount = String(f.amount || '').replace(/[£,\s]/g, '');
  if (amount) {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(amount)) errors.amount = 'Enter an amount like 24 or 24.50, or leave it empty.';
    else total = Math.round(Number(amount) * 100);
  }
  if (Object.keys(errors).length) return again({ errors });
  const free = method2 === 'complimentary' || total === 0;
  const paid = !free && f.paid !== 'unpaid';
  const reference = m.newEventReference();
  const now = nowIso();
  const b = {
    event_id: event.id, reference, source: 'admin', status: 'confirmed', payment_method: method2, payment_status: free ? 'free' : paid ? 'paid' : 'unpaid',
    unit_price_pence: free ? 0 : event.price_pence, total_pence: free ? 0 : total, checkin_token: m.newCheckinToken(), origin: new URL(request.url).origin,
    confirmed_snapshot: m.snapshot(event, values, { unitPence: free ? 0 : event.price_pence, totalPence: free ? 0 : total, at: now }),
    note: String(f.note || '').trim() ? `${stampNow()}: ${String(f.note).trim().slice(0, 1000)}` : '', created_at: now, paid_at: paid ? now : null
  };
  try {
    await env.DB.batch([...m.insertBookingStatements(env, b, values), data.audit(env, 'events.booking', `Booking ${reference} added in Admin for ${event.name} (${qty})`)]);
  } catch (err) {
    if (!/EVENT_FULL/.test(String(err && err.message))) throw err;
    return again({ notice: `There ${left === 1 ? 'is' : 'are'} only ${left} ${left === 1 ? 'place' : 'places'} left. To add this booking, first raise the maximum number of places (Edit event).` }, 409);
  }
  const saved = await env.DB.prepare('SELECT id FROM event_bookings WHERE reference = ?1').bind(reference).first();
  if (values.marketing && values.purchaser.email) {
    await subscribe(env, { email: values.purchaser.email, name: values.purchaser.name, source: `Added in Admin (${reference})`, consent: 'Told New Way’s they would like to join the mailing list.' }).catch(() => {});
  }
  let flash = 'added';
  if (f.send === '1' && values.purchaser.email) {
    const status = await mail.sendConfirmation(env, saved.id).catch(() => 'failed');
    flash = status === 'sent' ? 'added-sent' : 'added-not-sent';
  }
  return redirect(`/admin/events/${event.id}/bookings/${saved.id}?flash=${flash}`);
}

// ---------- changing names or answers (every change is recorded; the original choice is always kept) ----------
async function editBooking({ env, method, form, page, csrf, event, b, admin }) {
  const all = await m.questionsFor(env, event.id, { activeOnly: false });
  const answeredIds = new Set([...b.answers, ...b.guests.flatMap((g) => g.answers)].map((a) => a.question_id));
  const questions = all.filter((q) => q.active || answeredIds.has(q.id)).map((q) => ({ ...q, activeOptions: q.options.filter((o) => o.active || [...b.answers, ...b.guests.flatMap((g) => g.answers)].some((a) => a.option_id === o.id)) }));
  if (method === 'GET') {
    const fields = { p_name: b.purchaser_name, p_email: b.purchaser_email, p_phone: b.purchaser_phone };
    for (const g of b.guests) {
      fields[`g${g.position}_name`] = g.name;
      for (const a of g.answers) fields[`g${g.position}_q${a.question_id}`] = a.option_id ? String(a.option_id) : a.type === 'checkbox' ? (a.value ? '1' : '') : a.value;
    }
    for (const a of b.answers) fields[`b_q${a.question_id}`] = a.option_id ? String(a.option_id) : a.type === 'checkbox' ? (a.value ? '1' : '') : a.value;
    return page(view.bookingEditPage({ event, b, questions, fields, csrf: csrf.token }));
  }
  const f = { ...form.fields, qty: String(b.quantity) };
  const { values, errors } = m.readBookingForm(f, { ...event, max_per_booking: m.MAX_TICKETS }, questions, { admin: true });
  if (Object.keys(errors).length) return page(view.bookingEditPage({ event, b, questions, fields: f, errors, csrf: csrf.token }), 422);
  const who = admin.email || 'Admin';
  const now = nowIso();
  const steps = [];
  const change = (guestId, what, oldV, newV) => steps.push(env.DB.prepare('INSERT INTO event_changes (booking_id, guest_id, what, old_value, new_value, changed_by, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(b.id, guestId, what, oldV || '', newV || '', who, now));
  const answerStep = (guestId, label, a, old) => {
    if ((old ? old.value : '') === a.value) return;
    change(guestId, label, old ? old.value : '', a.value);
    steps.push(env.DB.prepare(`INSERT INTO event_answers (booking_id, guest_id, question_id, question_label, option_id, value, original_value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7)
      ON CONFLICT(booking_id, guest_id, question_id) DO UPDATE SET value = excluded.value, option_id = excluded.option_id, updated_at = excluded.updated_at`)
      .bind(b.id, guestId, a.question_id, a.question_label, a.option_id, a.value, now));
  };
  for (const g of values.guests) {
    const old = b.guests.find((x) => x.position === g.position);
    if (!old) continue;
    if (old.name !== g.name) {
      change(old.id, `Guest ${g.position} name`, old.name, g.name);
      steps.push(env.DB.prepare('UPDATE event_guests SET name = ?1 WHERE id = ?2').bind(g.name, old.id));
    }
    for (const a of g.answers) answerStep(old.id, `Guest ${g.position} (${old.name}): ${a.question_label}`, a, old.answers.find((x) => x.question_id === a.question_id));
  }
  for (const a of values.answers) answerStep(0, a.question_label, a, b.answers.find((x) => x.question_id === a.question_id));
  const p = values.purchaser;
  for (const [col, label, v] of [['purchaser_name', 'Purchaser name', p.name], ['purchaser_email', 'Purchaser email', p.email], ['purchaser_phone', 'Purchaser phone', p.phone]]) {
    if ((b[col] || '') !== (v || '')) { change(0, label, b[col], v); steps.push(env.DB.prepare(`UPDATE event_bookings SET ${col} = ?1 WHERE id = ?2`).bind(v || '', b.id)); }
  }
  if (steps.length) await env.DB.batch(steps);
  return redirect(`/admin/events/${event.id}/bookings/${b.id}?flash=saved`);
}

async function bookingAction({ env, form, event, b, action }) {
  const back = (flash) => redirect(`/admin/events/${event.id}/bookings/${b.id}?flash=${flash}`);
  const addNote = (text) => (b.note ? b.note + '\n\n' : '') + `${stampNow()}: ${text}`;
  switch (action) {
    case 'cancel': {
      if (b.status !== 'confirmed' && b.status !== 'held') return back('');
      await env.DB.batch([
        env.DB.prepare(`UPDATE event_bookings SET status = 'cancelled', cancelled_at = ?1, note = ?2 WHERE id = ?3 AND status IN ('confirmed', 'held')`)
          .bind(nowIso(), addNote('Booking cancelled in Admin. No automatic refund.'), b.id),
        data.audit(env, 'events.cancel', `Event booking ${b.reference} cancelled`)
      ]);
      const cfg = squareConfig(env);
      if (b.status === 'held' && cfg && b.square_payment_link_id) await deletePaymentLink(cfg, b.square_payment_link_id).catch(() => {});
      return back('cancelled');
    }
    case 'paid': {
      const method = m.PAYMENT_METHODS.some(([k]) => k === form.fields.method) && form.fields.method !== 'complimentary' ? form.fields.method : b.payment_method;
      await env.DB.prepare(`UPDATE event_bookings SET payment_status = 'paid', payment_method = ?1, paid_at = ?2, note = ?3 WHERE id = ?4 AND payment_status = 'unpaid'`)
        .bind(method, nowIso(), addNote(`Marked as paid (${m.methodLabel(method)}).`), b.id).run();
      return back('paid');
    }
    case 'send': {
      if (b.status !== 'confirmed' || !b.purchaser_email) return back('');
      const before = await env.DB.prepare(`SELECT status FROM event_email_log WHERE booking_id = ?1 AND kind = 'customer_confirmation'`).bind(b.id).first();
      const kind = before && before.status === 'sent' ? 'resend_' + Date.now() : 'customer_confirmation';
      const status = await mail.sendConfirmation(env, b.id, kind);
      return back(status === 'sent' ? 'sent' : 'send-failed');
    }
    case 'keep': {
      if (b.status !== 'needs_attention') return back('');
      try {
        await env.DB.prepare(`UPDATE event_bookings SET status = 'confirmed', note = ?1 WHERE id = ?2 AND status = 'needs_attention'`).bind(addNote('Confirmed by Gary.'), b.id).run();
      } catch (err) {
        if (/EVENT_FULL/.test(String(err && err.message))) return back('full');
        throw err;
      }
      // Gary has dealt with it himself: no automatic "new booking" email to him afterwards
      await env.DB.prepare(`INSERT OR IGNORE INTO event_email_log (booking_id, kind, status) VALUES (?1, 'admin_notification', 'skipped')`).bind(b.id).run();
      await afterConfirmed(env, b.id, { emailGary: false });
      return back('confirmed');
    }
    case 'resolve': {
      if (b.status !== 'needs_attention') return back('');
      await env.DB.batch([
        env.DB.prepare(`UPDATE event_bookings SET status = 'cancelled', cancelled_at = ?1, note = ?2 WHERE id = ?3`).bind(nowIso(), addNote('Marked as dealt with by Gary.'), b.id),
        env.DB.prepare(`INSERT OR IGNORE INTO event_email_log (booking_id, kind, status) VALUES (?1, 'customer_confirmation', 'skipped')`).bind(b.id)
      ]);
      return back('resolved');
    }
    case 'note': {
      const text = String(form.fields.note || '').trim().slice(0, 1000);
      if (text) await env.DB.prepare('UPDATE event_bookings SET note = ?1 WHERE id = ?2').bind(addNote(text), b.id).run();
      return back('noted');
    }
  }
  return null;
}

// ---------- routing (owner only) ----------
export async function handleEventsAdmin(ctx) {
  const { request, env, url, method, path, page, csrf } = ctx;
  const em = path.match(/^\/admin\/events\/(\d{1,9})\/(manage|questions|guests|guests\.csv|totals|bookings|tables|tables\.csv)(?:\/|$)/);
  if (!em) return null;
  const event = await m.getEvent(env, Number(em[1]));
  if (!event) return null;
  if (em[2] === 'tables' || em[2] === 'tables.csv') return handleTables({ ...ctx, event });
  const mode = squareMode(env);
  const c = { ...ctx, event };

  if (em[2] === 'manage' && path.endsWith('/manage')) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const [counts, checkin, questions] = await Promise.all([m.placeCounts(env, event.id), m.checkinCounts(env, event.id), m.questionsFor(env, event.id)]);
    return page(view.hubPage({ event, counts, checkin, questions, state: m.salesState(event, counts.taken), csrf: csrf.token, mode,
      shareUrl: new URL(request.url).origin + `/events/${event.id}`, ticketsReady: !!(squareConfig(env) && turnstileConfig(request, env)), flash: url.searchParams.get('flash') }));
  }
  if (em[2] === 'questions') return handleQuestions(c);
  const filters = { q: url.searchParams.get('q') || '', status: STATUS_FILTER[url.searchParams.get('status')] ? url.searchParams.get('status') : 'booked',
    pay: url.searchParams.get('pay') || '', arrived: url.searchParams.get('arrived') || '', answer: url.searchParams.get('answer') || '' };
  if (em[2] === 'guests' && path.endsWith('/guests')) {
    const [bookings, questions, counts] = await Promise.all([guestList(env, event.id, filters), m.questionsFor(env, event.id, { activeOnly: false }), m.placeCounts(env, event.id)]);
    return page(view.guestListPage({ event, bookings, filters, questions, counts, csrf: csrf.token }));
  }
  if (em[2] === 'guests.csv' && path.endsWith('/guests.csv')) return guestCsv(env, event, filters);
  if (em[2] === 'totals' && path.endsWith('/totals')) return page(view.totalsPage({ event, totals: await totals(env, event), csrf: csrf.token }));

  if (path === `/admin/events/${event.id}/bookings/new`) return addBooking(c);
  const bm = path.match(/^\/admin\/events\/\d+\/bookings\/(\d{1,9})(?:\/(edit|cancel|paid|send|keep|resolve|note))?$/);
  if (!bm) return null;
  const b = await m.loadBooking(env, 'id', Number(bm[1]));
  if (!b || b.event_id !== event.id) return null;
  if (bm[2] === 'edit') {
    if (b.personal_data_removed_at) return redirect(`/admin/events/${event.id}/bookings/${b.id}`);
    return editBooking({ ...c, b });
  }
  if (bm[2]) {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    return bookingAction({ ...c, b, action: bm[2] });
  }
  if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
  const [changes, emails] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM event_changes WHERE booking_id = ?1 ORDER BY id DESC').bind(b.id),
    env.DB.prepare('SELECT * FROM event_email_log WHERE booking_id = ?1 ORDER BY id').bind(b.id)
  ]);
  return page(view.bookingPage({ event, b, changes: changes.results || [], emails: emails.results || [], csrf: csrf.token, flash: url.searchParams.get('flash'), mode }));
}

// Used by the Events list: an event with bookings is never deleted (its booking records must stay)
export async function eventHasBookings(env, eventId) {
  return !!(await env.DB.prepare('SELECT 1 FROM event_bookings WHERE event_id = ?1 LIMIT 1').bind(eventId).first());
}
