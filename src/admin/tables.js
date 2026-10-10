// Admin > Events > an event > Table plan.
// Round tables with a number of seats (for example nine tables of eight). Gary puts whole bookings, or single guests,
// at a table by choosing them from a drop-down ON that table: no seat numbers. Rules (checked here AND by the database):
//   * a guest can only be at one table (seated guests disappear from every drop-down),
//   * a table can never have more people than seats,
//   * putting part of a booking at a different table is allowed, but clearly warned about.
// An optional, separate Mediums' table holds the evening's mediums with their food choices. They are counted in the
// catering totals, never in the paid places. The plan prints (or saves as a PDF) one table per page, then the totals.
import { textResponse, redirect } from '../lib/http.js';
import * as data from '../lib/data.js';
import * as m from '../events/model.js';
import { guestList, csv } from './events.js';
import * as view from '../views/admin-tables.js';

const MAX_TABLES = 40;

// Everything the planner, the printout and the spreadsheet need, worked out once
export async function loadPlan(env, event) {
  const [tablesRes, seatedRes, mediumsRes] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM event_tables WHERE event_id = ?1 ORDER BY is_mediums, sort_order, id').bind(event.id),
    env.DB.prepare('SELECT guest_id, table_id FROM event_table_guests WHERE event_id = ?1').bind(event.id),
    env.DB.prepare('SELECT * FROM event_medium_guests WHERE event_id = ?1 ORDER BY id').bind(event.id)
  ]);
  const questions = (await m.questionsFor(env, event.id, { activeOnly: false })).filter((q) => q.scope === 'guest' && (m.CHOICE_TYPES.includes(q.type) || q.type === 'checkbox'));
  const bookings = await guestList(env, event.id, { status: 'booked' });
  const seatOf = new Map((seatedRes.results || []).map((r) => [r.guest_id, r.table_id]));
  const tables = (tablesRes.results || []).map((t) => ({ ...t, guests: [], mediums: [] }));
  const byId = new Map(tables.map((t) => [t.id, t]));
  const choice = (answers, q) => {
    const a = answers.find((x) => x.question_id === q.id);
    return a && a.value ? (q.type === 'checkbox' ? 'Yes' : a.value) : '';
  };
  const guests = [];
  for (const b of bookings) {
    for (const g of b.guests) {
      const guest = { id: g.id, name: g.name, position: g.position, bookingId: b.id, reference: b.reference, purchaser: b.purchaser_name, groupSize: b.guests.length,
        choices: questions.map((q) => choice(g.answers, q)), tableId: seatOf.get(g.id) || null };
      if (guest.tableId && !byId.has(guest.tableId)) guest.tableId = null;
      guests.push(guest);
      if (guest.tableId) byId.get(guest.tableId).guests.push(guest);
    }
  }
  for (const md of mediumsRes.results || []) {
    let answers = {};
    try { answers = JSON.parse(md.answers_json || '{}'); } catch { answers = {}; }
    const medium = { id: md.id, name: md.name, note: md.note, tableId: md.table_id, answers,
      choices: questions.map((q) => { const o = q.options.find((x) => String(x.id) === String(answers[q.id])); return o ? o.label : (q.type === 'checkbox' && answers[q.id] === '1' ? 'Yes' : ''); }) };
    const t = byId.get(md.table_id);
    if (t) t.mediums.push(medium);
  }
  // Bookings whose guests are not all at the same table (seated at two tables, or only partly seated)
  const groups = new Map();
  for (const g of guests) {
    if (!groups.has(g.bookingId)) groups.set(g.bookingId, { bookingId: g.bookingId, reference: g.reference, purchaser: g.purchaser, guests: [] });
    groups.get(g.bookingId).guests.push(g);
  }
  const splits = [];
  for (const grp of groups.values()) {
    const tablesUsed = [...new Set(grp.guests.map((g) => g.tableId).filter(Boolean))];
    const unseated = grp.guests.filter((g) => !g.tableId).length;
    if (grp.guests.length > 1 && (tablesUsed.length > 1 || (tablesUsed.length === 1 && unseated))) {
      splits.push({ ...grp, tables: tablesUsed.map((id) => byId.get(id).name), unseated });
    }
  }
  const splitIds = new Set(splits.map((s) => s.bookingId));
  for (const t of tables) {
    t.used = t.guests.length + t.mediums.length;
    t.free = t.seats - t.used;
    t.totals = totalsFor(questions, [...t.guests, ...t.mediums]);
  }
  const unseated = guests.filter((g) => !g.tableId);
  const allMediums = tables.flatMap((t) => t.mediums);
  return {
    event, questions, tables, guests, unseated, groups: [...groups.values()], splits, splitIds, mediumsTable: tables.find((t) => t.is_mediums) || null,
    totals: totalsFor(questions, [...guests, ...allMediums]),
    guestTotals: totalsFor(questions, guests), mediumTotals: totalsFor(questions, allMediums),
    counts: { guests: guests.length, seated: guests.length - unseated.length, unseated: unseated.length, mediums: allMediums.length,
      seats: tables.filter((t) => !t.is_mediums).reduce((n, t) => n + t.seats, 0) }
  };
}

// For each question: how many chose each option (in the order the options are listed), and how many haven't chosen
function totalsFor(questions, people) {
  return questions.map((q, i) => {
    const counts = new Map();
    let missing = 0;
    for (const p of people) {
      const v = p.choices[i];
      if (!v) { if (q.type !== 'checkbox') missing++; continue; }
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const order = q.options.map((o) => o.label);
    const rows = [...counts.entries()].map(([value, count]) => ({ value, count }))
      .sort((a, b) => (order.indexOf(a.value) + 1 || 999) - (order.indexOf(b.value) + 1 || 999));
    return { label: q.label, rows, missing };
  });
}

const intIn = (v, min, max) => (/^\d{1,3}$/.test(String(v || '').trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
const cleanName = (v, max = 60) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);

export async function handleTables({ env, url, method, path, form, page, csrf, event, admin }) {
  const base = `/admin/events/${event.id}/tables`;
  if (!path.startsWith(base)) return null;
  const rest = path.slice(base.length);
  const back = (flash, extra = '') => redirect(`${base}?flash=${encodeURIComponent(flash)}${extra}`);
  const who = admin && admin.name ? admin.name : 'Admin';

  if (rest === '' && method === 'GET') {
    const plan = await loadPlan(env, event);
    return page(view.plannerPage({ plan, csrf: csrf.token, flash: url.searchParams.get('flash'), detail: url.searchParams.get('detail') || '' }));
  }
  if (rest === '/print' && method === 'GET') {
    const plan = await loadPlan(env, event);
    const settings = await data.getSettings(env);
    return new Response(String(view.printPage({ plan, centre: settings.centre_name })), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (rest === '.csv' && method === 'GET') {
    const plan = await loadPlan(env, event);
    const rows = [['Table', 'Guest', 'Booking', 'Booked by', ...plan.questions.map((q) => q.label)]];
    for (const t of plan.tables) {
      for (const g of t.guests) rows.push([t.name, g.name, g.reference, g.purchaser, ...g.choices]);
      for (const md of t.mediums) rows.push([t.name, md.name, 'Medium', '', ...md.choices]);
    }
    for (const g of plan.unseated) rows.push(['Not seated yet', g.name, g.reference, g.purchaser, ...g.choices]);
    return new Response(csv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="table-plan-${event.date}-${String(event.name).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}.csv"` } });
  }
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  const f = form.fields;

  // ----- set up the tables: "9 tables of 8". Only adds tables; never removes a table with people at it -----
  if (rest === '/setup') {
    const count = intIn(f.count, 1, MAX_TABLES), seats = intIn(f.seats, 1, 40);
    if (!count || !seats) return back('setup-invalid');
    const { results } = await env.DB.prepare('SELECT * FROM event_tables WHERE event_id = ?1 AND is_mediums = 0 ORDER BY sort_order, id').bind(event.id).all();
    const existing = results || [];
    const steps = [];
    for (let i = existing.length; i < count; i++) {
      steps.push(env.DB.prepare('INSERT INTO event_tables (event_id, name, seats, sort_order) VALUES (?1, ?2, ?3, ?4)').bind(event.id, `Table ${i + 1}`, seats, i + 1));
    }
    if (f.apply_seats === '1') {
      const plan = await loadPlan(env, event);
      const tooFull = plan.tables.filter((t) => !t.is_mediums && t.used > seats);
      if (tooFull.length) return back('seats-too-few', `&detail=${encodeURIComponent(tooFull.map((t) => t.name).join(', '))}`);
      steps.push(env.DB.prepare('UPDATE event_tables SET seats = ?1 WHERE event_id = ?2 AND is_mediums = 0').bind(seats, event.id));
    }
    if (!steps.length) return back('nothing');
    steps.push(data.audit(env, 'tables.setup', `Table plan for ${event.name}: ${count} tables of ${seats} (by ${who})`));
    await env.DB.batch(steps);
    return back('set-up');
  }

  // ----- the separate Mediums' table -----
  if (rest === '/mediums-table') {
    const plan = await loadPlan(env, event);
    if (plan.mediumsTable) return back('nothing');
    const seats = intIn(f.seats, 1, 40) || 8;
    await env.DB.batch([env.DB.prepare(`INSERT INTO event_tables (event_id, name, seats, is_mediums, sort_order) VALUES (?1, 'Mediums’ table', ?2, 1, 0)`).bind(event.id, seats),
      data.audit(env, 'tables.mediums', `Mediums’ table added for ${event.name} (by ${who})`)]);
    return back('mediums-added');
  }

  const tm = rest.match(/^\/(\d{1,9})\/(assign|edit|remove|medium)$/);
  if (tm) {
    const table = await env.DB.prepare('SELECT * FROM event_tables WHERE id = ?1 AND event_id = ?2').bind(Number(tm[1]), event.id).first();
    if (!table) return back('gone');
    const plan = await loadPlan(env, event);
    const t = plan.tables.find((x) => x.id === table.id);

    if (tm[2] === 'edit') {
      const name = cleanName(f.name) || table.name;
      const seats = intIn(f.seats, 1, 40);
      if (!seats) return back('seats-invalid');
      if (seats < t.used) return back('seats-too-few', `&detail=${encodeURIComponent(table.name)}`);
      await env.DB.prepare('UPDATE event_tables SET name = ?1, seats = ?2 WHERE id = ?3').bind(name, seats, table.id).run();
      return back('saved');
    }
    if (tm[2] === 'remove') {
      if (t.used) return back('not-empty', `&detail=${encodeURIComponent(table.name)}`);
      await env.DB.batch([env.DB.prepare('DELETE FROM event_tables WHERE id = ?1').bind(table.id), data.audit(env, 'tables.remove', `${table.name} removed from ${event.name}`)]);
      return back('removed');
    }
    if (tm[2] === 'medium') {
      if (!table.is_mediums) return back('gone');
      const name = cleanName(f.name, 80);
      if (!name) return back('medium-name');
      if (t.free < 1) return back('full', `&detail=${encodeURIComponent(table.name)}`);
      const answers = {};
      for (const q of plan.questions) {
        const v = String(f['q' + q.id] || '');
        if (q.type === 'checkbox') { if (v === '1') answers[q.id] = '1'; }
        else if (q.activeOptions.some((o) => String(o.id) === v)) answers[q.id] = v;
      }
      try {
        await env.DB.prepare('INSERT INTO event_medium_guests (event_id, table_id, name, answers_json, note) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(event.id, table.id, name, JSON.stringify(answers), cleanName(f.note, 200)).run();
      } catch (err) {
        if (/TABLE_FULL/.test(String(err && err.message))) return back('full', `&detail=${encodeURIComponent(table.name)}`);
        throw err;
      }
      return back('medium-added');
    }
    // assign: a whole booking ("b:ID": everyone in it not yet seated) or one guest ("g:ID")
    const choice = String(f.who || '');
    const bm = choice.match(/^b:(\d{1,9})$/), gm = choice.match(/^g:(\d{1,9})$/);
    if (table.is_mediums) return back('mediums-only');
    let people = [];
    if (bm) people = plan.guests.filter((g) => g.bookingId === Number(bm[1]) && !g.tableId);
    else if (gm) people = plan.guests.filter((g) => g.id === Number(gm[1]) && !g.tableId);
    if (!people.length) return back('already');
    if (people.length > t.free) return back('too-many', `&detail=${encodeURIComponent(`${people.length} people, ${t.free} ${t.free === 1 ? 'seat' : 'seats'} free at ${table.name}`)}`);
    try {
      await env.DB.batch(people.map((g) => env.DB.prepare('INSERT INTO event_table_guests (guest_id, event_id, table_id) VALUES (?1, ?2, ?3)').bind(g.id, event.id, table.id)));
    } catch (err) {
      const msg = String(err && err.message);
      if (/TABLE_FULL/.test(msg)) return back('full', `&detail=${encodeURIComponent(table.name)}`);
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(msg)) return back('already');
      throw err;
    }
    const group = plan.guests.filter((g) => g.bookingId === people[0].bookingId);
    const split = group.length > 1 && group.some((g) => g.tableId && g.tableId !== table.id || (!g.tableId && !people.includes(g)));
    return back(split ? 'seated-split' : 'seated', `&detail=${encodeURIComponent(people.length === 1 ? people[0].name : `${people.length} guests (${people[0].reference})`)}`);
  }

  // ----- move or unseat one guest, or move a whole booking -----
  const gm = rest.match(/^\/guest\/(\d{1,9})\/(move|unseat)$/);
  if (gm) {
    const guestId = Number(gm[1]);
    const seated = await env.DB.prepare('SELECT * FROM event_table_guests WHERE guest_id = ?1 AND event_id = ?2').bind(guestId, event.id).first();
    if (!seated) return back('gone');
    if (gm[2] === 'unseat') {
      await env.DB.prepare('DELETE FROM event_table_guests WHERE guest_id = ?1').bind(guestId).run();
      return back('unseated');
    }
    const plan = await loadPlan(env, event);
    const target = plan.tables.find((x) => x.id === Number(f.table_id) && !x.is_mediums);
    if (!target || target.id === seated.table_id) return back('nothing');
    const guest = plan.guests.find((g) => g.id === guestId);
    // "Move the whole booking" moves every seated guest of the booking who sits with this guest
    const movers = f.whole === '1' ? plan.guests.filter((g) => g.bookingId === guest.bookingId && g.tableId === seated.table_id) : [guest];
    if (movers.length > target.free) return back('too-many', `&detail=${encodeURIComponent(`${movers.length} people, ${target.free} ${target.free === 1 ? 'seat' : 'seats'} free at ${target.name}`)}`);
    try {
      await env.DB.batch(movers.map((g) => env.DB.prepare('UPDATE event_table_guests SET table_id = ?1, assigned_at = ?2 WHERE guest_id = ?3').bind(target.id, new Date().toISOString(), g.id)));
    } catch (err) {
      if (/TABLE_FULL/.test(String(err && err.message))) return back('full', `&detail=${encodeURIComponent(target.name)}`);
      throw err;
    }
    return back('moved', `&detail=${encodeURIComponent(`${movers.length === 1 ? guest.name : movers.length + ' guests'} to ${target.name}`)}`);
  }

  const mm = rest.match(/^\/medium\/(\d{1,9})\/remove$/);
  if (mm) {
    await env.DB.prepare('DELETE FROM event_medium_guests WHERE id = ?1 AND event_id = ?2').bind(Number(mm[1]), event.id).run();
    return back('medium-removed');
  }
  return null;
}
