const CACHE_NAME = "agua-para-todos-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_FILES);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {

      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {

          if (
            networkResponse &&
            networkResponse.status === 200
          ) {
            const responseClone =
              networkResponse.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }

          return networkResponse;
        })
        .catch(() => {

          return caches.match("./index.html");

        });

    })
  );
});
