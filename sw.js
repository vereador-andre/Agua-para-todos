const CACHE_NAME = "agua-para-todos-v2";

const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.webmanifest",

  // Firebase SDK
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js"
];

self.addEventListener("install", (event) => {

  event.waitUntil(

    caches.open(CACHE_NAME).then(async (cache) => {

      for (const file of APP_FILES) {

        try {

          await cache.add(file);

          console.log(
            "Arquivo armazenado:",
            file
          );

        } catch (error) {

          console.warn(
            "Não foi possível armazenar:",
            file,
            error
          );

        }

      }

    })

  );

  self.skipWaiting();

});


self.addEventListener("activate", (event) => {

  event.waitUntil(

    caches.keys().then((cacheNames) => {

      return Promise.all(

        cacheNames
          .filter(
            (cacheName) =>
              cacheName !== CACHE_NAME
          )
          .map(
            (cacheName) =>
              caches.delete(cacheName)
          )

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

    caches.match(request).then(
      async (cachedResponse) => {

        // Se já estiver no cache,
        // usa imediatamente.
        if (cachedResponse) {
          return cachedResponse;
        }


        // Se não estiver no cache,
        // tenta buscar pela internet.
        try {

          const networkResponse =
            await fetch(request);


          // Guarda respostas válidas
          // para utilização futura.
          if (
            networkResponse &&
            networkResponse.status === 200
          ) {

            const responseClone =
              networkResponse.clone();

            const cache =
              await caches.open(
                CACHE_NAME
              );

            await cache.put(
              request,
              responseClone
            );

          }

          return networkResponse;

        } catch (error) {

          // Se estiver offline e não encontrar
          // o arquivo no cache, volta para
          // a página principal.
          return caches.match(
            "./index.html"
          );

        }

      }

    )

  );

});
