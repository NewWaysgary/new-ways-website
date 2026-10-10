// Admin > Live chat screens (phone-first)
import { html, raw } from '../lib/html.js';
import { adminPage } from './admin.js';
import { friendlyDateTime } from '../lib/dates.js';

const hidden = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;
const FLASH = {
  available: ['ok', 'You are shown as ONLINE on the website until the time below.'], away: ['ok', 'Chat now shows as AWAY. Visitors can still leave messages.'],
  saved: ['ok', 'Chat settings saved.'], 'test-sent': ['ok', 'Test notification sent. It should appear on your phone within a few seconds.'],
  'test-failed': ['bad', 'The test notification could not be sent. Turn notifications on again on this phone.'], 'no-phone': ['bad', 'Notifications aren’t turned on for you on any phone yet.'],
  'push-removed': ['ok', 'That phone won’t get chat notifications any more.'], closed: ['ok', 'Conversation closed. It moves to Closed, and reopens if the visitor writes again.'],
  deleted: ['ok', 'Conversation deleted.'], gone: ['bad', 'That conversation no longer exists (conversations are deleted automatically after the set number of days).'],
  sent: ['ok', 'Reply sent. The visitor sees it on the chat page.'], empty: ['bad', 'Please type a reply.'], 'too-long': ['bad', 'Please keep replies under 2,000 characters.'],
  blocked: ['ok', 'Blocked: this visitor can’t send any more messages in this conversation.'], reopened: ['ok', 'Conversation reopened.']
};
const banner = (flash) => (FLASH[flash] ? html`<p class="banner ${FLASH[flash][0] === 'ok' ? 'banner-ok' : 'banner-error'}" role="status">${FLASH[flash][1]}</p>` : '');

export function chatListPage({ settings, list, filter, subs, me, vapidKey, csrf, flash }) {
  const mine = subs.filter((s) => s.who === me);
  return adminPage({
    title: 'Live chat', csrf, signedIn: true, scripts: ['/js/admin-chat.js'],
    body: html`${banner(flash)}
${!settings.enabled ? html`<p class="banner banner-error" role="alert"><strong>Live chat is switched OFF</strong>, so visitors don’t see the Chat button. Switch it on under Chat settings below when you’re ready.</p>` : ''}
<section class="panel chat-avail ${settings.online ? 'is-online' : ''}" aria-labelledby="av-h">
<h2 id="av-h">${settings.online ? 'You’re shown as ONLINE' : 'Chat shows as AWAY'}</h2>
<p class="hint">${settings.online ? `Visitors see “Online now” until ${friendlyDateTime(settings.chat_available_until)}.` : 'Visitors see “Away just now” and can leave a message. They see your reply when they come back to the chat page in the same browser.'}</p>
<form method="post" action="/admin/chat/available" class="row-actions">${hidden(csrf)}
${[1, 2, 4, 8].map((h) => html`<button class="pill pill-gold" type="submit" name="hours" value="${h}">Online for ${h} ${h === 1 ? 'hour' : 'hours'}</button>`)}
${settings.online ? html`<button class="pill" type="submit" name="hours" value="0">Set to away now</button>` : ''}</form>
</section>
<section class="panel" aria-labelledby="pn-h" data-push data-key="${vapidKey}" data-csrf="${csrf}">
<h2 id="pn-h">Notifications on this phone</h2>
<p class="hint">Get a notification on this phone when a visitor sends a message. In Chrome on Android, tap the button and choose Allow. For the most reliable notifications, also add Admin to your home screen (Chrome menu → Add to Home screen).</p>
<p class="hint" data-push-state aria-live="polite"></p>
<div class="row-actions"><button type="button" class="btn-gold" data-push-on>Turn on notifications on this phone</button></div>
${mine.length ? html`<form method="post" action="/admin/chat/push/test" class="spaced">${hidden(csrf)}<button class="pill pill-gold" type="submit">Send a test notification to my phone</button></form>` : ''}
${subs.length ? html`<details class="help"><summary>Phones with notifications on (${subs.length})</summary><ul class="todo">${subs.map((s) => html`<li>${s.label || s.who} · on since ${friendlyDateTime(s.created_at)}${s.last_ok_at ? ' · last delivered ' + friendlyDateTime(s.last_ok_at) : ''}${s.last_error ? ' · problem: ' + s.last_error : ''}
<form method="post" action="/admin/chat/push/${s.id}/remove">${hidden(csrf)}<button class="pill" type="submit">Turn off</button></form></li>`)}</ul></details>` : ''}
</section>
<nav class="tabs" aria-label="Conversations"><a class="tab-link${filter === 'open' ? ' is-current' : ''}" href="/admin/chat">Open</a><a class="tab-link${filter === 'closed' ? ' is-current' : ''}" href="/admin/chat?show=closed">Closed</a></nav>
${list.length ? html`<ul class="rows" data-chat-list-poll>${list.map((s) => html`<li class="row-card${s.staff_unread ? ' chat-unread' : ''}"><a class="row-text plain-link" href="/admin/chat/${s.id}">
<span class="row-title">${s.visitor_name || 'Visitor'} · ${friendlyDateTime(s.last_message_at)}</span>
<span class="row-line">${s.last_sender === 'staff' ? 'You: ' : ''}${String(s.last_body || '').slice(0, 120)}</span>
${s.staff_unread ? html`<span class="chips"><span class="chip chip-attention">${s.staff_unread} new</span></span>` : ''}${s.status === 'blocked' ? html`<span class="chips"><span class="chip chip-hidden">Blocked</span></span>` : ''}</a></li>`)}</ul>`
      : html`<p class="panel">${filter === 'open' ? 'No open conversations.' : 'No closed conversations.'}</p>`}
<form method="post" action="/admin/chat/settings" class="panel admin-form">${hidden(csrf)}
<h2>Chat settings</h2>
<label class="field-check"><input type="checkbox" name="chat_enabled" value="1"${settings.enabled ? raw(' checked') : ''}> Show the Chat button on the website</label>
<div class="field"><label for="cs-name">Name shown on replies</label><input id="cs-name" name="chat_staff_name" type="text" maxlength="40" value="${settings.chat_staff_name}"><p class="hint">For example “New Way’s” or “Julie at New Way’s”. No personal contact details are ever shown.</p></div>
<div class="field"><label for="cs-welcome">Welcome message (when online)</label><textarea id="cs-welcome" name="chat_welcome" rows="2" maxlength="400">${settings.chat_welcome}</textarea></div>
<div class="field"><label for="cs-away">Message when away</label><textarea id="cs-away" name="chat_away_message" rows="3" maxlength="400">${settings.chat_away_message}</textarea></div>
<div class="field"><label for="cs-days">Delete conversations this many days after the last message</label><input id="cs-days" name="chat_retention_days" type="text" inputmode="numeric" value="${settings.retentionDays}"><p class="hint">Between 7 and 365. The Privacy Notice shows this automatically.</p></div>
<button class="btn-gold" type="submit">Save chat settings</button></form>`
  });
}

export function conversationPage({ session, messages, settings, csrf, flash }) {
  const act = (a, label, cls = 'pill', confirm = '') => html`<form method="post" action="/admin/chat/${session.id}/${a}">${hidden(csrf)}<button class="${cls}" type="submit"${confirm ? html` data-confirm="${confirm}"` : ''}>${label}</button></form>`;
  return adminPage({
    title: session.visitor_name ? `Chat with ${session.visitor_name}` : 'Chat with a visitor', csrf, signedIn: true, scripts: ['/js/admin-chat.js'],
    body: html`<p><a class="link" href="/admin/chat">All conversations</a></p>
${banner(flash)}
<p class="hint">Started ${friendlyDateTime(session.created_at)}. The visitor gave no contact details${session.visitor_name ? ' (only a first name)' : ''}, so they see your reply when they come back to the chat page.</p>
<ol class="chat-thread" data-thread="/admin/chat/${session.id}/messages" data-after="${messages.length ? messages[messages.length - 1].id : 0}" aria-live="polite">
${messages.map((m) => html`<li class="chat-line chat-line-${m.sender}" data-id="${m.id}"><p class="chat-line-who">${m.sender === 'visitor' ? session.visitor_name || 'Visitor' : m.staff_name || 'New Way’s'} · ${friendlyDateTime(m.created_at)}</p><p class="chat-line-body">${m.body}</p></li>`)}
</ol>
${session.status === 'blocked' ? html`<p class="banner banner-error">This visitor is blocked.</p>` : html`<form method="post" action="/admin/chat/${session.id}/reply" class="panel admin-form" data-reply>${hidden(csrf)}
<div class="field"><label for="r-body">Your reply</label><textarea id="r-body" name="body" rows="3" maxlength="2000"></textarea></div>
<label class="field-check"><input type="checkbox" name="as_me" value="1"> Sign it with my own first name instead of “${settings.chat_staff_name}”</label>
<button class="btn-gold" type="submit">Send reply</button></form>`}
<div class="row-actions">${session.status === 'open' ? act('close', 'Close conversation') : act('reopen', 'Reopen')}
${session.status !== 'blocked' ? act('block', 'Block this visitor', 'pill pill-danger', 'Block this visitor? They won’t be able to send more messages in this conversation.') : ''}
${act('delete', 'Delete conversation', 'pill pill-danger', 'Delete this conversation for good?')}</div>`
  });
}
