// service-worker.ts
declare const self: ServiceWorkerGlobalScope & typeof globalThis;

const CACHE_STATIC = 'hf-static-v1';
const CACHE_JSON = 'hf-json-v1';
const STATIC_FILES = [
  '/', '/assets/js/header.min.js', '/assets/css/header.min.css', '/assets/css/styles.min.css'
];

self.addEventListener('install', (e: ExtendableEvent) => {
  e.waitUntil(
    caches.open(CACHE_STATIC).then(cache => cache.addAll(STATIC_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e: ExtendableEvent) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e: FetchEvent) => {
  try {
    const url = new URL(e.request.url);
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
    
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        return resp;
      }).catch(() => r))
    );
  } catch (err) {
    // fallback to network if anything unexpected
  }
});