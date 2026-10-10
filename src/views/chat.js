// The live chat page for visitors (navy and gold, like the rest of the site). It works without scripts (send, then
// the page reloads); with scripts, new replies appear by themselves every few seconds.
import { html, raw } from '../lib/html.js';
import { page } from './layout.js';

const ukTime = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', ' ');

function bubble(m) {
  return html`<li class="chat-msg chat-${m.from}" data-id="${m.id}"><p class="chat-who">${m.from === 'you' ? 'You' : m.name || 'New Way’s'} · <time datetime="${m.at}">${ukTime(m.at)}</time></p><p class="chat-body">${m.body}</p></li>`;
}

export function chatPage(ctx, { settings, session, messages, stamp, siteKey, notice = '' }) {
  const contact = [ctx.settings.phone, ctx.settings.email].filter(Boolean).join(' or ');
  if (!settings.enabled) {
    const body = html`<section class="card-blue order-state"><h2 class="card-title">Live chat isn’t available at the moment</h2>
<p>${contact ? html`You can contact New Way’s on ${contact}.` : 'You can find our contact details on the Find Us page.'}</p>
<a class="btn-outline-gold press" href="/find-us">Find us</a></section>`;
    return page(ctx, { route: 'chat', title: 'Live Chat', body, mainClass: 'gap-26 booking-main', canonicalPath: '/chat', description: 'Chat with New Way’s.' });
  }
  const body = html`<section class="card-gold chat-card" aria-labelledby="chat-title" data-chat data-after="${messages.length ? messages[messages.length - 1].id : 0}">
<div class="chat-head"><h2 class="book-title" id="chat-title">Chat with ${settings.chat_staff_name}</h2>
<p class="chat-status ${settings.online ? 'is-online' : 'is-away'}" data-chat-status><span class="chat-dot" aria-hidden="true"></span><span data-chat-status-text>${settings.online ? 'Online now' : 'Away just now'}</span></p></div>
<p class="small chat-intro">${settings.online ? settings.chat_welcome : settings.chat_away_message}</p>
<ol class="chat-list" data-chat-list aria-live="polite" aria-label="Messages">${messages.map(bubble)}</ol>
<span id="latest"></span>
${session && session.status === 'blocked' ? html`<p class="notice-bad" role="alert">This conversation has been closed.${contact ? ` Please contact New Way’s on ${contact}.` : ''}</p>`
    : html`<form method="post" action="/chat/send" class="share-form chat-form" novalidate data-chat-form>
${notice ? html`<p class="notice-bad" role="alert">${notice}</p>` : ''}
<p class="notice-bad" role="alert" data-chat-error hidden></p>
<input type="hidden" name="t" value="${stamp}">
<div class="trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
${session ? '' : html`<div class="form-field"><label for="chat-name">Your first name <span class="small">(optional)</span></label><input id="chat-name" name="name" type="text" maxlength="60" autocomplete="given-name"></div>`}
<div class="form-field"><label for="chat-body">${session ? 'Your message' : 'How can we help?'}</label><textarea id="chat-body" name="body" rows="3" maxlength="1000" required></textarea></div>
${siteKey ? html`<div class="cf-turnstile" data-sitekey="${siteKey}" data-action="chat" data-theme="dark" data-script="https://challenges.cloudflare.com/turnstile/v0/api.js"></div>` : ''}
<button class="btn-gold press" type="submit">Send</button>
</form>`}
<p class="small">No email or phone number needed. Please don’t share private details here. Your conversation is kept in this browser so you can come back to it, and deleted ${settings.retentionDays} days after the last message. See our <a href="/privacy">Privacy Notice</a>.</p>
</section>`;
  return page(ctx, { route: 'chat', title: 'Live Chat', body, mainClass: 'gap-26 booking-main', canonicalPath: '/chat', description: 'Chat with New Way’s.' });
}

export { raw };
