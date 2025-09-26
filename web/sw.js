const CACHE = "ce-thumbgen-v0.1.8";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/brand-tokens.css",
  "./assets/palette.json",
  "./main.js",
  "./zipper.js",
  "./worker/dispatcher.js",
  "./worker/img-worker.js",
  "./worker/zipper-worker.js",
  "./worker/exif.js",
  "./register-sw.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
