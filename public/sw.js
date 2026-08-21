const CACHE_NAME = 'erika-pos-cache-v2';
const OFFLINE_URLS = [
  '/',
  '/caja',
  '/manifest.json',
  '/erika_avatar.png',
  '/globals.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Solo aplicamos caché para requests GET y no para la API de Supabase ni APIs internas
  if (event.request.method !== 'GET' || event.request.url.includes('supabase.co') || event.request.url.includes('/api/')) {
    return;
  }

  // Para navegaciones (HTML): Network First para ver cambios desplegados al instante sin quedar atrapado en caché
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || caches.match('/caja');
          });
        })
    );
    return;
  }

  // Para otros assets estáticos: Cache First con fallback a fetch
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-sales') {
    event.waitUntil(
      (async () => {
        console.log("Background Sync activado: Sincronizando ventas pendientes...");
        const clients = await self.clients.matchAll();
        for (const client of clients) {
          client.postMessage({ type: 'SYNC_SALES' });
        }
      })()
    );
  }
});
