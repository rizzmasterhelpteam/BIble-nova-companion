const CACHE_NAME = "bible-nova-shell-v2";
const PRECACHE_MANIFEST_URL = "/precache-manifest.json";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch(PRECACHE_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("The offline shell manifest could not be loaded.");
    const manifestCopy = response.clone();
    const manifest = await response.json();
    const assets = Array.isArray(manifest?.assets)
      ? manifest.assets.filter((asset) => typeof asset === "string" && !asset.startsWith("/api/"))
      : [];
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...new Set(assets)]);
    await cache.put(PRECACHE_MANIFEST_URL, manifestCopy);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/subscription/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || caches.match("/index.html")).then((cached) => cached || new Response("Bible Nova is offline.", { status: 503 }))),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
});
