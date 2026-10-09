// Admin: the mailing list (search, add, unsubscribe, delete, export) and the Join page (wording, printable QR code).
import { textResponse, redirect, siteOrigin } from '../lib/http.js';
import { normaliseEmail } from '../lib/emails.js';
import { EMAIL_RE } from '../bookings/config.js';
import * as data from '../lib/data.js';
import { subscribe, joinWording, JOIN_FIELDS, JOIN_DEFAULTS } from '../mailing.js';
import { qrPng } from '../lib/qr.js';
import { csv } from './events.js';
import * as view from '../views/admin-mailing.js';

const STATUS = { subscribed: `status = 'subscribed'`, unsubscribed: `status = 'unsubscribed'`, all: '1 = 1' };

async function counts(env) {
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(status = 'subscribed'), 0) AS subscribed, COALESCE(SUM(status = 'unsubscribed'), 0) AS unsubscribed FROM mailing_list`).first();
  return { subscribed: row.subscribed, unsubscribed: row.unsubscribed };
}

async function rows(env, current, q, limit = 300) {
  const where = [STATUS[current]];
  const binds = [];
  const text = String(q || '').trim().toLowerCase().slice(0, 80);
  if (text) { binds.push('%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); where.push(`(lower(name) LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\')`); }
  const { results } = await env.DB.prepare(`SELECT * FROM mailing_list WHERE ${where.join(' AND ')} ORDER BY subscribed_at DESC LIMIT ${limit}`).bind(...binds).all();
  return results || [];
}

export const joinUrls = (request, env) => ({ joinUrl: siteOrigin(request, env) + '/join', testUrl: new URL(request.url).origin + '/join',
  realConnected: siteOrigin(request, env) === new URL(request.url).origin });

export async function handleMailingAdmin({ request, env, url, method, path, form, page, csrf }) {
  if (!path.startsWith('/admin/mailing-list')) return null;
  const show = STATUS[url.searchParams.get('show')] ? url.searchParams.get('show') : 'subscribed';
  const q = String(url.searchParams.get('q') || '');

  if (path === '/admin/mailing-list') {
    if (method === 'GET') return page(view.mailingPage({ rows: await rows(env, show, q), counts: await counts(env), current: show, q, csrf: csrf.token, flash: url.searchParams.get('flash') }));
    const values = { name: String(form.fields.name || '').trim().slice(0, 80), email: normaliseEmail(form.fields.email) };
    const errors = {};
    if (!EMAIL_RE.test(values.email) || values.email.length > 254) errors.email = 'Please enter a full email address.';
    if (form.fields.consent !== '1') errors.consent = 'Only add people who have asked to join. Please tick to confirm.';
    if (Object.keys(errors).length) return page(view.mailingPage({ rows: await rows(env, show, q), counts: await counts(env), current: show, q, csrf: csrf.token, errors, values }), 422);
    const result = await subscribe(env, { ...values, source: 'Added in Admin', consent: 'Asked New Way’s to join the mailing list.' });
    return redirect('/admin/mailing-list?flash=' + (result === 'already' ? 'already' : 'added'));
  }

  if (path === '/admin/mailing-list/export.csv') {
    const list = await rows(env, url.searchParams.get('status') === 'all' ? 'all' : 'subscribed', '', 100000);
    const fmt = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '');
    const body = csv([['Name', 'Email', 'Status', 'Subscribed', 'Source', 'Unsubscribed'], ...list.map((r) => [r.name, r.email, r.status, fmt(r.subscribed_at), r.source, fmt(r.unsubscribed_at)])]);
    return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="new-ways-mailing-list-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  }

  if (path === '/admin/mailing-list/join-qr.png') {
    const { joinUrl } = joinUrls(request, env);
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' };
    if (url.searchParams.has('download')) headers['Content-Disposition'] = 'attachment; filename="new-ways-join-mailing-list-qr.png"';
    return new Response(qrPng(joinUrl, { scale: 16, border: 4 }), { headers });
  }

  if (path === '/admin/mailing-list/join-page') {
    if (method === 'GET') return page(view.joinAdminPage({ wording: await joinWording(env), ...joinUrls(request, env), csrf: csrf.token, flash: url.searchParams.get('flash') }));
    const values = {}, errors = {};
    for (const f of JOIN_FIELDS) {
      const v = String(form.fields[f.key] ?? '').replace(/\r\n?/g, '\n').trim();
      if (!v) errors[f.key] = 'This is needed.';
      else if (v.length > f.max) errors[f.key] = `Please keep this under ${f.max} characters.`;
      values[f.key] = v || JOIN_DEFAULTS[f.key];
    }
    if (Object.keys(errors).length) return page(view.joinAdminPage({ wording: { ...values }, ...joinUrls(request, env), csrf: csrf.token, errors }), 422);
    await env.DB.batch([
      ...Object.entries(values).map(([k, v]) => env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .bind(k, v, new Date().toISOString())),
      data.audit(env, 'mailing.join-page', 'Join page wording changed')
    ]);
    return redirect('/admin/mailing-list/join-page?flash=saved');
  }

  const rm = path.match(/^\/admin\/mailing-list\/(\d{1,9})\/(unsubscribe|resubscribe|delete)$/);
  if (!rm) return null;
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  const id = Number(rm[1]);
  const now = new Date().toISOString();
  if (rm[2] === 'unsubscribe') await env.DB.prepare(`UPDATE mailing_list SET status = 'unsubscribed', unsubscribed_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'subscribed'`).bind(now, id).run();
  if (rm[2] === 'resubscribe') await env.DB.prepare(`UPDATE mailing_list SET status = 'subscribed', unsubscribed_at = NULL, subscribed_at = ?1, source = 'Subscribed again in Admin', consent_text = 'Asked New Way’s to join again (confirmed by Gary in Admin).', updated_at = ?1 WHERE id = ?2`).bind(now, id).run();
  if (rm[2] === 'delete') await env.DB.batch([env.DB.prepare('DELETE FROM mailing_list WHERE id = ?1').bind(id), data.audit(env, 'mailing.delete', `Mailing-list entry ${id} deleted`)]);
  return redirect('/admin/mailing-list?flash=' + { unsubscribe: 'unsubscribed', resubscribe: 'resubscribed', delete: 'deleted' }[rm[2]]);
}
