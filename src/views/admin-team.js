// Admin > Admin team (owner only)
import { html } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime } from '../lib/dates.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const FLASH = { added: 'Added. Ask them to sign in to Admin with that email address.', off: 'Switched off. They are signed out everywhere and can’t sign in.',
  on: 'Switched on again.', removed: 'Removed. They are signed out everywhere.' };

export function teamPage({ members, csrf, flash, errors = {}, values = {} }) {
  const act = (m, a, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/team/${m.id}/${a}">${hidden(csrf)}<button class="${cls}" type="submit"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  return adminPage({
    title: 'Admin team', csrf, signedIn: true,
    body: html`<p class="hint">People here have <strong>full Admin</strong>, the same as you: bookings, events, the Wednesday door till, live chat, settings and everything else. Only you (the owner) can see this page and add or remove people.</p>
<p class="hint">Each person signs in with their own email address and their own password, so you never share yours. For someone who should only check guests in at events, use <a class="link" href="/admin/helpers">Check-in helpers</a> instead.</p>
${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
${members.length ? html`<ul class="rows">${members.map((m) => html`<li class="row-card"><div class="row-text"><span class="row-title">${m.name || m.email}</span><span class="row-line">${m.email}</span>
<span class="row-line">${m.last_signin_at ? 'Last signed in ' + friendlyDateTime(m.last_signin_at) : 'Not signed in yet'}</span>
<span class="chips">${m.active ? html`<span class="chip chip-live">Full Admin</span>` : html`<span class="chip chip-hidden">Switched off</span>`}</span></div>
<div class="row-actions">${m.active ? act(m, 'off', 'Switch off', 'pill', 'Switch off full Admin for this person? They are signed out straight away.') : act(m, 'on', 'Switch on', 'pill pill-gold')}
${act(m, 'remove', 'Remove', 'pill pill-danger', 'Remove full Admin for this person?')}</div></li>`)}</ul>` : html`<p class="panel">Nobody else has full Admin yet.</p>`}
<form method="post" action="/admin/team" class="panel admin-form">${hidden(csrf)}
<h2>Give someone full Admin</h2>
<div class="field${errors.name ? ' has-error' : ''}"><label for="t-name">Name</label><input id="t-name" name="name" type="text" maxlength="80" value="${values.name || ''}">${errors.name ? html`<p class="error">${errors.name}</p>` : ''}</div>
<div class="field${errors.email ? ' has-error' : ''}"><label for="t-email">Their email address</label><input id="t-email" name="email" type="email" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="254" value="${values.email || ''}">${errors.email ? html`<p class="error">${errors.email}</p>` : ''}</div>
<p class="hint">They sign in on the normal Admin sign-in page with this email address. The first time, they create their own password there (or you invite them from the WorkOS dashboard). Their email must be verified.</p>
<p class="form-actions"><button class="btn-gold" type="submit">Give full Admin</button></p>
</form>`
  });
}

export function ownerOnlyPage({ csrf }) {
  return adminPage({ title: 'Owner only', csrf, signedIn: true, body: html`<div class="panel"><p>Only the owner (Gary) can add or remove people with full Admin.</p><p><a class="link" href="/admin">Back to Admin</a></p></div>` });
}
