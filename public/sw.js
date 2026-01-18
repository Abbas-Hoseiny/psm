/// <reference lib="webworker" />

/**
 * Service Worker für Digitale PSM PWA
 * Version: 2.0.0
 * 
 * Funktionen:
 * - Caching für Offline-Nutzung
 * - Background Sync für Daten
 * - Auto-Startup ohne Dialog (wenn Datenbank vorhanden)
 */

const CACHE_VERSION = 'v2.0.0';
const STATIC_CACHE = `psm-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `psm-dynamic-${CACHE_VERSION}`;
const DB_STATE_KEY = 'psm-db-state';

// Statische Assets, die immer gecacht werden sollen
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/img/psm-icon.svg',
  '/assets/img/favicon.svg'
];

// Patterns für dynamisches Caching
const CACHE_PATTERNS = [
  /\/_astro\/.+\.(js|css|wasm|sqlite)$/,
  /\/assets\/.*\.(svg|png|jpg|jpeg|webp|ico)$/,
  /\/client\/.+\.js$/
];

// CDN-URLs die auch gecacht werden sollen
const CDN_PATTERNS = [
  /cdn\.jsdelivr\.net.*bootstrap/,
  /cdn\.jsdelivr\.net.*bootstrap-icons/
];

// Install Event - Cache statische Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Cache install failed:', err))
  );
});

// Activate Event - Cleanup alter Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('psm-') && 
                          name !== STATIC_CACHE && 
                          name !== DYNAMIC_CACHE)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch Event - Network-first mit Cache-Fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Nur GET-Requests cachen
  if (event.request.method !== 'GET') {
    return;
  }

  // BVL-Daten nicht cachen (zu groß, eigene DB)
  if (url.pathname.includes('/data/bvl/')) {
    return;
  }

  // Prüfen ob Request gecacht werden soll
  const shouldCache = 
    url.origin === self.location.origin ||
    CDN_PATTERNS.some(pattern => pattern.test(event.request.url));

  if (!shouldCache) {
    return;
  }

  // Statische Assets - Cache first
  const isStaticAsset = CACHE_PATTERNS.some(pattern => pattern.test(url.pathname));
  
  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request)
        .then(cached => {
          if (cached) {
            // Background-Refresh für Updates
            fetch(event.request)
              .then(response => {
                if (response && response.status === 200) {
                  caches.open(DYNAMIC_CACHE)
                    .then(cache => cache.put(event.request, response.clone()));
                }
              })
              .catch(() => { /* Offline - ignore */ });
            return cached;
          }
          return fetch(event.request)
            .then(response => {
              if (response && response.status === 200) {
                const clone = response.clone();
                caches.open(DYNAMIC_CACHE)
                  .then(cache => cache.put(event.request, clone));
              }
              return response;
            });
        })
    );
    return;
  }

  // HTML-Seiten und andere Requests - Network first mit Cache-Fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE)
            .then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request)
          .then(cached => {
            if (cached) {
              return cached;
            }
            // Fallback zur Startseite für Navigation
            if (event.request.mode === 'navigate') {
              return caches.match('/');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
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
      getDbState().then(state => {
        event.source?.postMessage({ type: 'DB_STATE', payload: state });
      });
      break;
      
    case 'CLEAR_CACHES':
      caches.keys().then(names => {
        return Promise.all(names.map(name => caches.delete(name)));
      }).then(() => {
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
        updatedAt: new Date().toISOString()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    console.log('[SW] DB state saved:', state);
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

console.log('[SW] Service Worker initialized:', CACHE_VERSION);
