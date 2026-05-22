const CACHE_NAME = 'erika-pos-cache-v1';
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
  // Solo aplicamos caché para requests GET y no para la API de Supabase
  if (event.request.method !== 'GET' || event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).catch(() => {
        // Fallback for offline if page requested
        if (event.request.mode === 'navigate') {
          return caches.match('/caja');
        }
      });
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-sales') {
    event.waitUntil(
      (async () => {
        // En un SW real, usaríamos IndexedDB aquí para enviar las ventas
        // Para Next.js PWA, solemos disparar la lógica al recargar la app en línea,
        // pero registramos el evento exitoso de Background Sync:
        console.log("Background Sync activado: Sincronizando ventas pendientes...");
        // Notificamos a las ventanas abiertas que pueden hacer fetch
        const clients = await self.clients.matchAll();
        for (const client of clients) {
          client.postMessage({ type: 'SYNC_SALES' });
        }
      })()
    );
  }
});
