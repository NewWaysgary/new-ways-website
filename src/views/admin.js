// Admin screens (mobile-first, for Gary's Android phone).
import { html, raw, esc } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { ASSET_VERSION } from '../lib/http.js';
import { SETTING_GROUPS, TOKENS } from '../lib/settings.js';
import { status, canMove } from '../admin/sections.js';
import { friendlyDateTime } from '../lib/dates.js';

export const WORDING = [
  { key: 'home_welcome', where: 'Home screen, welcome card', path: '/#welcome' },
  { key: 'development_circle', where: 'Development Circle page', path: '/development-circle' },
  { key: 'about_welcome', where: 'About page, first card', path: '/about' },
  { key: 'our_story', where: 'About page, Our story', path: '/about' },
  { key: 'wwd_services', where: 'About page, What we do', path: '/about' },
  { key: 'wwd_break', where: 'About page, What we do', path: '/about' },
  { key: 'wwd_circle', where: 'About page, What we do', path: '/about' },
  { key: 'mission', where: 'About page, Our mission', path: '/about' },
  { key: 'community', where: 'About page, Community', path: '/about' },
  { key: 'private_readings', where: 'Private Readings page', path: '/private-readings' },
  { key: 'charity_intro', where: 'Community & Charity page, introduction', path: '/charity' },
  { key: 'teaching_intro', where: 'Teaching Videos page, introduction', path: '/teaching-videos' },
  { key: 'tour_intro', where: 'Virtual tour page, introduction', path: '/tour' },
  { key: 'privacy_notice', where: 'Privacy Notice page', path: '/privacy' }
];

const TILES = [
  { href: '/admin/door', label: 'Wednesday Door', sub: 'Till, QR check-in, raffles and close night', icon: 'till', door: true },
  { href: '/admin/settings', label: 'Centre Settings', sub: 'Times, prices, address, links', icon: 'gear' },
  { href: '/admin/bookings', label: 'Bookings', sub: 'Upcoming readings and payments', icon: 'cal', badge: 'needsAttention', badgeText: 'need your attention' },
  { href: '/admin/readings', label: 'Private Readings', sub: 'Prices, availability and booking rules', icon: 'lotus' },
  { href: '/admin/meditations', label: 'Meditations', sub: 'Meditations to buy, previews and sales', icon: 'headphones' },
  { href: '/admin/whos-on', label: 'Who’s On', sub: 'Guest mediums and photos', icon: 'person' },
  { href: '/admin/events', label: 'Events', sub: 'Events, tickets, guest lists and totals', icon: 'stars' },
  { href: '/admin/checkin', label: 'Check in', sub: 'Scan event QR codes and check guests in', icon: 'ticket' },
  { href: '/admin/chat', label: 'Live chat', sub: 'Messages from the website, and notifications', icon: 'chat', badge: 'chatUnread', badgeText: 'new chat messages' },
  { href: '/admin/mailing-list', label: 'Mailing list', sub: 'Subscribers, Join page and table QR code', icon: 'mail' },
  { href: '/admin/announcements', label: 'Announcements', sub: 'Closures, changes, notices', icon: 'megaphone' },
  { href: '/admin/charity', label: 'Community & Charity', sub: 'Charity totals', icon: 'heart' },
  { href: '/admin/faqs', label: 'FAQs', sub: 'Questions and answers', icon: 'question' },
  { href: '/admin/social-links', label: 'Social links', sub: 'Facebook, YouTube and others', icon: 'link' },
  { href: '/admin/wording', label: 'Pages and wording', sub: 'Home, About, Development Circle, Privacy', icon: 'pen' },
  { href: '/admin/reviews', label: 'Visitor experiences', sub: 'Approve or reject', icon: 'quote', badge: 'pendingReviews' },
  { href: '/admin/gallery', label: 'Gallery', sub: 'Photos from your phone', icon: 'image' },
  { href: '/admin/tour', label: 'Virtual tour', sub: 'Genuine photos of the centre, in order', icon: 'tour' },
  { href: '/admin/teaching-videos', label: 'Teaching videos', sub: 'YouTube links', icon: 'play' },
  { href: '/admin/live', label: 'Live', sub: 'YouTube Live and LIVE NOW', icon: 'live' },
  { href: '/admin/music', label: 'Background music', sub: 'Track and volume', icon: 'music' },
  { href: '/admin/backups', label: 'Backups', sub: 'Download everything', icon: 'save' },
  { href: '/admin/status', label: 'System status', sub: 'Go-live check and test email', icon: 'shield' },
  { href: '/admin/team', label: 'Admin team', sub: 'Give Julie (or others) full Admin', icon: 'team', ownerOnly: true }
];

export function adminPage({ title, body, csrf, back = true, signedIn = false, scripts = [] }) {
  return html`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#000428">
<meta name="color-scheme" content="dark">
<title>${title} | New Way’s Admin</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&amp;family=Jost:wght@400;500&amp;display=swap" crossorigin>
<link rel="stylesheet" href="/css/admin.css?v=${ASSET_VERSION}">
<script src="/js/admin.js?v=${ASSET_VERSION}" defer></script>
${scripts.map((src) => html`<script src="${src}?v=${ASSET_VERSION}" defer></script>`)}
</head>
<body>
<header class="admin-top">
<a class="admin-brand" href="/admin"><img src="/images/logo-160.webp" alt="" width="40" height="40"><span>New Way’s Admin</span></a>
<div class="admin-top-actions">
<a class="admin-view-site" href="/" target="_blank" rel="noopener" aria-label="View the website">${icon('external', 18)}<span class="wide-only">View site</span></a>
${signedIn && csrf ? html`<form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${csrf}"><button class="admin-signout" type="submit">Sign out</button></form>` : ''}
</div>
</header>
<main class="admin-main" id="main">
${back ? html`<a class="admin-back" href="/admin">${icon('chev', 18, 'flip')}<span>Admin home</span></a>` : ''}
<h1>${title}</h1>
${body}
</main>
</body>
</html>`;
}

export function lockedPage() {
  return adminPage({
    title: 'Admin is not switched on yet',
    back: false,
    body: html`<div class="panel">
<p>Sign-in for Admin has not been connected on this address yet, so Admin stays locked and nothing on the site can be changed from here.</p>
<p><a class="link" href="/">Go to the New Way’s home screen</a></p>
</div>`
  });
}

const SIGNIN_MESSAGES = {
  'signed-out': 'You’ve signed out.',
  expired: 'That sign-in didn’t complete or took too long. Please try again.',
  cancelled: 'Sign-in was cancelled.',
  unavailable: 'The sign-in service didn’t respond. Please try again in a minute.',
  'not-owner': 'That account isn’t allowed to use New Way’s Admin.',
  'too-many': 'Too many sign-in attempts from this connection. Please wait 10 minutes and try again.'
};

export function signInPage(reason) {
  const message = SIGNIN_MESSAGES[reason];
  return adminPage({
    title: 'Sign in to Admin',
    back: false,
    body: html`${message ? html`<p class="banner${reason === 'signed-out' ? ' banner-ok' : ' banner-error'}" role="status">${message}</p>` : ''}
<div class="panel signin-panel">
<p>Admin is for the owner of New Way’s only. You’ll sign in on the secure sign-in page, then come straight back here.</p>
<a class="btn-gold btn-link" href="/admin/login">Sign in</a>
<p class="hint">Forgotten your password? Use “Forgot password” on the sign-in page and a reset link is emailed to you.</p>
</div>`
  });
}

export function deniedPage(logoutUrl) {
  return adminPage({
    title: 'Not allowed',
    back: false,
    body: html`<div class="panel">
<p>${SIGNIN_MESSAGES['not-owner']}</p>
${logoutUrl ? html`<p><a class="btn-gold btn-link" href="${logoutUrl}">Sign out of that account</a></p>` : ''}
<p><a class="link" href="/">Go to the New Way’s home screen</a></p>
</div>`
  });
}

export function dashboardPage({ settings, counts, faqsMissing, privacyOutdated = false, privacyNoMailing = false, privacyNotCurrent = false, email, role = 'owner', name = '',
  musicWarnings = [], teamCount = 0, csrf }) {
  const todo = [];
  if (role === 'owner' && !teamCount) todo.push(['Give Julie full Admin (her own sign-in)', '/admin/team']);
  if (!settings.notification_email_2) todo.push(['Add Julie’s email address for booking and sales notifications', '/admin/readings#rules']);
  if (settings.chat_enabled !== '1') todo.push(['Switch on live chat when you’re ready (and turn on notifications on Julie’s phone)', '/admin/chat']);
  if (musicWarnings.includes('off')) todo.push(['Background music is uploaded but switched off, so visitors don’t see the Music button', '/admin/music']);
  if (musicWarnings.includes('paid')) todo.push(['Check the background music: it looks like a paid meditation', '/admin/music']);
  if (!settings.directions_link) todo.push(['Add the exact Google Maps directions link', '/admin/settings#venue']);
  if (!settings.notification_email) todo.push(['Add the email address for booking and sales notifications', '/admin/readings#rules']);
  if (!settings.phone && !settings.email && !settings.contact_info) todo.push(['Add contact details', '/admin/settings#contact']);
  if (!settings.parking_info) todo.push(['Add parking information', '/admin/settings#venue']);
  if (!settings.transport_info) todo.push(['Add public transport information', '/admin/settings#venue']);
  if (!settings.circle_start) todo.push(['Add Development Circle times', '/admin/settings#wednesday']);
  if (!settings.service_end) todo.push(['Add the time the service ends', '/admin/settings#wednesday']);
  if (privacyOutdated || privacyNoMailing || privacyNotCurrent) todo.push(['Use the updated Privacy Notice (it covers bookings, event guests and table plans, Wednesday payments, live chat and the mailing list)', '/admin/wording/privacy_notice']);
  for (const q of faqsMissing) todo.push([`Answer the FAQ: “${q}”`, '/admin/faqs']);

  return adminPage({
    title: 'Admin',
    back: false,
    csrf,
    signedIn: true,
    body: html`<p class="hint">Signed in as ${email}${role === 'admin' ? ' (full Admin)' : ''}</p>
<section class="stats" aria-label="At a glance">
<p><strong>${counts.upcomingMediums}</strong> upcoming guest mediums</p>
<p><strong>${counts.upcomingEvents}</strong> upcoming events</p>
<p><strong>${counts.pendingReviews}</strong> experiences awaiting approval</p>
<p><strong>${counts.upcomingReadings ?? 0}</strong> upcoming private readings</p>
</section>
<section class="stats stats-private" aria-label="Private website statistics">
<p><strong>${counts.uniqueVisitors}</strong> unique visitors</p>
<p><strong>${counts.appInstalls}</strong> app installs</p>
</section>
<nav aria-label="Admin sections">
<ul class="tiles">
${TILES.filter((t) => !t.ownerOnly || role === 'owner').map((t) => html`<li>${t.href
      ? html`<a class="tile${t.door ? ' tile-door' : ''}" href="${t.href}">${icon(t.icon, 24)}<span class="tile-text"><span class="tile-label">${t.label}</span><span class="tile-sub">${t.badge && counts[t.badge] ? `${counts[t.badge]} ${t.badgeText || 'awaiting approval'}` : t.sub}</span></span>${t.badge && counts[t.badge] ? html`<span class="badge">${counts[t.badge]}</span>` : ''}${icon('chev', 20)}</a>`
      : html`<div class="tile tile-later" aria-disabled="true">${icon(t.icon, 24)}<span class="tile-text"><span class="tile-label">${t.label}</span><span class="tile-sub">${t.sub}</span></span><span class="soon">Next stage</span></div>`}</li>`)}
</ul>
</nav>
${todo.length ? html`<section class="panel" aria-labelledby="todo">
<h2 id="todo">Still to add</h2>
<p class="hint">These details are empty, so the site doesn’t show them yet.</p>
<ul class="todo">${todo.map(([t, href]) => html`<li><a href="${href}">${t}</a></li>`)}</ul>
</section>` : ''}`
  });
}

// ---------- shared list and edit screens for the six sections ----------

const thumb = (key, url) => key ? html`<img class="row-thumb" src="/media/${encodeURIComponent(key)}" alt="" loading="lazy">`
  : url ? html`<img class="row-thumb row-thumb-wide" src="${url}" alt="" loading="lazy">` : '';

function rowCard(slug, section, rows, row, csrf) {
  const s = section.summary(row);
  const moves = canMove(section, rows, row);
  const toggleField = section.toggleField || 'visible';
  const on = row[toggleField];
  const action = (path, label, extra = '') => html`<form method="post" action="/admin/${slug}/${row.id}/${path}">
<input type="hidden" name="_csrf" value="${csrf}">${raw(extra)}<button type="submit" class="pill">${label}</button></form>`;
  return html`<li class="row-card">
<div class="row-main">
${thumb(s.image, s.imageUrl)}
<div class="row-text">
<span class="row-title">${s.title}</span>
${s.lines.map((l) => html`<span class="row-line">${l}</span>`)}
${status(section, row).length ? html`<span class="chips">${status(section, row).map(([k, t]) => html`<span class="chip chip-${k}">${t}</span>`)}</span>` : ''}
</div>
</div>
<div class="row-actions">
<a class="pill pill-gold" href="/admin/${slug}/${row.id}">Edit</a>
${section.extraActions ? section.extraActions(row).map(([href, label]) => html`<a class="pill pill-gold" href="${href}">${label}</a>`) : ''}
${action('toggle', toggleField === 'active' ? (on ? 'Switch off' : 'Switch on') : (on ? 'Hide' : 'Show'))}
${moves.up ? action('move', html`<span aria-hidden="true">↑</span> Move up`, '<input type="hidden" name="dir" value="up">') : ''}
${moves.down ? action('move', html`<span aria-hidden="true">↓</span> Move down`, '<input type="hidden" name="dir" value="down">') : ''}
</div>
</li>`;
}

const FLASH = { saved: 'Saved. The website shows the change now.', added: 'Added. The website shows it now.', deleted: 'Deleted from the website.', moved: 'Order changed.', toggled: 'Updated.',
  'added-hidden': 'Added, and hidden for now. Tap Show when it is ready.', noembed: 'Saved. YouTube doesn’t allow this video to play on other websites, so visitors will get a Watch on YouTube button.',
  uploaded: 'Photos added. The website shows them now.',
  'has-bookings': 'This event has bookings, so it can’t be deleted. To take it off the website, untick “Published” instead.' };

export function listPage({ slug, section, rows, flash, csrf, today, extra = '', flashText = '' }) {
  const current = section.dated ? rows.filter((r) => r.date >= today) : rows;
  const past = section.dated ? rows.filter((r) => r.date < today).reverse() : [];
  return adminPage({
    title: section.title,
    csrf,
    signedIn: true,
    body: html`<p class="hint">${section.intro} <a class="link" href="${section.publicPath}" target="_blank" rel="noopener">See it on the site</a></p>
${FLASH[flash] || flashText ? html`<p class="banner banner-ok" role="status">${FLASH[flash] || flashText}</p>` : ''}
<p><a class="btn-gold btn-link" href="/admin/${slug}/new">${section.addLabel}</a></p>
${extra}
${current.length ? html`<ul class="rows">${current.map((r) => rowCard(slug, section, current, r, csrf))}</ul>`
      : html`<p class="panel">Nothing here yet. Use “${section.addLabel}” to add the first one.</p>`}
${past.length ? html`<details class="panel past"><summary>Past entries (${past.length}), not shown on the website</summary>
<ul class="rows">${past.slice(0, 30).map((r) => rowCard(slug, section, past, r, csrf))}</ul></details>` : ''}`
  });
}

export function sectionField(f, value, error) {
  const id = 'f-' + f.key;
  const describedBy = [f.help ? id + '-help' : '', error ? id + '-err' : ''].filter(Boolean).join(' ');
  const aria = raw(`${describedBy ? ` aria-describedby="${describedBy}"` : ''}${error ? ' aria-invalid="true"' : ''}${f.required ? ' required' : ''}`);
  let control;
  if (f.type === 'heading') {
    return html`<h2 class="field-group" id="${f.key.replace(/^_/, 'g-')}">${f.label}</h2>${f.help ? html`<p class="hint">${f.help}</p>` : ''}`;
  }
  if (f.type === 'checkbox') {
    return html`<div class="field field-check"><label><input type="checkbox" name="${f.key}" value="1"${Number(value) ? raw(' checked') : ''}> ${f.label}</label>${f.help ? html`<p class="hint">${f.help}</p>` : ''}</div>`;
  } else if (f.type === 'textarea') {
    control = html`<textarea id="${id}" name="${f.key}" rows="${f.rows || 4}"${aria}>${value}</textarea>`;
  } else if (f.type === 'select') {
    control = html`<select id="${id}" name="${f.key}"${aria}>${f.options.map(([v, l]) => html`<option value="${v}"${v === value ? raw(' selected') : ''}>${l}</option>`)}</select>`;
  } else if (f.type === 'money') {
    control = html`<span class="price-input"><span aria-hidden="true">£</span><input id="${id}" name="${f.key}" type="text" inputmode="decimal" autocomplete="off" value="${value}"${aria}></span>`;
  } else if (f.type === 'image') {
    control = html`<div class="image-field">
${value ? html`<img class="image-current" src="/media/${encodeURIComponent(value)}" alt="Current ${f.label.toLowerCase()}">
<label class="field-check"><input type="checkbox" name="remove_${f.key}" value="1"> Remove this picture</label>` : ''}
<input id="${id}" name="${f.key}" type="file" accept="image/jpeg,image/png,image/webp" data-resize="${f.maxEdge}" data-quality="${f.quality}"${f.thumbEdge ? raw(` data-thumb="${f.thumbEdge}"`) : ''}${f.thumbType ? raw(` data-thumb-type="${f.thumbType}"`) : ''}${aria}>
${f.thumbEdge ? html`<input type="file" name="${f.key}__thumb" class="thumb-input" hidden tabindex="-1" aria-hidden="true">` : ''}
<img class="image-preview" alt="" hidden>
<p class="hint image-status" aria-live="polite"></p>
</div>`;
  } else {
    const type = { date: 'date', url: 'url', datetime: 'datetime-local', time: 'time' }[f.type] || 'text';
    control = html`<input id="${id}" name="${f.key}" type="${type}" value="${value}" autocomplete="off"${f.placeholder ? html` placeholder="${f.placeholder}"` : ''}${f.suggestions ? raw(` list="${id}-list"`) : ''}${type === 'url' ? raw(' inputmode="url" spellcheck="false"') : ''}${f.type === 'int' ? raw(' inputmode="numeric"') : ''}${aria}>
${f.suggestions ? html`<datalist id="${id}-list">${f.suggestions.map((x) => html`<option value="${x}"></option>`)}</datalist>` : ''}`;
  }
  return html`<div class="field${error ? ' has-error' : ''}">
<label for="${id}">${f.label}</label>
${control}
${f.help ? html`<p class="hint" id="${id}-help">${f.help}</p>` : ''}
${f.tokens ? html`<details class="help"><summary>Details you can use</summary><p class="hint">${TOKENS.map(([n]) => html`<code>{${n}}</code> `)}</p></details>` : ''}
${error ? html`<p class="error" id="${id}-err">${error}</p>` : ''}
</div>`;
}

export function editPage({ slug, section, id, values, errors = {}, csrf, uploadError, suggestions }) {
  const hasImage = section.fields.some((f) => f.type === 'image');
  const count = Object.keys(errors).length + (uploadError ? 1 : 0);
  const title = id ? `Edit ${section.noun}` : section.addLabel;
  return adminPage({
    title,
    csrf,
    signedIn: true,
    body: html`<p><a class="link" href="/admin/${slug}">Back to ${section.title}</a></p>
${count ? html`<p class="banner banner-error" role="alert">Not saved yet. ${uploadError || 'Please check the highlighted ' + (count === 1 ? 'detail.' : 'details.')}</p>` : ''}
<form method="post" action="/admin/${slug}/${id || 'new'}" class="admin-form" data-unsaved-warning${hasImage ? raw(' enctype="multipart/form-data"') : ''}>
<input type="hidden" name="_csrf" value="${csrf}">
<div class="panel">${section.fields.map((f) => sectionField(suggestions && suggestions[f.key] ? { ...f, suggestions: suggestions[f.key] } : f, values[f.key] ?? '', errors[f.key]))}</div>
<div class="save-bar"><button class="btn-gold" type="submit">${id ? 'Save changes' : section.addLabel}</button></div>
</form>
${id ? html`<form method="post" action="/admin/${slug}/${id}/delete" class="delete-form">
<input type="hidden" name="_csrf" value="${csrf}">
<button type="submit" class="btn-danger" data-confirm="${section.deleteConfirm || `Delete this ${section.noun}? This can’t be undone.`}">${section.deleteConfirm ? 'Remove from New Way’s' : `Delete this ${section.noun}`}</button>
${section.table === 'mediums' ? html`<p class="hint">Tip: to take it off the website for now without deleting it, untick “Show on the website”.</p>` : ''}
${section.table === 'events' ? html`<p class="hint">Tip: to take it off the website for now without deleting it, untick “Published”. An event with bookings can’t be deleted.</p>` : ''}
</form>` : ''}`
  });
}

function fieldInput(f, value, error) {
  const id = 'f-' + f.key;
  const describedBy = [f.help ? id + '-help' : '', error ? id + '-err' : ''].filter(Boolean).join(' ');
  const common = raw(`id="${id}" name="${esc(f.key)}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}${error ? ' aria-invalid="true"' : ''}${f.required ? ' required' : ''}`);
  let control;
  if (f.type === 'textarea') control = html`<textarea ${common} rows="${f.rows || 3}">${value}</textarea>`;
  else if (f.type === 'price') control = html`<span class="price-input"><span aria-hidden="true">£</span><input ${common} type="text" inputmode="decimal" autocomplete="off" value="${value}"></span>`;
  else {
    const type = { url: 'url', email: 'email', tel: 'tel' }[f.type] || 'text';
    control = html`<input ${common} type="${type}" value="${value}" autocomplete="off"${f.placeholder ? html` placeholder="${f.placeholder}"` : ''}${type === 'url' ? raw(' inputmode="url" spellcheck="false"') : ''}>`;
  }
  return html`<div class="field${error ? ' has-error' : ''}">
<label for="${id}">${f.label}</label>
${control}
${f.help ? html`<p class="hint" id="${id}-help">${f.help}</p>` : ''}
${error ? html`<p class="error" id="${id}-err">${error}</p>` : ''}
</div>`;
}

export function settingsPage({ values, errors = {}, saved = false, csrf }) {
  const errorCount = Object.keys(errors).length;
  return adminPage({
    title: 'Centre Settings',
    csrf,
    signedIn: true,
    body: html`<p class="hint">Change a detail once here and the whole site shows the new version.</p>
${saved ? html`<p class="banner banner-ok" role="status">Saved. The site now shows these details everywhere.</p>` : ''}
${errorCount ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the ${errorCount === 1 ? 'highlighted detail' : errorCount + ' highlighted details'}.</p>` : ''}
<form method="post" action="/admin/settings" class="admin-form" data-unsaved-warning>
<input type="hidden" name="_csrf" value="${csrf}">
${SETTING_GROUPS.map((g) => html`<fieldset class="panel" id="${g.id}">
<legend>${g.title}</legend>
${g.intro ? html`<p class="hint">${g.intro}</p>` : ''}
${g.fields.map((f) => fieldInput(f, values[f.key] ?? '', errors[f.key]))}
</fieldset>`)}
<div class="save-bar"><button class="btn-gold" type="submit">Save changes</button></div>
</form>`
  });
}

function formatPreview(text) {
  return String(text).split(/\n\s*\n/).map((p) => (p.startsWith('# ') ? `<h3>${esc(p.slice(2))}</h3>` : `<p>${esc(p)}</p>`)).join('');
}

export function wordingListPage({ blocks, csrf }) {
  const byKey = Object.fromEntries(blocks.map((b) => [b.key, b]));
  return adminPage({
    title: 'Pages and wording',
    csrf,
    signedIn: true,
    body: html`<p class="hint">Choose the wording to change.</p>
<ul class="tiles">
${WORDING.map((w) => html`<li><a class="tile" href="/admin/wording/${w.key}">${icon('pen', 22)}<span class="tile-text"><span class="tile-label">${byKey[w.key]?.title || w.where}</span><span class="tile-sub">${w.where}</span></span>${icon('chev', 20)}</a></li>`)}
</ul>`
  });
}

export function wordingEditPage({ entry, block, errors = {}, saved = false, csrf, privacyUpdate = null, updated = false }) {
  return adminPage({
    title: block.title || entry.where,
    csrf,
    signedIn: true,
    body: html`<p class="hint">Shown on: ${entry.where}. <a class="link" href="${entry.path}" target="_blank" rel="noopener">See it on the site</a></p>
${saved ? html`<p class="banner banner-ok" role="status">Saved. The site shows the new wording now.</p>` : ''}
${updated ? html`<p class="banner banner-ok" role="status">The updated Privacy Notice is now on the website. Your previous wording has been kept (Admin can put it back from a backup if ever needed). Please read it through.</p>` : ''}
${privacyUpdate ? html`<section class="panel" aria-labelledby="pn-up"><h2 id="pn-up">An updated Privacy Notice is ready</h2>
<p class="hint">Written to cover everything the website now does: bookings and payments, meditation download security, event guest answers and table plans, Wednesday advance payments and QR codes, live chat, the mailing list, how long information is kept, and people’s rights. Please read it before going live: it describes what the website does, but it is not legal advice.</p>
<details class="help"><summary>Read the updated notice</summary><div class="terms-text">${raw(formatPreview(privacyUpdate))}</div></details>
<form method="post" action="/admin/wording/privacy_notice/update"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn-gold" type="submit" data-confirm="Replace the Privacy Notice with the updated one? Your current wording is kept as a copy.">Use the updated Privacy Notice</button></form>
</section>` : ''}
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the highlighted detail.</p>` : ''}
<form method="post" action="/admin/wording/${entry.key}" class="admin-form" data-unsaved-warning>
<input type="hidden" name="_csrf" value="${csrf}">
<div class="panel">
<div class="field${errors.title ? ' has-error' : ''}"><label for="w-title">Heading</label>
<input id="w-title" name="title" type="text" value="${block.title}" autocomplete="off">
${errors.title ? html`<p class="error">${errors.title}</p>` : ''}</div>
<div class="field${errors.body ? ' has-error' : ''}"><label for="w-body">Wording</label>
<textarea id="w-body" name="body" rows="16" aria-describedby="w-help">${block.body}</textarea>
${errors.body ? html`<p class="error">${errors.body}</p>` : ''}</div>
<details class="help" id="w-help"><summary>Formatting help</summary>
<ul>
<li>Leave a blank line between paragraphs.</li>
<li>Start a line with <code>-</code> and a space to make a bullet point.</li>
<li>Start a line with <code>#</code> and a space to make a small heading.</li>
<li>Type a detail from Centre Settings in curly brackets and the site fills it in, for example <code>{Entry price}</code>.</li>
</ul>
<p class="hint">Details you can use: ${TOKENS.map(([n]) => html`<code>{${n}}</code> `)}</p>
</details>
</div>
<div class="save-bar"><button class="btn-gold" type="submit">Save changes</button></div>
</form>`
  });
}

export function messagePage(title, message, status = 400) {
  return { status, body: adminPage({ title, body: html`<div class="panel"><p>${message}</p><p><a class="link" href="/admin">Back to Admin</a></p></div>` }) };
}

// ---------- Gallery: several photos at once ----------
export function galleryUploadForm(csrf) {
  return html`<form method="post" action="/admin/gallery/upload" enctype="multipart/form-data" class="panel multi-upload">
<input type="hidden" name="_csrf" value="${csrf}">
<div class="field image-field">
<label for="g-photos">Add several photos at once (up to 10)</label>
<input id="g-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple data-resize="1800" data-quality="0.85" data-thumb="600">
<input type="file" name="photos__thumb" class="thumb-input" multiple hidden tabindex="-1" aria-hidden="true">
<img class="image-preview" alt="" hidden>
<p class="hint image-status" aria-live="polite"></p>
</div>
<button class="btn-gold" type="submit">Add these photos</button>
</form>`;
}

// ---------- Visitor experiences ----------
const REVIEW_TABS = [['pending', 'Awaiting approval'], ['approved', 'Approved'], ['hidden', 'Hidden'], ['rejected', 'Rejected']];
const REVIEW_FLASH = { approve: 'Approved. It now shows on the website.', reject: 'Rejected. It will never be shown, and it is deleted automatically after 30 days.',
  hide: 'Hidden from the website.', show: 'Showing on the website again.', feature: 'Featured on the Home screen.', unfeature: 'No longer featured.', delete: 'Deleted permanently.',
  opened: 'Sharing is open. Visitors can send their experiences again.', closed: 'Sharing is closed. The website no longer accepts new experiences.' };

export function reviewsAdminPage({ rows, current, counts, csrf, flash, top = '' }) {
  const act = (r, action, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/reviews/${r.id}/${action}">
<input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="${cls}"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  return adminPage({
    title: 'Visitor experiences',
    csrf,
    signedIn: true,
    body: html`<p class="hint">Nothing is ever shown on the website until you approve it. Rejected experiences are never shown and are deleted automatically after 30 days.</p>
${REVIEW_FLASH[flash] ? html`<p class="banner banner-ok" role="status">${REVIEW_FLASH[flash]}</p>` : ''}
${top}
<nav class="tabs" aria-label="Show experiences">${REVIEW_TABS.map(([k, label]) => html`<a class="tab-link${k === current ? ' is-current' : ''}" href="/admin/reviews?status=${k}"${k === current ? raw(' aria-current="page"') : ''}>${label} <span class="count">${counts[k] || 0}</span></a>`)}</nav>
${rows.length ? html`<ul class="rows">${rows.map((r) => html`<li class="row-card review-card">
<div class="row-text">
<span class="row-title">${r.name}${r.rating ? html` <span class="stars" aria-label="${r.rating} out of 5 stars">${'★'.repeat(r.rating)}</span>` : ''}</span>
<span class="row-line">Sent ${friendlyDateTime(r.created_at)}</span>
${r.status === 'pending' ? html`<span class="chips"><span class="chip chip-soon">AWAITING APPROVAL</span></span>` : ''}
${r.featured && r.status === 'approved' ? html`<span class="chips"><span class="chip chip-live">Featured on Home</span></span>` : ''}
</div>
<blockquote class="review-text">${r.body}</blockquote>
<div class="row-actions">
${r.status === 'pending' || r.status === 'rejected' ? act(r, 'approve', 'Approve', 'pill pill-gold') : ''}
${r.status === 'pending' ? act(r, 'reject', 'Reject') : ''}
${r.status === 'approved' ? act(r, r.featured ? 'unfeature' : 'feature', r.featured ? 'Unfeature' : 'Feature on Home', 'pill pill-gold') : ''}
${r.status === 'approved' ? act(r, 'hide', 'Hide') : ''}
${r.status === 'hidden' ? act(r, 'show', 'Show again', 'pill pill-gold') : ''}
${act(r, 'delete', 'Delete', 'pill pill-danger', 'Delete this experience permanently?')}
</div>
</li>`)}</ul>` : html`<p class="panel">${current === 'pending' ? 'No experiences are waiting for approval.' : 'Nothing here.'}</p>`}`
  });
}

// ---------- Live ----------
const LIVE_FLASH = { saved: 'Saved.', on: 'LIVE NOW is showing on every page of the website.', off: 'LIVE NOW is switched off.',
  noembed: 'Saved. YouTube doesn’t allow this stream on other websites, so visitors will get a Watch on YouTube button.' };

export function liveAdminPage({ section, values, live, errors = {}, csrf, flash, uploadError, canCopy }) {
  const count = Object.keys(errors).length + (uploadError ? 1 : 0);
  return adminPage({
    title: 'Live',
    csrf,
    signedIn: true,
    body: html`<p class="hint">Livestreams run on YouTube Live. New Way’s shows LIVE NOW and the stream while it is switched on here. <a class="link" href="/live" target="_blank" rel="noopener">See it on the site</a></p>
${LIVE_FLASH[flash] ? html`<p class="banner banner-ok" role="status">${LIVE_FLASH[flash]}</p>` : ''}
<section class="panel live-switch${live.is_live ? ' is-live' : ''}" aria-labelledby="live-state">
<h2 id="live-state">${live.is_live ? html`<span class="live-dot" aria-hidden="true"></span> LIVE NOW is on` : 'LIVE NOW is off'}</h2>
<form method="post" action="/admin/live/${live.is_live ? 'off' : 'on'}"><input type="hidden" name="_csrf" value="${csrf}">
<button class="${live.is_live ? 'btn-danger' : 'btn-gold'}" type="submit">${live.is_live ? 'Switch LIVE NOW off' : 'Switch LIVE NOW on'}</button></form>
${!live.youtube_url ? html`<p class="hint">Add the YouTube Live link below first, so visitors can watch.</p>` : ''}
</section>
${count ? html`<p class="banner banner-error" role="alert">Not saved yet. ${uploadError || 'Please check the highlighted details.'}</p>` : ''}
<form method="post" action="/admin/live" class="admin-form" enctype="multipart/form-data" data-unsaved-warning>
<input type="hidden" name="_csrf" value="${csrf}">
<div class="panel">${section.fields.map((f) => sectionField(f, values[f.key] ?? '', errors[f.key]))}</div>
<div class="save-bar"><button class="btn-gold" type="submit">Save changes</button></div>
</form>
${canCopy ? html`<section class="panel"><h2>After the broadcast</h2>
<p class="hint">Once the recording is on YouTube, you can add it to Teaching Videos. It is added hidden, so you can check it first.</p>
<form method="post" action="/admin/live/to-videos"><input type="hidden" name="_csrf" value="${csrf}"><button class="pill pill-gold" type="submit">Add this recording to Teaching Videos</button></form>
</section>` : ''}`
  });
}

// ---------- Background music ----------
const MUSIC_FLASH = { saved: 'Saved.', uploaded: 'Music uploaded.', removed: 'Music removed from the website.' };

export function musicAdminPage({ music, file, warnings = [], csrf, flash, errors = {} }) {
  return adminPage({
    title: 'Background music',
    csrf,
    signedIn: true,
    body: html`<p class="hint">Music never starts by itself. Visitors see a small Music button and choose whether to play it; their choice is remembered on their own device. Only use music you have permission to play publicly.</p>
${MUSIC_FLASH[flash] ? html`<p class="banner banner-ok" role="status">${MUSIC_FLASH[flash]}</p>` : ''}
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the highlighted details.</p>` : ''}
${music.track_key ? (music.enabled
    ? html`<p class="banner banner-ok" role="status"><strong>Music is ON.</strong> Visitors see a gold Music button at the bottom of the screen and tap it to play. Phones never allow music to start by itself, so it always waits for that tap.</p>`
    : html`<p class="banner banner-error" role="alert"><strong>Music is uploaded but switched OFF</strong>, so visitors don’t see the Music button. Tick “Music on the website” below and press Save changes.</p>`)
    : html`<p class="banner" role="status">No music is uploaded, so there is no Music button on the website.</p>`}
${warnings.includes('paid') ? html`<p class="banner banner-error" role="alert"><strong>Please check this track.</strong> It looks like a meditation that is sold in the Meditation Shop. Playing it as background music would let anyone hear the paid recording free. Use a different piece of music you have permission to play.</p>` : ''}
<section class="panel" aria-labelledby="track">
<h2 id="track">Track</h2>
${music.track_key ? html`<p>${music.track_title || 'Current track'}${file ? html` <span class="hint">(${Math.round(file.size_bytes / 1024 / 102.4) / 10} MB)</span>` : ''}</p>
<audio controls preload="none" src="/media/${music.track_key}"></audio>` : html`<p>No music uploaded yet.</p>`}
<form class="music-upload" data-upload="/admin/music/upload" data-csrf="${csrf}">
<label for="m-file">${music.track_key ? 'Replace the track' : 'Upload a track'} (MP3, M4A or OGG, up to 20 MB)</label>
<input id="m-file" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.m4a,.aac,.ogg">
<progress max="100" value="0" hidden></progress>
<p class="hint upload-status" aria-live="polite"></p>
<button class="btn-gold" type="submit">Upload</button>
</form>
${music.track_key ? html`<form method="post" action="/admin/music/remove" class="delete-form"><input type="hidden" name="_csrf" value="${csrf}">
<button class="btn-danger" type="submit" data-confirm="Remove the music from the website?">Remove the music</button></form>` : ''}
</section>
<form method="post" action="/admin/music" class="admin-form" data-unsaved-warning>
<input type="hidden" name="_csrf" value="${csrf}">
<div class="panel">
${sectionField({ key: 'track_title', label: 'Track name (optional)', type: 'text', max: 120 }, music.track_title, errors.track_title)}
${sectionField({ key: 'default_volume', label: 'Starting volume (0 to 100)', type: 'text', help: 'Visitors can mute it at any time.' }, String(music.default_volume), errors.default_volume)}
${sectionField({ key: 'enabled', label: 'Music on the website', type: 'checkbox' }, music.enabled)}
</div>
<div class="save-bar"><button class="btn-gold" type="submit">Save changes</button></div>
</form>`
  });
}

// ---------- Backups ----------
const mb = (bytes) => (bytes / 1048576 < 0.1 && bytes > 0 ? '0.1' : (Math.round(bytes / 104857.6) / 10).toString());

export function backupsPage({ stored, usage, csrf, flash }) {
  const percent = Math.max(0, Math.min(100, (usage.bytes / (10 * 1073741824)) * 100));
  return adminPage({
    title: 'Backups',
    csrf,
    signedIn: true,
    body: html`${flash === 'stored' ? html`<p class="banner banner-ok" role="status">A backup copy has been saved.</p>` : ''}
<section class="panel" aria-labelledby="b-download">
<h2 id="b-download">Download a backup</h2>
<p class="hint">One file with all the wording, Centre Settings, guest mediums, events, charity totals, FAQs, announcements, visitor experiences, videos, live and music settings, private reading prices, availability, bookings and orders, and a list of every photo and music file. Keep it somewhere safe, for example in Google Drive.</p>
<a class="btn-gold btn-link" href="/admin/backups/download">Download a backup now</a>
</section>
<section class="panel" aria-labelledby="b-auto">
<h2 id="b-auto">Automatic copies</h2>
<p class="hint">A copy is saved automatically every week, and the last 8 are kept (about two months).</p>
${stored.length ? html`<ul class="backup-list">${stored.map((b) => html`<li><a href="/admin/backups/file/${b.name}">${b.name.replace(/^new-ways-backup-/, '').replace(/\.json$/, '').replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/, '$1 at $2:$3 UTC')}</a> <span class="hint">${mb(b.size)} MB</span></li>`)}</ul>`
      : html`<p>No automatic copies yet. The first is made within a day of the site going online.</p>`}
<form method="post" action="/admin/backups/now"><input type="hidden" name="_csrf" value="${csrf}"><button class="pill pill-gold" type="submit">Save a copy now</button></form>
</section>
<section class="panel" aria-labelledby="b-storage">
<h2 id="b-storage">Photo and music storage</h2>
<p>${usage.files} files, ${mb(usage.bytes)} MB of the free 10 GB (${percent < 1 ? 'under 1' : Math.round(percent)}% used).</p>
<meter class="meter" min="0" max="100" value="${percent.toFixed(2)}" aria-label="Free storage used">${Math.round(percent)}%</meter>
</section>
<section class="panel" aria-labelledby="b-recover">
<h2 id="b-recover">If something goes wrong</h2>
<ul class="todo">
<li>Changed or deleted something by mistake? Cloudflare keeps a rewind of the database for the last 7 days. A developer can rewind it to any minute in that time.</li>
<li>A backup file can rebuild all the content on a new or repaired site. A developer uses the restore tool included with the website’s files.</li>
<li>Photos and music are kept separately. Replacing or deleting one removes the old file, so keep your originals on your phone as well.</li>
<li>Teaching videos and livestreams are safe on YouTube; New Way’s only stores their links.</li>
</ul>
</section>`
  });
}
