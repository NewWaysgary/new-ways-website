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
    liveStart();
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
      if (r.ok && r.status === 'published') {
        // Shown straight away (and to everyone else watching, through live comments); no page reload
        form.querySelector('[name="text"]').value = ''; count(form.querySelector('textarea')); cancelReply();
        show(r.message, false);
        if (r.html) liveOwn(r);
        else location.href = location.pathname + '?posted=' + Date.now() + '#c' + r.id;
        return;
      }
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

  /* ---------- live comments ----------
     One connection per open card page (to Cloudflare's Durable Object). New comments and replies are sent to the
     phone as they happen, so it never has to keep asking. The connection is only used while the page is open; when
     the phone comes back to the page it reconnects and catches up. If it can't connect, it checks gently instead
     (every minute or so, only while the page is on screen). Nothing here ever touches the comment box. */
  var live = null;
  var BAR = {
    connecting: 'Connecting to live comments…',
    normal: 'Live: new comments appear automatically',
    reduced: 'Live: new comments may take a few seconds longer (busy)',
    fallback: 'New comments are checked every minute or so',
    paused: 'Live updates are paused for now. Tap Refresh comments to see the latest.',
    off: 'Tap Refresh comments to see the latest.',
    offline: 'No connection. New comments will appear when you’re back online.'
  };
  function liveBar(mode, text) {
    if (!live) return;
    var bar = live.box.querySelector('[data-nwc-live-bar]');
    if (!bar) return;
    bar.hidden = false;
    bar.setAttribute('data-mode', mode);
    bar.querySelector('[data-nwc-live-text]').textContent = text || BAR[mode] || '';
    bar.querySelector('[data-nwc-refresh]').hidden = !(mode === 'paused' || mode === 'off' || mode === 'fallback');
  }
  function liveStop() {
    if (!live) return;
    live.stopped = true;
    clearTimeout(live.timer); clearInterval(live.pinger);
    if (live.ws) { try { live.ws.close(1000); } catch (e) { /* closed */ } }
    live = null;
  }
  function liveStart() {
    var box = document.querySelector('#page [data-nwc-live]');
    if (live && box && live.box === box) return;
    liveStop();
    if (!box) return;
    live = { id: box.getAttribute('data-nwc-live'), v: Number(box.getAttribute('data-nwc-v')) || 0, box: box, ws: null, fails: 0, opened: false,
      mode: box.getAttribute('data-nwc-live-state') || 'normal', fallback: 60, timer: null, pinger: null, stopped: false, polling: false, lastManual: 0 };
    if (live.mode === 'paused' || live.mode === 'off') { liveBar(live.mode); return; }
    if (!('WebSocket' in window)) { liveFallback(); return; }
    liveConnect();
  }
  function liveConnect() {
    var L = live;
    if (!L || L.stopped || L.ws || document.hidden) return;
    clearTimeout(L.timer);
    if (!navigator.onLine) { liveBar('offline'); return; }
    if (!L.polling) liveBar('connecting');
    var ws;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/community/' + L.id + '/socket'); }
    catch (e) { liveRetry(L, false); return; }
    L.ws = ws; L.opened = false;
    ws.onopen = function () {
      L.opened = true; L.fails = 0; L.polling = false;
      clearInterval(L.pinger);
      L.pinger = setInterval(function () { if (ws.readyState === 1) { try { ws.send('ping'); } catch (e) { /* closing */ } } }, 40000);
    };
    ws.onmessage = function (e) {
      if (e.data === 'pong' || live !== L) return;
      var m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'hello') { L.mode = m.mode || 'normal'; L.fallback = m.fallback || 60; liveBar(L.mode === 'reduced' ? 'reduced' : 'normal'); if (m.v !== L.v) liveCatchUp('catchup'); }
      else if (m.t === 'ev') liveApply(m.list || []);
    };
    ws.onclose = function (e) {
      clearInterval(L.pinger);
      if (L.ws === ws) L.ws = null;
      if (L.stopped || live !== L) return;
      if (e.code === 4004) { liveGone(); return; }
      if (document.hidden) return;              // reconnects when the page is looked at again
      liveRetry(L, L.opened);
    };
  }
  function liveRetry(L, wasOpen) {
    if (!wasOpen) L.fails++;
    if (L.fails >= 3) {
      // It isn't connecting: find out why (paused, or just this network) and check gently instead
      liveCatchUp('catchup').then(function (r) {
        if (!r || live !== L) return;
        if (r.mode === 'paused' || r.mode === 'off') { L.mode = r.mode; liveBar(r.mode); return; }
        liveFallback();
      });
      return;
    }
    var waits = [2, 5, 10, 20, 40, 60];
    var wait = waits[Math.min(L.fails, waits.length - 1)] * 1000;
    if (L.mode === 'reduced') wait = Math.max(wait, 30000);
    clearTimeout(L.timer);
    L.timer = setTimeout(liveConnect, wait + Math.random() * wait * 0.3);
  }
  function liveFallback() {
    var L = live;
    if (!L || L.stopped) return;
    L.polling = true;
    liveBar('fallback');
    clearTimeout(L.timer);
    var tick = function () {
      if (live !== L || L.stopped) return;
      if (document.hidden) { L.timer = setTimeout(tick, 15000); return; }
      liveCatchUp('fallback').then(function (r) {
        if (live !== L) return;
        if (r && (r.mode === 'paused' || r.mode === 'off')) { L.polling = false; L.mode = r.mode; liveBar(r.mode); return; }
        // every five minutes, try live again
        L.sinceTry = (L.sinceTry || 0) + L.fallback;
        if ('WebSocket' in window && L.sinceTry >= 300) { L.sinceTry = 0; L.fails = 2; liveConnect(); }
        L.timer = setTimeout(tick, (L.fallback || 60) * 1000);
      });
    };
    L.timer = setTimeout(tick, (L.fallback || 60) * 1000);
  }
  function liveCatchUp(why) {
    var L = live;
    if (!L) return Promise.resolve(null);
    return fetch('/community/' + L.id + '/live?v=' + L.v + '&why=' + why, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (r.status === 404) { liveGone(); return null; } return r.json(); })
      .then(function (r) {
        if (!r || live !== L) return r;
        if (r.fallback) L.fallback = r.fallback;
        if (r.html !== undefined) liveSnapshot(r);
        return r;
      }).catch(function () { return null; });
  }

  // Keeps what the reader is looking at (or typing in) exactly where it is while comments are added or removed
  function keepPlace(fn) {
    var anchor = document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName) ? document.activeElement : null;
    if (!anchor) {
      var items = document.querySelectorAll('#page [data-comment], #page [data-nwc-form]');
      for (var i = 0; i < items.length; i++) { if (items[i].getBoundingClientRect().bottom > 0) { anchor = items[i]; break; } }
    }
    var before = anchor ? anchor.getBoundingClientRect().top : 0;
    fn();
    if (anchor && document.contains(anchor)) {
      var moved = anchor.getBoundingClientRect().top - before;
      if (Math.abs(moved) > 1) window.scrollBy(0, moved);
    }
  }
  function fromHtml(text) { var t = document.createElement('template'); t.innerHTML = text; return t.content; }
  function prepare(node) {
    var liked = store('nwc-liked') || {};
    Array.prototype.forEach.call(node.querySelectorAll('[data-reply], [data-report]'), function (b) { b.hidden = false; });
    Array.prototype.forEach.call(node.querySelectorAll('[data-like]'), function (b) { if (liked[b.getAttribute('data-like')]) b.setAttribute('aria-pressed', 'true'); });
  }
  function listEl(create) {
    var conv = live && live.box.querySelector('[data-nwc-conversation]');
    if (!conv) return null;
    var list = conv.querySelector('[data-nwc-list]');
    if (!list && create) {
      conv.textContent = '';
      list = document.createElement('ul'); list.className = 'nwc-comment-list'; list.setAttribute('data-nwc-list', '');
      conv.appendChild(list);
    }
    return list;
  }
  function insertSorted(ul, node) {
    var id = Number(node.getAttribute('data-comment'));
    var kids = ul.children;
    for (var i = 0; i < kids.length; i++) { if (Number(kids[i].getAttribute('data-comment')) > id) { ul.insertBefore(node, kids[i]); return; } }
    ul.appendChild(node);
  }
  // Puts one comment (or reply, under the right conversation) in its place. false = its conversation isn't here yet.
  function placeComment(node, highlight) {
    var id = node.getAttribute('data-comment');
    if (document.getElementById('c' + id)) return true;
    var parent = node.getAttribute('data-parent');
    prepare(node);
    if (highlight) node.classList.add('nwc-new');
    if (parent) {
      var top = document.getElementById('c' + parent);
      if (!top) return false;
      var ul = null;
      for (var i = 0; i < top.children.length; i++) if (top.children[i].classList.contains('nwc-replies')) ul = top.children[i];
      if (!ul) { ul = document.createElement('ul'); ul.className = 'nwc-replies'; top.appendChild(ul); }
      insertSorted(ul, node);
    } else insertSorted(listEl(true), node);
    return true;
  }
  function refreshTotal() {
    if (!live) return;
    var n = live.box.querySelectorAll('[data-nwc-conversation] [data-comment]').length;
    var t = live.box.querySelector('[data-nwc-total]');
    if (t) t.textContent = n ? ' (' + n + ')' : '';
    var list = listEl(false);
    if (list && !list.children.length) {
      var conv = live.box.querySelector('[data-nwc-conversation]');
      conv.textContent = '';
      var p = document.createElement('p'); p.className = 'nwc-empty'; p.setAttribute('data-nwc-empty', ''); p.textContent = 'Be the first to leave a thank-you message.';
      conv.appendChild(p);
    }
  }
  function removeComments(ids) {
    ids.forEach(function (id) {
      var el = document.getElementById('c' + id);
      if (!el) return;
      var form = document.querySelector('#page [data-nwc-form]');
      var parentField = form && form.querySelector('[data-nwc-parent]');
      if (parentField && parentField.value && (parentField.value === String(id) || el.querySelector('#c' + parentField.value))) {
        cancelReply();
        var msg = form.querySelector('[data-nwc-message]');
        if (msg) { msg.textContent = 'The comment you were replying to has been removed. Your words are still in the box.'; msg.hidden = false; }
      }
      el.parentNode.removeChild(el);
    });
  }
  function setCounts(counts) {
    ['like', 'love', 'thanks'].forEach(function (k) { var c = document.querySelector('#page [data-react-count="' + k + '"]'); if (c) c.textContent = counts[k] || ''; });
  }
  function liveApply(list) {
    var L = live, need = false;
    keepPlace(function () {
      for (var i = 0; i < list.length; i++) {
        var ev = list[i];
        if (ev.op === 'counts') { setCounts(ev.counts || {}); continue; }
        if (ev.op === 'likes') { var el = document.getElementById('c' + ev.id); var n = el && el.querySelector('[data-like-count]'); if (n) n.textContent = ev.likes || ''; continue; }
        if (ev.op === 'gone') { liveGone(); return; }
        if (!ev.v || ev.v <= L.v) continue;            // already have it
        if (ev.v > L.v + 1) { need = true; break; }      // missed something: fetch the conversation
        if (ev.op === 'add') { if (!placeComment(fromHtml(ev.html).firstElementChild, true)) { need = true; break; } }
        else if (ev.op === 'remove') removeComments(ev.ids || []);
        else if (ev.op === 'reload') { need = true; break; }
        L.v = ev.v;
      }
      refreshTotal();
    });
    if (need) liveCatchUp('catchup');
  }
  // The whole published conversation (after catching up): add what's missing, remove what's gone, update the likes
  function liveSnapshot(r) {
    var L = live;
    var frag = fromHtml(r.html);
    var fresh = frag.querySelectorAll('[data-comment]');
    var keep = {};
    Array.prototype.forEach.call(fresh, function (n) { keep[n.getAttribute('data-comment')] = n; });
    keepPlace(function () {
      var have = live.box.querySelectorAll('[data-nwc-conversation] [data-comment]');
      var gone = [];
      Array.prototype.forEach.call(have, function (n) { if (!keep[n.getAttribute('data-comment')]) gone.push(n.getAttribute('data-comment')); });
      removeComments(gone);
      Array.prototype.forEach.call(fresh, function (n) {
        var id = n.getAttribute('data-comment');
        var mine = document.getElementById('c' + id);
        if (!mine) {
          var copy = n.cloneNode(true);
          var nested = copy.querySelector('.nwc-replies');
          if (nested) nested.parentNode.removeChild(nested);   // replies are placed one by one, below
          placeComment(copy, true);
        } else {
          var a = mine.querySelector('[data-like-count]'), b = n.querySelector('[data-like-count]');
          if (a && b) a.textContent = b.textContent;
        }
      });
      refreshTotal();
    });
    if (r.counts) setCounts(r.counts);
    if (typeof r.v === 'number') L.v = r.v;
  }
  // The visitor's own new comment: shown at once, with no extra request
  function liveOwn(r) {
    if (!live) return;
    keepPlace(function () { placeComment(fromHtml(r.html).firstElementChild, true); refreshTotal(); });
    if (r.v === live.v + 1) live.v = r.v; else if (r.v > live.v) liveCatchUp('catchup');
  }
  function liveGone() {
    if (!live) return;
    var L = live;
    liveStop();
    var conv = L.box.querySelector('[data-nwc-conversation]');
    var bar = L.box.querySelector('[data-nwc-live-bar]');
    if (bar) bar.hidden = true;
    if (conv) { conv.textContent = ''; var p = document.createElement('p'); p.className = 'nwc-gone'; p.textContent = 'This card is no longer available.'; conv.appendChild(p); }
    var form = L.box.querySelector('[data-nwc-form]'); if (form) form.hidden = true;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-nwc-refresh]');
    if (!b || !live) return;
    if (Date.now() - live.lastManual < 10000) return;
    live.lastManual = Date.now();
    b.disabled = true;
    liveCatchUp('manual').then(function (r) {
      b.disabled = false;
      if (r && r.mode === 'paused' && live && live.mode !== 'paused') liveBar('paused');
      if (!r) liveBar(live ? live.mode : 'off', 'Couldn’t check just now. Please try again in a moment, or reload the page.');
    });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !live || live.stopped) return;
    if (live.mode === 'paused' || live.mode === 'off') return;
    if (live.polling) { liveCatchUp('fallback'); return; }
    if (!live.ws) { live.fails = 0; liveConnect(); }
  });
  window.addEventListener('online', function () { if (live && !live.ws && !live.polling && live.mode !== 'paused' && live.mode !== 'off') { live.fails = 0; liveConnect(); } });
  window.addEventListener('pagehide', function (e) { if (e.persisted) liveStop(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) liveStart(); });

  init();
  document.addEventListener('nw:page-changed', init);
})();
