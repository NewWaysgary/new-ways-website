// Admin screens for the Meditation Shop.
import { html, raw } from '../lib/html.js';
import { adminPage, sectionField } from './admin.js';
import { friendlyDateTime } from '../lib/dates.js';
import { SHOP_SETTINGS } from '../bookings/config.js';
import { money } from '../notify.js';
import { pounds } from './admin-bookings.js';
import { testBanner } from './admin-orders.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const mb = (bytes) => (Math.round((Number(bytes) || 0) / 104857.6) / 10).toString();

export const PRODUCT_FIELDS = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'by_line', label: 'By', type: 'text', help: 'For example: By Medium Gary Findlay' },
  { key: 'narration_note', label: 'Narration', type: 'text', help: 'Says who narrates the recording, for example: Narrated by an American voice artist' },
  { key: 'short_description', label: 'Short description (shown in the list)', type: 'textarea', rows: 3 },
  { key: 'description', label: 'Full description (shown on the meditation’s own page)', type: 'textarea', rows: 8,
    help: 'Leave a blank line between paragraphs.' },
  { key: 'price', label: 'Price (£)', type: 'money', help: 'A new price applies to new purchases only. Earlier buyers keep the price they paid.' },
  { key: 'cover_key', label: 'Cover picture', type: 'image', maxEdge: 1600, quality: 0.86 }
];

const FLASH = { added: 'Meditation added as a draft. Now add the preview and the full recording.', saved: 'Saved.', preview: 'Preview uploaded.', full: 'Full recording uploaded.',
  published: 'Published. It now shows on the website.', unpublished: 'Unpublished. It is hidden from the website.', deleted: 'Meditation deleted.', settings: 'Shop settings saved.',
  'cannot-publish': 'It can’t be published yet: it needs a title, a price and the full recording.', 'has-orders': 'This meditation has been bought, so it can’t be deleted. Unpublish it instead.' };

export function shopListPage({ products, settings, errors = {}, values, csrf, flash, mode }) {
  const v = values || settings;
  return adminPage({
    title: 'Meditations',
    csrf,
    signedIn: true,
    body: html`${testBanner(mode)}<p class="hint">Meditations to buy and download. Each has a public 1-minute preview and a private full recording that only buyers can download. <a class="link" href="/meditations" target="_blank" rel="noopener">See it on the site</a></p>
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<p><a class="btn-gold btn-link" href="/admin/meditations/new">Add a new meditation</a></p>
<p><a class="link" href="/admin/meditations/sales">See meditation sales</a></p>
${products.length ? html`<ul class="rows">${products.map((p) => html`<li class="row-card"><div class="row-main">
${p.cover_key ? html`<img class="row-thumb" src="/media/${encodeURIComponent(p.cover_key)}" alt="" loading="lazy">` : ''}
<div class="row-text"><span class="row-title">${p.title}</span>
<span class="row-line">${money(p.price_pence)}${p.sold ? ` · ${p.sold} sold` : ''}</span>
<span class="chips">${p.status === 'published' ? html`<span class="chip chip-live">PUBLISHED</span>` : html`<span class="chip chip-hidden">DRAFT, NOT ON THE WEBSITE</span>`}
${!p.full_key ? html`<span class="chip chip-attention">NO FULL RECORDING YET</span>` : ''}${!p.preview_key ? html`<span class="chip chip-past">NO PREVIEW</span>` : ''}</span>
</div></div>
<div class="row-actions"><a class="pill pill-gold" href="/admin/meditations/${p.id}">Edit</a></div></li>`)}</ul>` : html`<p class="panel">No meditations yet.</p>`}
<form method="post" action="/admin/meditations/settings" class="admin-form" data-unsaved-warning>
${hidden(csrf)}
<fieldset class="panel" id="shop-settings"><legend>Downloads and terms</legend>
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the highlighted details.</p>` : ''}
${SHOP_SETTINGS.map((f) => sectionField({ key: f.key, label: f.label, type: f.text ? 'textarea' : 'text', rows: 6, help: f.help }, v[f.key] ?? f.default, errors[f.key]))}
<p class="form-actions"><button class="btn-gold" type="submit">Save</button></p>
</fieldset>
</form>`
  });
}

function audioForm({ id, csrf, kind, label, maxMb, hint }) {
  return html`<form class="music-upload" data-upload="/admin/meditations/${id}/upload/${kind}" data-csrf="${csrf}" data-max-mb="${maxMb}" data-done="/admin/meditations/${id}?flash=${kind}" data-accept="mp3">
<label for="u-${kind}">${label}</label>
<input id="u-${kind}" type="file" accept="audio/mpeg,.mp3">
<p class="hint">${hint}</p>
<progress max="100" value="0" hidden></progress>
<p class="hint upload-status" aria-live="polite"></p>
<button class="btn-gold" type="submit">Upload</button>
</form>`;
}

export function productPage({ product, values, errors = {}, csrf, flash, uploadError, fullFile, previewFile, orderCount, mode }) {
  const id = product && product.id;
  const count = Object.keys(errors).length + (uploadError ? 1 : 0);
  return adminPage({
    title: id ? product.title : 'Add a new meditation',
    csrf,
    signedIn: true,
    body: html`${testBanner(mode)}<p><a class="link" href="/admin/meditations">Back to Meditations</a></p>
${FLASH[flash] ? html`<p class="banner ${flash === 'cannot-publish' || flash === 'has-orders' ? 'banner-error' : 'banner-ok'}" role="status">${FLASH[flash]}</p>` : ''}
${count ? html`<p class="banner banner-error" role="alert">Not saved yet. ${uploadError || 'Please check the highlighted details.'}</p>` : ''}
${id ? html`<section class="panel live-switch${product.status === 'published' ? ' is-live' : ''}" aria-labelledby="pub-state">
<h2 id="pub-state">${product.status === 'published' ? 'Published: on the website' : 'Draft: not on the website'}</h2>
${product.status === 'published' ? html`<p class="hint"><a class="link" href="/meditations/${product.slug}" target="_blank" rel="noopener">See it on the site</a></p>` : ''}
<form method="post" action="/admin/meditations/${id}/${product.status === 'published' ? 'unpublish' : 'publish'}">${hidden(csrf)}
<button class="${product.status === 'published' ? 'btn-danger' : 'btn-gold'}" type="submit">${product.status === 'published' ? 'Unpublish (hide from the website)' : 'Publish on the website'}</button></form>
${product.status !== 'published' && !product.full_key ? html`<p class="hint">Upload the full recording first.</p>` : ''}
</section>` : ''}
<form method="post" action="/admin/meditations/${id || 'new'}" class="admin-form" enctype="multipart/form-data" data-unsaved-warning>
${hidden(csrf)}
<div class="panel">${PRODUCT_FIELDS.map((f) => sectionField(f, values[f.key] ?? '', errors[f.key]))}</div>
<div class="save-bar"><button class="btn-gold" type="submit">${id ? 'Save changes' : 'Add this meditation'}</button></div>
</form>
${id ? html`<section class="panel" aria-labelledby="a-preview">
<h2 id="a-preview">Public preview (1 minute or less)</h2>
<p class="hint">Anyone can listen to this on the website. Previews must be 1 minute or less; longer files are refused.</p>
${product.preview_key ? html`<audio controls preload="none" src="/media/${product.preview_key}"></audio>${previewFile ? html`<p class="hint">${mb(previewFile.size_bytes)} MB</p>` : ''}` : html`<p>No preview yet.</p>`}
${audioForm({ id, csrf, kind: 'preview', label: product.preview_key ? 'Replace the preview (MP3)' : 'Upload the preview (MP3)', maxMb: 5, hint: 'MP3, 1 minute or less, up to 5 MB.' })}
</section>
<section class="panel" aria-labelledby="a-full">
<h2 id="a-full">Full recording (private)</h2>
<p class="hint">Only people who have paid can download this, using their own time-limited link. It is never shown on the website.</p>
${product.full_key ? html`<p>Uploaded${fullFile ? html` ${friendlyDateTime(fullFile.created_at)}, ${mb(fullFile.size_bytes)} MB` : ''}. <a class="link" href="/admin/meditations/${id}/recording">Download to check it</a></p>` : html`<p>No full recording yet.</p>`}
${audioForm({ id, csrf, kind: 'full', label: product.full_key ? 'Replace the full recording (MP3)' : 'Upload the full recording (MP3)', maxMb: 95,
      hint: 'MP3, up to 95 MB. Replacing it doesn’t affect download links already sent: they keep working until they expire.' })}
</section>
${orderCount ? html`<p class="hint">This meditation has been bought ${orderCount} ${orderCount === 1 ? 'time' : 'times'}, so it can’t be deleted. You can unpublish it instead.</p>`
      : html`<form method="post" action="/admin/meditations/${id}/delete" class="delete-form">${hidden(csrf)}
<button type="submit" class="btn-danger" data-confirm="Delete this meditation and its files? This can’t be undone.">Delete this meditation</button></form>`}` : html`<p class="hint">After adding it, you can upload the preview and the full recording, then publish it.</p>`}`
  });
}

export const productFormValues = (p) => p ? { title: p.title, by_line: p.by_line, narration_note: p.narration_note, short_description: p.short_description,
  description: p.description, price: pounds(p.price_pence), cover_key: p.cover_key } : { by_line: 'By Medium Gary Findlay', narration_note: 'Narrated by an American voice artist', price: '9.99' };

export { raw };
