// Aditya's Portal — Service Worker v2
// Strategy:
//   • App shell (index.html, manifest, icons) → Cache-first + background refresh
//   • Quiz HTML files (same-origin .html) → Network-first, fallback to cache
//   • search-index.json → Network-first, fallback to cache
//   • Cross-origin (Firebase, GitHub API, fonts, CDN) → Network-only (bypass)
//
// Hard Refresh from the portal sends SKIP_WAITING so the new SW activates
// immediately without requiring a second page load.

const CACHE_VERSION = 'v2';
const CACHE_NAME    = `aditya-portal-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

// ── INSTALL — pre-cache app shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      // Do NOT skipWaiting here — wait for the portal's Hard Refresh to trigger
      // it explicitly via the message below. This prevents half-updated states.
  );
});

// ── ACTIVATE — clean up old caches ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((n) => n.startsWith('aditya-portal-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// ── MESSAGE — Hard Refresh from the portal triggers immediate activation ───
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Strip cache-bust param added by hardRefresh() before matching/storing
  const rawUrl = new URL(request.url);
  rawUrl.searchParams.delete('_cb');
  const cleanUrl = rawUrl.toString();
  const cleanRequest = cleanUrl !== request.url ? new Request(cleanUrl, request) : request;

  const url = rawUrl;

  // ── Cross-origin → bypass completely (Firebase, GitHub API, Google fonts,
  //    CDNs, Lingva translation servers, etc.)
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // ── App shell files → Cache-first, background refresh ──────────────────
  const isShell = APP_SHELL.some((p) => {
    const resolved = new URL(p, self.location).href;
    return resolved === request.url || url.pathname === new URL(p, self.location).pathname;
  });

  if (isShell) {
    event.respondWith(
      caches.match(cleanRequest).then((cached) => {
        // Kick off a background refresh regardless
        const fresh = fetch(cleanRequest).then((res) => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(cleanRequest, res.clone()));
          }
          return res;
        }).catch(() => null);
        // Serve cached immediately; if no cache yet, wait for network
        return cached ?? fresh;
      })
    );
    return;
  }

  // ── search-index.json → Network-first, cache fallback ──────────────────
  if (path.endsWith('search-index.json')) {
    event.respondWith(
      fetch(cleanRequest)
        .then((res) => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(cleanRequest, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(cleanRequest))
    );
    return;
  }

  // ── Quiz HTML files (.html same-origin, not index.html) → Network-first ─
  if (path.endsWith('.html') && !path.endsWith('/index.html') && !path.endsWith('/about.html') && !path.endsWith('/terms.html') && !path.endsWith('/privacy.html')) {
    event.respondWith(
      fetch(cleanRequest)
        .then((res) => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(cleanRequest, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(cleanRequest))
    );
    return;
  }

  // ── Everything else same-origin → Network-first, cache as fallback ──────
  event.respondWith(
    fetch(cleanRequest)
      .then((res) => {
        if (res && res.ok) {
          caches.open(CACHE_NAME).then((c) => c.put(cleanRequest, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(cleanRequest))
  );
});
