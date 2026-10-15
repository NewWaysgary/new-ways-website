/* New Way’s Admin: small helpers for Gary’s phone. */
(function () {
  'use strict';

  /* Warn before leaving a form with unsaved changes */
  document.querySelectorAll('form[data-unsaved-warning]').forEach(function (form) {
    var changed = false;
    form.addEventListener('input', function () { changed = true; });
    form.addEventListener('change', function () { changed = true; });
    form.addEventListener('submit', function () { changed = false; });
    window.addEventListener('beforeunload', function (event) {
      if (!changed) return;
      event.preventDefault();
      event.returnValue = '';
    });
  });

  /* Ask before deleting */
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-confirm]');
    if (button && !window.confirm(button.getAttribute('data-confirm'))) event.preventDefault();
  });

  /* Photos: resized and compressed on the phone before upload.
     Large camera photos (often 4 to 12 MB) become sharp web images of a few hundred KB,
     so uploads are quick on mobile data and the storage allowance lasts. */
  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
  }

  async function resize(file, maxEdge, quality, type) {
    var bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    var scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    var w = Math.max(1, Math.round(bitmap.width * scale));
    var h = Math.max(1, Math.round(bitmap.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }   // JPEG has no transparency
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    var blob = type === 'image/jpeg' ? await toBlob(canvas, 'image/jpeg', quality) : await toBlob(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      blob = await toBlob(canvas, 'image/jpeg', quality);
    }
    if (!blob) throw new Error('could not prepare');
    var name = (file.name || 'photo').replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.jpg');
    return { file: new File([blob], name, { type: blob.type }), w: w, h: h };
  }

  async function prepare(input) {
    var field = input.closest('.image-field');
    var status = field.querySelector('.image-status');
    var preview = field.querySelector('.image-preview');
    var thumbInput = field.querySelector('.thumb-input');
    var submit = input.form.querySelector('button[type="submit"]');
    var chosen = Array.prototype.slice.call(input.files || []).slice(0, input.multiple ? 10 : 1);
    if (!chosen.length) { preview.hidden = true; status.textContent = ''; return; }
    var maxEdge = Number(input.getAttribute('data-resize')) || 1600;
    var quality = Number(input.getAttribute('data-quality')) || 0.85;
    var thumbEdge = Number(input.getAttribute('data-thumb')) || 0;
    var thumbType = input.getAttribute('data-thumb-type') === 'jpeg' ? 'image/jpeg' : '';
    status.textContent = chosen.length > 1 ? 'Preparing ' + chosen.length + ' photos…' : 'Preparing the picture…';
    if (submit) submit.disabled = true;
    try {
      var main = new DataTransfer(), thumbs = new DataTransfer(), before = 0, after = 0, first = null;
      for (var i = 0; i < chosen.length; i++) {
        var big = await resize(chosen[i], maxEdge, quality);
        main.items.add(big.file);
        before += chosen[i].size; after += big.file.size;
        if (!first) first = big;
        if (thumbEdge && thumbInput) thumbs.items.add((await resize(chosen[i], thumbEdge, thumbType ? 0.86 : 0.8, thumbType)).file);
      }
      input.files = main.files;
      if (thumbEdge && thumbInput) thumbInput.files = thumbs.files;
      preview.src = URL.createObjectURL(first.file);
      preview.hidden = false;
      status.textContent = chosen.length > 1
        ? 'Ready to save: ' + chosen.length + ' photos, ' + Math.round(after / 1024) + ' KB in total (was ' + Math.round(before / 1024) + ' KB).'
        : 'Ready to save: ' + first.w + ' × ' + first.h + ' pixels, ' + Math.max(1, Math.round(after / 1024)) + ' KB (was ' + Math.round(before / 1024) + ' KB).';
      if ((input.files.length || 0) < (Array.prototype.slice.call(chosen).length)) status.textContent += ' Only the first 10 are added at once.';
    } catch (err) {
      input.value = '';
      if (thumbInput) thumbInput.value = '';
      preview.hidden = true;
      status.textContent = 'That picture couldn’t be prepared. Please choose a JPEG or PNG photo.';
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  /* Background music and meditation recordings: sent straight to storage with a progress bar */
  document.querySelectorAll('form[data-upload]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var input = form.querySelector('input[type="file"]');
      var file = input.files && input.files[0];
      var status = form.querySelector('.upload-status');
      var bar = form.querySelector('progress');
      var button = form.querySelector('button[type="submit"]');
      var maxMb = Number(form.getAttribute('data-max-mb') || 20);
      if (!file) { status.textContent = 'Please choose a file first.'; return; }
      if (file.size > maxMb * 1024 * 1024) { status.textContent = 'That file is over ' + maxMb + ' MB. Please choose a smaller one.'; return; }
      var types = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg' };
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      var xhr = new XMLHttpRequest();
      xhr.open('POST', form.getAttribute('data-upload'));
      xhr.setRequestHeader('Content-Type', file.type || types[ext] || 'application/octet-stream');
      xhr.setRequestHeader('X-CSRF-Token', form.getAttribute('data-csrf'));
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) { bar.hidden = false; bar.value = Math.round(e.loaded / e.total * 100); } };
      xhr.onload = function () {
        var reply = {};
        try { reply = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status === 200 && reply.ok) { status.textContent = 'Uploaded.'; location.href = form.getAttribute('data-done') || '/admin/music?flash=uploaded'; }
        else { status.textContent = reply.error || 'The upload didn’t work. Please try again.'; button.disabled = false; bar.hidden = true; }
      };
      xhr.onerror = function () { status.textContent = 'The upload didn’t work. Please check the connection and try again.'; button.disabled = false; bar.hidden = true; };
      button.disabled = true;
      status.textContent = 'Uploading…';
      xhr.send(file);
    });
  });

  /* Copy a link, or share it with the phone's own Share menu (WhatsApp, Facebook, Messages...) */
  document.addEventListener('click', function (event) {
    var copy = event.target.closest('[data-copy]');
    if (copy) {
      var text = copy.getAttribute('data-copy');
      var done = function () { var old = copy.textContent; copy.textContent = 'Copied ✓'; setTimeout(function () { copy.textContent = old; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this link:', text); });
      else window.prompt('Copy this link:', text);
      return;
    }
    var share = event.target.closest('[data-share-url]');
    if (share && navigator.share) {
      navigator.share({ title: share.getAttribute('data-share-title') || '', text: share.getAttribute('data-share-text') || '', url: share.getAttribute('data-share-url') }).catch(function () {});
    }
  });
  document.querySelectorAll('[data-share-url]').forEach(function (b) { if (navigator.share) b.hidden = false; });

  /* Send a file (a gift voucher PDF) with the phone's own Share menu: WhatsApp, email, Messages... */
  document.querySelectorAll('[data-share-file]').forEach(function (b) {
    if (!navigator.share || !navigator.canShare || typeof File === 'undefined') return;
    var type = b.getAttribute('data-share-type') || 'application/pdf';
    try { if (!navigator.canShare({ files: [new File(['x'], 'test', { type: type })] })) return; } catch (e) { return; }
    b.hidden = false;
    b.addEventListener('click', function () {
      var old = b.textContent;
      b.textContent = 'Preparing…';
      fetch(b.getAttribute('data-share-file'), { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('not ok');
        return r.blob();
      }).then(function (blob) {
        b.textContent = old;
        var file = new File([blob], b.getAttribute('data-share-name') || 'voucher', { type: type });
        return navigator.share({ files: [file], title: b.getAttribute('data-share-title') || '' });
      }).catch(function () { b.textContent = old; });
    });
  });

  /* Print (the table plan and catering report: Chrome on Android offers Save as PDF) */
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-print]')) { event.preventDefault(); window.print(); }
  });

  /* Drop-downs that act as soon as something is chosen (the table planner); the button stays for when scripts are off */
  document.querySelectorAll('select[data-autosubmit]').forEach(function (sel) {
    sel.addEventListener('change', function () { if (sel.value) { var f = sel.form; if (f.requestSubmit) f.requestSubmit(); else f.submit(); } });
  });

  document.querySelectorAll('input[type="file"][data-resize]').forEach(function (input) {
    if (!('createImageBitmap' in window) || typeof DataTransfer === 'undefined') return;
    input.addEventListener('change', function () { prepare(input); });
  });
})();

/* Gift vouchers: the finished voucher picture. The approved design (exactly as supplied, at its own 1983 x 793 pixels)
   with the voucher's real code, its expiry date (DD/MM/YYYY) and a QR code for the Private Readings page, each centred in
   its box using the same layout as the PDF. Drawn here, then saved with the voucher so it can be downloaded again. */
(function () {
  var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-voucher-render]'));
  if (!boxes.length) return;
  var csrfInput = document.querySelector('input[name="_csrf"]');
  var csrf = csrfInput ? csrfInput.value : '';
  var fontPromise = null;
  function loadFont(t) {
    if (!fontPromise) {
      var family = 'Voucher ' + t.font;
      fontPromise = (typeof FontFace === 'undefined' ? Promise.reject(new Error('no FontFace')) : new FontFace(family, 'url(' + t.fontUrl + ')', { weight: '700' }).load())
        .then(function (face) { document.fonts.add(face); return family; });
    }
    return fontPromise;
  }
  function loadImage(src) {
    return new Promise(function (ok, fail) { var img = new Image(); img.onload = function () { ok(img); }; img.onerror = function () { fail(new Error('design')); }; img.src = src; });
  }
  function writeText(ctx, str, r, max, t, family) {
    var chars = Array.from(str);
    ctx.font = '700 100px "' + family + '"';
    var unit = 0;
    chars.forEach(function (ch) { unit += ctx.measureText(ch).width / 100; });
    var size = Math.min(max, (r.w - 2 * t.padX) / (unit + t.tracking * Math.max(0, chars.length - 1)), (r.h * 0.6) / t.capHeight);
    size = Math.floor(size * 10) / 10;
    ctx.font = '700 ' + size + 'px "' + family + '"';
    var adv = chars.map(function (ch) { return ctx.measureText(ch).width; });
    var total = adv.reduce(function (a, b) { return a + b; }, 0) + t.tracking * size * Math.max(0, chars.length - 1);
    var x = r.x + r.w / 2 - total / 2;
    var base = r.y + (r.h + size * t.capHeight) / 2;   // the capitals' height centred in the box
    ctx.fillStyle = t.colour;
    ctx.textBaseline = 'alphabetic';
    chars.forEach(function (ch, i) { ctx.fillText(ch, x, base); x += adv[i] + t.tracking * size; });
  }
  function drawQr(ctx, rows, r, dark) {
    // the whole box (white), with a quiet zone of 4 modules all round; module edges on whole pixels so it stays sharp
    var step = r.w / (rows.length + 8);
    var edge = function (i) { return Math.round(i * step); };
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = dark;
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row.charAt(x) === '1') ctx.fillRect(r.x + edge(x + 4), r.y + edge(y + 4), edge(x + 5) - edge(x + 4), edge(y + 5) - edge(y + 4));
      }
    });
  }
  function make(box) {
    var d = JSON.parse(box.getAttribute('data-voucher-render'));
    var status = box.querySelector('[data-voucher-status]');
    var shot = box.querySelector('[data-voucher-shot]');
    status.textContent = 'Making the voucher picture…';
    return Promise.all([loadImage(d.template), loadFont(d.text)]).then(function (got) {
      var img = got[0], family = got[1];
      if (img.naturalWidth !== d.width || img.naturalHeight !== d.height) throw new Error('design size');
      var canvas = document.createElement('canvas');
      canvas.width = d.width; canvas.height = d.height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, d.width, d.height);
      writeText(ctx, d.code, d.regions.code, d.text.codeMax, d.text, family);
      if (d.expiry) writeText(ctx, d.expiry, d.regions.expiry, d.text.expiryMax, d.text, family);
      drawQr(ctx, d.qr, d.regions.qr, d.text.qrDark);
      return new Promise(function (ok, fail) { canvas.toBlob(function (b) { b ? ok(b) : fail(new Error('png')); }, 'image/png'); });
    }).then(function (blob) {
      var preview = new Image();
      preview.alt = 'Gift voucher ' + d.code; preview.width = d.width; preview.height = d.height;
      preview.src = URL.createObjectURL(blob);
      shot.innerHTML = '';
      shot.appendChild(preview);
      status.textContent = 'Saving…';
      var fd = new FormData();
      fd.append('_csrf', csrf);
      fd.append('code', d.code);
      fd.append('png', blob, 'voucher.png');
      return fetch('/admin/readings/vouchers/' + d.id + '/image', { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('save');
        box.setAttribute('data-saved', '1');
        status.textContent = 'Saved with this voucher.';
        box.dispatchEvent(new CustomEvent('voucher-saved', { bubbles: true }));
      });
    }).catch(function () {
      status.textContent = 'The voucher picture could not be made or saved on this phone. Please check the signal and press Make the picture again.';
      box.setAttribute('data-failed', '1');
    });
  }
  var queue = Promise.resolve();
  boxes.forEach(function (box) {
    if (box.getAttribute('data-saved') !== '1') queue = queue.then(function () { return make(box); });
    var again = box.querySelector('[data-voucher-remake]');
    if (again) again.addEventListener('click', function () { queue = queue.then(function () { return make(box); }); });
  });
})();
