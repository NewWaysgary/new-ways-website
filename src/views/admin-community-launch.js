// Admin › Community launch: the launch switch, official commenting switches, visitor statistics, Wednesday
// notifications and the Admin Community view (where Gary and Julie comment officially and moderate).
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime, longDate, isIsoDate } from '../lib/dates.js';
import { COMMUNITY_CSS, CARD_FONTS_CSS } from '../community/card.js';
import { postCard } from '../community/render.js';
import { OFFICIAL_NAMES, LIVE_RANGES } from '../community/config.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
export const COMMUNITY_ADMIN_JS = '/js/community-admin.js?v=1';
const assets = () => html`<link rel="stylesheet" href="${COMMUNITY_CSS}"><link rel="stylesheet" href="${CARD_FONTS_CSS}" crossorigin><link rel="stylesheet" href="/css/moderation.css?v=4">`;

const FLASH = {
  launch: 'The Community launch setting has been saved.', official: 'Official commenting updated.', 'not-yours': 'You can only switch your own official commenting on.',
  commented: 'Your official comment has been posted.', 'official-off': 'Your official commenting is switched off. Switch it on in Community launch first.',
  'not-official': 'Only Gary and Julie can post official comments.', 'send-started': 'Sending has started.', 'already-sent': 'This card’s notification has already been sent. Each card can only be sent once.',
  'not-published': 'Only a published card can be sent.', 'no-subscribers': 'Nobody has turned on Wednesday notifications yet, so there was nobody to send to.',
  empty: 'Please write your comment first.', hide: 'Comment hidden.', delete: 'Comment deleted.', approve: 'Comment approved.', reject: 'Comment rejected.',
  alerts: 'Your Community notification choices have been saved.', 'live-saved': 'Live updates settings saved. They apply straight away.',
  'live-resumed': 'Live updates resumed. If today’s limit is still reached, they will pause again: raise the daily limit first if you need more today.',
  'live-range': 'That setting wasn’t saved: please keep each number within the range shown.'
};
const banner = (flash) => (FLASH[flash] ? html`<p class="banner banner-ok" role="status">${FLASH[flash]}</p>` : '');

// ---------- launch, official commenting ----------
export function launchPage({ config, me, csrf, flash, subscribers, privacyCoversCommunity = true, usage = null, liveReady = true, prefs = { mode: 'all', showText: true }, today = '', rangeKey = '' }) {
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
${alertsSection({ prefs, csrf })}
${liveSection({ config, usage, liveReady, csrf, today, rangeKey })}
<h2 class="nwc-h2">More</h2>
<ul class="nwc-examples"><li><a class="pill pill-gold" href="/admin/community/live">View Live Comments</a></li><li><a class="pill" href="/admin/community/stats">Visitor statistics</a></li><li><a class="pill" href="/admin/community">Community cards</a></li><li><a class="pill" href="/admin/community/moderation">Moderation</a></li></ul>
<p class="nwc-note">${subscribers} phone${subscribers === 1 ? ' has' : 's have'} turned on Wednesday notifications.</p>`;
  return adminPage({ title: 'Community launch', body, csrf, signedIn: true });
}

// ---------- your own Community phone notifications ----------
function alertsSection({ prefs, csrf }) {
  const opt = (v, label) => html`<label class="nwc-launch-opt${prefs.mode === v ? ' is-on' : ''}"><input type="radio" name="mode" value="${v}"${prefs.mode === v ? raw(' checked') : ''}><span>${label}</span></label>`;
  return html`<section class="nwc-sec" id="alerts"><h2 class="nwc-h2">Your Community notifications</h2>
<p class="nwc-note">Sent to the phones where you turned on Admin notifications (Admin › Live chat). These are your own choices: Gary’s and Julie’s are separate. No emails are sent. Each comment is notified once, and each card at most once every 2 minutes (then “3 more comments…”).</p>
<form method="post" action="/admin/community/alerts" class="nwc-launch">${hidden(csrf)}
${opt('all', 'Every new comment and reply, plus anything needing review')}
${opt('review', 'Only comments waiting for review or hidden after reports')}
${opt('off', 'None')}
<label class="nwc-check"><input type="checkbox" name="show_text" value="1"${prefs.showText ? raw(' checked') : ''}> Show the commenter’s name and words on my lock screen</label>
<button class="btn-gold" type="submit">Save my notification choices</button>
</form>
<p class="nwc-note"><a href="/admin/chat">Turn on Admin notifications for this phone</a> (in Live chat), if you haven’t already.</p></section>`;
}

// ---------- live updates: what they used today, and the safety settings ----------
function liveSection({ config, usage, liveReady, csrf, today, rangeKey }) {
  const paused = config.live_paused_day === today;
  const field = (k, label, help) => html`<div class="field"><label for="lv-${k}">${label}</label><input type="number" inputmode="numeric" id="lv-${k}" name="${k}" value="${config[k]}" min="${LIVE_RANGES[k][0]}" max="${LIVE_RANGES[k][1]}" required${rangeKey === k ? raw(' aria-invalid="true"') : ''}>
<p class="nwc-note">${help} (${LIVE_RANGES[k][0]} to ${LIVE_RANGES[k][1]})</p></div>`;
  const u = usage;
  const daily = Number(config.live_daily) || 15000;
  return html`<section class="nwc-sec" id="live"><h2 class="nwc-h2">Live updates and safety</h2>
${!liveReady ? html`<p class="banner banner-error">Live updates aren’t available on this copy of the website (the live connection service isn’t set up). Comments still work; visitors refresh to see new ones.</p>` : ''}
${paused ? html`<p class="banner banner-error">Today’s live connection limit was reached, so new live connections are paused until midnight UTC (1am in British Summer Time). Cards, comments and reactions all still work, and phones already connected keep receiving updates.</p>
<form method="post" action="/admin/community/live-resume">${hidden(csrf)}<button class="pill" type="submit" data-confirm="Resume live updates now? Raise the daily limit first, or they will pause again straight away.">Resume live updates</button></form>` : ''}
${u ? html`<div class="nwc-stats">
<div class="nwc-stat"><span class="nwc-stat-n">${u.connections}</span><span class="nwc-stat-l">Live connections today</span><span class="nwc-stat-s">${Math.round((u.connections / daily) * 100)}% of your daily limit (${daily})</span></div>
<div class="nwc-stat"><span class="nwc-stat-n">${u.openNow}</span><span class="nwc-stat-l">Connected right now</span><span class="nwc-stat-s">plus ${u.adminOpenNow} in Admin</span></div>
<div class="nwc-stat"><span class="nwc-stat-n">${u.fallback + u.manual}</span><span class="nwc-stat-l">Fallback checks today</span><span class="nwc-stat-s">${u.refused + u.full} connections refused</span></div>
<div class="nwc-stat"><span class="nwc-stat-n">${u.broadcasts}</span><span class="nwc-stat-l">Updates sent out today</span><span class="nwc-stat-s">Now: ${{ normal: 'normal', reduced: 'grouping more (busy)', paused: 'paused', off: 'off' }[u.mode] || u.mode}</span></div>
</div>` : liveReady ? html`<p class="nwc-note">Today’s live figures couldn’t be read just now.</p>` : ''}
<p class="nwc-note"><strong>What these figures are:</strong> exact counts of the Community’s own live features today (UTC day): each new live connection or fallback check uses one of Cloudflare’s free daily website requests; updates sent out to phones don’t use any. <strong>What can’t be seen here:</strong> Cloudflare’s total for the whole website (page visits, bookings, payments, Admin). That is in the Cloudflare dashboard: Workers &amp; Pages › new-ways-website › Metrics. The free plan allows 100,000 requests a day for everything.</p>
<form method="post" action="/admin/community/live-settings" class="nwc-launch">${hidden(csrf)}
<label class="nwc-check"><input type="radio" name="live_enabled" value="1"${config.live_enabled !== '0' ? raw(' checked') : ''}> Live updates on</label>
<label class="nwc-check"><input type="radio" name="live_enabled" value="0"${config.live_enabled === '0' ? raw(' checked') : ''}> Live updates off (visitors tap Refresh comments instead)</label>
${field('live_daily', 'Daily limit: new live connections', 'After this many in one day, new live connections pause until midnight UTC')}
${field('live_reduce', 'Start grouping more at (% of the daily limit)', 'From here, updates are sent in bigger groups and phones reconnect less often')}
${field('live_per_card', 'Most phones connected to one card at once', 'Others check every minute instead')}
${field('live_total', 'Most phones connected to all cards at once', 'Others check every minute instead')}
${field('live_fallback_daily', 'Daily limit: fallback checks', 'For phones that can’t connect live (and Refresh comments taps)')}
${field('live_fallback_secs', 'Seconds between fallback checks', 'Three times longer when busy; only while the page is on screen')}
<button class="btn-gold" type="submit" data-confirm="Save the live updates settings?">Save live updates settings</button>
</form>
<p class="nwc-note">With the standard settings, the Community’s live features can use at most about 20,000 of the 100,000 daily requests (15,000 connections and 5,000 checks), leaving the rest for bookings, payments, Wednesday Door and everything else.</p></section>`;
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

// ---------- View Live Comments: the whole conversation for one card, inside Admin ----------
export const LIVE_ADMIN_JS = '/js/community-live-admin.js?v=1';
const REASON_TEXT = { language: 'language', link: 'link or contact details', advert: 'selling or advertising', name: 'name', repeat: 'repeated', visitor: 'visitor', medium: 'guest medium’s name', reports: 'reports', admin: 'hidden by Admin' };
function reasonsOf(c) {
  let list = [];
  try { list = JSON.parse(c.reasons || '[]'); } catch { list = []; }
  return list.map((r) => r.detail || REASON_TEXT[r.code] || r.code).filter(Boolean).join(' · ');
}

// The part of the page that updates itself: counts, comments needing review, and the conversation
export function liveRegion({ post, extra, review, me, officialOn, csrf }) {
  const back = `/admin/community/${post.id}/view`;
  const mod = (c, action, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/community/moderation/comment/${c.id}/${action}" data-nwc-ajax>${hidden(csrf)}<input type="hidden" name="back" value="${back}">
<button class="${cls}" type="submit"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  const canReply = me && officialOn && post.status === 'published';
  const item = (c, reply = false) => html`<li class="nwc-comment${c.official ? ' nwc-comment-official' : ''}${reply ? ' nwc-reply' : ''}" id="c${c.id}" data-comment="${c.id}"${reply ? html` data-parent="${c.parent_id}"` : ''}>
${reply && c.replyToName ? html`<p class="nwc-replyto">↪ replying to ${c.replyToName}</p>` : ''}<p class="nwc-comment-head">${c.official ? html`<span class="nwc-official">${OFFICIAL_NAMES[c.official]} <span class="nwc-tick" aria-hidden="true">✓</span></span>` : html`<span class="nwc-name">${c.name}</span>`}<span class="nwc-when">${friendlyDateTime(c.created_at)}${c.like_count ? ` · ♡ ${c.like_count}` : ''}${c.report_count ? ` · reported ${c.report_count}×` : ''}</span></p>
<p class="nwc-comment-text">${c.body}</p>
<div class="row-actions">${canReply ? html`<a class="pill pill-gold" href="?reply=${c.id}#official" data-nwc-admin-reply="${c.id}" data-name="${c.official ? OFFICIAL_NAMES[c.official] : c.name}">Reply officially</a>` : ''}${mod(c, 'hide', 'Hide', 'pill', 'Hide this ' + (reply ? 'reply' : 'comment and its replies') + ' from the public? You can restore it later.')}${mod(c, 'delete', 'Delete', 'pill pill-danger', 'Delete this ' + (reply ? 'reply' : 'comment (with any replies)') + ' permanently?')}</div>
${!reply && c.replies && c.replies.length ? html`<ul class="nwc-replies">${c.replies.map((r) => item(r, true))}</ul>` : ''}
</li>`;
  const reviewItem = (c) => html`<li class="nwc-comment nwc-review-item" id="r${c.id}" data-review="${c.id}">
<p class="nwc-comment-head"><span class="nwc-name">${c.name}</span><span class="chip${c.status === 'held' ? '' : ' chip-hidden'}">${c.status === 'held' ? 'Waiting for review' : 'Hidden'}</span><span class="nwc-when">${friendlyDateTime(c.created_at)}${c.report_count ? ` · reported ${c.report_count}×` : ''}${c.parent_id ? ' · a reply' : ''}</span></p>
<p class="nwc-comment-text">${c.body}</p>
${reasonsOf(c) ? html`<p class="nwc-note">Why: ${reasonsOf(c)}</p>` : ''}
<div class="row-actions">${mod(c, 'approve', c.status === 'held' ? 'Approve' : 'Restore', 'pill pill-gold')}${c.status === 'held' ? mod(c, 'reject', 'Reject') : ''}${mod(c, 'delete', 'Delete', 'pill pill-danger', 'Delete this comment permanently?')}</div>
</li>`;
  return html`<div data-nwc-admin-region>
<p class="nwc-note" data-nwc-admin-counts>👍 ${extra.counts.like} · ❤️ ${extra.counts.love} · 🙏 ${extra.counts.thanks} · ${extra.total} published comment${extra.total === 1 ? '' : 's'}${review.length ? ` · ${review.length} to review` : ''}</p>
${review.length ? html`<section class="nwc-sec nwc-review" id="review"><h2 class="nwc-h2">Needs your review (${review.length})</h2>
<p class="nwc-note">Not shown to the public. Approve to publish (or restore) it, or reject or delete it.</p>
<ul class="nwc-comment-list">${review.map(reviewItem)}</ul></section>` : ''}
<section class="nwc-sec" id="conversation"><h2 class="nwc-h2">Conversation</h2>
${extra.comments.length ? html`<ul class="nwc-comment-list" data-nwc-admin-list>${extra.comments.map((c) => item(c))}</ul>` : html`<p>No comments yet.</p>`}
</section>
</div>`;
}

export function viewPage({ post, extra, review, me, officialOn, csrf, flash, origin, notify, subscribers, cards = [], liveReady = true }) {
  const at = cards.findIndex((c) => c.id === post.id);
  const prev = at > 0 ? cards[at - 1] : null, next = at >= 0 && at < cards.length - 1 ? cards[at + 1] : null;
  const publicUrl = `${origin}/community/${post.id}${post.slug ? '-' + post.slug : ''}`;
  const replyTo = [...extra.comments, ...extra.comments.flatMap((c) => c.replies || [])].find((c) => String(c.id) === String(extra.replyTo || ''));
  const body = html`${assets()}${banner(flash)}
${cards.length ? html`<nav class="nwc-switch" aria-label="Switch card">
${prev ? html`<a class="pill" href="/admin/community/${prev.id}/view" title="${prev.title}">‹ Newer</a>` : ''}
<form method="get" action="/admin/community/go" class="nwc-switch-form"><label class="sr-only" for="nwc-card-pick">Card</label><select id="nwc-card-pick" name="id" data-nwc-card-pick>
${cards.map((c) => html`<option value="${c.id}"${c.id === post.id ? raw(' selected') : ''}>${c.title || 'Thank-you card'}${isIsoDate(c.wed_date) ? ' · ' + longDate(c.wed_date) : ''}</option>`)}
</select> <button class="pill" type="submit" data-nwc-card-go>Open</button></form>
${next ? html`<a class="pill" href="/admin/community/${next.id}/view" title="${next.title}">Older ›</a>` : ''}
</nav>` : ''}
<h2 class="nwc-h2">Live comments: ${post.title || 'Thank-you card'}</h2>
${post.status === 'published' ? html`<div class="nwc-live-bar" data-nwc-admin-live="${post.id}" data-ready="${liveReady ? '1' : '0'}"><span class="nwc-live-dot" aria-hidden="true"></span> <span data-nwc-live-text role="status">${liveReady ? 'Connecting…' : 'Refresh the page to see new comments.'}</span></div>` : html`<p class="banner">This card is a draft and is not public.</p>`}
<details class="nwc-sec"><summary>The card</summary><div class="nwc-post">${postCard(post, { priority: false, uid: 'av' + post.id })}</div></details>
${post.status === 'published' ? html`<p class="nwc-public-link"><a class="pill" href="${publicUrl}" target="_blank" rel="noopener">View Public Card</a>
<span class="nwc-note">Opens the public website, exactly as visitors see it. Comments posted there are ordinary public comments, not verified Admin comments.</span></p>` : ''}
${liveRegion({ post, extra, review, me, officialOn, csrf })}
${post.status === 'published' ? html`<section class="nwc-sec" id="official"><h2 class="nwc-h2" data-nwc-official-title>${replyTo ? 'Official reply' : 'Official comment'}</h2>
${!me ? html`<p class="nwc-note">Only Gary and Julie can post official comments.</p>` : !officialOn ? html`<p class="nwc-note">Your official commenting is off. <a href="/admin/community/launch">Switch it on</a> to comment as ${OFFICIAL_NAMES[me]} ✓.</p>`
    : html`<form method="post" action="/admin/community/${post.id}/official-comment" data-nwc-official-form>${hidden(csrf)}
<input type="hidden" name="parent" value="${replyTo ? replyTo.id : ''}" data-nwc-official-parent>
<p class="nwc-note" data-nwc-official-replying${replyTo ? '' : raw(' hidden')}>Replying to <strong data-nwc-official-name>${replyTo ? (replyTo.official ? OFFICIAL_NAMES[replyTo.official] : replyTo.name) : ''}</strong> · <a href="/admin/community/${post.id}/view#official" data-nwc-official-cancel>Cancel</a></p>
<p class="nwc-note">Posting as <span class="nwc-official">${OFFICIAL_NAMES[me]} <span class="nwc-tick" aria-hidden="true">✓</span></span></p>
<div class="field"><label for="oc-text">Comment</label><textarea id="oc-text" name="text" rows="4" maxlength="2000" required></textarea></div>
<p class="nwc-note" data-nwc-official-msg role="status" hidden></p>
<button class="btn-gold" type="submit" data-nwc-official-submit>Post official ${replyTo ? 'reply' : 'comment'}</button></form>`}
</section>` : ''}
${post.status === 'published' ? html`<section class="nwc-sec"><h2 class="nwc-h2">Wednesday notification</h2>${notifyBlock({ post, notify, subscribers, csrf })}</section>` : ''}
<p><a class="pill" href="/admin/community">Community cards</a> <a class="pill" href="/admin/community/moderation">Moderation</a> <a class="pill" href="/admin/community/launch">Community launch</a></p>
<script src="${COMMUNITY_ADMIN_JS}" defer></script>
<script src="${LIVE_ADMIN_JS}" defer></script>`;
  return adminPage({ title: 'Live comments', body, csrf, signedIn: true });
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
