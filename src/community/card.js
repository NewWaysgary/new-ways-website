// New Way's Community: the thank-you card.
//
// A card is drawn in layers, so nothing is flattened into the background on the website:
//   1. the background picture (one of the nine approved designs, as a normal <img> with phone and desktop sizes),
//   2. on top, an SVG drawing 1200 x 630 units wide (the exact size of the Facebook picture) holding the wording as
//      real text and the official New Way's badge as its own layer, with its gold shimmer.
// Positions are numbers in that 1200 x 630 space, given as attributes, so the website's security rules (no inline
// styles) stay exactly as they are, and the Facebook picture can later be drawn from the very same layout.
import { html, raw } from '../lib/html.js';

export const CARD_W = 1200;
export const CARD_H = 630;

// The nine approved designs (design 07 is not part of the set). Files: /images/community/bg-NN-{800,1200,full}.webp
export const BACKGROUNDS = ['01', '02', '03', '04', '05', '06', '08', '09', '10'];
const FULL_WIDTH = { '02': 1732, '06': 1732 };   // two originals were one pixel narrower
export const BADGE_SRC = '/images/logo-720.webp';
export const COMMUNITY_CSS = '/css/community.css?v=1';   // change the number whenever community.css changes

export const FONTS = {
  cinzel: "'Cinzel', 'Trajan Pro', Georgia, serif",
  jost: "'Jost', 'Helvetica Neue', Arial, sans-serif"
};
const WEIGHTS = [400, 500, 600, 700];
const ANCHORS = ['start', 'middle', 'end'];

export function backgroundSources(id) {
  const bg = BACKGROUNDS.includes(id) ? id : BACKGROUNDS[0];
  const full = FULL_WIDTH[bg] || 1733;
  const base = `/images/community/bg-${bg}-`;
  return { src: base + '1200.webp', srcset: `${base}800.webp 800w, ${base}1200.webp 1200w, ${base}full.webp ${full}w` };
}

// ---------- the layout, always checked on the server before it is saved or drawn ----------
const num = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : fallback;
};
const cleanLine = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
const colour = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : fallback);

export function cleanLayout(input) {
  const src = input && typeof input === 'object' ? input : {};
  const texts = (Array.isArray(src.texts) ? src.texts : []).slice(0, 8).map((t) => {
    const lines = (Array.isArray(t && t.lines) ? t.lines : [t && t.text]).map(cleanLine).filter((l) => l !== '').slice(0, 6);
    return {
      lines,
      x: num(t.x, 0, CARD_W, CARD_W / 2),
      y: num(t.y, 0, CARD_H, CARD_H / 2),
      anchor: ANCHORS.includes(t.anchor) ? t.anchor : 'middle',
      font: Object.hasOwn(FONTS, t.font) ? t.font : 'cinzel',
      size: num(t.size, 10, 160, 48),
      weight: WEIGHTS.includes(Number(t.weight)) ? Number(t.weight) : 600,
      color: colour(t.color, '#FFFFFF'),
      lineHeight: num(t.lineHeight, 0.8, 2.5, 1.15),
      spacing: num(t.spacing, 0, 30, 0)
    };
  }).filter((t) => t.lines.length);
  const b = src.badge && typeof src.badge === 'object' ? src.badge : {};
  return {
    v: 1,
    background: BACKGROUNDS.includes(src.background) ? src.background : BACKGROUNDS[0],
    texts,
    badge: { show: b.show !== false, x: num(b.x, 0, CARD_W, 1040), y: num(b.y, 0, CARD_H, 150), size: num(b.size, 40, 600, 200) },
    shimmer: src.shimmer !== false,
    shadow: src.shadow === true
  };
}

export function parseLayout(json) {
  try { return cleanLayout(JSON.parse(String(json || '{}'))); } catch { return cleanLayout({}); }
}

// Everything the card says, in reading order (for screen readers and the page description)
export function cardWording(layout) {
  return layout.texts.map((t) => t.lines.join(' ')).join('. ');
}

// The sample card used in Admin's preview (clearly marked as a sample)
export function sampleLayout(background = BACKGROUNDS[0], { shimmer = true, shadow = true } = {}) {
  return cleanLayout({
    background, shimmer, shadow,
    badge: { show: true, x: 1062, y: 132, size: 180 },
    texts: [
      { lines: ['Thank You'], x: 640, y: 180, font: 'cinzel', size: 88, weight: 700, color: '#F8B709', spacing: 2 },
      { lines: ['Sample Medium Name'], x: 640, y: 262, font: 'cinzel', size: 50, weight: 600, color: '#FFFFFF' },
      { lines: ['for a wonderful Wednesday evening', 'at New Way’s'], x: 640, y: 322, font: 'jost', size: 32, weight: 500, color: '#FFED81', lineHeight: 1.25 }
    ]
  });
}

// ---------- drawing the card ----------
let cardCounter = 0;

export function renderCard(layout, { alt = '', priority = false, uid = '' } = {}) {
  const L = cleanLayout(layout);
  const id = uid || 'c' + (++cardCounter).toString(36);
  const bg = backgroundSources(L.background);
  const words = alt || cardWording(L) || 'New Way’s thank-you card';
  const shadow = L.shadow ? `url(#nwc-sh-${id})` : null;
  const badge = L.badge.show ? renderBadge(L.badge, id, L.shimmer) : '';
  return html`<div class="nwc-card${L.shimmer ? ' nwc-animate' : ''}">
<img class="nwc-bg" src="${bg.src}" srcset="${bg.srcset}" sizes="(max-width: 760px) 100vw, 760px" width="1200" height="628" alt=""${priority ? raw(' fetchpriority="high"') : raw(' loading="lazy"')} decoding="async">
<svg class="nwc-layer" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-label="${words}" focusable="false">
<defs>
${L.shadow ? html`<filter id="nwc-sh-${id}" x="-20%" y="-40%" width="140%" height="180%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000428" flood-opacity="0.85"/><feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="#000428" flood-opacity="0.7"/></filter>` : ''}
${badge ? badge.defs : ''}
</defs>
${badge ? badge.body : ''}
${L.texts.map((t) => html`<text x="${t.x}" y="${t.y}" text-anchor="${t.anchor}" font-family="${FONTS[t.font]}" font-size="${t.size}" font-weight="${t.weight}" fill="${t.color}"${t.spacing ? raw(` letter-spacing="${t.spacing}"`) : ''}${shadow ? raw(` filter="${shadow}"`) : ''}>${t.lines.map((line, i) => html`<tspan x="${t.x}"${i ? raw(` dy="${Math.round(t.size * t.lineHeight * 10) / 10}"`) : ''}>${line}</tspan>`)}</text>`)}
</svg>
</div>`;
}

// The official badge: the existing New Way's logo, shown as a circle (its square corners are dark), with a soft gold
// halo and, when the shimmer is on, a gentle band of gold light passing across it. The shimmer is CSS only
// (community.css), and visitors who have asked their phone for less motion see the badge still.
function renderBadge(b, id, shimmer) {
  const r = b.size / 2;
  const x = b.x - r, y = b.y - r;
  const band = b.size * 0.6;
  const clip = `nwc-bc-${id}`;
  const defs = html`<clipPath id="${clip}"><circle cx="${b.x}" cy="${b.y}" r="${round(r * 0.985)}"/></clipPath>
<radialGradient id="nwc-halo-${id}"><stop offset="0.62" stop-color="#F8B709" stop-opacity="0.55"/><stop offset="1" stop-color="#F8B709" stop-opacity="0"/></radialGradient>
${shimmer ? html`<linearGradient id="nwc-shine-${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFED81" stop-opacity="0"/><stop offset="0.45" stop-color="#FFF6C8" stop-opacity="0.55"/><stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.7"/><stop offset="1" stop-color="#FFED81" stop-opacity="0"/></linearGradient>` : ''}`;
  const body = html`<g class="nwc-badge">
<circle class="nwc-halo" cx="${b.x}" cy="${b.y}" r="${round(r * 1.22)}" fill="url(#nwc-halo-${id})"/>
<image href="${BADGE_SRC}" x="${round(x)}" y="${round(y)}" width="${b.size}" height="${b.size}" clip-path="url(#${clip})" preserveAspectRatio="xMidYMid slice"/>
${shimmer ? html`<g clip-path="url(#${clip})"><g transform="translate(${b.x} ${b.y}) skewX(-18) translate(${-b.x} ${-b.y})"><rect class="nwc-shine" x="${round(x - band)}" y="${round(y - r * 0.2)}" width="${round(band)}" height="${round(b.size * 1.4)}" fill="url(#nwc-shine-${id})"/></g></g>` : ''}
</g>`;
  return { defs, body };
}

const round = (n) => Math.round(n * 10) / 10;
