/* ClearTerms service worker — v1
 * Caching strategy:
 *   - network-first for /api/* and /trpc/*
 *   - cache-first for /_next/static/* and /icons/*
 *   - stale-while-revalidate for app pages
 *   - falls back to /offline when network and cache both miss
 * Push event handler displays a notification; notificationclick focuses or opens the URL.
 */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `clearterms-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `clearterms-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = ["/offline", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        // addAll fails atomically; use individual adds so a single 404 doesn't block install
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => console.warn("[sw] precache failed", url, err)),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Skip cross-origin and non-http(s)
  if (url.origin !== self.location.origin) return;
  if (!url.protocol.startsWith("http")) return;

  // Network-first for API + tRPC + auth callbacks
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.includes("/trpc/")
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first for static assets
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Stale-while-revalidate for app pages (HTML navigations)
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Default: try cache, fall back to network
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return (
      (await caches.match("/offline")) ||
      new Response("Offline", { status: 503, statusText: "Offline" })
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    return (
      (await caches.match("/offline")) ||
      new Response("Offline", { status: 503, statusText: "Offline" })
    );
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) {
        caches
          .open(RUNTIME_CACHE)
          .then((cache) => cache.put(request, fresh.clone()))
          .catch(() => {});
      }
      return fresh;
    })
    .catch(async () => {
      const fallback = await caches.match("/offline");
      return (
        fallback ||
        new Response("Offline", { status: 503, statusText: "Offline" })
      );
    });
  return cached || fetchPromise;
}

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "ClearTerms", body: event.data.text() };
    }
  }
  const title = data.title || "ClearTerms";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || data.data?.url || "/dashboard" },
    tag: data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(url) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
        return undefined;
      }),
  );
});
