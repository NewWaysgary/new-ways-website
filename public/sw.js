/* New Way’s: service worker for the installable app.
   - Pages are always fetched fresh when online, so Who’s On, Events and announcements are never out of date.
     A copy is kept only so pages already visited still open without a signal.
   - Styles, scripts, the logo and icons have version numbers in their addresses and are kept on the phone.
   - Photos and posters from Admin never change address once uploaded, so they are kept too.
   - Admin is never stored. */

const VERSION = 'nw-v7';
const STATIC_CACHE = VERSION + '-static';
const PAGE_CACHE = 'nw-pages';
const MEDIA_CACHE = 'nw-media';
const FONT_CACHE = 'nw-fonts';
const KEEP = [STATIC_CACHE, PAGE_CACHE, MEDIA_CACHE, FONT_CACHE];

const PRECACHE = [
  '/offline',
  '/css/site.css?v=7',
  '/js/site.js?v=7',
  '/images/logo-160.webp',
  '/images/logo-480.webp',
  '/images/logo-720.webp',
  '/images/logo-720.jpg',
  '/icons/icon-192.png',
  '/icons/favicon-32.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPage(request, url) {
  return request.mode === 'navigate' || request.headers.get('X-NW-Nav') === '1' ||
    (request.headers.get('Accept') || '').includes('text/html');
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(new URL(request.url).pathname, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(new URL(request.url).pathname);
    if (cached) return cached;
    const offline = await caches.match('/offline');
    return offline || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, FONT_CACHE).catch(() => Response.error()));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return;   // never stored
  if (url.pathname === '/sw.js') return;
  // Meditation downloads go straight to the network, so the phone saves the file (and nothing large is stored here)
  if (url.pathname.startsWith('/download/') || /^\/order\/[^/]+\/download$/.test(url.pathname)) return;
  // Booking steps, QR images, the Join page, unsubscribe links, Wednesday payments and live chat always come from the network
  if (/^\/(events\/\d+\/book|qr\/|join|unsubscribe\/|whos-on\/pay|wednesday\/|w\/|wq\/|chat)/.test(url.pathname)) return;

  // Music is streamed in parts by the browser; leave those requests to the network.
  if (request.headers.has('range') || url.pathname.startsWith('/media/audio/')) return;
  if (url.pathname.startsWith('/media/')) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }
  if (/^\/(css|js|images|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.ico') {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (isPage(request, url)) {
    event.respondWith(networkFirstPage(request));
  }
});

// ---------- Notifications for New Way’s Admin (live chat). Only shown when the website sends one. ----------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(String(data.title || 'New Way’s'), {
    body: String(data.body || ''), icon: '/icons/icon-192.png', tag: data.tag ? String(data.tag) : undefined, renotify: !!data.tag,
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/admin/chat' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/admin/chat', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url === target && 'focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
