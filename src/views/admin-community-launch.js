// Admin › Community launch: the launch switch, official commenting switches, visitor statistics, Wednesday
// notifications and the Admin Community view (where Gary and Julie comment officially and moderate).
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime, longDate, isIsoDate } from '../lib/dates.js';
import { COMMUNITY_CSS, CARD_FONTS_CSS } from '../community/card.js';
import { postCard } from '../community/render.js';
import { OFFICIAL_NAMES } from '../community/config.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
export const COMMUNITY_ADMIN_JS = '/js/community-admin.js?v=1';
const assets = () => html`<link rel="stylesheet" href="${COMMUNITY_CSS}"><link rel="stylesheet" href="${CARD_FONTS_CSS}" crossorigin><link rel="stylesheet" href="/css/moderation.css?v=3">`;

const FLASH = {
  launch: 'The Community launch setting has been saved.', official: 'Official commenting updated.', 'not-yours': 'You can only switch your own official commenting on.',
  commented: 'Your official comment has been posted.', 'official-off': 'Your official commenting is switched off. Switch it on in Community launch first.',
  'not-official': 'Only Gary and Julie can post official comments.', 'send-started': 'Sending has started.', 'already-sent': 'This card’s notification has already been sent. Each card can only be sent once.',
  'not-published': 'Only a published card can be sent.', 'no-subscribers': 'Nobody has turned on Wednesday notifications yet, so there was nobody to send to.',
  empty: 'Please write your comment first.', hide: 'Comment hidden.', delete: 'Comment deleted.', approve: 'Comment approved.'
};
const banner = (flash) => (FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : '');

// ---------- launch, official commenting ----------
export function launchPage({ config, me, csrf, flash, subscribers, privacyCoversCommunity = true }) {
  const state = config.launch;
  const option = (value, label, text) => html`<label class="nwc-launch-opt${state === value ? ' is-on' : ''}"><input type="radio" name="state" value="${value}"${state === value ? raw(' checked') : ''}><span><strong>${label}</strong><br>${text}</span></label>`;
  const sw = (who) => {
    const on = config['official_' + who] === '1';
    const mine = me === who;
    return html`<div class="row-card"><div class="row-text"><span class="row-title">${OFFICIAL_NAMES[who]} ✓ ${on ? html`<span class="chip chip-live">On</span>` : html`<span class="chip">Off</span>`}</span>
<span class="row-line">${mine ? 'This is you.' : on ? 'You can switch this off in an emergency, but only ' + (who === 'gary' ? 'Gary' : 'Julie') + ' can switch it on.' : 'Only ' + (who === 'gary' ? 'Gary' : 'Julie') + ' can switch this on.'}</span></div>
<div class="row-actions">${on ? html`<form method="post" action="/admin/community/official/${who}/off">${hidden(csrf)}<button class="pill" type="submit"${mine ? '' : raw(' data-confirm="Switch off ' + (who === 'gary' ? 'Gary' : 'Julie') + '’s official commenting?"')}>Switch off</button></form>`
      : mine ? html`<form method="post" action="/admin/community/official/${who}/on">${hidden(csrf)}<button class="pill pill-gold" type="submit">Switch on</button></form>` : ''}</div></div>`;
  };
  const body = html`${assets()}${banner(flash)}
<h2 class="nwc-h2">Community launch</h2>
<form method="post" action="/admin/community/launch" class="nwc-sec nwc-launch">${hidden(csrf)}
<p class="nwc-note">Now: <strong>${{ off: 'Off (hidden)', testing: 'Testing', live: 'Live (public)' }[state]}</strong></p>
${option('off', 'Off (hidden)', 'Nothing of the Community is public, not even a card’s own link. Nobody can react, comment, report or turn on notifications. You can still preview cards in Admin.')}
${option('testing', 'Testing', 'Everything works for anyone with the link (Community page, reactions, comments, notifications), but it is NOT in the website’s menu and Google is asked not to list it.')}
${option('live', 'Live', 'New Way’s Community appears in the website’s menu and sitemap and can be found on Google.')}
<button class="btn-gold" type="submit" data-confirm="Save the Community launch setting?">Save launch setting</button>
</form>
${privacyCoversCommunity ? '' : html`<section class="nwc-sec nwc-privacy-note" data-nwc-privacy-note><h2 class="nwc-h2">Before going Live: your Privacy Notice</h2>
<p class="nwc-note">Your Privacy Notice doesn’t mention the Community yet. We recommend adding a short section before choosing Live. Nothing has been changed for you; you can copy, edit and add this suggested wording in <a href="/admin/wording/privacy_notice">Privacy Notice</a>:</p>
<blockquote class="nwc-quote"><p><strong>New Way’s Community</strong></p>
<p>If you comment on a Community card, we keep the name and comment you post, and a scrambled code (not your IP address) that helps us stop spam and abuse. Comments are checked automatically, and may be held for Gary or Julie to read before they appear. Reactions, likes and reports are kept with the same scrambled code. You can ask us to remove your comment at any time.</p>
<p>If you choose to turn on Wednesday notifications, we keep the notification address your browser gives us so we can send them. We only send them when Gary or Julie choose to. You can turn them off on the Community page at any time, and we delete the address.</p>
<p>We count visits to the Community without cookies, accounts or advertising tools. We keep only daily totals and a scrambled code that changes every day and is deleted after two days.</p></blockquote></section>`}
<h2 class="nwc-h2">Official commenting</h2>
<p class="nwc-note">When it is on, you can post comments and replies as <strong>${me ? OFFICIAL_NAMES[me] : 'yourself'} ✓</strong> from the Admin Community view. Each of you can switch your own on or off; either of you can switch the other’s off in an emergency, but never on.</p>
${me ? '' : html`<p class="banner banner-error">Your Admin sign-in doesn’t have an official identity (only Gary, and Julie’s own account, do. If two active Admin team members are called Julie, neither has it until one is switched off).</p>`}
<div class="rows">${sw('gary')}${sw('julie')}</div>
<h2 class="nwc-h2">More</h2>
<ul class="nwc-examples"><li><a class="pill pill-gold" href="/admin/community/stats">Visitor statistics</a></li><li><a class="pill" href="/admin/community">Community cards</a></li><li><a class="pill" href="/admin/community/moderation">Moderation</a></li></ul>
<p class="nwc-note">${subscribers} phone${subscribers === 1 ? ' has' : 's have'} turned on Wednesday notifications.</p>`;
  return adminPage({ title: 'Community launch', body, csrf, signedIn: true });
}

// ---------- statistics ----------
export function statsPage({ stats, csrf }) {
  const tile = (label, v, sub = '') => html`<div class="nwc-stat"><span class="nwc-stat-n">${v}</span><span class="nwc-stat-l">${label}</span>${sub ? html`<span class="nwc-stat-s">${sub}</span>` : ''}</div>`;
  const body = html`${assets()}
<p class="nwc-note">Private to Gary and Julie. Counted without cookies, accounts or IP addresses; Admin pages and previews, search engines and link previews are not counted. A visit is one visitor looking at one page on one day (refreshing doesn’t add more). “Different visitors” are estimates: each visitor is counted once a day, so someone who visits on 3 days counts 3 times in the longer totals.</p>
<div class="nwc-stats">
${tile('Visits today', stats.today.visits, `${stats.today.uniques} different visitors`)}
${tile('Last 7 days', stats.d7.visits, `${stats.d7.uniques} visitor-days`)}
${tile('Last 30 days', stats.d30.visits, `${stats.d30.uniques} visitor-days`)}
${tile('All time', stats.all.visits, `${stats.all.uniques} visitor-days`)}
${tile('From Facebook (30 days)', stats.d30.facebook, 'estimated')}
${tile('From Facebook (all time)', stats.all.facebook, 'estimated')}
</div>
<h2 class="nwc-h2">Each card</h2>
${stats.cards.length ? html`<ul class="rows">${stats.cards.map((c) => html`<li class="row-card"><div class="row-text"><span class="row-title">${c.post_id === 0 ? 'Community page' : c.title || 'Card ' + c.post_id}</span>
<span class="row-line">${c.visits} visits · ${c.uniques} visitor-days · ${c.facebook} from Facebook</span></div></li>`)}</ul>` : html`<p>No visits yet.</p>`}
<h2 class="nwc-h2">Last 30 days</h2>
${stats.days.length ? html`<ul class="nwc-days">${stats.days.map((d) => html`<li><span>${longDate(d.day)}</span><span>${d.visits} visits · ${d.uniques} visitors · ${d.facebook} Facebook</span></li>`)}</ul>` : html`<p>No visits yet.</p>`}
<p><a class="pill" href="/admin/community/launch">Community launch</a></p>`;
  return adminPage({ title: 'Community statistics', body, csrf, signedIn: true });
}

// ---------- Admin Community view: the card, its comments, official comments and moderation ----------
export function viewPage({ post, extra, held, me, officialOn, csrf, flash, origin, notify, subscribers }) {
  const mod = (c, action, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/community/moderation/comment/${c.id}/${action}">${hidden(csrf)}<input type="hidden" name="back" value="/admin/community/${post.id}/view">
<button class="${cls}" type="submit"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  const item = (c, reply = false) => html`<li class="nwc-comment${c.official ? ' nwc-comment-official' : ''}${reply ? ' nwc-reply' : ''}" id="c${c.id}">
<p class="nwc-comment-head">${c.official ? html`<span class="nwc-official">${OFFICIAL_NAMES[c.official]} <span class="nwc-tick" aria-hidden="true">✓</span></span>` : html`<span class="nwc-name">${c.name}</span>`}<span class="nwc-when">${friendlyDateTime(c.created_at)}${c.like_count ? ` · ♡ ${c.like_count}` : ''}${c.report_count ? ` · reported ${c.report_count}×` : ''}</span></p>
<p class="nwc-comment-text">${c.body}</p>
<div class="row-actions">${!reply && me && officialOn ? html`<a class="pill pill-gold" href="?reply=${c.id}#official">Reply officially</a>` : ''}${mod(c, 'hide', 'Hide')}${mod(c, 'delete', 'Delete', 'pill pill-danger', 'Delete this comment permanently (with any replies)?')}</div>
${!reply && c.replies && c.replies.length ? html`<ul class="nwc-replies">${c.replies.map((r) => item(r, true))}</ul>` : ''}
</li>`;
  const replyTo = extra.comments.find((c) => String(c.id) === String(extra.replyTo || ''));
  const body = html`${assets()}${banner(flash)}
<p class="nwc-note">${post.status === 'published' ? html`This is the published card as visitors see it. <a href="${origin}/community/${post.id}${post.slug ? '-' + post.slug : ''}" target="_blank" rel="noopener">View as visitors see it</a>.` : 'This card is a draft and is not public.'}</p>
<div class="nwc-post">${postCard(post, { priority: true, uid: 'av' + post.id })}</div>
<p class="nwc-note">👍 ${extra.counts.like} · ❤️ ${extra.counts.love} · 🙏 ${extra.counts.thanks} · ${extra.total} comment${extra.total === 1 ? '' : 's'}${held ? ` · ${held} waiting in moderation` : ''}</p>
${post.status === 'published' ? html`<section class="nwc-sec" id="official"><h2 class="nwc-h2">${replyTo ? 'Official reply' : 'Official comment'}</h2>
${!me ? html`<p class="nwc-note">Only Gary and Julie can post official comments.</p>` : !officialOn ? html`<p class="nwc-note">Your official commenting is off. <a href="/admin/community/launch">Switch it on</a> to comment as ${OFFICIAL_NAMES[me]} ✓.</p>`
    : html`<form method="post" action="/admin/community/${post.id}/official-comment">${hidden(csrf)}
${replyTo ? html`<input type="hidden" name="parent" value="${replyTo.id}"><p class="nwc-note">Replying to <strong>${replyTo.official ? OFFICIAL_NAMES[replyTo.official] : replyTo.name}</strong> · <a href="/admin/community/${post.id}/view#official">Cancel</a></p>` : ''}
<p class="nwc-note">Posting as <span class="nwc-official">${OFFICIAL_NAMES[me]} <span class="nwc-tick" aria-hidden="true">✓</span></span></p>
<div class="field"><label for="oc-text">Comment</label><textarea id="oc-text" name="text" rows="4" maxlength="2000" required></textarea></div>
<button class="btn-gold" type="submit">Post official ${replyTo ? 'reply' : 'comment'}</button></form>`}
</section>` : ''}
<h2 class="nwc-h2">Comments</h2>
${extra.comments.length ? html`<ul class="nwc-comment-list">${extra.comments.map((c) => item(c))}</ul>` : html`<p>No comments yet.</p>`}
${post.status === 'published' ? html`<section class="nwc-sec"><h2 class="nwc-h2">Wednesday notification</h2>${notifyBlock({ post, notify, subscribers, csrf })}</section>` : ''}
<p><a class="pill" href="/admin/community/moderation">Moderation</a> <a class="pill" href="/admin/community">Community cards</a></p>
<script src="${COMMUNITY_ADMIN_JS}" defer></script>`;
  return adminPage({ title: 'Community view', body, csrf, signedIn: true });
}

function notifyBlock({ post, notify, subscribers, csrf }) {
  if (!notify) {
    return html`<p class="nwc-note">Nothing is sent automatically. Tap below to send one notification about this card to the ${subscribers} phone${subscribers === 1 ? '' : 's'} that turned on Wednesday notifications. Each card can only be sent once.</p>
<form method="post" action="/admin/community/${post.id}/notify">${hidden(csrf)}<button class="btn-gold" type="submit"${subscribers ? '' : raw(' disabled')} data-confirm="Send a notification about this card to ${subscribers} phone${subscribers === 1 ? '' : 's'} now? This can only be done once for this card.">Send notification</button></form>`;
  }
  const c = notify.counts;
  return html`<div data-nwc-sending="${notify.done ? '' : post.id}" data-csrf="${csrf}">
<p class="nwc-note" data-nwc-progress>${notify.done ? 'Finished' : 'Sending…'}: ${c.sent} sent, ${c.failed} could not be delivered, ${c.gone} phones had turned notifications off${notify.done ? '' : `, ${c.pending} still to send`}. Started by ${notify.send.created_by} ${friendlyDateTime(notify.send.created_at)}.</p>
${notify.done ? '' : html`<p class="nwc-note">Keep this screen open until it finishes. If it’s closed, the rest are sent automatically within the hour, and nobody is ever sent it twice.</p>`}
</div>`;
}
