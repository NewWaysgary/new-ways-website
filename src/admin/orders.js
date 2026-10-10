// Admin: bookings, orders and the actions Gary can take. Nothing here refunds money: refunds, if Gary decides to give
// one, are made by Gary in Square.
import { textResponse, redirect } from '../lib/http.js';
import { ukToday } from '../lib/dates.js';
import * as data from '../lib/data.js';
import { squareMode } from '../payments/square.js';
import * as orders from '../orders.js';
import * as notify from '../notify.js';
import * as view from '../views/admin-orders.js';

const nowIso = () => new Date().toISOString();

// The exact size of each recording in bytes, read from R2 (private storage) now, not from a saved figure
async function r2Sizes(env, keys) {
  const out = {};
  for (const key of [...new Set(keys.filter(Boolean))].slice(0, 50)) {
    try { const h = await env.MEDIA.head(key); out[key] = h ? h.size : null; } catch { out[key] = null; }
  }
  return out;
}

const LISTS = {
  upcoming: `b.status = 'confirmed' AND b.end_utc > ?1 ORDER BY b.start_utc`,
  attention: `b.status = 'needs_attention' ORDER BY b.start_utc`,
  held: `b.status = 'held' ORDER BY b.start_utc`,
  past: `b.status = 'confirmed' AND b.end_utc <= ?1 ORDER BY b.start_utc DESC`,
  closed: `b.status IN ('cancelled', 'expired') ORDER BY b.created_at DESC`
};

async function bookingCounts(env) {
  const now = nowIso();
  const rows = await env.DB.batch(Object.values(LISTS).map((w) =>
    env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings b WHERE ${w.split(' ORDER BY')[0]}`).bind(...(w.includes('?1') ? [now] : []))));
  return Object.fromEntries(Object.keys(LISTS).map((k, i) => [k, rows[i].results[0].n]));
}

// Is every half hour of this booking still reserved for it? (Then it can simply be kept.)
async function holdsItsSlots(env, booking) {
  if (!booking) return false;
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM booking_slots WHERE booking_id = ?1').bind(booking.id).first();
  return row.n === booking.minutes / 30;
}

export async function handleOrdersAdmin(ctx) {
  const { env, url, method, path, form, page, csrf, admin } = ctx;
  const mode = squareMode(env);

  if (path === '/admin/bookings') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    await orders.releaseExpiredHolds(env, 3).catch(() => {});
    const current = LISTS[url.searchParams.get('show')] ? url.searchParams.get('show') : 'upcoming';
    const where = LISTS[current];
    const { results } = await env.DB.prepare(
      `SELECT b.*, b.status AS booking_status, o.customer_name, o.reference, o.id AS order_id FROM bookings b JOIN orders o ON o.id = b.order_id WHERE ${where} LIMIT 100`
    ).bind(...(where.includes('?1') ? [nowIso()] : [])).all();
    return page(view.bookingsListPage({ rows: results || [], current, counts: await bookingCounts(env), csrf: csrf.token, mode, today: ukToday() }));
  }

  if (path === '/admin/meditations/sales') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const { results } = await env.DB.prepare(
      `SELECT o.*,
         (SELECT COUNT(*) FROM download_events e WHERE e.order_id = o.id) AS blocked_count,
         (SELECT COUNT(*) FROM download_replacements r WHERE r.order_id = o.id) AS replacement_count
       FROM orders o WHERE o.kind = 'MEDITATION_PURCHASE' AND o.status IN ('paid', 'needs_attention') ORDER BY COALESCE(o.paid_at, o.created_at) DESC LIMIT 200`).all();
    const rows = results || [];
    // the latest download for each sale, and the exact size of each recording, read from R2 now
    const ents = rows.length ? (await env.DB.prepare(`SELECT d.* FROM download_entitlements d WHERE d.order_id IN (${rows.map((r) => Number(r.id)).join(',')})
        AND d.id = (SELECT MAX(id) FROM download_entitlements x WHERE x.order_id = d.order_id)`).all()).results || [] : [];
    const sizes = await r2Sizes(env, ents.map((e) => e.file_key));
    const byOrder = Object.fromEntries(ents.map((e) => [e.order_id, { ...e, r2_size: sizes[e.file_key] }]));
    return page(view.salesListPage({ rows: rows.map((r) => ({ ...r, download: byOrder[r.id] || null })), csrf: csrf.token, mode }));
  }

  const m = path.match(/^\/admin\/orders\/(\d{1,9})(?:\/(cancel|keep|resolve|resend|reissue|note))?$/);
  if (!m) return null;
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(Number(m[1])).first();
  if (!order) return null;
  const booking = order.kind === 'PRIVATE_READING' ? await orders.bookingForOrder(env, order.id) : null;
  const product = order.product_id ? await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(order.product_id).first() : null;
  const showOrder = async (extra = {}) => {
    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(order.id).first();
    const [emails, downloads, devices, transfers, events, replacements] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM email_log WHERE order_id = ?1 ORDER BY id').bind(order.id),
      env.DB.prepare('SELECT * FROM download_entitlements WHERE order_id = ?1 ORDER BY id DESC').bind(order.id),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM order_devices WHERE order_id = ?1 AND how = 'purchase'`).bind(order.id),
      env.DB.prepare('SELECT * FROM download_transfers WHERE order_id = ?1 ORDER BY id').bind(order.id),
      env.DB.prepare('SELECT * FROM download_events WHERE order_id = ?1 ORDER BY id DESC LIMIT 100').bind(order.id),
      env.DB.prepare('SELECT * FROM download_replacements WHERE order_id = ?1 ORDER BY id').bind(order.id)
    ]);
    const dls = downloads.results || [];
    const sizes = await r2Sizes(env, dls.map((d) => d.file_key));
    const bk = fresh.kind === 'PRIVATE_READING' ? await orders.bookingForOrder(env, order.id) : null;
    return page(view.orderPage({ order: fresh, booking: bk, product, emails: emails.results || [], downloads: dls.map((d) => ({ ...d, r2_size: sizes[d.file_key] })), devices: devices.results?.[0]?.n || 0,
      transfers: transfers.results || [], events: events.results || [], replacements: replacements.results || [],
      canKeep: fresh.status === 'needs_attention' && (await holdsItsSlots(env, bk)), csrf: csrf.token, flash: url.searchParams.get('flash'), mode, ...extra }), extra.status || 200);
  };

  if (!m[2]) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    return showOrder();
  }
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  const back = (flash) => redirect(`/admin/orders/${order.id}?flash=${flash}`);
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const addNote = (text) => (order.note ? order.note + '\n\n' : '') + `${stamp}: ${text}`;

  switch (m[2]) {
    case 'cancel': {
      if (!booking || booking.status !== 'confirmed') return back('');
      await env.DB.batch([
        env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?1 WHERE id = ?2 AND status = 'confirmed'`).bind(nowIso(), booking.id),
        env.DB.prepare('DELETE FROM booking_slots WHERE booking_id = ?1').bind(booking.id),
        env.DB.prepare('UPDATE orders SET note = ?1 WHERE id = ?2').bind(addNote('Booking cancelled by Gary in Admin. No automatic refund.'), order.id),
        data.audit(env, 'bookings.cancel', `Booking ${order.reference} cancelled (${booking.date} ${booking.local_start})`)
      ]);
      return back('cancelled');
    }
    case 'keep': {
      if (order.status !== 'needs_attention' || !booking || !(await holdsItsSlots(env, booking))) return back('');
      await env.DB.batch([
        env.DB.prepare(`UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = ?1`).bind(booking.id),
        env.DB.prepare(`UPDATE orders SET status = 'paid', note = ?1 WHERE id = ?2 AND status = 'needs_attention'`).bind(addNote('Gary kept this appointment.'), order.id),
        data.audit(env, 'bookings.keep', `Booking ${order.reference} kept by Gary`)
      ]);
      return back('confirmed');
    }
    case 'resolve': {
      if (order.status !== 'needs_attention') return back('');
      await env.DB.batch([
        ...(booking ? [env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?1 WHERE id = ?2`).bind(nowIso(), booking.id),
          env.DB.prepare('DELETE FROM booking_slots WHERE booking_id = ?1').bind(booking.id)] : []),
        env.DB.prepare(`UPDATE orders SET status = ?1, note = ?2 WHERE id = ?3`).bind(order.square_payment_id ? 'paid' : 'cancelled', addNote('Marked as dealt with by Gary.'), order.id),
        // Gary has dealt with it personally: no automatic confirmation or download email is sent afterwards
        env.DB.prepare(`INSERT OR IGNORE INTO email_log (order_id, kind, status) VALUES (?1, ?2, 'skipped')`).bind(order.id, order.kind === 'PRIVATE_READING' ? 'customer_confirmation' : 'customer_download'),
        data.audit(env, 'orders.resolve', `Order ${order.reference} marked as dealt with`)
      ]);
      return back('resolved');
    }
    case 'resend': {
      if (!booking || order.status !== 'paid' || order.personal_data_removed_at) return back('');
      const status = await notify.resendReadingConfirmation(env, order, booking, 'customer_confirmation_resend_' + Date.now());
      return back(status === 'sent' ? 'resent' : 'resend-failed');
    }
    case 'reissue': {
      // A replacement download: only Gary or a full Admin can reach here (check-in helpers are refused by the
      // Admin router), and a reason is required. Recorded in full, with who authorised it.
      if (order.kind !== 'MEDITATION_PURCHASE' || order.status !== 'paid' || !product || order.personal_data_removed_at) return back('');
      if (!admin || (admin.role !== 'owner' && admin.role !== 'admin')) return textResponse('Not allowed.', { status: 403 });
      const reason = String(form.fields.reason || '').trim().replace(/\s+/g, ' ').slice(0, 500);
      if (reason.length < 5) return showOrder({ reissueError: 'Please write the reason for this replacement download (at least a few words). It is kept in the records.', status: 422 });
      const anyDevice = form.fields.any_device === '1';
      const old = await env.DB.prepare('SELECT id FROM download_entitlements WHERE order_id = ?1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').bind(order.id).first();
      const token = await orders.createDownload(env, order, product, { anyDevice });
      const fresh = await env.DB.prepare('SELECT id FROM download_entitlements WHERE order_id = ?1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').bind(order.id).first();
      const who = admin.role === 'owner' ? 'Gary' : admin.name || admin.email || 'Admin';
      const status = await notify.meditationBought(env, { ...order, device_protected: anyDevice ? 0 : order.device_protected }, product, token, 'customer_download_reissue_' + Date.now(), { replacement: true });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO download_replacements (order_id, old_entitlement_id, new_entitlement_id, authorised_by, authorised_email, reason, any_device, email_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
          .bind(order.id, old ? old.id : null, fresh.id, who, admin.email || '', reason, anyDevice ? 1 : 0, status),
        data.audit(env, 'orders.reissue', `Replacement download for ${order.reference} authorised by ${who}${anyDevice ? ' (works on any device)' : ''}. Reason: ${reason}`)
      ]);
      return showOrder({ newLink: { url: orders.downloadLink(order, token), emailed: status === 'sent', anyDevice } });
    }
    case 'note': {
      const text = String(form.fields.note || '').trim().slice(0, 1000);
      if (text) await env.DB.prepare('UPDATE orders SET note = ?1 WHERE id = ?2').bind(addNote(text), order.id).run();
      return back('noted');
    }
  }
  return null;
}
