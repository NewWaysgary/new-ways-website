// Admin › Mailing list › SEND EMAIL TO SUBSCRIBERS screens. Big buttons; works on a phone, iPad or computer.
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime } from '../lib/dates.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const STATUS = { draft: ['chip-hidden', 'Draft: not sent'], sending: ['chip-attention', 'Sending'], sent: ['chip-live', 'Sent'], stopped: ['chip-past', 'Stopped'] };
const FLASH = {
  saved: ['ok', 'Saved. Check the preview below, then send yourself a test.'], deleted: ['ok', 'Draft deleted.'],
  tested: ['ok', 'Test email sent. Please check it on your phone, then send it to the subscribers.'],
  'test-first': ['bad', 'Please send yourself a test email first (and check it), then send it to the subscribers.'],
  tick: ['bad', 'Please tick to confirm you have checked the test email.'],
  'test-failed': ['bad', 'The test email could not be sent. Please try again in a few minutes. If it keeps failing, see Admin › System status.'],
  'not-configured': ['bad', 'Email isn’t set up on this copy of the website, so nothing can be sent.'],
  'bad-test-address': ['bad', 'Please enter a full email address for the test.'],
  'test-limit': ['bad', 'That’s 10 test emails in the last hour. Please wait a little before sending another.'],
  sending: ['ok', 'Sending has started. The figures below show how it is going.'], continued: ['ok', 'Checked and sent the next part.'],
  stopped: ['ok', 'Stopped. Nobody else will be sent this email.'], checked: ['ok', 'Delivery news updated from Resend.'],
  locked: ['bad', 'This email has already been sent (or is being sent), so it can’t be changed or sent again.']
};
const flashBanner = (flash) => (FLASH[flash] ? html`<p class="banner ${FLASH[flash][0] === 'ok' ? 'banner-ok' : 'banner-error'}" role="status">${FLASH[flash][1]}</p>` : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function listPage({ campaigns, subscribers, configured, csrf, flash }) {
  return adminPage({
    title: 'Emails to subscribers', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/mailing-list">Back to the mailing list</a></p>
${flashBanner(flash)}
${configured ? '' : html`<p class="banner banner-test">Email isn’t set up on this copy of the website, so emails can be written and previewed but not sent.</p>`}
<section class="panel"><p>Emails about events, special evenings and news go <strong>only</strong> to the <strong>${plural(subscribers, 'person', 'people')}</strong> on the mailing list who chose to join. Each email has its own unsubscribe link. Booking emails (confirmations, reminders and QR codes) are separate and always sent.</p>
<p><a class="btn-gold btn-link mail-new" href="/admin/mailing-list/emails/new">WRITE A NEW EMAIL</a></p></section>
<h2>Emails</h2>
${campaigns.length ? html`<ul class="rows">${campaigns.map((c) => html`<li class="row-card"><div class="row-text">
<span class="row-title"><a class="link" href="/admin/mailing-list/emails/${c.id}">${c.subject}</a></span>
<span class="row-line">${c.status === 'draft' ? `Written ${friendlyDateTime(c.created_at)} by ${c.created_by}` : `Sent ${friendlyDateTime(c.started_at)} by ${c.sent_by}: ${c.sent} of ${c.recipients} sent`}${c.problems ? ` · ${plural(c.problems, 'problem', 'problems')}` : ''}</span>
<span class="chips"><span class="chip ${STATUS[c.status][0]}">${STATUS[c.status][1]}</span></span></div>
<div class="row-actions"><a class="pill pill-gold" href="/admin/mailing-list/emails/${c.id}">${c.status === 'draft' ? 'Open' : 'See details'}</a></div></li>`)}</ul>`
      : html`<p class="panel">No emails yet.</p>`}`
  });
}

export function editPage({ choices, values = {}, id = null, errors = {}, csrf }) {
  const v = (k) => String(values[k] ?? '');
  const opt = (x) => html`<option value="${x.ref}"${x.ref === v('link_ref') ? raw(' selected') : ''}>${x.label}</option>`;
  return adminPage({
    title: id ? 'Change the email' : 'Write an email', csrf, signedIn: true,
    body: html`<p><a class="link" href="${id ? `/admin/mailing-list/emails/${id}` : '/admin/mailing-list/emails'}">Back</a></p>
${Object.keys(errors).length ? html`<p class="banner banner-error" role="alert">Not saved yet. Please check the highlighted details.</p>` : ''}
<form method="post" action="${id ? `/admin/mailing-list/emails/${id}/edit` : '/admin/mailing-list/emails/new'}" class="admin-form" data-unsaved-warning>${hidden(csrf)}
<div class="panel">
<div class="field${errors.subject ? ' has-error' : ''}"><label for="m-subject">Subject</label><input id="m-subject" name="subject" type="text" maxlength="150" value="${v('subject')}" placeholder="e.g. Psychic Supper on Friday 4 December" required>${errors.subject ? html`<p class="error">${errors.subject}</p>` : ''}</div>
<div class="field${errors.body ? ' has-error' : ''}"><label for="m-body">Message</label><textarea id="m-body" name="body" rows="12" maxlength="10000" required>${v('body')}</textarea>
<p class="hint">Leave a blank line between paragraphs. “Dear (first name),” is added at the top by itself, and the unsubscribe link at the bottom.</p>${errors.body ? html`<p class="error">${errors.body}</p>` : ''}</div>
<div class="field${errors.link_ref ? ' has-error' : ''}"><label for="m-link">Add a link button (optional)</label>
<select id="m-link" name="link_ref"><option value="">No link</option>
${choices.events.length ? html`<optgroup label="Upcoming events">${choices.events.map(opt)}</optgroup>` : ''}
${choices.mediums.length ? html`<optgroup label="Who’s On">${choices.mediums.map(opt)}</optgroup>` : ''}</select>
<p class="hint">Adds a gold button that opens that page on the website.</p>${errors.link_ref ? html`<p class="error">${errors.link_ref}</p>` : ''}</div>
<div class="field${errors.link_label ? ' has-error' : ''}"><label for="m-label">Button wording (optional)</label><input id="m-label" name="link_label" type="text" maxlength="60" value="${v('link_label')}" placeholder="e.g. Book your place">
<p class="hint">Leave empty for “Find out more and book” (events) or “See … on Who’s On”.</p>${errors.link_label ? html`<p class="error">${errors.link_label}</p>` : ''}</div>
</div>
<p class="form-actions"><button class="btn-gold" type="submit">Save and preview</button></p></form>`
  });
}

export function campaignPage({ c, preview, counts, delivery, people, subscribers, limit, today, adminEmail, configured, csrf, flash }) {
  const draft = c.status === 'draft';
  const n = (k) => counts[k] || 0;
  const DELIVERY = { delivered: 'Delivered', bounced: 'Bounced (address not working)', complained: 'Marked as spam', opened: 'Opened', clicked: 'Clicked', delivery_delayed: 'Delayed', sent: 'Sent (no news yet)' };
  return adminPage({
    title: draft ? 'Preview and send' : 'Sent email', csrf, signedIn: true,
    body: html`<p><a class="link" href="/admin/mailing-list/emails">Back to the emails</a></p>
${flashBanner(flash)}
<p class="chips"><span class="chip ${STATUS[c.status][0]}">${STATUS[c.status][1]}</span></p>
<section class="panel" aria-labelledby="pv-h"><h2 id="pv-h">Preview</h2>
<p class="hint">Subject: <strong>${c.subject}</strong>${c.link_url ? html` · Button opens <a class="link" href="${c.link_url}" target="_blank" rel="noopener">${c.link_url}</a>` : ''}</p>
<div class="mail-preview">${raw(preview.inner)}</div>
<p class="hint">Shown as it will look for a subscriber called Mary.</p>
${draft ? html`<p class="row-actions"><a class="pill pill-gold" href="/admin/mailing-list/emails/${c.id}/edit">Change it</a>
<form method="post" action="/admin/mailing-list/emails/${c.id}/delete">${hidden(csrf)}<button class="pill pill-danger" type="submit" data-confirm="Delete this draft?">Delete draft</button></form></p>` : ''}</section>

${draft ? html`<section class="panel" aria-labelledby="t-h"><h2 id="t-h">1. Send yourself a test</h2>
<form method="post" action="/admin/mailing-list/emails/${c.id}/test" class="admin-form">${hidden(csrf)}
<div class="field"><label for="t-to">Send the test to</label><input id="t-to" name="to" type="email" autocapitalize="none" autocorrect="off" spellcheck="false" value="${adminEmail || ''}" required></div>
<button class="btn-gold" type="submit">SEND TEST EMAIL</button></form>
${c.test_sent_at ? html`<p class="hint">Last test sent to ${c.test_sent_to}, ${friendlyDateTime(c.test_sent_at)}.</p>` : html`<p class="hint">A test is needed before it can be sent, and again after any change.</p>`}</section>

<section class="panel" aria-labelledby="s-h"><h2 id="s-h">2. Send to the subscribers</h2>
<p class="mail-count">It will go to <strong>${plural(subscribers, 'subscriber', 'subscribers')}</strong>.</p>
${subscribers > Math.max(0, limit - today) ? html`<p class="hint">Up to ${limit} of these emails are sent a day (to leave room for booking emails). The rest are sent automatically over the following days.</p>` : ''}
${c.test_sent_at ? html`<form method="post" action="/admin/mailing-list/emails/${c.id}/send" class="admin-form">${hidden(csrf)}
<label class="field-check mail-tick"><input type="checkbox" name="checked" value="1" required> I have checked the test email and it is ready to send to ${plural(subscribers, 'subscriber', 'subscribers')}</label>
<button class="btn-gold mail-send" type="submit" data-confirm="Send this email to ${subscribers} subscribers now? It can’t be taken back."${configured && subscribers ? '' : raw(' disabled')}>SEND TO ${subscribers} ${subscribers === 1 ? 'SUBSCRIBER' : 'SUBSCRIBERS'}</button></form>`
      : html`<p class="hint">Send yourself a test first (step 1).</p>`}
</section>` : html`<section class="panel" aria-labelledby="d-h"><h2 id="d-h">Delivery</h2>
<dl class="detail-list">
<div><dt>Sent by</dt><dd>${c.sent_by}, ${friendlyDateTime(c.started_at)}</dd></div>
<div><dt>Subscribers</dt><dd>${c.recipients}</dd></div>
<div><dt>Sent</dt><dd>${n('sent')}</dd></div>
${n('queued') + n('sending') ? html`<div><dt>Still to send</dt><dd>${n('queued') + n('sending')}</dd></div>` : ''}
${n('skipped') ? html`<div><dt>Not sent (unsubscribed first, or stopped)</dt><dd>${n('skipped')}</dd></div>` : ''}
${n('failed') ? html`<div><dt>Failed</dt><dd>${n('failed')}</dd></div>` : ''}
${n('unknown') ? html`<div><dt>Interrupted (not sent again)</dt><dd>${n('unknown')}</dd></div>` : ''}
</dl>
${Object.keys(delivery).length ? html`<p class="hint">What Resend says about the sent emails: ${Object.entries(delivery).map(([k, v]) => `${DELIVERY[k] || k}: ${v}`).join(' · ')}</p>` : ''}
<p class="row-actions">
<form method="post" action="/admin/mailing-list/emails/${c.id}/delivery">${hidden(csrf)}<button class="pill pill-gold" type="submit">Update delivery news</button></form>
${c.status === 'sending' ? html`<form method="post" action="/admin/mailing-list/emails/${c.id}/continue">${hidden(csrf)}<button class="pill pill-gold" type="submit">Send the next part now</button></form>
<form method="post" action="/admin/mailing-list/emails/${c.id}/stop">${hidden(csrf)}<button class="pill pill-danger" type="submit" data-confirm="Stop sending? Nobody else will get this email.">Stop sending</button></form>` : ''}</p>
${people.length ? html`<details class="spaced"><summary>Each person (${people.length})</summary><ul class="rows">${people.map((p) => html`<li class="row-card"><div class="row-text">
<span class="row-title">${p.email || '(removed from the list)'}</span>
<span class="row-line">${{ sent: 'Sent', queued: 'Waiting to send', sending: 'Sending', failed: 'Failed', skipped: 'Not sent', unknown: 'Interrupted: not sent again' }[p.status]}${p.delivery ? ` · ${DELIVERY[p.delivery] || p.delivery}` : ''}${p.sent_at ? ` · ${friendlyDateTime(p.sent_at)}` : ''}</span>
${p.error ? html`<span class="row-line">${p.error}</span>` : ''}</div></li>`)}</ul></details>` : ''}
</section>`}`
  });
}
