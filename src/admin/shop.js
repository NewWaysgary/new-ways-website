// Admin for the Meditation Shop: any number of meditations, each with its own price, cover, public preview and
// private full recording.
import { textResponse, redirect, HttpError } from '../lib/http.js';
import { checkCsrf } from '../lib/auth.js';
import { storeImage, deleteMedia } from '../lib/media.js';
import * as data from '../lib/data.js';
import { getBookingSettings, validateBookingSettings, saveSettingValues, SHOP_SETTINGS } from '../bookings/config.js';
import { squareMode } from '../payments/square.js';
import { parsePrice } from './bookings.js';
import { storePreview, storeFull } from '../shop/files.js';
import * as view from '../views/admin-shop.js';

const nowIso = () => new Date().toISOString();

export function slugify(title) {
  return String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'meditation';
}

async function uniqueSlug(env, title) {
  const base = slugify(title);
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await env.DB.prepare('SELECT 1 FROM products WHERE slug = ?1').bind(slug).first())) return slug;
  }
  return `${base}-${Date.now()}`;
}

function validate(f) {
  const values = {}, errors = {};
  const text = (k, max, required) => {
    const v = String(f[k] ?? '').replace(/\r\n?/g, '\n').trim();
    if (required && !v) errors[k] = 'This is needed.';
    else if (v.length > max) errors[k] = `Please keep this under ${max.toLocaleString('en-GB')} characters.`;
    values[k] = v;
  };
  text('title', 120, true);
  text('by_line', 120);
  text('narration_note', 160);
  text('short_description', 300);
  text('description', 5000);
  const pence = parsePrice(f.price);
  if (pence === null) errors.price = 'Enter a price from £1 to £1,000, for example 9.99.';
  values.price_pence = pence;
  return { values, errors };
}

const getProduct = (env, id) => env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(id).first();
const orderCount = async (env, id) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE product_id = ?1`).bind(id).first()).n;
const fileInfo = (env, key) => key ? env.DB.prepare('SELECT * FROM media WHERE key = ?1').bind(key).first() : null;

// Raw uploads (the file is the whole request), checked like the background music upload
export async function uploadMeditationAudio(request, env, id, kind) {
  if (!checkCsrf(request, { _csrf: request.headers.get('X-CSRF-Token') || '' })) return Response.json({ error: 'Please refresh the page and try again.' }, { status: 403 });
  const product = await getProduct(env, id);
  if (!product) return Response.json({ error: 'That meditation no longer exists.' }, { status: 404 });
  let name = '';
  try { name = decodeURIComponent(request.headers.get('X-File-Name') || ''); } catch { /* ignore */ }
  try {
    if (kind === 'preview') {
      const { key, seconds } = await storePreview(env, request, name);
      await env.DB.batch([
        env.DB.prepare(`UPDATE products SET preview_key = ?1, updated_at = ?2 WHERE id = ?3`).bind(key, nowIso(), id),
        data.audit(env, 'shop.preview', `Preview uploaded for “${product.title}” (${Math.round(seconds)} seconds)`)
      ]);
      if (product.preview_key) await deleteMedia(env, product.preview_key);
    } else {
      const { key } = await storeFull(env, request, name, id);
      await env.DB.batch([
        env.DB.prepare(`UPDATE products SET full_key = ?1, updated_at = ?2 WHERE id = ?3`).bind(key, nowIso(), id),
        // the old recording is kept until no download link still needs it (removed by the daily housekeeping)
        env.DB.prepare(`UPDATE product_files SET retired_at = ?1 WHERE product_id = ?2 AND key != ?3 AND retired_at IS NULL`).bind(nowIso(), id, key),
        data.audit(env, 'shop.full', `Full recording uploaded for “${product.title}”`)
      ]);
    }
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export async function handleShopAdmin(ctx) {
  const { env, url, method, path, form, page, csrf } = ctx;
  if (path !== '/admin/meditations' && !path.startsWith('/admin/meditations/')) return null;
  const mode = squareMode(env);
  const f = form.fields;

  if (path === '/admin/meditations') {
    if (method !== 'GET') return textResponse('Method not allowed', { status: 405 });
    const { results } = await env.DB.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id AND o.status = 'paid') AS sold FROM products p ORDER BY p.sort_order, p.id`).all();
    return page(view.shopListPage({ products: results || [], settings: await getBookingSettings(env), csrf: csrf.token, flash: url.searchParams.get('flash'), mode }));
  }
  if (path === '/admin/meditations/settings') {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    const { values, errors } = validateBookingSettings(f, SHOP_SETTINGS);
    if (Object.keys(errors).length) {
      const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort_order, id').all();
      return page(view.shopListPage({ products: results || [], settings: await getBookingSettings(env), values, errors, csrf: csrf.token, mode }), 422);
    }
    await saveSettingValues(env, values, data.audit(env, 'shop.settings', 'Meditation download settings saved'));
    return redirect('/admin/meditations?flash=settings#shop-settings');
  }

  const m = path.match(/^\/admin\/meditations\/(new|\d{1,9})(?:\/(publish|unpublish|delete|recording))?$/);
  if (!m) return null;
  const product = m[1] === 'new' ? null : await getProduct(env, Number(m[1]));
  if (m[1] !== 'new' && !product) return null;

  const showEdit = async (extra = {}, status = 200) => page(view.productPage({ product, values: extra.values || view.productFormValues(product), csrf: csrf.token, mode,
    flash: url.searchParams.get('flash'), fullFile: product ? await fileInfo(env, product.full_key) : null, previewFile: product ? await fileInfo(env, product.preview_key) : null,
    orderCount: product ? await orderCount(env, product.id) : 0, ...extra }), status);

  if (m[2] === 'recording') {
    if (method !== 'GET' || !product.full_key) return textResponse('Not found', { status: 404 });
    const object = await env.MEDIA.get(product.full_key);
    if (!object) return textResponse('Not found', { status: 404 });
    return new Response(object.body, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Disposition': `attachment; filename="${product.slug}.mp3"`, 'Cache-Control': 'no-store' } });
  }
  if (m[2]) {
    if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
    if (m[2] === 'publish') {
      if (!product.full_key || !product.title || !(product.price_pence > 0)) return redirect(`/admin/meditations/${product.id}?flash=cannot-publish`);
      await env.DB.batch([env.DB.prepare(`UPDATE products SET status = 'published', updated_at = ?1 WHERE id = ?2`).bind(nowIso(), product.id),
        data.audit(env, 'shop.publish', `Meditation “${product.title}” published`)]);
      return redirect(`/admin/meditations/${product.id}?flash=published`);
    }
    if (m[2] === 'unpublish') {
      await env.DB.batch([env.DB.prepare(`UPDATE products SET status = 'draft', updated_at = ?1 WHERE id = ?2`).bind(nowIso(), product.id),
        data.audit(env, 'shop.unpublish', `Meditation “${product.title}” unpublished`)]);
      return redirect(`/admin/meditations/${product.id}?flash=unpublished`);
    }
    if (m[2] === 'delete') {
      if (await orderCount(env, product.id)) return redirect(`/admin/meditations/${product.id}?flash=has-orders`);
      const { results: files } = await env.DB.prepare('SELECT key FROM product_files WHERE product_id = ?1').bind(product.id).all();
      await env.DB.batch([env.DB.prepare('DELETE FROM products WHERE id = ?1').bind(product.id), env.DB.prepare('DELETE FROM product_files WHERE product_id = ?1').bind(product.id),
        data.audit(env, 'shop.delete', `Meditation “${product.title}” deleted`)]);
      for (const key of new Set([product.cover_key, product.preview_key, product.full_key, ...(files || []).map((x) => x.key)].filter(Boolean))) await deleteMedia(env, key);
      return redirect('/admin/meditations?flash=deleted');
    }
  }

  if (method === 'GET') return showEdit();
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  // add or save
  const { values, errors } = validate(f);
  const keep = { ...view.productFormValues(product), ...f };
  if (Object.keys(errors).length) {
    return showEdit({ values: keep, errors, uploadError: Object.keys(form.files).length ? 'Please check the highlighted details, then choose the picture again.' : null }, 422);
  }
  let cover = product ? product.cover_key : '';
  try {
    if (form.files.cover_key) cover = await storeImage(env, form.files.cover_key, 'cover');
    else if (f.remove_cover_key === '1') cover = '';
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) return showEdit({ values: keep, uploadError: err.message }, 400);
    throw err;
  }
  if (product) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE products SET title = ?1, by_line = ?2, narration_note = ?3, short_description = ?4, description = ?5, price_pence = ?6, cover_key = ?7, updated_at = ?8 WHERE id = ?9`)
        .bind(values.title, values.by_line, values.narration_note, values.short_description, values.description, values.price_pence, cover, nowIso(), product.id),
      data.audit(env, 'shop.save', `Meditation “${values.title}” saved`)
    ]);
    if (product.cover_key && product.cover_key !== cover) await deleteMedia(env, product.cover_key);
    return redirect(`/admin/meditations/${product.id}?flash=saved`);
  }
  const slug = await uniqueSlug(env, values.title);
  const sort = (await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM products').first()).n;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO products (slug, title, by_line, narration_note, short_description, description, price_pence, cover_key, status, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', ?9)`)
      .bind(slug, values.title, values.by_line, values.narration_note, values.short_description, values.description, values.price_pence, cover, sort),
    data.audit(env, 'shop.add', `Meditation “${values.title}” added`)
  ]);
  const created = await env.DB.prepare('SELECT id FROM products WHERE slug = ?1').bind(slug).first();
  return redirect(`/admin/meditations/${created.id}?flash=added`);
}
