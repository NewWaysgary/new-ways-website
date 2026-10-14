/* New Way's Admin › View Live Comments: the conversation updates itself while this screen is open.
   A live connection (Admin sign-in checked by the website) says "something changed"; the page then fetches the
   fresh conversation and changes only what is different, so nothing jumps and the official comment box is never
   touched. If the live connection can't be made, it checks every 15 seconds while the screen is on.
   Hide, Delete, Approve, Reject and official comments are sent without leaving the page. */
(function () {
  'use strict';
  var box = document.querySelector('[data-nwc-admin-live]');
  if (!box) return;
  var id = box.getAttribute('data-nwc-admin-live');
  var text = box.querySelector('[data-nwc-live-text]');
  var ws = null, fails = 0, timer = null, pinger = null, polling = false, last = 0, pending = null, busy = false;

  function status(mode, words) { box.setAttribute('data-mode', mode); if (text) text.textContent = words; }

  /* ---------- fetching and fitting in the fresh conversation ---------- */
  function refresh() {
    if (pending) return;
    var wait = Math.max(300, 1500 - (Date.now() - last));
    pending = setTimeout(function () {
      pending = null;
      if (busy) { refresh(); return; }
      busy = true; last = Date.now();
      fetch('/admin/community/' + id + '/view?part=live', { credentials: 'same-origin', headers: { Accept: 'text/html' } })
        .then(function (r) { if (r.status === 401 || r.status === 403) { status('offline', 'Please sign in again to keep following.'); throw new Error('signed out'); } return r.text(); })
        .then(function (html) { busy = false; fit(html); })
        .catch(function () { busy = false; });
    }, wait);
  }
  function keepPlace(fn) {
    var anchor = document.activeElement && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName) ? document.activeElement : null;
    if (!anchor) {
      var items = document.querySelectorAll('[data-nwc-admin-region] [data-comment], [data-nwc-official-form], [data-review]');
      for (var i = 0; i < items.length; i++) { if (items[i].getBoundingClientRect().bottom > 0) { anchor = items[i]; break; } }
    }
    var before = anchor ? anchor.getBoundingClientRect().top : 0;
    fn();
    if (anchor && document.contains(anchor)) {
      var moved = anchor.getBoundingClientRect().top - before;
      if (Math.abs(moved) > 1) window.scrollBy(0, moved);
    }
  }
  function sameItem(a, b) { return a.outerHTML.replace(/\snwc-new/g, '') === b.outerHTML.replace(/\snwc-new/g, ''); }
  // Change a list to match the fresh one, item by item (by comment number), leaving unchanged items alone
  function fitList(have, fresh, key) {
    var freshItems = Array.prototype.filter.call(fresh.children, function (n) { return n.hasAttribute(key); });
    var want = {};
    freshItems.forEach(function (n) { want[n.getAttribute(key)] = n; });
    Array.prototype.slice.call(have.children).forEach(function (n) { if (n.hasAttribute(key) && !want[n.getAttribute(key)]) have.removeChild(n); });
    var prev = null;
    freshItems.forEach(function (n) {
      var k = n.getAttribute(key);
      var mine = null;
      for (var i = 0; i < have.children.length; i++) if (have.children[i].getAttribute(key) === k) mine = have.children[i];
      var copy = document.importNode(n, true);
      if (!mine) copy.classList.add('nwc-new');
      else if (sameItem(mine, n)) { prev = mine; return; }
      else { have.replaceChild(copy, mine); prev = copy; return; }
      if (prev && prev.nextSibling) have.insertBefore(copy, prev.nextSibling);
      else if (!prev) have.insertBefore(copy, have.firstChild);
      else have.appendChild(copy);
      prev = copy;
    });
  }
  function fit(html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    var fresh = t.content.querySelector('[data-nwc-admin-region]');
    var mine = document.querySelector('[data-nwc-admin-region]');
    if (!fresh || !mine) return;
    keepPlace(function () {
      // counts line and the review section are small: replaced whole when they differ
      var fc = fresh.querySelector('[data-nwc-admin-counts]'), mc = mine.querySelector('[data-nwc-admin-counts]');
      if (fc && mc && fc.textContent !== mc.textContent) mc.textContent = fc.textContent;
      var fr = fresh.querySelector('#review'), mr = mine.querySelector('#review');
      if (fr && mr) { var a = mr.querySelector('.nwc-comment-list'), b = fr.querySelector('.nwc-comment-list'); mr.querySelector('h2').textContent = fr.querySelector('h2').textContent; if (a && b) fitList(a, b, 'data-review'); }
      else if (fr && !mr) mine.insertBefore(document.importNode(fr, true), mine.querySelector('#conversation'));
      else if (!fr && mr) mr.parentNode.removeChild(mr);
      var fl = fresh.querySelector('[data-nwc-admin-list]'), ml = mine.querySelector('[data-nwc-admin-list]');
      var conv = mine.querySelector('#conversation');
      if (fl && ml) fitList(ml, fl, 'data-comment');
      else if (conv) conv.parentNode.replaceChild(document.importNode(fresh.querySelector('#conversation'), true), conv);
    });
  }

  /* ---------- the live connection ---------- */
  function connect() {
    if (ws || document.hidden || box.getAttribute('data-ready') !== '1') return;
    clearTimeout(timer);
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/admin/community/' + id + '/live-socket'); }
    catch (e) { retry(false); return; }
    var opened = false, me = ws;
    ws.onopen = function () {
      opened = true; fails = 0; polling = false;
      status('normal', 'Live: new comments appear automatically');
      clearInterval(pinger);
      pinger = setInterval(function () { if (me.readyState === 1) { try { me.send('ping'); } catch (e) { /* closing */ } } }, 40000);
    };
    ws.onmessage = function (e) { if (e.data !== 'pong') refresh(); };   // "hello" (catch up) or "changed"
    ws.onclose = function () {
      clearInterval(pinger);
      if (ws === me) ws = null;
      if (document.hidden) return;
      retry(opened);
    };
  }
  function retry(wasOpen) {
    if (!wasOpen) fails++;
    if (fails >= 3) { poll(); return; }
    status('connecting', 'Reconnecting…');
    clearTimeout(timer);
    timer = setTimeout(connect, [2000, 5000, 10000][Math.min(fails, 2)]);
  }
  function poll() {
    polling = true;
    status('fallback', 'Checking for new comments every 15 seconds');
    clearTimeout(timer);
    var n = 0;
    var tick = function () {
      if (!document.hidden) refresh();
      if (++n % 20 === 0) { fails = 2; connect(); }   // every 5 minutes, try live again
      timer = setTimeout(tick, 15000);
    };
    timer = setTimeout(tick, 15000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    refresh();
    if (!ws && !polling) { fails = 0; connect(); }
  });
  if (box.getAttribute('data-ready') === '1' && 'WebSocket' in window) connect(); else poll();

  /* ---------- Hide, Delete, Approve, Reject without leaving the page ---------- */
  document.addEventListener('submit', function (e) {
    var form = e.target.closest && e.target.closest('form[data-nwc-ajax]');
    if (!form || e.defaultPrevented) return;
    e.preventDefault();
    var fd = new FormData(form); fd.append('ajax', '1');
    Array.prototype.forEach.call(form.querySelectorAll('button'), function (b) { b.disabled = true; });
    fetch(form.getAttribute('action'), { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok || (r.headers.get('Content-Type') || '').indexOf('json') < 0) throw new Error('not done'); refresh(); })
      .catch(function () { form.submit(); });   // fall back to an ordinary page load
  });

  /* ---------- official comments and replies ---------- */
  var oform = document.querySelector('[data-nwc-official-form]');
  function replyTo(cid, name) {
    if (!oform) return;
    oform.querySelector('[data-nwc-official-parent]').value = cid || '';
    var r = oform.querySelector('[data-nwc-official-replying]');
    r.hidden = !cid;
    oform.querySelector('[data-nwc-official-name]').textContent = name || '';
    var title = document.querySelector('[data-nwc-official-title]');
    if (title) title.textContent = cid ? 'Official reply' : 'Official comment';
    oform.querySelector('[data-nwc-official-submit]').textContent = cid ? 'Post official reply' : 'Post official comment';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-nwc-admin-reply]');
    if (b && oform) {
      e.preventDefault();
      replyTo(b.getAttribute('data-nwc-admin-reply'), b.getAttribute('data-name'));
      oform.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { oform.querySelector('textarea').focus(); }, 300);
      return;
    }
    if (e.target.closest && e.target.closest('[data-nwc-official-cancel]') && oform) { e.preventDefault(); replyTo('', ''); }
  });
  if (oform) oform.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = oform.querySelector('[data-nwc-official-msg]');
    var btn = oform.querySelector('[data-nwc-official-submit]');
    var area = oform.querySelector('textarea');
    if (!area.value.trim()) { msg.textContent = 'Please write your comment first.'; msg.hidden = false; area.focus(); return; }
    btn.disabled = true;
    fetch(oform.getAttribute('action'), { method: 'POST', body: new FormData(oform), credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if ((r.headers.get('Content-Type') || '').indexOf('json') < 0) throw new Error('page'); return r.json(); })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) throw new Error('not posted');
        area.value = ''; replyTo('', '');
        msg.textContent = r.message; msg.hidden = false;
        refresh();
      })
      .catch(function () { btn.disabled = false; HTMLFormElement.prototype.submit.call(oform); });   // shows the reason on a normal page
  });

  /* ---------- switching card ---------- */
  var pick = document.querySelector('[data-nwc-card-pick]');
  if (pick) pick.addEventListener('change', function () { location.href = '/admin/community/' + pick.value + '/view'; });
})();
