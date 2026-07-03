"use client";

import { useEffect } from "react";

// Registers /sw.js once on mount. Rendered in the root layout so it runs on
// every route. No UI. Registration only runs in the browser over HTTPS (or
// localhost), so it's a no-op during SSR and on unsupported browsers.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
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
