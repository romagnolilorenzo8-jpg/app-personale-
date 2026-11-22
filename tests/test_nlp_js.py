"""Verifica che il riconoscimento appuntamenti del telefono (nlp.js) dia gli stessi risultati del server (nlp_it.py)."""
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

R = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(R / "server"))
from nlp_it import analizza  # noqa: E402

CAMPI = ["titolo", "data", "ora_inizio", "ora_fine", "tutto_il_giorno", "luogo", "categoria", "inizio", "fine"]


def test_js_uguale_a_python():
    frasi = [f for f in (R / "tests/frasi.txt").read_text().splitlines() if f.strip()]
    js = subprocess.run(["node", "-e", f"""
const {{analizza}} = require({json.dumps(str(R / 'server/static/nlp.js'))});
const frasi = {json.dumps(frasi)};
console.log(JSON.stringify(frasi.map(f => analizza(f, '2026-11-22'))));
"""], capture_output=True, text=True, check=True)
    risultati = json.loads(js.stdout)
    diff = []
    for f, j in zip(frasi, risultati):
        p = analizza(f, date(2026, 11, 22)).as_dict()
        for c in CAMPI:
            if p[c] != j[c]:
                diff.append(f"{f!r} [{c}] py={p[c]!r} js={j[c]!r}")
    assert not diff, "\n".join(diff)


if __name__ == "__main__":
    for f in (R / "tests/frasi.txt").read_text().splitlines():
        d = analizza(f, date(2026, 11, 22)).as_dict()
        print(f"{f}\n   -> {d['titolo']} | {d['inizio']} - {d['fine']} | {d['luogo']} | {d['categoria']}")
