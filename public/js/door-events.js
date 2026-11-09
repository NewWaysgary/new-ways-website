// Till › ADD EVENT BOOKING payment screen, on Safari that says it is a Mac: an iPad (touch screen) can open the
// Square app, so it keeps that option; a real Mac can't, so it keeps the card reader option instead.
(function () {
  'use strict';
  var touch = navigator.maxTouchPoints > 1;
  var forms = document.querySelectorAll('[data-apple-touch]');
  for (var i = 0; i < forms.length; i++) {
    var f = forms[i];
    if ((f.getAttribute('data-apple-touch') === 'app') !== touch) f.parentNode.removeChild(f);
  }
})();
