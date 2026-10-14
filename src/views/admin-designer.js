// Admin › Designer: projects, templates, the picture library and the Designer itself (phone first).
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime, longDate } from '../lib/dates.js';
import { BACKGROUNDS } from '../community/card.js';

export const DESIGNER_JS = '/js/designer.js?v=2';
export const KONVA_JS = '/js/vendor/konva-9.3.22.min.js';
export const DESIGNER_CSS = '/css/designer.css?v=1';
// Free fonts (Google Fonts, Open Font Licence): loaded only in the Designer
export const FONTS = ['Cinzel', 'Cinzel Decorative', 'Jost', 'Cormorant Garamond', 'Great Vibes', 'Playfair Display', 'Dancing Script', 'Lora', 'Montserrat', 'Raleway',
  'Pacifico', 'Satisfy', 'Parisienne', 'Allura', 'Alex Brush', 'Tangerine', 'Marcellus', 'Josefin Sans', 'Poppins', 'Merriweather', 'Quicksand', 'Sacramento', 'Lobster', 'Bebas Neue', 'Kaushan Script', 'Abril Fatface'];
// One small style sheet per font, so a problem with one font can never stop the others loading
const TWO_WEIGHTS = ['Cinzel', 'Jost', 'Cormorant Garamond', 'Playfair Display', 'Lora', 'Montserrat', 'Raleway', 'Josefin Sans', 'Poppins', 'Merriweather', 'Quicksand'];
export const fontCss = (f) => 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + (TWO_WEIGHTS.includes(f) ? ':wght@400;700' : '') + '&display=swap';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const css = () => html`<link rel="stylesheet" href="${DESIGNER_CSS}"><link rel="stylesheet" href="/css/moderation.css?v=4">`;
const FLASH = {
  deleted: 'Project deleted.', 'template-deleted': 'Template deleted.', added: 'Picture added to the library.', favourite: 'Favourite changed.', delete: 'Picture deleted.', edit: 'Picture details saved.',
  'published-no-delete': 'A published card can’t be deleted. Move it back to drafts first (Community cards).'
};
const mb = (b) => (b / 1048576).toFixed(b > 1048576 * 100 ? 0 : 1) + ' MB';

export function homePage({ projects, templates, csrf, flash, used, limit, origin }) {
  const body = html`${css()}${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<p class="nwc-note">Create thank-you cards and artwork on a 1733 × 910 canvas: backgrounds and photos, text, stickers, shapes, frames and effects, with the official New Way’s badge. Nothing is published until you tap Publish.</p>
<div class="dz-new">
<form method="post" action="/admin/designer/new">${hidden(csrf)}<button class="btn-gold" type="submit">New thank-you card</button></form>
<form method="post" action="/admin/designer/new">${hidden(csrf)}<input type="hidden" name="start" value="blank"><button class="pill" type="submit">Blank canvas</button></form>
<a class="pill" href="/admin/designer/library">Picture library</a>
</div>
${templates.length ? html`<h2 class="nwc-h2">Start from a template</h2><ul class="rows">${templates.map((t) => html`<li class="row-card"><div class="row-text"><span class="row-title">${t.name}</span><span class="row-line">Saved ${friendlyDateTime(t.updated_at)}</span></div>
<div class="row-actions"><form method="post" action="/admin/designer/new">${hidden(csrf)}<input type="hidden" name="template" value="${t.id}"><button class="pill pill-gold" type="submit">Use this template</button></form>
<form method="post" action="/admin/designer/templates/${t.id}/delete">${hidden(csrf)}<button class="pill pill-danger" type="submit" data-confirm="Delete the template “${t.name}”?">Delete</button></form></div></li>`)}</ul>` : ''}
<h2 class="nwc-h2">Projects</h2>
${projects.length ? html`<ul class="rows">${projects.map((p) => html`<li class="row-card"><div class="row-main">
${p.art_key ? html`<img class="row-thumb row-thumb-wide" src="/media/${p.art_key}" alt="" width="96" height="50">` : ''}
<div class="row-text"><span class="row-title">${p.title || 'Untitled'}</span><span class="row-line">${p.wed_date ? longDate(p.wed_date) + ' · ' : ''}saved ${friendlyDateTime(p.updated_at)}</span>
<span class="chips">${p.status === 'published' ? html`<span class="chip chip-live">Published</span>` : html`<span class="chip chip-hidden">Draft</span>`}</span></div></div>
<div class="row-actions"><a class="pill pill-gold" href="/admin/designer/${p.id}">Open</a>${p.status === 'published' ? html`<a class="pill" href="/admin/community/${p.id}/view">View Live Comments</a>` : ''}</div></li>`)}</ul>` : html`<p>No projects yet.</p>`}
<p class="nwc-note">Picture storage used: ${mb(used)} of ${mb(limit)} (Cloudflare’s free allowance is 10 GB; uploads stop at 8 GB so there is never a charge).</p>`;
  return adminPage({ title: 'Designer', body, csrf, signedIn: true });
}

export function libraryPage({ items, csrf, flash, used, limit }) {
  const kinds = [['background', 'Backgrounds'], ['photo', 'Photos'], ['sticker', 'Stickers'], ['frame', 'Frames']];
  const body = html`${css()}${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : flash === 'upload-error' ? html`<p class="banner banner-error" role="alert">That picture couldn’t be added. Please choose a JPEG, PNG or WebP picture under 8 MB (if the storage is full, delete some pictures first).</p>` : ''}
<form class="nwc-sec dz-upload" method="post" action="/admin/designer/library/upload" enctype="multipart/form-data" data-dz-upload>${hidden(csrf)}
<h2 class="nwc-h2">Add a picture</h2>
<p class="nwc-note">Your phone makes the picture lighter before it is sent (up to 2400 pixels; stickers and frames keep see-through parts). Only JPEG, PNG or WebP pictures you have the right to use, please.</p>
<div class="field"><label for="dz-file">Picture</label><input type="file" id="dz-file" name="image" accept="image/jpeg,image/png,image/webp" required></div>
<div class="nwc-addword nwc-grid2"><div class="field"><label for="dz-kind">Type</label><select id="dz-kind" name="kind">${kinds.map(([k, l]) => html`<option value="${k}">${l.slice(0, -1)}</option>`)}</select></div>
<div class="field"><label for="dz-folder">Folder (optional)</label><input type="text" id="dz-folder" name="folder" maxlength="40" placeholder="e.g. Christmas"></div></div>
<div class="field"><label for="dz-name">Name (optional)</label><input type="text" id="dz-name" name="name" maxlength="60"></div>
<p class="nwc-note" data-dz-status role="status"></p>
<button class="btn-gold" type="submit">Add to library</button>
</form>
<p class="nwc-note">The original nine designs are always available in the Designer. Storage used: ${mb(used)} of ${mb(limit)}.</p>
${kinds.map(([k, label]) => {
    const list = items.filter((i) => i.kind === k);
    return html`<details class="nwc-sec"${list.length ? raw(' open') : ''}><summary>${label} (${list.length})</summary>
${list.length ? html`<ul class="dz-lib">${list.map((i) => html`<li class="dz-lib-item"><img src="/media/${i.thumb_key || i.image_key}" alt="" loading="lazy">
<span class="dz-lib-name">${i.favourite ? '★ ' : ''}${i.name}${i.folder ? html` <span class="chip">${i.folder}</span>` : ''}</span>
<details><summary class="pill">Change</summary><form method="post" action="/admin/designer/library/${i.id}/edit">${hidden(csrf)}
<input type="text" name="name" value="${i.name}" maxlength="60" aria-label="Name"><input type="text" name="folder" value="${i.folder}" maxlength="40" aria-label="Folder" placeholder="Folder">
<select name="kind" aria-label="Type">${kinds.map(([kk, ll]) => html`<option value="${kk}"${kk === i.kind ? raw(' selected') : ''}>${ll.slice(0, -1)}</option>`)}</select><button class="pill" type="submit">Save</button></form></details>
<div class="row-actions"><form method="post" action="/admin/designer/library/${i.id}/favourite">${hidden(csrf)}<button class="pill" type="submit">${i.favourite ? 'Unfavourite' : 'Favourite'}</button></form>
<form method="post" action="/admin/designer/library/${i.id}/delete">${hidden(csrf)}<button class="pill pill-danger" type="submit" data-confirm="Delete this picture from the library? Published cards are not affected.">Delete</button></form></div></li>`)}</ul>` : html`<p>None yet.</p>`}</details>`;
  })}
<p><a class="pill" href="/admin/designer">Designer</a></p>
<script src="${DESIGNER_JS}" defer></script>`;
  return adminPage({ title: 'Picture library', body, csrf, signedIn: true });
}

export function editorPage({ post, design, csrf, link, whosOn, flash }) {
  const boot = JSON.stringify({ id: post.id, status: post.status, link, slug: post.slug || 'card', design, fonts: FONTS, backgrounds: BACKGROUNDS, csrf })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const body = html`${css()}${FONTS.map((f) => html`<link rel="stylesheet" href="${fontCss(f)}" crossorigin>`)}
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<div class="dz" data-dz>
<div class="dz-top">
<button type="button" class="dz-tb" data-dz-undo aria-label="Undo" disabled>↶</button>
<button type="button" class="dz-tb" data-dz-redo aria-label="Redo" disabled>↷</button>
<span class="dz-state" data-dz-state>${post.status === 'published' ? 'Published' : 'Draft'}</span>
<button type="button" class="dz-tb dz-tb-wide" data-dz-save>${post.status === 'published' ? 'Update' : 'Save'}</button>
</div>
<div class="dz-stage-wrap"><div class="dz-stage" data-dz-stage aria-label="Your artwork. Tap something to choose it, drag to move, use the handles to resize or turn it."></div></div>
<p class="dz-hint" data-dz-hint>Loading the Designer…</p>
<nav class="dz-tools" aria-label="Designer tools">
${[['background', 'Background', '🖼'], ['text', 'Text', 'T'], ['photo', 'Photos', '📷'], ['sticker', 'Stickers', '✨'], ['shape', 'Shapes', '◆'], ['frame', 'Frames', '▢'], ['effect', 'Effects', '☀'], ['badge', 'Badge', '◎'], ['layers', 'Layers', '☰']]
    .map(([k, l, i]) => html`<button type="button" class="dz-tool" data-dz-tool="${k}" aria-pressed="false"><span class="dz-tool-i" aria-hidden="true">${i}</span><span>${l}</span></button>`)}
</nav>
<section class="dz-panel" data-dz-panel aria-live="polite"></section>
<details class="nwc-sec dz-details">
<summary>Card details</summary>
${whosOn.length ? html`<div class="field"><label for="dz-whos">From Who’s On</label><select id="dz-whos" data-dz-whos><option value="">Choose a guest medium…</option>${whosOn.map((m) => html`<option value="${m.date}|${m.name}">${longDate(m.date)}: ${m.name}</option>`)}</select></div>` : ''}
<div class="field"><label for="dz-medium">Guest medium’s name</label><input type="text" id="dz-medium" data-dz-medium value="${post.medium_name}" maxlength="80"></div>
<div class="field"><label for="dz-date">Wednesday date</label><input type="date" id="dz-date" data-dz-date value="${post.wed_date}"></div>
<div class="field"><label for="dz-title">Page title</label><input type="text" id="dz-title" data-dz-title value="${post.title}" maxlength="120"></div>
</details>
<section class="nwc-sec dz-finish">
<h2 class="nwc-h2">Finish</h2>
<button type="button" class="btn-gold" data-dz-download>Download Facebook Image</button>
<p class="nwc-note">A 1733 × 910 picture of everything on the canvas, with the badge still, ready to add to a Facebook post.</p>
<button type="button" class="dz-publish" data-dz-publish>${post.status === 'published' ? 'Update published card' : 'Publish as Community card'}</button>
<div data-dz-linkbox${post.status === 'published' ? '' : raw(' hidden')}><div class="field"><label for="dz-link">Community link</label><input type="text" id="dz-link" value="${link}" readonly data-dz-link></div>
<button type="button" class="pill pill-gold" data-dz-copy>Copy Facebook Link</button> <a class="pill" href="/admin/community/${post.id}/view">View Live Comments</a> <a class="pill" href="${link}" target="_blank" rel="noopener" data-dz-public>View Public Card</a>
<p class="nwc-note">View Public Card opens the public website: comments posted there are ordinary public comments, not verified Admin comments. To comment as Admin Gary ✓ or Admin Julie ✓, use View Live Comments.</p></div>
<button type="button" class="pill" data-dz-template>Save as template</button>
<p class="nwc-note" data-dz-status role="status"></p>
</section>
${post.status === 'draft' ? html`<form method="post" action="/admin/designer/${post.id}/delete" class="nwc-danger">${hidden(csrf)}<button class="btn-danger" type="submit" data-confirm="Delete this draft project? This can’t be undone.">Delete draft</button></form>`
    : html`<form method="post" action="/admin/community/${post.id}/unpublish" class="nwc-danger">${hidden(csrf)}<button class="btn-danger" type="submit" data-confirm="Move this card back to drafts? Its Community page will stop showing.">Move back to drafts</button></form>`}
</div>
<script type="application/json" id="dz-boot">${raw(boot)}</script>
<script src="${KONVA_JS}" defer></script>
<script src="${DESIGNER_JS}" defer></script>`;
  return adminPage({ title: 'Designer', body, csrf, signedIn: true });
}
