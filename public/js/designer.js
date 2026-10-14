/* New Way's Admin › Designer (phone first). Artwork on a 1733 x 910 canvas, built with Konva (MIT licence).
   Layers, from bottom to top: background (photo or design, Fill/Fit with zoom and pan, adjustments and filters),
   effects (vignette, glow, light rays, sparkles, bokeh, haze), your items (text, photos, stickers, shapes), the frame,
   and the official New Way's badge (its own layer: on the website it shimmers; in pictures it is still).
   Everything is kept as a "design" (JSON) so a project can be reopened and changed, and saved as a template.
   Download Facebook Image and Publish draw the finished pictures here on the phone; the server checks them. */
(function () {
  'use strict';

  /* =====================================================================================================
     Picture library page: make pictures lighter on the phone before uploading
     ===================================================================================================== */
  function shrink(file, maxEdge, keepAlpha) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        var x = c.getContext('2d');
        x.imageSmoothingQuality = 'high';
        x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) {
          if (b && b.type === 'image/webp') return resolve(b);
          c.toBlob(function (b2) { b2 ? resolve(b2) : reject(new Error('no picture')); }, keepAlpha ? 'image/png' : 'image/jpeg', 0.9);
        }, 'image/webp', 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as a picture.')); };
      img.src = url;
    });
  }
  function uploadPicture(file, kind, name, folder, csrf) {
    var alpha = kind === 'sticker' || kind === 'frame' || /png|webp/i.test(file.type);
    return Promise.all([shrink(file, 2400, alpha), shrink(file, 360, alpha)]).then(function (b) {
      var fd = new FormData();
      fd.append('_csrf', csrf); fd.append('kind', kind); fd.append('name', name || file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60)); fd.append('folder', folder || '');
      var ext = function (blob) { return blob.type === 'image/webp' ? '.webp' : blob.type === 'image/png' ? '.png' : '.jpg'; };
      fd.append('image', b[0], 'picture' + ext(b[0])); fd.append('thumb', b[1], 'thumb' + ext(b[1]));
      return fetch('/admin/designer/library/upload', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); });
    });
  }
  var upForm = document.querySelector('[data-dz-upload]');
  if (upForm) {
    upForm.addEventListener('submit', function (e) {
      var file = upForm.querySelector('input[type="file"]').files[0];
      if (!file) return;
      e.preventDefault();
      var status = upForm.querySelector('[data-dz-status]');
      status.textContent = 'Preparing and uploading…';
      uploadPicture(file, upForm.elements.kind.value, upForm.elements.name.value, upForm.elements.folder.value, upForm.elements._csrf.value).then(function (r) {
        if (r.ok) location.href = '/admin/designer/library?flash=added';
        else status.textContent = r.message || 'Sorry, that picture could not be added.';
      }).catch(function (err) { status.textContent = (err && err.message) || 'Sorry, that picture could not be added.'; });
    });
    return;
  }

  /* =====================================================================================================
     The Designer
     ===================================================================================================== */
  var root = document.querySelector('[data-dz]');
  if (!root) return;
  var hint = root.querySelector('[data-dz-hint]');
  if (!window.Konva) { hint.textContent = 'The Designer could not load. Please check your signal and reload the page.'; return; }
  var K = window.Konva;
  var boot = JSON.parse(document.getElementById('dz-boot').textContent);
  var W = 1733, H = 910;
  var GOLD = ['#8A5A00', '#FFE9A8', '#C58B12', '#FFF4C9', '#9B6A06'];
  var SILVER = ['#5F6670', '#F5F7FA', '#A7AFBA', '#FFFFFF', '#7C8591'];
  var BRAND = ['#F8B709', '#FFED81', '#FFFFFF', '#000428', '#0669F9', '#9CC2FF', '#C67809', '#E7E7E7', '#FF8FB1', '#7CF0A8'];
  var libItems = [];

  // ---------- the design (state) ----------
  var uid = 0;
  function newId() { return 'o' + Date.now().toString(36) + (++uid); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var D = clone(boot.design || {});
  D.background = D.background || { src: '/images/community/bg-01-full.webp', fit: 'fill', zoom: 1, x: 0, y: 0, color: '#000428', adj: {} };
  D.background.adj = D.background.adj || {};
  D.objects = Array.isArray(D.objects) ? D.objects : [];
  D.effects = Array.isArray(D.effects) ? D.effects : [];
  D.badge = D.badge || { show: true, x: 1530, y: 190, size: 260 };
  if (D.shimmer === undefined) D.shimmer = true;
  D.objects.forEach(function (o) { if (!o.id) o.id = newId(); });

  // ---------- undo and redo ----------
  var history = [JSON.stringify(D)], future = [], dirty = false;
  var undoBtn = root.querySelector('[data-dz-undo]'), redoBtn = root.querySelector('[data-dz-redo]');
  var commitTimer = 0;
  function commit(now) {
    clearTimeout(commitTimer);
    var go = function () {
      var s = JSON.stringify(D);
      if (s === history[history.length - 1]) return;
      history.push(s); if (history.length > 60) history.shift();
      future = []; dirty = true; updateUndo();
    };
    if (now) go(); else commitTimer = setTimeout(go, 350);
  }
  function updateUndo() { undoBtn.disabled = history.length < 2; redoBtn.disabled = !future.length; }
  undoBtn.addEventListener('click', function () {
    if (history.length < 2) return;
    future.push(history.pop()); D = JSON.parse(history[history.length - 1]); dirty = true; select(null); renderAll(); updateUndo(); showPanel(currentTool);
  });
  redoBtn.addEventListener('click', function () {
    if (!future.length) return;
    var s = future.pop(); history.push(s); D = JSON.parse(s); dirty = true; select(null); renderAll(); updateUndo(); showPanel(currentTool);
  });
  window.addEventListener('beforeunload', function (e) { if (dirty && !busy) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- the stage ----------
  var holder = root.querySelector('[data-dz-stage]');
  var stage = new K.Stage({ container: holder, width: 300, height: 300 * H / W });
  var bgLayer = new K.Layer(), fxLayer = new K.Layer({ listening: false }), objLayer = new K.Layer(), frameLayer = new K.Layer({ listening: false }), badgeLayer = new K.Layer(), uiLayer = new K.Layer();
  [bgLayer, fxLayer, objLayer, frameLayer, badgeLayer, uiLayer].forEach(function (l) { stage.add(l); });
  var tr = new K.Transformer({ rotateAnchorOffset: 34, anchorSize: 24, anchorCornerRadius: 12, borderStroke: '#FFED81', anchorStroke: '#F8B709', anchorFill: '#000428', borderStrokeWidth: 2,
    keepRatio: true, enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], rotationSnaps: [0, 90, 180, 270], rotationSnapTolerance: 6, padding: 6, ignoreStroke: true });
  uiLayer.add(tr);
  var guideV = new K.Line({ points: [W / 2, 0, W / 2, H], stroke: '#FF8FB1', strokeWidth: 3, dash: [16, 12], visible: false, listening: false });
  var guideH = new K.Line({ points: [0, H / 2, W, H / 2], stroke: '#FF8FB1', strokeWidth: 3, dash: [16, 12], visible: false, listening: false });
  uiLayer.add(guideV, guideH);
  var k = 1;
  function fitStage() {
    var w = Math.max(240, Math.floor(holder.clientWidth || 300));
    k = w / W;
    stage.width(w); stage.height(Math.round(w * H / W));
    [bgLayer, fxLayer, objLayer, frameLayer, badgeLayer, uiLayer].forEach(function (l) { l.scale({ x: k, y: k }); });
    tr.anchorSize(24); tr.rotateAnchorOffset(34);
    stage.batchDraw();
  }
  window.addEventListener('resize', function () { fitStage(); renderAll(); });

  // ---------- pictures ----------
  var images = {};
  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    if (images[src]) return images[src];
    images[src] = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
    return images[src];
  }
  var fontsReady = {};
  function loadFont(o) {
    var spec = (o.weight || 400) + ' ' + Math.round(o.size || 40) + 'px "' + (o.font || 'Jost') + '"';
    if (fontsReady[spec] || !document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.race([document.fonts.load(spec, o.text || 'A'), new Promise(function (r) { setTimeout(r, 3000); })])
      .then(function () { fontsReady[spec] = true; }).catch(function () {});
  }

  // ---------- filters ----------
  function Sharpen(imageData) {
    var amount = this.getAttr('sharpAmount') || 0;
    if (!amount) return;
    var d = imageData.data, w = imageData.width, h = imageData.height, src = new Uint8ClampedArray(d);
    var a = amount, c = 1 + 4 * a;
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var i = (y * w + x) * 4;
      for (var ch = 0; ch < 3; ch++) {
        d[i + ch] = c * src[i + ch] - a * (src[i - 4 + ch] + src[i + 4 + ch] + src[i - w * 4 + ch] + src[i + w * 4 + ch]);
      }
    }
  }
  function Tint(imageData) {
    var t = this.getAttr('tint');
    if (!t) return;
    var d = imageData.data, r = t[0], g = t[1], b = t[2], amt = t[3];
    for (var i = 0; i < d.length; i += 4) { d[i] = d[i] * (1 - amt) + r * amt; d[i + 1] = d[i + 1] * (1 - amt) + g * amt; d[i + 2] = d[i + 2] * (1 - amt) + b * amt; }
  }
  var PRESETS = {
    none: 'Original', warm: 'Warm', cool: 'Cool', vintage: 'Vintage', mono: 'Black & white', sepia: 'Sepia', glow: 'Soft glow', dreamy: 'Dreamy', vivid: 'Vivid', night: 'Night blue', golden: 'Golden hour', fade: 'Faded'
  };
  function applyAdjust(node, adj, w, h) {
    adj = adj || {};
    var f = [], p = adj.preset || 'none';
    var bright = Number(adj.brightness || 0), contrast = Number(adj.contrast || 0), sat = Number(adj.saturation || 0), blur = Number(adj.blur || 0), sharp = Number(adj.sharpness || 0);
    var tint = null, extraSat = 0, extraBright = 0, extraContrast = 0, extraBlur = 0;
    if (p === 'warm') tint = [255, 170, 60, 0.12];
    if (p === 'cool') tint = [60, 140, 255, 0.12];
    if (p === 'vintage') { tint = [200, 150, 90, 0.18]; extraSat = -0.4; extraContrast = -8; }
    if (p === 'mono') extraSat = -2;
    if (p === 'glow') { extraBright = 0.06; extraBlur = 1; }
    if (p === 'dreamy') { tint = [210, 170, 255, 0.12]; extraBlur = 1.5; extraBright = 0.05; }
    if (p === 'vivid') { extraSat = 0.6; extraContrast = 12; }
    if (p === 'night') { tint = [20, 60, 200, 0.22]; extraBright = -0.08; }
    if (p === 'golden') { tint = [255, 190, 40, 0.2]; extraSat = 0.2; }
    if (p === 'fade') { extraContrast = -20; extraSat = -0.3; extraBright = 0.05; }
    bright += extraBright; contrast += extraContrast; sat += extraSat; blur += extraBlur;
    if (p === 'sepia') f.push(K.Filters.Sepia);
    if (bright) { f.push(K.Filters.Brighten); node.brightness(Math.max(-1, Math.min(1, bright))); }
    if (contrast) { f.push(K.Filters.Contrast); node.contrast(Math.max(-100, Math.min(100, contrast))); }
    if (sat) { f.push(K.Filters.HSL); node.saturation(Math.max(-2, Math.min(5, sat))); }
    if (tint) { f.push(Tint); node.setAttr('tint', tint); }
    if (sharp) { f.push(Sharpen); node.setAttr('sharpAmount', Math.min(1, sharp)); }
    if (blur) { f.push(K.Filters.Blur); node.blurRadius(Math.min(40, blur)); }
    if (f.length) { node.filters(f); node.cache({ pixelRatio: 1 }); }
    else { node.clearCache(); node.filters([]); }
  }

  // ---------- stickers (drawn shapes, so finished pictures are always allowed to be saved) ----------
  var STICKERS = {
    sparkle: 'M50 0 C54 34 66 46 100 50 C66 54 54 66 50 100 C46 66 34 54 0 50 C34 46 46 34 50 0 Z',
    sparkle2: 'M50 0 L56 40 L100 50 L56 60 L50 100 L44 60 L0 50 L44 40 Z M50 20 L52 46 L80 50 L52 54 L50 80 L48 54 L20 50 L48 46 Z',
    star: 'M50 2 L62 37 L99 38 L69 60 L80 96 L50 74 L20 96 L31 60 L1 38 L38 37 Z',
    star8: 'M50 0 L58 30 L85 15 L70 42 L100 50 L70 58 L85 85 L58 70 L50 100 L42 70 L15 85 L30 58 L0 50 L30 42 L15 15 L42 30 Z',
    heart: 'M50 90 C20 68 2 50 2 30 C2 14 14 4 28 4 C38 4 46 10 50 18 C54 10 62 4 72 4 C86 4 98 14 98 30 C98 50 80 68 50 90 Z',
    moon: 'M62 4 C36 8 18 30 18 54 C18 80 40 98 66 96 C46 88 34 70 34 50 C34 30 46 12 62 4 Z',
    sun: 'M50 22 A28 28 0 1 1 49.9 22 Z M50 0 L54 16 L46 16 Z M50 100 L46 84 L54 84 Z M0 50 L16 46 L16 54 Z M100 50 L84 54 L84 46 Z M15 15 L28 24 L24 28 Z M85 85 L72 76 L76 72 Z M85 15 L76 28 L72 24 Z M15 85 L24 72 L28 76 Z',
    lotus: 'M50 90 C40 70 40 40 50 18 C60 40 60 70 50 90 Z M50 90 C32 80 20 60 22 38 C36 48 46 66 50 90 Z M50 90 C68 80 80 60 78 38 C64 48 54 66 50 90 Z M50 90 C26 88 8 76 2 58 C20 60 40 72 50 90 Z M50 90 C74 88 92 76 98 58 C80 60 60 72 50 90 Z',
    flower: 'M50 38 C46 18 54 18 50 38 Z M50 30 C40 2 60 2 50 30 Z M70 50 C98 40 98 60 70 50 Z M50 70 C60 98 40 98 50 70 Z M30 50 C2 60 2 40 30 50 Z M64 36 C82 14 90 22 66 40 Z M64 64 C86 82 78 90 60 66 Z M36 64 C18 86 10 78 34 60 Z M36 36 C14 18 22 10 40 34 Z M50 40 A10 10 0 1 1 49.9 40 Z',
    feather: 'M88 4 C50 10 22 40 14 80 L10 96 L16 94 C20 86 24 80 30 74 C56 70 78 50 88 4 Z M30 74 C42 56 58 36 80 14',
    diamond: 'M50 2 L96 50 L50 98 L4 50 Z',
    crown: 'M6 80 L12 30 L32 52 L50 18 L68 52 L88 30 L94 80 Z M6 86 L94 86 L94 96 L6 96 Z',
    wings: 'M50 60 C40 40 20 30 2 34 C14 40 22 46 26 54 C14 54 8 58 4 64 C16 62 26 64 34 70 C24 72 18 78 16 84 C30 78 42 74 50 70 Z M50 60 C60 40 80 30 98 34 C86 40 78 46 74 54 C86 54 92 58 96 64 C84 62 74 64 66 70 C76 72 82 78 84 84 C70 78 58 74 50 70 Z',
    infinity: 'M50 50 C40 30 10 30 10 50 C10 70 40 70 50 50 C60 30 90 30 90 50 C90 70 60 70 50 50 Z',
    swirl: 'M50 50 C50 44 58 44 58 50 C58 60 44 62 40 50 C34 36 54 26 66 36 C80 48 70 72 50 74 C26 76 16 54 24 36',
    ribbon: 'M4 30 L96 30 L86 50 L96 70 L4 70 L14 50 Z'
  };
  var STICKER_NAMES = { sparkle: 'Sparkle', sparkle2: 'Twinkle', star: 'Star', star8: 'Starburst', heart: 'Heart', moon: 'Moon', sun: 'Sun', lotus: 'Lotus', flower: 'Flower', feather: 'Feather', diamond: 'Diamond', crown: 'Crown', wings: 'Wings', infinity: 'Infinity', swirl: 'Swirl', ribbon: 'Ribbon' };
  var OUTLINE_ONLY = { feather: 1, swirl: 1 };
  var EMOJI = ['🙏', '❤️', '💛', '💙', '✨', '🌟', '⭐', '💫', '🕯️', '🕊️', '🌹', '🌸', '🌻', '🦋', '👼', '🌙', '☀️', '🌈', '💐', '🎉', '🥂', '🔮', '🪶', '🌺', '🍀', '💜', '🤗', '😊', '👏', '🎂'];

  // centred: the shape is drawn around its middle (circles, stars); otherwise from its top-left corner (text, boxes, paths)
  function fillProps(o, w, h, centred) {
    if (o.gradient && o.gradient !== 'none') {
      var stops = o.gradient === 'gold' ? GOLD : o.gradient === 'silver' ? SILVER : [o.fill || '#F8B709', o.fill2 || '#FFFFFF'];
      var cs = [];
      stops.forEach(function (c, i) { cs.push(i / (stops.length - 1), c); });
      var x0 = centred ? -w / 2 : 0, y0 = centred ? -h / 2 : 0;
      return { fillPriority: 'linear-gradient', fillLinearGradientStartPoint: { x: x0, y: y0 }, fillLinearGradientEndPoint: { x: x0 + w, y: y0 + h }, fillLinearGradientColorStops: cs };
    }
    return { fill: o.fill || '#F8B709', fillPriority: 'color' };
  }
  function shadowProps(o) {
    return o.shadow ? { shadowEnabled: true, shadowColor: o.shadowColor || '#000428', shadowBlur: Number(o.shadowBlur || 12), shadowOffsetX: Number(o.shadowX || 0), shadowOffsetY: Number(o.shadowY || 4), shadowOpacity: 0.9 } : { shadowEnabled: false };
  }

  // ---------- drawing each item ----------
  function makeNode(o) {
    var g = new K.Group({ id: o.id, x: o.x || W / 2, y: o.y || H / 2, rotation: o.rotation || 0, scaleX: (o.scale || 1) * (o.flipX ? -1 : 1), scaleY: o.scale || 1,
      opacity: o.opacity === undefined ? 1 : o.opacity, draggable: !o.locked, visible: o.hidden !== true });
    var p;
    if (o.type === 'text') {
      var common = { text: o.text || '', fontFamily: '"' + (o.font || 'Jost') + '"', fontSize: Number(o.size || 60), fontStyle: String(o.weight || 400), letterSpacing: Number(o.letterSpacing || 0),
        stroke: o.strokeWidth ? (o.stroke || '#000428') : undefined, strokeWidth: Number(o.strokeWidth || 0), fillAfterStrokeEnabled: true, lineJoin: 'round' };
      if (o.curve) {
        var width = Math.max(100, Number(o.width || 900)), th = Math.max(0.1, Math.abs(o.curve) / 100 * Math.PI), R = width / th;
        var sx = R * Math.sin(th / 2), dy = R - R * Math.cos(th / 2);
        var data = o.curve > 0 ? 'M ' + (-sx) + ' ' + (dy / 2) + ' A ' + R + ' ' + R + ' 0 0 1 ' + sx + ' ' + (dy / 2)
          : 'M ' + (-sx) + ' ' + (-dy / 2) + ' A ' + R + ' ' + R + ' 0 0 0 ' + sx + ' ' + (-dy / 2);
        p = new K.TextPath(Object.assign(common, { data: data, align: 'center', textBaseline: 'middle', text: (o.text || '').replace(/\s*\n\s*/g, ' ') }, fillProps(o, width, Number(o.size || 60), true), shadowProps(o)));
      } else {
        p = new K.Text(Object.assign(common, { width: Number(o.width || 900), align: o.align || 'center', lineHeight: Number(o.lineHeight || 1.15), wrap: 'word' }));
        p.setAttrs(Object.assign(fillProps(o, p.width(), p.height()), shadowProps(o)));
        p.offsetX(p.width() / 2); p.offsetY(p.height() / 2);
      }
    } else if (o.type === 'image') {
      p = new K.Image({ width: Number(o.w || 400), height: Number(o.h || 400), offsetX: Number(o.w || 400) / 2, offsetY: Number(o.h || 400) / 2 });
      loadImg(o.src).then(function (img) { if (!img) return; p.image(img); applyAdjust(p, o.adj); p.getLayer() && p.getLayer().batchDraw(); });
      p.setAttrs(shadowProps(o));
    } else if (o.type === 'sticker') {
      var size = Number(o.size || 160);
      p = new K.Path(Object.assign({ data: STICKERS[o.name] || STICKERS.sparkle, scaleX: size / 100, scaleY: size / 100, offsetX: 50, offsetY: 50 },
        OUTLINE_ONLY[o.name] ? { stroke: o.fill || '#F8B709', strokeWidth: 4, fillEnabled: false } : fillProps(o, 100, 100),
        o.glow ? { shadowEnabled: true, shadowColor: o.glowColor || o.fill || '#FFED81', shadowBlur: 30, shadowOpacity: 1 } : shadowProps(o)));
    } else if (o.type === 'emoji') {
      p = new K.Text({ text: o.char || '✨', fontSize: Number(o.size || 140), fontFamily: '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif' });
      p.offsetX(p.width() / 2); p.offsetY(p.height() / 2);
    } else if (o.type === 'shape') {
      var w = Number(o.w || 400), h = Number(o.h || 260);
      var centred = o.shape === 'circle' || o.shape === 'star' || o.shape === 'ring';
      var pathLike = o.shape === 'heart' || o.shape === 'diamond' || o.shape === 'ribbon';
      var base = Object.assign({ stroke: o.strokeWidth ? (o.stroke || '#FFFFFF') : undefined, strokeWidth: Number(o.strokeWidth || 0) }, o.noFill ? { fillEnabled: false } : pathLike ? fillProps(o, 100, 100) : fillProps(o, w, h, centred), shadowProps(o));
      if (o.shape === 'circle') p = new K.Ellipse(Object.assign(base, { radiusX: w / 2, radiusY: h / 2 }));
      else if (o.shape === 'star') p = new K.Star(Object.assign(base, { numPoints: Number(o.points || 5), innerRadius: w * 0.22, outerRadius: w / 2 }));
      else if (o.shape === 'ring') p = new K.Ring(Object.assign(base, { innerRadius: w * 0.38, outerRadius: w / 2 }));
      else if (o.shape === 'line') p = new K.Line(Object.assign(base, { points: [-w / 2, 0, w / 2, 0], stroke: o.fill || '#F8B709', strokeWidth: Math.max(2, Number(o.strokeWidth || 8)), lineCap: 'round', fillEnabled: false }));
      else if (o.shape === 'heart' || o.shape === 'diamond' || o.shape === 'ribbon') p = new K.Path(Object.assign(base, { data: STICKERS[o.shape], scaleX: w / 100, scaleY: h / 100, offsetX: 50, offsetY: 50 }));
      else p = new K.Rect(Object.assign(base, { width: w, height: h, offsetX: w / 2, offsetY: h / 2, cornerRadius: o.shape === 'round' ? Math.min(w, h) * 0.18 : 0 }));
    }
    if (!p) p = new K.Rect({ width: 10, height: 10 });
    g.add(p);
    g.setAttr('dzObj', o.id);
    g.on('dragmove', function () { snap(g); });
    g.on('dragend', function () { guideV.visible(false); guideH.visible(false); o.x = Math.round(g.x()); o.y = Math.round(g.y()); commit(true); });
    g.on('transformend', function () { readTransform(g, o); commit(true); renderSelected(); });
    g.on('mousedown touchstart', function () { if (currentTool !== 'background') select(o.id); });
    return g;
  }
  function readTransform(g, o) {
    o.x = Math.round(g.x()); o.y = Math.round(g.y()); o.rotation = Math.round(g.rotation() * 10) / 10;
    o.scale = Math.round(Math.abs(g.scaleY()) * 1000) / 1000;
  }
  function snap(g) {
    var cx = Math.abs(g.x() - W / 2) < 14, cy = Math.abs(g.y() - H / 2) < 14;
    if (cx) g.x(W / 2); if (cy) g.y(H / 2);
    guideV.visible(cx); guideH.visible(cy); uiLayer.batchDraw();
  }

  // ---------- background ----------
  var bgNode = null;
  function drawBackground() {
    bgLayer.destroyChildren();
    var b = D.background;
    bgLayer.add(new K.Rect({ width: W, height: H, fill: b.color || '#000428', listening: false }));
    if (!b.src) { bgLayer.batchDraw(); return Promise.resolve(); }
    return loadImg(b.src).then(function (img) {
      if (!img) { bgLayer.batchDraw(); return; }
      var iw = img.naturalWidth, ih = img.naturalHeight, zoom = Math.max(1, Number(b.zoom || 1));
      var s = (b.fit === 'fit' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih)) * zoom;
      var dw = iw * s, dh = ih * s;
      var clampX = function (x) { return b.fit === 'fit' && dw <= W ? x : Math.min(0, Math.max(W - dw, x)); };
      var clampY = function (y) { return b.fit === 'fit' && dh <= H ? y : Math.min(0, Math.max(H - dh, y)); };
      var x = clampX((W - dw) / 2 + Number(b.x || 0)), y = clampY((H - dh) / 2 + Number(b.y || 0));
      bgNode = new K.Image({ image: img, x: x, y: y, width: dw, height: dh, draggable: currentTool === 'background',
        dragBoundFunc: function (pos) { var l = bgLayer.getAbsoluteTransform().copy().invert().point(pos); var p2 = { x: clampX(l.x), y: clampY(l.y) }; return bgLayer.getAbsoluteTransform().point(p2); } });
      bgNode.on('dragend', function () { b.x = Math.round(bgNode.x() - (W - dw) / 2); b.y = Math.round(bgNode.y() - (H - dh) / 2); commit(true); });
      bgNode.on('mousedown touchstart', function () { if (currentTool !== 'background') select(null); });
      bgLayer.add(bgNode);
      applyAdjust(bgNode, b.adj);
      bgLayer.batchDraw();
    });
  }

  // ---------- effects (overlays above the background) ----------
  function rnd(seed) { var s = seed || 1; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
  function drawEffects() {
    fxLayer.destroyChildren();
    D.effects.forEach(function (e) {
      var op = e.opacity === undefined ? 0.6 : Number(e.opacity), c = e.color || '#F8B709', r = rnd(e.seed || 7);
      var g = new K.Group({ opacity: op, listening: false });
      if (e.kind === 'vignette') g.add(new K.Rect({ width: W, height: H, fillRadialGradientStartPoint: { x: W / 2, y: H / 2 }, fillRadialGradientEndPoint: { x: W / 2, y: H / 2 }, fillRadialGradientStartRadius: H * 0.35, fillRadialGradientEndRadius: W * 0.62, fillRadialGradientColorStops: [0, 'rgba(0,0,0,0)', 1, c === '#F8B709' ? '#000428' : c] }));
      if (e.kind === 'glow') g.add(new K.Rect({ width: W, height: H, fillRadialGradientStartPoint: { x: e.x || W / 2, y: e.y || H * 0.35 }, fillRadialGradientEndPoint: { x: e.x || W / 2, y: e.y || H * 0.35 }, fillRadialGradientStartRadius: 0, fillRadialGradientEndRadius: W * 0.45, fillRadialGradientColorStops: [0, c, 1, 'rgba(0,0,0,0)'], globalCompositeOperation: 'screen' }));
      if (e.kind === 'haze') g.add(new K.Rect({ width: W, height: H, fillLinearGradientStartPoint: { x: 0, y: H }, fillLinearGradientEndPoint: { x: 0, y: 0 }, fillLinearGradientColorStops: [0, c, 0.6, 'rgba(0,0,0,0)'] }));
      if (e.kind === 'rays') {
        var ox = e.x || W / 2, oy = e.y || -60;
        for (var i = 0; i < 14; i++) {
          var a = (-0.9 + i * 0.13 + r() * 0.05), len = W * 1.2, spread = 0.035 + r() * 0.03;
          g.add(new K.Line({ points: [ox, oy, ox + Math.sin(a - spread) * len, oy + Math.cos(a - spread) * len, ox + Math.sin(a + spread) * len, oy + Math.cos(a + spread) * len], closed: true,
            fillLinearGradientStartPoint: { x: ox, y: oy }, fillLinearGradientEndPoint: { x: ox, y: oy + H }, fillLinearGradientColorStops: [0, c, 1, 'rgba(0,0,0,0)'], opacity: 0.35 + r() * 0.3, globalCompositeOperation: 'screen' }));
        }
      }
      if (e.kind === 'sparkle') for (var j = 0; j < 140; j++) {
        var sz = 2 + r() * 7;
        g.add(new K.Circle({ x: r() * W, y: r() * H, radius: sz, fill: c, opacity: 0.3 + r() * 0.7, shadowColor: c, shadowBlur: sz * 3, shadowOpacity: 1 }));
        if (j % 12 === 0) g.add(new K.Path({ data: STICKERS.sparkle, x: r() * W, y: r() * H, scaleX: 0.25 + r() * 0.35, scaleY: 0.25 + r() * 0.35, offsetX: 50, offsetY: 50, fill: '#FFF6C8', shadowColor: c, shadowBlur: 20, shadowOpacity: 1 }));
      }
      if (e.kind === 'bokeh') for (var b2 = 0; b2 < 34; b2++) {
        var rad = 18 + r() * 60;
        g.add(new K.Circle({ x: r() * W, y: r() * H, radius: rad, fillRadialGradientStartRadius: 0, fillRadialGradientEndRadius: rad, fillRadialGradientColorStops: [0, c, 0.7, c, 1, 'rgba(0,0,0,0)'], opacity: 0.15 + r() * 0.35, globalCompositeOperation: 'screen' }));
      }
      fxLayer.add(g);
    });
    fxLayer.batchDraw();
  }

  // ---------- frames ----------
  var FRAMES = { line: 'Simple line', double: 'Double line', rounded: 'Rounded', glow: 'Glowing', corners: 'Elegant corners', deco: 'Art Deco', dots: 'Dotted', floral: 'Floral corners', ornate: 'Ornate gold', soft: 'Soft edge', banner: 'Top and bottom bands' };
  function frameStroke(f) {
    var paint = f.paint || 'gold';
    if (paint === 'gold' || paint === 'silver') {
      var stops = paint === 'gold' ? GOLD : SILVER, cs = [];
      stops.forEach(function (c, i) { cs.push(i / (stops.length - 1), c); });
      return { strokeLinearGradientStartPoint: { x: 0, y: 0 }, strokeLinearGradientEndPoint: { x: W, y: H }, strokeLinearGradientColorStops: cs, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: W, y: H }, fillLinearGradientColorStops: cs };
    }
    return { stroke: f.color || '#F8B709', fill: f.color || '#F8B709' };
  }
  function drawFrame() {
    frameLayer.destroyChildren();
    var f = D.frame;
    if (!f || !f.style) { frameLayer.batchDraw(); return; }
    var t = Number(f.thickness || 10), inset = Number(f.inset === undefined ? 28 : f.inset), op = f.opacity === undefined ? 1 : Number(f.opacity);
    var g = new K.Group({ opacity: op, listening: false });
    var paint = frameStroke(f);
    var rect = function (ins, sw, extra) { return new K.Rect(Object.assign({ x: ins, y: ins, width: W - ins * 2, height: H - ins * 2, strokeWidth: sw, fillEnabled: false }, paint, { fillEnabled: false }, extra || {})); };
    var s = f.style;
    if (s === 'line') g.add(rect(inset, t));
    if (s === 'double' || s === 'ornate') { g.add(rect(inset, t)); g.add(rect(inset + t * 2.2, Math.max(2, t / 3))); }
    if (s === 'rounded') g.add(rect(inset, t, { cornerRadius: 46 }));
    if (s === 'glow') g.add(rect(inset, t, { shadowColor: f.color && f.paint === 'colour' ? f.color : '#FFD45C', shadowBlur: 30 + t * 2, shadowOpacity: 1, cornerRadius: 18 }));
    if (s === 'dots') g.add(rect(inset, t, { dash: [0.1, t * 2.6], lineCap: 'round' }));
    if (s === 'soft') g.add(new K.Rect({ width: W, height: H, strokeWidth: inset * 2 + t * 6, stroke: f.paint === 'colour' ? f.color : '#000428', shadowColor: f.paint === 'colour' ? f.color : '#000428', shadowBlur: 80, shadowOpacity: 1, fillEnabled: false }));
    if (s === 'banner') { g.add(new K.Rect(Object.assign({ x: 0, y: 0, width: W, height: inset + t * 4, strokeEnabled: false }, paint, { strokeEnabled: false }))); g.add(new K.Rect(Object.assign({ x: 0, y: H - inset - t * 4, width: W, height: inset + t * 4 }, paint, { strokeEnabled: false }))); }
    if (s === 'corners' || s === 'ornate' || s === 'deco' || s === 'floral') {
      var L = 120 + t * 4, i0 = s === 'ornate' ? inset + t * 4.5 : inset;
      [[i0, i0, 1, 1], [W - i0, i0, -1, 1], [i0, H - i0, 1, -1], [W - i0, H - i0, -1, -1]].forEach(function (c) {
        var x = c[0], y = c[1], sx = c[2], sy = c[3];
        if (s === 'corners' || s === 'ornate') {
          g.add(new K.Line(Object.assign({ points: [x, y + sy * L, x, y, x + sx * L, y], strokeWidth: t, lineCap: 'round', lineJoin: 'round' }, paint, { fillEnabled: false })));
          g.add(new K.Circle(Object.assign({ x: x + sx * (L + t * 2), y: y, radius: t * 0.9 }, paint, { strokeEnabled: false })));
          g.add(new K.Circle(Object.assign({ x: x, y: y + sy * (L + t * 2), radius: t * 0.9 }, paint, { strokeEnabled: false })));
          g.add(new K.Path(Object.assign({ data: STICKERS.sparkle, x: x + sx * t * 3, y: y + sy * t * 3, scaleX: t / 22, scaleY: t / 22, offsetX: 50, offsetY: 50 }, paint, { strokeEnabled: false })));
        }
        if (s === 'deco') for (var n = 0; n < 3; n++) {
          var o = n * t * 2.2;
          g.add(new K.Line(Object.assign({ points: [x + sx * o, y + sy * (L - o), x + sx * o, y + sy * o, x + sx * (L - o), y + sy * o], strokeWidth: Math.max(2, t / 2) }, paint, { fillEnabled: false })));
        }
        if (s === 'floral') {
          for (var q = 0; q < 5; q++) {
            var ang = (sx > 0 ? 0 : Math.PI) + (sy > 0 ? 1 : -1) * (q * Math.PI / 8);
            g.add(new K.Path(Object.assign({ data: 'M0 0 C 10 -12 30 -12 40 0 C 30 12 10 12 0 0 Z', x: x, y: y, rotation: ang * 180 / Math.PI * (sy > 0 ? 1 : 1), scaleX: (L / 40) * (q % 2 ? 0.7 : 1), scaleY: (L / 40) * (q % 2 ? 0.7 : 1) * 0.8 }, paint, { strokeEnabled: false, opacity: 0.85 })));
          }
          g.add(new K.Circle(Object.assign({ x: x, y: y, radius: t * 1.6 }, paint, { strokeEnabled: false })));
        }
      });
    }
    frameLayer.add(g);
    frameLayer.batchDraw();
  }

  // ---------- the official badge (its own layer) ----------
  var badgeGroup = null;
  function drawBadge() {
    badgeLayer.destroyChildren();
    var b = D.badge;
    if (!b.show) { badgeLayer.batchDraw(); return Promise.resolve(); }
    var r = b.size / 2;
    badgeGroup = new K.Group({ x: b.x, y: b.y, draggable: true, id: 'badge' });
    badgeGroup.add(new K.Circle({ radius: r * 1.22, fillRadialGradientStartRadius: r * 0.62 * 1.22 * 0.8, fillRadialGradientEndRadius: r * 1.22, fillRadialGradientColorStops: [0, 'rgba(248,183,9,0.28)', 1, 'rgba(248,183,9,0)'] }));
    var clip = new K.Group({ clipFunc: function (ctx) { ctx.arc(0, 0, r * 0.985, 0, Math.PI * 2, false); } });
    var img = new K.Image({ width: b.size, height: b.size, offsetX: r, offsetY: r });
    clip.add(img); badgeGroup.add(clip);
    badgeGroup.on('dragmove', function () { snap(badgeGroup); });
    badgeGroup.on('dragend', function () { guideV.visible(false); guideH.visible(false); b.x = Math.round(badgeGroup.x()); b.y = Math.round(badgeGroup.y()); commit(true); });
    badgeGroup.on('transformend', function () { b.size = Math.round(Math.max(50, Math.min(800, b.size * badgeGroup.scaleX()))); b.x = Math.round(badgeGroup.x()); b.y = Math.round(badgeGroup.y()); commit(true); drawBadge().then(function () { if (selectedId === 'badge') select('badge'); }); });
    badgeGroup.on('mousedown touchstart', function () { select('badge'); });
    badgeLayer.add(badgeGroup);
    return loadImg('/images/new-ways-logo.jpg').then(function (im) { if (im) img.image(im); badgeLayer.batchDraw(); });
  }

  // ---------- drawing everything ----------
  function drawObjects() {
    objLayer.destroyChildren();
    D.objects.forEach(function (o) { objLayer.add(makeNode(o)); });
    objLayer.batchDraw();
  }
  var drawFrameReq = 0;
  function renderAll() {
    return Promise.all(D.objects.filter(function (o) { return o.type === 'text'; }).map(loadFont)).then(function () {
      drawObjects(); drawEffects(); drawFrame();
      return Promise.all([drawBackground(), drawBadge()]);
    }).then(function () { reselect(); });
  }
  function renderSoon() { if (drawFrameReq) return; drawFrameReq = requestAnimationFrame(function () { drawFrameReq = 0; renderAll(); }); }
  function rerenderObject(o) {
    var old = objLayer.findOne('#' + o.id);
    var idx = D.objects.indexOf(o);
    loadFont(o).then(function () {
      var n = makeNode(o);
      if (old) old.destroy();
      objLayer.add(n); n.zIndex(Math.max(0, Math.min(idx, objLayer.children.length - 1)));
      objLayer.batchDraw(); reselect();
    });
  }

  // ---------- choosing an item ----------
  var selectedId = null;
  function find(id) { for (var i = 0; i < D.objects.length; i++) if (D.objects[i].id === id) return D.objects[i]; return null; }
  function select(id) {
    selectedId = id;
    reselect();
    if (id) showPanel(id === 'badge' ? 'badge' : 'item');
  }
  function reselect() {
    var node = selectedId === 'badge' ? badgeGroup : selectedId ? objLayer.findOne('#' + selectedId) : null;
    var o = selectedId && selectedId !== 'badge' ? find(selectedId) : null;
    if (node && !(o && o.locked)) { tr.nodes([node]); tr.keepRatio(true); } else tr.nodes([]);
    uiLayer.batchDraw();
  }
  stage.on('click tap', function (e) { if (e.target === stage) select(null); });

  // Two fingers on an item: pinch to resize, twist to turn
  var pinch = null;
  stage.on('touchmove', function (e) {
    var t = e.evt.touches;
    if (!t || t.length !== 2 || !selectedId) { pinch = null; return; }
    var node = selectedId === 'badge' ? badgeGroup : objLayer.findOne('#' + selectedId);
    if (!node) return;
    e.evt.preventDefault();
    node.stopDrag && node.isDragging() && node.stopDrag();
    var dx = t[1].clientX - t[0].clientX, dy = t[1].clientY - t[0].clientY, dist = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
    if (!pinch) { pinch = { dist: dist, ang: ang, sx: Math.abs(node.scaleX()), sy: node.scaleY(), rot: node.rotation(), flip: node.scaleX() < 0 ? -1 : 1 }; return; }
    var f = Math.max(0.1, Math.min(8, dist / pinch.dist));
    node.scaleX(pinch.sx * f * pinch.flip); node.scaleY(pinch.sy * f);
    if (selectedId !== 'badge') node.rotation(pinch.rot + (ang - pinch.ang));
    node.getLayer().batchDraw(); uiLayer.batchDraw();
  });
  stage.on('touchend', function () {
    if (!pinch || !selectedId) { pinch = null; return; }
    pinch = null;
    if (selectedId === 'badge') badgeGroup.fire('transformend');
    else { var o = find(selectedId), n = objLayer.findOne('#' + selectedId); if (o && n) { readTransform(n, o); commit(true); } }
  });

  /* =====================================================================================================
     Panels (the controls under the canvas)
     ===================================================================================================== */
  var panel = root.querySelector('[data-dz-panel]');
  var currentTool = '';
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var a in (attrs || {})) {
      if (a === 'text') e.textContent = attrs[a];
      else if (a === 'on') for (var ev in attrs.on) e.addEventListener(ev, attrs.on[ev]);
      else if (attrs[a] !== undefined && attrs[a] !== null && attrs[a] !== false) e.setAttribute(a, attrs[a] === true ? '' : attrs[a]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var fid = 0;
  function slider(label, value, min, max, step, onInput) {
    var id = 'dzf' + (++fid), out = el('output', { 'for': id, text: String(value) });
    var input = el('input', { type: 'range', id: id, min: min, max: max, step: step || 1, value: value, on: { input: function () { out.textContent = input.value; onInput(Number(input.value)); }, change: function () { commit(); } } });
    return el('div', { 'class': 'nwc-range dz-range' }, [el('label', { 'for': id, text: label }), input, out]);
  }
  function colours(label, value, onPick) {
    var id = 'dzf' + (++fid);
    var input = el('input', { type: 'color', id: id, value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#F8B709', 'aria-label': label + ': any colour', on: { input: function () { onPick(input.value); }, change: function () { commit(); } } });
    return el('div', { 'class': 'dz-field' }, [el('span', { 'class': 'nwc-label', text: label }), el('div', { 'class': 'nwc-swatches' }, BRAND.map(function (c) {
      return el('button', { type: 'button', 'class': 'dz-sw', 'aria-label': c, on: { click: function () { input.value = c; onPick(c); commit(true); } } }, [el('span', { 'class': 'dz-sw-c', 'data-c': c })]);
    }).concat([input]))]);
  }
  function choice(label, value, options, onPick) {
    var id = 'dzf' + (++fid);
    var s = el('select', { id: id, on: { change: function () { onPick(s.value); commit(true); } } }, Object.keys(options).map(function (k) { return el('option', { value: k, selected: String(k) === String(value), text: options[k] }); }));
    return el('div', { 'class': 'field' }, [el('label', { 'for': id, text: label }), s]);
  }
  function check(label, value, onPick) {
    var id = 'dzf' + (++fid);
    var c = el('input', { type: 'checkbox', id: id, checked: !!value, on: { change: function () { onPick(c.checked); commit(true); } } });
    return el('label', { 'class': 'field-check', 'for': id }, [c, ' ' + label]);
  }
  function btn(label, onClick, cls) { return el('button', { type: 'button', 'class': cls || 'pill', on: { click: onClick } }, [label]); }
  function row(kids) { return el('div', { 'class': 'dz-row' }, kids); }
  function h(text) { return el('h2', { 'class': 'dz-h', text: text }); }
  function grid(items) { return el('div', { 'class': 'dz-grid' }, items); }
  function tile(label, onClick, imgSrc, extraClass) {
    return el('button', { type: 'button', 'class': 'dz-tile' + (extraClass ? ' ' + extraClass : ''), on: { click: onClick } }, [imgSrc ? el('img', { src: imgSrc, alt: '', loading: 'lazy' }) : null, el('span', { text: label })]);
  }
  function swatchStyle() {
    Array.prototype.forEach.call(panel.querySelectorAll('[data-c]'), function (s) { s.style.background = s.getAttribute('data-c'); });
  }

  var tools = root.querySelectorAll('[data-dz-tool]');
  Array.prototype.forEach.call(tools, function (b) { b.addEventListener('click', function () { var t = b.getAttribute('data-dz-tool'); if (t !== 'layers' && t !== 'badge') select(null); showPanel(t); }); });

  function showPanel(name) {
    currentTool = name || '';
    Array.prototype.forEach.call(tools, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dz-tool') === name ? 'true' : 'false'); });
    if (bgNode) bgNode.draggable(name === 'background');
    panel.innerHTML = '';
    var fn = PANELS[name];
    if (fn) fn();
    else panel.appendChild(el('p', { 'class': 'nwc-note', text: 'Tap a tool below, or tap something on the canvas to change it. Drag to move it; use the round handles (or two fingers) to resize and turn it.' }));
    swatchStyle();
    hint.textContent = name === 'background' ? 'Drag the picture on the canvas to choose which part shows.' : '';
  }

  function addObject(o) {
    o.id = newId();
    if (o.x === undefined) { o.x = W / 2; o.y = H / 2; }
    o.rotation = o.rotation || 0; o.opacity = o.opacity === undefined ? 1 : o.opacity; o.scale = o.scale || 1;
    D.objects.push(o);
    commit(true);
    var n = makeNode(o);
    objLayer.add(n);
    loadFont(o).then(function () { rerenderObject(o); select(o.id); });
  }

  function libGrid(kind, onPick) {
    var box = el('div', { 'class': 'dz-grid' }, [el('p', { 'class': 'nwc-note', text: 'Loading your pictures…' })]);
    loadLibrary().then(function () {
      box.innerHTML = '';
      var list = libItems.filter(function (i) { return i.kind === kind; });
      if (!list.length) box.appendChild(el('p', { 'class': 'nwc-note', text: 'None in your library yet.' }));
      var folders = {};
      list.forEach(function (i) { (folders[i.folder || ''] = folders[i.folder || ''] || []).push(i); });
      Object.keys(folders).sort().forEach(function (f) {
        if (f) box.appendChild(el('p', { 'class': 'dz-folder', text: f }));
        folders[f].forEach(function (i) { box.appendChild(tile((i.favourite ? '★ ' : '') + (i.name || ''), function () { onPick(i); }, i.thumb)); });
      });
    });
    return box;
  }
  var libLoaded = null;
  function loadLibrary(force) {
    if (libLoaded && !force) return libLoaded;
    libLoaded = fetch('/admin/designer/library.json', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (r) { libItems = r.items || []; }).catch(function () { libItems = []; });
    return libLoaded;
  }
  function uploader(kind, label, onDone) {
    var id = 'dzf' + (++fid);
    var status = el('p', { 'class': 'nwc-note', role: 'status' });
    var input = el('input', { type: 'file', id: id, accept: 'image/jpeg,image/png,image/webp', 'class': 'dz-file', on: { change: function () {
      var file = input.files[0];
      if (!file) return;
      status.textContent = 'Preparing and uploading…';
      uploadPicture(file, kind, '', '', boot.csrf).then(function (r) {
        if (!r.ok) { status.textContent = r.message || 'That picture could not be added.'; return; }
        status.textContent = 'Added to your library.';
        loadLibrary(true);
        onDone(r.item);
      }).catch(function (err) { status.textContent = (err && err.message) || 'That picture could not be added.'; });
    } } });
    return el('div', { 'class': 'dz-upload-row' }, [el('label', { 'for': id, 'class': 'pill pill-gold', text: label }), input, status]);
  }

  var PANELS = {
    background: function () {
      var b = D.background;
      panel.appendChild(h('Background'));
      panel.appendChild(row([btn('Fill (no gaps)', function () { b.fit = 'fill'; b.x = 0; b.y = 0; commit(true); drawBackground(); }, b.fit !== 'fit' ? 'pill pill-gold' : 'pill'),
        btn('Fit (whole picture)', function () { b.fit = 'fit'; b.x = 0; b.y = 0; commit(true); drawBackground(); }, b.fit === 'fit' ? 'pill pill-gold' : 'pill'),
        btn('Centre', function () { b.x = 0; b.y = 0; commit(true); drawBackground(); })]));
      panel.appendChild(slider('Zoom (crop)', b.zoom || 1, 1, 4, 0.05, function (v) { b.zoom = v; drawBackground(); }));
      panel.appendChild(colours('Colour behind the picture', b.color, function (c) { b.color = c; drawBackground(); }));
      panel.appendChild(el('details', { 'class': 'dz-more' }, [el('summary', { text: 'Adjust and filters' })].concat(adjustControls(b, drawBackground))));
      panel.appendChild(h('The nine New Way’s designs'));
      panel.appendChild(grid(boot.backgrounds.map(function (n) {
        return tile('Design ' + n, function () { b.src = '/images/community/bg-' + n + '-full.webp'; b.fit = 'fill'; b.zoom = 1; b.x = 0; b.y = 0; commit(true); drawBackground(); }, '/images/community/bg-' + n + '-thumb.webp');
      })));
      panel.appendChild(h('Your backgrounds and photos'));
      panel.appendChild(uploader('background', 'Upload a background or photo', function (item) { b.src = item.src; b.fit = 'fill'; b.zoom = 1; b.x = 0; b.y = 0; commit(true); drawBackground(); }));
      panel.appendChild(libGrid('background', function (i) { b.src = i.src; b.fit = 'fill'; b.zoom = 1; b.x = 0; b.y = 0; commit(true); drawBackground(); }));
      panel.appendChild(libGrid('photo', function (i) { b.src = i.src; b.fit = 'fill'; b.zoom = 1; b.x = 0; b.y = 0; commit(true); drawBackground(); }));
      panel.appendChild(row([btn('Plain colour only', function () { b.src = ''; commit(true); drawBackground(); })]));
    },
    text: function () {
      panel.appendChild(h('Add text'));
      [['Heading', { text: 'Thank You', font: 'Cinzel', size: 120, weight: 700, fill: '#F8B709', letterSpacing: 3, shadow: true, shadowBlur: 16 }],
        ['Script', { text: 'With love and thanks', font: 'Great Vibes', size: 110, weight: 400, fill: '#FFED81', shadow: true, shadowBlur: 14 }],
        ['Name', { text: document.querySelector('[data-dz-medium]').value || 'Guest Medium', font: 'Cinzel', size: 72, weight: 600, fill: '#FFFFFF', shadow: true }],
        ['Message', { text: 'for a wonderful Wednesday evening', font: 'Jost', size: 46, weight: 500, fill: '#FFED81', shadow: true }],
        ['Gold lettering', { text: 'New Way’s', font: 'Cinzel Decorative', size: 100, weight: 700, gradient: 'gold', stroke: '#3A2600', strokeWidth: 2, shadow: true }],
        ['Curved', { text: 'Awaken the Spirit Within', font: 'Cinzel', size: 60, weight: 600, fill: '#FFED81', curve: 35, width: 1000, shadow: true }]]
        .forEach(function (t) { panel.appendChild(btn('+ ' + t[0], function () { addObject(Object.assign({ type: 'text', align: 'center', width: 1100, lineHeight: 1.15, shadowColor: '#000428', shadowBlur: 12 }, t[1])); })); });
    },
    photo: function () {
      panel.appendChild(h('Photos and pictures'));
      panel.appendChild(el('p', { 'class': 'nwc-note', text: 'Add a photo on top of the background. Photos can be moved, resized, turned, faded and adjusted.' }));
      var add = function (i) { var w = Math.min(900, i.w || 600), hh = Math.round(w * (i.h || 600) / (i.w || 600)); addObject({ type: 'image', src: i.src, w: w, h: hh, adj: {} }); };
      panel.appendChild(uploader('photo', 'Upload a photo', add));
      panel.appendChild(libGrid('photo', add));
      panel.appendChild(h('Backgrounds as pictures'));
      panel.appendChild(libGrid('background', add));
    },
    sticker: function () {
      panel.appendChild(h('Stickers and sparkles'));
      panel.appendChild(grid(Object.keys(STICKERS).filter(function (n) { return n !== 'ribbon'; }).map(function (n) {
        return tile(STICKER_NAMES[n], function () { addObject({ type: 'sticker', name: n, size: 180, fill: '#F8B709', gradient: n === 'lotus' || n === 'crown' || n === 'wings' ? 'gold' : 'none', glow: n.indexOf('sparkle') === 0 || n === 'star' }); });
      })));
      panel.appendChild(h('Emoji'));
      panel.appendChild(el('div', { 'class': 'dz-emoji' }, EMOJI.map(function (c) { return btn(c, function () { addObject({ type: 'emoji', char: c, size: 150 }); }, 'dz-emo'); })));
      panel.appendChild(h('Your stickers'));
      var add = function (i) { var w = Math.min(500, i.w || 300); addObject({ type: 'image', src: i.src, w: w, h: Math.round(w * (i.h || 300) / (i.w || 300)), adj: {} }); };
      panel.appendChild(uploader('sticker', 'Upload a sticker (PNG with see-through background)', add));
      panel.appendChild(libGrid('sticker', add));
    },
    shape: function () {
      panel.appendChild(h('Shapes'));
      var SH = { rect: 'Rectangle', round: 'Rounded box', circle: 'Circle', star: 'Star', heart: 'Heart', ring: 'Ring', line: 'Line', diamond: 'Diamond', ribbon: 'Ribbon banner' };
      panel.appendChild(grid(Object.keys(SH).map(function (s) {
        return tile(SH[s], function () {
          var sq = s === 'circle' || s === 'star' || s === 'heart' || s === 'ring' || s === 'diamond';
          addObject({ type: 'shape', shape: s, w: s === 'line' ? 700 : sq ? 260 : 700, h: s === 'line' ? 10 : sq ? 260 : s === 'ribbon' ? 200 : 300, fill: s === 'rect' || s === 'round' || s === 'ribbon' ? '#000428' : '#F8B709', opacity: s === 'rect' || s === 'round' ? 0.6 : 1, strokeWidth: 0, stroke: '#F8B709' });
        });
      })));
    },
    frame: function () {
      var f = D.frame || (D.frame = { style: '', paint: 'gold', color: '#F8B709', thickness: 10, inset: 28, opacity: 1 });
      panel.appendChild(h('Borders and frames'));
      panel.appendChild(grid([tile('No frame', function () { f.style = ''; commit(true); drawFrame(); })].concat(Object.keys(FRAMES).map(function (s) { return tile(FRAMES[s], function () { f.style = s; commit(true); drawFrame(); }); }))));
      panel.appendChild(choice('Colour style', f.paint, { gold: 'Gold (shining)', silver: 'Silver (shining)', colour: 'Choose a colour' }, function (v) { f.paint = v; drawFrame(); }));
      panel.appendChild(colours('Colour', f.color, function (c) { f.color = c; f.paint = 'colour'; drawFrame(); }));
      panel.appendChild(slider('Thickness', f.thickness, 2, 40, 1, function (v) { f.thickness = v; drawFrame(); }));
      panel.appendChild(slider('Distance from the edge (size)', f.inset, 0, 160, 2, function (v) { f.inset = v; drawFrame(); }));
      panel.appendChild(slider('See-through', Math.round((1 - f.opacity) * 100), 0, 90, 5, function (v) { f.opacity = 1 - v / 100; drawFrame(); }));
      panel.appendChild(h('Your frames'));
      var add = function (i) { addObject({ type: 'image', src: i.src, w: W, h: H, x: W / 2, y: H / 2, adj: {} }); };
      panel.appendChild(uploader('frame', 'Upload a frame (PNG with see-through middle)', add));
      panel.appendChild(libGrid('frame', add));
    },
    effect: function () {
      panel.appendChild(h('Light and effects'));
      var EF = { glow: 'Soft glow', rays: 'Light rays', sparkle: 'Sparkle dust', bokeh: 'Bokeh lights', vignette: 'Darker edges', haze: 'Golden haze' };
      panel.appendChild(grid(Object.keys(EF).map(function (k2) { return tile('+ ' + EF[k2], function () { D.effects.push({ kind: k2, color: k2 === 'vignette' ? '#000428' : '#F8B709', opacity: k2 === 'vignette' ? 0.8 : 0.6, seed: Math.floor(Math.random() * 99999) + 1 }); commit(true); drawEffects(); showPanel('effect'); }); })));
      D.effects.forEach(function (e, i) {
        var box = el('div', { 'class': 'nwc-sec dz-effect' }, [el('p', { 'class': 'dz-h', text: EF[e.kind] || e.kind })]);
        box.appendChild(colours('Colour', e.color, function (c) { e.color = c; drawEffects(); }));
        box.appendChild(slider('Strength', Math.round((e.opacity || 0.6) * 100), 5, 100, 5, function (v) { e.opacity = v / 100; drawEffects(); }));
        box.appendChild(row([btn('Shuffle', function () { e.seed = Math.floor(Math.random() * 99999) + 1; commit(true); drawEffects(); }), btn('Remove', function () { D.effects.splice(i, 1); commit(true); drawEffects(); showPanel('effect'); }, 'pill pill-danger')]));
        panel.appendChild(box);
      });
    },
    badge: function () {
      var b = D.badge;
      panel.appendChild(h('Official New Way’s badge'));
      panel.appendChild(el('p', { 'class': 'nwc-note', text: 'Drag the badge on the canvas to move it, and use its handles (or two fingers) to resize it. On the Community page it is its own layer and can shimmer; in downloaded pictures it is still.' }));
      panel.appendChild(check('Show the badge', b.show, function (v) { b.show = v; drawBadge(); }));
      panel.appendChild(check('Animate Logo (gold shimmer on the website and app)', D.shimmer !== false, function (v) { D.shimmer = v; }));
      panel.appendChild(slider('Size', b.size, 50, 800, 5, function (v) { b.size = v; drawBadge().then(function () { if (selectedId === 'badge') reselect(); }); }));
      panel.appendChild(row([btn('Top right', function () { b.x = W - b.size * 0.75; b.y = b.size * 0.75; commit(true); drawBadge(); }), btn('Top left', function () { b.x = b.size * 0.75; b.y = b.size * 0.75; commit(true); drawBadge(); }), btn('Centre', function () { b.x = W / 2; b.y = H / 2; commit(true); drawBadge(); })]));
    },
    layers: function () {
      panel.appendChild(h('Layers (top first)'));
      if (!D.objects.length) panel.appendChild(el('p', { 'class': 'nwc-note', text: 'Nothing added yet.' }));
      D.objects.slice().reverse().forEach(function (o) {
        var name = o.type === 'text' ? '“' + String(o.text || '').slice(0, 24) + '”' : o.type === 'sticker' ? (STICKER_NAMES[o.name] || 'Sticker') : o.type === 'emoji' ? o.char : o.type === 'shape' ? 'Shape' : 'Picture';
        panel.appendChild(el('div', { 'class': 'dz-layer' + (o.id === selectedId ? ' is-on' : '') }, [
          btn(name + (o.hidden ? ' (hidden)' : '') + (o.locked ? ' 🔒' : ''), function () { select(o.id); }, 'dz-layer-name'),
          btn('▲', function () { move(o, 1); showPanel('layers'); }, 'dz-mini'), btn('▼', function () { move(o, -1); showPanel('layers'); }, 'dz-mini'),
          btn(o.hidden ? 'Show' : 'Hide', function () { o.hidden = !o.hidden; commit(true); rerenderObject(o); showPanel('layers'); }, 'dz-mini'),
          btn(o.locked ? 'Unlock' : 'Lock', function () { o.locked = !o.locked; commit(true); rerenderObject(o); showPanel('layers'); }, 'dz-mini')]));
      });
      panel.appendChild(el('p', { 'class': 'nwc-note', text: 'The badge is always on top. The frame sits above your items; effects sit just above the background.' }));
    },
    item: function () {
      var o = find(selectedId);
      if (!o) { showPanel(''); return; }
      var redraw = function () { rerenderObject(o); };
      panel.appendChild(h(o.type === 'text' ? 'Text' : o.type === 'image' ? 'Picture' : o.type === 'shape' ? 'Shape' : 'Sticker'));
      if (o.type === 'text') {
        var ta = el('textarea', { rows: 3, 'class': 'dz-textarea', 'aria-label': 'Wording', on: { input: function () { o.text = ta.value; redraw(); }, change: function () { commit(); } } });
        ta.value = o.text || '';
        panel.appendChild(ta);
        var fonts = {}; boot.fonts.forEach(function (f) { fonts[f] = f; });
        panel.appendChild(choice('Font', o.font, fonts, function (v) { o.font = v; redraw(); }));
        panel.appendChild(choice('Thickness', o.weight || 400, { 400: 'Regular', 700: 'Bold' }, function (v) { o.weight = Number(v); redraw(); }));
        panel.appendChild(slider('Text size', o.size, 14, 300, 1, function (v) { o.size = v; redraw(); }));
        panel.appendChild(choice('Colour style', o.gradient || 'none', { none: 'One colour', gold: 'Gold gradient', silver: 'Silver gradient', custom: 'Two-colour gradient' }, function (v) { o.gradient = v; redraw(); }));
        panel.appendChild(colours('Colour', o.fill, function (c) { o.fill = c; redraw(); }));
        if (o.gradient === 'custom') panel.appendChild(colours('Second colour', o.fill2 || '#FFFFFF', function (c) { o.fill2 = c; redraw(); }));
        panel.appendChild(slider('Curve (0 = straight)', o.curve || 0, -100, 100, 1, function (v) { o.curve = v; redraw(); }));
        panel.appendChild(slider('Letter spacing', o.letterSpacing || 0, -5, 40, 1, function (v) { o.letterSpacing = v; redraw(); }));
        panel.appendChild(slider('Line spacing', o.lineHeight || 1.15, 0.8, 2.5, 0.05, function (v) { o.lineHeight = v; redraw(); }));
        panel.appendChild(slider('Box width', o.width || 900, 200, 1733, 10, function (v) { o.width = v; redraw(); }));
        panel.appendChild(choice('Line up', o.align || 'center', { left: 'Left', center: 'Centre', right: 'Right' }, function (v) { o.align = v; redraw(); }));
        panel.appendChild(el('details', { 'class': 'dz-more' }, [el('summary', { text: 'Outline' }),
          slider('Outline thickness', o.strokeWidth || 0, 0, 20, 1, function (v) { o.strokeWidth = v; redraw(); }),
          colours('Outline colour', o.stroke || '#000428', function (c) { o.stroke = c; redraw(); })]));
      }
      if (o.type === 'sticker' || o.type === 'shape') {
        if (o.type === 'shape') {
          panel.appendChild(slider('Width', o.w, 10, 1733, 5, function (v) { o.w = v; redraw(); }));
          panel.appendChild(slider('Height', o.h, 4, 910, 5, function (v) { o.h = v; redraw(); }));
          panel.appendChild(check('Filled', !o.noFill, function (v) { o.noFill = !v; redraw(); }));
        }
        panel.appendChild(choice('Colour style', o.gradient || 'none', { none: 'One colour', gold: 'Gold', silver: 'Silver', custom: 'Two-colour gradient' }, function (v) { o.gradient = v; redraw(); }));
        panel.appendChild(colours('Colour', o.fill, function (c) { o.fill = c; redraw(); }));
        if (o.gradient === 'custom') panel.appendChild(colours('Second colour', o.fill2 || '#FFFFFF', function (c) { o.fill2 = c; redraw(); }));
        if (o.type === 'sticker') panel.appendChild(check('Glow', o.glow, function (v) { o.glow = v; redraw(); }));
        if (o.type === 'shape') {
          panel.appendChild(slider('Outline thickness', o.strokeWidth || 0, 0, 30, 1, function (v) { o.strokeWidth = v; redraw(); }));
          panel.appendChild(colours('Outline colour', o.stroke || '#F8B709', function (c) { o.stroke = c; redraw(); }));
        }
      }
      if (o.type === 'image') {
        o.adj = o.adj || {};
        panel.appendChild(row([btn('Flip', function () { o.flipX = !o.flipX; commit(true); redraw(); })]));
        panel.appendChild(el('details', { 'class': 'dz-more', open: true }, [el('summary', { text: 'Adjust and filters' })].concat(adjustControls(o.adj, redraw))));
      }
      panel.appendChild(check('Shadow', o.shadow, function (v) { o.shadow = v; redraw(); showPanel('item'); }));
      if (o.shadow) {
        panel.appendChild(colours('Shadow colour', o.shadowColor || '#000428', function (c) { o.shadowColor = c; redraw(); }));
        panel.appendChild(slider('Shadow softness', o.shadowBlur || 12, 0, 60, 1, function (v) { o.shadowBlur = v; redraw(); }));
      }
      panel.appendChild(slider('See-through', Math.round((1 - (o.opacity === undefined ? 1 : o.opacity)) * 100), 0, 95, 5, function (v) { o.opacity = 1 - v / 100; redraw(); }));
      panel.appendChild(slider('Turn', Math.round(o.rotation || 0), -180, 180, 1, function (v) { o.rotation = v; redraw(); }));
      panel.appendChild(slider('Size', Math.round((o.scale || 1) * 100), 10, 400, 1, function (v) { o.scale = v / 100; redraw(); }));
      panel.appendChild(row([
        btn('Centre', function () { o.x = W / 2; o.y = H / 2; commit(true); redraw(); }),
        btn('Forward', function () { move(o, 1); }), btn('Back', function () { move(o, -1); }),
        btn('Copy', function () { var c = clone(o); c.x += 40; c.y += 40; delete c.id; addObject(c); }),
        btn(o.locked ? 'Unlock' : 'Lock', function () { o.locked = !o.locked; commit(true); redraw(); showPanel('item'); }),
        btn('Delete', function () { D.objects.splice(D.objects.indexOf(o), 1); commit(true); select(null); drawObjects(); showPanel(''); }, 'pill pill-danger')]));
    }
  };
  function adjustControls(a, redraw) {
    return [choice('Filter', a.preset || 'none', PRESETS, function (v) { a.preset = v; redraw(); }),
      slider('Brightness', Math.round((a.brightness || 0) * 100), -60, 60, 1, function (v) { a.brightness = v / 100; redraw(); }),
      slider('Contrast', a.contrast || 0, -60, 60, 1, function (v) { a.contrast = v; redraw(); }),
      slider('Colour strength (saturation)', Math.round((a.saturation || 0) * 100), -200, 200, 5, function (v) { a.saturation = v / 100; redraw(); }),
      slider('Sharpness', Math.round((a.sharpness || 0) * 100), 0, 100, 5, function (v) { a.sharpness = v / 100; redraw(); }),
      slider('Blur', a.blur || 0, 0, 30, 1, function (v) { a.blur = v; redraw(); }),
      btn('Reset adjustments', function () { for (var x in a) delete a[x]; commit(true); redraw(); showPanel(currentTool); })];
  }
  function move(o, dir) {
    var i = D.objects.indexOf(o), j = i + dir;
    if (j < 0 || j >= D.objects.length) return;
    D.objects.splice(i, 1); D.objects.splice(j, 0, o);
    commit(true); drawObjects(); reselect();
  }

  /* =====================================================================================================
     Card details, saving, the finished pictures, publishing
     ===================================================================================================== */
  var mediumIn = root.querySelector('[data-dz-medium]'), dateIn = root.querySelector('[data-dz-date]'), titleIn = root.querySelector('[data-dz-title]');
  var whos = root.querySelector('[data-dz-whos]');
  if (whos) whos.addEventListener('change', function () {
    var v = whos.value.split('|');
    if (v.length < 2) return;
    dateIn.value = v[0]; mediumIn.value = v.slice(1).join('|');
    if (!titleIn.value || /^Thank you/.test(titleIn.value)) titleIn.value = 'Thank you, ' + mediumIn.value;
    dirty = true;
  });
  [mediumIn, dateIn, titleIn].forEach(function (i) { i.addEventListener('input', function () { dirty = true; }); });
  var statusBox = root.querySelector('[data-dz-status]');
  var busy = false;
  var published = boot.status === 'published';

  function snapshot(withBadge, width, height) {
    var keep = tr.nodes(); tr.nodes([]); guideV.visible(false); guideH.visible(false);
    badgeLayer.visible(!!withBadge);
    stage.batchDraw();
    var big = stage.toCanvas({ pixelRatio: W / stage.width() });
    badgeLayer.visible(true); tr.nodes(keep); stage.batchDraw();
    var c = document.createElement('canvas');
    c.width = width; c.height = height;
    var x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(big, 0, 0, width, height);
    return c;
  }
  function blobOf(canvas, q) { return new Promise(function (resolve, reject) { canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('picture')); }, 'image/jpeg', q || 0.92); }); }
  function ready() {
    return Promise.all(D.objects.filter(function (o) { return o.type === 'text'; }).map(loadFont).concat(D.objects.filter(function (o) { return o.type === 'image'; }).map(function (o) { return loadImg(o.src); }))).then(function () { return document.fonts ? document.fonts.ready : null; })
      .then(function () { return renderAll(); });
  }
  function fields() {
    var fd = new FormData();
    fd.append('_csrf', boot.csrf); fd.append('design', JSON.stringify(D));
    fd.append('medium_name', mediumIn.value); fd.append('wed_date', dateIn.value); fd.append('title', titleIn.value);
    return fd;
  }
  function send(url, fd) {
    return fetch(url, { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, message: 'No connection. Please check your signal and try again.' }; });
  }
  function save() {
    if (busy) return;
    if (published) { publish(true); return; }
    busy = true; statusBox.textContent = 'Saving…';
    send('/admin/designer/' + boot.id + '/save', fields()).then(function (r) { busy = false; statusBox.textContent = r.message || ''; if (r.ok) dirty = false; });
  }
  function publish(update) {
    if (busy) return;
    var q = update || published ? 'Update the published card? The changes will show on its Community page straight away.' : 'Publish this card now? It will get its own Community page and link. (The Community stays hidden until you launch it.)';
    if (!window.confirm(q)) return;
    busy = true; statusBox.textContent = 'Making the finished pictures…';
    ready().then(function () {
      var art = snapshot(false, 1733, 910), share = snapshot(true, 1200, 630);
      return Promise.all([blobOf(art, 0.9), blobOf(share, 0.9)]);
    }).then(function (b) {
      statusBox.textContent = 'Publishing…';
      var fd = fields();
      fd.append('art', new File([b[0]], 'art.jpg', { type: 'image/jpeg' }));
      fd.append('share', new File([b[1]], 'share.jpg', { type: 'image/jpeg' }));
      return send('/admin/designer/' + boot.id + '/publish', fd);
    }).then(function (r) {
      busy = false;
      statusBox.textContent = r.message || '';
      if (!r.ok) return;
      dirty = false; published = true;
      root.querySelector('[data-dz-state]').textContent = 'Published';
      root.querySelector('[data-dz-save]').textContent = 'Update';
      root.querySelector('[data-dz-publish]').textContent = 'Update published card';
      var box = root.querySelector('[data-dz-linkbox]'); box.hidden = false;
      if (r.link) { boot.link = r.link; root.querySelector('[data-dz-link]').value = r.link; }
    }).catch(function () { busy = false; statusBox.textContent = 'Sorry, the pictures could not be made, so nothing was published. Please try again.'; });
  }
  root.querySelector('[data-dz-save]').addEventListener('click', save);
  root.querySelector('[data-dz-publish]').addEventListener('click', function () { publish(false); });
  root.querySelector('[data-dz-download]').addEventListener('click', function () {
    if (busy) return;
    busy = true; statusBox.textContent = 'Making the picture…';
    ready().then(function () { return blobOf(snapshot(true, 1733, 910), 0.92); }).then(function (blob) {
      var a = document.createElement('a'), url = URL.createObjectURL(blob);
      a.href = url; a.download = 'New-Ways-' + (boot.slug || 'artwork') + '.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      busy = false; statusBox.textContent = 'Downloaded. Find it in your phone’s Downloads or Gallery, then add it to your Facebook post.';
    }).catch(function () { busy = false; statusBox.textContent = 'Sorry, the picture could not be made. Please try again.'; });
  });
  root.querySelector('[data-dz-copy]').addEventListener('click', function () {
    var input = root.querySelector('[data-dz-link]');
    var done = function () { statusBox.textContent = 'Link copied. Paste it into your Facebook post.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); statusBox.textContent = 'Press and hold the link, then choose Copy.'; });
    else { input.select(); try { document.execCommand('copy'); done(); } catch (e) { statusBox.textContent = 'Press and hold the link, then choose Copy.'; } }
  });
  root.querySelector('[data-dz-template]').addEventListener('click', function () {
    var name = window.prompt('Name for this template:', titleIn.value || 'My template');
    if (!name) return;
    var fd = fields(); fd.append('name', name);
    send('/admin/designer/' + boot.id + '/template', fd).then(function (r) { statusBox.textContent = r.message || ''; });
  });

  /* ---------- start ---------- */
  fitStage();
  renderAll().then(function () { hint.textContent = ''; showPanel(''); updateUndo(); });
  window.__dz = { design: function () { return D; }, stage: stage, snapshot: snapshot, ready: ready };   // used by the automated browser checks
})();
