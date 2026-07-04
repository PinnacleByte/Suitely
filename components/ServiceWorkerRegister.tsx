"use client";

import { useEffect } from "react";

// Registers /sw.js in PRODUCTION only. Rendered in the root layout so it runs
// on every route. No UI. Registration only runs in the browser over HTTPS (or
// localhost), so it's a no-op during SSR and on unsupported browsers.
//
// In DEVELOPMENT we deliberately do the opposite — unregister any existing
// service worker and wipe its caches. The SW caches /_next/static chunks
// cache-first, which is correct in production (those URLs are content-hashed
// and immutable) but poison in dev, where chunk URLs are stable across
// rebuilds: it serves stale compiled code so edits appear to "not take" even
// after a dev-server restart + hard refresh. Gating it here means a dev load
// self-heals a previously-registered SW.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
      if (window.caches) {
        caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
      }
      return;
    }

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
