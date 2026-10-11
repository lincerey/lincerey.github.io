/* eslint-env serviceworker */
/**
 * TRUE — Service Worker v2 (resiliencia, modo offline y notificaciones).
 *
 * Estrategia de doble capa:
 *  1. Navegaciones: network-first con timeout corto y fallback a caché.
 *     Si la red falla o el backend cae, el lector sigue viendo la portada
 *     desde el App Shell cacheado, y si no hay shell, una página offline
 *     mínima que mantiene la marca y explica el estado.
 *  2. Assets estáticos same-origin: stale-while-revalidate, para servir de
 *     inmediato bajo tráfico masivo sin esperar al origen.
 *
 * Nunca cachea:
 *  - POST /api/verify (contenido dinámico y sensible).
 *  - Las APIs de datos en vivo (clima, divisas, cripto): una cifra de mercado
 *    servida desde caché sin marca de frescura es peor que ninguna cifra. De
 *    eso se encarga `useLiveData`, que guarda su propia instantánea con hora.
 *
 * ACTUALIZACIÓN CONTROLADA
 * ------------------------
 * El worker NUEVO no toma el control por su cuenta: espera el mensaje
 * `SKIP_WAITING`. Sin esto, una versión recién instalada recargaría la pestaña
 * del lector en mitad de un artículo. `lib/pwa.js` avisa y aplica la
 * actualización solo cuando el usuario lo pide.
 */
const VERSION = 'true-v2.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/icon-maskable.svg',
  '/manifest.webmanifest',
  '/theme-boot.js',
  '/offline.html',
];
const NAV_TIMEOUT_MS = 3500;

/* ------------------------------------------------------------------ */
/* Ciclo de vida                                                       */
/* ------------------------------------------------------------------ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `allSettled`: si un recurso del shell no existe todavía, la instalación
      // no debe fracasar entera.
      await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset)));
    })(),
  );
  // Nota: NO se llama a skipWaiting() aquí. Lo pide el usuario explícitamente.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/** El cliente pide activar la versión en espera. */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ------------------------------------------------------------------ */
/* Red con timeout: evita que una portada colgada bloquee la lectura.   */
/* ------------------------------------------------------------------ */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sw-timeout')), ms);
    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/* ------------------------------------------------------------------ */
/* Intercepción                                                        */
/* ------------------------------------------------------------------ */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // El backend nunca se sirve desde caché.
  if (url.pathname.startsWith('/api/')) return;

  // 1) Navegaciones → network-first con fallback al shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/index.html', response.clone());
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match('/index.html')) ||
            (await cache.match('/')) ||
            (await cache.match('/offline.html')) ||
            new Response('<h1>TRUE</h1><p>Modo lectura sin conexión.</p>', {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })(),
    );
    return;
  }

  // 2) Assets → stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});

/* ------------------------------------------------------------------ */
/* Notificaciones                                                      */
/* ------------------------------------------------------------------ */
/**
 * Notificación push entrante.
 *
 * HONESTIDAD TÉCNICA: recibir push real exige un servidor que firme con claves
 * VAPID. Este manejador está implementado y es correcto, pero sin backend de
 * push solo se dispara desde `registration.showNotification()` (alertas
 * locales). El punto de anclaje del servidor es `POST /api/push/subscribe`.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'TRUE', body: event.data ? event.data.text() : 'Nueva pieza verificada.' };
  }

  const title = payload.title || 'Última hora verificada en TRUE';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Se publicó una pieza que superó el pipeline de verificación.',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      lang: 'es',
      tag: payload.tag || 'true-ultima-hora',
      data: { url: payload.url || '/' },
    }),
  );
});

/** Al tocar la notificación: enfoca la pestaña existente o abre una nueva. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientList.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
