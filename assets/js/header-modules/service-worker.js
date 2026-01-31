// service-worker.js
// Simple SW: cache-first for static assets, stale-while-revalidate for con-data JSON
const CACHE_STATIC = 'hf-static-v1';
const CACHE_JSON = 'hf-json-v1';
const STATIC_FILES = [
  '/', '/assets/js/header.min.js', '/assets/css/header.min.css', '/assets/css/styles.min.css'
  // add other static assets you want to pre-cache
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_STATIC).then(cache => cache.addAll(STATIC_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // handle con-data JSON: stale-while-revalidate
  if (url.pathname.startsWith('/assets/db/con-data/')) {
    e.respondWith(
      caches.open(CACHE_JSON).then(async cache => {
        const cached = await cache.match(e.request);
        const network = fetch(e.request).then(resp => {
          if (resp && resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(() => null);
        return cached || network;
      })
    );
    return;
  }
  
  // static: cache-first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      // optionally cache new static
      return resp;
    }).catch(() => r))
  );
});