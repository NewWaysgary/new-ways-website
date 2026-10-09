// Public pages. Each returns HTML for the page body, wrapped by layout.page().
import { html, raw, formatText, esc } from '../lib/html.js';
import { icon, STAR_BULLET } from '../lib/icons.js';
import { formatPrice, fullAddress, tokenReplacer, SETTING_DEFAULTS } from '../lib/settings.js';
import { longDate, daysFromToday, ukToday } from '../lib/dates.js';
import { page, organisationData } from './layout.js';
import { siteOrigin } from '../lib/http.js';
import * as data from '../lib/data.js';
import { youtubeId, watchUrl, youtubeThumb } from '../lib/youtube.js';
import { turnstileConfig, formStamp } from '../lib/turnstile.js';
import { friendlyDateTime, londonLocalToUtc } from '../lib/dates.js';
import { squareConfig } from '../payments/square.js';
import { salesState, placesLeft } from '../events/model.js';
import { STATE_TEXT } from './tickets.js';

const media = (key) => '/media/' + encodeURIComponent(key);
const webLink = (v) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(v || '').trim()) ? String(v).trim() : '');

// ---------- shared pieces ----------

function halo(cls, inner) {
  return html`<div class="halo ${cls}">
<div class="halo-glow breathe" aria-hidden="true"></div>
<div class="halo-arc-gold spin" aria-hidden="true"></div>
<div class="halo-arc-blue spin-back" aria-hidden="true"></div>
${inner}
</div>`;
}

function logoPicture(cls, sizes, alt) {
  return html`<picture>
<source type="image/webp" srcset="/images/logo-480.webp 480w, /images/logo-720.webp 720w, /images/logo-960.webp 960w" sizes="${sizes}">
<img class="${cls}" src="/images/logo-720.jpg" alt="${alt}" width="720" height="720" fetchpriority="high">
</picture>`;
}

function directionsButton(settings) {
  const url = webLink(settings.directions_link);
  if (!url) return '';
  return html`<a class="btn-blue press" href="${url}" target="_blank" rel="noopener">${icon('pin', 20)}Get directions</a>`;
}

function wednesdayRows(s) {
  const rows = [];
  if (s.doors_open) rows.push(['Doors open', s.doors_open]);
  if (s.service_start) rows.push(['Service starts', s.service_start]);
  if (s.service_end) rows.push(['Service ends', s.service_end]);
  if (s.break_time) rows.push(['Break', s.break_time]);
  if (formatPrice(s.entry_price)) rows.push(['Entry', formatPrice(s.entry_price)]);
  if (s.circle_start) rows.push(['Development Circle', s.circle_start + (s.circle_end ? ' to ' + s.circle_end : '')]);
  if (formatPrice(s.circle_price)) rows.push([s.circle_start ? 'Development Circle price' : 'Development Circle afterwards', formatPrice(s.circle_price)]);
  return rows;
}

function wednesdayBullets(s) {
  return [s.payment_wording, s.welcome_wording, s.booking_wording].map((x) => String(x || '').trim()).filter(Boolean);
}

function addressBlock(s) {
  const lines = [s.venue_name, s.address_line1, s.address_line2, [s.town, s.postcode].filter(Boolean).join(' ')].filter(Boolean);
  return html`<address class="address">${icon('pin', 22, 'icon-gold icon-mt1')}<span class="address-lines">${lines.map((l) => html`<span>${l}</span>`)}</span></address>`;
}

// The approved "Every Wednesday" card, now filled from Centre Settings
function everyWednesdayCard(s, headingId = 'every-wednesday') {
  return html`<section class="card-blue wed-card" aria-labelledby="${headingId}">
<h2 class="card-title" id="${headingId}">Every Wednesday</h2>
<dl class="wed-list">${wednesdayRows(s).map(([k, v]) => html`<div class="wed-row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
<ul class="bullets">${wednesdayBullets(s).map((b) => html`<li>${STAR_BULLET}<span>${b}</span></li>`)}</ul>
${s.other_info ? html`<div class="prose">${formatText(s.other_info)}</div>` : ''}
${addressBlock(s)}
${directionsButton(s)}
</section>`;
}

// Short version under each Wednesday entry, e.g. "Doors open 6:30pm, service starts 7pm. Entry £5, Development Circle £3."
function wednesdaySentence(s) {
  const first = [s.doors_open && `Doors open ${s.doors_open}`, s.service_start && `service starts ${s.service_start}`].filter(Boolean).join(', ');
  const second = [formatPrice(s.entry_price) && `Entry ${formatPrice(s.entry_price)}`,
    formatPrice(s.circle_price) && `Development Circle ${formatPrice(s.circle_price)}`].filter(Boolean).join(', ');
  return [first, second].filter(Boolean).map((t) => t.charAt(0).toUpperCase() + t.slice(1) + '.').join(' ');
}

function portrait(photoKey, alt, cls = 'portrait') {
  return photoKey
    ? html`<figure class="${cls}"><img src="${media(photoKey)}" alt="${alt}" loading="lazy" decoding="async"></figure>`
    : html`<figure class="${cls} portrait-empty" aria-hidden="true">${icon('person', 40)}</figure>`;
}

function firstParagraph(text, max = 180) {
  const p = String(text || '').trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ');
  return p.length > max ? p.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : p;
}

// ---------- context shared by every page ----------

export async function pageContext(request, env) {
  // Parts shown on every page. If one ever fails to load, the page still loads without it (and the failure is logged),
  // rather than the whole page failing. Centre Settings fall back to the standard values.
  const safely = (label, promise, fallback) => promise.catch((err) => {
    console.error(`New Way's: could not load ${label}:`, err && err.message ? err.message : err);
    return fallback;
  });
  const [settings, announcements, live, social, music] = await Promise.all([
    safely('Centre Settings', data.getSettings(env), { ...SETTING_DEFAULTS }),
    safely('announcements', data.activeAnnouncements(env), []),
    safely('live status', data.liveStream(env), { is_live: 0 }),
    safely('social links', data.socialLinks(env), []),
    safely('music settings', data.musicSettings(env), { enabled: 0, track_key: '' })
  ]);
  return { request, env, settings, announcements, live, social, music, fill: tokenReplacer(settings) };
}

// ---------- Home ----------

export async function homePage(ctx) {
  const { env, settings: s } = ctx;
  const [blocks, mediums, events, reviews] = await Promise.all([
    data.getBlocks(env, ['home_welcome']), data.upcomingMediums(env, 1), data.upcomingEvents(env, 1), data.featuredReviews(env, 3)
  ]);
  const welcome = blocks.home_welcome;
  const next = mediums[0];
  const event = events[0];
  const soon = next ? daysFromToday(next.date) : null;

  const body = html`<h1 class="sr-only" tabindex="-1">${s.centre_name}</h1>
<section class="home-hero" aria-label="Welcome">
${halo('halo-home', logoPicture('home-logo', '(min-width: 960px) 420px, min(246px, 62vw)', 'New Way’s Mediumship Development Centre logo'))}
<nav class="home-nav" aria-label="Main sections">
${homeButton('/whos-on', 'Who’s On', 'Wednesday guest mediums', 'person')}
${homeButton('/events', 'Events', 'Special events at New Way’s', 'stars')}
${homeButton('/private-readings', 'Private Readings', 'With Medium Gary Findlay', 'lotus')}
${homeButton('/bookings', 'Bookings', 'Readings and event tickets', 'book')}
${installButton()}
</nav>
<a class="home-more-cue" href="#welcome">${icon('down', 22, 'icon-gold')}<span>${welcome.title || 'Welcome'}</span></a>
</section>

<div class="home-more">
<section class="card-gold text-card" id="welcome" aria-labelledby="welcome-title">
<h2 class="card-title" id="welcome-title">${welcome.title}</h2>
<div class="prose">${formatText(welcome.body, { replaceTokens: ctx.fill })}</div>
</section>

<section class="card-blue home-wednesday" aria-labelledby="this-wednesday">
<h2 class="card-title" id="this-wednesday">${!next ? 'Wednesday evenings' : soon !== null && soon <= 6 ? 'This Wednesday' : 'Next guest medium'}</h2>
${next ? html`<div class="home-medium">
${portrait(next.photo_key, 'Photo of ' + next.name, 'portrait portrait-sm')}
<div class="home-medium-text">
<h3 class="medium-name-sm">${next.name}</h3>
${next.location ? html`<p class="medium-from">From ${next.location}</p>` : ''}
<p class="date-line">${icon('cal', 18, 'icon-gold')}<span>${longDate(next.date)}</span></p>
${next.description ? html`<p class="medium-short">${firstParagraph(next.description)}</p>` : ''}
</div>
</div>` : html`<p>The next guest medium will be announced here soon.</p>`}
<p class="wed-sentence">${wednesdaySentence(s)}</p>
<a class="btn-outline-gold press" href="/whos-on">See who’s on</a>
</section>

${event ? html`<section class="card-gold home-event" aria-labelledby="next-event">
<h2 class="card-title" id="next-event">Next special event</h2>
<div class="home-event-row">
${event.poster_key ? html`<img class="home-event-poster" src="${media(event.poster_key)}" alt="" loading="lazy">` : ''}
<div>
<h3 class="event-name-sm">${event.name}</h3>
<p class="date-line">${icon('cal', 18, 'icon-gold')}<span>${longDate(event.date)}</span></p>
${event.time_text ? html`<p class="date-line">${icon('clock', 18, 'icon-gold')}<span>${event.time_text}</span></p>` : ''}
</div>
</div>
<a class="btn-outline-gold press" href="/events">See events</a>
</section>` : ''}

${reviews.length ? html`<section class="home-reviews" aria-labelledby="home-reviews">
<h2 class="card-title" id="home-reviews">Visitor experiences</h2>
${reviews.map(reviewCard)}
<a class="btn-outline-gold press" href="/reviews">Read more experiences</a>
</section>` : ''}

<nav class="explore" aria-labelledby="explore-title">
<h2 class="card-title" id="explore-title">Explore New Way’s</h2>
<ul class="explore-grid">
${[['/development-circle', 'Development Circle', 'circle'], ['/about', 'About New Way’s', 'info'], ['/meditations', 'Meditations', 'headphones'], ['/teaching-videos', 'Teaching Videos', 'play'],
    ['/live', 'Live', 'live'], ['/gallery', 'Gallery', 'image'], ['/reviews', 'Visitor Experiences', 'quote'],
    ['/charity', 'Community & Charity', 'heart'], ['/faqs', 'First Visit & FAQs', 'question'], ['/find-us', 'Find Us', 'pin']]
    .map(([href, label, ic]) => html`<li><a class="explore-link press" href="${href}"><span class="orb orb-xs" aria-hidden="true">${icon(ic, 18)}</span><span>${label}</span></a></li>`)}
</ul>
</nav>
</div>`;

  const origin = siteOrigin(ctx.request, ctx.env);
  return page(ctx, {
    route: 'home', title: s.centre_name, body, header: false, mainClass: 'home-main',
    structured: [organisationData(s, origin, ctx.social), { '@context': 'https://schema.org', '@type': 'WebSite', name: s.centre_name, url: origin + '/' }]
  });
}

function homeButton(href, label, sub, ic) {
  return html`<a class="home-btn press" href="${href}"><span class="orb" aria-hidden="true">${icon(ic, 26)}</span><span class="home-btn-text"><span class="home-btn-label">${label}</span><span class="home-btn-sub">${sub}</span></span>${icon('chev', 22, 'icon-gold')}</a>`;
}

function installButton() {
  // Hidden until site.js confirms that this browser can offer an install route.
  return html`<button type="button" class="home-btn home-install press" data-install-app hidden><span class="orb" aria-hidden="true">${icon('install', 26)}</span><span class="home-btn-text"><span class="home-btn-label">Install New Way’s App</span><span class="home-btn-sub">Add New Way’s to your phone</span></span>${icon('chev', 22, 'icon-gold')}</button>`;
}

function reviewCard(r) {
  return html`<figure class="review card-blue">
${r.rating ? html`<p class="review-stars" aria-label="${r.rating} out of 5 stars">${'★'.repeat(r.rating)}<span aria-hidden="true">${'★'.repeat(5 - r.rating)}</span></p>` : ''}
<blockquote>${formatText(r.body)}</blockquote>
<figcaption>${r.name}</figcaption>
</figure>`;
}

// ---------- Who's On ----------

export async function whosOnPage(ctx) {
  const { env, settings: s } = ctx;
  const mediums = await data.upcomingMediums(env);
  const [first, ...rest] = mediums;
  const soon = first ? daysFromToday(first.date) : null;

  const feature = first ? html`<section class="medium-feature" aria-labelledby="next-up">
<h2 class="next-label" id="next-up">${soon !== null && soon <= 6 ? 'This Wednesday' : 'Next up'}</h2>
${portrait(first.photo_key, 'Photo of ' + first.name, 'portrait portrait-lg')}
<div class="medium-meta">
<h3 class="next-name">${first.name}</h3>
${first.location ? html`<p class="medium-from">From ${first.location}</p>` : ''}
<p class="date-line">${icon('cal', 18, 'icon-gold')}<span>${longDate(first.date)}</span></p>
</div>
${first.description ? html`<div class="prose medium-description">${formatText(first.description)}</div>` : ''}
<p class="wed-sentence">${wednesdaySentence(s)}</p>
</section>` : html`<p class="empty-note">The next guest medium will be announced here soon.</p>`;

  const later = rest.length ? html`<section class="later" aria-labelledby="coming-up">
<h2 class="card-title later-title" id="coming-up">Coming up</h2>
<ul class="later-list">
${rest.map((m) => html`<li class="later-medium">
${portrait(m.photo_key, 'Photo of ' + m.name, 'portrait portrait-thumb')}
<div class="later-text">
<span class="later-name">${m.name}</span>
${m.location ? html`<span class="medium-from">From ${m.location}</span>` : ''}
<span class="later-date">${longDate(m.date)}</span>
${m.description ? html`<span class="later-desc">${firstParagraph(m.description, 140)}</span>` : ''}
<span class="later-std">${wednesdaySentence(s)}</span>
</div>
</li>`)}
</ul>
</section>` : '';

  const body = html`<p class="screen-sub">Wednesday evenings at New Way’s</p>
<div class="whos-on-layout">
<div class="whos-on-main">${feature}${later}</div>
<div class="whos-on-side">${everyWednesdayCard(s)}</div>
</div>`;
  const origin = siteOrigin(ctx.request, env);
  const structured = mediums.slice(0, 12).map((m) => mediumEvent(m, s, origin));
  return page(ctx, { route: 'whos-on', title: 'Who’s On', body, structured: structured.length ? structured : null,
    description: `Guest mediums at New Way’s every Wednesday. ${wednesdaySentence(s)}` });
}

// "7pm", "7:30pm", "19:00" -> "19:00" (or null)
function clock(text) {
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*$/i.exec(String(text || ''));
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0); }
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
}

// Each Wednesday as an event for Google: date and time, venue, entry price and the guest medium
function mediumEvent(m, s, origin) {
  const t = clock(s.service_start);
  const event = {
    '@context': 'https://schema.org', '@type': 'Event',
    name: `Evening of mediumship with ${m.name}`,
    startDate: (t && londonLocalToUtc(`${m.date}T${t}`)) || m.date,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled',
    location: { '@type': 'Place', name: s.venue_name, address: { '@type': 'PostalAddress', streetAddress: [s.address_line1, s.address_line2].filter(Boolean).join(', '), addressLocality: s.town, postalCode: s.postcode, addressCountry: 'GB' } },
    performer: { '@type': 'Person', name: m.name },
    organizer: { '@type': 'Organization', name: s.centre_name, url: origin + '/' },
    description: firstParagraph(m.description) || `Guest medium ${m.name}${m.location ? ' from ' + m.location : ''} at New Way’s, followed by the Development Circle.`
  };
  const price = String(s.entry_price || '').replace(/^£/, '');
  if (/^\d+(\.\d{1,2})?$/.test(price)) event.offers = { '@type': 'Offer', price, priceCurrency: 'GBP', availability: 'https://schema.org/InStock', url: origin + '/whos-on' };
  if (m.photo_key) event.image = origin + media(m.photo_key);
  return event;
}

// ---------- Events ----------

// Events whose tickets are booked on this website: how many places are taken, and whether tickets are on sale.
// (Events using a Square ticket link are shown exactly as before.)
async function ticketStates(ctx, events) {
  const online = events.filter((e) => e.sales_mode === 'online');
  const out = {};
  if (!online.length) return out;
  const open = !!(squareConfig(ctx.env) && turnstileConfig(ctx.request, ctx.env));
  let taken = {};
  try {
    const { results } = await ctx.env.DB.prepare(`SELECT event_id, SUM(quantity) AS n FROM event_bookings WHERE status IN ('held', 'confirmed')
      AND event_id IN (${online.map((e) => Number(e.id)).join(', ')}) GROUP BY event_id`).all();
    taken = Object.fromEntries((results || []).map((r) => [r.event_id, r.n]));
  } catch (err) { console.error("New Way's: could not read event places:", err && err.message); }
  for (const e of online) {
    const t = taken[e.id] || 0;
    const state = salesState(e, t);
    out[e.id] = { state: state === 'open' && !open ? 'soon' : state, left: placesLeft(e, t) };
  }
  return out;
}

export async function eventsPage(ctx) {
  const { env, settings: s } = ctx;
  const events = await data.upcomingEvents(env);
  const origin = siteOrigin(ctx.request, env);
  const tickets = await ticketStates(ctx, events);
  const body = html`<p class="screen-sub">Special events at New Way’s</p>
${events.length ? html`<div class="events-grid">${events.map((e, i) => eventCard(e, i + 1, tickets[e.id]))}</div>`
    : html`<p class="empty-note">New events will be announced here soon.</p>`}`;
  const structured = events.map((e) => {
    const d = {
      '@context': 'https://schema.org', '@type': 'Event', name: e.name, startDate: e.date,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled',
      location: { '@type': 'Place', name: s.venue_name, address: { '@type': 'PostalAddress', streetAddress: [s.address_line1, s.address_line2].filter(Boolean).join(', '), addressLocality: s.town, postalCode: s.postcode, addressCountry: 'GB' } },
      organizer: { '@type': 'Organization', name: s.centre_name, url: origin + '/' }
    };
    if (e.summary) d.description = e.summary;
    if (e.poster_key) d.image = origin + media(e.poster_key);
    if (e.sales_mode === 'online') d.offers = { '@type': 'Offer', url: origin + `/events/${e.id}/book`, price: (e.price_pence / 100).toFixed(2), priceCurrency: 'GBP',
      availability: tickets[e.id] && tickets[e.id].state === 'sold_out' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' };
    else if (e.sales_mode !== 'none' && webLink(e.ticket_url)) d.offers = { '@type': 'Offer', url: webLink(e.ticket_url) };
    return d;
  });
  return page(ctx, { route: 'events', title: 'Events', body, structured: structured.length ? structured : null,
    description: 'Special events at New Way’s Mediumship Development Centre, Thomson Park, Dundee.' });
}

const ticketPrice = (p) => '£' + (Number(p) / 100).toFixed(2).replace(/\.00$/, '');

// Online tickets: the price, then BOOK TICKETS, or why tickets can't be booked just now
function onlineTickets(e, t) {
  if (!t) return '';
  const price = e.price_pence && !e.ticket_info ? html`<p class="icon-line icon-line-top">${icon('ticket', 20, 'icon-gold icon-mt3')}<span>${ticketPrice(e.price_pence)} per ticket</span></p>` : '';
  if (t.state === 'open') {
    return html`${price}${t.left !== Infinity && t.left <= 10 ? html`<p class="event-status">Only ${t.left} ${t.left === 1 ? 'place' : 'places'} left</p>` : ''}<a class="btn-gold press event-btn" href="/events/${e.id}/book">Book tickets</a>`;
  }
  if (t.state === 'sold_out') return html`${price}<p class="event-status event-sold-out">SOLD OUT</p>`;
  if (t.state === 'not_open') return html`${price}<p class="event-status">Tickets on sale soon</p>`;
  if (t.state === 'closed') return html`${price}<p class="event-status">${STATE_TEXT.closed}</p>`;
  if (t.state === 'soon') return html`${price}<p class="event-status">Online booking will open here soon</p>`;
  return price;
}

function eventCard(e, n, tickets) {
  const ticketUrl = e.sales_mode === 'online' || e.sales_mode === 'none' ? '' : webLink(e.ticket_url);
  return html`<article class="event card-gold" aria-labelledby="event-${n}">
${e.poster_key ? html`<img class="poster-img" src="${media(e.poster_key)}" alt="Poster for ${e.name}" loading="lazy" decoding="async">` : ''}
<div class="event-body">
<h2 class="event-title" id="event-${n}">${e.name}</h2>
<div class="event-when">
<p class="icon-line">${icon('cal', 20, 'icon-gold')}<span>${longDate(e.date)}</span></p>
${e.time_text ? html`<p class="icon-line">${icon('clock', 20, 'icon-gold')}<span>${e.time_text}</span></p>` : ''}
</div>
${e.summary ? html`<div class="prose">${formatText(e.summary)}</div>` : ''}
${e.details ? html`<details class="more"><summary>More information</summary><div class="prose">${formatText(e.details)}</div></details>` : ''}
${e.ticket_info ? html`<p class="icon-line icon-line-top">${icon('ticket', 20, 'icon-gold icon-mt3')}<span>${e.ticket_info}</span></p>` : ''}
${ticketUrl ? html`<a class="btn-gold press event-btn" href="${ticketUrl}" target="_blank" rel="noopener">Book / buy tickets</a>` : ''}
${e.sales_mode === 'online' ? onlineTickets(e, tickets) : ''}
</div>
</article>`;
}

// ---------- Bookings ----------

export async function bookingsPage(ctx) {
  const { env, settings: s } = ctx;
  const upcoming = await data.upcomingEvents(env);
  const tickets = await ticketStates(ctx, upcoming);
  const ticketed = upcoming.filter((e) => (e.sales_mode === 'online' && tickets[e.id] && tickets[e.id].state !== 'past') || (e.sales_mode !== 'online' && e.sales_mode !== 'none' && webLink(e.ticket_url)));
  const body = html`<section class="card-gold book-reading" aria-labelledby="book-reading">
<div class="row-14"><span class="orb orb-sm" aria-hidden="true">${icon('lotus', 24)}</span><div class="title-stack"><h2 class="book-title" id="book-reading">Private reading</h2><p class="book-sub">With Medium Gary Findlay</p></div></div>
<p>By WhatsApp video call. Choose an available date and time and book securely online.</p>
<a class="btn-gold press" href="/private-readings">Check availability &amp; book</a>
</section>
<section class="tickets" aria-labelledby="book-tickets">
<div class="row-14"><span class="orb orb-sm" aria-hidden="true">${icon('ticket', 24)}</span><h2 class="book-title" id="book-tickets">Event tickets</h2></div>
${ticketed.length ? ticketed.map((e) => html`<div class="ticket-row card-gold">
<div class="title-stack"><h3 class="ticket-name">${e.name}</h3><p class="ticket-date">${longDate(e.date)}</p></div>
${e.sales_mode === 'online'
    ? (tickets[e.id].state === 'open' ? html`<a class="btn-gold btn-sm press" href="/events/${e.id}/book">Book tickets</a>` : html`<p class="event-status${tickets[e.id].state === 'sold_out' ? ' event-sold-out' : ''}">${tickets[e.id].state === 'sold_out' ? 'SOLD OUT' : tickets[e.id].state === 'not_open' ? 'On sale soon' : tickets[e.id].state === 'soon' ? 'Booking opens soon' : 'Booking closed'}</p>`)
    : html`<a class="btn-gold btn-sm press" href="${webLink(e.ticket_url)}" target="_blank" rel="noopener">Book / buy tickets</a>`}
</div>`) : html`<p class="empty-note">No event tickets are on sale at the moment.</p>`}
</section>
<section class="card-blue wed-note" aria-labelledby="wednesday-note">
<h2 class="wed-note-title" id="wednesday-note">Wednesday evenings</h2>
<p>${s.booking_wording ? s.booking_wording + '. ' : ''}Just come along.</p>
<a class="btn-outline-gold press" href="/whos-on">See who’s on</a>
</section>`;
  return page(ctx, { route: 'bookings', title: 'Bookings', body, mainClass: 'gap-26',
    description: 'Book a private reading or buy tickets for special events at New Way’s, Dundee.' });
}

// ---------- Development Circle ----------

export async function circlePage(ctx) {
  const { env, settings: s } = ctx;
  const { development_circle: block } = await data.getBlocks(env, ['development_circle']);
  const when = s.circle_start
    ? `Wednesdays, ${s.circle_start}${s.circle_end ? ' to ' + s.circle_end : ''}`
    : 'Wednesday evenings, after the service and break';
  const rows = [['When', when]];
  if (formatPrice(s.circle_price)) rows.push(['Price', formatPrice(s.circle_price)]);
  const body = html`<div class="two-col">
<section class="card-gold text-card" aria-labelledby="circle-title">
<h2 class="card-title" id="circle-title">${block.title}</h2>
<div class="prose">${formatText(block.body, { replaceTokens: ctx.fill })}</div>
</section>
<section class="card-blue wed-card" aria-labelledby="circle-practical">
<h2 class="card-title" id="circle-practical">When and where</h2>
<dl class="wed-list">${rows.map(([k, v]) => html`<div class="wed-row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
<ul class="bullets">${wednesdayBullets(s).map((b) => html`<li>${STAR_BULLET}<span>${b}</span></li>`)}</ul>
${addressBlock(s)}
${directionsButton(s)}
</section>
</div>`;
  return page(ctx, { route: 'development-circle', title: 'Development Circle', body,
    description: 'The Development Circle with Medium Gary Findlay at New Way’s, Dundee. Open to everyone, no experience needed.' });
}

// ---------- About ----------

export async function aboutPage(ctx) {
  const { env } = ctx;
  const b = await data.getBlocks(env, ['about_welcome', 'our_story', 'wwd_services', 'wwd_break', 'wwd_circle', 'mission', 'community']);
  const card = (block, cls, id) => html`<section class="${cls} text-card" aria-labelledby="${id}">
<h2 class="card-title" id="${id}">${block.title}</h2><div class="prose">${formatText(block.body, { replaceTokens: ctx.fill })}</div></section>`;
  const body = html`<div class="about-grid">
${card(b.about_welcome, 'card-gold about-wide', 'about-welcome')}
${card(b.our_story, 'card-blue', 'our-story')}
<section class="what-we-do" aria-labelledby="what-we-do">
<h2 class="card-title" id="what-we-do">What we do</h2>
<ul class="wwd-list">
${[[b.wwd_services, 'stars'], [b.wwd_break, 'heart'], [b.wwd_circle, 'circle']].map(([blk, ic]) => html`<li class="wwd-item card-gold">
<span class="orb orb-sm" aria-hidden="true">${icon(ic, 22)}</span>
<div><h3 class="wwd-title">${blk.title}</h3><div class="prose">${formatText(blk.body)}</div></div></li>`)}
</ul>
</section>
${card(b.mission, 'card-gold', 'mission')}
${card(b.community, 'card-blue', 'community')}
</div>`;
  return page(ctx, { route: 'about', title: 'About New Way’s', body,
    description: 'About New Way’s Mediumship Development Centre at Thomson Park, Dundee: our story, what we do, our mission and our community.' });
}

// ---------- Charity ----------

function money(pence) {
  const pounds = Number(pence || 0) / 100;
  return '£' + pounds.toLocaleString('en-GB', { minimumFractionDigits: pounds % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export async function charityPage(ctx) {
  const { env } = ctx;
  const [blocks, totals] = await Promise.all([data.getBlocks(env, ['charity_intro']), data.charityTotals(env)]);
  const intro = blocks.charity_intro;
  const body = html`${intro.body ? html`<div class="prose intro">${formatText(intro.body, { replaceTokens: ctx.fill })}</div>` : ''}
${totals.length ? html`<ul class="charity-list">${totals.map((t) => html`<li class="charity card-gold">
${t.image_key ? html`<img class="charity-img" src="${media(t.image_key)}" alt="" loading="lazy">` : ''}
<p class="charity-amount">${money(t.amount_pence)}</p>
<h2 class="charity-name">${t.charity_name}</h2>
${t.date_label ? html`<p class="charity-date">${t.date_label}</p>` : ''}
${t.description ? html`<div class="prose">${formatText(t.description)}</div>` : ''}
</li>`)}</ul>` : html`<p class="empty-note">Charity totals will be listed here.</p>`}`;
  return page(ctx, { route: 'charity', title: 'Community & Charity', body,
    description: 'Money raised for charity by the New Way’s community in Dundee.' });
}

// ---------- First visit & FAQs ----------

export async function faqsPage(ctx) {
  const { env } = ctx;
  const faqs = await data.visibleFaqs(env);
  const rendered = faqs.map((f) => ({ ...f, html: formatText(f.answer, { replaceTokens: ctx.fill }) }))
    .filter((f) => String(f.html).replace(/<[^>]+>/g, '').replace(/[\s.,;:!?]/g, '').length > 0);
  const body = html`<p class="screen-sub">Answers for your first Wednesday at New Way’s</p>
<div class="faq-list">
${rendered.map((f, i) => html`<details class="faq card-gold"${i === 0 ? raw(' open') : ''}>
<summary><span>${f.question}</span>${icon('down', 20, 'icon-gold faq-chev')}</summary>
<div class="prose">${f.html}</div>
</details>`)}
</div>
<section class="card-blue wed-note" aria-labelledby="faq-more">
<h2 class="wed-note-title" id="faq-more">Still have a question?</h2>
<p>Find the address, directions and contact details on our Find Us page.</p>
<a class="btn-outline-gold press" href="/find-us">Find us</a>
</section>`;
  const structured = rendered.length ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: rendered.map((f) => ({ '@type': 'Question', name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: String(f.html).replace(/<br>/g, '\n').replace(/<\/(p|li|h3)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() } }))
  } : null;
  return page(ctx, { route: 'faqs', title: 'First Visit & FAQs', body, structured,
    description: 'What to expect on your first visit to New Way’s in Dundee: times, prices, booking, the Development Circle and how to find us.' });
}

// ---------- Find Us ----------

export async function findUsPage(ctx) {
  const { settings: s, social } = ctx;
  const hasContact = s.phone || s.email || s.contact_info;
  const body = html`<div class="two-col">
<section class="card-blue wed-card" aria-labelledby="address-title">
<h2 class="card-title" id="address-title">Address</h2>
${addressBlock(s)}
${directionsButton(s)}
</section>
<div class="stack-cards">
${s.parking_info ? infoCard('car', 'Parking', s.parking_info, 'parking') : ''}
${s.transport_info ? infoCard('bus', 'Public transport', s.transport_info, 'transport') : ''}
${hasContact ? html`<section class="card-gold info-card" aria-labelledby="contact-title">
<h2 class="card-title" id="contact-title">Contact</h2>
${s.phone ? html`<p class="icon-line">${icon('phone', 20, 'icon-gold')}<a href="tel:${s.phone.replace(/[^\d+]/g, '')}">${s.phone}</a></p>` : ''}
${s.email ? html`<p class="icon-line">${icon('mail', 20, 'icon-gold')}<a href="mailto:${s.email}">${s.email}</a></p>` : ''}
${s.contact_info ? html`<div class="prose">${formatText(s.contact_info)}</div>` : ''}
</section>` : ''}
${social.length ? html`<section class="card-gold info-card" aria-labelledby="social-title">
<h2 class="card-title" id="social-title">Follow New Way’s</h2>
<ul class="social-list">${social.map((l) => html`<li><a class="btn-outline-gold press" href="${l.url}" target="_blank" rel="noopener">${l.platform}</a></li>`)}</ul>
</section>` : ''}
</div>
</div>`;
  const origin = siteOrigin(ctx.request, ctx.env);
  return page(ctx, { route: 'find-us', title: 'Find Us', body, structured: organisationData(s, origin, social),
    description: `How to find New Way’s Mediumship Development Centre: ${fullAddress(s)}.` });
}

function infoCard(ic, title, text, id) {
  return html`<section class="card-gold info-card" aria-labelledby="${id}-title">
<h2 class="card-title icon-line" id="${id}-title">${icon(ic, 22, 'icon-gold')}<span>${title}</span></h2>
<div class="prose">${formatText(text)}</div>
</section>`;
}

// ---------- Gallery ----------

export async function galleryPage(ctx) {
  const photos = await data.visibleGallery(ctx.env);
  const body = photos.length
    ? html`<ul class="gallery-grid">${photos.map((p) => html`<li><figure>
<a class="gallery-link" href="${media(p.image_key)}" data-lightbox${p.caption ? html` data-caption="${p.caption}"` : ''}>
<img src="${media(p.thumb_key || p.image_key)}" alt="${p.caption || 'Photograph from New Way’s'}" loading="lazy" decoding="async"></a>
${p.caption ? html`<figcaption>${p.caption}</figcaption>` : ''}</figure></li>`)}</ul>`
    : html`<p class="empty-note">Photographs from New Way’s will appear here.</p>`;
  return page(ctx, { route: 'gallery', title: 'Gallery', body, description: 'Photographs from New Way’s Mediumship Development Centre, Dundee.' });
}

// ---------- Visitor experiences ----------

const SHARE_NOTICES = {
  closed: 'Sharing experiences is not open yet.',
  paused: 'Sharing experiences is currently closed.',
  expired: 'This page was open for a long time, so please check your details and send it again.',
  busy: 'We have received a lot of messages from this connection. Please try again later.',
  check: 'The security check didn’t complete. Please wait for it to finish, then send again.',
  error: 'That didn’t work. Please try again from the New Way’s website.'
};

export async function reviewsPage(ctx, state = {}) {
  const reviews = await data.approvedReviews(ctx.env);
  const url = new URL(ctx.request.url);
  const thanks = url.searchParams.get('thanks') === '1';
  const cfg = turnstileConfig(ctx.request, ctx.env);
  const open = ctx.settings.reviews_open !== '0';   // Admin > Visitor experiences > Open / Close sharing
  const v = state.values || {};
  const e = state.errors || {};
  const err = (k) => (e[k] ? html`<p class="field-error" id="err-${k}">${e[k]}</p>` : '');
  const aria = (k) => (e[k] ? raw(` aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const form = cfg && open && !thanks ? html`<form method="post" action="/reviews#share" class="share-form" novalidate>
<input type="hidden" name="t" value="${await formStamp(cfg)}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="form-field"><label for="r-name">Your name</label><input id="r-name" name="name" type="text" maxlength="60" autocomplete="name" value="${v.name || ''}" required${aria('name')}>${err('name')}</div>
<fieldset class="form-field star-field"><legend>Star rating (optional)</legend>
<div class="star-input">${[1, 2, 3, 4, 5].map((n) => html`<input type="radio" id="r-star-${n}" name="rating" value="${n}"${String(v.rating) === String(n) ? raw(' checked') : ''}><label for="r-star-${n}"><span aria-hidden="true">★</span><span class="sr-only">${n} star${n > 1 ? 's' : ''}</span></label>`)}</div>
<button type="button" class="star-clear" data-star-clear>No rating</button>${err('rating')}</fieldset>
<div class="form-field"><label for="r-body">Your experience</label><textarea id="r-body" name="body" rows="6" maxlength="2000" required${aria('body')}>${v.body || ''}</textarea>${err('body')}</div>
<div class="form-field form-check"><label><input type="checkbox" name="consent" value="1"${v.consent ? raw(' checked') : ''}${aria('consent')}> I agree that New Way’s may show my name and experience on this website.</label>${err('consent')}</div>
<div class="cf-turnstile" data-sitekey="${cfg.siteKey}" data-action="experience" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<button class="btn-gold press" type="submit">Send my experience</button>
<p class="small">Nothing is shown until New Way’s has read and approved it. See our <a href="/privacy">Privacy Notice</a>.</p>
</form>` : '';

  const body = html`<p class="screen-sub">What visitors say about New Way’s</p>
${reviews.length ? html`<div class="reviews-grid">${reviews.map(reviewCard)}</div>` : html`<p class="empty-note">Visitor experiences will appear here once they have been shared and approved.</p>`}
<section class="card-blue share-card" id="share" aria-labelledby="share-title">
<h2 class="card-title" id="share-title">Share your experience</h2>
${thanks ? html`<p class="notice-ok" role="status">Thank you. Your experience has been sent to New Way’s and will appear once it has been approved.</p>` : ''}
${state.notice && open ? html`<p class="notice-bad" role="alert">${SHARE_NOTICES[state.notice]}</p>` : ''}
${Object.keys(e).length ? html`<p class="notice-bad" role="alert">Please check the highlighted details.</p>` : ''}
${!open ? html`<p>${SHARE_NOTICES.paused}</p>` : !cfg ? html`<p>${SHARE_NOTICES.closed}</p>` : form}
</section>`;
  return page(ctx, { route: 'reviews', title: 'Visitor Experiences', body, description: 'Experiences shared by visitors to New Way’s, Dundee.' });
}

// ---------- YouTube players: nothing loads from YouTube until a visitor taps play ----------

function videoPlayer({ id, url, title, thumbKey, embed }) {
  const watch = id ? watchUrl(id) : url;
  const thumb = thumbKey ? media(thumbKey) : id ? youtubeThumb(id) : '';
  return html`<div class="yt" data-embed="${embed && id ? '1' : '0'}">
<a class="yt-start" href="${watch}" target="_blank" rel="noopener"${embed && id ? html` data-yt="${id}" data-title="${title}"` : ''}>
${thumb ? html`<img src="${thumb}" alt="" loading="lazy" decoding="async">` : ''}
<span class="yt-play">${icon('playFill', 30)}</span><span class="sr-only">${embed && id ? 'Play' : 'Watch on YouTube:'} ${title}</span></a>
</div>`;
}

export async function videosPage(ctx) {
  const [blocks, videos] = await Promise.all([data.getBlocks(ctx.env, ['teaching_intro']), data.visibleVideos(ctx.env)]);
  const intro = blocks.teaching_intro;
  const groups = [];
  for (const v of videos) {
    const name = v.category || '';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(v);
  }
  const showHeadings = groups.length > 1 || (groups[0] && groups[0].name);
  const card = (v) => html`<li class="video card-gold">
${videoPlayer({ id: v.youtube_id, title: v.title, thumbKey: v.thumbnail_key, embed: !!v.embed_ok })}
<div class="video-body"><h3 class="video-title">${v.title}</h3>
${v.description ? html`<div class="prose">${formatText(v.description)}</div>` : ''}
<a class="btn-outline-gold press" href="${watchUrl(v.youtube_id)}" target="_blank" rel="noopener">${icon('external', 18)}Watch on YouTube</a></div></li>`;
  const body = html`${intro.body ? html`<div class="prose intro">${formatText(intro.body, { replaceTokens: ctx.fill })}</div>` : ''}
${videos.length ? groups.map((g) => html`<section class="video-group"${g.name ? '' : raw(' aria-label="Videos"')}>
${showHeadings ? html`<h2 class="card-title">${g.name || 'More videos'}</h2>` : ''}<ul class="video-grid">${g.items.map(card)}</ul></section>`)
    : html`<p class="empty-note">Teaching videos will appear here.</p>`}`;
  return page(ctx, { route: 'teaching-videos', title: 'Teaching Videos', body, description: 'Teaching videos from New Way’s and Medium Gary Findlay.' });
}

// ---------- Live ----------

export async function livePage(ctx) {
  const live = ctx.live || {};
  const id = youtubeId(live.youtube_url);
  const upcoming = live.scheduled_at && live.scheduled_at > new Date().toISOString();
  const body = live.is_live && live.youtube_url
    ? html`<section class="card-gold live-card" aria-labelledby="live-title">
<p class="live-status"><span class="live-dot" aria-hidden="true"></span><strong>LIVE NOW</strong></p>
${live.title ? html`<h2 class="card-title" id="live-title">${live.title}</h2>` : html`<h2 class="sr-only" id="live-title">Livestream</h2>`}
${videoPlayer({ id, url: live.youtube_url, title: live.title || 'Livestream', thumbKey: live.thumbnail_key, embed: !!live.embed_ok })}
${live.description ? html`<div class="prose">${formatText(live.description)}</div>` : ''}
<a class="btn-gold press" href="${id ? watchUrl(id) : live.youtube_url}" target="_blank" rel="noopener">Watch on YouTube</a>
</section>`
    : html`${halo('halo-readings', html`<span class="readings-core">${icon('live', 34)}</span>`)}
<p class="readings-text">No live broadcast at the moment</p>
${upcoming && live.title ? html`<section class="card-blue wed-note" aria-labelledby="next-live">
${live.thumbnail_key ? html`<img class="live-thumb" src="${media(live.thumbnail_key)}" alt="" loading="lazy">` : ''}
<h2 class="wed-note-title" id="next-live">Next broadcast</h2><p>${live.title}</p>
<p class="date-line">${icon('cal', 18, 'icon-gold')}<span>${friendlyDateTime(live.scheduled_at)}</span></p></section>` : ''}
<a class="btn-outline-gold press" href="/teaching-videos">Watch teaching videos</a>`;
  return page(ctx, { route: 'live', title: 'Live', body, mainClass: live.is_live && live.youtube_url ? '' : 'readings-main',
    description: 'Watch New Way’s livestreams.' });
}

// ---------- Privacy, offline and not found ----------

export async function privacyPage(ctx) {
  const { privacy_notice: block } = await data.getBlocks(ctx.env, ['privacy_notice']);
  const body = html`<section class="card-blue text-card prose-page"><div class="prose">${formatText(block.body, { replaceTokens: ctx.fill })}</div></section>`;
  return page(ctx, { route: 'privacy', title: 'Privacy Notice', body, description: 'How the New Way’s website and app use information.' });
}

export function offlinePage(ctx) {
  const body = html`<p class="empty-note">You’re offline. Pages you have opened before still work. Connect to the internet to see the latest details.</p>
<a class="btn-outline-gold press" href="/">Go to the home screen</a>`;
  return page(ctx, { route: 'offline', title: 'You’re offline', body, description: 'You are offline.' });
}

export function notFoundPage(ctx) {
  const body = html`<p class="empty-note">This page isn’t here. It may have moved, or the link may be mistyped.</p>
<a class="btn-outline-gold press" href="/">Go to the home screen</a>`;
  return page(ctx, { route: 'not-found', title: 'Page not found', body, description: 'Page not found.' });
}

export { esc, ukToday };
