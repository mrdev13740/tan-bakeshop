const CACHE_NAME = "olive-pos-v2";

const APP_FILES = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase.js",
  "./login.html",
  "./login.css",
  "./login.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache each file independently so one missing file
      // does not prevent the other files from being saved.
      await Promise.all(
        APP_FILES.map(async (file) => {
          try {
            await cache.add(file);
          } catch (error) {
            console.warn("Could not cache:", file);
          }
        })
      );

      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith("olive-pos-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isOurApp = url.origin === self.location.origin;
  const isFirebaseSdk =
    url.hostname === "www.gstatic.com" &&
    url.pathname.includes("/firebasejs/");

  // Cache app files and Firebase SDK modules.
  // Firestore data synchronization is handled by Firebase itself.
  if (!isOurApp && !isFirebaseSdk) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        const response = await fetch(request);

        if (response.ok && response.type !== "opaque") {
          await cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        const cachedResponse = await cache.match(request);

        if (cachedResponse) return cachedResponse;

        if (request.mode === "navigate") {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }

        throw error;
      }
    })()
  );
});
