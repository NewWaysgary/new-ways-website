// New Way's Community: thank-you cards in the database, the background rotation and Who's On suggestions.
import { BACKGROUNDS, ROLES, FONTS, cleanLayout, parseLayout } from './card.js';
import { longDate, isIsoDate, ukToday } from '../lib/dates.js';

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

// Next Design: the design after this one, in order, going round
export function nextDesign(bg) {
  const i = BACKGROUNDS.indexOf(bg);
  return BACKGROUNDS[(i + 1) % BACKGROUNDS.length];
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

export function rotationStatement(env, rotation, bg) {
  const next = afterUsing(rotation, bg);
  return env.DB.prepare(`INSERT INTO community_rotation (id, used, last, updated_at) VALUES (1, ?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(id) DO UPDATE SET used = excluded.used, last = excluded.last, updated_at = excluded.updated_at`).bind(JSON.stringify(next.used), next.last);
}

export async function markBackgroundUsed(env, bg) {
  await rotationStatement(env, await getRotation(env), bg).run();
  return getRotation(env);
}

// ---------- addresses ----------
export function slugify(text) {
  return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
}

export function postPath(post) {
  return `/community/${post.id}${post.slug ? '-' + post.slug : ''}`;
}

export function cardTitle(name) {
  return name ? `Thank you, ${name}` : 'Thank you';
}

// "Wednesday 14 October 2026"
export function cardDate(iso) {
  return isIsoDate(iso) ? longDate(iso, '0000-01-01') : '';
}

// ---------- reading cards ----------
// Only published cards are ever shown to the public.
export async function getPublishedPost(env, id) {
  return env.DB.prepare(`SELECT * FROM community_posts WHERE id = ?1 AND status = 'published'`).bind(id).first();
}

export async function getPost(env, id) {
  return env.DB.prepare('SELECT * FROM community_posts WHERE id = ?1').bind(id).first();
}

export async function listPosts(env) {
  const { results } = await env.DB.prepare(`SELECT id, slug, status, title, medium_name, wed_date, background, share_key, created_at, updated_at, published_at, updated_by, kind, art_key
    FROM community_posts ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, COALESCE(published_at, updated_at) DESC, id DESC`).all();
  return results || [];
}

// ---------- Who's On suggestions ----------
// Guest mediums from Who's On around now (the last six weeks and the coming week), newest first, and the best guess
// for a new card: the most recent one on or before today, otherwise the next one coming up.
export async function whosOnChoices(env, today = ukToday()) {
  const from = shiftDays(today, -42), to = shiftDays(today, 7);
  const { results } = await env.DB.prepare(`SELECT id, date, name FROM mediums WHERE visible = 1 AND date >= ?1 AND date <= ?2 AND TRIM(name) != ''
    ORDER BY date DESC, sort_order, id LIMIT 30`).bind(from, to).all();
  const list = (results || []).map((m) => ({ id: m.id, date: m.date, name: String(m.name).trim().slice(0, 80) }));
  const suggestion = list.find((m) => m.date <= today) || list[list.length - 1] || null;
  return { list, suggestion };
}

function shiftDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- the editor's form → a checked card ----------
const LINE_HEIGHT = { heading: 1.1, name: 1.15, message: 1.25, date: 1.15 };
const MAX_LINES = { heading: 2, name: 1, message: 4, date: 1 };

export function cardFromForm(fields, existingLayout) {
  const f = (k) => (fields[k] === undefined || fields[k] === null ? '' : String(fields[k]));
  const errors = {};
  const name = f('medium_name').replace(/\s+/g, ' ').trim();
  if (!name) errors.medium_name = 'Please enter the guest medium’s name.';
  else if (name.length > 80) errors.medium_name = 'Please keep the name under 80 characters.';
  const wedDate = f('wed_date').trim();
  if (wedDate && !isIsoDate(wedDate)) errors.wed_date = 'Please choose a proper date.';
  const background = BACKGROUNDS.includes(f('background')) ? f('background') : (existingLayout && existingLayout.background) || BACKGROUNDS[0];
  const before = Object.fromEntries(((existingLayout && existingLayout.texts) || []).filter((t) => t.role).map((t) => [t.role, t]));
  const texts = [];
  for (const role of ROLES) {
    const old = before[role] || {};
    const lines = role === 'name' ? [name] : f(role + '_text').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > MAX_LINES[role]) errors[role + '_text'] = `Please use no more than ${MAX_LINES[role]} lines here.`;
    if (lines.some((l) => l.length > 120)) errors[role + '_text'] = 'Please keep each line under 120 characters.';
    if (!lines.length) continue;   // an empty block is simply left off the card
    const pick = (k, fallback) => (fields[role + '_' + k] !== undefined && fields[role + '_' + k] !== '' ? fields[role + '_' + k] : (old[k] !== undefined ? old[k] : fallback));
    const font = pick('font', 'cinzel');
    texts.push({
      role, lines: lines.slice(0, MAX_LINES[role]),
      x: pick('x', 640), y: pick('y', 300), anchor: pick('anchor', 'middle'), font: Object.hasOwn(FONTS, font) ? font : 'cinzel',
      size: pick('size', 40), weight: pick('weight', 600), color: pick('color', '#FFFFFF'), lineHeight: LINE_HEIGHT[role], spacing: role === 'heading' ? 2 : 0
    });
  }
  const oldBadge = (existingLayout && existingLayout.badge) || {};
  const layout = cleanLayout({
    background, texts,
    badge: { show: f('badge_show') === '1', x: f('badge_x') || oldBadge.x, y: f('badge_y') || oldBadge.y, size: f('badge_size') || oldBadge.size },
    shimmer: f('animate_logo') === '1', shadow: f('text_shadow') === '1'
  });
  return { errors, values: { medium_name: name, wed_date: wedDate, title: cardTitle(name), background, animate_logo: layout.shimmer ? 1 : 0, text_shadow: layout.shadow ? 1 : 0 }, layout };
}

export { parseLayout };
