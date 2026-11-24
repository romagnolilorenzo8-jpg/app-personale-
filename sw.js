// Fa funzionare Scrigno anche senza connessione (generato da tools/crea_versione_iphone.py)
const CACHE = "scrigno-58a9cc46b6";
const FILE = ["./", "index.html", "manifest.webmanifest", "static/app.css", "static/app.js", "static/chat.js", "static/icona-180.png", "static/icona-192.png", "static/icona-512.png", "static/icona.svg", "static/locale.js", "static/nlp.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE))); self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
});
