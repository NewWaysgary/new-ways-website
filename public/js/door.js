/* New Way’s Admin: the Wednesday door till, for Gary’s and Julie’s phones.
   - Tap a button to add it to the sale; tap again for more. Undo takes back the last tap; Clear empties the sale.
   - CASH or CARD shows the full itemised grand total first. Nothing is recorded until “Cash received ✓” or
     “Card payment taken ✓” is pressed. The server works out the prices again itself, and records each sale once only,
     even if the button is pressed twice or the signal drops and it is sent again.
   - The sale in progress is kept if the page is refreshed (on this phone only).
   - SCAN QR CODE opens an advance payment (Chrome on Android scans inside the page). */
(function () {
  'use strict';

  var money = function (p) { return '£' + (Number(p || 0) / 100).toFixed(2); };

  // ---------- live totals (every phone at the door shows the same numbers) ----------
  var totals = document.querySelector('[data-door-totals]');
  if (totals && window.fetch) {
    var refresh = function () {
      if (document.hidden) return;
      fetch(totals.getAttribute('data-door-totals'), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (t) {
          if (!t) return;
          var set = function (k, v) { var el = totals.querySelector('[data-k="' + k + '"]'); if (el) el.textContent = v; };
          set('service', String(t.service)); set('circle', String(t.circle)); set('raffle', String(t.raffle)); set('total', money(t.total));
        }).catch(function () {});
    };
    setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
  }

  // ---------- the till ----------
  var till = document.querySelector('[data-till]');
  if (till) {
    var date = till.getAttribute('data-date');
    var KEY = 'nw-till-' + date;
    var state = { lines: [], history: [], ref: null, method: null };
    try { var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved && Array.isArray(saved.lines)) state = { lines: saved.lines, history: saved.history || [], ref: null, method: null }; } catch (e) { /* not available */ }
    var save = function () { try { sessionStorage.setItem(KEY, JSON.stringify({ lines: state.lines, history: state.history })); } catch (e) { /* not available */ } };

    var linesEl = till.querySelector('[data-lines]');
    var totalEl = till.querySelector('[data-total]');
    var undoBtn = till.querySelector('[data-undo]');
    var clearBtn = till.querySelector('[data-clear]');
    var payBtns = till.querySelectorAll('[data-pay]');
    var message = till.querySelector('[data-message]');
    var confirmPanel = till.querySelector('[data-confirm-panel]');
    var customPanel = till.querySelector('[data-custom-panel]');
    var customInput = customPanel ? customPanel.querySelector('input') : null;
    var customItem = null;
    var busy = false;

    var total = function () { return state.lines.reduce(function (n, l) { return n + l.unit * l.qty; }, 0); };
    var say = function (text, bad) { message.textContent = text || ''; message.className = 'till-message' + (bad ? ' is-bad' : text ? ' is-good' : ''); };
    var lineKey = function (id, unit, custom) { return custom ? id + ':' + unit : String(id); };

    function render() {
      linesEl.innerHTML = '';
      if (!state.lines.length) {
        var li = document.createElement('li'); li.className = 'hint'; li.textContent = 'Tap the buttons above. Tap again for more.'; linesEl.appendChild(li);
      }
      state.lines.forEach(function (l) {
        var li = document.createElement('li');
        var text = document.createElement('span');
        text.textContent = l.qty + ' × ' + l.label + (l.custom ? ' (' + money(l.unit) + ')' : '');
        var amt = document.createElement('strong'); amt.textContent = money(l.unit * l.qty);
        var minus = document.createElement('button'); minus.type = 'button'; minus.className = 'pill till-minus'; minus.textContent = '−';
        minus.setAttribute('aria-label', 'One less ' + l.label);
        minus.addEventListener('click', function () { change(l.key, -1); });
        li.appendChild(text); li.appendChild(amt); li.appendChild(minus);
        linesEl.appendChild(li);
      });
      totalEl.textContent = money(total());
      var empty = !state.lines.length;
      undoBtn.disabled = !state.history.length; clearBtn.disabled = empty;
      payBtns.forEach(function (b) { b.disabled = empty; });
      till.querySelectorAll('[data-item]').forEach(function (b) {
        var id = b.getAttribute('data-item');
        var n = state.lines.filter(function (l) { return String(l.item_id) === id; }).reduce(function (x, l) { return x + l.qty; }, 0);
        var c = b.querySelector('[data-count]'); c.hidden = !n; c.textContent = '× ' + n;
      });
      save();
    }

    function add(item, unit, custom) {
      var key = lineKey(item.id, unit, custom);
      var line = state.lines.find(function (l) { return l.key === key; });
      if (line) line.qty++;
      else state.lines.push({ key: key, item_id: Number(item.id), label: item.label, unit: unit, qty: 1, custom: custom });
      state.history.push(key);
      if (state.history.length > 200) state.history.shift();
      state.ref = null;
      say('');
      if (navigator.vibrate) navigator.vibrate(25);
      render();
    }

    function change(key, by) {
      var line = state.lines.find(function (l) { return l.key === key; });
      if (!line) return;
      line.qty += by;
      if (line.qty <= 0) state.lines = state.lines.filter(function (l) { return l !== line; });
      var i = state.history.lastIndexOf(key);
      if (by < 0 && i >= 0) state.history.splice(i, 1);
      state.ref = null;
      render();
    }

    till.querySelectorAll('[data-item]').forEach(function (b) {
      b.addEventListener('click', function () {
        var item = { id: b.getAttribute('data-item'), label: b.getAttribute('data-label') };
        if (b.getAttribute('data-custom') === '1') {
          customItem = item;
          customPanel.querySelector('[data-custom-label]').textContent = item.label;
          customPanel.hidden = false; customInput.value = ''; customInput.focus();
          return;
        }
        add(item, Number(b.getAttribute('data-price')), false);
      });
    });
    if (customPanel) {
      var addCustom = function () {
        var t = String(customInput.value || '').replace(/[£,\s]/g, '');
        if (!/^\d{1,3}(\.\d{1,2})?$/.test(t) || Number(t) <= 0 || Number(t) > 500) { say('Please type an amount like 4.50 (up to £500).', true); customInput.focus(); return; }
        add(customItem, Math.round(Number(t) * 100), true);
        customPanel.hidden = true;
      };
      customPanel.querySelector('[data-custom-add]').addEventListener('click', addCustom);
      customInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
      customPanel.querySelector('[data-custom-cancel]').addEventListener('click', function () { customPanel.hidden = true; });
    }
    undoBtn.addEventListener('click', function () { var key = state.history.pop(); if (key) { state.history.push(key); change(key, -1); } });
    clearBtn.addEventListener('click', function () {
      if (state.lines.length && !window.confirm('Clear this sale?')) return;
      state.lines = []; state.history = []; state.ref = null; say(''); render();
    });

    // ---------- CASH / CARD: show the itemised grand total first ----------
    function newRef() {
      var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    function showConfirm(method) {
      if (!state.lines.length) return;
      state.method = method;
      if (!state.ref) state.ref = newRef();   // the same reference is re-used if this sale has to be sent again
      var list = confirmPanel.querySelector('[data-confirm-lines]');
      list.innerHTML = '';
      state.lines.forEach(function (l) {
        var li = document.createElement('li');
        var t = document.createElement('span'); t.textContent = l.qty + ' × ' + l.label + (l.custom ? '' : ' @ ' + money(l.unit));
        var a = document.createElement('strong'); a.textContent = money(l.unit * l.qty);
        li.appendChild(t); li.appendChild(a); list.appendChild(li);
      });
      confirmPanel.querySelector('[data-confirm-total]').textContent = money(total());
      confirmPanel.querySelector('[data-confirm-title]').textContent = method === 'card' ? 'CARD: check the total' : 'CASH: check the total';
      confirmPanel.querySelector('[data-confirm-hint]').textContent = method === 'card'
        ? 'Take ' + money(total()) + ' on the card reader. When the card payment has gone through, press the button below.'
        : 'Take ' + money(total()) + ' in cash, then press the button below.';
      confirmPanel.querySelector('[data-confirm-pay]').textContent = method === 'card' ? 'Card payment taken ✓' : 'Cash received ✓';
      var pos = confirmPanel.querySelector('[data-pos-link]');
      var app = till.getAttribute('data-pos-app');
      if (pos) {
        pos.hidden = !(method === 'card' && app && /android/i.test(navigator.userAgent));
        if (!pos.hidden) {
          var callback = location.origin + '/admin/door/square-callback';
          pos.href = 'intent:#Intent;action=com.squareup.pos.action.CHARGE;package=com.squareup;' +
            'S.browser_fallback_url=' + encodeURIComponent(location.href) + ';' +
            'S.com.squareup.pos.WEB_CALLBACK_URI=' + encodeURIComponent(callback) + ';' +
            'S.com.squareup.pos.CLIENT_ID=' + encodeURIComponent(app) + ';' +
            'S.com.squareup.pos.API_VERSION=v2.0;i.com.squareup.pos.TOTAL_AMOUNT=' + total() + ';' +
            'S.com.squareup.pos.CURRENCY_CODE=GBP;S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD;end';
        }
      }
      confirmPanel.hidden = false;
      confirmPanel.focus();
      confirmPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    payBtns.forEach(function (b) { b.addEventListener('click', function () { showConfirm(b.getAttribute('data-pay')); }); });
    confirmPanel.querySelector('[data-confirm-back]').addEventListener('click', function () { confirmPanel.hidden = true; });

    confirmPanel.querySelector('[data-confirm-pay]').addEventListener('click', function () {
      if (busy || !state.lines.length) return;
      busy = true;
      var btn = this; btn.disabled = true;
      say('Recording the sale…');
      var fd = new FormData();
      fd.append('_csrf', till.getAttribute('data-csrf'));
      fd.append('date', date);
      fd.append('method', state.method);
      fd.append('client_ref', state.ref);
      fd.append('expected_total', String(total()));
      fd.append('lines', JSON.stringify(state.lines.map(function (l) { return { item_id: l.item_id, qty: l.qty, amount_pence: l.custom ? l.unit : undefined }; })));
      fetch('/admin/door/sale', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unexpected answer (' + r.status + '). Please check the signal and press the button again.' }; }); })
        .then(function (res) {
          busy = false; btn.disabled = false;
          if (!res.ok) { say(res.error || 'Not recorded. Please try again.', true); return; }
          say('RECORDED: ' + money(res.total) + ' ' + (state.method === 'card' ? 'card' : 'cash') + (res.repeat ? ' (it had already been recorded)' : ''));
          state.lines = []; state.history = []; state.ref = null;
          confirmPanel.hidden = true;
          render();
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          setTimeout(function () { location.replace('/admin/door?date=' + encodeURIComponent(date)); }, 1400);
        })
        .catch(function () {
          busy = false; btn.disabled = false;
          say('NOT RECORDED: no connection. Check the signal and press the button again (it will only be recorded once).', true);
        });
    });
    render();
  }

  // ---------- scanning an advance payment ----------
  var button = document.querySelector('[data-door-scan]');
  if (!button) return;
  var box = document.querySelector('.scan-box');
  var video = box && box.querySelector('video');
  var status = document.querySelector('.scan-status');
  var fallback = document.querySelector('.scan-fallback');
  var label = button.textContent;
  var stream = null, timer = null, detector = null, looking = false;
  var tell = function (t) { if (status) status.textContent = t; };
  function stop() {
    if (timer) clearTimeout(timer); timer = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null;
    if (box) box.hidden = true; button.textContent = label;
  }
  function look() {
    if (!stream || looking) return;
    looking = true;
    detector.detect(video).then(function (codes) {
      looking = false;
      for (var i = 0; i < codes.length; i++) {
        var text = String(codes[i].rawValue || '');
        var m = text.match(/\/w\/([A-Za-z0-9_-]{22})(?:[?#/]|$)/);
        if (m) { tell('Found a payment. Opening it…'); if (navigator.vibrate) navigator.vibrate(80); stop(); location.href = '/admin/door/w/' + m[1]; return; }
        if (/\/c\/[A-Za-z0-9_-]{22}/.test(text)) tell('That is an EVENT ticket. Use Check in for the event.');
        else tell('That QR code isn’t a New Way’s Wednesday payment.');
      }
      timer = setTimeout(look, 200);
    }).catch(function () { looking = false; timer = setTimeout(look, 400); });
  }
  button.addEventListener('click', function () {
    if (stream) { stop(); tell(''); return; }
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { if (fallback) fallback.hidden = false; return; }
    var ready = window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : Promise.resolve(['qr_code']);
    ready.then(function (formats) {
      if (formats.indexOf('qr_code') < 0) { if (fallback) fallback.hidden = false; return null; }
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      tell('Starting the camera…');
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    }).then(function (s) {
      if (!s) return;
      stream = s; video.srcObject = s; box.hidden = false; button.textContent = 'STOP SCANNING';
      return video.play().then(function () { tell('Point the camera at the QR code.'); look(); });
    }).catch(function (err) {
      stop();
      tell(err && err.name === 'NotAllowedError' ? 'The camera isn’t allowed. Allow the camera for this website in the browser’s settings.' : 'The camera couldn’t be started.');
    });
  });
  window.addEventListener('pagehide', stop);
})();
