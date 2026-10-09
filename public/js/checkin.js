/* New Way’s Admin: check-in at the door.
   - SCAN QR CODE uses the phone's camera inside the page (Chrome on Android and most modern browsers), with no app to install.
     The QR code holds only a random code; the server looks up the booking.
   - The totals at the top refresh every few seconds, so every phone at the door shows the same numbers. */
(function () {
  'use strict';

  // ---------- live totals ----------
  var totals = document.querySelector('[data-totals]');
  if (totals && window.fetch) {
    var refresh = function () {
      if (document.hidden) return;
      fetch(totals.getAttribute('data-totals'), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (t) {
          if (!t) return;
          ['booked', 'arrived', 'waiting'].forEach(function (k) {
            var el = totals.querySelector('[data-k="' + k + '"]');
            if (el && typeof t[k] === 'number') el.textContent = String(t[k]);
          });
        })
        .catch(function () { /* offline for a moment: try again next time */ });
    };
    setInterval(refresh, 8000);
    document.addEventListener('visibilitychange', refresh);
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

  function look() {
    if (!stream || busy) return;
    busy = true;
    detector.detect(video).then(function (codes) {
      busy = false;
      for (var i = 0; i < codes.length; i++) {
        var token = tokenFrom(codes[i].rawValue);
        if (token) {
          say('Found a booking. Opening it…');
          if (navigator.vibrate) navigator.vibrate(80);
          stop();
          location.href = '/admin/checkin/' + eventId + '/t/' + token;
          return;
        }
        say('That QR code isn’t a New Way’s booking. Try the guest’s booking QR code.');
      }
      timer = setTimeout(look, 200);
    }).catch(function () { busy = false; timer = setTimeout(look, 400); });
  }

  function unsupported() {
    if (fallback) fallback.hidden = false;
    say('');
  }

  button.addEventListener('click', function () {
    if (stream) { stop(); say(''); return; }
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { unsupported(); return; }
    var ready = window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : Promise.resolve(['qr_code']);
    ready.then(function (formats) {
      if (formats.indexOf('qr_code') < 0) { unsupported(); return null; }
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
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
