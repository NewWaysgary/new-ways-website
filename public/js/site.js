/* New Way’s website and app: small enhancements on top of normal web pages.
   Every page works without this script; it adds the app feel. */
(function () {
  'use strict';

  var reduceMotion = function () {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  /* ---------- Placeholder notices (as in the approved app: shown until a Square link is added) ---------- */
  function closeNotices(scope) {
    (scope || document).querySelectorAll('[data-notice]').forEach(function (button) {
      button.setAttribute('aria-expanded', 'false');
      var notice = document.getElementById(button.getAttribute('data-notice'));
      if (notice) notice.hidden = true;
    });
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-notice]') : null;
    if (!button) return;
    var notice = document.getElementById(button.getAttribute('data-notice'));
    if (!notice) return;
    var open = notice.hidden;
    closeNotices(button.closest('main'));
    notice.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });

  /* ---------- Menu ---------- */
  var lastFocus = null;
  function menu() { return document.getElementById('site-menu'); }
  function setExpanded(value) {
    document.querySelectorAll('[data-menu-open]').forEach(function (b) { b.setAttribute('aria-expanded', value); });
  }
  function openMenu(trigger) {
    var m = menu();
    if (!m) return;
    lastFocus = trigger || document.activeElement;
    m.hidden = false;
    document.body.classList.add('menu-open');
    setExpanded('true');
    var close = m.querySelector('[data-menu-close]');
    if (close) close.focus();
  }
  function closeMenu(restoreFocus) {
    var m = menu();
    if (!m || m.hidden) return;
    m.hidden = true;
    document.body.classList.remove('menu-open');
    setExpanded('false');
    if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  document.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-menu-open]');
    if (opener) { event.preventDefault(); openMenu(opener); return; }
    if (event.target.closest('[data-menu-close]')) closeMenu(true);
  });
  document.addEventListener('keydown', function (event) {
    var m = menu();
    if (!m || m.hidden) return;
    if (event.key === 'Escape') { closeMenu(true); return; }
    if (event.key === 'Tab') {
      var items = m.querySelectorAll('a[href], button');
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  /* ---------- Moving between pages without reloading (keeps the music area playing) ---------- */
  var canNavigate = 'fetch' in window && 'DOMParser' in window && history.pushState && document.getElementById('persistent');
  var navCount = 0;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  function isPageLink(a, event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download') || a.getAttribute('rel') === 'external') return false;
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return false;
    if (/^\/(admin|media)(\/|$)/.test(url.pathname)) return false;
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return false;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
    return true;
  }

  function syncHead(doc) {
    ['meta[name="description"]', 'link[rel="canonical"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]'].forEach(function (sel) {
      var next = doc.querySelector(sel), current = document.querySelector(sel);
      if (next && current) {
        if (current.hasAttribute('content')) current.setAttribute('content', next.getAttribute('content'));
        if (current.hasAttribute('href')) current.setAttribute('href', next.getAttribute('href'));
      }
    });
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) { s.remove(); });
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) { document.head.appendChild(document.importNode(s, true)); });
  }

  function navigate(href, push, scrollY) {
    var mine = ++navCount;
    closeMenu(false);
    if (push) history.replaceState({ scroll: window.scrollY }, '');
    fetch(href, { headers: { 'X-NW-Nav': '1' }, credentials: 'same-origin' })
      .then(function (res) {
        var type = res.headers.get('Content-Type') || '';
        if (type.indexOf('text/html') === -1) throw new Error('not a page');
        return res.text().then(function (text) { return { res: res, text: text }; });
      })
      .then(function (r) {
        if (mine !== navCount) return;
        var doc = new DOMParser().parseFromString(r.text, 'text/html');
        var next = doc.getElementById('page');
        var current = document.getElementById('page');
        if (!next || !current) throw new Error('no page');
        var finalUrl = r.res.url && new URL(r.res.url).origin === location.origin ? r.res.url : href;
        var hash = new URL(href, location.href).hash;
        var swap = function () {
          current.replaceWith(document.adoptNode(next));
          document.title = doc.title;
          document.body.className = doc.body.className;
          syncHead(doc);
          if (push) history.pushState({ scroll: 0 }, '', finalUrl.split('#')[0] + hash);
          var target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
          if (typeof scrollY === 'number') window.scrollTo(0, scrollY);
          else if (target) target.scrollIntoView();
          else window.scrollTo(0, 0);
          var heading = document.querySelector('#page h1');
          if (heading) heading.focus({ preventScroll: true });
          if (viewer && viewer.open) viewer.close();
          document.dispatchEvent(new CustomEvent('nw:page-changed'));
        };
        if (document.startViewTransition && !reduceMotion()) document.startViewTransition(swap);
        else swap();
      })
      .catch(function () { location.assign(href); });
  }

  if (canNavigate) {
    document.addEventListener('click', function (event) {
      var a = event.target.closest ? event.target.closest('a[href]') : null;
      if (!a || !isPageLink(a, event)) return;
      event.preventDefault();
      navigate(a.href, true);
    });
    window.addEventListener('popstate', function (event) {
      navigate(location.href, false, event.state && typeof event.state.scroll === 'number' ? event.state.scroll : 0);
    });
  }

  /* ---------- YouTube: nothing loads from YouTube until the visitor taps play ---------- */
  document.addEventListener('click', function (event) {
    var start = event.target.closest('a[data-yt]');
    if (!start || event.metaKey || event.ctrlKey || event.shiftKey) return;
    var id = start.getAttribute('data-yt');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    event.preventDefault();
    var frame = document.createElement('iframe');
    frame.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
    frame.title = start.getAttribute('data-title') || 'YouTube video';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    start.parentNode.replaceChild(frame, start);
    document.dispatchEvent(new CustomEvent('nw:video-play'));
  });

  /* ---------- Background music: only ever starts when the visitor taps Music ---------- */
  (function () {
    var box = document.querySelector('[data-music]');
    if (!box) return;
    var audio = box.querySelector('audio');
    var toggle = box.querySelector('[data-music-toggle]');
    var mute = box.querySelector('[data-music-mute]');
    var label = box.querySelector('.music-sr');
    var KEY = 'nw-music';
    var pref = {};
    try { pref = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { pref = {}; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) { /* private browsing */ } }
    audio.volume = Math.min(1, Math.max(0, (Number(box.getAttribute('data-volume')) || 40) / 100));
    audio.muted = !!pref.muted;
    function render() {
      var playing = !audio.paused;
      box.classList.toggle('is-playing', playing);
      box.classList.toggle('is-muted', audio.muted);
      box.classList.toggle('has-started', !!pref.started);
      toggle.setAttribute('aria-pressed', String(playing));
      label.textContent = playing ? 'Pause background music' : 'Play background music';
      mute.hidden = !pref.started;
      mute.setAttribute('aria-pressed', String(audio.muted));
      mute.querySelector('.sr-only').textContent = audio.muted ? 'Unmute music' : 'Mute music';
    }
    toggle.addEventListener('click', function () {
      if (audio.paused) {
        var p = audio.play();
        pref.started = true; pref.choice = 'on'; save();
        if (p && p.catch) p.catch(function () { render(); });
      } else {
        audio.pause();
        pref.choice = 'off'; save();
      }
      render();
    });
    mute.addEventListener('click', function () {
      audio.muted = !audio.muted;
      pref.muted = audio.muted; save();
      render();
    });
    ['play', 'pause', 'volumechange'].forEach(function (e) { audio.addEventListener(e, render); });
    document.addEventListener('nw:video-play', function () { if (!audio.paused) audio.pause(); });
    render();
  })();

  /* ---------- Gallery photo viewer ---------- */
  var viewer = null;
  function openViewer(link) {
    var links = Array.prototype.slice.call(document.querySelectorAll('#page a[data-lightbox]'));
    var index = links.indexOf(link);
    if (!viewer) {
      viewer = document.createElement('dialog');
      viewer.className = 'viewer';
      viewer.setAttribute('aria-label', 'Photo');
      viewer.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure>' +
        '<button type="button" class="viewer-btn viewer-close" aria-label="Close">×</button>' +
        '<button type="button" class="viewer-btn viewer-prev" aria-label="Previous photo">‹</button>' +
        '<button type="button" class="viewer-btn viewer-next" aria-label="Next photo">›</button>';
      document.body.appendChild(viewer);
      viewer.querySelector('.viewer-close').addEventListener('click', function () { viewer.close(); });
      viewer.addEventListener('click', function (e) { if (e.target === viewer) viewer.close(); });
      viewer.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') viewer.querySelector('.viewer-next').click();
        if (e.key === 'ArrowLeft') viewer.querySelector('.viewer-prev').click();
      });
    }
    function show(i) {
      index = (i + links.length) % links.length;
      var l = links[index];
      var img = viewer.querySelector('img');
      img.src = l.getAttribute('href');
      img.alt = (l.querySelector('img') && l.querySelector('img').alt) || '';
      viewer.querySelector('figcaption').textContent = l.getAttribute('data-caption') || '';
    }
    viewer.querySelector('.viewer-prev').onclick = function () { show(index - 1); };
    viewer.querySelector('.viewer-next').onclick = function () { show(index + 1); };
    viewer.querySelector('.viewer-prev').hidden = viewer.querySelector('.viewer-next').hidden = links.length < 2;
    show(index);
    if (!viewer.open) viewer.showModal();
  }
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[data-lightbox]');
    if (!link || !window.HTMLDialogElement || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    openViewer(link);
  });

  /* ---------- Share your experience: the free Cloudflare Turnstile check, and clearing the stars ---------- */
  function setUpTurnstile() {
    var box = document.querySelector('#page .cf-turnstile');
    if (!box) return;
    if (window.turnstile && window.turnstile.render) { try { window.turnstile.render(box); } catch (e) { /* already shown */ } return; }
    if (document.querySelector('script[data-turnstile]')) return;
    var s = document.createElement('script');
    s.src = box.getAttribute('data-script');
    s.async = true; s.defer = true;
    s.setAttribute('data-turnstile', '');
    document.head.appendChild(s);
  }
  setUpTurnstile();
  document.addEventListener('nw:page-changed', setUpTurnstile);
  document.addEventListener('click', function (event) {
    if (!event.target.closest('[data-star-clear]')) return;
    document.querySelectorAll('#page input[name="rating"]').forEach(function (r) { r.checked = false; });
  });

  /* ---------- Installable app and offline support ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
