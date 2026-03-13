/**
 * Soul Service Worker — Enables PWA install + offline support
 */

const CACHE_NAME = 'soul-v1';
const OFFLINE_URLS = ['/', '/chat', '/office'];

// Install: cache core pages
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first with cache fallback for HTML pages
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only cache GET requests for same-origin pages
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  // Skip API calls and WebSocket
  if (request.url.includes('/api/') || request.url.includes('/ws')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful HTML responses
        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // Fallback to home page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});
