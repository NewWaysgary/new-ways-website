// New Way's Community: the launch switch and the official commenting switches (Admin › Community launch).
//   launch 'off'      the Community is hidden: no list page, no card pages (even by direct link), nothing can be posted;
//   launch 'testing'  card links and the Community page work and visitors can react, comment, report and turn on
//                     notifications, but it is still NOT in the website's menu or sitemap and Google is asked not to list it;
//   launch 'live'     the Community is in the website's menu and sitemap and can be found on Google.
export const LAUNCH_STATES = ['off', 'testing', 'live'];

export async function getConfig(env) {
  const out = { launch: 'off', official_gary: '0', official_julie: '0' };
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM community_config').all();
    for (const r of results || []) out[r.key] = r.value;
  } catch { /* before the database update: everything stays off */ }
  if (!LAUNCH_STATES.includes(out.launch)) out.launch = 'off';
  return out;
}

export async function launchState(env) {
  return (await getConfig(env)).launch;
}

export function setConfig(env, key, value, who) {
  return env.DB.prepare(`INSERT INTO community_config (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(key, String(value), who);
}

// Which official identity an Admin sign-in has. Gary is the owner; Julie is the full Admin whose Admin team name is
// Julie. Anyone else (another full Admin, a check-in helper) has no official identity and cannot post officially.
// Only Gary (the owner) can add full Admins. If more than one active full Admin is called Julie, nobody gets the
// Julie identity until that is sorted out, so it can never be shared or taken over by a second account.
export async function officialIdentity(env, admin) {
  if (!admin) return '';
  if (admin.role === 'owner') return 'gary';
  if (admin.role !== 'admin' || !JULIE.test(String(admin.name || '')) || !admin.adminUserId) return '';
  try {
    const { results } = await env.DB.prepare('SELECT id, name FROM admin_users WHERE active = 1').all();
    const julies = (results || []).filter((r) => JULIE.test(String(r.name || '')));
    return julies.length === 1 && julies[0].id === admin.adminUserId ? 'julie' : '';
  } catch { return ''; }
}
const JULIE = /\bjulie\b/i;
export const OFFICIAL_NAMES = { gary: 'Admin Gary', julie: 'Admin Julie' };
