/* New Way's Admin › Community card editor (phone-first).
   - The card at the top redraws as soon as anything is changed (from the same drawing rules as the website).
   - Tap the wording or the badge on the card to choose it, then drag it, or use the arrow and size buttons.
   - Download Facebook Image: draws the finished card (background, all wording, badge still) as a 1733 x 910 JPEG.
   - Publish (and saving a published card) asks first, then sends the matching 1200 x 630 Facebook link picture.
   Everything is checked again on the server; nothing is published without the Publish button and its confirmation. */
(function () {
  'use strict';
  var form = document.getElementById('nwc-editor');
  if (!form || !window.NWCard) return;
  var C = window.NWCard;
  var preview = form.querySelector('[data-preview]');
  var overflow = form.querySelector('[data-overflow]');
  var published = form.getAttribute('data-status') === 'published';
  var selected = '';
  var dirty = false, submitting = false, busy = false;
  var LINE_HEIGHT = { heading: 1.1, name: 1.15, message: 1.25, date: 1.15 };
  var MAX_LINES = { heading: 2, name: 1, message: 4, date: 1 };

  Array.prototype.forEach.call(document.querySelectorAll('[data-js-only], [data-download]'), function (el) { el.hidden = false; });

  function field(name) { return form.elements[name]; }
  function val(name) { var f = field(name); return f ? String(f.value) : ''; }
  function checked(name) { var f = field(name); return !!(f && f.checked); }
  function radio(name) { var r = form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }

  // The same rules as the server (src/community/model.js cardFromForm)
  function layoutFromForm() {
    var name = val('medium_name').replace(/\s+/g, ' ').trim();
    var texts = [];
    C.ROLES.forEach(function (role) {
      var lines = role === 'name' ? [name] : val(role + '_text').replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      lines = lines.filter(Boolean).slice(0, MAX_LINES[role]);
      if (!lines.length) return;
      texts.push({ role: role, lines: lines, x: val(role + '_x'), y: val(role + '_y'), anchor: val(role + '_anchor'), font: val(role + '_font'),
        size: val(role + '_size'), weight: val(role + '_weight'), color: val(role + '_color'), lineHeight: LINE_HEIGHT[role],
        spacing: role === 'heading' ? 2 : 0 });
    });
    return C.cleanLayout({
      background: radio('background'), texts: texts,
      badge: { show: checked('badge_show'), x: val('badge_x'), y: val('badge_y'), size: val('badge_size') },
      shimmer: checked('animate_logo'), shadow: checked('text_shadow')
    });
  }

  // ---------- the live card ----------
  var frame = 0;
  function redraw() {
    frame = 0;
    var L = layoutFromForm();
    var card = preview.querySelector('.nwc-card');
    var img = card.querySelector('.nwc-bg');
    var bg = C.backgroundSources(L.background);
    if (img.getAttribute('src') !== bg.src) { img.setAttribute('srcset', bg.srcset); img.setAttribute('src', bg.src); }
    card.classList.toggle('nwc-animate', L.shimmer);
    var old = card.querySelector('svg.nwc-layer');
    var holder = document.createElement('div');
    holder.innerHTML = C.layerSvg(L, 'ed');
    old.replaceWith(holder.firstChild);
    var label = form.querySelector('[data-bg-label]');
    if (label) label.textContent = 'Design ' + L.background;
    Array.prototype.forEach.call(form.querySelectorAll('[data-out]'), function (o) { var f = field(o.getAttribute('data-out')); if (f) o.textContent = f.value; });
    markSelected();
    checkEdges();
  }
  function soon() { if (!frame) frame = requestAnimationFrame(redraw); }

  function markSelected() {
    Array.prototype.forEach.call(form.querySelectorAll('[data-select]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-select') === selected ? 'true' : 'false'); });
    var svg = preview.querySelector('svg.nwc-layer');
    var el = selected && svg.querySelector('[data-role="' + selected + '"]');
    if (!el || !el.getBBox) return;
    try {
      var box = el.getBBox();
      var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('class', 'nwc-selbox');
      r.setAttribute('x', box.x - 6); r.setAttribute('y', box.y - 6); r.setAttribute('width', box.width + 12); r.setAttribute('height', box.height + 12);
      r.setAttribute('rx', 8); r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#FFED81'); r.setAttribute('stroke-width', 3); r.setAttribute('stroke-dasharray', '10 8');
      svg.appendChild(r);
    } catch (e) { /* the card is not on screen yet */ }
  }

  function checkEdges() {
    var svg = preview.querySelector('svg.nwc-layer');
    var out = false;
    Array.prototype.forEach.call(svg.querySelectorAll('text[data-role]'), function (t) {
      try { var b = t.getBBox(); if (b.width && (b.x < -2 || b.y < -2 || b.x + b.width > C.W + 2 || b.y + b.height > C.H + 2)) out = true; } catch (e) {}
    });
    if (overflow) overflow.hidden = !out;
  }

  // ---------- choosing, dragging and nudging ----------
  function posFields(role) { return role === 'badge' ? ['badge_x', 'badge_y', 'badge_size'] : [role + '_x', role + '_y', role + '_size']; }
  function setNum(name, v) {
    var f = field(name); if (!f) return;
    var min = Number(f.min), max = Number(f.max);
    f.value = String(Math.round(Math.min(max, Math.max(min, v))));
  }
  function choose(role) {
    if (role !== 'badge' && !preview.querySelector('[data-role="' + role + '"]')) { selected = role; markSelected(); return; }
    selected = role; changed();
  }
  form.addEventListener('click', function (e) {
    var sel = e.target.closest('[data-select]');
    if (sel) { choose(sel.getAttribute('data-select')); return; }
    var nudge = e.target.closest('[data-nudge]');
    var resize = e.target.closest('[data-resize]');
    var centre = e.target.closest('[data-centre]');
    var sw = e.target.closest('[data-swatch]');
    if (sw) { var cf = field(sw.getAttribute('data-for')); if (cf) { cf.value = sw.getAttribute('data-swatch').toLowerCase(); changed(); } return; }
    if (!(nudge || resize || centre)) return;
    if (!selected) { choose('heading'); }
    var f = posFields(selected);
    if (nudge) { var d = nudge.getAttribute('data-nudge').split(','); setNum(f[0], Number(val(f[0])) + Number(d[0])); setNum(f[1], Number(val(f[1])) + Number(d[1])); }
    if (resize) { var s = Number(val(f[2])); setNum(f[2], s + Math.max(1, Math.round(s * Math.abs(Number(resize.getAttribute('data-resize'))))) * (Number(resize.getAttribute('data-resize')) < 0 ? -1 : 1)); }
    if (centre) { setNum(f[0], 600); if (selected !== 'badge' && field(selected + '_anchor')) field(selected + '_anchor').value = 'middle'; }
    changed();
  });

  var drag = null;
  function toUnits(e) {
    var r = preview.querySelector('.nwc-card').getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * C.W, y: (e.clientY - r.top) / r.height * C.H };
  }
  preview.addEventListener('pointerdown', function (e) {
    var hit = e.target.closest && e.target.closest('[data-role]');
    if (!hit) return;
    var role = hit.getAttribute('data-role');
    selected = role;
    var f = posFields(role), p = toUnits(e);
    drag = { id: e.pointerId, fx: f[0], fy: f[1], dx: Number(val(f[0])) - p.x, dy: Number(val(f[1])) - p.y };
    try { preview.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
    changed();
  });
  preview.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var p = toUnits(e);
    setNum(drag.fx, p.x + drag.dx); setNum(drag.fy, p.y + drag.dy);
    changed();
  });
  function endDrag(e) { if (drag && e.pointerId === drag.id) drag = null; }
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);

  // ---------- Who's On, the date line and Next Design ----------
  var whos = form.querySelector('[data-whos-on]');
  var dateText = field('date_text');
  function autoDateText(iso) {
    var opt = whos && whos.querySelector('option[data-date="' + iso + '"]');
    if (opt) return opt.getAttribute('data-date-text');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    var d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
  }
  var lastAuto = dateText ? autoDateText(val('wed_date')) : '';
  function dateChanged() {
    if (!dateText) return;
    var next = autoDateText(val('wed_date'));
    if (!dateText.value || dateText.value === lastAuto) dateText.value = next;
    lastAuto = next;
  }
  if (whos) whos.addEventListener('change', function () {
    var o = whos.options[whos.selectedIndex];
    if (!o || !o.value) return;
    field('medium_name').value = o.getAttribute('data-name');
    field('wed_date').value = o.getAttribute('data-date');
    dateChanged(); changed();
  });
  if (field('wed_date')) field('wed_date').addEventListener('change', function () { dateChanged(); changed(); });

  var nextBtn = form.querySelector('[data-next-design]');
  if (nextBtn) nextBtn.addEventListener('click', function (e) {
    e.preventDefault();
    var radios = Array.prototype.slice.call(form.querySelectorAll('input[name="background"]'));
    var i = radios.findIndex(function (r) { return r.checked; });
    radios[(i + 1) % radios.length].checked = true;
    changed();
  });

  // The Enter key in a box would otherwise act like the first button (Next Design)
  form.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault();
  });

  function changed() { dirty = true; soon(); }
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  window.addEventListener('beforeunload', function (e) { if (dirty && !submitting) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Download Facebook Image ----------
  var dl = document.querySelector('[data-download]');
  var dlStatus = document.querySelector('[data-download-status]');
  if (dl) dl.addEventListener('click', function () {
    if (busy) return;
    busy = true; dl.disabled = true;
    if (dlStatus) dlStatus.textContent = 'Making the picture…';
    C.exportJpeg(layoutFromForm(), { width: 1733, height: 910, quality: 0.92 }).then(function (blob) {
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = 'New-Ways-' + (form.getAttribute('data-slug') || 'thank-you-card') + '.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      if (dlStatus) dlStatus.textContent = 'Downloaded. Find it in your phone’s Downloads or Gallery, then add it to your Facebook post.';
    }).catch(function () {
      if (dlStatus) dlStatus.textContent = 'Sorry, the picture could not be made. Please check you have a signal and try again.';
    }).then(function () { busy = false; dl.disabled = false; });
  });

  // ---------- Copy Facebook Link ----------
  var copy = document.querySelector('[data-copy-link]');
  var copyStatus = document.querySelector('[data-copy-status]');
  if (copy) copy.addEventListener('click', function () {
    var link = form.getAttribute('data-link');
    var input = document.querySelector('[data-link-input]');
    var done = function () { if (copyStatus) copyStatus.textContent = 'Link copied. Paste it into your Facebook post.'; };
    var fallback = function () {
      if (input) { input.focus(); input.select(); try { if (document.execCommand('copy')) { done(); return; } } catch (e) {} }
      if (copyStatus) copyStatus.textContent = 'Press and hold the link above, then choose Copy.';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, fallback); else fallback();
  });

  // ---------- Save, Publish and Update: the Facebook link picture goes with them ----------
  form.addEventListener('submit', function (e) {
    var btn = e.submitter;
    var intent = btn && btn.name === 'action' ? btn.value : 'save';
    if (intent === 'next') return;
    var needsPicture = intent === 'publish' || published;
    if (!needsPicture) { submitting = true; return; }
    e.preventDefault();
    if (busy) return;
    var question = intent === 'publish'
      ? 'Publish this thank-you card now? It will get its own Community page and link. (The Community stays hidden from the website’s menu.)'
      : 'Update the published card? The changes will show on its Community page straight away.';
    if (!window.confirm(question)) return;
    busy = true;
    var buttons = form.querySelectorAll('button[type="submit"]');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
    if (btn) btn.textContent = intent === 'publish' ? 'Publishing…' : 'Saving…';
    C.exportJpeg(layoutFromForm(), { width: 1200, height: 630, quality: 0.9 }).then(function (blob) {
      var input = form.querySelector('[data-share-input]');
      var dt = new DataTransfer();
      dt.items.add(new File([blob], 'facebook-preview.jpg', { type: 'image/jpeg' }));
      input.files = dt.files;
      var hiddenAction = document.createElement('input');
      hiddenAction.type = 'hidden'; hiddenAction.name = 'action'; hiddenAction.value = intent;
      form.appendChild(hiddenAction);
      submitting = true;
      form.submit();
    }).catch(function () {
      busy = false;
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
      if (btn) btn.textContent = intent === 'publish' ? 'Publish' : 'Save and update published card';
      window.alert('Sorry, the Facebook picture could not be made, so nothing was published. Please check you have a signal and try again.');
    });
  });

  redraw();
  dirty = false;
})();
