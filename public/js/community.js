/* New Way's Community (public pages): reactions, comments and replies, comment likes, reporting, Wednesday
   notifications and help for visitors inside Facebook's own browser. No accounts, no cookies. A random code kept on this
   phone (localStorage) lets the website recognise "the same visitor" for one reaction each and fair reporting.
   Everything is checked again on the server. */
(function () {
  'use strict';
  if (window.__nwcCommunity) return;
  window.__nwcCommunity = true;

  function store(key, value) { try { if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(value)); } catch (e) { return null; } return value; }
  function visitorCode() {
    var v = store('nwc-vid');
    if (typeof v === 'string' && /^[A-Za-z0-9_-]{24}$/.test(v)) return v;
    var bytes = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    v = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_');
    store('nwc-vid', v);
    return v;
  }
  function post(url, data, asForm) {
    var opts = { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (asForm) { opts.body = new URLSearchParams(data); opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else { opts.body = JSON.stringify(data); opts.headers['Content-Type'] = 'application/json'; }
    return fetch(url, opts).then(function (r) { return r.json().catch(function () { return { ok: false, message: 'Something went wrong. Please try again.' }; }); })
      .catch(function () { return { ok: false, message: 'No connection. Please check your signal and try again.' }; });
  }
  function postId() { var a = document.querySelector('#page [data-nwc-post]'); return a ? a.getAttribute('data-nwc-post') : ''; }
  var inApp = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|Messenger/i.test(navigator.userAgent);
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  /* ---------- set up whatever is on the page (also after moving between pages in the app) ---------- */
  function init() {
    var id = postId();
    var vid = visitorCode();
    Array.prototype.forEach.call(document.querySelectorAll('#page [data-nwc-vid]'), function (i) { i.value = vid; });
    Array.prototype.forEach.call(document.querySelectorAll('#page [data-reply], #page [data-report]'), function (b) { b.hidden = false; });
    var mine = store('nwc-reacted') || {};
    if (id && mine[id]) Array.prototype.forEach.call(document.querySelectorAll('#page [data-react]'), function (b) { b.setAttribute('aria-pressed', mine[id][b.getAttribute('data-react')] ? 'true' : 'false'); });
    var liked = store('nwc-liked') || {};
    Array.prototype.forEach.call(document.querySelectorAll('#page [data-like]'), function (b) { if (liked[b.getAttribute('data-like')]) b.setAttribute('aria-pressed', 'true'); });
    var help = document.querySelector('#page [data-nwc-fbhelp]');
    if (help && inApp) {
      help.hidden = false;
      var a = help.querySelector('[data-nwc-fb-android]'), i = help.querySelector('[data-nwc-fb-ios]');
      if (a) a.hidden = isIOS; if (i) i.hidden = !isIOS;
    }
    var text = document.querySelector('#page [data-nwc-form] textarea');
    if (text) count(text);
    notifyInit();
  }

  function count(text) {
    var left = document.querySelector('#page [data-nwc-left]');
    if (left) left.textContent = String(Math.max(0, Number(text.getAttribute('maxlength')) - text.value.length));
  }
  document.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('#page [data-nwc-form] textarea')) count(e.target); });

  /* ---------- reactions, likes, replies, reports ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null;
    if (!t) return;
    var react = t.closest('[data-react]');
    if (react) {
      var id = postId(), kind = react.getAttribute('data-react');
      react.disabled = true;
      post('/community/' + id + '/react', { kind: kind, vid: visitorCode() }).then(function (r) {
        react.disabled = false;
        if (!r.ok) { window.alert(r.message || 'Please try again.'); return; }
        ['like', 'love', 'thanks'].forEach(function (k) { var c = document.querySelector('#page [data-react-count="' + k + '"]'); if (c) c.textContent = r.counts[k] || ''; });
        react.setAttribute('aria-pressed', r.on ? 'true' : 'false');
        var mine = store('nwc-reacted') || {}; mine[id] = mine[id] || {}; mine[id][kind] = r.on; store('nwc-reacted', mine);
      });
      return;
    }
    var like = t.closest('[data-like]');
    if (like) {
      var cid = like.getAttribute('data-like');
      like.disabled = true;
      post('/community/comment/' + cid + '/like', { vid: visitorCode() }).then(function (r) {
        like.disabled = false;
        if (!r.ok) { window.alert(r.message || 'Please try again.'); return; }
        var n = like.querySelector('[data-like-count]'); if (n) n.textContent = r.likes || '';
        like.setAttribute('aria-pressed', r.on ? 'true' : 'false');
        var liked = store('nwc-liked') || {}; liked[cid] = r.on; store('nwc-liked', liked);
      });
      return;
    }
    var reply = t.closest('[data-reply]');
    if (reply) {
      var form = document.querySelector('#page [data-nwc-form]');
      if (!form) return;
      form.querySelector('[data-nwc-parent]').value = reply.getAttribute('data-reply');
      form.querySelector('[data-nwc-replying-name]').textContent = reply.getAttribute('data-reply-name');
      form.querySelector('[data-nwc-replying]').hidden = false;
      form.querySelector('[data-nwc-form-title]').textContent = 'Write a reply';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { form.querySelector('textarea').focus(); }, 300);
      return;
    }
    if (t.closest('[data-nwc-cancel-reply]')) { cancelReply(); return; }
    var rep = t.closest('[data-report]');
    if (rep) {
      if (!window.confirm('Report this comment to Gary and Julie as inappropriate?')) return;
      rep.disabled = true;
      post('/community/comment/' + rep.getAttribute('data-report') + '/report', { vid: visitorCode() }).then(function (r) {
        rep.textContent = r.ok ? 'Reported' : 'Report';
        rep.disabled = !!r.ok;
        if (r.message) window.alert(r.message);
      });
    }
  });
  function cancelReply() {
    var form = document.querySelector('#page [data-nwc-form]');
    if (!form) return;
    form.querySelector('[data-nwc-parent]').value = '';
    form.querySelector('[data-nwc-replying]').hidden = true;
    form.querySelector('[data-nwc-form-title]').textContent = 'Leave a comment';
  }

  /* ---------- posting a comment: the wording is never lost if it can't be posted ---------- */
  document.addEventListener('submit', function (e) {
    var form = e.target.closest && e.target.closest('[data-nwc-form]');
    if (!form) return;
    e.preventDefault();
    var msg = form.querySelector('[data-nwc-message]');
    var btn = form.querySelector('[data-nwc-submit]');
    var show = function (text, error) { msg.textContent = text; msg.hidden = !text; msg.classList.toggle('nwc-message-error', !!error); };
    var name = form.querySelector('[name="name"]').value.trim(), text = form.querySelector('[name="text"]').value.trim();
    if (!name) { show('Please enter your name (or a first name).', true); form.querySelector('[name="name"]').focus(); return; }
    if (!text) { show('Please write your comment before posting.', true); form.querySelector('[name="text"]').focus(); return; }
    form.querySelector('[data-nwc-vid]').value = visitorCode();
    var data = {};
    new FormData(form).forEach(function (v, k) { if (typeof v === 'string') data[k] = v; });
    btn.disabled = true; btn.textContent = 'Posting…';
    post(form.getAttribute('action'), data, true).then(function (r) {
      btn.disabled = false; btn.textContent = 'Post comment';
      if (window.turnstile) { try { window.turnstile.reset(form.querySelector('.cf-turnstile')); } catch (err) { /* a new check appears */ } }
      if (r.ok && r.status === 'published') { location.href = location.pathname + '?posted=' + Date.now() + '#c' + r.id; return; }
      if (r.ok) { show(r.message, false); form.querySelector('[name="text"]').value = ''; count(form.querySelector('textarea')); cancelReply(); return; }
      show(r.message || 'Sorry, that could not be posted. Please try again.', true);   // their wording stays in the box
    });
  });

  /* ---------- Wednesday notifications (asked only when the visitor taps the button) ---------- */
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  function notifyUi(on, status) {
    var b = document.querySelector('#page [data-nwc-notify]');
    if (!b) return;
    b.setAttribute('data-on', on ? '1' : '0');
    b.querySelector('[data-nwc-notify-label]').textContent = on ? 'Wednesday Notifications are on' : 'Enable Wednesday Notifications';
    b.querySelector('[data-nwc-notify-sub]').textContent = on ? 'Tap to turn them off' : 'Hear when a new thank-you card is shared';
    var s = document.querySelector('#page [data-nwc-notify-status]');
    if (s && status !== undefined) s.textContent = status;
  }
  function notifyInit() {
    var b = document.querySelector('#page [data-nwc-notify]');
    if (!b) return;
    var iosHelp = document.querySelector('#page [data-nwc-ios-help]');
    if (inApp) { b.hidden = true; return; }
    if (isIOS && !standalone) { b.hidden = true; if (iosHelp) iosHelp.hidden = false; return; }
    if (!supported) { b.hidden = true; var s = document.querySelector('#page [data-nwc-notify-status]'); if (s) s.textContent = 'This browser can’t show notifications. Try Chrome on Android, or the New Way’s app on iPhone.'; return; }
    b.hidden = false;
    notifyUi(false);
    if (Notification.permission === 'granted') {
      navigator.serviceWorker.getRegistration('/').then(function (reg) { return reg && reg.pushManager.getSubscription(); }).then(function (sub) {
        if (!sub) return;
        post('/community/push/status', { endpoint: sub.endpoint }).then(function (r) { if (r.ok) notifyUi(!!r.subscribed); });
      }).catch(function () {});
    }
  }
  function toKey(b64) {
    var pad = '='.repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-nwc-notify]');
    if (!b || !supported) return;
    b.disabled = true;
    var done = function () { b.disabled = false; };
    if (b.getAttribute('data-on') === '1') {
      // Turn off: only this list forgets the phone (Admin chat notifications on the same phone keep working)
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        return post('/community/push/unsubscribe', { endpoint: sub ? sub.endpoint : '' });
      }).then(function (r) { notifyUi(false, r.message || ''); done(); }).catch(function () { done(); });
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { notifyUi(false, 'Notifications are blocked for this website. You can allow them in your browser’s site settings.'); done(); return; }
      return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
        return fetch('/community/push/key', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (k) {
          if (!k.ok) throw new Error('no key');
          return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(k.key) }); });
        });
      }).then(function (sub) {
        return post('/community/push/subscribe', { subscription: sub.toJSON() });
      }).then(function (r) { notifyUi(!!(r && r.ok), r && r.message ? r.message : ''); done(); });
    }).catch(function () { notifyUi(false, 'Sorry, notifications could not be turned on. Please try again.'); done(); });
  });

  init();
  document.addEventListener('nw:page-changed', init);
})();
