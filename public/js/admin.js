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

  async function resize(file, maxEdge, quality) {
    var bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    var scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    var w = Math.max(1, Math.round(bitmap.width * scale));
    var h = Math.max(1, Math.round(bitmap.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    var blob = await toBlob(canvas, 'image/webp', quality);
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
    status.textContent = chosen.length > 1 ? 'Preparing ' + chosen.length + ' photos…' : 'Preparing the picture…';
    if (submit) submit.disabled = true;
    try {
      var main = new DataTransfer(), thumbs = new DataTransfer(), before = 0, after = 0, first = null;
      for (var i = 0; i < chosen.length; i++) {
        var big = await resize(chosen[i], maxEdge, quality);
        main.items.add(big.file);
        before += chosen[i].size; after += big.file.size;
        if (!first) first = big;
        if (thumbEdge && thumbInput) thumbs.items.add((await resize(chosen[i], thumbEdge, 0.8)).file);
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

  document.querySelectorAll('input[type="file"][data-resize]').forEach(function (input) {
    if (!('createImageBitmap' in window) || typeof DataTransfer === 'undefined') return;
    input.addEventListener('change', function () { prepare(input); });
  });
})();
