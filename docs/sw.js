// Fa funzionare LifeApp anche senza connessione (generato da tools/crea_versione_iphone.py)
const CACHE = "scrigno-0c3ab007a6";
const FILE = ["./", "index.html", "manifest.webmanifest", "static/app.css", "static/app.js", "static/chat.js", "static/copertine.js", "static/grafici.js", "static/icona-180.png", "static/icona-192.png", "static/icona-512.png", "static/icona.svg", "static/lifeapp.ico", "static/locale.js", "static/meteo.js", "static/nlp.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE))); self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  // subito dalla memoria del telefono, aggiornato in sottofondo
  const rete = fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); } return r; });
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => {
    if (r) { e.waitUntil(rete.catch(() => {})); return r; }
    return rete.catch(() => caches.match("index.html"));
  }));
});
