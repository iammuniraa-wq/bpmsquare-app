// BPMSquare service worker — makes the app (the WFM punch page especially)
// load with no network, without ever pinning an online user to a stale build.
//
// Strategy, by request type:
//   - navigations (HTML): NETWORK-FIRST, fall back to the cached page, then to
//     /offline.html. Online users always get fresh HTML (and therefore fresh
//     hashed asset URLs), so a new deploy is picked up on the next online load.
//   - /_next/static/* and other hashed/immutable assets, icons, fonts:
//     CACHE-FIRST (they're content-hashed, so a given URL is never stale).
//   - /api/*: NETWORK-ONLY, never cached. Offline writes are handled by the
//     app's own IndexedDB punch queue; offline reads fall back to the app's
//     cached client state, not to a stale API response.
//
// Bump VERSION to force every client onto a fresh cache (old caches are
// deleted on activate).

const VERSION = "bpm-pwa-v1";
const PRECACHE = ["/offline.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    PRECACHE.includes(url.pathname) ||
    /\.(png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Never touch writes (punch POSTs etc.) -- straight to the network.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only same-origin; let third parties (map tiles, fonts CDNs) hit the network.
  if (url.origin !== self.location.origin) return;
  // API is never cached -- the app degrades offline via its queue + cached state.
  if (url.pathname.startsWith("/api/")) return;

  // HTML navigations: network-first so a deploy is never pinned; cache on the
  // way through so the same route works offline next time.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("/offline.html"))
        )
    );
    return;
  }

  // Immutable/static assets: cache-first, refresh in the background.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
              return res;
            })
            .catch(() => hit)
      )
    );
    return;
  }

  // Everything else: try network, fall back to cache if we have it.
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
