// Admin › Private Readings › Gift Vouchers / Reservation Codes: make, list, search, print (PDF), cancel and
// (when Gary or Julie decide) make a used or cancelled code usable again. Gary and Julie only (the Admin router
// refuses check-in helpers).
import { textResponse, redirect, siteOrigin } from '../lib/http.js';
import { ukToday, isIsoDate } from '../lib/dates.js';
import { addDays } from '../bookings/availability.js';
import * as data from '../lib/data.js';
import * as vouchers from '../bookings/vouchers.js';
import * as view from '../views/admin-vouchers.js';
import { whoIs } from '../events/reservations.js';
import { pngForPdf } from '../lib/pdf.js';
import { LAYOUT } from '../bookings/voucher-layout.js';

// The two approved designs and the font, read once from the website's own files (Cloudflare's static files) and kept while this
// copy of the website is running. Only the PNG's compressed data is used, so nothing is decoded.
let templateCache = null;
async function loadTemplates(env, request) {
  if (templateCache) return templateCache;
  if (!env.ASSETS) return null;
  const out = {};
  for (const [minutes, file] of Object.entries(LAYOUT.templates)) {
    const res = await env.ASSETS.fetch(new Request(new URL(file, request.url).href));
    if (!res.ok) return null;
    const pic = pngForPdf(new Uint8Array(await res.arrayBuffer()));
    if (!pic || pic.width !== LAYOUT.width || pic.height !== LAYOUT.height) return null;
    out[minutes] = pic;
  }
  const font = await env.ASSETS.fetch(new Request(new URL(LAYOUT.text.fontUrl, request.url).href));
  if (!font.ok) return null;
  out.font = new Uint8Array(await font.arrayBuffer());
  templateCache = out;
  return out;
}

// A finished voucher picture sent by the Admin phone: a real PNG, exactly 1983 × 793 (the design's own size)
function pngSize(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v) || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

const LIST_SQL = `SELECT v.*, o.customer_name, b.date AS bk_date, b.local_start AS bk_start, b.status AS bk_status
  FROM gift_vouchers v LEFT JOIN orders o ON o.id = v.order_id LEFT JOIN bookings b ON b.order_id = o.id`;

async function listVouchers(env, filters) {
  const where = [];
  const binds = [];
  const q = String(filters.q || '').trim().slice(0, 60);
  if (q) {
    const code = vouchers.normaliseCode(q);
    binds.push(code || '', '%' + q.toLowerCase() + '%');
    where.push(`(v.code = ?${binds.length - 1} OR v.code LIKE upper(?${binds.length}) OR lower(v.note) LIKE ?${binds.length} OR lower(o.customer_name) LIKE ?${binds.length})`);
  }
  const { results } = await env.DB.prepare(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.id DESC LIMIT 500`).bind(...binds).all();
  const rows = (results || []).map((v) => ({ ...v, shown: vouchers.voucherStatus(v) }));
  const counts = {};
  for (const r of rows) counts[r.shown] = (counts[r.shown] || 0) + 1;
  return { rows: filters.show ? rows.filter((r) => r.shown === filters.show) : rows, counts };
}

export async function handleVouchersAdmin(ctx) {
  const { env, url, method, path, form, page, csrf, admin, request } = ctx;
  if (path !== '/admin/readings/vouchers' && !path.startsWith('/admin/readings/vouchers/')) return null;
  const who = whoIs(admin);
  const services = (await env.DB.prepare('SELECT * FROM reading_services ORDER BY sort_order, id').all()).results || [];
  const filters = { q: url.searchParams.get('q') || '', show: Object.keys(vouchers.STATUS_LABEL).includes(url.searchParams.get('show')) ? url.searchParams.get('show') : '' };
  const link = siteOrigin(request, env) + vouchers.READINGS_PATH;

  if (path === '/admin/readings/vouchers') {
    if (method === 'GET') {
      const ids = String(url.searchParams.get('made') || '').split(',').filter((x) => /^\d{1,9}$/.test(x)).slice(0, vouchers.MAX_BATCH);
      const made = (ids.length ? ((await env.DB.prepare(`SELECT * FROM gift_vouchers WHERE id IN (${ids.join(',')}) ORDER BY id`).all()).results || []) : [])
        .map((m) => ({ ...m, render: vouchers.renderData(m, siteOrigin(request, env)) }));
      const { rows, counts } = await listVouchers(env, filters);
      return page(view.vouchersPage({ rows, counts, services, filters, csrf: csrf.token, made }));
    }
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const f = form.fields;
    const errors = {};
    const service = services.find((s) => s.code === f.service);
    if (!service) errors.service = 'Please choose the reading.';
    const count = Number(f.count);
    if (!Number.isInteger(count) || count < 1 || count > vouchers.MAX_BATCH) errors.count = `Please enter a number from 1 to ${vouchers.MAX_BATCH}.`;
    const expires = String(f.expires_on || '').trim();
    if (expires && (!isIsoDate(expires) || expires < ukToday())) errors.expires = 'Please choose today or a later date, or leave it empty.';
    else if (expires && expires > addDays(ukToday(), 5 * 366)) errors.expires = 'Please choose a date within the next five years.';
    const note = String(f.note || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (Object.keys(errors).length) {
      const { rows, counts } = await listVouchers(env, filters);
      return page(view.vouchersPage({ rows, counts, services, filters, csrf: csrf.token, values: f, errors }), 422);
    }
    const ids = [];
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = vouchers.newCode();
        try {
          const r = await env.DB.prepare(`INSERT INTO gift_vouchers (code, service_code, minutes, value_pence, expires_on, note, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
            .bind(code, service.code, service.minutes, service.price_pence, expires || null, note, who).run();
          ids.push(r.meta.last_row_id);
          await vouchers.logStep(env, r.meta.last_row_id, `Made: ${service.name}, value £${(service.price_pence / 100).toFixed(2)}${expires ? `, book by ${expires.split('-').reverse().join('/')}` : ', no expiry'}${note ? ` (${note})` : ''}`, who).run();
          break;
        } catch (err) {
          if (!/UNIQUE/i.test(String(err && err.message)) || attempt === 4) throw err;   // (a new random code is tried)
        }
      }
    }
    await data.audit(env, 'vouchers.make', `${who} made ${count} gift ${count === 1 ? 'voucher' : 'vouchers'}: ${service.name}${note ? ` (${note})` : ''}`).run();
    return redirect(`/admin/readings/vouchers?made=${ids.join(',')}#made-title`);
  }

  // Several vouchers as one PDF (one per page)
  if (path === '/admin/readings/vouchers/print.pdf' && method === 'GET') {
    const ids = String(url.searchParams.get('ids') || '').split(',').filter((x) => /^\d{1,9}$/.test(x)).slice(0, vouchers.MAX_BATCH);
    const list = ids.length ? ((await env.DB.prepare(`SELECT * FROM gift_vouchers WHERE id IN (${ids.join(',')}) ORDER BY id`).all()).results || []) : [];
    if (!list.length) return textResponse('Not found', { status: 404 });
    const templates = await loadTemplates(env, request);
    if (!templates) return textResponse('The voucher designs could not be loaded just now. Please try again.', { status: 503 });
    return pdfResponse(vouchers.voucherPdf(list, siteOrigin(request, env), templates), `New-Ways-gift-vouchers-${list.length}.pdf`, url.searchParams.get('download') === '1');
  }

  const vm = path.match(/^\/admin\/readings\/vouchers\/(\d{1,9})(\.pdf|\.png|\/image|\/cancel|\/reactivate)?$/);
  if (!vm) return null;
  const v = await env.DB.prepare('SELECT * FROM gift_vouchers WHERE id = ?1').bind(Number(vm[1])).first();
  if (!v) return null;
  const shown = vouchers.voucherStatus(v);
  if (vm[2] === '.pdf') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const templates = await loadTemplates(env, request);
    if (!templates) return textResponse('The voucher designs could not be loaded just now. Please try again.', { status: 503 });
    return pdfResponse(vouchers.voucherPdf(v, siteOrigin(request, env), templates), `New-Ways-gift-voucher-${v.code}.pdf`, url.searchParams.get('download') === '1');
  }
  // The finished picture, saved against this voucher (download it again at any time)
  if (vm[2] === '.png') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const object = v.image_key ? await env.MEDIA.get(v.image_key) : null;
    if (!object) return textResponse('This voucher’s picture hasn’t been made yet. Open the voucher in Admin to make it.', { status: 404 });
    return new Response(object.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex',
      'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="New-Ways-gift-voucher-${v.code}.png"` } });
  }
  if (vm[2] === '/image') {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const file = form.files.png;
    const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
    const size = bytes && pngSize(bytes);
    if (!size || size.width !== LAYOUT.width || size.height !== LAYOUT.height || bytes.length > 8_000_000) {
      return new Response(JSON.stringify({ ok: false, error: 'Not a voucher picture of the right size.' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }
    if (form.fields.code !== v.code) return new Response(JSON.stringify({ ok: false, error: 'The code on the picture is not this voucher’s code.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    const key = `private/vouchers/${v.id}-${v.code}.png`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
    await env.DB.batch([
      env.DB.prepare('UPDATE gift_vouchers SET image_key = ?1, image_made_at = ?2 WHERE id = ?3').bind(key, new Date().toISOString(), v.id),
      vouchers.logStep(env, v.id, v.image_key ? 'Voucher picture made again and saved' : 'Voucher picture made and saved', who)
    ]);
    return new Response(JSON.stringify({ ok: true, url: `/admin/readings/vouchers/${v.id}.png` }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  if (!vm[2]) {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const order = v.order_id ? await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(v.order_id).first() : null;
    const booking = order ? await env.DB.prepare('SELECT * FROM bookings WHERE order_id = ?1').bind(order.id).first() : null;
    const log = (await env.DB.prepare('SELECT * FROM gift_voucher_log WHERE voucher_id = ?1 ORDER BY id DESC').bind(v.id).all()).results || [];
    return page(view.voucherPage({ v, shown, order, booking, log, csrf: csrf.token, flash: url.searchParams.get('flash'), link, render: vouchers.renderData(v, siteOrigin(request, env)) }));
  }
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  const back = (flash) => redirect(`/admin/readings/vouchers/${v.id}?flash=${flash}`);
  if (vm[2] === '/cancel') {
    if (!['available', 'reserved', 'expired'].includes(shown)) return back('not-allowed');
    const r = await env.DB.batch([
      env.DB.prepare(`UPDATE gift_vouchers SET status = 'cancelled', cancelled_at = ?1, cancelled_by = ?2, reserved_until = NULL, reserved_token = NULL WHERE id = ?3 AND status IN ('available', 'reserved')`)
        .bind(new Date().toISOString(), who, v.id),
      vouchers.logStep(env, v.id, 'Cancelled in Admin', who),
      data.audit(env, 'vouchers.cancel', `Gift voucher ${v.code} cancelled by ${who}`)
    ]);
    return back(r[0].meta.changes ? 'cancelled' : 'not-allowed');
  }
  if (vm[2] === '/reactivate') {
    // Only when Gary or Julie choose: a cancelled code, or a used code whose booking was cancelled
    const order = v.order_id ? await env.DB.prepare('SELECT o.reference, b.status FROM orders o LEFT JOIN bookings b ON b.order_id = o.id WHERE o.id = ?1').bind(v.order_id).first() : null;
    const allowed = v.status === 'cancelled' || (v.status === 'redeemed' && (!order || ['cancelled', 'expired'].includes(order.status)));
    if (!allowed) return back('not-allowed');
    await env.DB.batch([
      env.DB.prepare(`UPDATE gift_vouchers SET status = 'available', order_id = NULL, redeemed_at = NULL, cancelled_at = NULL, cancelled_by = '', reserved_until = NULL, reserved_token = NULL WHERE id = ?1`).bind(v.id),
      vouchers.logStep(env, v.id, `Made usable again${order ? ` (its booking ${order.reference} had been cancelled)` : ''}`, who),
      data.audit(env, 'vouchers.reactivate', `Gift voucher ${v.code} made usable again by ${who}`)
    ]);
    return back('reactivated');
  }
  return null;
}

function pdfResponse(bytes, filename, download) {
  return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } });
}
