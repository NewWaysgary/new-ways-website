// Line icons in the approved New Way's style (24px grid, 1.6 stroke, rounded joins).
import { raw } from './html.js';

const PATHS = {
  // from the approved app
  home: '<path d="M3.5 11L12 4l8.5 7"></path><path d="M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5"></path>',
  person: '<circle cx="12" cy="8.2" r="3.7"></circle><path d="M4.8 20.2c1-4 3.8-6.2 7.2-6.2s6.2 2.2 7.2 6.2"></path>',
  stars: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"></path><path d="M18.6 15.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"></path>',
  lotus: '<path d="M12 4.5c2 2.3 3 4.7 3 7.2 0 2.4-1.1 4.4-3 5.8-1.9-1.4-3-3.4-3-5.8 0-2.5 1-4.9 3-7.2z"></path><path d="M12 17.5c-4.2 0-7.7-2.6-9-7 2.3-.5 4.6-.2 6.6.9"></path><path d="M12 17.5c4.2 0 7.7-2.6 9-7-2.3-.5-4.6-.2-6.6.9"></path><path d="M7 20.5h10"></path>',
  book: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"></rect><path d="M3.5 9.8h17M8 3v4M16 3v4"></path><path d="M9 15.2l2.1 2.1 4-4.2"></path>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"></rect><path d="M3.5 9.8h17M8 3v4M16 3v4"></path>',
  clock: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path>',
  ticket: '<path d="M3.5 7.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2.6a2 2 0 0 0 0 3.8v2.6a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2.6a2 2 0 0 0 0-3.8z"></path><path d="M14.5 6.5v11" stroke-dasharray="1.6 2.2"></path>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"></path><circle cx="12" cy="10" r="2.4"></circle>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"></rect><circle cx="9" cy="10" r="1.8"></circle><path d="M20.5 16l-5-5-8.5 8.5"></path>',
  chev: '<path d="M9 5.5l6.5 6.5L9 18.5"></path>',
  // new sections, drawn to match
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"></path>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"></path>',
  circle: '<circle cx="12" cy="12" r="3.2"></circle><circle cx="12" cy="4.6" r="1.6"></circle><circle cx="18.4" cy="8.3" r="1.6"></circle><circle cx="18.4" cy="15.7" r="1.6"></circle><circle cx="12" cy="19.4" r="1.6"></circle><circle cx="5.6" cy="15.7" r="1.6"></circle><circle cx="5.6" cy="8.3" r="1.6"></circle>',
  info: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 11v5.5M12 7.6v.4"></path>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"></path>',
  play: '<rect x="3.5" y="5" width="17" height="14" rx="3"></rect><path d="M10.4 9.3v5.4l4.5-2.7z"></path>',
  live: '<circle cx="12" cy="12" r="2.4"></circle><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"></path>',
  quote: '<path d="M10 7.5c-2.8.8-4.5 2.9-4.5 5.6V17h4.5v-4.5H7.6c.2-1.5 1-2.6 2.4-3.2"></path><path d="M18.5 7.5c-2.8.8-4.5 2.9-4.5 5.6V17h4.5v-4.5h-2.4c.2-1.5 1-2.6 2.4-3.2"></path>',
  question: '<circle cx="12" cy="12" r="8.5"></circle><path d="M9.7 9.5a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.5v.5"></path><path d="M12 16.4v.4"></path>',
  shield: '<path d="M12 3.5l7 2.6v5.4c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6.1z"></path>',
  phone: '<path d="M6.8 3.8h2.6l1.4 4-1.8 1.3a10.5 10.5 0 0 0 5.9 5.9l1.3-1.8 4 1.4v2.6a1.9 1.9 0 0 1-2 1.9A15.5 15.5 0 0 1 4.9 5.8a1.9 1.9 0 0 1 1.9-2z"></path>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"></rect><path d="M4 7l8 6 8-6"></path>',
  car: '<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"></path><path d="M4 16.5h16M5 12h14"></path><circle cx="8" cy="16.5" r="1.6"></circle><circle cx="16" cy="16.5" r="1.6"></circle>',
  bus: '<rect x="5" y="3.5" width="14" height="14" rx="3"></rect><path d="M5 11h14M8 17.5V20M16 17.5V20"></path><circle cx="8.6" cy="14.2" r=".9"></circle><circle cx="15.4" cy="14.2" r=".9"></circle>',
  down: '<path d="M6 9.5l6 6 6-6"></path>',
  gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"></path>',
  pen: '<path d="M15.5 5l3.5 3.5L9 18.5H5.5V15z"></path><path d="M13.5 7l3.5 3.5"></path>',
  music: '<path d="M9 18V6.5l10-2V16"></path><circle cx="6.8" cy="18" r="2.2"></circle><circle cx="16.8" cy="16" r="2.2"></circle>',
  megaphone: '<path d="M4 10v4h3l7 4V6l-7 4z"></path><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5"></path>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>',
  save: '<path d="M5 4.5h11l3 3V19a.5.5 0 0 1-.5.5h-13A.5.5 0 0 1 5 19z"></path><path d="M8 4.5v5h7v-5M8 19.5v-6h8v6"></path>',
  pause: '<path d="M9 6.5v11M15 6.5v11"></path>',
  volume: '<path d="M4.5 9.5v5h3.5l4.5 4v-13l-4.5 4z"></path><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"></path>',
  muted: '<path d="M4.5 9.5v5h3.5l4.5 4v-13l-4.5 4z"></path><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"></path>',
  playFill: '<path d="M8.5 6.2v11.6L18 12z" fill="currentColor"></path>',
  external: '<path d="M14 4.5h5.5V10"></path><path d="M19.5 4.5L11 13"></path><path d="M17.5 13.5v5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h5"></path>',
  install: '<path d="M12 3.5v11"></path><path d="M7.8 10.5L12 14.7l4.2-4.2"></path><path d="M5 17.5v2h14v-2"></path>'
};

export function icon(name, size = 24, extraClass = '') {
  return raw(
    `<svg class="icon${extraClass ? ' ' + extraClass : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`
  );
}

export const STAR_BULLET = raw('<svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0l1.4 4.6L12 6l-4.6 1.4L6 12l-1.4-4.6L0 6l4.6-1.4z" fill="#F8B709"></path></svg>');
