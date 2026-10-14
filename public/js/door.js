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
  // "Tonight so far, by item": rebuilt from the figures (as text only) whenever the totals are checked
  function cell(tag, text, attrs) { var c = document.createElement(tag); c.textContent = text; if (attrs) for (var k in attrs) c.setAttribute(k, attrs[k]); return c; }
  function itemRow(label, qty, cash, card, total, cls) {
    var tr = document.createElement('tr'); if (cls) tr.className = cls;
    tr.appendChild(cell('th', label, { scope: 'row' })); tr.appendChild(cell('td', qty)); tr.appendChild(cell('td', cash)); tr.appendChild(cell('td', card)); tr.appendChild(cell('td', total));
    return tr;
  }
  function showItems(t) {
    var box = document.querySelector('[data-door-items]');
    if (!box || !t.items) return;
    var body = box.querySelector('[data-items-body]'), foot = box.querySelector('[data-items-foot]');
    body.textContent = ''; foot.textContent = '';
    if (!t.items.length) { var tr = document.createElement('tr'); tr.appendChild(cell('td', 'No sales yet.', { colspan: '5', 'class': 'hint' })); body.appendChild(tr); }
    t.items.forEach(function (it) { body.appendChild(itemRow(it.label, String(it.qty), money(it.cash), money(it.card), money(it.total))); });
    if (t.online) foot.appendChild(itemRow('Paid in advance online (' + t.onlineOrders + ')', '', '', '', money(t.online), 'till-items-online'));
    foot.appendChild(itemRow('Total', '', money(t.cash), money(t.card), money(t.total), 'till-items-total'));
    var sum = box.querySelector('[data-items-total]'); if (sum) sum.textContent = money(t.total);
  }
  var refresh = function () {};
  if (totals && window.fetch) {
    refresh = function () {
      if (document.hidden) return;
      fetch(totals.getAttribute('data-door-totals'), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (t) {
          if (!t) return;
          var set = function (k, v) { var el = totals.querySelector('[data-k="' + k + '"]'); if (el) el.textContent = v; };
          set('service', String(t.service)); set('circle', String(t.circle)); set('raffle', String(t.raffle)); set('total', money(t.total));
          showItems(t);
        }).catch(function () {});
    };
    setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
  }

  // ---------- till button names: a long word (such as DEVELOPMENT) is made smaller until it fits its button ----------
  // Only names that don't fit change size; the others keep the normal size. Checked again when the font arrives and
  // when the phone is turned.
  function fitTillLabels() {
    Array.prototype.forEach.call(document.querySelectorAll('.till-label'), function (l) {
      l.style.fontSize = '';
      l.style.overflowWrap = 'normal';
      var range = document.createRange();
      range.selectNodeContents(l);
      // the widest line of text, measured exactly (to a fraction of a pixel), with 1px to spare
      var tooWide = function () { return range.getBoundingClientRect().width > l.getBoundingClientRect().width - 1; };
      var size = parseFloat(window.getComputedStyle(l).fontSize) || 20;
      while (tooWide() && size > 12) { size -= 0.5; l.style.fontSize = size + 'px'; }
      l.style.overflowWrap = '';
    });
  }
  if (document.querySelector('.till-label')) {
    fitTillLabels();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTillLabels);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', fitTillLabels);
    var fitTimer = null;
    window.addEventListener('resize', function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitTillLabels, 100); });
  }

  // ---------- the till ----------
  var till = document.querySelector('[data-till]');
  if (till) {
    var date = till.getAttribute('data-date');
    var KEY = 'nw-till-' + date;
    var state = { lines: [], history: [], ref: null, method: null };
    try { var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved && Array.isArray(saved.lines)) state = { lines: saved.lines, history: saved.history || [], ref: saved.ref || null, method: null }; } catch (e) { /* not available */ }
    var save = function () { try { sessionStorage.setItem(KEY, JSON.stringify({ lines: state.lines, history: state.history, ref: state.ref })); } catch (e) { /* not available */ } };

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
    function newHex() { return newRef(); }
    // ---------- payments taken in the Square app: picked up automatically when Square confirms them ----------
    var PENDING = 'nw-till-card-' + date;
    var pendingTimer = null;
    function pendingCard() { try { return JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch (e) { return null; } }
    function setPending(p) { try { if (p) sessionStorage.setItem(PENDING, JSON.stringify(p)); else sessionStorage.removeItem(PENDING); } catch (e) { /* not available */ } }
    function checkPending() {
      var p = pendingCard();
      if (!p || document.hidden) return;
      clearTimeout(pendingTimer);
      fetch('/admin/door/card/status?ref=' + encodeURIComponent(p.ref), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) { setPending(null); return; }
          if (res.status === 'paid' || (res.status === 'unverified' && res.saleId)) {
            setPending(null);
            // only the sale that was paid is cleared (never a different one started since)
            if (state.ref === res.clientRef) { state.lines = []; state.history = []; state.ref = null; save(); }
            confirmPanel.hidden = true;
            render();
            say((res.status === 'paid' ? 'PAYMENT SUCCESSFUL: ' : 'RECORDED: ') + money(res.total) + ' card' + (res.status === 'paid' ? ', confirmed by Square.' : '.'));
            if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
            setTimeout(function () { location.replace('/admin/door?date=' + encodeURIComponent(date)); }, 2000);
            return;
          }
          if (res.status === 'waiting') {
            say('Waiting for Square… If the Square app is still showing its Thank You screen, it comes back by itself in a few seconds (or tap New Sale there). Nothing is recorded until Square confirms the payment.');
            pendingTimer = setTimeout(checkPending, 3000);
            return;
          }
          if (res.status === 'checking') { say('CHECKING WITH SQUARE… Nothing is recorded until Square confirms the payment.'); pendingTimer = setTimeout(checkPending, 2000); return; }
          setPending(null);
          if (res.status === 'unverified') { say('NOT CONFIRMED: ' + res.detail + ' Open the card payment page to record it after checking the Square app.', true); showCardLink(res.ref); return; }
          say((res.status === 'duplicate' ? 'ALREADY RECORDED: ' : 'NOT PAID: ') + (res.detail || 'the card payment did not go through.') + (res.status === 'duplicate' ? '' : ' The sale is still here: try again or take cash.'), true);
        })
        .catch(function () { pendingTimer = setTimeout(checkPending, 4000); });
    }
    function showCardLink(ref) {
      var a = document.createElement('a'); a.className = 'pill pill-gold'; a.href = '/admin/door/card?ref=' + encodeURIComponent(ref); a.textContent = 'Open the card payment';
      message.appendChild(document.createTextNode(' ')); message.appendChild(a);
    }
    document.addEventListener('visibilitychange', checkPending);
    window.addEventListener('pageshow', checkPending);
    window.addEventListener('focus', checkPending);
    confirmPanel.addEventListener('click', function (e) {
      var link = e.target.closest && e.target.closest('[data-pos-link]');
      if (!link) return;
      if (!link.getAttribute('href') || link.getAttribute('aria-disabled')) { e.preventDefault(); return; }
      setPending({ ref: link.getAttribute('data-card-ref'), at: Date.now() });
      say('Opening the Square app… The till will record the sale by itself when Square confirms the payment.');
    });

    function showConfirm(method) {
      if (!state.lines.length) return;
      state.method = method;
      if (!state.ref) { state.ref = newRef(); save(); }   // the same reference is re-used if this sale has to be sent again
      var list = confirmPanel.querySelector('[data-confirm-lines]');
      list.innerHTML = '';
      state.lines.forEach(function (l) {
        var li = document.createElement('li');
        var t = document.createElement('span'); t.textContent = l.qty + ' × ' + l.label + (l.custom ? '' : ' @ ' + money(l.unit));
        var a = document.createElement('strong'); a.textContent = money(l.unit * l.qty);
        li.appendChild(t); li.appendChild(a); list.appendChild(li);
      });
      confirmPanel.querySelector('[data-confirm-total]').textContent = money(total());
      // Cash: optional "cash given", and the change to give back
      if (changeBox) { changeBox.hidden = method !== 'cash'; givenInput.value = ''; showChange(); }
      confirmPanel.querySelector('[data-confirm-title]').textContent = method === 'card' ? 'CARD: check the total' : 'CASH: check the total';
      var withApp = method === 'card' && till.getAttribute('data-pos-app') && /android/i.test(navigator.userAgent);
      confirmPanel.querySelector('[data-confirm-hint]').textContent = method === 'card'
        ? (withApp ? 'Press “Open the Square app” to take ' + money(total()) + '. When Square confirms the payment, the sale is recorded by itself (no need to press anything else). “Card payment taken ✓” is only for a card payment taken WITHOUT the app.'
          : 'Take ' + money(total()) + ' on the card reader. When the card payment has gone through, press the button below.')
        : 'Take ' + money(total()) + ' in cash, then press the button below.';
      confirmPanel.querySelector('[data-confirm-pay]').textContent = method === 'card' ? 'Card payment taken ✓' : 'Cash received ✓';
      var pos = confirmPanel.querySelector('[data-pos-link]');
      var app = till.getAttribute('data-pos-app');
      if (pos) {
        pos.hidden = !(method === 'card' && app && /android/i.test(navigator.userAgent));
        pos.removeAttribute('href');
        pos.setAttribute('aria-disabled', 'true');
        if (!pos.hidden) {
          // The sale is registered (and priced) on the server FIRST; only then can the Square app be opened
          pos.textContent = 'Getting ready…';
          var cardRef = newHex();
          var fd0 = new FormData();
          fd0.append('_csrf', till.getAttribute('data-csrf'));
          fd0.append('date', date);
          fd0.append('ref', cardRef);
          fd0.append('client_ref', state.ref);
          fd0.append('expected_total', String(total()));
          fd0.append('lines', JSON.stringify(state.lines.map(function (l) { return { item_id: l.item_id, qty: l.qty, amount_pence: l.custom ? l.unit : undefined }; })));
          fetch('/admin/door/card/start', { method: 'POST', body: fd0, credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (!res.ok) { pos.textContent = 'Open the Square app to take this payment'; say(res.error || 'The Square app can’t be used for this sale just now.', true); return; }
              var callback = location.origin + '/admin/door/square-callback';
              var loc = till.getAttribute('data-pos-location');
              pos.href = 'intent:#Intent;action=com.squareup.pos.action.CHARGE;package=com.squareup;' +
                'S.browser_fallback_url=' + encodeURIComponent(location.href) + ';' +
                'S.com.squareup.pos.WEB_CALLBACK_URI=' + encodeURIComponent(callback) + ';' +
                'S.com.squareup.pos.CLIENT_ID=' + encodeURIComponent(app) + ';' +
                'S.com.squareup.pos.API_VERSION=v2.0;i.com.squareup.pos.TOTAL_AMOUNT=' + res.total + ';' +
                'S.com.squareup.pos.CURRENCY_CODE=GBP;S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD;' +
                'S.com.squareup.pos.REQUEST_METADATA=' + res.ref + ';' +
                // come straight back 3.2 seconds after Square's Thank You screen (otherwise Square waits for New Sale)
                'l.com.squareup.pos.AUTO_RETURN_TIMEOUT_MS=3200;' +
                (loc ? 'S.com.squareup.pos.LOCATION_ID=' + encodeURIComponent(loc) + ';' : '') +
                'S.com.squareup.pos.NOTE=' + encodeURIComponent('New Way’s Wednesday till') + ';end';
              pos.setAttribute('data-card-ref', res.ref);
              pos.removeAttribute('aria-disabled');
              pos.textContent = 'Open the Square app to take ' + money(res.total);
            })
            .catch(function () { pos.textContent = 'Open the Square app to take this payment'; say('No connection: the Square app can’t be opened until the sale is registered. Check the signal and press CARD again.', true); });
        }
      }
      confirmPanel.hidden = false;
      confirmPanel.focus();
      confirmPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    // ---------- change for cash sales ----------
    var changeBox = confirmPanel.querySelector('[data-change]');
    var givenInput = changeBox && changeBox.querySelector('[data-given]');
    var changeOut = changeBox && changeBox.querySelector('[data-change-out]');
    function givenPence() {
      var v = String(givenInput.value || '').replace(/[£,\s]/g, '');
      if (!/^\d{1,5}(\.\d{0,2})?$/.test(v)) return null;
      return Math.round(Number(v) * 100);
    }
    function showChange() {
      if (!changeBox) return 0;
      var g = givenPence(), due = total();
      changeOut.classList.remove('is-short');
      if (g === null) { changeOut.textContent = givenInput.value.trim() ? 'Please type an amount like 20 or 20.00' : ''; return 0; }
      if (g < due) { changeOut.classList.add('is-short'); changeOut.textContent = money(due - g) + ' still to pay'; return 0; }
      changeOut.textContent = g === due ? 'No change' : 'CHANGE ' + money(g - due);
      return g - due;
    }
    if (changeBox) {
      givenInput.addEventListener('input', showChange);
      changeBox.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-give]');
        if (!b) return;
        var v = b.getAttribute('data-give');
        var pence = v === 'exact' ? total() : Number(v);
        givenInput.value = (pence / 100).toFixed(2);
        showChange();
      });
    }
    payBtns.forEach(function (b) { b.addEventListener('click', function () { showConfirm(b.getAttribute('data-pay')); }); });
    confirmPanel.querySelector('[data-confirm-back]').addEventListener('click', function () { confirmPanel.hidden = true; });

    confirmPanel.querySelector('[data-confirm-pay]').addEventListener('click', function () {
      if (busy || !state.lines.length) return;
      if (state.method === 'card' && pendingCard() && !window.confirm('This sale was sent to the Square app and Square hasn’t confirmed it yet. Only record it by hand if the card was taken WITHOUT the Square app. Record it now?')) return;
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
          var changeDue = state.method === 'cash' ? showChange() : 0;
          say('RECORDED: ' + money(res.total) + ' ' + (state.method === 'card' ? 'card' : 'cash') + (res.repeat ? ' (it had already been recorded)' : '') + (changeDue > 0 ? '. Give ' + money(changeDue) + ' change.' : ''));
          refresh();
          state.lines = []; state.history = []; state.ref = null;
          confirmPanel.hidden = true;
          render();
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          setTimeout(function () { location.replace('/admin/door?date=' + encodeURIComponent(date)); }, changeDue > 0 ? 4000 : 1400);
        })
        .catch(function () {
          busy = false; btn.disabled = false;
          say('NOT RECORDED: no connection. Check the signal and press the button again (it will only be recorded once).', true);
        });
    });
    render();
    checkPending();
  }

  // ---------- the card payment page after the Square app ----------
  var cardDone = document.querySelector('[data-card-result="paid"]');
  if (cardDone) {
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    setTimeout(function () { location.replace(cardDone.getAttribute('data-return')); }, 2500);
  }
  var cardPoll = document.querySelector('[data-card-poll]');
  if (cardPoll) {
    var polls = 0;
    var poll = function () {
      polls++;
      fetch('/admin/door/card/status?ref=' + encodeURIComponent(cardPoll.getAttribute('data-card-poll')), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (res) { if (res && res.ok && res.status !== 'checking' && res.status !== 'waiting') location.reload(); else if (polls < 90) setTimeout(poll, 2000); })
        .catch(function () { if (polls < 90) setTimeout(poll, 3000); });
    };
    setTimeout(poll, 1500);
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
