/// <reference lib="webworker" />

/**
 * Service Worker für Digitale PSM PWA
 *
 * Strategie:
 * - Precache beim Install: App-Shell + alle gehashten Build-Assets (JS/CSS/
 *   WASM/Fonts). Die Liste wird beim Build in PRECACHE_ASSETS eingesetzt
 *   (siehe astro.config.mjs), damit die App nach dem ersten Besuch komplett
 *   offline läuft – inkl. SQLite-WASM.
 * - Gehashte Assets (/_astro/*): Cache-first (unveränderlich pro Hash).
 * - Bilder/Icons (/assets/*): Stale-while-revalidate.
 * - Navigationen/HTML: Network-first mit Cache-Fallback.
 * - BVL-Daten (/data/bvl/*) und fremde Origins: kein Caching.
 *
 * CACHE_VERSION wird pro Build gestempelt, damit sich die SW-Bytes ändern und
 * der Browser den neuen Worker installiert (alte Caches werden aufgeräumt).
 */

const CACHE_VERSION = 'v2.0.0';
const STATIC_CACHE = `psm-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `psm-dynamic-${CACHE_VERSION}`;
const DB_STATE_KEY = 'psm-db-state';

// App-Shell (muss existieren – sonst schlägt der Install fehl)
const SHELL_ASSETS = ['/', '/manifest.json', '/assets/img/favicon.svg'];

// Wird beim Build durch die Liste der gehashten /_astro/-Assets ersetzt.
const PRECACHE_ASSETS = /* __PRECACHE_ASSETS__ */ [];

const HASHED_ASSET_PATTERN = /^\/_astro\/.+\.(js|mjs|css|wasm|woff2?|ttf|sqlite)$/;
const STATIC_IMAGE_PATTERN = /^\/assets\/.+\.(svg|png|jpg|jpeg|webp|ico)$/;

async function precache(cacheName, urls) {
  const cache = await caches.open(cacheName);
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const request = new Request(url, { cache: 'reload' });
      const response = await fetch(request);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} für ${url}`);
      }
      await cache.put(request, response);
    })
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.warn(
      `[SW] ${failed.length}/${urls.length} Assets konnten nicht vorgeladen werden`,
      failed.map((r) => String(r.reason))
    );
  }
}

// Install Event - App-Shell + Build-Assets vorladen
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Shell zuerst (klein, kritisch), danach die gehashten Assets.
      await precache(STATIC_CACHE, SHELL_ASSETS);
      await precache(STATIC_CACHE, PRECACHE_ASSETS);
      await self.skipWaiting();
    })()
  );
});

// Activate Event - Cleanup alter Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (name) =>
                name.startsWith('psm-') &&
                name !== STATIC_CACHE &&
                name !== DYNAMIC_CACHE
            )
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await caches.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    return cached;
  }
  const response = await networkPromise;
  return response || new Response('Offline', { status: 503 });
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === 'navigate') {
      const shell = await caches.match('/');
      if (shell) {
        return shell;
      }
    }
    return new Response('Offline', { status: 503 });
  }
}

// Fetch Event
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nur GET-Requests cachen
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Nur eigene Origin (Bootstrap/Icons/WASM sind jetzt lokal gebündelt)
  if (url.origin !== self.location.origin) {
    return;
  }

  // BVL-Daten nicht cachen (zu groß, eigene DB)
  if (url.pathname.startsWith('/data/bvl/')) {
    return;
  }

  // Service Worker selbst nie aus dem Cache bedienen
  if (url.pathname === '/sw.js') {
    return;
  }

  if (HASHED_ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (STATIC_IMAGE_PATTERN.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // HTML-Seiten, Manifest und alles andere - Network first mit Cache-Fallback
  event.respondWith(networkFirst(request));
});

// Message Handler für DB-State
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'SET_DB_STATE':
      // Speichere Datenbank-Zustand für Auto-Startup
      setDbState(payload);
      break;

    case 'GET_DB_STATE':
      getDbState().then((state) => {
        event.source?.postMessage({ type: 'DB_STATE', payload: state });
      });
      break;

    case 'CLEAR_CACHES':
      caches
        .keys()
        .then((names) => Promise.all(names.map((name) => caches.delete(name))))
        .then(() => {
          event.source?.postMessage({ type: 'CACHES_CLEARED' });
        });
      break;
  }
});

// IndexedDB Helfer für persistenten State
async function openStateDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('psm-sw-state', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('state')) {
        db.createObjectStore('state', { keyPath: 'key' });
      }
    };
  });
}

async function setDbState(state) {
  try {
    const db = await openStateDb();
    const tx = db.transaction('state', 'readwrite');
    const store = tx.objectStore('state');

    await new Promise((resolve, reject) => {
      const request = store.put({
        key: DB_STATE_KEY,
        ...state,
        updatedAt: new Date().toISOString(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
  } catch (err) {
    console.error('[SW] Failed to save DB state:', err);
  }
}

async function getDbState() {
  try {
    const db = await openStateDb();
    const tx = db.transaction('state', 'readonly');
    const store = tx.objectStore('state');

    const result = await new Promise((resolve, reject) => {
      const request = store.get(DB_STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return result || null;
  } catch (err) {
    console.error('[SW] Failed to get DB state:', err);
    return null;
  }
}
