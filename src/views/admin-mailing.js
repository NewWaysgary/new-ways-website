// Admin screens: the mailing list, the Join page wording and its printable QR code, and System status.
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime } from '../lib/dates.js';
import { JOIN_FIELDS } from '../mailing.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const TABS = [['subscribed', 'Subscribed'], ['unsubscribed', 'Unsubscribed'], ['all', 'All']];
const FLASH = { added: 'Added to the mailing list.', already: 'That address is already on the list.', unsubscribed: 'Unsubscribed. Their bookings are not affected.',
  resubscribed: 'Subscribed again.', deleted: 'Deleted from the mailing list. Their bookings are not affected.', saved: 'Saved. The Join page shows the new wording now.' };

export function mailingPage({ rows, counts, current, q, csrf, flash, errors = {}, values = {} }) {
  const act = (r, a, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/mailing-list/${r.id}/${a}">${hidden(csrf)}<button type="submit" class="${cls}"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  return adminPage({
    title: 'Mailing list', csrf, signedIn: true,
    body: html`<p class="hint">Only people who chose to join: the unticked box when booking event tickets, the Join page (the table QR code), or someone you add because they asked. It is separate from bookings: unsubscribing or deleting someone here never changes their bookings, and booking emails are always sent.</p>
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<div class="stats stats-private"><p><strong>${counts.subscribed}</strong> subscribed</p><p><strong>${counts.unsubscribed}</strong> unsubscribed</p></div>
<p class="row-actions"><a class="pill pill-gold" href="/admin/mailing-list/export.csv?status=subscribed">Download subscribers (CSV)</a> <a class="pill" href="/admin/mailing-list/export.csv?status=all">Download everyone (CSV)</a> <a class="pill pill-gold" href="/admin/mailing-list/join-page">Join page and table QR code</a></p>
<form method="get" action="/admin/mailing-list" class="search-form" role="search"><label class="sr-only" for="ml-q">Search</label>
<input id="ml-q" name="q" type="search" value="${q}" placeholder="Name or email" autocomplete="off"><input type="hidden" name="show" value="${current}"><button class="pill pill-gold" type="submit">Search</button></form>
<nav class="tabs" aria-label="Show">${TABS.map(([k, l]) => html`<a class="tab-link${k === current ? ' is-current' : ''}" href="/admin/mailing-list?show=${k}${q ? '&q=' + encodeURIComponent(q) : ''}"${k === current ? raw(' aria-current="page"') : ''}>${l} <span class="count">${k === 'all' ? counts.subscribed + counts.unsubscribed : counts[k]}</span></a>`)}</nav>
${rows.length ? html`<ul class="rows">${rows.map((r) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${r.name || r.email}</span><span class="row-line">${r.email}</span>
<span class="row-line">Joined ${friendlyDateTime(r.subscribed_at)}${r.source ? ' · ' + r.source : ''}${r.unsubscribed_at ? ' · unsubscribed ' + friendlyDateTime(r.unsubscribed_at) : ''}</span>
<span class="chips">${r.status === 'subscribed' ? html`<span class="chip chip-live">Subscribed</span>` : html`<span class="chip chip-hidden">Unsubscribed</span>`}</span></div>
<div class="row-actions">${r.status === 'subscribed' ? act(r, 'unsubscribe', 'Unsubscribe', 'pill', 'Unsubscribe this person?') : act(r, 'resubscribe', 'Subscribe again (they asked)', 'pill', 'Only do this if they have asked to join again. Subscribe them?')}
${act(r, 'delete', 'Delete', 'pill pill-danger', 'Delete this person from the mailing list completely? (Their bookings are kept.)')}</div></li>`)}</ul>`
      : html`<p class="panel">${q ? 'Nobody matches that search.' : 'Nobody here yet.'}</p>`}
<form method="post" action="/admin/mailing-list" class="panel admin-form">${hidden(csrf)}
<h2>Add someone who asked to join</h2>
<div class="field"><label for="ml-name">Name</label><input id="ml-name" name="name" type="text" maxlength="80" value="${values.name || ''}"></div>
<div class="field${errors.email ? ' has-error' : ''}"><label for="ml-email">Email address</label><input id="ml-email" name="email" type="email" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="254" value="${values.email || ''}">${errors.email ? html`<p class="error">${errors.email}</p>` : ''}</div>
<div class="field field-check${errors.consent ? ' has-error' : ''}"><label><input type="checkbox" name="consent" value="1"> They have asked to receive New Way’s emails</label>${errors.consent ? html`<p class="error">${errors.consent}</p>` : ''}</div>
<p class="form-actions"><button class="btn-gold" type="submit">Add to the mailing list</button></p></form>`
  });
}

export function joinAdminPage({ wording, joinUrl, testUrl, realConnected, csrf, flash, errors = {} }) {
  return adminPage({
    title: 'Join page and table QR code', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/mailing-list">Back to the mailing list</a></p>
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<section class="panel" aria-labelledby="qr-h"><h2 id="qr-h">Table QR code</h2>
<p>The QR code always opens the same page: <span class="copy-link">${joinUrl}</span> Change the wording below at any time; the printed QR code keeps working.</p>
${realConnected ? '' : html`<p class="banner banner-test">Your real domain isn’t connected to this website yet, so this QR code won’t work until it is. Please wait until then before printing it. To try the page now, use the test address: <a class="link" href="${testUrl}" target="_blank" rel="noopener">${testUrl}</a></p>`}
<div class="qr-print"><img src="/admin/mailing-list/join-qr.png" alt="QR code for ${joinUrl}" width="320" height="320"></div>
<p class="spaced"><a class="pill pill-gold" href="/admin/mailing-list/join-qr.png?download=1">Download the QR code to print (PNG)</a> <a class="pill" href="${realConnected ? joinUrl : testUrl}" target="_blank" rel="noopener">See the Join page</a></p>
</section>
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the highlighted details.</p>` : ''}
<form method="post" action="/admin/mailing-list/join-page" class="admin-form" data-unsaved-warning>${hidden(csrf)}
<div class="panel"><h2>Join page wording</h2>
${JOIN_FIELDS.map((f) => html`<div class="field${errors[f.key] ? ' has-error' : ''}"><label for="j-${f.key}">${f.label}</label>
${f.text ? html`<textarea id="j-${f.key}" name="${f.key}" rows="${f.key === 'join_message' ? 6 : 3}" maxlength="${f.max}">${wording[f.key]}</textarea>` : html`<input id="j-${f.key}" name="${f.key}" type="text" maxlength="${f.max}" value="${wording[f.key]}">`}
${f.help ? html`<p class="hint">${f.help}</p>` : ''}${errors[f.key] ? html`<p class="error">${errors[f.key]}</p>` : ''}</div>`)}
</div>
<p class="form-actions"><button class="btn-gold" type="submit">Save wording</button></p></form>`
  });
}

// ---------- System status ----------
const LIGHT = { green: ['status-green', 'GREEN'], warning: ['status-warning', 'WARNING'], red: ['status-red', 'RED'] };
export function statusPage({ checks, csrf, flash, testResult, environment }) {
  const worst = checks.some((c) => c.state === 'red') ? 'red' : checks.some((c) => c.state === 'warning') ? 'warning' : 'green';
  return adminPage({
    title: 'System status', csrf, signedIn: true,
    body: html`<p class="hint">A quick check that everything the website needs is connected. Secret keys are never shown here: only whether they are set and working.</p>
${testResult ? html`<p class="banner ${testResult.ok ? 'banner-ok' : 'banner-error'}" role="status">${testResult.text}</p>` : ''}
<section class="panel"><h2><span class="status-light ${LIGHT[worst][0]}">${LIGHT[worst][1]}</span></h2>
<p>${worst === 'green' ? 'Everything checked is working.' : worst === 'warning' ? 'Working, with some things to note (for example test mode).' : 'Something needs attention. See the red items below.'}</p>
<dl class="detail-list">${environment.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></section>
<ul class="check-list">${checks.map((c) => html`<li><span class="status-light ${LIGHT[c.state][0]}">${LIGHT[c.state][1]}</span><span class="check-name">${c.name}</span><span class="check-detail">${c.detail}</span></li>`)}</ul>
<section class="panel spaced" aria-labelledby="t-h"><h2 id="t-h">Email test</h2>
<p class="hint">Sends a short test email to your notification address, without needing a purchase. Up to 5 an hour.</p>
<form method="post" action="/admin/status/test-email">${hidden(csrf)}<button class="btn-gold" type="submit">SEND TEST EMAIL TO ME</button></form></section>`
  });
}
