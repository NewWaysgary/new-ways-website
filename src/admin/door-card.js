// Wednesday till: card payments taken in the Square Point of Sale app on the same phone, checked with Square and
// recorded automatically. (The till's other ways of taking money are unchanged: cash, and "Card payment taken ✓"
// for a card reader used without the app.)
//
// 1. When the CARD screen opens, the till registers the sale here first: the lines are priced from the database
//    and kept with a random reference. Only then does "Open the Square app" become usable.
// 2. The Square app is opened with exactly that total, that reference (REQUEST_METADATA), and an instruction to come
//    back by itself 3.2 seconds after the Thank You screen (AUTO_RETURN_TIMEOUT_MS; without it, Square waits on
//    that screen until someone taps New Sale, which is why it came back minutes later).
// 3. When Square comes back, the website asks Square itself (never trusting what came back in the address): the
//    payment must be COMPLETED, for exactly the sale's amount, in GBP, a card payment, at the card reader's location,
//    made after the sale was sent to Square, and not already counted for anything else.
// 4. Only then is the sale recorded: once (the sale's own reference and the Square payment can each only be used
//    once, in one all-or-nothing database step), so Square coming back twice, or a refresh, can't record it twice.
// Anything cancelled, declined, different or not confirmed is never recorded as paid.
import * as w from '../wednesday/model.js';
import * as data from '../lib/data.js';
import { posConfig, posTransaction, SquareError } from '../payments/square.js';

export const AUTO_RETURN_MS = 3200;              // Square's minimum: back to the till 3.2 seconds after Thank You
export const CHECK_FOR_MS = 2 * 60_000;          // how long to keep asking Square before saying it can't confirm
const EARLY_MS = 2 * 60_000;                     // a payment made before the sale was sent to Square can't be it
const nowIso = () => new Date().toISOString();
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const REF_RE = /^[a-f0-9]{32}$/;

export const cardRequest = (env, ref) => (REF_RE.test(String(ref || '')) ? env.DB.prepare('SELECT * FROM till_card_requests WHERE ref = ?1').bind(ref).first() : null);

function shape(r, sale = null) {
  return { ok: true, ref: r.ref, status: r.status, total: r.total_pence, detail: r.detail, saleId: r.sale_id || (sale && sale.id) || null, clientRef: r.client_ref,
    returned: !!r.returned_at, checks: r.checks };
}

// POST /admin/door/card/start: the CARD screen registers the sale before the Square app can be opened
export async function startCardRequest(env, f, by) {
  const date = String(f.date || '');
  const ref = String(f.ref || ''), clientRef = String(f.client_ref || '');
  if (!REF_RE.test(ref) || !/^[A-Za-z0-9_-]{8,64}$/.test(clientRef) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return json({ ok: false, error: 'That sale couldn’t be read. Please try again.' }, 400);
  const recorded = await env.DB.prepare('SELECT id, total_pence FROM till_sales WHERE client_ref = ?1').bind(clientRef).first();
  if (recorded) return json({ ok: false, already: true, error: 'This sale has already been recorded.' }, 409);
  let lines;
  try { lines = JSON.parse(String(f.lines || '[]')); } catch { lines = null; }
  const items = await w.tillItems(env, { enabledOnly: true });
  const basket = w.priceBasket(items, lines);
  if (basket.errors.length) return json({ ok: false, error: basket.errors[0] + ' Please clear the sale and start again.' }, 422);
  if (!basket.lines.length || basket.total < 1) return json({ ok: false, error: 'There is nothing to pay in this sale.' }, 422);
  if (String(basket.total) !== String(f.expected_total)) return json({ ok: false, error: 'The prices have changed since this screen was opened. Please clear the sale, refresh the page and try again.' }, 409);
  const night = await w.night(env, date);
  if (night && night.till_closed_at) return json({ ok: false, error: 'This night has been closed (cash counted). Reopen it from Close night to add sales.' }, 409);
  const existing = await cardRequest(env, ref);
  if (existing) {
    if (existing.client_ref !== clientRef || existing.total_pence !== basket.total) return json({ ok: false, error: 'Please go back to the sale and press CARD again.' }, 409);
    return json(shape(existing));
  }
  await env.DB.prepare(`INSERT INTO till_card_requests (ref, client_ref, night_date, total_pence, lines_json, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(ref, clientRef, date, basket.total, JSON.stringify(basket.lines), by).run();
  return json(shape(await cardRequest(env, ref)));
}

// Square came back (GET /admin/door/square-callback?com.squareup.pos.…). Records what Square said, then checks it.
// Returns the request (or null if it isn't one of ours).
export async function squareReturned(env, params, by) {
  const r = await cardRequest(env, params.get('com.squareup.pos.REQUEST_METADATA'));
  if (!r) return null;
  const serverId = String(params.get('com.squareup.pos.SERVER_TRANSACTION_ID') || '').slice(0, 100);
  const clientId = String(params.get('com.squareup.pos.CLIENT_TRANSACTION_ID') || '').slice(0, 100);
  const error = String(params.get('com.squareup.pos.ERROR_CODE') || '').slice(0, 80);
  const now = nowIso();
  if (r.status === 'waiting') {
    if (serverId && /^[A-Za-z0-9_-]{1,100}$/.test(serverId)) {
      await env.DB.prepare(`UPDATE till_card_requests SET status = 'checking', square_transaction_id = ?1, square_client_transaction_id = ?2, returned_at = ?3, updated_at = ?3
          WHERE id = ?4 AND status = 'waiting'`).bind(serverId, clientId, now, r.id).run()
        .catch(async (err) => {
          // the same Square transaction already belongs to another sale
          if (/UNIQUE/.test(String(err && err.message))) await setStatus(env, r.id, 'mismatch', 'Square returned a payment that already belongs to another sale. Nothing has been recorded.');
          else throw err;
        });
    } else if (error) {
      const words = { TRANSACTION_CANCELED: 'The payment was cancelled in the Square app.', NO_NETWORK: 'The Square app had no internet connection.', USER_NOT_LOGGED_IN: 'Nobody is signed in to the Square app.',
        UNAUTHORIZED_CLIENT_ID: 'The Square app didn’t accept the till’s application ID (Admin › Wednesday Door › Buttons & prices).', TRANSACTION_ALREADY_IN_PROGRESS: 'Another payment was already in progress in the Square app.' }[error];
      await env.DB.prepare(`UPDATE till_card_requests SET status = 'cancelled', detail = ?1, returned_at = ?2, updated_at = ?2 WHERE id = ?3 AND status = 'waiting'`)
        .bind(words || `Square said: ${error}. The payment was not taken.`, now, r.id).run();
    } else if (clientId) {
      // Offline Mode: Square has no server record yet, so it can't be checked here
      await env.DB.prepare(`UPDATE till_card_requests SET status = 'unverified', square_client_transaction_id = ?1, returned_at = ?2, updated_at = ?2,
          detail = 'The Square app took this payment in Offline Mode, so Square can’t confirm it yet. Check it in the Square app.' WHERE id = ?3 AND status = 'waiting'`).bind(clientId, now, r.id).run();
    } else {
      await env.DB.prepare(`UPDATE till_card_requests SET status = 'cancelled', detail = 'Square came back without a result. The payment was not taken.', returned_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'waiting'`).bind(now, r.id).run();
    }
  } else if (serverId && r.square_transaction_id && serverId !== r.square_transaction_id && r.status !== 'paid') {
    await setStatus(env, r.id, 'mismatch', 'Square came back twice with two different payments for this sale. Nothing has been recorded; check the Square app.');
  }
  return checkCardRequest(env, await cardRequest(env, r.ref), by);
}

const setStatus = (env, id, status, detail) => env.DB.prepare(`UPDATE till_card_requests SET status = ?1, detail = ?2, updated_at = ?3 WHERE id = ?4 AND status IN ('waiting', 'checking')`)
  .bind(status, detail, nowIso(), id).run();

// Asks Square about a request that is being checked, and records the sale if (and only if) everything matches.
export async function checkCardRequest(env, r, by = '', nowMs = Date.now()) {
  if (!r || r.status !== 'checking') return r;
  const cfg = posConfig(env);
  if (!cfg) {
    await setStatus(env, r.id, 'unverified', 'Square says the payment was taken, but automatic checking with Square isn’t set up yet (SQUARE_POS_ACCESS_TOKEN), so it can’t be confirmed here. Check it in the Square app.');
    return cardRequest(env, r.ref);
  }
  await env.DB.prepare('UPDATE till_card_requests SET checks = checks + 1, updated_at = ?1 WHERE id = ?2').bind(nowIso(), r.id).run();
  const tooLong = nowMs - Date.parse(r.returned_at || r.created_at) > CHECK_FOR_MS;
  let found;
  try { found = await posTransaction(cfg, r.square_transaction_id); }
  catch (err) {
    if (err instanceof SquareError && (err.status === 401 || err.status === 403)) {
      await setStatus(env, r.id, 'unverified', 'Square refused the till’s checking access (SQUARE_POS_ACCESS_TOKEN). Check the payment in the Square app.');
    } else if (tooLong) {
      await setStatus(env, r.id, 'unverified', 'Square couldn’t be reached to confirm this payment. Check it in the Square app.');
    }
    return cardRequest(env, r.ref);
  }
  if (!found) {
    if (tooLong) await setStatus(env, r.id, 'unverified', 'Square doesn’t show this payment, so it can’t be confirmed. Check it in the Square app.');
    return cardRequest(env, r.ref);
  }
  const { order, payments } = found;
  if (cfg.locationId && order.location_id !== cfg.locationId) {
    await setStatus(env, r.id, 'mismatch', 'This payment was taken at a different Square location. Nothing has been recorded.');
    return cardRequest(env, r.ref);
  }
  const done = payments.filter((p) => p.status === 'COMPLETED');
  if (!done.length) {
    if (payments.some((p) => p.status === 'APPROVED' || p.status === 'PENDING') && !tooLong) return cardRequest(env, r.ref);   // still going through
    await setStatus(env, r.id, 'failed', payments.length ? 'Square says the card payment did not go through (declined or cancelled). Nothing has been recorded.'
      : (tooLong ? 'Square shows no payment for this sale. Nothing has been recorded.' : r.detail));
    return cardRequest(env, r.ref);
  }
  if (payments.length !== 1) {
    await setStatus(env, r.id, 'mismatch', 'Square shows more than one payment for this sale. Nothing has been recorded; check the Square app.');
    return cardRequest(env, r.ref);
  }
  const p = done[0];
  const amount = Number(p.amount_money && p.amount_money.amount), currency = p.amount_money && p.amount_money.currency;
  if (currency !== 'GBP' || amount !== r.total_pence) {
    await setStatus(env, r.id, 'mismatch', `Square took ${currency === 'GBP' ? w.pounds(amount) : `${amount} ${currency || ''}`.trim()}, but this sale is ${w.pounds(r.total_pence)}. Nothing has been recorded.`);
    return cardRequest(env, r.ref);
  }
  if (p.source_type && p.source_type !== 'CARD') {
    await setStatus(env, r.id, 'mismatch', 'Square says this wasn’t a card payment. Nothing has been recorded.');
    return cardRequest(env, r.ref);
  }
  if (Date.parse(p.created_at) < Date.parse(r.created_at) - EARLY_MS) {
    await setStatus(env, r.id, 'mismatch', 'Square returned an older payment, made before this sale was sent to the Square app. Nothing has been recorded.');
    return cardRequest(env, r.ref);
  }
  return recordVerified(env, r, p, by);
}

// Records the sale for a payment Square confirmed: all in one step, or nothing.
async function recordVerified(env, r, p, by) {
  const lines = JSON.parse(r.lines_json);
  const steps = [w.ensureNight(env, r.night_date),
    env.DB.prepare(`INSERT INTO till_sales (night_date, method, total_pence, client_ref, created_by, square_payment_id, card_request_id) VALUES (?1, 'card', ?2, ?3, ?4, ?5, ?6)`)
      .bind(r.night_date, r.total_pence, r.client_ref, r.created_by || by, p.id, r.id)];
  for (const l of lines) {
    steps.push(env.DB.prepare(`INSERT INTO till_sale_lines (sale_id, item_id, label, category, unit_pence, qty, line_pence) VALUES ((SELECT id FROM till_sales WHERE client_ref = ?1), ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(r.client_ref, l.item_id, l.label, l.category, l.unit_pence, l.qty, l.line_pence));
  }
  steps.push(env.DB.prepare(`UPDATE till_card_requests SET status = 'paid', square_payment_id = ?1, sale_id = (SELECT id FROM till_sales WHERE client_ref = ?2),
      verified_at = ?3, updated_at = ?3, detail = '' WHERE id = ?4 AND status = 'checking'`).bind(p.id, r.client_ref, nowIso(), r.id));
  steps.push(data.audit(env, 'door.card_app', `Card sale ${w.pounds(r.total_pence)} confirmed by Square (payment ${p.id}) and recorded`));
  try {
    await env.DB.batch(steps);
  } catch (err) {
    const msg = String(err && err.message);
    if (/TILL_CLOSED/.test(msg)) {
      await env.DB.prepare(`UPDATE till_card_requests SET detail = 'Square confirmed this payment, but the night has been closed. Reopen it (Close night) and it will be recorded.', updated_at = ?1 WHERE id = ?2`).bind(nowIso(), r.id).run();
      return cardRequest(env, r.ref);
    }
    if (!/UNIQUE/.test(msg)) throw err;
    // Something was already recorded: this same payment (a second check at the same moment), or a different one
    const same = await env.DB.prepare('SELECT * FROM till_sales WHERE square_payment_id = ?1').bind(p.id).first();
    if (same && same.client_ref === r.client_ref) {
      await env.DB.prepare(`UPDATE till_card_requests SET status = 'paid', square_payment_id = ?1, sale_id = ?2, verified_at = COALESCE(verified_at, ?3), updated_at = ?3, detail = '' WHERE id = ?4 AND status IN ('checking', 'paid')`)
        .bind(p.id, same.id, nowIso(), r.id).run().catch(() => {});
      return cardRequest(env, r.ref);
    }
    const sale = await env.DB.prepare('SELECT * FROM till_sales WHERE client_ref = ?1').bind(r.client_ref).first();
    await env.DB.prepare(`UPDATE till_card_requests SET status = 'duplicate', detail = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'checking'`)
      .bind(same ? 'This Square payment had already been counted for another sale. Nothing more has been recorded.'
        : `This sale had already been recorded${sale ? ` (${w.pounds(sale.total_pence)} ${sale.method})` : ''}, so this second Square payment of ${w.pounds(r.total_pence)} has NOT been counted. If the customer paid twice, refund one in the Square app.`, nowIso(), r.id).run();
    return cardRequest(env, r.ref);
  }
  return cardRequest(env, r.ref);
}

// GET /admin/door/card/status?ref=…: the till (and the "checking" page) ask how it went; a payment being checked is
// checked again with Square each time
export async function cardStatus(env, ref, by) {
  let r = await cardRequest(env, ref);
  if (!r) return json({ ok: false, error: 'Not found.' }, 404);
  if (r.status === 'checking') r = await checkCardRequest(env, r, by);
  return json(shape(r));
}

// After checking in the Square app, Gary or Julie can still record a payment the website couldn't confirm itself
export async function confirmByHand(env, r, by, checked) {
  if (!r || r.status !== 'unverified' || !checked) return r;
  const lines = JSON.parse(r.lines_json);
  const steps = [w.ensureNight(env, r.night_date),
    env.DB.prepare(`INSERT INTO till_sales (night_date, method, total_pence, client_ref, created_by, card_request_id) VALUES (?1, 'card', ?2, ?3, ?4, ?5)`).bind(r.night_date, r.total_pence, r.client_ref, by, r.id)];
  for (const l of lines) {
    steps.push(env.DB.prepare(`INSERT INTO till_sale_lines (sale_id, item_id, label, category, unit_pence, qty, line_pence) VALUES ((SELECT id FROM till_sales WHERE client_ref = ?1), ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(r.client_ref, l.item_id, l.label, l.category, l.unit_pence, l.qty, l.line_pence));
  }
  steps.push(env.DB.prepare(`UPDATE till_card_requests SET sale_id = (SELECT id FROM till_sales WHERE client_ref = ?1), detail = ?2, updated_at = ?3 WHERE id = ?4`)
    .bind(r.client_ref, `Recorded by ${by} after checking the Square app (not confirmed automatically).`, nowIso(), r.id));
  steps.push(data.audit(env, 'door.card_by_hand', `Card sale ${w.pounds(r.total_pence)} recorded by ${by} after checking the Square app (not confirmed by the website)`));
  try { await env.DB.batch(steps); } catch (err) { if (!/UNIQUE/.test(String(err && err.message))) throw err; }
  return cardRequest(env, r.ref);
}
