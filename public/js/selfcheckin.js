/* New Way’s iPad self check-in (the screens guests use at the entrance).
   - Scan QR Code: the iPad's front camera reads the booking QR code (jsQR, inside the page). Every guest on that
     booking is shown; the guests who are here tap their names and Check In. The others check in when they arrive.
   - Enter Your Name: a guest without their QR code types their full name. Exactly one guest with that name: they tap
     Check In. Two or more guests with exactly that name: they're asked to see Julie.
   - Admin (Gary or Julie) chooses the event, TEST or LIVE, and opens, pauses or closes check-in. The iPad asks every
     few seconds and changes screen straight away.

   WORKING THROUGH A DROPPED CONNECTION (the iPad uses Julie's phone hotspot):
   - While check-in is open, the iPad keeps an up-to-date copy of the event's guest list (names and whether they have
     arrived; QR codes only in scrambled form), with a ticket signed by the website (which event, TEST or LIVE, valid
     12 hours). It is stored ENCRYPTED on the iPad, with a key that can't be taken out of this page.
   - If the connection drops, guests carry on checking in from that copy. Each check-in is saved (encrypted) on the
     iPad BEFORE the guest is told, so nothing is lost if the page is closed or the iPad restarts. The screen says
     clearly that the iPad is offline and how many check-ins are waiting to be sent.
   - When the connection returns they are sent by themselves. The website checks each one again and records it once;
     anything it can't accept is shown to Julie. A QR code the copy can't confirm is never accepted offline: the
     guest is asked to see Julie.
   - After an event (check-in closed or another event chosen), the copy is deleted, but only once every saved
     check-in has been sent. */
(function () {
  'use strict';
  var app = document.getElementById('sc-app');
  if (!app) return;
  var VERSION = app.getAttribute('data-version');
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var screens = {};
  Array.prototype.forEach.call(document.querySelectorAll('[data-screen]'), function (el) { screens[el.getAttribute('data-screen')] = el; });

  var current = 'loading';
  var idleTimer = null, stateTimer = null, failures = 0;
  var IDLE = { scan: 60, booking: 60, name: 60, one: 60, done: 7, message: 15 };
  var JULIE_SAME_NAME = 'We have found more than one guest with this name. Please see Julie for assistance with your check-in.';
  var session = { state: 'loading', mode: 'test', eventId: 0 };   // from Admin (kept on the iPad for when offline)
  var HOLD = { closed: 1, paused: 1 };

  // ---------- the same name rule as the website (src/selfcheckin/names.js) ----------
  function nameKey(raw) {
    return String(raw || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[’‘'`´.]/g, '').replace(/[-‐‑‒–—_,]/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  }
  function tokenFromScan(text) {
    var s = String(text || '').trim().slice(0, 300);
    var m = s.match(/\/c\/([A-Za-z0-9_-]{22})(?:[?#/]|$)/) || s.match(/^([A-Za-z0-9_-]{22})$/);
    return m ? m[1] : null;
  }
  function newId() {
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // ---------- encrypted storage on the iPad (IndexedDB + AES-GCM with a key that can't be exported) ----------
  var store = (function () {
    var dbp = null, keyp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        if (!window.indexedDB || !window.crypto || !crypto.subtle) { rej(new Error('no storage')); return; }
        var r = indexedDB.open('nw-self-checkin', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function raw(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var tx = d.transaction('kv', mode);
          var req = fn(tx.objectStore('kv'));
          tx.oncomplete = function () { res(req && req.result); };
          tx.onerror = tx.onabort = function () { rej(tx.error || new Error('storage')); };
        });
      });
    }
    function key() {
      if (keyp) return keyp;
      keyp = raw('readonly', function (s) { return s.get('aes'); }).then(function (k) {
        if (k) return k;
        return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (nk) {
          return raw('readwrite', function (s) { return s.put(nk, 'aes'); }).then(function () { return nk; });
        });
      });
      return keyp;
    }
    return {
      get: function (name) {
        return raw('readonly', function (s) { return s.get(name); }).then(function (v) {
          if (!v) return null;
          return key().then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv }, k, v.data); })
            .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
        });
      },
      set: function (name, value) {
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return key().then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(value))); })
          .then(function (data) { return raw('readwrite', function (s) { return s.put({ iv: iv, data: data }, name); }); });
      },
      del: function (name) { return raw('readwrite', function (s) { return s.delete(name); }); }
    };
  })();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  // ---------- the event copy (pack) and the saved check-ins (queue) ----------
  var pack = null, idx = null, queue = [], notes = [], storageOk = true, stuck = 0, syncing = false;
  function indexPack() {
    idx = { byHash: {}, guests: {}, byBooking: {} };
    if (!pack) return;
    pack.bookings.forEach(function (b) { idx.byHash[b[1]] = { id: b[0], ok: !!b[2] }; });
    pack.guests.forEach(function (g) {
      var x = { id: g[0], b: g[1], name: g[2], k: g[3], in: !!g[4] };
      idx.guests[x.id] = x;
      (idx.byBooking[x.b] = idx.byBooking[x.b] || []).push(x);
    });
  }
  function packReady() {
    return !!(pack && idx && storageOk && pack.expires > Date.now() && pack.eventId === session.eventId && pack.mode === session.mode);
  }
  function savePack() { return pack ? store.set('pack', pack) : store.del('pack'); }
  function saveQueue() { return store.set('queue', { items: queue, notes: notes }); }
  function queuedGuest(gid) { return queue.some(function (q) { return q.gid === gid; }); }
  function isIn(gid) { var g = idx && idx.guests[gid]; return !!(g && g.in) || queuedGuest(gid); }

  function loadSaved() {
    return Promise.all([store.get('pack'), store.get('queue'), store.get('session')]).then(function (r) {
      pack = r[0]; indexPack();
      queue = (r[1] && r[1].items) || []; notes = (r[1] && r[1].notes) || [];
      if (r[2]) session = r[2];
    }).catch(function () { storageOk = false; });
  }

  function refreshPack(st) {
    var wanted = st.packStamp && st.event;
    if (!wanted) {
      // Check-in closed or no event: delete the copy once nothing is waiting to be sent
      if (pack && !queue.length) { pack = null; indexPack(); savePack().catch(function () {}); }
      return Promise.resolve();
    }
    if (pack && pack.stamp === st.packStamp && pack.eventId === st.event.id && pack.mode === st.mode && pack.expires - Date.now() > 2 * 3600000) return Promise.resolve();
    return api('pack').then(function (r) {
      if (!r || r.result !== 'pack') return;
      pack = r.pack;
      // Guests saved on the iPad but not sent yet stay "arrived" in the new copy
      indexPack();
      return savePack();
    }).catch(function () {});
  }

  // ---------- moving between screens ----------
  function home() { return session.state === 'active' ? 'welcome' : session.state === 'paused' ? 'paused' : 'closed'; }

  function show(name, seconds) {
    if (!screens[name]) return;
    if (current === 'scan' && name !== 'scan') pauseScanning();
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('is-active', k === name); });
    current = name;
    window.scrollTo(0, 0);
    resetIdle(seconds);
    var timer = screens[name].querySelector('[data-timer]');
    if (timer) {
      timer.classList.remove('is-running');
      void timer.offsetWidth;
      timer.style.setProperty('--sc-time', (seconds || IDLE[name] || 10) + 's');
      timer.classList.add('is-running');
    }
    if (name === 'welcome' || HOLD[name]) clearGuest();
    if (name === 'scan') startScanning();
  }

  function resetIdle(seconds) {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    var s = seconds || IDLE[current];
    if (s) idleTimer = setTimeout(function () { show(home()); }, s * 1000);
  }
  ['pointerdown', 'keydown', 'input'].forEach(function (type) {
    document.addEventListener(type, function () { if (current !== 'done' && current !== 'message') resetIdle(); }, { passive: true });
  });

  // Nothing the last guest saw or typed is left on the screen
  function clearGuest() {
    var input = $('[data-name-input]');
    if (input) { input.value = ''; input.blur(); }
    ['[data-name-status]', '[data-scan-status]', '[data-retry-status]', '[data-retry-status-one]'].forEach(function (s) { say($(s), ''); });
    $('[data-guests]').textContent = '';
    $('[data-one-name]').textContent = '';
    $('[data-done-names]').textContent = '';
    $('[data-msg-text]').textContent = '';
    lastCode = ''; typedName = ''; oneGuest = null; bookingOffline = false;
  }

  function say(el, text, bad) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-bad', !!bad);
  }

  function message(title, text, retry) {
    $('[data-msg-title]').textContent = title;
    $('[data-msg-text]').textContent = text;
    var r = $('[data-msg-retry]');
    r.hidden = !retry;
    r.onclick = retry || null;
    show('message');
  }

  // ---------- connection status (always visible when it matters) ----------
  function offlineNow() { return failures > 0 || navigator.onLine === false; }
  function oldestPending() { return queue.length ? queue.reduce(function (a, q) { return q.at < a ? q.at : a; }, queue[0].at) : ''; }
  function updateNet() {
    var el = $('[data-net]');
    var n = queue.length;
    var text = '', cls = '';
    if (offlineNow()) {
      cls = 'is-offline';
      text = packReady() && session.state === 'active'
        ? 'Offline: check-ins are being saved on this iPad' + (n ? ' (' + n + ' waiting to be sent)' : '')
        : 'Offline: the iPad has lost its internet connection. Please see Julie to check in.';
    } else if (stuck) {
      cls = 'is-stuck'; text = n + ' saved check-in' + (n === 1 ? '' : 's') + ' couldn’t be sent. Please tell Gary or Julie.';
    } else if (n) {
      cls = 'is-sending'; text = 'Sending ' + n + ' saved check-in' + (n === 1 ? '' : 's') + '…';
    }
    el.textContent = text;
    el.className = 'sc-net ' + cls;
    el.hidden = !text;
  }

  // ---------- talking to the website ----------
  function api(path, body) {
    var headers = body ? { 'Content-Type': 'application/json' } : {};
    if (path === 'state') headers['X-NW-Pending'] = queue.length + (queue.length ? '|' + oldestPending() : '');
    return fetch('/self-checkin/api/' + path, body ? { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: headers, body: JSON.stringify(body) }
      : { credentials: 'same-origin', cache: 'no-store', headers: headers }).then(function (r) {
      if (r.status === 401) { disconnected(); return new Promise(function () {}); }
      return r.json().then(function (j) { failures = 0; updateNet(); return j; });
    }).catch(function (err) {
      if (err && err.name === 'SyntaxError') throw err;
      failures++; updateNet();
      throw err;
    });
  }

  // Removed in Admin. If check-ins are still waiting on this iPad, keep them (and say so) rather than lose them.
  function disconnected() {
    if (queue.length) {
      session.state = 'closed';
      $('[data-staff-note]').textContent = 'This iPad has been removed in Admin, but ' + queue.length + ' check-in(s) saved on it haven’t been sent yet. Set it up again in Admin (Show setup code): they will then be sent.';
      show('closed');
      return;
    }
    pack = null; store.del('pack').catch(function () {});
    location.reload();
  }

  window.addEventListener('offline', function () { failures = Math.max(failures, 1); updateNet(); });
  window.addEventListener('online', function () { checkState(); });

  function lostConnection(checkingIn) {
    message(checkingIn ? 'We couldn’t confirm your check-in' : 'Please see Julie',
      checkingIn ? 'The iPad has lost its internet connection, so your check-in may not have been saved. Please see Julie, who will check you in.'
        : 'The iPad has lost its internet connection. Please see Julie, who will check you in.');
  }

  function applyMode(mode) {
    var test = mode !== 'live';
    document.body.classList.toggle('is-test', test);
    $('[data-mode-test]').hidden = !test;
    $('[data-mode-live]').hidden = test;
  }

  function applySession() {
    applyMode(session.mode);
    if (session.eventName) {
      $('[data-event-name]').textContent = session.eventName;
      $('[data-event-when]').textContent = session.eventWhen || '';
    }
  }

  // Admin's choices: checked every 5 seconds while check-in is open or paused, every 15 seconds while closed
  function checkState() {
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(checkState, session.state === 'active' || session.state === 'paused' ? 5000 : 15000);
    return api('state').then(function (st) {
      if (st.version && st.version !== VERSION && (current === 'welcome' || HOLD[current] || current === 'loading')) { location.reload(); return; }
      var before = session.state;
      session = { state: st.state, mode: st.mode, eventId: st.event ? st.event.id : 0, eventName: st.event ? st.event.name : '', eventWhen: st.event ? st.event.when : '' };
      store.set('session', session).catch(function () {});
      applySession();
      $('[data-staff-note]').textContent = st.staffNote || '';
      if (st.state !== 'active') { if (current !== home()) show(home()); }
      else if (current === 'loading' || HOLD[current] || before !== 'active') { if (current !== 'done' && current !== 'message') show('welcome'); }
      return syncNow().then(function () { return refreshPack(st); });
    }).catch(function () {
      // No connection. If check-in was open and the event copy is ready, carry on offline.
      if (current === 'loading') {
        if (session.state === 'active' && packReady()) { applySession(); show('welcome'); }
        else { $('[data-staff-note]').textContent = 'The iPad can’t reach the website. Check Julie’s hotspot is on and the iPad is connected to it.'; show(session.state === 'paused' ? 'paused' : 'closed'); }
      }
      updateNet();
    });
  }

  // ---------- sending saved check-ins (automatic) ----------
  function syncNow() {
    if (syncing || (!queue.length && !notes.length) || offlineNow()) { updateNet(); return Promise.resolve(); }
    syncing = true;
    var ticket = (queue[0] || notes[0]).ticket;
    var items = queue.filter(function (q) { return q.ticket === ticket; }).slice(0, 150);
    var help = notes.filter(function (q) { return q.ticket === ticket; }).slice(0, 50);
    return api('sync', { ticket: ticket, items: items.map(function (q) { return { cid: q.cid, gid: q.gid, at: q.at }; }), help: help.map(function (h) { return { cid: h.cid, kind: h.kind, typed: h.typed }; }) })
      .then(function (r) {
        syncing = false;
        if (!r || !r.ok) { stuck = items.length; updateNet(); return; }
        var done = {};
        r.results.forEach(function (x) { done[x.cid] = x.result; });
        queue = queue.filter(function (q) { return !done[q.cid]; });
        notes = notes.filter(function (q) { return !done[q.cid]; });
        stuck = 0;
        return saveQueue().then(function () { updateNet(); if (queue.length || notes.length) return syncNow(); });
      })
      .catch(function () { syncing = false; updateNet(); });
  }

  // The website said check-in is paused or closed (it changed in Admin a moment ago)
  function stopped(r) {
    if (r && (r.result === 'paused' || r.result === 'closed')) {
      session.state = r.result === 'paused' ? 'paused' : 'closed';
      show(home());
      checkState();
      return true;
    }
    return false;
  }

  function problem() { message('Please see Julie', 'Something went wrong on the iPad. Julie will check you in.'); }

  // ---------- a gentle sound when someone is checked in ----------
  var audio = null;
  function chime() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var t = audio.currentTime;
      [880, 1318.5].forEach(function (f, i) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.6);
        o.connect(g); g.connect(audio.destination);
        o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.65);
      });
    } catch (e) { /* no sound: fine */ }
  }

  function finished(guests, saved) {
    var inNow = guests.filter(function (g) { return g.result === 'in'; });
    var already = guests.filter(function (g) { return g.result === 'already'; });
    if (!inNow.length && !already.length) { problem(); return; }
    var title = inNow.length ? (inNow.length === 1 ? 'You’re checked in' : 'You’re all checked in') : 'You’re already checked in';
    var names = (inNow.length ? inNow : already).map(function (g) { return g.name; });
    var text = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || '';
    if (inNow.length && already.length) text += '. ' + already.map(function (g) { return g.name; }).join(', ') + (already.length === 1 ? ' was' : ' were') + ' already checked in.';
    else if (!inNow.length && already.length === 1 && already[0].at) text += ', at ' + already[0].at;
    $('[data-done-title]').textContent = title;
    $('[data-done-names]').textContent = text;
    $('[data-done-saved]').hidden = !(saved && inNow.length);
    if (inNow.length) chime();
    show('done');
  }

  // A confirmed (online) check-in: keep the iPad's copy up to date, so it is right if the connection then drops
  function markIn(guests) {
    if (!idx) return;
    var changed = false;
    guests.forEach(function (g) { if ((g.result === 'in' || g.result === 'already') && idx.guests[g.id] && !idx.guests[g.id].in) { idx.guests[g.id].in = true; changed = true; } });
    if (changed) {
      pack.guests.forEach(function (row) { if (idx.guests[row[0]] && idx.guests[row[0]].in) row[4] = 1; });
      savePack().catch(function () {});
    }
  }

  // ---------- checking in while offline ----------
  // Saved (encrypted) on the iPad BEFORE the guest is told. If it can't be saved, the guest is NOT told they're in.
  function saveOffline(list, cids) {
    var at = new Date().toISOString();
    var results = [], added = [];
    list.forEach(function (g) {
      if (isIn(g.id)) { results.push({ id: g.id, name: g.name, result: 'already' }); return; }
      added.push({ cid: cids[g.id] || newId(), gid: g.id, at: at, ticket: pack.ticket });
      results.push({ id: g.id, name: g.name, result: 'in' });
    });
    if (!added.length) return Promise.resolve(results);
    queue = queue.concat(added);
    return saveQueue().then(function () { updateNet(); return results; }).catch(function (err) {
      queue = queue.filter(function (q) { return added.indexOf(q) < 0; });
      throw err;
    });
  }
  function note(kind, typed) {
    if (!pack) return;
    notes.push({ cid: newId(), kind: kind, typed: typed || '', ticket: pack.ticket });
    saveQueue().catch(function () {});
  }
  function cannotSave() { message('Please see Julie', 'The iPad couldn’t save your check-in. Please see Julie, who will check you in.'); }

  // Online first; if the connection is down (or drops during the request), the iPad's own copy is used.
  // The same random numbers (cids) are used both ways, so a check-in that did reach the website is never counted twice.
  function checkinGuests(list, body) {
    var cids = {};
    list.forEach(function (g) { cids[g.id] = newId(); });
    body.cids = cids;
    var offlineFirst = offlineNow() && packReady();
    var attempt = offlineFirst ? Promise.reject(new Error('offline'))
      : api('checkin', body).catch(function () {
        say($(current === 'one' ? '[data-retry-status-one]' : '[data-retry-status]'), 'Checking the connection…');
        return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return api('checkin', body); })
          .then(function (r) { if (r && r.result === 'done') r.guests.forEach(function (g) { if (g.result === 'already') g.result = 'in'; }); return r; });
      });
    return attempt.then(function (r) { return { online: r }; }, function () {
      if (!packReady() || session.state !== 'active') throw new Error('no copy');
      return saveOffline(list, cids).then(function (res) { return { offline: res }; }, function () { return { unsaved: true }; });
    });
  }
  function afterCheckin(out) {
    if (out.unsaved) { cannotSave(); return; }
    if (out.offline) { finished(out.offline, true); return; }
    var r = out.online;
    if (stopped(r)) return;
    if (r.result === 'done') { markIn(r.guests); finished(r.guests, false); }
    else if (r.result === 'same_name') message('Please see Julie', JULIE_SAME_NAME);
    else if (r.result === 'see_julie' || r.result === 'other_event') message('Please see Julie', 'Julie will help you finish checking in.');
    else problem();
  }

  // ---------- Enter Your Name ----------
  var typedName = '', oneGuest = null;
  function localFind(name) {
    var key = nameKey(name);
    if (key.indexOf(' ') < 0) return { result: 'full_name' };
    var m = [];
    Object.keys(idx.guests).forEach(function (id) { if (idx.guests[id].k === key) m.push(idx.guests[id]); });
    if (m.length > 1) { note('same_name', name); return { result: 'same_name' }; }
    if (!m.length) { note('not_found', name); return { result: 'not_found' }; }
    var b = null;
    Object.keys(idx.byHash).forEach(function (h) { if (idx.byHash[h].id === m[0].b) b = idx.byHash[h]; });
    if (!b || !b.ok) { note('booking', name); return { result: 'see_julie' }; }
    return { result: 'one', guest: { id: m[0].id, name: m[0].name, in: isIn(m[0].id), at: '' }, offline: true };
  }
  function showFound(r, status) {
    if (stopped(r)) return;
    if (r.result === 'one') {
      if (r.guest.in) { finished([{ name: r.guest.name, result: 'already', at: r.guest.at }], false); return; }
      oneGuest = r.guest;
      $('[data-one-name]').textContent = r.guest.name;
      $('[data-checkin-one]').disabled = false;
      show('one');
    } else if (r.result === 'same_name') {
      message('Please see Julie', JULIE_SAME_NAME);
    } else if (r.result === 'not_found') {
      var tried = typedName;
      message('We couldn’t find that name', 'Please check the spelling and try again, or see Julie, who will help you.', function () {
        show('name');
        var i = $('[data-name-input]'); i.value = tried; typedName = tried; i.focus();
      });
    } else if (r.result === 'see_julie') {
      message('Please see Julie', 'Julie will help you finish checking in.');
    } else if (r.result === 'full_name') {
      say(status, 'Please enter your first name and your surname.', true);
    } else if (r.result === 'busy') {
      say(status, 'Please wait a moment and try again.', true);
    } else problem();
  }
  $('[data-name-form]').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('[data-name-input]');
    var name = input.value.replace(/\s+/g, ' ').trim();
    var status = $('[data-name-status]');
    if (!/\S+\s+\S+/.test(name)) { say(status, 'Please enter your first name and your surname.', true); input.focus(); return; }
    say(status, 'Looking for your booking…');
    typedName = name;
    input.blur();
    var local = function () { say(status, ''); if (packReady() && session.state === 'active') showFound(localFind(name), status); else lostConnection(false); };
    if (offlineNow() && packReady()) { local(); return; }
    api('find', { name: name }).then(function (r) { say(status, ''); showFound(r, status); }, local);
  });

  $('[data-checkin-one]').addEventListener('click', function () {
    var btn = this;
    if (btn.disabled || !oneGuest) return;
    btn.disabled = true;
    checkinGuests([oneGuest], { name: typedName }).then(afterCheckin, function () { lostConnection(true); });
  });

  // ---------- Scan QR Code ----------
  var video = $('[data-video]');
  var scanStatus = $('[data-scan-status]');
  var stream = null, scanning = false, busy = false, stopTimer = null, lastTick = 0;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var lastCode = '', ignoreCode = '', ignoreUntil = 0;

  function startScanning() {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    scanning = true; busy = false;
    say(scanStatus, '');
    if (typeof window.jsQR !== 'function' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say(scanStatus, 'The camera can’t be used on this device. Please tap Enter my name instead.', true);
      return;
    }
    if (stream && stream.active) { video.play().catch(function () {}); requestAnimationFrame(tick); say(scanStatus, 'Looking for your QR code…'); return; }
    say(scanStatus, 'Starting the camera…');
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } } })
      .then(function (s) { stream = s; video.srcObject = s; return video.play(); })
      .then(function () {
        if (!scanning) { stopCamera(); return; }
        say(scanStatus, 'Looking for your QR code…');
        requestAnimationFrame(tick);
      })
      .catch(function (err) {
        stopCamera();
        say(scanStatus, err && err.name === 'NotAllowedError'
          ? 'The camera isn’t allowed. Please tap Enter my name instead, or ask Julie.'
          : 'The camera couldn’t start. Please tap Enter my name instead.', true);
      });
  }
  function pauseScanning() {
    scanning = false;
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(stopCamera, 120000);
  }
  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (video) video.srcObject = null;
  }
  function tick(now) {
    if (!scanning || !stream) return;
    requestAnimationFrame(tick);
    if (busy || now - lastTick < 110 || video.readyState < 2 || !video.videoWidth) return;
    lastTick = now;
    var scale = Math.min(1, 800 / video.videoWidth);
    var w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    var found = null;
    try { found = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' }); } catch (e) { found = null; }
    if (!found || !found.data) return;
    if (found.data === ignoreCode && Date.now() < ignoreUntil) return;
    scanned(found.data);
  }

  // Offline: the QR code is checked against the iPad's copy (by its scrambled form). A code that isn't in the copy
  // can't be confirmed offline, so the guest is asked to see Julie (never accepted on trust).
  function localScan(code) {
    var token = tokenFromScan(code);
    if (!token) return Promise.resolve({ result: 'unknown' });
    return sha256(token).then(function (h) {
      var b = idx.byHash[h];
      if (!b) { note('unknown_qr', ''); return { result: 'offline_unknown' }; }
      if (!b.ok) { note('booking', ''); return { result: 'see_julie' }; }
      return { result: 'booking', offline: true, guests: (idx.byBooking[b.id] || []).map(function (g) { return { id: g.id, name: g.name, in: isIn(g.id), at: '' }; }) };
    });
  }
  function showScan(code, r) {
    if (stopped(r)) return;
    if (r.result === 'booking') { bookingOffline = !!r.offline; booking(r.guests); return; }
    if (r.result === 'unknown') {
      ignoreCode = code; ignoreUntil = Date.now() + 4000;
      say(scanStatus, 'That QR code isn’t a New Way’s booking. Please try your booking QR code, or tap Enter my name instead.', true);
      busy = false;
      return;
    }
    if (r.result === 'offline_unknown') message('Please see Julie', 'The iPad is offline and can’t confirm this QR code. Julie will check you in.');
    else if (r.result === 'other_event') message('Please see Julie', 'This QR code is for a different New Way’s event. Julie will help you.');
    else if (r.result === 'see_julie') message('Please see Julie', 'Julie will help you finish checking in.');
    else if (r.result === 'busy') { say(scanStatus, 'Please wait a moment…'); setTimeout(function () { busy = false; }, 2000); }
    else problem();
  }
  function scanned(code) {
    busy = true;
    lastCode = code;
    say(scanStatus, 'Found it. Finding your booking…');
    var local = function () {
      if (packReady() && session.state === 'active') return localScan(code).then(function (r) { showScan(code, r); });
      busy = false; lostConnection(false);
    };
    if (offlineNow() && packReady()) { local(); return; }
    api('scan', { code: code }).then(function (r) { showScan(code, r); }, local);
  }

  // ---------- choosing who is here (a scanned booking) ----------
  var selectAll = $('[data-select-all]');
  var checkinSelected = $('[data-checkin-selected]');
  var bookingOffline = false, bookingGuests = [];
  function booking(guests) {
    bookingGuests = guests;
    var waiting = guests.filter(function (g) { return !g.in; });
    if (!waiting.length) { finished(guests.map(function (g) { return { name: g.name, result: 'already', at: g.at }; }), false); return; }
    var box = $('[data-guests]');
    box.textContent = '';
    guests.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sc-guest' + (g.in ? ' is-in' : '');
      b.setAttribute('data-id', String(g.id));
      var tickEl = document.createElement('span'); tickEl.className = 'sc-box'; tickEl.setAttribute('aria-hidden', 'true');
      if (g.in) tickEl.textContent = '✓';
      var text = document.createElement('span'); text.className = 'sc-guest-text';
      var nm = document.createElement('span'); nm.className = 'sc-guest-name'; nm.textContent = g.name;
      text.appendChild(nm);
      if (g.in) { var nt = document.createElement('span'); nt.className = 'sc-guest-note'; nt.textContent = 'Already checked in' + (g.at ? ' at ' + g.at : ''); text.appendChild(nt); b.disabled = true; }
      else b.setAttribute('aria-pressed', waiting.length === 1 ? 'true' : 'false');
      b.appendChild(tickEl); b.appendChild(text);
      b.addEventListener('click', function () {
        if (g.in) return;
        b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        updateSelected();
      });
      box.appendChild(b);
    });
    selectAll.hidden = waiting.length < 2;
    $('[data-booking-lead]').textContent = guests.length === 1 ? 'Tap Check In to let us know you’re here.'
      : 'Tap each person who is here now, then tap Check In. Anyone arriving later can check in when they arrive.';
    updateSelected();
    show('booking');
  }
  function chosenIds() {
    return Array.prototype.map.call(document.querySelectorAll('.sc-guest[aria-pressed="true"]'), function (b) { return Number(b.getAttribute('data-id')); });
  }
  function updateSelected() {
    var n = chosenIds().length;
    checkinSelected.disabled = !n;
    checkinSelected.textContent = n > 1 ? 'Check In ' + n + ' people' : 'Check In';
  }
  selectAll.addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.sc-guest:not(.is-in)'), function (b) { b.setAttribute('aria-pressed', 'true'); });
    updateSelected();
  });
  checkinSelected.addEventListener('click', function () {
    var ids = chosenIds();
    if (!ids.length || checkinSelected.disabled) return;
    checkinSelected.disabled = true;
    var list = bookingGuests.filter(function (g) { return ids.indexOf(g.id) >= 0; });
    checkinGuests(list, { code: lastCode, guests: ids }).then(afterCheckin, function () { lostConnection(true); });
  });

  // ---------- buttons that change screen ----------
  document.addEventListener('click', function (e) {
    var go = e.target.closest && e.target.closest('[data-go]');
    if (!go) return;
    var to = go.getAttribute('data-go');
    if (session.state !== 'active') to = home();
    else if ((to === 'scan' || to === 'name') && offlineNow() && !packReady()) { lostConnection(false); return; }
    show(to);
    if (to === 'name') { var i = $('[data-name-input]'); i.value = ''; say($('[data-name-status]'), ''); i.focus(); }
  });

  // ---------- keep the screen on, keep a copy of this page for offline, tidy up ----------
  var lock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || document.hidden || lock) return;
    navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {});
  }
  document.addEventListener('pointerdown', keepAwake, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopCamera(); return; }
    keepAwake();
    if (current === 'scan') startScanning();
    checkState();
  });
  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/self-checkin-sw.js', { scope: '/self-checkin' }).catch(function () {});

  keepAwake();
  loadSaved().then(function () { applySession(); updateNet(); checkState(); });
})();
