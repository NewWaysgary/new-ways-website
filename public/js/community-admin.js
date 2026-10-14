/* New Way's Admin › Community view: while a Wednesday notification is being sent, keep sending small batches and
   show the progress. If this screen is closed, the website finishes the rest by itself within the hour. */
(function () {
  'use strict';
  var box = document.querySelector('[data-nwc-sending]');
  if (!box || !box.getAttribute('data-nwc-sending')) return;
  var id = box.getAttribute('data-nwc-sending');
  var csrf = box.getAttribute('data-csrf');
  var out = box.querySelector('[data-nwc-progress]');
  var tries = 0;
  function step() {
    fetch('/admin/community/' + id + '/notify/batch', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ _csrf: csrf }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.ok) throw new Error('stopped');
        var c = r.counts;
        out.textContent = (r.done ? 'Finished' : 'Sending…') + ': ' + c.sent + ' sent, ' + c.failed + ' could not be delivered, ' + c.gone + ' phones had turned notifications off' + (r.done ? '.' : ', ' + c.pending + ' still to send.');
        tries = 0;
        if (!r.done) setTimeout(step, 400);
      })
      .catch(function () { if (++tries < 5) setTimeout(step, 3000); else out.textContent += ' (Paused: the rest will be sent automatically within the hour.)'; });
  }
  step();
})();
