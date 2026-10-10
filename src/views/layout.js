// The shell around every public page.
import { html, raw, jsonLd, formatText, esc } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { ASSET_VERSION, isProductionHost, siteOrigin } from '../lib/http.js';
import { fullAddress } from '../lib/settings.js';

export const PAGES = [
  { route: 'home', path: '/', label: 'Home', icon: 'home' },
  { route: 'whos-on', path: '/whos-on', label: 'Who’s On', icon: 'person' },
  { route: 'events', path: '/events', label: 'Events', icon: 'stars' },
  { route: 'private-readings', path: '/private-readings', label: 'Private Readings', icon: 'lotus' },
  { route: 'bookings', path: '/bookings', label: 'Bookings', icon: 'book' },
  { route: 'meditations', path: '/meditations', label: 'Meditations', icon: 'headphones' },
  { route: 'development-circle', path: '/development-circle', label: 'Development Circle', icon: 'circle' },
  { route: 'about', path: '/about', label: 'About New Way’s', icon: 'info' },
  { route: 'teaching-videos', path: '/teaching-videos', label: 'Teaching Videos', icon: 'play' },
  { route: 'live', path: '/live', label: 'Live', icon: 'live' },
  { route: 'gallery', path: '/gallery', label: 'Gallery', icon: 'image' },
  { route: 'reviews', path: '/reviews', label: 'Visitor Experiences', icon: 'quote' },
  { route: 'charity', path: '/charity', label: 'Community & Charity', icon: 'heart' },
  { route: 'faqs', path: '/faqs', label: 'First Visit & FAQs', icon: 'question' },
  { route: 'find-us', path: '/find-us', label: 'Find Us', icon: 'pin' },
  { route: 'privacy', path: '/privacy', label: 'Privacy Notice', icon: 'shield' }
];
const byRoute = Object.fromEntries(PAGES.map((p) => [p.route, p]));

// The approved bottom tab bar, unchanged
const TABS = [
  ['home', 'Home', 'home'], ['whos-on', 'Who’s On', 'person'], ['events', 'Events', 'stars'],
  ['private-readings', 'Readings', 'lotus'], ['bookings', 'Bookings', 'book']
];
const DESKTOP_NAV = ['whos-on', 'events', 'development-circle', 'private-readings', 'bookings', 'about', 'find-us'];

const LOGO_SMALL = '/images/logo-160.webp';

function head({ title, description, canonical, noindex, ogImage, structured, verification, og = {} }) {
  return html`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
${verification ? html`<meta name="google-site-verification" content="${verification}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="New Way’s Mediumship Development Centre">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="${og.title || title}">
<meta property="og:description" content="${og.description || description}">
<meta property="og:url" content="${og.url || canonical}">
<meta property="og:image" content="${og.image || ogImage}">
${og.image ? (og.imageWidth && og.imageHeight ? html`<meta property="og:image:width" content="${og.imageWidth}">
<meta property="og:image:height" content="${og.imageHeight}">` : '') : raw(`<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">`)}
${og.imageType ? html`<meta property="og:image:type" content="${og.imageType}">` : ''}
<meta property="og:image:alt" content="${og.imageAlt || 'The New Way’s Mediumship Development Centre logo'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#000428">
<meta name="color-scheme" content="dark">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="New Way’s">
<meta name="application-name" content="New Way’s">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&amp;family=Jost:wght@400;500&amp;display=swap" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=${ASSET_VERSION}">
<script src="/js/site.js?v=${ASSET_VERSION}" defer></script>
${structured ? (Array.isArray(structured) ? structured.map(jsonLd) : jsonLd(structured)) : ''}
</head>`;
}

function menuButton() {
  return html`<button type="button" class="menu-btn press" data-menu-open aria-controls="site-menu" aria-expanded="false">
${icon('menu', 22)}<span class="sr-only">Menu</span></button>`;
}

function siteMenu(route) {
  return html`<div class="site-menu" id="site-menu" role="dialog" aria-modal="true" aria-label="All sections" hidden>
<div class="site-menu-panel">
<div class="site-menu-top">
<a class="header-logo press" href="/" aria-label="New Way’s home"><img src="${LOGO_SMALL}" alt="" width="52" height="52"></a>
<button type="button" class="menu-btn press" data-menu-close>${icon('close', 22)}<span class="sr-only">Close menu</span></button>
</div>
<nav aria-label="All sections">
<ul class="site-menu-list">
${PAGES.map((p) => html`<li><a class="site-menu-link press" href="${p.path}"${p.route === route ? raw(' aria-current="page"') : ''}><span class="orb orb-xs" aria-hidden="true">${icon(p.icon, 18)}</span><span>${p.label}</span></a></li>`)}
</ul>
</nav>
</div>
</div>`;
}

function desktopTop(route) {
  return html`<header class="site-top">
<div class="site-top-inner">
<a class="site-top-brand press" href="/" aria-label="New Way’s home"><img src="${LOGO_SMALL}" alt="" width="48" height="48"><span>New Way’s</span></a>
<nav class="site-top-nav" aria-label="Main sections">
${DESKTOP_NAV.map((r) => html`<a href="${byRoute[r].path}"${r === route ? raw(' aria-current="page"') : ''}>${r === 'about' ? 'About' : byRoute[r].label}</a>`)}
<button type="button" class="site-top-more" data-menu-open aria-controls="site-menu" aria-expanded="false">More</button>
</nav>
</div>
</header>`;
}

function tabBar(route) {
  return html`<nav class="tabbar" aria-label="Sections">
${TABS.map(([r, label, ic]) => html`<a class="tab press" href="${byRoute[r].path}"${r === route ? raw(' aria-current="page"') : ''}><span class="tab-ind" aria-hidden="true"></span>${icon(ic, 24)}<span>${label}</span></a>`)}
</nav>`;
}

export function announcementBanners(announcements, live) {
  const items = [];
  if (live && live.is_live) {
    items.push(html`<a class="live-now press" href="/live"><span class="live-dot" aria-hidden="true"></span><span class="live-now-text"><strong>LIVE NOW</strong>${live.title ? html`<span>${live.title}</span>` : ''}</span>${icon('chev', 20, 'icon-gold')}</a>`);
  }
  for (const a of announcements || []) {
    items.push(html`<section class="announcement announcement-${a.importance}" aria-label="Announcement">
${icon('megaphone', 22, 'icon-gold')}<div><h2>${a.title}</h2>${a.message ? formatText(a.message) : ''}</div></section>`);
  }
  return items.length ? html`<div class="notices">${items}</div>` : '';
}

function footer(settings, social) {
  const year = new Date().getUTCFullYear();
  const address = [settings.address_line1, settings.address_line2, [settings.town, settings.postcode].filter(Boolean).join(' ')].filter(Boolean);
  return html`<footer class="site-footer">
<div class="site-footer-inner">
<div class="footer-block">
<p class="footer-name">${settings.centre_name}</p>
${settings.tagline ? html`<p class="footer-tagline">${settings.tagline}</p>` : ''}
<address>${address.map((l) => html`<span>${l}</span>`)}</address>
${settings.phone ? html`<p><a href="tel:${settings.phone.replace(/[^\d+]/g, '')}">${settings.phone}</a></p>` : ''}
${settings.email ? html`<p><a href="mailto:${settings.email}">${settings.email}</a></p>` : ''}
</div>
<div class="footer-block footer-join">
<p class="footer-name">Stay Connected with New Way’s</p>
<a class="btn-outline-gold press" href="/join">JOIN OUR MAILING LIST</a>
</div>
${social && social.length ? html`<ul class="footer-social">${social.map((s) => html`<li><a href="${s.url}" target="_blank" rel="noopener">${s.platform}</a></li>`)}</ul>` : ''}
<nav class="footer-links" aria-label="More information">
<a href="/find-us">Find Us</a><a href="/faqs">First Visit &amp; FAQs</a><a href="/privacy">Privacy Notice</a>
</nav>
<p class="footer-copy">© ${year} ${settings.centre_name}</p>
</div>
</footer>`;
}

// Organisation details for Google, built from Centre Settings
export function organisationData(settings, origin, social = []) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: settings.centre_name,
    url: origin + '/',
    logo: origin + '/images/logo-720.jpg',
    description: settings.site_description,
    address: {
      '@type': 'PostalAddress',
      streetAddress: [settings.address_line1, settings.address_line2].filter(Boolean).join(', '),
      addressLocality: settings.town,
      postalCode: settings.postcode,
      addressCountry: 'GB'
    }
  };
  if (settings.tagline) data.slogan = settings.tagline;
  if (settings.phone) data.telephone = settings.phone;
  if (settings.email) data.email = settings.email;
  if (social.length) data.sameAs = social.map((s) => s.url);
  return data;
}

// Background music: never starts by itself. A small Music button; the visitor's choice is remembered on their device.
function musicControl(music) {
  if (!music || !music.enabled || !music.track_key) return '';
  const volume = Math.max(0, Math.min(100, Number(music.default_volume) || 40));
  return html`<div class="music" data-music data-volume="${volume}" role="region" aria-label="Background music">
<audio preload="none" loop src="/media/${music.track_key}"></audio>
<button type="button" class="music-btn press" data-music-toggle aria-pressed="false">
<span class="music-icon music-icon-play">${icon('music', 22)}</span><span class="music-icon music-icon-pause">${icon('pause', 22)}</span>
<span class="music-label">Music</span><span class="sr-only music-sr">Play background music</span></button>
<button type="button" class="music-mute press" data-music-mute aria-pressed="false" hidden>
<span class="music-icon music-icon-on">${icon('volume', 20)}</span><span class="music-icon music-icon-off">${icon('muted', 20)}</span><span class="sr-only">Mute music</span></button>
</div>`;
}

// The live chat button (only when Gary has switched chat on; not on Home, whose first screen stays exactly as designed:
// Home links to the chat from Explore instead). The green dot only shows while someone is available.
function chatButton(settings) {
  const online = settings.chat_available_until && Date.parse(settings.chat_available_until) > Date.now();
  return html`<a class="chat-fab press${online ? ' is-online' : ''}" href="/chat">${icon('chat', 24)}<span class="chat-fab-label">Chat</span><span class="sr-only">${online ? 'Live chat with New Way’s: online now' : 'Live chat with New Way’s: leave a message'}</span></a>`;
}

// Full page. `body` is the inside of <main>.
export function page(ctx, { route, title, description, body, header = true, structured = null, mainClass = '', canonicalPath = '', og = {} }) {
  const { request, env, settings, announcements, live, social } = ctx;
  const origin = siteOrigin(request, env);
  const info = byRoute[route] || { path: new URL(request.url).pathname };
  const canonical = origin + (canonicalPath || info.path || '/');
  const fullTitle = route === 'home' ? `${settings.centre_name}, Dundee` : `${title} | New Way’s, Dundee`;
  const desc = description || settings.site_description;
  const noindex = !isProductionHost(request, env);
  const pageHeading = header
    ? html`<header class="screen-header">
<a class="header-logo press" href="/" aria-label="New Way’s home"><img src="${LOGO_SMALL}" alt="" width="52" height="52"></a>
<h1 class="screen-title" tabindex="-1">${title}</h1>
${menuButton()}
</header>`
    : html`<div class="home-menu">${menuButton()}</div>`;

  return html`${head({ title: fullTitle, description: desc, canonical, noindex, ogImage: origin + '/images/share-1200x630.jpg', structured, og,
    verification: route === 'home' && /^[\w-]{10,100}$/.test(String(env.GOOGLE_SITE_VERIFICATION || '')) ? env.GOOGLE_SITE_VERIFICATION : '' })}
<body class="route-${route}">
<a class="skip-link" href="#main">Skip to main content</a>
<div class="app">
<div class="stars stars-a twinkle" aria-hidden="true"></div>
<div class="stars stars-b twinkle" aria-hidden="true"></div>
<div id="persistent">${musicControl(ctx.music)}</div>
<div id="page" data-route="${route}">
${desktopTop(route)}
<div class="app-col">
${announcementBanners(announcements, live)}
${pageHeading}
<main id="main" class="${header ? 'screen-main ' : ''}${mainClass}" tabindex="-1">
${body}
</main>
${footer(settings, social)}
${tabBar(route)}
</div>
${settings.chat_enabled === '1' && route !== 'chat' && route !== 'home' ? chatButton(settings) : ''}
${siteMenu(route)}
</div>
</div>
</body>
</html>`;
}

export { fullAddress, esc };
