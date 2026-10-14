/* New Way's Community: the thank-you card, shared by the website (server) and Admin's card editor (phone).
   One copy of the drawing rules, so the card on the website, the editor's live preview and the Facebook image
   all come from exactly the same layout.

   A card is drawn in layers, so nothing is flattened into the background on the website:
     1. the background picture (one of the nine approved designs, a normal <img> with phone and desktop sizes),
     2. on top, an SVG drawing 1200 x 630 units (the shape of a Facebook picture) holding the wording as real text and
        the official New Way's badge as its own layer, with its gold shimmer (community.css).
   Positions are numbers in that 1200 x 630 space, given as attributes, so the website's security rules (no inline
   styles) stay exactly as they are.

   For the Facebook image, the same layout is painted onto a canvas on the phone (exportJpeg), with the badge still. */
(function (root) {
  'use strict';
  var W = 1200, H = 630;
  // The nine approved designs (design 07 is not part of the set). Files: /images/community/bg-NN-{thumb,800,1200,full}.webp
  var BACKGROUNDS = ['01', '02', '03', '04', '05', '06', '08', '09', '10'];
  var FULL_WIDTH = { '02': 1732, '06': 1732 };   // two originals were one pixel narrower
  var BADGE_SRC = '/images/logo-720.webp';
  var BADGE_EXPORT_SRC = '/images/new-ways-logo.jpg';   // the larger copy of the same badge, for sharp Facebook images
  var FONTS = {
    cinzel: "'Cinzel', 'Trajan Pro', Georgia, serif",
    jost: "'Jost', 'Helvetica Neue', Arial, sans-serif",
    cormorant: "'Cormorant Garamond', Garamond, Georgia, serif",
    vibes: "'Great Vibes', 'Brush Script MT', cursive"
  };
  var FONT_NAMES = { cinzel: 'Cinzel (capitals)', jost: 'Jost (clean)', cormorant: 'Cormorant (elegant)', vibes: 'Great Vibes (script)' };
  var WEIGHTS = [400, 500, 600, 700];
  var ANCHORS = ['start', 'middle', 'end'];
  var ROLES = ['heading', 'name', 'message', 'date'];

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, min, max, fallback) {
    var n = Number(v);
    return (v !== '' && v !== null && v !== undefined && isFinite(n)) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : fallback;
  }
  function round(n) { return Math.round(n * 10) / 10; }
  function cleanLine(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  function colour(v, fallback) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : fallback; }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  function backgroundSources(id) {
    var bg = BACKGROUNDS.indexOf(id) !== -1 ? id : BACKGROUNDS[0];
    var full = FULL_WIDTH[bg] || 1733;
    var base = '/images/community/bg-' + bg + '-';
    return { src: base + '1200.webp', full: base + 'full.webp', thumb: base + 'thumb.webp',
      srcset: base + '800.webp 800w, ' + base + '1200.webp 1200w, ' + base + 'full.webp ' + full + 'w' };
  }

  // ---------- the layout (always checked again on the server before it is saved) ----------
  function cleanLayout(input) {
    var src = input && typeof input === 'object' ? input : {};
    var texts = (Array.isArray(src.texts) ? src.texts : []).slice(0, 8).map(function (t) {
      t = t && typeof t === 'object' ? t : {};
      var lines = (Array.isArray(t.lines) ? t.lines : [t.text]).map(cleanLine).filter(function (l) { return l !== ''; }).slice(0, 6);
      var out = {
        lines: lines,
        x: num(t.x, 0, W, W / 2),
        y: num(t.y, 0, H, H / 2),
        anchor: ANCHORS.indexOf(t.anchor) !== -1 ? t.anchor : 'middle',
        font: has(FONTS, t.font) ? t.font : 'cinzel',
        size: num(t.size, 10, 160, 48),
        weight: WEIGHTS.indexOf(Number(t.weight)) !== -1 ? Number(t.weight) : 600,
        color: colour(t.color, '#FFFFFF'),
        lineHeight: num(t.lineHeight, 0.8, 2.5, 1.15),
        spacing: num(t.spacing, 0, 30, 0)
      };
      if (ROLES.indexOf(t.role) !== -1) out.role = t.role;
      return out;
    }).filter(function (t) { return t.lines.length; });
    var b = src.badge && typeof src.badge === 'object' ? src.badge : {};
    return {
      v: 1,
      background: BACKGROUNDS.indexOf(src.background) !== -1 ? src.background : BACKGROUNDS[0],
      texts: texts,
      badge: { show: b.show !== false, x: num(b.x, 0, W, 1040), y: num(b.y, 0, H, 150), size: num(b.size, 40, 600, 200) },
      shimmer: src.shimmer !== false,
      shadow: src.shadow === true
    };
  }

  function cardWording(layout) {
    return layout.texts.map(function (t) { return t.lines.join(' '); }).join('. ');
  }

  // ---------- the website card (SVG layer on top of the background picture) ----------
  function badgeParts(b, id, shimmer) {
    var r = b.size / 2, x = b.x - r, y = b.y - r, band = b.size * 0.6, clip = 'nwc-bc-' + id;
    var defs = '<clipPath id="' + clip + '"><circle cx="' + b.x + '" cy="' + b.y + '" r="' + round(r * 0.985) + '"/></clipPath>\n' +
      '<radialGradient id="nwc-halo-' + id + '"><stop offset="0.62" stop-color="#F8B709" stop-opacity="0.55"/><stop offset="1" stop-color="#F8B709" stop-opacity="0"/></radialGradient>\n' +
      (shimmer ? '<linearGradient id="nwc-shine-' + id + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFED81" stop-opacity="0"/><stop offset="0.45" stop-color="#FFF6C8" stop-opacity="0.55"/><stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.7"/><stop offset="1" stop-color="#FFED81" stop-opacity="0"/></linearGradient>' : '');
    var body = '<g class="nwc-badge" data-role="badge">\n' +
      '<circle class="nwc-halo" cx="' + b.x + '" cy="' + b.y + '" r="' + round(r * 1.22) + '" fill="url(#nwc-halo-' + id + ')"/>\n' +
      '<image href="' + BADGE_SRC + '" x="' + round(x) + '" y="' + round(y) + '" width="' + b.size + '" height="' + b.size + '" clip-path="url(#' + clip + ')" preserveAspectRatio="xMidYMid slice"/>\n' +
      (shimmer ? '<g clip-path="url(#' + clip + ')"><g transform="translate(' + b.x + ' ' + b.y + ') skewX(-18) translate(' + (-b.x) + ' ' + (-b.y) + ')"><rect class="nwc-shine" x="' + round(x - band) + '" y="' + round(y - r * 0.2) + '" width="' + round(band) + '" height="' + round(b.size * 1.4) + '" fill="url(#nwc-shine-' + id + ')"/></g></g>' : '') +
      '\n</g>';
    return { defs: defs, body: body };
  }

  function layerSvg(layout, id, words) {
    var L = cleanLayout(layout);
    var label = words || cardWording(L) || 'New Way’s thank-you card';
    var shadow = L.shadow ? 'url(#nwc-sh-' + id + ')' : '';
    var badge = L.badge.show ? badgeParts(L.badge, id, L.shimmer) : null;
    var texts = L.texts.map(function (t) {
      return '<text' + (t.role ? ' data-role="' + t.role + '"' : '') + ' x="' + t.x + '" y="' + t.y + '" text-anchor="' + t.anchor + '" font-family="' + esc(FONTS[t.font]) +
        '" font-size="' + t.size + '" font-weight="' + t.weight + '" fill="' + t.color + '"' + (t.spacing ? ' letter-spacing="' + t.spacing + '"' : '') +
        (shadow ? ' filter="' + shadow + '"' : '') + '>' + t.lines.map(function (line, i) {
          return '<tspan x="' + t.x + '"' + (i ? ' dy="' + round(t.size * t.lineHeight) + '"' : '') + '>' + esc(line) + '</tspan>';
        }).join('') + '</text>';
    }).join('');
    return '<svg class="nwc-layer" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '" focusable="false">\n<defs>\n' +
      (L.shadow ? '<filter id="nwc-sh-' + id + '" x="-20%" y="-40%" width="140%" height="180%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000428" flood-opacity="0.85"/><feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="#000428" flood-opacity="0.7"/></filter>' : '') +
      '\n' + (badge ? badge.defs : '') + '\n</defs>\n' + (badge ? badge.body : '') + '\n' + texts + '\n</svg>';
  }

  function cardHtml(layout, opts) {
    opts = opts || {};
    var L = cleanLayout(layout);
    var bg = backgroundSources(L.background);
    return '<div class="nwc-card' + (L.shimmer ? ' nwc-animate' : '') + '">\n' +
      '<img class="nwc-bg" src="' + bg.src + '" srcset="' + bg.srcset + '" sizes="(max-width: 760px) 100vw, 760px" width="1200" height="628" alt=""' +
      (opts.priority ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">\n' + layerSvg(L, opts.id || 'c', opts.alt) + '\n</div>';
  }

  // ---------- the Facebook image: the same layout painted on a canvas, with the badge still ----------
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not load ' + src)); };
      img.src = src;
    });
  }
  function fontSpec(t) { return t.weight + ' ' + t.size + 'px ' + FONTS[t.font]; }
  function loadFonts(L) {
    if (!root.document || !document.fonts || !document.fonts.load) return Promise.resolve();
    var all = Promise.all(L.texts.map(function (t) { return document.fonts.load(fontSpec(t), t.lines.join(' ')).catch(function () {}); }));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 4000); })]);
  }

  function paint(ctx, L, width, height, bgImg, logoImg) {
    var s = width / W;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    // background: fills the whole picture (the designs are already this shape, so at most a sliver is trimmed)
    var ir = bgImg.naturalWidth / bgImg.naturalHeight, cr = width / height, sw, sh, sx, sy;
    if (ir > cr) { sh = bgImg.naturalHeight; sw = sh * cr; sx = (bgImg.naturalWidth - sw) / 2; sy = 0; }
    else { sw = bgImg.naturalWidth; sh = sw / cr; sx = 0; sy = (bgImg.naturalHeight - sh) / 2; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, width, height);
    ctx.scale(s, height / H);
    // the badge (still): soft gold halo, then the logo as a circle
    if (L.badge.show && logoImg) {
      var b = L.badge, r = b.size / 2;
      ctx.save();
      ctx.globalAlpha = 0.5;
      var g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 1.22);
      g.addColorStop(0, 'rgba(248,183,9,0.55)'); g.addColorStop(0.62, 'rgba(248,183,9,0.55)'); g.addColorStop(1, 'rgba(248,183,9,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, r * 1.22, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.985, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(logoImg, b.x - r, b.y - r, b.size, b.size);
      ctx.restore();
    }
    // the wording
    var align = { start: 'left', middle: 'center', end: 'right' };
    L.texts.forEach(function (t) {
      ctx.save();
      ctx.font = fontSpec(t);
      ctx.textAlign = align[t.anchor];
      ctx.textBaseline = 'alphabetic';
      if ('letterSpacing' in ctx) ctx.letterSpacing = t.spacing ? t.spacing + 'px' : '0px';
      ctx.fillStyle = t.color;
      var draw = function () {
        t.lines.forEach(function (line, i) { ctx.fillText(line, t.x, t.y + i * round(t.size * t.lineHeight)); });
      };
      if (L.shadow) {   // the soft shadow (same as the website's): a wide glow and a close shadow
        ctx.shadowColor = 'rgba(0,4,40,0.7)'; ctx.shadowBlur = 24 * s; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; draw();
        ctx.shadowColor = 'rgba(0,4,40,0.85)'; ctx.shadowBlur = 6 * s; ctx.shadowOffsetY = 3 * s; draw();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      }
      draw();
      ctx.restore();
    });
    ctx.restore();
  }

  // Resolves with a JPEG Blob. width x height: 1200 x 630 (Facebook link preview) or 1733 x 910 (download).
  function exportJpeg(layout, opts) {
    opts = opts || {};
    var L = cleanLayout(layout);
    var width = opts.width || W, height = opts.height || H;
    var bg = backgroundSources(L.background);
    return Promise.all([loadImage(width > 1200 ? bg.full : bg.src), L.badge.show ? loadImage(BADGE_EXPORT_SRC) : Promise.resolve(null), loadFonts(L)])
      .then(function (parts) {
        var canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        var ctx = canvas.getContext('2d');
        paint(ctx, L, width, height, parts[0], parts[1]);
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('The picture could not be made.')); }, 'image/jpeg', opts.quality || 0.92);
        });
      });
  }

  root.NWCard = {
    W: W, H: H, BACKGROUNDS: BACKGROUNDS, FONTS: FONTS, FONT_NAMES: FONT_NAMES, WEIGHTS: WEIGHTS, ANCHORS: ANCHORS, ROLES: ROLES,
    BADGE_SRC: BADGE_SRC, esc: esc, cleanLayout: cleanLayout, cardWording: cardWording, backgroundSources: backgroundSources,
    layerSvg: layerSvg, cardHtml: cardHtml, exportJpeg: exportJpeg, paint: paint
  };
})(typeof window !== 'undefined' ? window : globalThis);
