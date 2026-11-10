/* New Way’s iPad self check-in: keeps a copy of the check-in screens on the iPad, so they still open if Safari is
   reopened (or the iPad restarted) while the internet connection is down. Only the screens themselves are kept (the
   same for every iPad: no guest names, no key). Guest information is never stored here: the screens keep their own
   encrypted copy, and every request to the website goes straight to the network. */
const VERSION = 'nw-checkin-25';
const ASSETS = [
  '/css/selfcheckin.css?v=25',
  '/js/selfcheckin.js?v=25',
  '/js/vendor/jsqr-1.4.0.js?v=25',
  '/images/logo-480.webp',
  '/icons/icon-192.png',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('nw-checkin-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/self-checkin/')) return;   // the website itself, always live
  // The check-in page: always fetched fresh; the kept copy is used only when there is no connection
  if (url.pathname === '/self-checkin' && req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok && res.headers.get('X-NW-Kiosk') === '1') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('/self-checkin', copy));
      }
      return res;
    }).catch(() => caches.match('/self-checkin').then((r) => r || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="background:#000428;color:#fff;font:24px sans-serif;text-align:center;padding:60px 20px"><h1 style="color:#F8B709">Check-In Closed.</h1><p>Please See Julie.</p><p style="font-size:16px;opacity:.7">No internet connection.</p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
    return;
  }
  if (ASSETS.includes(url.pathname + url.search)) event.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
