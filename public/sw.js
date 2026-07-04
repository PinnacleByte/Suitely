// Suitely service worker — minimal, hand-rolled (no Workbox).
// Bump CACHE_VERSION on any change to this file to purge old caches on deploy.
// NOTE: only registered in production now (see ServiceWorkerRegister.tsx) —
// in dev it was serving stale /_next/static chunks cache-first, making code
// edits appear to never take. v2 bump forces existing installs to purge.
const CACHE_VERSION = "suitely-v2";
const OFFLINE_URL = "/offline";

// Pre-cache the offline fallback so it's available even on a cold, offline start.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Drop caches from previous versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only ever handle our own origin's GETs. Everything else — Supabase API/auth
  // calls, POST/PATCH/DELETE, cross-origin requests — goes straight to the
  // network untouched, so data and auth tokens are never served stale.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Static build assets are content-hashed and immutable → cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Page navigations → network-first, fall back to cached shell, then the
  // offline page. Keeps staff on live data whenever the network is reachable.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(OFFLINE_URL);
        })
    );
  }
});
