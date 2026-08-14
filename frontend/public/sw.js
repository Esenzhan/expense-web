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

  // The HTML shell used to be network-first here, on the theory that a
  // redeploy could otherwise get stuck showing a stale build. In practice
  // that made every online launch wait on a real network round-trip before
  // painting anything (visible white screen), while offline launches hit
  // the network's instant failure and fell back to cache immediately —
  // backwards from what actually feels fast. Nothing in this file evicts an
  // old cached asset once a newer one replaces it (CACHE_NAME only changes,
  // and old entries only get swept, when this SW script's own bytes change,
  // which an ordinary frontend deploy doesn't touch), so a stale cached
  // shell's hashed <script>/<link> references stay servable from cache too
  // — falling back to it is safe, not broken. Now shares the same
  // stale-while-revalidate handling as hashed assets below: instant paint
  // from cache when there is one, with a background fetch that refreshes
  // the cache for the next launch. A fresh deploy may take one extra reopen
  // to show up instead of appearing immediately, in exchange for the shell
  // never blocking on the network again.

  // Hashed asset files (js/css/icons), and now the HTML shell above, are
  // safe to serve stale-while-revalidate since asset filenames change
  // whenever their content does, and a stale shell's references still
  // resolve against whatever was cached alongside it.
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

// Daily reminder push — payload is {title, body}, sent by the backend's
// /api/reminders/tick (see backend/src/services/webPush.js).
self.addEventListener("push", (event) => {
  let data = { title: "Траты", body: "Не забыли внести расходы?" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // non-JSON payload — fall back to the default text above
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList.find((c) => "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })()
  );
});
