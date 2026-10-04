// YouTube links. Videos and livestreams stay on YouTube; New Way's only stores the link.
export function youtubeId(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(?:embed|live|shorts|v)\/([^/?#]+)/); if (m) id = m[1]; }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

// Any https link on youtube.com or youtu.be (for example a channel's /live page), or null
export function youtubePageUrl(input) {
  let s = String(input || '').trim();
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (u.protocol === 'https:' && (host === 'youtube.com' || host === 'youtu.be')) return u.toString();
  } catch { /* not a link */ }
  return null;
}

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
export const youtubeThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const embedSrc = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;

// Asks YouTube whether a video may be played on other websites. 'blocked', 'ok' or 'unknown'.
export async function embedCheck(request, env, id) {
  const host = new URL(request.url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  const base = local && env.YOUTUBE_OEMBED_URL ? env.YOUTUBE_OEMBED_URL : 'https://www.youtube.com/oembed';
  try {
    const res = await fetch(`${base}?format=json&url=${encodeURIComponent(watchUrl(id))}`);
    if (res.status === 401 || res.status === 403) return 'blocked';
    return res.ok ? 'ok' : 'unknown';
  } catch {
    return 'unknown';
  }
}
