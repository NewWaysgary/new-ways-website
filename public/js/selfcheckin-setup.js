/* iPad self check-in, setup screen: the Home Screen instructions only matter in an ordinary Safari tab. In the
   full-screen Home Screen app they are hidden. */
(function () {
  'use strict';
  var app = window.navigator.standalone === true || (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches));
  if (app) Array.prototype.forEach.call(document.querySelectorAll('[data-browser-only]'), function (el) { el.hidden = true; });
  // Code from the QR link (?code=...) only works in Safari itself: the Home Screen app has its own storage
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
})();
