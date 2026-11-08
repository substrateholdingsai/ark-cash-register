// Service Worker — Ark Cash Register v2.4 (Offline First)
const CACHE_NAME = 'ark-cash-register-v2.4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/caja.html',
  '/instructivo.html',
  '/landing.html',
  '/sw.js',
  '/favicon.svg',
  '/logo-lockup.svg',
  '/badge-pey.svg',
  '/og-image.svg',
  '/pattern.svg',
  '/divider.svg',
  '/mask-arc.svg',
  '/sprite-gremial.svg',
  '/pey-codi-logo.png',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ignorar requests a APIs dinámicas para no cachear transacciones en tiempo real
  if (event.request.url.includes('/api/') || event.request.url.includes('/webhooks/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        return caches.match('/index.html');
      });
    })
  );
});
