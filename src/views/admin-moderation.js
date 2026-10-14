// Admin › Community moderation (Gary and Julie only): held comments, word lists, repeat offenders and Test a Comment.
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime } from '../lib/dates.js';
import { MAX_COMMENT, MAX_NAME } from '../community/moderation.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const BASE = '/admin/community/moderation';
export const MODERATION_CSS = '/css/moderation.css?v=1';   // change the number whenever moderation.css changes

function tabs(current) {
  const items = [['', 'Comments'], ['/test', 'Test a Comment'], ['/words', 'Word lists'], ['/visitors', 'Repeat visitors']];
  return html`<nav class="tabs" aria-label="Community moderation">${items.map(([p, label]) => html`<a class="tab-link${p === current ? ' is-current' : ''}" href="${BASE}${p}"${p === current ? raw(' aria-current="page"') : ''}>${label}</a>`)}</nav>`;
}
const page = (title, current, body, csrf) => adminPage({ title, csrf, signedIn: true, body: html`<link rel="stylesheet" href="${MODERATION_CSS}">${tabs(current)}${body}` });

const FLASH = {
  approve: 'Approved. The comment is published, and visitor reports can no longer hide it.',
  reject: 'Rejected. The comment will not be shown.',
  hide: 'Hidden. The comment is no longer on the page.',
  delete: 'Deleted permanently (with any replies).',
  'not-allowed': 'That comment has already been dealt with.',
  added: 'Saved to the word lists.',
  removed: 'Removed from the word lists.',
  visitor: 'Visitor record updated.'
};

// ---------- comments ----------
const STATUS = { held: 'Held for review', hidden: 'Hidden', published: 'Published', rejected: 'Rejected' };
export function commentsPage({ show, comments, counts, csrf, flash }) {
  const act = (c, a, label, cls = 'pill', confirm = '') => html`<form method="post" action="${BASE}/comment/${c.id}/${a}">${hidden(csrf)}<button class="${cls}" type="submit"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  const reasons = (c) => { try { return JSON.parse(c.reasons || '[]'); } catch { return []; } };
  const body = html`${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<p class="banner">Public comments are <strong>not switched on yet</strong> (that is Stage 5). Until then these lists stay empty; use <a href="${BASE}/test">Test a Comment</a> to try the protections.</p>
<nav class="tabs" aria-label="Which comments">${['held', 'hidden', 'published', 'rejected'].map((s) => html`<a class="tab-link${s === show ? ' is-current' : ''}" href="${BASE}?show=${s}">${STATUS[s]} (${counts[s] || 0})</a>`)}</nav>
${comments.length ? html`<ul class="rows">${comments.map((c) => html`<li class="row-card">
<div class="row-text">
<span class="row-title">${c.name || 'No name'}${c.official ? html` <span class="chip chip-live">Admin ${c.official === 'gary' ? 'Gary' : 'Julie'} ✓</span>` : ''}</span>
<span class="row-line">${c.post_title || 'Card ' + c.post_id} · ${friendlyDateTime(c.created_at)}${c.parent_id ? ' · reply' : ''}${c.report_count ? ` · reported ${c.report_count}×` : ''}</span>
<p class="nwc-comment-body">${c.body}</p>
${reasons(c).length ? html`<ul class="nwc-reasons">${reasons(c).map((r) => html`<li><strong>${r.action === 'block' ? 'Block' : 'Hold'}:</strong> ${r.detail}</li>`)}</ul>` : ''}
${c.approved_by ? html`<span class="row-line">Approved by ${c.approved_by}</span>` : ''}
</div>
<div class="row-actions">
${c.status === 'held' ? html`${act(c, 'approve', 'Approve', 'pill pill-gold')}${act(c, 'reject', 'Reject')}` : ''}
${c.status === 'hidden' || c.status === 'rejected' ? act(c, 'approve', c.status === 'hidden' ? 'Approve and restore' : 'Approve after all', 'pill pill-gold') : ''}
${c.status === 'published' ? act(c, 'hide', 'Hide') : ''}
${act(c, 'delete', 'Delete', 'pill pill-danger', 'Delete this comment permanently? Any replies to it are deleted too. This can’t be undone.')}
</div>
</li>`)}</ul>` : html`<p>No ${STATUS[show].toLowerCase()} comments.</p>`}`;
  return page('Community moderation', '', body, csrf);
}

// ---------- Test a Comment ----------
export const EXAMPLES = [
  ['Normal thank-you', 'Thank you so much Jane, what a wonderful evening! My mum came through and I was in tears. Love Jean xxx', 'Jean'],
  ['Innocent words', 'The cocktail bar in Scunthorpe was lovely and we stayed in Essex. A blue tit flew in during the reading!', 'Margaret'],
  ['Ticket question', 'Are there any tickets left for Friday?', 'Ann'],
  ['Disguised swearing', 'You are full of sh1t', 'Sam'],
  ['Spaced-out swearing', 'What a s h i t night', 'Sam'],
  ['Fake ticket sale', 'Got 2 spare tickets for Friday, message me on WhatsApp', 'Kelly'],
  ['Phone number', 'Tickets available, text 07700 900123', 'Kelly'],
  ['Website link', 'Visit www.example-psychic.com for readings', 'Rose'],
  ['Disguised link', 'Check out examplepsychic dot com', 'Rose'],
  ['Advertising readings', 'I do readings too, £20, inbox me', 'Mystic Mo'],
  ['Request for money', 'Please send money to my PayPal', 'Lee'],
  ['Threat', 'I know where you live', 'Anon'],
  ['Name: Admin Gary', 'Thanks everyone for coming tonight', 'Admin Gary'],
  ['Name: New Way’s', 'See you all next week', 'New Ways Team']
];

export function testPage({ values = {}, result = null, csrf }) {
  const verdict = result && result.verdict;
  const label = { allow: 'ALLOW', hold: 'HOLD', block: 'BLOCK' };
  const explain = { allow: 'This comment would be published straight away.', hold: 'This comment would be kept privately until you or Julie approve it.', block: 'This comment would not be published or stored. The visitor would see the message below and could change their wording.' };
  const body = html`<p class="nwc-note">Type any wording to see what the protections would do. This uses exactly the same checks as real comments. <strong>Nothing is published, stored or sent</strong>, and it doesn’t count towards any statistics.</p>
<form method="post" action="${BASE}/test" class="nwc-test">${hidden(csrf)}
<div class="field"><label for="t-name">Visitor’s name (optional)</label><input type="text" id="t-name" name="name" value="${values.name || ''}" maxlength="${MAX_NAME + 20}" autocomplete="off"></div>
<div class="field"><label for="t-text">Comment</label><textarea id="t-text" name="text" rows="4" maxlength="${MAX_COMMENT + 200}">${values.text || ''}</textarea></div>
<button class="btn-gold" type="submit">Test this comment</button>
</form>
${result ? html`<section class="nwc-verdict nwc-verdict-${verdict}" role="status" aria-live="polite">
<p class="nwc-verdict-word">${label[verdict]}</p>
<p>${explain[verdict]}</p>
${result.message ? html`<p class="nwc-visitor-sees"><span>The visitor would see:</span> “${result.message}”</p>` : ''}
${result.reasons.length ? html`<p class="nwc-label">Why:</p><ul class="nwc-reasons">${result.reasons.map((r) => html`<li><strong>${r.action === 'block' ? 'Block' : 'Hold'}:</strong> ${r.detail}</li>`)}</ul>` : html`<p>No problems found.</p>`}
</section>` : ''}
<h2 class="nwc-h2">Try an example</h2>
<ul class="nwc-examples">${EXAMPLES.map(([label], i) => html`<li><a class="pill" href="${BASE}/test?example=${i}">${label}</a></li>`)}</ul>`;
  return page('Test a Comment', '/test', body, csrf);
}

// ---------- word lists ----------
const ACTIONS = [['block', 'Block'], ['hold', 'Hold for review'], ['allow', 'Allow (innocent)']];
export const CATEGORIES = [['swearing', 'Swearing'], ['hate', 'Hate and discrimination'], ['sexual', 'Sexual'], ['threat', 'Threats'], ['abuse', 'Bullying and abuse'], ['innocent', 'Innocent word'], ['other', 'Other']];
export function wordsPage({ rows, csrf, flash, error = '', values = {}, q = '' }) {
  const groups = { block: [], hold: [], allow: [] };
  const filter = q ? rows.filter((r) => r.phrase.includes(q.toLowerCase())) : rows;
  for (const r of filter) (groups[r.action] || []).push(r);
  const item = (r) => html`<li class="nwc-word"><span><span class="nwc-word-text">${r.phrase}</span> <span class="chip">${r.category || 'other'}</span>${r.anywhere ? html` <span class="chip">also inside words</span>` : ''}${r.source === 'admin' ? html` <span class="chip chip-soon">added in Admin</span>` : ''}</span>
<form method="post" action="${BASE}/words/${r.id}/delete">${hidden(csrf)}<button class="pill pill-danger" type="submit" data-confirm="Remove “${r.phrase}” from the lists?">Remove</button></form></li>`;
  const body = html`${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
${error ? html`<p class="banner banner-error" role="alert">${error}</p>` : ''}
<p class="nwc-note"><strong>Block</strong>: never published. <strong>Hold</strong>: kept privately for you or Julie to check. <strong>Allow</strong>: innocent words that happen to contain a blocked word (such as Scunthorpe). Disguised spellings (numbers, symbols, spaces, stretched letters) are caught automatically, so there is no need to add them.</p>
<form method="post" action="${BASE}/words/add" class="nwc-sec nwc-addword">${hidden(csrf)}
<h2 class="nwc-h2">Add a word or phrase</h2>
<div class="field"><label for="w-phrase">Word or phrase</label><input type="text" id="w-phrase" name="phrase" value="${values.phrase || ''}" maxlength="60" autocomplete="off" required></div>
<div class="nwc-grid2">
<div class="field"><label for="w-action">What happens</label><select id="w-action" name="action">${ACTIONS.map(([v, l]) => html`<option value="${v}"${v === (values.action || 'block') ? raw(' selected') : ''}>${l}</option>`)}</select></div>
<div class="field"><label for="w-category">Type</label><select id="w-category" name="category">${CATEGORIES.map(([v, l]) => html`<option value="${v}"${v === (values.category || 'swearing') ? raw(' selected') : ''}>${l}</option>`)}</select></div>
</div>
<label class="field-check"><input type="checkbox" name="anywhere" value="1"${values.anywhere ? raw(' checked') : ''}> Also catch it inside longer words (only for very strong words)</label>
<button class="btn-gold" type="submit">Save</button>
</form>
<form method="get" action="${BASE}/words" class="nwc-search"><label for="w-q">Find a word</label><div class="nwc-grid2"><input type="text" id="w-q" name="q" value="${q}" autocomplete="off"><button class="pill" type="submit">Find</button></div></form>
<p class="nwc-note">The lists below contain offensive words. They are closed until you open them.</p>
${[['block', 'Blocked words and phrases'], ['hold', 'Held for review'], ['allow', 'Allowed (innocent) words']].map(([k, title]) => html`<details class="nwc-sec"${q ? raw(' open') : ''}>
<summary>${title} (${groups[k].length})</summary>
${groups[k].length ? html`<ul class="nwc-words">${groups[k].sort((a, b) => a.phrase.localeCompare(b.phrase)).map(item)}</ul>` : html`<p>None.</p>`}
</details>`)}`;
  return page('Word lists', '/words', body, csrf);
}

// ---------- repeat visitors ----------
export function visitorsPage({ visitors, csrf, flash }) {
  const act = (v, a, label, cls = 'pill', confirm = '') => html`<form method="post" action="${BASE}/visitors/${v.visitor_key}/${a}">${hidden(csrf)}<button class="${cls}" type="submit"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  const now = Date.now();
  const body = html`${FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : ''}
<p class="nwc-note">Visitors don’t have accounts, so each is recognised only by a scrambled code made from their network and browser (never their IP address, name or email). Someone who sends <strong>3 blocked comments within a day</strong> has their comments held for review for 7 days. Nobody is ever banned for one blocked comment: they can change their wording and try again.</p>
<p class="nwc-note">The code is a good guide, not proof: people sharing a Wi-Fi or mobile network can look like one visitor, and one person using two phones, or clearing their browser, can look like two.</p>
${visitors.length ? html`<ul class="rows">${visitors.map((v) => {
    const holding = v.always_hold || (v.hold_until && Date.parse(v.hold_until) > now);
    return html`<li class="row-card"><div class="row-text">
<span class="row-title">${v.last_name || 'Unknown name'} <span class="chip">${v.visitor_key.slice(0, 9)}</span></span>
<span class="row-line">Blocked ${v.blocked_total}× · held ${v.held_total}×${v.last_strike_at ? ' · last blocked ' + friendlyDateTime(v.last_strike_at) : ''}</span>
<span class="chips">${v.always_hold ? html`<span class="chip chip-hidden">Every comment held</span>` : holding ? html`<span class="chip chip-hidden">Held until ${friendlyDateTime(v.hold_until)}</span>` : ''}${v.reports_ignored ? html`<span class="chip chip-past">Reports ignored</span>` : ''}</span>
</div><div class="row-actions">
${v.always_hold ? act(v, 'normal', 'Stop holding their comments') : act(v, 'always-hold', 'Hold all their comments', 'pill pill-gold')}
${v.reports_ignored ? act(v, 'count-reports', 'Count their reports again') : act(v, 'ignore-reports', 'Ignore their reports')}
${act(v, 'clear', 'Clear record', 'pill pill-danger', 'Clear this visitor’s record? Their blocked count and any holding period are removed.')}
</div></li>`;
  })}</ul>` : html`<p>No repeat visitors recorded.</p>`}`;
  return page('Repeat visitors', '/visitors', body, csrf);
}

