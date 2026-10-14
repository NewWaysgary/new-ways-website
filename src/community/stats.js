// New Way's Community: private visitor statistics for Gary and Julie (Admin › Community launch › Statistics).
// No cookies, no accounts, no IP addresses stored, no outside analytics. Each visit adds to a daily total. To count a
// visitor only once a day, a scrambled code is made from their network, browser and a secret that changes every day;
// those codes are deleted after two days, so visitors can't be followed from one day to the next. A visit is counted
// once per visitor, per page, per day, so refreshing a page doesn't inflate the totals.
// Admin pages (and Admin previews) are never counted, nor are search engines, link previews and other programs.
import { ukToday } from '../lib/dates.js';

const DAILY_CAP = 5000;
const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|preview|embedly|linkedin|twitterbot|discord|skype|curl|wget|python|headless|lighthouse|monitor/i;

export function fromFacebook(request, url) {
  const ref = String(request.headers.get('Referer') || '');
  const ua = String(request.headers.get('User-Agent') || '');
  return url.searchParams.has('fbclid') || /(?:^|\.)facebook\.com|(?:^|\.)fb\.com|(?:^|\.)fb\.me|m\.facebook|l\.facebook|lm\.facebook/i.test(ref.replace(/^https?:\/\//, '').split('/')[0])
    || /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger/i.test(ua);
}

async function dailyCode(env, request, day) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const ua = String(request.headers.get('User-Agent') || '').slice(0, 200);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('stats|' + day + '|' + String(env.SESSION_SECRET || 'nw')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip + '|' + ua));
  return [...new Uint8Array(sig)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Called for each visitor page view of the Community list (postId 0) or a card. Never throws.
export async function countVisit(env, request, url, postId) {
  try {
    if (request.method !== 'GET' || BOTS.test(String(request.headers.get('User-Agent') || '')) || /prefetch|prerender/i.test(String(request.headers.get('Purpose') || request.headers.get('Sec-Purpose') || ''))) return;
    const day = ukToday();
    // Safety cap: after 5,000 different visitors in a day, stop counting, so a flood of fake visits can never use up
    // the database's free daily allowance that bookings and payments rely on.
    const today = await env.DB.prepare('SELECT uniques FROM community_stats WHERE day = ?1 AND post_id = -1').bind(day).first('uniques');
    if ((today || 0) >= DAILY_CAP) return;
    const code = await dailyCode(env, request, day);
    const fb = fromFacebook(request, url) ? 1 : 0;
    const results = await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO community_seen (day, code, post_id) VALUES (?1, ?2, ?3)').bind(day, code, postId),
      env.DB.prepare('INSERT OR IGNORE INTO community_seen (day, code, post_id) VALUES (?1, ?2, -1)').bind(day, code)
    ]);
    const newHere = results[0].meta && results[0].meta.changes ? 1 : 0;
    const newToday = results[1].meta && results[1].meta.changes ? 1 : 0;
    // A visit is counted once per visitor, per page, per day (refreshing the page doesn't add more)
    if (!newHere) return;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO community_stats (day, post_id, visits, uniques, facebook) VALUES (?1, ?2, 1, ?3, ?4)
        ON CONFLICT(day, post_id) DO UPDATE SET visits = visits + 1, uniques = uniques + ?3, facebook = facebook + ?4`).bind(day, postId, newHere, fb),
      env.DB.prepare(`INSERT INTO community_stats (day, post_id, visits, uniques, facebook) VALUES (?1, -1, 1, ?2, ?3)
        ON CONFLICT(day, post_id) DO UPDATE SET visits = visits + 1, uniques = uniques + ?2, facebook = facebook + ?3`).bind(day, newToday, fb)
    ]);
  } catch (err) {
    console.error("New Way's: could not count a Community visit:", err && err.message);
  }
}

export async function removeOldSeen(env) {
  const d = new Date(ukToday() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 2);
  await env.DB.prepare('DELETE FROM community_seen WHERE day < ?1').bind(d.toISOString().slice(0, 10)).run();
}

function daysAgo(n) {
  const d = new Date(ukToday() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function statsSummary(env) {
  const today = ukToday();
  const sum = (from) => env.DB.prepare(`SELECT COALESCE(SUM(visits), 0) AS visits, COALESCE(SUM(uniques), 0) AS uniques, COALESCE(SUM(facebook), 0) AS facebook
    FROM community_stats WHERE post_id = -1 AND day >= ?1`).bind(from).first();
  const [all, t, d7, d30, cards, days] = await Promise.all([
    sum('0000-00-00'), sum(today), sum(daysAgo(6)), sum(daysAgo(29)),
    env.DB.prepare(`SELECT s.post_id, p.title, p.slug, SUM(s.visits) AS visits, SUM(s.uniques) AS uniques, SUM(s.facebook) AS facebook
      FROM community_stats s LEFT JOIN community_posts p ON p.id = s.post_id WHERE s.post_id >= 0 GROUP BY s.post_id ORDER BY visits DESC LIMIT 100`).all(),
    env.DB.prepare(`SELECT day, visits, uniques, facebook FROM community_stats WHERE post_id = -1 AND day >= ?1 ORDER BY day DESC`).bind(daysAgo(29)).all()
  ]);
  return { all, today: t, d7, d30, cards: cards.results || [], days: days.results || [] };
}
