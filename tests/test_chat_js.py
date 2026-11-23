"""Verifica che la chat capisca le frasi tipiche (server/static/chat.js, eseguito con node)."""
import json
import subprocess
from pathlib import Path

R = Path(__file__).resolve().parent.parent
CASI = {
    "il 6 agosto è il compleanno di Marco Rossi": {"azione": "compleanno", "nome": "Marco Rossi", "giorno": 6, "mese": 8},
    "Marco Rossi compie gli anni il 6 agosto": {"azione": "compleanno", "nome": "Marco Rossi", "giorno": 6, "mese": 8},
    "mia cugina Sara è nata il 3 febbraio 1990": {"azione": "compleanno", "nome": "Sara", "anno": 1990},
    "stasera ho visto il film After": {"azione": "diario", "tipo": "film", "titolo": "After", "data": "2026-11-23"},
    "ieri ho visto After, mi è piaciuto tantissimo": {"titolo": "After", "data": "2026-11-22", "voto": 5, "commento": "Mi è piaciuto tantissimo"},
    "ho visto Inception 9/10": {"titolo": "Inception", "voto": 5, "data": "2026-11-23"},
    "sabato al cinema ho visto Dune parte due, bellissimo": {"titolo": "Dune parte due", "data": "2026-11-21"},
    "ho letto Il nome della rosa di Umberto Eco": {"tipo": "libro", "titolo": "Il nome della rosa", "autore": "Umberto Eco"},
    "sto leggendo Harry Potter e la pietra filosofale": {"tipo": "libro", "stato": "in corso"},
    "ho visto la serie Stranger Things, 4 stelle": {"tipo": "serie", "titolo": "Stranger Things", "voto": 4},
    'ho guardato "La vita è bella" con mia nonna': {"titolo": "La vita è bella", "voto": None},
    "commento su After: il finale è triste": {"azione": "commento", "titolo": "After"},
    "quando è il compleanno di Marco?": {"azione": "domanda", "cosa": "compleanno", "nome": "Marco"},
    "prossimi compleanni": {"azione": "domanda", "cosa": "compleanni"},
    "il 16 dicembre dentista dalle 10 alle 11": {"azione": "appuntamento", "inizio": "2026-12-16T10:00"},
}


def test_chat_capisce():
    js = f"""
globalThis.ScrignoNLP = require({json.dumps(str(R / 'server/static/nlp.js'))});
const {{ capisci }} = require({json.dumps(str(R / 'server/static/chat.js'))});
console.log(JSON.stringify({json.dumps(list(CASI))}.map((f) => capisci(f, '2026-11-23'))));"""
    out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    errori = [f"{f!r}: {k} = {r.get(k)!r}, atteso {v!r}" for (f, att), r in zip(CASI.items(), out) for k, v in att.items() if r.get(k) != v]
    assert not errori, "\n".join(errori)
