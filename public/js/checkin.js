/* New Way’s Admin: check-in at the door.
   - SCAN QR CODE uses the phone's camera inside the page, with no app to install: the browser's own QR reader where
     there is one (Chrome on Android), otherwise jsQR (Safari on iPhone and iPad). The QR code holds only a random code;
     the server looks up the booking.
   - Live: every few seconds the screen asks for the totals and a small "stamp". When anyone is checked in or undone (on
     the entrance iPad or any phone), or the iPad sends a guest to Julie, the totals change at once and the lists on the
     screen are reloaded by themselves (never while you are typing in the search box or tapping). */
(function () {
  'use strict';

  // ---------- live totals and lists ----------
  var totals = document.querySelector('[data-totals]');
  var live = document.querySelector('[data-live-url]');
  var lastStamp = null, lastTouch = 0, refreshing = false, pending = false;
  document.addEventListener('pointerdown', function () { lastTouch = Date.now(); }, { passive: true });

  function setTotals(t) {
    if (!totals || !t) return;
    ['booked', 'arrived', 'waiting'].forEach(function (k) {
      var el = totals.querySelector('[data-k="' + k + '"]');
      if (el && typeof t[k] === 'number') el.textContent = String(t[k]);
    });
  }

  function busyTyping() {
    var a = document.activeElement;
    return (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) || Date.now() - lastTouch < 2000;
  }

  // Reload just the live parts of this page (the iPad, Needs Julie, Same name, Groups partly arrived, the guest list, Just arrived)
  function refreshLists() {
    if (refreshing) return;
    if (busyTyping()) { pending = true; return; }
    refreshing = true; pending = false;
    fetch(location.href, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (text) {
        refreshing = false;
        if (!text) return;
        if (busyTyping()) { pending = true; return; }
        var doc = new DOMParser().parseFromString(text, 'text/html');
        Array.prototype.forEach.call(document.querySelectorAll('[data-live]'), function (el) {
          var fresh = doc.querySelector('[data-live="' + el.getAttribute('data-live') + '"]');
          if (fresh) el.replaceWith(document.importNode(fresh, true));
        });
      })
      .catch(function () { refreshing = false; });
  }

  function poll() {
    if (document.hidden) return;
    if (pending) refreshLists();
    if (!live) {
      if (!totals) return;
      fetch(totals.getAttribute('data-totals'), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).then(setTotals).catch(function () {});
      return;
    }
    fetch(live.getAttribute('data-live-url'), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (t) {
        if (!t) return;
        setTotals(t);
        if (lastStamp !== null && t.stamp !== lastStamp) refreshLists();
        lastStamp = t.stamp;
      })
      .catch(function () { /* offline for a moment: try again next time */ });
  }
  if ((totals || live) && window.fetch) {
    poll();
    setInterval(poll, live ? 4000 : 8000);
    document.addEventListener('visibilitychange', poll);
  }

  // ---------- scanning ----------
  var button = document.querySelector('[data-scan]');
  if (!button) return;
  var box = document.querySelector('.scan-box');
  var video = box && box.querySelector('video');
  var status = document.querySelector('.scan-status');
  var fallback = document.querySelector('.scan-fallback');
  var eventId = button.getAttribute('data-event');
  var label = button.textContent;
  var stream = null, timer = null, detector = null, busy = false;
  var canvas = null, ctx = null;

  var say = function (text) { if (status) status.textContent = text; };

  function tokenFrom(text) {
    var m = String(text || '').match(/\/c\/([A-Za-z0-9_-]{22})(?:[?#/]|$)/) || String(text || '').match(/^([A-Za-z0-9_-]{22})$/);
    return m ? m[1] : null;
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (box) box.hidden = true;
    button.textContent = label;
  }

  // The browser's own reader, or jsQR reading a still of the video
  function detect() {
    if (detector) return detector.detect(video).then(function (codes) { return codes.map(function (c) { return c.rawValue; }); });
    return new Promise(function (resolve) {
      if (!video.videoWidth) { resolve([]); return; }
      var scale = Math.min(1, 800 / video.videoWidth);
      var w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      var found = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      resolve(found && found.data ? [found.data] : []);
    });
  }

  function look() {
    if (!stream || busy) return;
    busy = true;
    detect().then(function (codes) {
      busy = false;
      for (var i = 0; i < codes.length; i++) {
        var token = tokenFrom(codes[i]);
        if (token) {
          say('Found a booking. Opening it…');
          if (navigator.vibrate) navigator.vibrate(80);
          stop();
          location.href = '/admin/checkin/' + eventId + '/t/' + token + (button.getAttribute('data-mode') === 'test' ? '?mode=test' : '');
          return;
        }
        say('That QR code isn’t a New Way’s booking. Try the guest’s booking QR code.');
      }
      timer = setTimeout(look, detector ? 200 : 120);
    }).catch(function () { busy = false; timer = setTimeout(look, 400); });
  }

  function unsupported() {
    if (fallback) fallback.hidden = false;
    say('');
  }

  function useJsQR() {
    if (typeof window.jsQR !== 'function') return false;
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    detector = null;
    return true;
  }

  button.addEventListener('click', function () {
    if (stream) { stop(); say(''); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { unsupported(); return; }
    var ready = 'BarcodeDetector' in window && window.BarcodeDetector.getSupportedFormats
      ? window.BarcodeDetector.getSupportedFormats().catch(function () { return []; })
      : Promise.resolve('BarcodeDetector' in window ? ['qr_code'] : []);
    ready.then(function (formats) {
      if (formats.indexOf('qr_code') >= 0) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      else if (!useJsQR()) { unsupported(); return null; }
      say('Starting the camera…');
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    }).then(function (s) {
      if (!s) return;
      stream = s;
      video.srcObject = s;
      box.hidden = false;
      button.textContent = 'STOP SCANNING';
      return video.play().then(function () { say('Point the camera at the QR code.'); look(); });
    }).catch(function (err) {
      stop();
      say(err && err.name === 'NotAllowedError'
        ? 'The camera isn’t allowed. Allow the camera for this website in the browser’s settings, or search for the guest below.'
        : 'The camera couldn’t be started. You can search for the guest below instead.');
    });
  });

  window.addEventListener('pagehide', stop);
})();
