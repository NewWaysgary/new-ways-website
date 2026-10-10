// Admin > Admin team (owner only): people with FULL Admin, such as Julie. A full Admin signs in with their own
// account (WorkOS, their own password) and can use everything in Admin that Gary can, except this page: only the owner
// can add or remove full Admins. Check-in helpers (check-in only) are separate and unchanged (Admin > Check in > Helpers).
import { textResponse, redirect } from '../lib/http.js';
import { normaliseEmail } from '../lib/emails.js';
import { EMAIL_RE } from '../bookings/config.js';
import * as data from '../lib/data.js';
import * as view from '../views/admin-team.js';

export async function handleTeam({ env, url, method, path, form, page, csrf, admin }) {
  if (path !== '/admin/team' && !path.startsWith('/admin/team/')) return null;
  if (admin.role !== 'owner') {
    const body = view.ownerOnlyPage({ csrf: csrf.token });
    return method === 'GET' ? page(body, 403) : textResponse('Only the owner can change the Admin team.', { status: 403 });
  }
  const list = async () => (await env.DB.prepare('SELECT * FROM admin_users ORDER BY active DESC, name COLLATE NOCASE').all()).results || [];
  if (path === '/admin/team') {
    if (method === 'GET') return page(view.teamPage({ members: await list(), csrf: csrf.token, flash: url.searchParams.get('flash') }));
    const values = { name: String(form.fields.name || '').trim().replace(/\s+/g, ' ').slice(0, 80), email: normaliseEmail(form.fields.email) };
    const errors = {};
    if (!values.name) errors.name = 'Please enter their name.';
    if (!EMAIL_RE.test(values.email)) errors.email = 'Please enter their full email address.';
    else if (values.email === normaliseEmail(env.OWNER_EMAIL)) errors.email = 'That is your own (owner) address.';
    else if (await env.DB.prepare('SELECT 1 FROM admin_users WHERE email = ?1').bind(values.email).first()) errors.email = 'That person already has full Admin.';
    if (Object.keys(errors).length) return page(view.teamPage({ members: await list(), csrf: csrf.token, errors, values }), 422);
    await env.DB.batch([env.DB.prepare('INSERT INTO admin_users (email, name) VALUES (?1, ?2)').bind(values.email, values.name),
      data.audit(env, 'team.add', `Full Admin added: ${values.name}`)]);
    return redirect('/admin/team?flash=added');
  }
  const m = path.match(/^\/admin\/team\/(\d{1,9})\/(off|on|remove)$/);
  if (!m) return null;
  if (method !== 'POST') return textResponse('Method not allowed', { status: 405 });
  const id = Number(m[1]);
  const member = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?1').bind(id).first();
  if (!member) return redirect('/admin/team');
  // Switching off or removing signs them out straight away, everywhere
  const signOut = env.DB.prepare(`DELETE FROM admin_sessions WHERE role = 'admin' AND admin_user_id = ?1`).bind(id);
  const unsubscribePush = env.DB.prepare(`DELETE FROM push_subscriptions WHERE who = ?1`).bind('admin:' + id);
  if (m[2] === 'off') await env.DB.batch([env.DB.prepare('UPDATE admin_users SET active = 0 WHERE id = ?1').bind(id), signOut, unsubscribePush, data.audit(env, 'team.off', `Full Admin switched off: ${member.name}`)]);
  if (m[2] === 'on') await env.DB.batch([env.DB.prepare('UPDATE admin_users SET active = 1 WHERE id = ?1').bind(id), data.audit(env, 'team.on', `Full Admin switched on: ${member.name}`)]);
  if (m[2] === 'remove') await env.DB.batch([env.DB.prepare('DELETE FROM admin_users WHERE id = ?1').bind(id), signOut, unsubscribePush, data.audit(env, 'team.remove', `Full Admin removed: ${member.name}`)]);
  return redirect('/admin/team?flash=' + (m[2] === 'remove' ? 'removed' : m[2]));
}
