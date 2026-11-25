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
    "ho comprato una maglia a 40 euro": {"azione": "acquisto", "nome": "Maglia", "prezzo": 40, "categoria": "vestiti"},
    "intanto ho comprato una felpa Nike a 30 €": {"azione": "acquisto", "nome": "Felpa Nike", "prezzo": 30},
    "ho venduto la maglia a 50 euro": {"azione": "vendita", "nome": "Maglia", "prezzo": 50},
    "ieri ho comprato una macchina usata a 8.500 euro": {"prezzo": 8500, "categoria": "veicoli", "data": "2026-11-22"},
    "bilancio": {"azione": "domanda", "cosa": "bilancio"},
    "ho passato l'esame di Analisi 1 con 28": {"azione": "esame", "materia": "Analisi 1", "voto": 28, "modulo": None},
    "esame di diritto privato 30 e lode 9 cfu": {"materia": "Diritto privato", "voto": 30, "lode": True, "cfu": 9},
    "esame di Fisica da 12 cfu": {"azione": "esame_nuovo", "materia": "Fisica", "cfu": 12},
    "ho passato il primo modulo di Fisica con 27": {"azione": "esame", "materia": "Fisica", "voto": 27, "modulo": 1},
    "secondo modulo di fisica 30 e lode": {"materia": "Fisica", "voto": 30, "lode": True, "modulo": 2},
    "la seconda parte di chimica con 25": {"materia": "Chimica", "voto": 25, "modulo": 2},
    "il 12 gennaio esame di chimica": {"azione": "appuntamento"},
    "esami del sangue il 3 dicembre alle 8": {"azione": "appuntamento"},
    "panca piana 80 kg per 8": {"azione": "allenamento", "esercizio": "Panca piana", "kg": 80, "reps": 8},
    "adductor machine 20 kg x 12, 30 kg x 10, 40 kg x 8": {"azione": "allenamento", "esercizio": "Adductor machine", "kg": 40, "reps": 8, "serie": 3,
        "set": [{"kg": 20, "reps": 12}, {"kg": 30, "reps": 10}, {"kg": 40, "reps": 8}]},
    "a pranzo 80 g di pasta e 2 uova": {"azione": "pasto", "testo": "80 g di pasta e 2 uova", "pasto": "pranzo"},
    "ieri a cena ho mangiato una pizza": {"azione": "pasto", "testo": "una pizza", "pasto": "cena", "data": "2026-11-22"},
    "colazione: latte e 3 biscotti": {"azione": "pasto", "testo": "latte e 3 biscotti", "pasto": "colazione"},
    "200 g di pollo": {"azione": "pasto", "testo": "200 g di pollo", "pasto": None},
    "ho corso 5 km in 30 minuti": {"azione": "attivita", "sport": "Corsa", "km": 5, "minuti": 30},
    "ieri ho camminato 40 minuti": {"azione": "attivita", "sport": "Camminata", "minuti": 40, "data": "2026-11-22"},
    "ho fatto un'ora e mezza di bici": {"azione": "attivita", "sport": "Bici", "minuti": 90},
    "oggi 8.500 passi": {"azione": "attivita", "sport": "Camminata", "passi": 8500},
    "partita di calcetto 1 ora": {"azione": "attivita", "sport": "Calcio", "minuti": 60},
    "quante calorie ho mangiato oggi?": {"azione": "domanda", "cosa": "calorie"},
    "cena con Giulia sabato alle 20": {"azione": "appuntamento"},
    "squat 100 kg 5 ripetizioni": {"azione": "allenamento", "esercizio": "Squat", "kg": 100, "reps": 5},
    "ho fatto stacco da terra 120kg x 3": {"esercizio": "Stacco da terra", "kg": 120, "reps": 3},
    "lat machine 4 serie da 10 con 50 kg": {"esercizio": "Lat machine", "kg": 50, "reps": 10, "serie": 4},
    "ieri trazioni 8 ripetizioni": {"esercizio": "Trazioni", "kg": 0, "reps": 8, "data": "2026-11-22"},
    "oggi peso 72,5 kg": {"azione": "peso", "peso": 72.5},
    "sono alto 1,78": {"azione": "altezza", "altezza": 178},
}


def test_chat_capisce():
    js = f"""
globalThis.ScrignoNLP = require({json.dumps(str(R / 'server/static/nlp.js'))});
const {{ capisci }} = require({json.dumps(str(R / 'server/static/chat.js'))});
console.log(JSON.stringify({json.dumps(list(CASI))}.map((f) => capisci(f, '2026-11-23'))));"""
    out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    errori = [f"{f!r}: {k} = {r.get(k)!r}, atteso {v!r}" for (f, att), r in zip(CASI.items(), out) for k, v in att.items() if r.get(k) != v]
    assert not errori, "\n".join(errori)


def test_importa_compleanni_dai_promemoria():
    testo = "\n".join([
        "Compleanno Marco Rossi | 2027-08-06T09:00:00+02:00",
        "🎂 Giulia | 2026-12-03T00:00:00+01:00",
        "Compleanno di Luca Bianchi (1990) | 2027-02-14T09:00:00+01:00",
        "Compleanno Anna |",
        "Sara 12 marzo",
        "Paolo Verdi;5/11/1985",
    ])
    js = f"""const {{ leggiCompleanni }} = require({json.dumps(str(R / 'server/static/chat.js'))});
console.log(JSON.stringify(leggiCompleanni({json.dumps(testo)})));"""
    out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    assert [(x["nome"], x["giorno"], x["mese"], x["anno"]) for x in out] == [
        ("Marco Rossi", 6, 8, None), ("Giulia", 3, 12, None), ("Luca Bianchi", 14, 2, 1990),
        ("Anna", None, None, None), ("Sara", 12, 3, None), ("Paolo Verdi", 5, 11, 1985)]
