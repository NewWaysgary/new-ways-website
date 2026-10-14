// New Way's Community: drawing a published card on a page, whichever editor made it.
//   kind 'card'   (original editor): background + wording + badge, all drawn from the layout (card.js);
//   kind 'design' (Designer): the finished artwork picture (everything except the badge), with the official badge
//                 on top as its own layer so it can still shimmer.
import { html, raw } from '../lib/html.js';
import '../../public/js/community-card.js';
import { renderCard, parseLayout, cardWording, BACKGROUNDS } from './card.js';

const N = globalThis.NWCard;
export const DESIGN_W = 1733, DESIGN_H = 910;

export function parseDesign(json) {
  let d;
  try { d = JSON.parse(String(json || '{}')); } catch { d = {}; }
  if (!d || typeof d !== 'object') d = {};
  const b = d.badge && typeof d.badge === 'object' ? d.badge : {};
  const num = (v, min, max, f) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : f);
  return {
    ...d,
    badge: { show: b.show !== false, x: num(b.x, 0, DESIGN_W, 1530), y: num(b.y, 0, DESIGN_H, 190), size: num(b.size, 50, 800, 260) },
    shimmer: d.shimmer !== false,
    words: String(d.words || '').slice(0, 600)
  };
}

export function cardLayoutOf(post) {
  const layout = parseLayout(post.layout_json);
  layout.shimmer = post.animate_logo === 1;
  layout.shadow = post.text_shadow === 1;
  if (BACKGROUNDS.includes(post.background)) layout.background = post.background;
  return layout;
}

export function wordsOf(post) {
  if (post.kind === 'design') return parseDesign(post.design_json).words || post.title || '';
  return cardWording(cardLayoutOf(post));
}

export function postCard(post, { priority = false, uid = '' } = {}) {
  const id = uid || 'p' + post.id;
  if (post.kind !== 'design') return renderCard(cardLayoutOf(post), { priority, uid: id });
  const d = parseDesign(post.design_json);
  const s = N.W / DESIGN_W;   // the badge is placed in the 1200 x 630 drawing space used by every card
  const layer = N.layerSvg({ texts: [], shimmer: post.animate_logo === 1, badge: { show: d.badge.show, x: d.badge.x * s, y: d.badge.y * s, size: d.badge.size * s } }, id, wordsOf(post) || post.title);
  return html`<div class="nwc-card nwc-design${post.animate_logo === 1 ? ' nwc-animate' : ''}">
<img class="nwc-bg" src="/media/${post.art_key}" width="1733" height="910" alt=""${priority ? raw(' fetchpriority="high"') : raw(' loading="lazy"')} decoding="async">
${raw(layer)}
</div>`;
}
