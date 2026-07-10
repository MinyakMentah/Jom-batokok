
const CACHE_NAME = "jombatokok-shell-v1";
const APP_SHELL = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./assets/logo-full.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Strategi: network-first untuk HTML/JS (agar update cepat terlihat),
// cache-first untuk asset statis lain.
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});