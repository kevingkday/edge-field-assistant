const CACHE_NAME = 'edge-field-assistant-v4';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/schemas/index.json',
  '/schemas/twincover-cope.json',
  '/schemas/bc-residential-archetype.json',
  '/schemas/oceanfalls-facility.json',
  '/schemas/twinflow-lead-intake.json',
  '/schemas/general-voice-notes.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Never intercept or cache multi-GB model weights or Hugging Face CDN requests;
  // weights stream directly into OPFS on the client.
  if (
    url.pathname.endsWith('.litertlm') ||
    url.hostname === 'huggingface.co' ||
    url.hostname.endsWith('.huggingface.co') ||
    url.hostname === 'hf.co' ||
    url.hostname.endsWith('.hf.co')
  ) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never cache API endpoints; always go straight to the Worker/D1 network.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first for HTML navigations so new deployments never serve stale index.html
  // pointing to old hashed /assets/ bundles.
  if (
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html'
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // Cache-first for hashed /assets/, /wasm/, and /schemas/ with network fallback.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (
            response.ok &&
            (url.pathname.startsWith('/wasm/') ||
              url.pathname.startsWith('/schemas/') ||
              url.pathname.startsWith('/assets/'))
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => new Response('', { status: 504, statusText: 'Gateway Timeout' }));
    })
  );
});
