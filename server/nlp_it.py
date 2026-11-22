"""Riconoscimento di appuntamenti scritti in italiano.

Esempi supportati:
  "il 16 novembre avrò il controllo dal dentista dalle 10 alle 11"
  "domani alle 15:30 analisi del sangue presso ospedale San Marco"
  "lunedì prossimo oculista alle 9 per un'ora"
  "16/12 revisione motorino dalle 8.30 alle 9"
  "tra 3 giorni dermatologo alle 4 del pomeriggio"
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta

MESI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
    "gen": 1, "feb": 2, "mar": 3, "apr": 4, "mag": 5, "giu": 6, "lug": 7, "ago": 8,
    "set": 9, "sett": 9, "ott": 10, "nov": 11, "dic": 12,
}
GIORNI = {
    "lunedì": 0, "lunedi": 0, "martedì": 1, "martedi": 1, "mercoledì": 2, "mercoledi": 2,
    "giovedì": 3, "giovedi": 3, "venerdì": 4, "venerdi": 4, "sabato": 5, "domenica": 6,
}
NUMERI = {
    "una": 1, "uno": 1, "primo": 1, "due": 2, "tre": 3, "quattro": 4, "cinque": 5, "sei": 6,
    "sette": 7, "otto": 8, "nove": 9, "dieci": 10, "undici": 11, "dodici": 12, "tredici": 13,
    "quattordici": 14, "quindici": 15, "sedici": 16, "diciassette": 17, "diciotto": 18,
    "diciannove": 19, "venti": 20, "ventuno": 21, "ventidue": 22, "ventitre": 23,
    "ventitré": 23, "ventiquattro": 24, "trenta": 30,
}

CATEGORIE = [
    ("salute", "🩺", r"dentist|odontoiatr|igien\w* dentale|medic|\bvisit|analisi|prelievo|esam|"
                    r"oculist|ortoped|dermatolog|cardiolog|ginecolog|urolog|neurolog|pediatr|"
                    r"fisioterap|osteopat|radiograf|ecograf|risonanza|tac\b|vaccin|ospedal|"
                    r"ambulatori|controllo|dottor|dott\.|psicolog|nutrizionist|farmac|\botorino|"
                    r"allergolog|mammograf|holter|sangue|denti\b|ortodonz"),
    ("veicoli", "🚗", r"bollo|revisione|tagliando|gomm|pneumatic|meccanic|carrozz|"
                      r"assicurazion|motorino|scooter|auto\b|macchina|moto\b|officina|patente"),
    ("casa", "🏠", r"bolletta|condominio|idraulic|elettricist|caldaia|affitto|trasloco"),
    ("lavoro", "💼", r"riunione|meeting|colloquio|lavoro|ufficio|commercialist|cliente"),
]

NUM = r"(\d{1,2}|" + "|".join(sorted(NUMERI, key=len, reverse=True)) + r")"
MIN = r"(?:[:.,](\d{2})|\s+e\s+(mezza|mezzo|un quarto|quarto|tre quarti|\d{1,2}))?"
TIME = NUM + MIN
PERIODO = r"(?:\s*(?:di|del|della|nel|al)?\s*(mattina|mattino|pomeriggio|sera|notte))?"


@dataclass
class Risultato:
    titolo: str = ""
    data: str | None = None          # YYYY-MM-DD
    ora_inizio: str | None = None    # HH:MM
    ora_fine: str | None = None      # HH:MM
    tutto_il_giorno: bool = True
    luogo: str = ""
    categoria: str = "altro"
    icona: str = "📅"
    capito: list[str] = field(default_factory=list)

    def as_dict(self):
        d = asdict(self)
        if self.data:
            if self.tutto_il_giorno:
                d["inizio"] = self.data
                d["fine"] = self.data
            else:
                d["inizio"] = f"{self.data}T{self.ora_inizio}"
                d["fine"] = f"{self.data}T{self.ora_fine}"
        else:
            d["inizio"] = d["fine"] = None
        return d


def _num(s: str) -> int:
    s = s.strip().lower()
    return int(s) if s.isdigit() else NUMERI[s]


def _minuti(m: str | None, e: str | None) -> int:
    if m:
        return int(m)
    if e:
        e = e.strip()
        return {"mezza": 30, "mezzo": 30, "un quarto": 15, "quarto": 15, "tre quarti": 45}.get(e) or int(e)
    return 0


def _ora(h: int, periodo: str | None, esplicito_pm_ok: bool = True) -> int:
    if periodo in ("pomeriggio", "sera") and h < 12:
        return h + 12
    if periodo == "notte" and h == 12:
        return 0
    if periodo is None and esplicito_pm_ok and 1 <= h <= 7:
        # nessuno va dal dentista alle 3 di notte: interpretiamo come pomeriggio
        return h + 12
    return h % 24


class _Testo:
    """Tiene traccia delle parti del testo già riconosciute."""

    def __init__(self, s: str):
        self.orig = s
        self.low = s.lower()
        self.usato = [False] * len(s)

    def cerca(self, pattern: str):
        for m in re.finditer(pattern, self.low, flags=re.IGNORECASE):
            if not any(self.usato[m.start():m.end()]):
                return m
        return None

    def consuma(self, m):
        for i in range(m.start(), m.end()):
            self.usato[i] = True

    def resto(self) -> str:
        return "".join(" " if u else c for c, u in zip(self.orig, self.usato))


def analizza(testo: str, oggi: date | None = None) -> Risultato:
    oggi = oggi or date.today()
    r = Risultato()
    t = _Testo(" " + testo.strip() + " ")
    PRE = r"(?:\b(?:per il|entro il|il giorno|il|l'|giorno|per|di|del)\s+)?"

    # ---------------------------------------------------------------- orari
    inizio = fine = None
    m = t.cerca(r"\b(?:dalle|dall'|da|tra le|fra le)\s*(?:ore\s*)?" + TIME + PERIODO +
                r"\s*(?:alle|all'|a|fino alle|-)\s*(?:ore\s*)?" + TIME + PERIODO + r"\b")
    if not m:
        m = t.cerca(r"\b(\d{1,2})[:.](\d{2})()\s*()-\s*(\d{1,2})[:.](\d{2})()()\b")
        if m:
            g = m.groups()
            inizio = (_num(g[0]), int(g[1]))
            fine = (_num(g[4]), int(g[5]))
            t.consuma(m)
            r.capito.append("orario")
            m = None
    if m:
        g = m.groups()
        p1, p2 = g[3], g[7]
        h2 = _ora(_num(g[4]), p2 or p1)
        h1 = _ora(_num(g[0]), p1 or (p2 if _num(g[0]) <= _num(g[4]) else None))
        if h1 > h2 and h1 - 12 >= 0 and not p1:
            h1 -= 12
        inizio = (h1, _minuti(g[1], g[2]))
        fine = (h2, _minuti(g[5], g[6]))
        t.consuma(m)
        r.capito.append("orario")
    if inizio is None:
        m = t.cerca(r"\b(?:alle ore|alle|all'|ore|verso le|per le|a partire dalle|dalle)\s*" + TIME + PERIODO + r"\b")
        if not m:
            m = t.cerca(r"\b(\d{1,2})[:.](\d{2})(?![.\d/])()" + PERIODO + r"\b")
        if m:
            g = m.groups()
            inizio = (_ora(_num(g[0]), g[3]), _minuti(g[1], g[2]))
            t.consuma(m)
            r.capito.append("ora")
    if inizio is None:
        m = t.cerca(r"\b(?:a |alle )?(mezzogiorno|mezzanotte)\b")
        if m:
            inizio = (12 if m.group(1) == "mezzogiorno" else 0, 0)
            t.consuma(m)

    durata = None
    m = t.cerca(r"\bper\s+(?:circa\s+)?(un'ora|un ora|una ora|mezz'ora|mezzora|un'ora e mezza|"
                r"(\d+|due|tre|quattro)\s+ore(?:\s+e\s+mezza)?|(\d+)\s+minuti)\b")
    if m:
        s = m.group(1)
        if "e mezza" in s:
            durata = timedelta(minutes=30 + 60 * (1 if s.startswith("un") else _num(s.split()[0])))
        elif s.startswith("mezz"):
            durata = timedelta(minutes=30)
        elif s.startswith("un"):
            durata = timedelta(hours=1)
        elif "minuti" in s:
            durata = timedelta(minutes=int(m.group(3)))
        else:
            durata = timedelta(hours=_num(m.group(2)))
        t.consuma(m)

    # ---------------------------------------------------------------- data
    d = None
    m = t.cerca(r"(?:\b(?:" + "|".join(GIORNI) + r")\s+)?" + PRE +
                r"\b(\d{1,2}|primo|" + "|".join(NUMERI) + r")(?:°|º)?\s+(?:di\s+)?(" +
                "|".join(sorted(MESI, key=len, reverse=True)) + r")\b\.?(?:\s+(?:del\s+)?(\d{4}))?")
    if m:
        try:
            g, mese, anno = _num(m.group(1)), MESI[m.group(2)], m.group(3)
            d = date(int(anno) if anno else oggi.year, mese, g)
            if not anno and d < oggi:
                d = d.replace(year=oggi.year + 1)
            t.consuma(m)
        except ValueError:
            d = None
    if d is None:
        m = t.cerca(r"(?:\b(?:" + "|".join(GIORNI) + r")\s+)?" + PRE +
                    r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b")
        if not m:
            m = t.cerca(PRE + r"\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b")
        if m:
            try:
                anno = m.group(3)
                y = (int(anno) + (2000 if len(anno) == 2 else 0)) if anno else oggi.year
                d = date(y, int(m.group(2)), int(m.group(1)))
                if not anno and d < oggi:
                    d = d.replace(year=oggi.year + 1)
                t.consuma(m)
            except ValueError:
                d = None
    if d is None:
        m = t.cerca(r"\b(oggi|stasera|stamattina|dopodomani|domani)\b")
        if m:
            d = oggi + timedelta(days={"oggi": 0, "stasera": 0, "stamattina": 0,
                                         "domani": 1, "dopodomani": 2}[m.group(1)])
            if m.group(1) == "stasera" and inizio and inizio[0] < 12:
                inizio = (inizio[0] + 12, inizio[1])
            t.consuma(m)
    if d is None:
        m = t.cerca(r"\b(?:tra|fra)\s+(\d+|" + "|".join(NUMERI) + r"|una|un)\s+(giorni|giorno|settimane|settimana|mesi|mese)\b")
        if m:
            n = 1 if m.group(1) in ("un", "una") else _num(m.group(1))
            u = m.group(2)
            if u.startswith("giorn"):
                d = oggi + timedelta(days=n)
            elif u.startswith("settiman"):
                d = oggi + timedelta(weeks=n)
            else:
                mm = oggi.month - 1 + n
                y, mo = oggi.year + mm // 12, mm % 12 + 1
                d = date(y, mo, min(oggi.day, 28))
            t.consuma(m)
    if d is None:
        m = t.cerca(r"\b(?:(?:il|la|di|per|questo|questa|prossimo|prossima)\s+)?(" + "|".join(GIORNI) +
                    r")(?:\s+(prossimo|prossima|della prossima settimana))?\b")
        if m:
            target = GIORNI[m.group(1)]
            delta = (target - oggi.weekday()) % 7 or 7
            if m.group(2) == "della prossima settimana":
                delta += 7
            d = oggi + timedelta(days=delta)
            t.consuma(m)

    if d:
        r.data = d.isoformat()
        r.capito.append("data")

    if inizio:
        r.tutto_il_giorno = False
        start = datetime(2000, 1, 1, inizio[0] % 24, inizio[1] % 60)
        if fine:
            end = datetime(2000, 1, 1, fine[0] % 24, fine[1] % 60)
            if end <= start:
                end = start + timedelta(hours=1)
        else:
            end = start + (durata or timedelta(hours=1))
        if end.day != start.day:
            end = datetime(2000, 1, 1, 23, 59)
        r.ora_inizio = start.strftime("%H:%M")
        r.ora_fine = end.strftime("%H:%M")

    # ---------------------------------------------------------------- luogo
    m = t.cerca(r"\b(?:presso(?: il| la| lo| l')?|in (?=via|viale|piazza|corso|largo)|all'ospedale|"
                r"alla clinica|al centro|nello studio|allo studio)\s*([^,;.\n]+)")
    if m:
        pref = m.group(0)[: m.start(1) - m.start()].strip()
        luogo = m.group(1).strip()
        if pref.startswith(("all'ospedale", "alla clinica", "al centro", "nello studio", "allo studio")):
            base = {"all'ospedale": "Ospedale", "alla clinica": "Clinica", "al centro": "Centro",
                    "nello studio": "Studio", "allo studio": "Studio"}[pref]
            luogo = f"{base} {t.orig[m.start(1):m.end(1)].strip()}".strip()
        r.luogo = t.orig[m.start(1):m.end(1)].strip() if not pref.startswith(("all", "al ", "nello")) else luogo
        if r.luogo:
            r.luogo = r.luogo[0].upper() + r.luogo[1:]
        t.consuma(m)

    # ---------------------------------------------------------------- titolo
    titolo = t.resto()
    riempitivi = (r"\b(?:ricordami(?: che)?|ricorda(?:mi)?|segna(?:mi)?|aggiungi|metti|inserisci|"
                  r"nuovo appuntamento|ho prenotato|prenotato|prenotata|avrò|avro|avrei|ho|"
                  r"devo andare|devo fare|devo|andrò|andro|vado|c'è|ci sarà|sarà|farò|faro|"
                  r"mi aspetta|tocca|che)\b")
    titolo = re.sub(riempitivi, " ", titolo, flags=re.IGNORECASE)
    titolo = re.sub(r"\s+", " ", titolo).strip(" ,.;:-")
    articoli = r"^(?:il|lo|la|l'|i|gli|le|un|uno|una|un'|e|ed|poi|alle|a|per|di)\s+"
    for _ in range(3):
        titolo = re.sub(articoli, "", titolo, flags=re.IGNORECASE).strip()
    titolo = re.sub(r"\s+(?:il|lo|la|di|del|della|a|al|alla|e|per|dalle|alle|in|con)$", "", titolo,
                    flags=re.IGNORECASE).strip(" ,.;:-")
    if titolo:
        titolo = titolo[0].upper() + titolo[1:]
    r.titolo = titolo or "Appuntamento"

    tutto = testo.lower()
    for nome, icona, pat in CATEGORIE:
        if re.search(pat, tutto):
            r.categoria, r.icona = nome, icona
            break
    return r


if __name__ == "__main__":
    import json
    import sys
    print(json.dumps(analizza(" ".join(sys.argv[1:])).as_dict(), ensure_ascii=False, indent=2))
