const CACHE_NAME = "traty-shell-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // TEMP DEBUG — remove after diagnosing the offline-shell issue
  self.clients.matchAll().then((clients) => {
    clients.forEach((c) => c.postMessage({ __swDebug: true, mode: request.mode, dest: request.destination, url: request.url }));
  });

  // The HTML shell must always be fresh — otherwise a redeploy can get stuck
  // showing a stale build until the cache happens to revalidate in the
  // background. Fall back to cache only when actually offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // Cache writes must be tied to waitUntil, or the browser can kill
          // this worker right after respondWith settles — that was silently
          // dropping the shell from the cache on every single load (only
          // hashed assets survived, since their write has one fewer await
          // hop and usually raced ahead of teardown).
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())));
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw new Error("offline and no cached shell yet");
        }
      })()
    );
    return;
  }

  // Hashed asset files (js/css/icons) are safe to serve stale-while-revalidate
  // since their filename changes whenever their content does.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) event.waitUntil(cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })()
  );
});
