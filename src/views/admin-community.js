// Admin › Community: the list of thank-you cards, the card editor and the design preview (Gary and Julie only).
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime, longDate, isIsoDate } from '../lib/dates.js';
import { BACKGROUNDS, FONTS, FONT_NAMES, ROLES, COMMUNITY_CSS, CARD_JS, EDITOR_JS, CARD_FONTS_CSS, renderCard, sampleLayout, backgroundSources } from '../community/card.js';
import { cardDate } from '../community/model.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const assets = () => html`<link rel="stylesheet" href="${COMMUNITY_CSS}"><link rel="stylesheet" href="${CARD_FONTS_CSS}" crossorigin>`;

const FLASH = {
  created: 'New draft card made. Nothing is public until you publish it.',
  saved: 'Draft saved.',
  published: 'Published. The card now has its own Community page (the Community itself is still hidden from the website’s menu).',
  updated: 'Saved. The published card and its Facebook picture have been updated.',
  unpublished: 'Moved back to drafts. Its Community page is no longer shown.',
  deleted: 'Draft deleted.',
  'next-design': 'Next design chosen. Remember to save.'
};

// ---------- the list ----------
export function listPage({ posts, csrf, flash, origin }) {
  const drafts = posts.filter((p) => p.status === 'draft');
  const live = posts.filter((p) => p.status === 'published');
  const row = (p) => html`<li class="row-card">
<div class="row-main">
<img class="row-thumb row-thumb-wide" src="${p.kind === 'design' ? (p.art_key ? '/media/' + p.art_key : '/images/community/bg-01-thumb.webp') : backgroundSources(p.background).thumb}" alt="" width="96" height="54">
<div class="row-text">
<span class="row-title">${p.title || 'Thank you'}</span>
<span class="row-line">${isIsoDate(p.wed_date) ? longDate(p.wed_date) : 'No date'} · Design ${p.background}</span>
<span class="chips">${p.status === 'published' ? html`<span class="chip chip-live">Published ${friendlyDateTime(p.published_at)}</span>` : html`<span class="chip chip-hidden">Draft</span>`}</span>
</div>
</div>
<div class="row-actions"><a class="pill pill-gold" href="${p.kind === 'design' ? '/admin/designer/' : '/admin/community/'}${p.id}">${p.status === 'published' ? 'Open' : 'Continue editing'}</a>
${p.status === 'published' ? html`<a class="pill" href="/admin/community/${p.id}/view">Comments and notify</a>` : ''}
${p.status === 'published' ? html`<a class="pill" href="${origin}/community/${p.id}${p.slug ? '-' + p.slug : ''}" target="_blank" rel="noopener">View card page</a>` : ''}</div>
</li>`;
  const body = html`${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<p class="banner">The Community is <strong>not public yet</strong>: it is not in the website’s menu. Published cards have their own page and link for Facebook.</p>
<form method="post" action="/admin/community/new">${hidden(csrf)}<button class="btn-gold" type="submit">New thank-you card</button></form>
<h2 class="nwc-h2">Drafts</h2>
${drafts.length ? html`<ul class="rows">${drafts.map(row)}</ul>` : html`<p>No drafts.</p>`}
<h2 class="nwc-h2">Published</h2>
${live.length ? html`<ul class="rows">${live.map(row)}</ul>` : html`<p>No published cards yet.</p>`}
<p><a class="pill" href="/admin/community/preview">See all nine designs</a> <a class="pill" href="/admin/designer">Designer</a> <a class="pill" href="/admin/community/launch">Community launch</a></p>`;
  return adminPage({ title: 'Community cards', body, csrf, signedIn: true });
}

// ---------- the editor ----------
const SWATCHES = [['#F8B709', 'Gold'], ['#FFED81', 'Light gold'], ['#FFFFFF', 'White'], ['#9CC2FF', 'Soft blue'], ['#0669F9', 'Electric blue'], ['#000428', 'Navy']];
const ROLE_LABEL = { heading: 'Heading', name: 'Medium’s name', message: 'Message', date: 'Date line' };

function range(name, label, value, min, max, step = 1) {
  return html`<div class="nwc-range"><label for="f-${name}">${label}</label><input type="range" id="f-${name}" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}"><output for="f-${name}" data-out="${name}">${value}</output></div>`;
}

function textBlock(role, t, errors) {
  const value = t ? t.lines.join('\n') : '';
  const L = t || { x: 640, y: role === 'date' ? 420 : 300, size: role === 'date' ? 26 : 40, font: role === 'heading' || role === 'name' ? 'cinzel' : 'jost', weight: 500, color: '#FFFFFF', anchor: 'middle' };
  return html`<details class="nwc-sec" data-block="${role}"${role === 'heading' ? raw(' open') : ''}>
<summary>${ROLE_LABEL[role]}</summary>
${role === 'name' ? html`<p class="nwc-note">Uses the guest medium’s name above.</p>`
    : role === 'message' ? html`<div class="field${errors[role + '_text'] ? ' has-error' : ''}"><label for="f-${role}_text">Wording (up to 4 lines; leave empty to leave it off)</label><textarea id="f-${role}_text" name="${role}_text" rows="3">${value}</textarea>${errors[role + '_text'] ? html`<p class="error">${errors[role + '_text']}</p>` : ''}</div>`
    : html`<div class="field${errors[role + '_text'] ? ' has-error' : ''}"><label for="f-${role}_text">Wording (leave empty to leave it off)</label><input type="text" id="f-${role}_text" name="${role}_text" value="${value}" maxlength="120" autocomplete="off"${role === 'date' ? raw(' data-date-text') : ''}>${errors[role + '_text'] ? html`<p class="error">${errors[role + '_text']}</p>` : ''}</div>`}
<div class="nwc-grid2">
<div class="field"><label for="f-${role}_font">Lettering</label><select id="f-${role}_font" name="${role}_font">${Object.keys(FONTS).map((k) => html`<option value="${k}"${k === L.font ? raw(' selected') : ''}>${FONT_NAMES[k]}</option>`)}</select></div>
<div class="field"><label for="f-${role}_weight">Thickness</label><select id="f-${role}_weight" name="${role}_weight">${[[400, 'Regular'], [500, 'Medium'], [600, 'Semi-bold'], [700, 'Bold']].map(([w, n]) => html`<option value="${w}"${w === L.weight ? raw(' selected') : ''}>${n}</option>`)}</select></div>
</div>
${range(role + '_size', 'Text size', L.size, 10, 160)}
<div class="field"><span class="nwc-label">Colour</span><div class="nwc-swatches">
${SWATCHES.map(([c, n]) => html`<button type="button" class="nwc-swatch" data-swatch="${c}" data-for="${role}_color" aria-label="${n}" title="${n}"><span class="nwc-sw-${c.slice(1).toLowerCase()}"></span></button>`)}
<input type="color" name="${role}_color" value="${L.color.toLowerCase()}" aria-label="Choose any colour"></div></div>
<div class="field"><label for="f-${role}_anchor">Line up</label><select id="f-${role}_anchor" name="${role}_anchor">${[['start', 'From the left'], ['middle', 'Centred'], ['end', 'From the right']].map(([a, n]) => html`<option value="${a}"${a === L.anchor ? raw(' selected') : ''}>${n}</option>`)}</select></div>
${range(role + '_x', 'Across', L.x, 0, 1200)}
${range(role + '_y', 'Down', L.y, 0, 630)}
</details>`;
}

export function editorPage({ post, layout, csrf, errors = {}, flash, error, whosOn, suggested, link }) {
  const byRole = Object.fromEntries(layout.texts.filter((t) => t.role).map((t) => [t.role, t]));
  const published = post.status === 'published';
  const bgNow = layout.background;
  const body = html`${assets()}
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
${error ? html`<p class="banner banner-error" role="alert">${error}</p>` : ''}
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Please check the highlighted details.</p>` : ''}
<p class="nwc-status">${published ? html`<span class="chip chip-live">Published</span> Changes go live when you tap <strong>Save and update published card</strong>.` : html`<span class="chip chip-hidden">Draft</span> Not public. Nothing is published until you tap <strong>Publish</strong>.`}</p>
<form id="nwc-editor" class="nwc-editor" method="post" action="/admin/community/${post.id}/save" enctype="multipart/form-data" novalidate
  data-status="${post.status}" data-link="${link}" data-slug="${post.slug || 'card'}">
${hidden(csrf)}
<input type="file" name="share_image" accept="image/jpeg" hidden data-share-input>
<div class="nwc-ed-preview" data-preview>${renderCard(layout, { uid: 'ed', priority: true })}</div>
<p class="nwc-ed-warn" data-overflow hidden>Some wording goes past the edge of the card. Make it smaller or move it.</p>

<div class="nwc-move" data-js-only hidden>
<p class="nwc-note">Tap the wording or the badge on the card to choose it, then drag it with your finger, or use these buttons.</p>
<div class="nwc-chips" role="group" aria-label="Choose what to move">
${[...ROLES, 'badge'].map((r) => html`<button type="button" class="nwc-chip" data-select="${r}" aria-pressed="false">${r === 'badge' ? 'Badge' : ROLE_LABEL[r]}</button>`)}
</div>
<div class="nwc-pad" role="group" aria-label="Move and size">
<button type="button" class="nwc-padbtn nwc-up" data-nudge="0,-6" aria-label="Move up">▲</button>
<button type="button" class="nwc-padbtn nwc-left" data-nudge="-6,0" aria-label="Move left">◀</button>
<button type="button" class="nwc-padbtn nwc-centre" data-centre aria-label="Centre across the card">Centre</button>
<button type="button" class="nwc-padbtn nwc-right" data-nudge="6,0" aria-label="Move right">▶</button>
<button type="button" class="nwc-padbtn nwc-down" data-nudge="0,6" aria-label="Move down">▼</button>
<button type="button" class="nwc-padbtn nwc-smaller" data-resize="-0.08" aria-label="Smaller">A−</button>
<button type="button" class="nwc-padbtn nwc-bigger" data-resize="0.08" aria-label="Bigger">A+</button>
</div>
</div>

<details class="nwc-sec" open>
<summary>Guest medium and date</summary>
${whosOn.length ? html`<div class="field"><label for="f-whos-on">From Who’s On</label><select id="f-whos-on" data-whos-on>
<option value="">Choose a guest medium…</option>
${whosOn.map((m) => html`<option value="${m.date}|${m.name}" data-name="${m.name}" data-date="${m.date}" data-date-text="${cardDate(m.date)}">${longDate(m.date)}: ${m.name}</option>`)}
</select></div>` : html`<p class="nwc-note">No guest mediums in Who’s On for recent Wednesdays. Type the name and date below.</p>`}
<div class="field${errors.medium_name ? ' has-error' : ''}"><label for="f-medium_name">Guest medium’s name</label><input type="text" id="f-medium_name" name="medium_name" value="${post.medium_name}" maxlength="80" autocomplete="off" required>${errors.medium_name ? html`<p class="error">${errors.medium_name}</p>` : ''}</div>
<div class="field${errors.wed_date ? ' has-error' : ''}"><label for="f-wed_date">Wednesday date</label><input type="date" id="f-wed_date" name="wed_date" value="${post.wed_date}">${errors.wed_date ? html`<p class="error">${errors.wed_date}</p>` : ''}</div>
</details>

<details class="nwc-sec" open>
<summary>Background</summary>
<p class="nwc-note">Now: <strong data-bg-label>Design ${bgNow}</strong>${suggested ? html` · Next in the rotation: Design ${suggested}` : ''}</p>
<button type="submit" class="pill pill-gold" name="action" value="next" data-next-design>Next Design</button>
<div class="nwc-thumbs" role="radiogroup" aria-label="Background design">
${BACKGROUNDS.map((b) => html`<label class="nwc-thumb"><input type="radio" name="background" value="${b}"${b === bgNow ? raw(' checked') : ''}><img src="${backgroundSources(b).thumb}" alt="" width="240" height="126" loading="lazy"><span>Design ${b}</span></label>`)}
</div>
</details>

<h2 class="nwc-h2">Wording</h2>
${ROLES.map((r) => textBlock(r, byRole[r], errors))}

<details class="nwc-sec">
<summary>Official badge</summary>
<label class="field-check"><input type="checkbox" name="badge_show" value="1"${layout.badge.show ? raw(' checked') : ''}> Show the New Way’s badge</label>
${range('badge_size', 'Badge size', layout.badge.size, 40, 600)}
${range('badge_x', 'Across', layout.badge.x, 0, 1200)}
${range('badge_y', 'Down', layout.badge.y, 0, 630)}
</details>

<details class="nwc-sec" open>
<summary>Effects</summary>
<label class="field-check"><input type="checkbox" name="animate_logo" value="1"${layout.shimmer ? raw(' checked') : ''}> Animate Logo (gold shimmer on the website and app)</label>
<label class="field-check"><input type="checkbox" name="text_shadow" value="1"${layout.shadow ? raw(' checked') : ''}> Soft text shadow</label>
<p class="nwc-note">The Facebook image always shows the badge still, because Facebook pictures can’t move.</p>
</details>

<div class="nwc-actions">
<button type="submit" class="btn-gold" name="action" value="save" data-save>${published ? 'Save and update published card' : 'Save draft'}</button>
${published ? '' : html`<button type="submit" class="nwc-publish" name="action" value="publish" data-publish>Publish</button>`}
</div>
</form>

<section class="nwc-fb" aria-labelledby="fb-h">
<h2 id="fb-h" class="nwc-h2">Facebook</h2>
<p class="nwc-note">Download the finished card as a picture (1733 × 910, the same shape as the backgrounds) to add to a Facebook post. It uses what is on the card above, even before you save.</p>
<button type="button" class="pill pill-gold nwc-fbbtn" data-download hidden>Download Facebook Image</button>
<noscript><p class="nwc-note">Downloading the picture needs JavaScript switched on.</p></noscript>
<p class="nwc-note" data-download-status role="status"></p>
${published ? html`<div class="field"><label for="f-link">Community link for this card</label><input type="text" id="f-link" value="${link}" readonly data-link-input></div>
<button type="button" class="pill pill-gold nwc-fbbtn" data-copy-link>Copy Facebook Link</button>
<p class="nwc-note" data-copy-status role="status"></p>
<p><a class="pill" href="${link}" target="_blank" rel="noopener">View card page</a></p>` : html`<p class="nwc-note"><strong>Copy Facebook Link</strong> appears here once the card is published.</p>`}
</section>

<section class="nwc-danger">
${published ? html`<form method="post" action="/admin/community/${post.id}/unpublish">${hidden(csrf)}<button class="btn-danger" type="submit" data-confirm="Move this card back to drafts? Its Community page will stop showing, and its link will say “not found”.">Move back to drafts</button></form>`
    : html`<form method="post" action="/admin/community/${post.id}/delete">${hidden(csrf)}<button class="btn-danger" type="submit" data-confirm="Delete this draft card? This can’t be undone.">Delete draft</button></form>`}
</section>
<script src="${CARD_JS}" defer></script>
<script src="${EDITOR_JS}" defer></script>`;
  return adminPage({ title: published ? 'Published card' : 'Draft card', body, csrf, signedIn: true });
}

// ---------- the design preview (Stage 2) ----------
export function previewPage({ shimmer, shadow, next, csrf }) {
  const link = (s, sh) => `/admin/community/preview?shimmer=${s ? 1 : 0}&shadow=${sh ? 1 : 0}`;
  const body = html`${assets()}
<div class="nwc-admin-intro">
<p><strong>Not public yet.</strong> This preview is only visible in Admin. The Community is not in the website’s menu.</p>
<p>Each card below uses <strong>sample wording</strong> and the official New Way’s badge as a separate layer. The background rotation uses all nine designs before any repeats${next ? html`; the next card would start with <strong>Design ${next}</strong>` : ''}.</p>
<p>If your phone is set to reduce or remove animations, the badge is shown still, exactly as visitors with that setting will see it.</p>
</div>
<div class="nwc-toggles" role="group" aria-label="Preview options">
<a class="nwc-toggle" href="${link(!shimmer, shadow)}" aria-pressed="${shimmer ? 'true' : 'false'}">Animate Logo: ${shimmer ? 'On' : 'Off'}</a>
<a class="nwc-toggle" href="${link(shimmer, !shadow)}" aria-pressed="${shadow ? 'true' : 'false'}">Text shadow: ${shadow ? 'On' : 'Off'}</a>
</div>
<div class="nwc-preview-list">
${BACKGROUNDS.map((bg, i) => html`<section class="nwc-preview-item" aria-label="Design ${bg}">
<h2>Design ${bg}</h2>
${renderCard(sampleLayout(bg, { shimmer, shadow }), { priority: i === 0, uid: 'a' + bg, alt: `Sample thank-you card on design ${bg}` })}
</section>`)}
</div>
<p><a class="pill" href="/admin/community">Community cards</a></p>`;
  return adminPage({ title: 'Community preview', body, csrf, signedIn: true });
}
