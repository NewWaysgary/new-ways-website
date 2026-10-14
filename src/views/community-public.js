// New Way's Community: what visitors see (the Community page, a card with its reactions and comments, the welcome
// panel with Install Our App and Enable Wednesday Notifications, and help for people inside Facebook's own browser).
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { friendlyDateTime, longDate, isIsoDate } from '../lib/dates.js';
import { COMMUNITY_CSS, CARD_FONTS_CSS } from '../community/card.js';
import { postCard } from '../community/render.js';
import { postPath } from '../community/model.js';
import { OFFICIAL_NAMES } from '../community/config.js';
import { MAX_COMMENT, MAX_NAME } from '../community/moderation.js';

export const COMMUNITY_JS = '/js/community.js?v=2';   // change the number whenever community.js changes
const assets = () => html`<link rel="stylesheet" href="${COMMUNITY_CSS}"><link rel="stylesheet" href="${CARD_FONTS_CSS}" crossorigin>`;

// Facebook, Messenger and Instagram open links inside their own browser, where installing the app and notifications
// may not work. We can't force them to open Chrome or Safari, so we offer a button (Android) and clear steps.
export function inAppBrowser(request) {
  const ua = String(request.headers.get('User-Agent') || '');
  if (!/FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|Messenger/i.test(ua)) return '';
  return /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other';
}

function browserHelp(request) {
  const kind = inAppBrowser(request);
  const url = new URL(request.url);
  const intent = `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
  return html`<section class="nwc-fbhelp" data-nwc-fbhelp${kind ? '' : raw(' hidden')} aria-label="Opening in your phone’s browser">
<h2>You’re in Facebook’s browser</h2>
<p>You can read, react and comment here. To <strong>install our app</strong> or <strong>turn on notifications</strong>, open this page in your phone’s own browser:</p>
<div data-nwc-fb-android${kind === 'ios' ? raw(' hidden') : ''}>
<a class="btn-gold-pill press" href="${intent}" rel="external">Open in Chrome</a>
<p class="nwc-small">If nothing happens, tap the <strong>⋮</strong> menu at the top right, then <strong>Open in external browser</strong> (or <strong>Open in Chrome</strong>).</p>
</div>
<div data-nwc-fb-ios${kind === 'ios' ? '' : raw(' hidden')}>
<p class="nwc-small">On iPhone: tap the <strong>•••</strong> menu (or the share button), then <strong>Open in external browser</strong> or <strong>Open in Safari</strong>.</p>
</div>
</section>`;
}

function welcome(request, compact = false) {
  return html`<section class="nwc-welcome card-blue" aria-labelledby="nwc-welcome-h">
<h2 id="nwc-welcome-h">${compact ? 'Stay in touch with New Way’s' : 'Welcome to New Way’s Community'}</h2>
${compact ? '' : html`<p>After each Wednesday evening we share a thank-you card for our guest medium. Add your thanks, react and leave a friendly comment. No account or sign-in needed.</p>`}
<div class="nwc-welcome-actions">
<button type="button" class="home-btn home-install press" data-install-app hidden><span class="orb" aria-hidden="true">${icon('install', 26)}</span><span class="home-btn-text"><span class="home-btn-label">Install Our App</span><span class="home-btn-sub">Add New Way’s to your phone</span></span>${icon('chev', 22, 'icon-gold')}</button>
<button type="button" class="home-btn press" data-nwc-notify hidden><span class="orb" aria-hidden="true">${icon('megaphone', 26)}</span><span class="home-btn-text"><span class="home-btn-label" data-nwc-notify-label>Enable Wednesday Notifications</span><span class="home-btn-sub" data-nwc-notify-sub>Hear when a new thank-you card is shared</span></span>${icon('chev', 22, 'icon-gold')}</button>
</div>
<p class="nwc-small" data-nwc-notify-status role="status"></p>
<p class="nwc-small" data-nwc-ios-help hidden>On iPhone, notifications work once New Way’s is on your Home Screen: in Safari tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, open New Way’s from your Home Screen, and tap Enable Wednesday Notifications there.</p>
</section>
${browserHelp(request)}`;
}

const reactionLabel = { like: ['👍', 'Like'], love: ['❤️', 'Love'], thanks: ['🙏', 'Thank You'] };

// ---------- the Community page ----------
export function listBody({ posts, request, state }) {
  return html`${assets()}
${state === 'testing' ? html`<p class="nwc-testing">Testing: New Way’s Community isn’t launched yet.</p>` : ''}
${welcome(request)}
<h2 class="nwc-section-h">Thank-you cards</h2>
${posts.length ? html`<ul class="nwc-list">${posts.map((p, i) => html`<li class="nwc-list-item">
<a class="nwc-list-link" href="${postPath(p)}" rel="external">${postCard(p, { priority: i === 0, uid: 'l' + p.id })}
<span class="nwc-list-title">${p.title}</span></a>
<p class="nwc-list-meta">${isIsoDate(p.wed_date) ? longDate(p.wed_date) + ' · ' : ''}${p.reaction_count} reaction${p.reaction_count === 1 ? '' : 's'} · ${p.comment_count} comment${p.comment_count === 1 ? '' : 's'}</p>
</li>`)}</ul>` : html`<p>The first thank-you card will appear here soon.</p>`}
<script src="${COMMUNITY_JS}" defer></script>`;
}

// ---------- one card ----------
function commentHtml(c, { reply = false, open = true } = {}) {
  const official = c.official && OFFICIAL_NAMES[c.official];
  const body = official ? linkify(c.body) : html`${c.body}`;
  return html`<li class="nwc-comment${official ? ' nwc-comment-official' : ''}${reply ? ' nwc-reply' : ''}" id="c${c.id}" data-comment="${c.id}"${reply ? html` data-parent="${c.parent_id}"` : ''}>
${reply && c.replyToName ? html`<p class="nwc-replyto">↪ replying to ${c.replyToName}</p>` : ''}<p class="nwc-comment-head">${official ? html`<span class="nwc-official">${official} <span class="nwc-tick" aria-label="verified New Way’s Admin">✓</span></span>` : html`<span class="nwc-name">${c.name}</span>`}
<span class="nwc-when">${friendlyDateTime(c.created_at)}</span></p>
<p class="nwc-comment-text">${body}</p>
${open ? html`<div class="nwc-comment-actions">
<button type="button" class="nwc-act" data-like="${c.id}" aria-pressed="false"><span aria-hidden="true">♡</span> Like <span data-like-count>${c.like_count || ''}</span></button>
<button type="button" class="nwc-act" data-reply="${c.id}" data-reply-name="${official || c.name}" hidden>Reply</button>
${official ? '' : html`<button type="button" class="nwc-act nwc-act-quiet" data-report="${c.id}" hidden>Report</button>`}
</div>` : (c.like_count ? html`<p class="nwc-small">♡ ${c.like_count}</p>` : '')}
${!reply && c.replies && c.replies.length ? html`<ul class="nwc-replies">${c.replies.map((r) => commentHtml(r, { reply: true, open }))}</ul>` : ''}
</li>`;
}

// For live updates: one comment (a new comment or reply), and the whole conversation (catching up), made exactly as
// on the page so that everything is escaped the same way on the server
export function renderComment(c, replyToName = '') {
  return commentHtml({ ...c, replyToName }, { reply: !!c.parent_id, open: true });
}
export function renderConversation(extra) {
  return extra.comments.length ? html`<ul class="nwc-comment-list" data-nwc-list>${extra.comments.map((c) => commentHtml(c, { open: true }))}</ul>` : html`<p class="nwc-empty" data-nwc-empty>Be the first to leave a thank-you message.</p>`;
}

// Only verified Admin comments may contain clickable links (to the centre's own pages or official sites)
function linkify(text) {
  const parts = String(text).split(/(https:\/\/[^\s<>"]{3,300})/g);
  return html`${parts.map((p, i) => (i % 2 ? html`<a href="${p}" rel="noopener" target="_blank">${p}</a>` : p))}`;
}

export function postBody({ post, request, state, extra, turnstile, stamp, form = null, live = 'normal' }) {
  const open = state !== 'off' && !!extra;
  const params = new URL(request.url).searchParams;
  const notice = form ? form.message : params.has('posted') ? 'Thank you, your comment has been posted.' : params.has('held') ? 'Thank you. Your comment will appear once it has been checked.' : '';
  return html`${assets()}
${state === 'testing' ? html`<p class="nwc-testing">Testing: New Way’s Community isn’t launched yet.</p>` : ''}
<article class="nwc-post" data-nwc-post="${post.id}">
${postCard(post, { priority: true })}
${isIsoDate(post.wed_date) ? html`<p class="nwc-meta">${longDate(post.wed_date)}</p>` : ''}
${open ? html`<div class="nwc-reactions" role="group" aria-label="React to this card">
${['like', 'love', 'thanks'].map((k) => html`<button type="button" class="nwc-react press" data-react="${k}" aria-pressed="false"><span aria-hidden="true">${reactionLabel[k][0]}</span> ${reactionLabel[k][1]} <span class="nwc-count" data-react-count="${k}">${extra.counts[k] || ''}</span></button>`)}
</div>
<p class="nwc-small nwc-center"><a href="/community" rel="external">See all thank-you cards</a></p>` : ''}
</article>
${open ? html`${welcome(request, true)}
<section class="nwc-comments" id="comments" aria-labelledby="nwc-comments-h" data-nwc-live="${post.id}" data-nwc-v="${post.live_version || 0}" data-nwc-live-state="${live}">
<h2 id="nwc-comments-h" class="nwc-section-h">Comments<span data-nwc-total>${extra.total ? ` (${extra.total})` : ''}</span></h2>
<div class="nwc-live-bar" data-nwc-live-bar hidden><span class="nwc-live-dot" aria-hidden="true"></span> <span data-nwc-live-text role="status">Live: new comments appear automatically</span> <button type="button" class="nwc-act" data-nwc-refresh hidden>Refresh comments</button></div>
<div data-nwc-conversation>${renderConversation(extra)}</div>
${turnstile ? html`<form class="nwc-form card-blue" id="comment-form" method="post" action="/community/${post.id}/comment" data-nwc-form novalidate>
<h3 data-nwc-form-title>Leave a comment</h3>
<p class="nwc-replying" data-nwc-replying hidden>Replying to <strong data-nwc-replying-name></strong> <button type="button" class="nwc-act" data-nwc-cancel-reply>Cancel</button></p>
<input type="hidden" name="parent" value="${form && form.parent ? form.parent : ''}" data-nwc-parent>
<input type="hidden" name="t" value="${stamp}">
<input type="hidden" name="vid" value="" data-nwc-vid>
<div class="nwc-hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="nwc-field"><label for="nwc-name">Your name</label><input type="text" id="nwc-name" name="name" maxlength="${MAX_NAME}" autocomplete="given-name" required value="${form ? form.name : ''}"></div>
<div class="nwc-field"><label for="nwc-text">Your comment</label><textarea id="nwc-text" name="text" rows="4" maxlength="${MAX_COMMENT}" required>${form ? form.text : ''}</textarea>
<p class="nwc-small"><span data-nwc-left>${MAX_COMMENT}</span> characters left. Please keep it friendly: no links, adverts or selling.</p></div>
<div class="cf-turnstile" data-sitekey="${turnstile.siteKey}" data-action="community" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>
<p class="nwc-message${form && !form.ok ? ' nwc-message-error' : ''}" data-nwc-message role="alert"${notice ? '' : raw(' hidden')}>${notice}</p>
<button type="submit" class="btn-gold-pill press" data-nwc-submit>Post comment</button>
<p class="nwc-small">Comments are checked automatically, and some are read by Gary or Julie before they appear. Your name is shown with your comment. See our <a href="/privacy">Privacy Notice</a>.</p>
</form>` : html`<p class="nwc-small">Comments are closed at the moment.</p>`}
</section>
<script src="${COMMUNITY_JS}" defer></script>` : ''}`;
}
