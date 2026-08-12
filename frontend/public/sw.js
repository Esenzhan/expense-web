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

  // The HTML shell must always be fresh — otherwise a redeploy can get stuck
  // showing a stale build until the cache happens to revalidate in the
  // background. Fall back to cache only when actually offline.
  if (request.mode === "navigate") {
    // .clone() must happen in the very first reaction to fetch(), before the
    // response is handed anywhere else — once respondWith's consumer (the
    // browser, rendering the navigation) starts reading the body, cloning
    // later throws "body is already used" and the cache write silently
    // never happens. This was the actual bug: the previous version cloned
    // inside a second, separately-scheduled .then(), racing the renderer.
    const fetchPromise = fetch(request).then((response) => {
      const toCache = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, toCache)));
      return response;
    });

    event.respondWith(
      fetchPromise.catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error("offline and no cached shell yet");
      })
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
