"use client";

import { useEffect } from "react";

// Registers the PWA service worker (public/sw.js) so the app can load with no
// network. Production only -- a service worker in dev would cache assets and
// fight hot-reload. Fails silently on unsupported browsers.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onLoad = () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); };
    // Register after load so it never competes with the initial page fetch.
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}
