// Suitely service worker — minimal, hand-rolled (no Workbox).
// Bump CACHE_VERSION on any change to this file to purge old caches on deploy.
//
// DEV SAFETY (self-destruct on localhost): the browser byte-compares /sw.js on
// every navigation independent of page JS, so this file is the ONE reliable
// place to kill a stale worker. On localhost we register NO caching and instead
// purge all caches + unregister, then reload open tabs — this permanently fixes
// the classic dev trap where a previously-installed SW serves stale compiled
// /_next/static chunks and code edits "never take" (survives dev-server
// restarts + hard refresh). Production (any non-localhost host) keeps the normal
// PWA caching below, so committing/deploying this is safe.
const IS_LOCALHOST =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1" ||
  self.location.hostname === "[::1]";

const CACHE_VERSION = "suitely-v3";
const OFFLINE_URL = "/offline";

if (IS_LOCALHOST) {
  // --- Dev kill-switch: never cache; tear down any prior install. ---
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.clients.claim();
        const clients = await self.clients.matchAll({ type: "window" });
        await self.registration.unregister();
        // Reload every open tab so it re-fetches fresh, SW-free.
        clients.forEach((c) => {
          try {
            c.navigate(c.url);
          } catch (_) {
            /* older browsers: user refresh completes the job */
          }
        });
      })()
    );
  });
  // No fetch handler on localhost → every request goes straight to the network.
} else {
  // --- Production PWA: cache-first static assets, network-first navigations. ---

  // Pre-cache the offline fallback so it's available even on a cold, offline start.
  self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.add(OFFLINE_URL)));
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
}
