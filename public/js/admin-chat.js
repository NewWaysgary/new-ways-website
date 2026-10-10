/* New Way’s Admin: live chat.
   - "Turn on notifications on this phone": registers the site’s service worker and subscribes with the browser’s own
     push service (free; Chrome on Android uses Google’s). The server can then send a notification for new messages.
   - In a conversation, new visitor messages appear by themselves every few seconds. */
(function () {
  'use strict';

  // ---------- notifications ----------
  var box = document.querySelector('[data-push]');
  if (box) {
    var state = box.querySelector('[data-push-state]');
    var btn = box.querySelector('[data-push-on]');
    var say = function (t) { state.textContent = t; };
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    var toKey = function (b64) {
      var pad = '='.repeat((4 - (b64.length % 4)) % 4);
      var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    };
    if (!supported) { say('This browser can’t show website notifications. On Android, use Google Chrome.'); btn.hidden = true; }
    else {
      navigator.serviceWorker.register('/sw.js').then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        if (sub && Notification.permission === 'granted') { say('Notifications are ON for this phone.'); btn.textContent = 'Refresh notifications on this phone'; }
        else if (Notification.permission === 'denied') say('Notifications are blocked for this website. In Chrome: tap the padlock (or ⋮ → Settings → Site settings → Notifications) and allow this site, then try again.');
        else say('Notifications are OFF for this phone.');
      }).catch(function () {});
      btn.addEventListener('click', function () {
        btn.disabled = true; say('Asking…');
        Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') throw new Error('denied');
          return navigator.serviceWorker.register('/sw.js');
        }).then(function () { return navigator.serviceWorker.ready; })
          .then(function (reg) {
            return reg.pushManager.getSubscription().then(function (old) {
              return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(box.getAttribute('data-key')) });
            });
          })
          .then(function (sub) {
            var fd = new FormData();
            fd.append('_csrf', box.getAttribute('data-csrf'));
            fd.append('subscription', JSON.stringify(sub));
            fd.append('label', (/android/i.test(navigator.userAgent) ? 'Android' : 'Phone or computer') + ', ' + new Date().toLocaleDateString('en-GB'));
            return fetch('/admin/chat/push/subscribe', { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json(); });
          })
          .then(function (res) {
            btn.disabled = false;
            if (res && res.ok) { say('Notifications are ON for this phone. Use “Send a test notification” to check.'); setTimeout(function () { location.reload(); }, 1500); }
            else say((res && res.error) || 'That didn’t work. Please try again.');
          })
          .catch(function (err) {
            btn.disabled = false;
            say(err && err.message === 'denied' ? 'Notifications weren’t allowed. Allow notifications for this website in Chrome’s settings, then try again.' : 'That didn’t work on this phone. Please try again in Chrome.');
          });
      });
    }
  }

  // ---------- a conversation: show new messages as they arrive ----------
  var thread = document.querySelector('[data-thread]');
  if (thread && window.fetch) {
    var after = Number(thread.getAttribute('data-after')) || 0;
    var fmt = function (iso) { try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)); } catch (e) { return ''; } };
    var who = document.querySelector('h1') ? document.querySelector('h1').textContent.replace(/^Chat with /, '') : 'Visitor';
    var poll = function () {
      if (document.hidden) { setTimeout(poll, 15000); return; }
      fetch(thread.getAttribute('data-thread') + '?after=' + after, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          (d && d.messages || []).forEach(function (m) {
            if (thread.querySelector('[data-id="' + m.id + '"]')) return;
            var li = document.createElement('li'); li.className = 'chat-line chat-line-' + m.from; li.setAttribute('data-id', m.id);
            var w = document.createElement('p'); w.className = 'chat-line-who'; w.textContent = (m.from === 'visitor' ? (who === 'a visitor' ? 'Visitor' : who) : (m.name || 'New Way’s')) + ' · ' + fmt(m.at);
            var b = document.createElement('p'); b.className = 'chat-line-body'; b.textContent = m.body;
            li.appendChild(w); li.appendChild(b); thread.appendChild(li);
            after = Math.max(after, m.id);
            li.scrollIntoView({ block: 'nearest' });
          });
        }).catch(function () {})
        .then(function () { setTimeout(poll, 5000); });
    };
    setTimeout(poll, 5000);
    if (thread.lastElementChild) thread.lastElementChild.scrollIntoView({ block: 'nearest' });
  }

  // ---------- the list: refresh when new messages arrive ----------
  var listPoll = document.querySelector('[data-push]') && document.querySelector('.tabs');
  if (listPoll && window.fetch) {
    var seen = null;
    setInterval(function () {
      if (document.hidden) return;
      fetch('/admin/chat/unread', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return;
        if (seen !== null && d.unread > seen && !document.querySelector('form [name="chat_staff_name"]:focus, textarea:focus')) location.reload();
        seen = d.unread;
      }).catch(function () {});
    }, 15000);
  }
})();
