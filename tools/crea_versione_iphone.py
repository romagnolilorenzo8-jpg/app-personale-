"""Crea la versione "modalità iPhone" (senza server) nella cartella docs/, pubblicata da GitHub Pages.

Uso:  python3 tools/crea_versione_iphone.py
Va rilanciato ogni volta che si modifica l'interfaccia in server/static/.
"""
import hashlib
import json
import shutil
from pathlib import Path

R = Path(__file__).resolve().parent.parent
SRC, DST = R / "server" / "static", R / "docs"

if DST.exists():
    shutil.rmtree(DST)
(DST / "static").mkdir(parents=True)
for f in SRC.iterdir():
    if f.is_file() and f.name not in ("sw.js", "manifest.webmanifest", "index.html"):
        shutil.copy2(f, DST / "static" / f.name)

html = (SRC / "index.html").read_text()
html = html.replace('<script src="static/nlp.js"></script>',
                    '<script>window.SCRIGNO_LOCALE = true;</script>\n  <script src="static/nlp.js"></script>')
(DST / "index.html").write_text(html)

manifest = json.loads((SRC / "manifest.webmanifest").read_text())
manifest.pop("share_target", None)
manifest.update(start_url="./", scope="./", id="./")
for i in manifest["icons"]:
    i["src"] = i["src"].lstrip("/")
(DST / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

file_app = ["./", "index.html", "manifest.webmanifest"] + sorted(f"static/{f.name}" for f in (DST / "static").iterdir())
versione = hashlib.sha256(b"".join((DST / p).read_bytes() for p in file_app[1:])).hexdigest()[:10]
(DST / "sw.js").write_text(f"""// Fa funzionare Scrigno anche senza connessione (generato da tools/crea_versione_iphone.py)
const CACHE = "scrigno-{versione}";
const FILE = {json.dumps(file_app)};
self.addEventListener("install", (e) => {{ e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE))); self.skipWaiting(); }});
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {{
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {{ if (r.ok) {{ const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); }} return r; }})
    .catch(() => caches.match(e.request, {{ ignoreSearch: true }}).then((r) => r || caches.match("index.html"))));
}});
""")
(DST / ".nojekyll").write_text("")
print(f"Versione iPhone creata in {DST} ({len(file_app)} file, versione {versione})")
