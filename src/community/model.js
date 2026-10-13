// New Way's Community: reading cards and the background rotation.
import { BACKGROUNDS } from './card.js';

// ---------- the nine-design rotation: each design is used once before any repeats ----------
// `used` = designs already used in this round; `last` = the design used most recently.
// The suggestion is the first design (in order 01, 02, 03, 04, 05, 06, 08, 09, 10) not yet used in this round.
// When a round is complete, the next round starts again from the beginning, except it never starts with the
// design that was just used, so the same background never appears twice in a row.
export function suggestBackground(rotation) {
  const used = cleanUsed(rotation && rotation.used);
  const last = rotation && BACKGROUNDS.includes(rotation.last) ? rotation.last : '';
  const left = BACKGROUNDS.filter((b) => !used.includes(b));
  const pool = left.length ? left : BACKGROUNDS;
  return pool.find((b) => b !== last) || pool[0];
}

// After a card is published with `bg` (chosen by the rotation or picked by hand), mark it used.
// A round is complete when all nine have been used; the next round then begins empty.
export function afterUsing(rotation, bg) {
  if (!BACKGROUNDS.includes(bg)) return { used: cleanUsed(rotation && rotation.used), last: (rotation && rotation.last) || '' };
  const used = cleanUsed(rotation && rotation.used).filter((b) => b !== bg).concat(bg);
  return { used: used.length >= BACKGROUNDS.length ? [] : used, last: bg };
}

function cleanUsed(list) {
  let arr = list;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
  return Array.isArray(arr) ? BACKGROUNDS.filter((b) => arr.includes(b)) : [];
}

export async function getRotation(env) {
  const row = await env.DB.prepare('SELECT used, last FROM community_rotation WHERE id = 1').first();
  return { used: cleanUsed(row && row.used), last: (row && row.last) || '' };
}

export async function markBackgroundUsed(env, bg) {
  const next = afterUsing(await getRotation(env), bg);
  await env.DB.prepare(`INSERT INTO community_rotation (id, used, last, updated_at) VALUES (1, ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(id) DO UPDATE SET used = excluded.used, last = excluded.last, updated_at = excluded.updated_at`).bind(JSON.stringify(next.used), next.last).run();
  return next;
}

// ---------- cards ----------
export function slugify(text) {
  return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
}

export function postPath(post) {
  return `/community/${post.id}${post.slug ? '-' + post.slug : ''}`;
}

// Only published cards are ever shown to the public.
export async function getPublishedPost(env, id) {
  return env.DB.prepare(`SELECT * FROM community_posts WHERE id = ?1 AND status = 'published'`).bind(id).first();
}
