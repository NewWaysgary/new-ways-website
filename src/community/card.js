// New Way's Community: the thank-you card on the server.
// The drawing rules live in ONE shared file, public/js/community-card.js, which the website uses here and Admin's card
// editor uses on the phone, so the website card, the editor's live preview and the Facebook image always match.
import '../../public/js/community-card.js';
import { raw } from '../lib/html.js';

const N = globalThis.NWCard;

export const CARD_W = N.W;
export const CARD_H = N.H;
export const BACKGROUNDS = N.BACKGROUNDS;
export const FONTS = N.FONTS;
export const FONT_NAMES = N.FONT_NAMES;
export const ROLES = N.ROLES;
export const BADGE_SRC = N.BADGE_SRC;
export const COMMUNITY_CSS = '/css/community.css?v=2';        // change the number whenever community.css changes
export const CARD_JS = '/js/community-card.js?v=1';           // change the number whenever community-card.js changes
export const EDITOR_JS = '/js/community-editor.js?v=1';       // change the number whenever community-editor.js changes
// The extra lettering choices for cards (Cinzel and Jost are already loaded by every page)
export const CARD_FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Jost:wght@400;500;600;700&family=Cormorant+Garamond:wght@500;600;700&family=Great+Vibes&display=swap';

export const backgroundSources = N.backgroundSources;
export const cleanLayout = N.cleanLayout;
export const cardWording = N.cardWording;

export function parseLayout(json) {
  try { return cleanLayout(JSON.parse(String(json || '{}'))); } catch { return cleanLayout({}); }
}

// The sample card used in Admin's design preview (clearly marked as a sample)
export function sampleLayout(background = BACKGROUNDS[0], { shimmer = true, shadow = true } = {}) {
  return cleanLayout({
    background, shimmer, shadow,
    badge: { show: true, x: 1062, y: 132, size: 180 },
    texts: [
      { role: 'heading', lines: ['Thank You'], x: 640, y: 180, font: 'cinzel', size: 88, weight: 700, color: '#F8B709', spacing: 2, lineHeight: 1.1 },
      { role: 'name', lines: ['Sample Medium Name'], x: 640, y: 262, font: 'cinzel', size: 50, weight: 600, color: '#FFFFFF' },
      { role: 'message', lines: ['for a wonderful Wednesday evening', 'at New Way’s'], x: 640, y: 322, font: 'jost', size: 32, weight: 500, color: '#FFED81', lineHeight: 1.25 }
    ]
  });
}

// A new card's starting layout: the approved sample design, with the medium's name and the Wednesday's date
export function newCardLayout({ background, name, dateText }) {
  const L = sampleLayout(background, { shimmer: true, shadow: true });
  L.texts[1].lines = [name || 'Guest Medium'];
  if (dateText) L.texts.push({ role: 'date', lines: [dateText], x: 640, y: 420, anchor: 'middle', font: 'jost', size: 26, weight: 400, color: '#FFFFFF', lineHeight: 1.15, spacing: 0 });
  return cleanLayout(L);
}

let cardCounter = 0;
export function renderCard(layout, { alt = '', priority = false, uid = '' } = {}) {
  return raw(N.cardHtml(layout, { id: uid || 'c' + (++cardCounter).toString(36), alt, priority }));
}
