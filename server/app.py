"""Scrigno — archivio personale: documenti, password, scadenze e visite mediche.

Avvio:  python -m uvicorn app:app --host 0.0.0.0 --port 8080   (dalla cartella server/)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import ics
from nlp_it import analizza

BASE = Path(__file__).resolve().parent
# Tutto resta nella cartella dell'app: i dati sono in "dati" accanto al programma
# (gli aggiornamenti non toccano mai questa cartella).
DATA = Path(os.environ.get("SCRIGNO_DATA", BASE.parent / "dati")).resolve()
FILES = DATA / "file"
MINI = DATA / "miniature"
DB_PATH = DATA / "scrigno.db"
TZ = ZoneInfo(os.environ.get("SCRIGNO_TZ", "Europe/Rome"))
PORT = int(os.environ.get("SCRIGNO_PORT", "8080"))
MAX_UPLOAD = 200 * 1024 * 1024
FILES.mkdir(parents=True, exist_ok=True)
MINI.mkdir(parents=True, exist_ok=True)
CACHE_FILE = {"Cache-Control": "private, max-age=31536000, immutable"}

_lock = threading.Lock()
_chiavi_vault: dict[str, bytes] = {}       # sessione -> chiave Fernet (solo in memoria)
_tentativi: dict[str, list[float]] = {}    # protezione da tentativi di login ripetuti


# =========================================================================== DB
SCHEMA = """
CREATE TABLE IF NOT EXISTS impostazioni (chiave TEXT PRIMARY KEY, valore TEXT);
CREATE TABLE IF NOT EXISTS sessioni (token TEXT PRIMARY KEY, creata REAL);
CREATE TABLE IF NOT EXISTS cartelle (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, padre INTEGER REFERENCES cartelle(id),
  icona TEXT DEFAULT '📁', colore TEXT DEFAULT '', ordine INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS documenti (
  id INTEGER PRIMARY KEY, cartella INTEGER REFERENCES cartelle(id), nome TEXT NOT NULL,
  file TEXT NOT NULL, mime TEXT, dimensione INTEGER, note TEXT DEFAULT '',
  scadenza TEXT, creato TEXT, origine TEXT DEFAULT 'app');
CREATE TABLE IF NOT EXISTS password (
  id INTEGER PRIMARY KEY, titolo TEXT NOT NULL, utente TEXT DEFAULT '', segreto TEXT,
  sito TEXT DEFAULT '', note TEXT DEFAULT '', categoria TEXT DEFAULT '', creato TEXT, modificato TEXT);
CREATE TABLE IF NOT EXISTS diario (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, titolo TEXT NOT NULL, autore TEXT DEFAULT '', data TEXT,
  voto INTEGER, commento TEXT DEFAULT '', stato TEXT DEFAULT '', giorno INTEGER, mese INTEGER, anno INTEGER, creato TEXT);
CREATE TABLE IF NOT EXISTS appuntamenti (
  id INTEGER PRIMARY KEY, uid TEXT, titolo TEXT NOT NULL, inizio TEXT NOT NULL, fine TEXT,
  tutto_il_giorno INTEGER DEFAULT 0, luogo TEXT DEFAULT '', note TEXT DEFAULT '',
  categoria TEXT DEFAULT 'altro', icona TEXT DEFAULT '📅', creato TEXT);
"""

CARTELLE_INIZIALI = [
    ("Mezzi di trasporto", "🚗", [
        ("Motorino", "🛵", ["Bollo", "Assicurazione", "Revisione", "Libretto", "Manutenzione"]),
        ("Auto", "🚙", ["Bollo", "Assicurazione", "Revisione", "Libretto", "Manutenzione"]),
    ]),
    ("Salute", "🩺", [
        ("Analisi del sangue", "🩸", []),
        ("Dentista", "🦷", ["Radiografie denti", "Preventivi e fatture"]),
        ("Referti e visite", "📋", []),
        ("Esami e radiografie", "🩻", []),
        ("Ricette e farmaci", "💊", []),
        ("Vaccini", "💉", []),
    ]),
    ("Assicurazioni", "🛡️", [("Casa", "🏠", []), ("Vita e salute", "❤️", []), ("Viaggi", "✈️", [])]),
    ("Documenti personali", "🪪", [
        ("Carta d'identità", "🪪", []), ("Patente", "🚦", []), ("Passaporto", "🛂", []),
        ("Tessera sanitaria", "💳", []),
    ]),
    ("Casa", "🏠", [("Bollette", "💡", []), ("Contratti", "📝", []), ("Garanzie e scontrini", "🧾", [])]),
    ("Lavoro e tasse", "💼", [("Buste paga", "💶", []), ("Dichiarazione redditi", "🏛️", [])]),
    ("Varie", "🗂️", []),
]


LAVORI = [('Xmasters', '💼'), ('Benzinaio', '⛽'), ('Inventari', '📦')]


MODELLI = {"lavoro": [["Contratto", "📝"], ["Buste paga", "💶"]], "affitto": [["Contratto d'affitto", "📝"], ["Bollette", "💡"], ["Ricevute affitto", "🧾"], ["Manutenzione", "🛠️"]], "proprieta": [["Atto e mutuo", "📜"], ["Bollette", "💡"], ["Condominio", "🏢"], ["Assicurazione casa", "🛡️"], ["Manutenzione", "🛠️"]]}
ICONE_MODELLO = {"lavoro": "💼", "affitto": "🔑", "proprieta": "🏡"}
RIQUADRI_LAVORO = [('📅', 'Periodo'), ('🕒', 'Orari e turni'), ('💶', 'Paga'), ('👥', 'Colleghi e responsabili'), ('🧰', 'Mansioni'), ('💬', 'Commenti')]


def _crea_da_modello(con, nome: str, icona: str | None, padre, tipo: str) -> int:
    """Crea una cartella già organizzata: un lavoro, una casa in affitto o di proprietà."""
    cid = con.execute("INSERT INTO cartelle (nome, padre, icona, ordine, tipo, note) VALUES (?,?,?,0,?,'[]')",
                      (nome, padre, icona or ICONE_MODELLO[tipo], tipo)).lastrowid
    for i, (n, ic) in enumerate(MODELLI[tipo]):
        con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES (?,?,?,?)", (n, cid, ic, i))
    return cid


def _crea_lavoro(con, nome: str, icona: str | None, padre) -> int:
    return _crea_da_modello(con, nome, icona, padre, "lavoro")


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def imp_get(con, k, default=None):
    r = con.execute("SELECT valore FROM impostazioni WHERE chiave=?", (k,)).fetchone()
    return r["valore"] if r else default


def imp_set(con, k, v):
    con.execute("INSERT OR REPLACE INTO impostazioni VALUES (?,?)", (k, v))


def init_db():
    with db() as con:
        con.executescript(SCHEMA)
        if "extra" not in [r[1] for r in con.execute("PRAGMA table_info(diario)")]:
            con.execute("ALTER TABLE diario ADD COLUMN extra TEXT")
        colonne = [r[1] for r in con.execute("PRAGMA table_info(cartelle)")]
        if "tipo" not in colonne:
            con.execute("ALTER TABLE cartelle ADD COLUMN tipo TEXT")
        if "note" not in colonne:
            con.execute("ALTER TABLE cartelle ADD COLUMN note TEXT")
        if not imp_get(con, "token_api"):
            imp_set(con, "token_api", secrets.token_urlsafe(24))
            imp_set(con, "token_calendario", secrets.token_urlsafe(24))
            imp_set(con, "sale_vault", base64.b64encode(os.urandom(16)).decode())
        if con.execute("SELECT COUNT(*) FROM cartelle").fetchone()[0] == 0:
            def crea(nome, icona, figli, padre, ordine):
                cur = con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES (?,?,?,?)",
                                  (nome, padre, icona, ordine))
                for i, f in enumerate(figli):
                    if isinstance(f, str):
                        crea(f, _icona_auto(f), [], cur.lastrowid, i)
                    else:
                        crea(*f, cur.lastrowid, i)
            for i, (n, ic, figli) in enumerate(CARTELLE_INIZIALI):
                crea(n, ic, figli, None, i)
        if not imp_get(con, "cartelle_v2"):
            dp = con.execute("SELECT id FROM cartelle WHERE nome='Documenti personali' AND padre IS NULL").fetchone()
            dp_id = dp["id"] if dp else con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES ('Documenti personali', NULL, '🪪', 3)").lastrowid
            for nome, icona in (("Fototessera", "📸"), ("Curriculum", "📄")):
                if not con.execute("SELECT 1 FROM cartelle WHERE nome=? AND padre=?", (nome, dp_id)).fetchone():
                    con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES (?,?,?,-1)", (nome, dp_id, icona))
            imp_set(con, "cartelle_v2", "1")
        if not imp_get(con, "lavori_v1"):
            lt = con.execute("SELECT id FROM cartelle WHERE nome='Lavoro e tasse' AND padre IS NULL").fetchone()
            lt_id = lt["id"] if lt else con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES ('Lavoro e tasse', NULL, '💼', 5)").lastrowid
            for nome, icona in LAVORI:
                c = con.execute("SELECT id FROM cartelle WHERE padre=? AND lower(nome)=lower(?)", (lt_id, nome)).fetchone()
                if not c:
                    _crea_lavoro(con, nome, icona, lt_id)
                    continue
                con.execute("UPDATE cartelle SET tipo='lavoro', note=COALESCE(note, '[]') WHERE id=?", (c["id"],))
                for sub, ic, o in (("Contratto", "📝", 0), ("Buste paga", "💶", 1)):
                    if not con.execute("SELECT 1 FROM cartelle WHERE padre=? AND nome=?", (c["id"], sub)).fetchone():
                        con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES (?,?,?,?)", (sub, c["id"], ic, o))
            imp_set(con, "lavori_v1", "1")
        if not imp_get(con, "inventari_v1"):
            inv = con.execute("SELECT id FROM cartelle WHERE tipo='lavoro' AND lower(nome)='inventari'").fetchone()
            if inv:
                for nome in ['Inventario NaturaSì Senigallia', 'Inventario Leroy Merlin Baraccola']:
                    if not con.execute("SELECT 1 FROM cartelle WHERE padre=? AND lower(nome)=lower(?)", (inv["id"], nome)).fetchone():
                        _crea_da_modello(con, nome, "📦", inv["id"], "lavoro")
                for c in con.execute("SELECT id FROM cartelle WHERE padre=? AND nome IN ('Contratto', 'Buste paga')", (inv["id"],)).fetchall():
                    vuota = not con.execute("SELECT 1 FROM documenti WHERE cartella=?", (c["id"],)).fetchone() and \
                        not con.execute("SELECT 1 FROM cartelle WHERE padre=?", (c["id"],)).fetchone()
                    if vuota:
                        con.execute("DELETE FROM cartelle WHERE id=?", (c["id"],))
            imp_set(con, "inventari_v1", "1")
        if not imp_get(con, "riquadri_v1"):
            ora = datetime.now(TZ).isoformat(timespec="seconds")
            for c in con.execute("SELECT id, note FROM cartelle WHERE tipo='lavoro' AND id NOT IN "
                                 "(SELECT padre FROM cartelle WHERE tipo='lavoro' AND padre IS NOT NULL)").fetchall():
                note = json.loads(c["note"] or "[]")
                out = [{**n, "icona": n.get("icona") or "📝"} for n in note if n.get("titolo")]
                commenti = [n["testo"] for n in note if not n.get("titolo") and n.get("testo")]
                for icona, titolo in RIQUADRI_LAVORO:
                    esiste = next((n for n in out if n["titolo"].lower() == titolo.lower()), None)
                    if not esiste:
                        out.append({"id": secrets.token_hex(6), "titolo": titolo, "icona": icona, "data": ora,
                                    "testo": "\n\n".join(commenti) if titolo == "Commenti" else ""})
                    elif titolo == "Commenti" and commenti:
                        esiste["testo"] = "\n\n".join([esiste.get("testo") or "", *commenti]).strip()
                ordine = {t.lower(): i for i, (_, t) in enumerate(RIQUADRI_LAVORO)}
                out.sort(key=lambda n: ordine.get(n["titolo"].lower(), 99))
                con.execute("UPDATE cartelle SET note=? WHERE id=?", (json.dumps(out), c["id"]))
            imp_set(con, "riquadri_v1", "1")


def _icona_auto(nome: str) -> str:
    n = nome.lower()
    for k, v in [("bollo", "🧾"), ("assicura", "🛡️"), ("revision", "🔧"), ("libretto", "📘"),
                 ("manutenz", "🛠️"), ("radiograf", "🩻"), ("fattur", "🧾"), ("preventiv", "🧾")]:
        if k in n:
            return v
    return "📁"


init_db()


# ===================================================================== sicurezza
def _hash_pw(pw: str, sale: bytes) -> str:
    return base64.b64encode(hashlib.pbkdf2_hmac("sha256", pw.encode(), sale, 300_000)).decode()


def _chiave_vault(pw: str, con) -> bytes:
    sale = base64.b64decode(imp_get(con, "sale_vault"))
    raw = hashlib.pbkdf2_hmac("sha256", pw.encode(), sale + b"vault", 300_000)
    return base64.urlsafe_b64encode(raw)


def _verifica_pw(pw: str, con) -> bool:
    h, sale = imp_get(con, "pw_hash"), imp_get(con, "pw_sale")
    return bool(h) and hmac.compare_digest(h, _hash_pw(pw, base64.b64decode(sale)))


def _limite_tentativi(ip: str):
    ora = time.time()
    lista = [t for t in _tentativi.get(ip, []) if ora - t < 300]
    if len(lista) >= 8:
        raise HTTPException(429, "Troppi tentativi. Riprova tra qualche minuto.")
    lista.append(ora)
    _tentativi[ip] = lista


def sessione(request: Request) -> str:
    tok = request.cookies.get("scrigno_sessione")
    if tok:
        with db() as con:
            r = con.execute("SELECT creata FROM sessioni WHERE token=?", (tok,)).fetchone()
        if r and time.time() - r["creata"] < 180 * 86400:
            return tok
    raise HTTPException(401, "Accesso richiesto")


def autorizzato(request: Request) -> str:
    """Sessione del browser OPPURE token per i Comandi Rapidi di iPhone."""
    tok = request.headers.get("x-token") or request.query_params.get("token")
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
    if tok:
        with db() as con:
            if hmac.compare_digest(tok, imp_get(con, "token_api", "")):
                return "api"
        raise HTTPException(401, "Token non valido")
    return sessione(request)


def chiave_sessione(s: str = Depends(sessione)) -> bytes:
    k = _chiavi_vault.get(s)
    if not k:
        raise HTTPException(423, "Cassaforte bloccata")
    return k


# =========================================================================== app
app = FastAPI(title="Scrigno", docs_url=None, redoc_url=None)


class Password(BaseModel):
    password: str


class CambioPassword(BaseModel):
    attuale: str
    nuova: str


@app.get("/api/stato")
def stato(request: Request):
    with db() as con:
        configurato = bool(imp_get(con, "pw_hash"))
    try:
        s = sessione(request)
        return {"configurato": configurato, "accesso": True, "cassaforte_aperta": s in _chiavi_vault}
    except HTTPException:
        return {"configurato": configurato, "accesso": False, "cassaforte_aperta": False}


def _nuova_sessione(con, response: Response, pw: str):
    tok = secrets.token_urlsafe(32)
    con.execute("INSERT INTO sessioni VALUES (?,?)", (tok, time.time()))
    _chiavi_vault[tok] = _chiave_vault(pw, con)
    response.set_cookie("scrigno_sessione", tok, max_age=180 * 86400, httponly=True, samesite="lax")


@app.post("/api/configura")
def configura(body: Password, response: Response):
    if len(body.password) < 6:
        raise HTTPException(400, "La password deve avere almeno 6 caratteri")
    with _lock, db() as con:
        if imp_get(con, "pw_hash"):
            raise HTTPException(400, "Già configurato")
        sale = os.urandom(16)
        imp_set(con, "pw_sale", base64.b64encode(sale).decode())
        imp_set(con, "pw_hash", _hash_pw(body.password, sale))
        _nuova_sessione(con, response, body.password)
    return {"ok": True}


@app.post("/api/accedi")
def accedi(body: Password, request: Request, response: Response):
    _limite_tentativi(request.client.host if request.client else "?")
    with db() as con:
        if not _verifica_pw(body.password, con):
            raise HTTPException(401, "Password errata")
        _nuova_sessione(con, response, body.password)
    return {"ok": True}


@app.post("/api/esci")
def esci(response: Response, s: str = Depends(sessione)):
    with db() as con:
        con.execute("DELETE FROM sessioni WHERE token=?", (s,))
    _chiavi_vault.pop(s, None)
    response.delete_cookie("scrigno_sessione")
    return {"ok": True}


@app.post("/api/cassaforte/sblocca")
def sblocca(body: Password, request: Request, s: str = Depends(sessione)):
    _limite_tentativi(request.client.host if request.client else "?")
    with db() as con:
        if not _verifica_pw(body.password, con):
            raise HTTPException(401, "Password errata")
        _chiavi_vault[s] = _chiave_vault(body.password, con)
    return {"ok": True}


@app.post("/api/cassaforte/blocca")
def blocca(s: str = Depends(sessione)):
    _chiavi_vault.pop(s, None)
    return {"ok": True}


@app.post("/api/impostazioni/password")
def cambia_password(body: CambioPassword, s: str = Depends(sessione)):
    if len(body.nuova) < 6:
        raise HTTPException(400, "La nuova password deve avere almeno 6 caratteri")
    with _lock, db() as con:
        if not _verifica_pw(body.attuale, con):
            raise HTTPException(401, "Password attuale errata")
        vecchia, nuova = Fernet(_chiave_vault(body.attuale, con)), None
        sale = os.urandom(16)
        imp_set(con, "pw_sale", base64.b64encode(sale).decode())
        imp_set(con, "pw_hash", _hash_pw(body.nuova, sale))
        imp_set(con, "sale_vault", base64.b64encode(os.urandom(16)).decode())
        k = _chiave_vault(body.nuova, con)
        nuova = Fernet(k)
        for r in con.execute("SELECT id, segreto FROM password").fetchall():
            chiaro = vecchia.decrypt(r["segreto"].encode())
            con.execute("UPDATE password SET segreto=? WHERE id=?", (nuova.encrypt(chiaro).decode(), r["id"]))
        con.execute("DELETE FROM sessioni WHERE token<>?", (s,))
    _chiavi_vault.clear()
    _chiavi_vault[s] = k
    return {"ok": True}


def _ip_locali() -> list[str]:
    ips = set()
    try:
        so = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        so.connect(("10.255.255.255", 1))
        ips.add(so.getsockname()[0])
        so.close()
    except OSError:
        pass
    try:
        for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(i[4][0])
    except OSError:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


@app.get("/api/impostazioni")
def impostazioni(request: Request, s: str = Depends(sessione)):
    with db() as con:
        return {"token_api": imp_get(con, "token_api"), "token_calendario": imp_get(con, "token_calendario"),
                "indirizzi": [f"http://{ip}:{PORT}" for ip in _ip_locali()],
                "indirizzo_attuale": str(request.base_url).rstrip("/"),
                "nome_host": socket.gethostname(), "cartella_dati": str(DATA)}


@app.post("/api/impostazioni/rigenera/{quale}")
def rigenera(quale: str, s: str = Depends(sessione)):
    if quale not in ("token_api", "token_calendario"):
        raise HTTPException(404)
    with db() as con:
        imp_set(con, quale, secrets.token_urlsafe(24))
    return {"ok": True}


# ====================================================================== cartelle
class Cartella(BaseModel):
    nome: str | None = None
    padre: int | None = None
    icona: str | None = None
    sposta_padre: bool = False
    tipo: str | None = None
    note: list | None = None


@app.get("/api/cartelle")
def cartelle(_=Depends(autorizzato)):
    with db() as con:
        righe = [dict(r) for r in con.execute("SELECT * FROM cartelle ORDER BY ordine, nome")]
        for r in righe:
            r["note"] = json.loads(r.get("note") or "[]")
        conteggi = {r["cartella"]: r["n"] for r in
                    con.execute("SELECT cartella, COUNT(*) n FROM documenti GROUP BY cartella")}
    figli: dict = {}
    for r in righe:
        figli.setdefault(r["padre"], []).append(r["id"])
        r["documenti"] = conteggi.get(r["id"], 0)

    def totale(i):
        return conteggi.get(i, 0) + sum(totale(c) for c in figli.get(i, []))
    for r in righe:
        r["totale"] = totale(r["id"])
        r["sottocartelle"] = len(figli.get(r["id"], []))
    return {"cartelle": righe, "da_smistare": conteggi.get(None, 0)}


@app.post("/api/cartelle")
def crea_cartella(body: Cartella, _=Depends(sessione)):
    if not (body.nome or "").strip():
        raise HTTPException(400, "Nome obbligatorio")
    if body.tipo in MODELLI:
        with db() as con:
            return {"id": _crea_da_modello(con, body.nome.strip(), body.icona, body.padre, body.tipo)}
    with db() as con:
        n = con.execute("SELECT COUNT(*) FROM cartelle WHERE padre IS ?", (body.padre,)).fetchone()[0]
        cur = con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES (?,?,?,?)",
                          (body.nome.strip(), body.padre, body.icona or _icona_auto(body.nome), n))
        return {"id": cur.lastrowid}


def _discendenti(con, cid) -> list[int]:
    out, coda = [], [cid]
    while coda:
        c = coda.pop()
        out.append(c)
        coda += [r[0] for r in con.execute("SELECT id FROM cartelle WHERE padre=?", (c,))]
    return out


@app.patch("/api/cartelle/{cid}")
def modifica_cartella(cid: int, body: Cartella, _=Depends(sessione)):
    with db() as con:
        if body.nome is not None and body.nome.strip():
            con.execute("UPDATE cartelle SET nome=? WHERE id=?", (body.nome.strip(), cid))
        if body.icona:
            con.execute("UPDATE cartelle SET icona=? WHERE id=?", (body.icona, cid))
        if body.tipo in MODELLI:
            r = con.execute("SELECT tipo, icona FROM cartelle WHERE id=?", (cid,)).fetchone()
            if r and r["tipo"] != body.tipo:
                icona = ICONE_MODELLO[body.tipo] if (not body.icona and r["icona"] in ICONE_MODELLO.values()) else (body.icona or r["icona"])
                con.execute("UPDATE cartelle SET tipo=?, icona=?, note=COALESCE(note, '[]') WHERE id=?", (body.tipo, icona, cid))
                esistenti = {x["nome"] for x in con.execute("SELECT nome FROM cartelle WHERE padre=?", (cid,))}
                for n, ic in MODELLI[body.tipo]:
                    if n not in esistenti:
                        con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES (?,?,?,9)", (n, cid, ic))
        if body.note is not None:
            ora = datetime.now(TZ).isoformat(timespec="seconds")
            note = [{"id": n.get("id") or secrets.token_hex(6), "titolo": str(n.get("titolo") or "").strip()[:200], "icona": str(n.get("icona") or "")[:8],
                     "testo": str(n.get("testo") or "")[:20000], "data": n.get("data") or ora} for n in body.note if isinstance(n, dict)]
            con.execute("UPDATE cartelle SET note=? WHERE id=?", (json.dumps(note), cid))
        if body.sposta_padre:
            if body.padre is not None and body.padre in _discendenti(con, cid):
                raise HTTPException(400, "Non puoi spostare una cartella dentro sé stessa")
            con.execute("UPDATE cartelle SET padre=? WHERE id=?", (body.padre, cid))
    return {"ok": True}


@app.delete("/api/cartelle/{cid}")
def elimina_cartella(cid: int, _=Depends(sessione)):
    """Elimina la cartella e le sottocartelle; i documenti contenuti tornano in 'Da smistare'."""
    with db() as con:
        ids = _discendenti(con, cid)
        q = ",".join("?" * len(ids))
        con.execute(f"UPDATE documenti SET cartella=NULL WHERE cartella IN ({q})", ids)
        for i in reversed(ids):
            con.execute("UPDATE cartelle SET padre=NULL WHERE padre=?", (i,))
        con.execute(f"DELETE FROM cartelle WHERE id IN ({q})", ids)
    return {"ok": True}


# ===================================================================== documenti
def _doc(r) -> dict:
    d = dict(r)
    d.pop("file", None)
    return d


@app.get("/api/documenti")
def documenti(cartella: int | None = None, da_smistare: bool = False, cerca: str = "",
              raccolta: str = "", recenti: bool = False, _=Depends(autorizzato)):
    sql, args = "SELECT d.*, c.nome AS nome_cartella FROM documenti d LEFT JOIN cartelle c ON c.id=d.cartella", []
    where = []
    with db() as con:
        if da_smistare:
            where.append("d.cartella IS NULL")
        elif cartella is not None:
            where.append("d.cartella=?")
            args.append(cartella)
        if cerca:
            where.append("(d.nome LIKE ? OR d.note LIKE ? OR c.nome LIKE ?)")
            args += [f"%{cerca}%"] * 3
        if raccolta:
            ids = set()
            for r in con.execute("SELECT id FROM cartelle WHERE nome LIKE ?", (f"%{raccolta}%",)):
                ids.update(_discendenti(con, r["id"]))
            if not ids:
                return []
            where.append(f"d.cartella IN ({','.join('?' * len(ids))})")
            args += list(ids)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY d.creato DESC" + (" LIMIT 12" if recenti else "")
        return [_doc(r) for r in con.execute(sql, args)]


def _percorso_cartella(con, cid) -> str:
    parti = []
    while cid:
        r = con.execute("SELECT nome, padre FROM cartelle WHERE id=?", (cid,)).fetchone()
        if not r:
            break
        parti.insert(0, r["nome"])
        cid = r["padre"]
    return " › ".join(parti)


def _nome_sicuro(nome: str) -> str:
    nome = os.path.basename((nome or "").replace("\\", "/")).strip()
    nome = re.sub(r"[\x00-\x1f<>:\"|?*]", "", nome)
    return nome[:180] or f"documento-{datetime.now():%Y%m%d-%H%M%S}"


def _salva(con, nome: str, dati_iter, mime: str | None, cartella: int | None, note: str, origine: str):
    nome = _nome_sicuro(nome)
    est = Path(nome).suffix.lower()
    if not est:
        est = mimetypes.guess_extension(mime or "") or ""
        nome += est
    mime = mime if mime and mime != "application/octet-stream" else (mimetypes.guess_type(nome)[0] or mime)
    file_id = f"{uuid.uuid4().hex}{est}"
    dest, size = FILES / file_id, 0
    with open(dest, "wb") as f:
        for blocco in dati_iter:
            size += len(blocco)
            if size > MAX_UPLOAD:
                f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "File troppo grande (max 200 MB)")
            f.write(blocco)
    cur = con.execute(
        "INSERT INTO documenti (cartella, nome, file, mime, dimensione, note, creato, origine) VALUES (?,?,?,?,?,?,?,?)",
        (cartella, nome, file_id, mime or "application/octet-stream", size, note,
         datetime.now(TZ).strftime("%Y-%m-%dT%H:%M:%S"), origine))
    return cur.lastrowid


def _blocchi(upload: UploadFile):
    while True:
        b = upload.file.read(1024 * 1024)
        if not b:
            break
        yield b


@app.post("/api/documenti")
async def carica(request: Request, who=Depends(autorizzato)):
    """Carica uno o più file. Funziona sia dall'app sia dai Comandi Rapidi di iPhone.

    - multipart/form-data: qualsiasi campo file (es. 'file' o 'files'), opzionali 'cartella' e 'note'
    - corpo grezzo: il file direttamente nel corpo, nome da ?nome=... o header X-Nome-File
    Senza cartella il file finisce in 'Da smistare'.
    """
    origine = "iphone" if who == "api" else "app"
    ctype = request.headers.get("content-type", "")
    nuovi = []
    if ctype.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
        form = await request.form(max_files=100, max_fields=100)
        cartella = form.get("cartella")
        cartella = int(cartella) if cartella and str(cartella).isdigit() else None
        note = str(form.get("note") or "")
        scadenza = str(form.get("scadenza") or "").strip() or None
        if scadenza:
            date.fromisoformat(scadenza)
        nome_scelto = str(form.get("nome") or "").strip()
        with db() as con:
            testi = []
            for k, v in form.multi_items():
                if hasattr(v, "filename") and hasattr(v, "file"):
                    nuovi.append(_salva(con, v.filename or "", _blocchi(v), v.content_type, cartella, note, origine))
                elif k not in ("cartella", "note", "titolo") and str(v).strip():
                    testi.append(str(v).strip())
            # Condivisione di testo o link (es. da Safari o Note): salvati come nota
            if not nuovi and testi:
                testo = "\n\n".join(testi)
                titolo = str(form.get("titolo") or "").strip()
                if re.match(r"^https?://\S+$", testo):
                    nome = titolo or f"Link {datetime.now(TZ):%d-%m-%Y %H.%M}"
                    dati = f"[InternetShortcut]\r\nURL={testo}\r\n".encode()
                    nuovi.append(_salva(con, nome + ".url", [dati], "text/plain", cartella, testo, origine))
                else:
                    nome = titolo or f"Nota {datetime.now(TZ):%d-%m-%Y %H.%M}"
                    nuovi.append(_salva(con, nome + ".txt", [testo.encode()], "text/plain", cartella, note, origine))
    else:
        nome = request.query_params.get("nome") or request.headers.get("x-nome-file") or ""
        cartella = request.query_params.get("cartella")
        cartella = int(cartella) if cartella and cartella.isdigit() else None
        corpo = await request.body()
        if not corpo:
            raise HTTPException(400, "Nessun file ricevuto")
        mime = ctype.split(";")[0] or None
        if mime and mime.startswith("text/") and not nome:
            nome = f"Nota {datetime.now(TZ):%d-%m-%Y %H.%M}.txt"
        with db() as con:
            nuovi.append(_salva(con, nome, [corpo], mime, cartella, "", origine))
    if not nuovi:
        raise HTTPException(400, "Nessun file ricevuto")
    if ctype.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
        with db() as con:
            if scadenza:
                con.execute(f"UPDATE documenti SET scadenza=? WHERE id IN ({','.join('?' * len(nuovi))})", [scadenza, *nuovi])
            if nome_scelto and len(nuovi) == 1:
                vecchio = con.execute("SELECT nome FROM documenti WHERE id=?", (nuovi[0],)).fetchone()["nome"]
                est = Path(vecchio).suffix
                nuovo = _nome_sicuro(nome_scelto)
                if est and not nuovo.lower().endswith(est.lower()):
                    nuovo += est
                con.execute("UPDATE documenti SET nome=? WHERE id=?", (nuovo, nuovi[0]))
    return {"ok": True, "ids": nuovi, "messaggio": f"{len(nuovi)} file salvati in Scrigno"}


class DocMod(BaseModel):
    nome: str | None = None
    cartella: int | None = None
    sposta: bool = False
    note: str | None = None
    scadenza: str | None = None
    togli_scadenza: bool = False


@app.patch("/api/documenti/{did}")
def modifica_doc(did: int, body: DocMod, _=Depends(sessione)):
    with db() as con:
        if not con.execute("SELECT 1 FROM documenti WHERE id=?", (did,)).fetchone():
            raise HTTPException(404)
        if body.nome and body.nome.strip():
            con.execute("UPDATE documenti SET nome=? WHERE id=?", (_nome_sicuro(body.nome), did))
        if body.sposta:
            con.execute("UPDATE documenti SET cartella=? WHERE id=?", (body.cartella, did))
        if body.note is not None:
            con.execute("UPDATE documenti SET note=? WHERE id=?", (body.note, did))
        if body.togli_scadenza:
            con.execute("UPDATE documenti SET scadenza=NULL WHERE id=?", (did,))
        elif body.scadenza:
            date.fromisoformat(body.scadenza)
            con.execute("UPDATE documenti SET scadenza=? WHERE id=?", (body.scadenza, did))
    return {"ok": True}


@app.delete("/api/documenti/{did}")
def elimina_doc(did: int, _=Depends(sessione)):
    with db() as con:
        r = con.execute("SELECT file FROM documenti WHERE id=?", (did,)).fetchone()
        if not r:
            raise HTTPException(404)
        con.execute("DELETE FROM documenti WHERE id=?", (did,))
    (FILES / r["file"]).unlink(missing_ok=True)
    (MINI / (Path(r["file"]).stem + ".jpg")).unlink(missing_ok=True)
    return {"ok": True}


@app.get("/api/documenti/{did}/file")
def scarica(did: int, scarica: bool = False, _=Depends(autorizzato)):
    with db() as con:
        r = con.execute("SELECT * FROM documenti WHERE id=?", (did,)).fetchone()
    if not r or not (FILES / r["file"]).exists():
        raise HTTPException(404, "File non trovato")
    return FileResponse(FILES / r["file"], media_type=r["mime"], filename=r["nome"], headers=CACHE_FILE,
                        content_disposition_type="attachment" if scarica else "inline")


@app.get("/api/documenti/{did}/miniatura")
def miniatura(did: int, _=Depends(autorizzato)):
    """Anteprima piccola (pochi KB) per le liste: molto più veloce della foto originale."""
    with db() as con:
        r = con.execute("SELECT file, mime FROM documenti WHERE id=?", (did,)).fetchone()
    if not r or not (FILES / r["file"]).exists():
        raise HTTPException(404, "File non trovato")
    dest = MINI / (Path(r["file"]).stem + ".jpg")
    if not dest.exists():
        try:
            from PIL import Image, ImageOps
            with Image.open(FILES / r["file"]) as im:
                im = ImageOps.exif_transpose(im)
                im.thumbnail((480, 480))
                im.convert("RGB").save(dest, "JPEG", quality=78, optimize=True)
        except Exception:
            return FileResponse(FILES / r["file"], media_type=r["mime"], headers=CACHE_FILE)
    return FileResponse(dest, media_type="image/jpeg", headers=CACHE_FILE)


@app.get("/api/backup")
def backup(_=Depends(sessione)):
    """Scarica un unico file .zip con database e documenti."""
    import tempfile
    import zipfile
    from starlette.background import BackgroundTask
    tmp = Path(tempfile.mkdtemp())
    copia_db = tmp / "scrigno.db"
    with db() as con, sqlite3.connect(copia_db) as dest:
        con.backup(dest)
    nome = f"scrigno-backup-{datetime.now(TZ):%Y-%m-%d}.zip"
    with zipfile.ZipFile(tmp / nome, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(copia_db, "dati/scrigno.db")
        for f in FILES.iterdir():
            if f.is_file():
                z.write(f, f"dati/file/{f.name}")

    def pulisci():
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    return FileResponse(tmp / nome, media_type="application/zip", filename=nome, background=BackgroundTask(pulisci))


@app.post("/api/importa")
async def importa(request: Request, s: str = Depends(sessione)):
    """Importa il backup creato dalla modalità iPhone (file .zip con scrigno.json)."""
    import io
    import json
    import zipfile
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    form = await request.form()
    up, pw = form.get("file"), str(form.get("password") or "")
    if not hasattr(up, "file"):
        raise HTTPException(400, "Nessun file ricevuto")
    try:
        z = zipfile.ZipFile(io.BytesIO(await up.read()))
        m = json.loads(z.read("scrigno.json"))
        assert m.get("formato") == "scrigno-backup"
    except Exception:
        raise HTTPException(400, "Il file non è un backup di Scrigno creato sull'iPhone")

    # password della cassaforte del telefono (AES-GCM, chiave PBKDF2-SHA256)
    voci_chiare = []
    cass = m.get("cassaforte") or {}
    if cass.get("voci"):
        if not cass.get("chiave"):
            raise HTTPException(400, "Backup incompleto: manca la chiave della cassaforte")
        if not pw:
            raise HTTPException(400, "Inserisci la password della cassaforte dell'iPhone per importare anche le password")
        k = hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(cass["chiave"]["sale"]), 310000)
        aes = AESGCM(k)
        dec = lambda x: json.loads(aes.decrypt(base64.b64decode(x["iv"]), base64.b64decode(x["ct"]), None))
        try:
            dec(cass["chiave"]["verifica"])
        except Exception:
            raise HTTPException(401, "Password della cassaforte dell'iPhone errata")
        voci_chiare = [dec(v) for v in cass["voci"]]
        if s not in _chiavi_vault:
            raise HTTPException(423, "Apri prima la sezione Password per sbloccare la cassaforte, poi riprova")

    with _lock, db() as con:
        # cartelle: unisce per nome con quelle già presenti
        mappa: dict = {}
        cart = {c["id"]: c for c in m["cartelle"]}

        def id_cartella(cid):
            if cid is None or cid not in cart:
                return None
            if cid in mappa:
                return mappa[cid]
            c = cart[cid]
            padre = id_cartella(c.get("padre"))
            r = con.execute("SELECT id FROM cartelle WHERE nome=? AND padre IS ?", (c["nome"], padre)).fetchone()
            if r:
                mappa[cid] = r["id"]
            else:
                mappa[cid] = con.execute("INSERT INTO cartelle (nome, padre, icona, ordine) VALUES (?,?,?,?)",
                                         (c["nome"], padre, c.get("icona") or "📁", c.get("ordine") or 0)).lastrowid
            return mappa[cid]
        for cid in cart:
            id_cartella(cid)
        n_doc = 0
        for d in m["documenti"]:
            try:
                dati = z.read(d["file"])
            except KeyError:
                continue
            nid = _salva(con, d["nome"], [dati], d.get("mime"), id_cartella(d.get("cartella")), d.get("note") or "", "iphone")
            con.execute("UPDATE documenti SET scadenza=?, creato=? WHERE id=?", (d.get("scadenza"), d.get("creato"), nid))
            n_doc += 1
        n_app = 0
        for a in m["appuntamenti"]:
            if con.execute("SELECT 1 FROM appuntamenti WHERE uid=?", (a.get("uid"),)).fetchone():
                continue
            con.execute("INSERT INTO appuntamenti (uid, titolo, inizio, fine, tutto_il_giorno, luogo, note, categoria, icona, creato) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?)", (a.get("uid") or f"{uuid.uuid4()}@scrigno", a["titolo"], a["inizio"], a["fine"],
                                                       int(bool(a.get("tutto_il_giorno"))), a.get("luogo") or "", a.get("note") or "",
                                                       a.get("categoria") or "altro", a.get("icona") or "📅", a.get("creato")))
            n_app += 1
        n_diario = 0
        for x in m.get("diario") or []:
            con.execute("INSERT INTO diario (tipo, titolo, autore, data, voto, commento, stato, giorno, mese, anno, creato, extra) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (x.get("tipo"), x.get("titolo"), x.get("autore") or "", x.get("data"), x.get("voto"),
                                                           x.get("commento") or "", x.get("stato") or "", x.get("giorno"), x.get("mese"),
                                                           x.get("anno"), x.get("creato"), json.dumps(x.get("extra") or {})))
            n_diario += 1
        if m.get("profilo") and not imp_get(con, "profilo"):
            imp_set(con, "profilo", json.dumps(m["profilo"]))
        if voci_chiare:
            f = Fernet(_chiavi_vault[s])
            ora = datetime.now(TZ).isoformat(timespec="seconds")
            for v in voci_chiare:
                con.execute("INSERT INTO password (titolo, utente, segreto, sito, note, categoria, creato, modificato) VALUES (?,?,?,?,?,?,?,?)",
                            (v.get("titolo", ""), v.get("utente", ""), f.encrypt(v.get("segreto", "").encode()).decode(), v.get("sito", ""),
                             v.get("note", ""), v.get("categoria", ""), v.get("creato") or ora, ora))
    return {"ok": True, "documenti": n_doc, "appuntamenti": n_app, "password": len(voci_chiare), "diario": n_diario}


@app.get("/api/scadenze")
def scadenze(_=Depends(autorizzato)):
    with db() as con:
        righe = con.execute("SELECT d.*, c.nome AS nome_cartella FROM documenti d LEFT JOIN cartelle c "
                            "ON c.id=d.cartella WHERE d.scadenza IS NOT NULL ORDER BY d.scadenza").fetchall()
        out = []
        for r in righe:
            d = _doc(r)
            d["percorso"] = _percorso_cartella(con, r["cartella"])
            out.append(d)
        return out


# ====================================================================== password
class Voce(BaseModel):
    titolo: str
    utente: str = ""
    segreto: str = ""
    sito: str = ""
    note: str = ""
    categoria: str = ""


@app.get("/api/cassaforte")
def voci(k: bytes = Depends(chiave_sessione)):
    f = Fernet(k)
    out = []
    with db() as con:
        for r in con.execute("SELECT * FROM password ORDER BY titolo COLLATE NOCASE"):
            d = dict(r)
            try:
                d["segreto"] = f.decrypt(r["segreto"].encode()).decode()
            except (InvalidToken, AttributeError):
                d["segreto"] = ""
            out.append(d)
    return out


@app.post("/api/cassaforte")
def nuova_voce(v: Voce, k: bytes = Depends(chiave_sessione)):
    ora = datetime.now(TZ).isoformat(timespec="seconds")
    with db() as con:
        cur = con.execute("INSERT INTO password (titolo, utente, segreto, sito, note, categoria, creato, modificato) "
                          "VALUES (?,?,?,?,?,?,?,?)", (v.titolo, v.utente, Fernet(k).encrypt(v.segreto.encode()).decode(),
                                                     v.sito, v.note, v.categoria, ora, ora))
        return {"id": cur.lastrowid}


@app.put("/api/cassaforte/{vid}")
def modifica_voce(vid: int, v: Voce, k: bytes = Depends(chiave_sessione)):
    with db() as con:
        con.execute("UPDATE password SET titolo=?, utente=?, segreto=?, sito=?, note=?, categoria=?, modificato=? WHERE id=?",
                    (v.titolo, v.utente, Fernet(k).encrypt(v.segreto.encode()).decode(), v.sito, v.note,
                     v.categoria, datetime.now(TZ).isoformat(timespec="seconds"), vid))
    return {"ok": True}


@app.delete("/api/cassaforte/{vid}")
def elimina_voce(vid: int, k: bytes = Depends(chiave_sessione)):
    with db() as con:
        con.execute("DELETE FROM password WHERE id=?", (vid,))
    return {"ok": True}


# =================================================================== appuntamenti
class Testo(BaseModel):
    testo: str


class Appuntamento(BaseModel):
    titolo: str
    inizio: str              # YYYY-MM-DD oppure YYYY-MM-DDTHH:MM
    fine: str | None = None
    tutto_il_giorno: bool = False
    luogo: str = ""
    note: str = ""
    categoria: str = "altro"
    icona: str = "📅"


def _norm_app(a: Appuntamento) -> Appuntamento:
    try:
        if a.tutto_il_giorno or len(a.inizio) == 10:
            a.tutto_il_giorno = True
            a.inizio = date.fromisoformat(a.inizio[:10]).isoformat()
            a.fine = date.fromisoformat((a.fine or a.inizio)[:10]).isoformat()
        else:
            s = datetime.fromisoformat(a.inizio)
            e = datetime.fromisoformat(a.fine) if a.fine and len(a.fine) > 10 else s + timedelta(hours=1)
            if e <= s:
                e = s + timedelta(hours=1)
            a.inizio, a.fine = s.strftime("%Y-%m-%dT%H:%M"), e.strftime("%Y-%m-%dT%H:%M")
    except ValueError:
        raise HTTPException(400, "Data o ora non valida")
    if not a.titolo.strip():
        raise HTTPException(400, "Titolo obbligatorio")
    return a


def _app_dict(r) -> dict:
    d = dict(r)
    d["tutto_il_giorno"] = bool(d["tutto_il_giorno"])
    return d


@app.post("/api/appuntamenti/analizza")
def analizza_testo(body: Testo, _=Depends(autorizzato)):
    return analizza(body.testo, datetime.now(TZ).date()).as_dict()


@app.get("/api/appuntamenti")
def appuntamenti(tutti: bool = False, _=Depends(autorizzato)):
    oggi = datetime.now(TZ).date().isoformat()
    with db() as con:
        if tutti:
            q = con.execute("SELECT * FROM appuntamenti ORDER BY inizio")
        else:
            q = con.execute("SELECT * FROM appuntamenti WHERE substr(fine,1,10) >= ? ORDER BY inizio", (oggi,))
        return [_app_dict(r) for r in q]


def _inserisci(con, a: Appuntamento) -> dict:
    a = _norm_app(a)
    uid = f"{uuid.uuid4()}@scrigno"
    cur = con.execute("INSERT INTO appuntamenti (uid, titolo, inizio, fine, tutto_il_giorno, luogo, note, categoria, icona, creato) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?)", (uid, a.titolo.strip(), a.inizio, a.fine, int(a.tutto_il_giorno),
                                                     a.luogo, a.note, a.categoria, a.icona,
                                                     datetime.now(TZ).isoformat(timespec="seconds")))
    return _app_dict(con.execute("SELECT * FROM appuntamenti WHERE id=?", (cur.lastrowid,)).fetchone())


@app.post("/api/appuntamenti")
def crea_appuntamento(a: Appuntamento, _=Depends(autorizzato)):
    with db() as con:
        return _inserisci(con, a)


@app.post("/api/appuntamenti/rapido")
def appuntamento_rapido(body: Testo, request: Request, _=Depends(autorizzato)):
    """Per Siri / Comandi Rapidi: testo libero -> appuntamento salvato.

    Restituisce anche i campi pronti per l'azione 'Aggiungi nuovo evento' di iPhone.
    """
    r = analizza(body.testo, datetime.now(TZ).date())
    if not r.data:
        raise HTTPException(400, "Non ho capito la data. Prova ad esempio: 'il 16 dicembre dentista dalle 10 alle 11'")
    d = r.as_dict()
    with db() as con:
        ev = _inserisci(con, Appuntamento(titolo=r.titolo, inizio=d["inizio"], fine=d["fine"],
                                          tutto_il_giorno=r.tutto_il_giorno, luogo=r.luogo,
                                          categoria=r.categoria, icona=r.icona))
    s = datetime.fromisoformat(ev["inizio"])
    e = datetime.fromisoformat(ev["fine"])
    ev.update({
        "inizio_iphone": s.strftime("%d/%m/%Y %H:%M") if not ev["tutto_il_giorno"] else s.strftime("%d/%m/%Y"),
        "fine_iphone": e.strftime("%d/%m/%Y %H:%M") if not ev["tutto_il_giorno"] else e.strftime("%d/%m/%Y"),
        "frase": _frase(ev),
        "link_ics": f"{str(request.base_url).rstrip('/')}/api/appuntamenti/{ev['id']}.ics?token="
                    f"{request.headers.get('x-token') or request.query_params.get('token') or ''}",
    })
    return ev


MESI_N = ["", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
          "settembre", "ottobre", "novembre", "dicembre"]
GIORNI_N = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]


def _frase(ev) -> str:
    s = datetime.fromisoformat(ev["inizio"])
    base = f"{ev['titolo']}: {GIORNI_N[s.weekday()]} {s.day} {MESI_N[s.month]} {s.year}"
    if ev["tutto_il_giorno"]:
        return base
    return base + f" dalle {s:%H:%M} alle {datetime.fromisoformat(ev['fine']):%H:%M}"


@app.put("/api/appuntamenti/{aid}")
def modifica_appuntamento(aid: int, a: Appuntamento, _=Depends(sessione)):
    a = _norm_app(a)
    with db() as con:
        con.execute("UPDATE appuntamenti SET titolo=?, inizio=?, fine=?, tutto_il_giorno=?, luogo=?, note=?, "
                    "categoria=?, icona=? WHERE id=?", (a.titolo, a.inizio, a.fine, int(a.tutto_il_giorno), a.luogo,
                                                     a.note, a.categoria, a.icona, aid))
    return {"ok": True}


@app.delete("/api/appuntamenti/{aid}")
def elimina_appuntamento(aid: int, _=Depends(sessione)):
    with db() as con:
        con.execute("DELETE FROM appuntamenti WHERE id=?", (aid,))
    return {"ok": True}


def _ev_ics(r) -> dict:
    return {"uid": r["uid"], "titolo": f"{r['icona']} {r['titolo']}".strip(), "inizio": r["inizio"],
            "fine": r["fine"], "tutto_il_giorno": bool(r["tutto_il_giorno"]), "luogo": r["luogo"],
            "note": r["note"], "avvisi": [24 * 60, 60] if not r["tutto_il_giorno"] else [12 * 60]}


# ======================================================================= diario
TIPI_DIARIO = ("film", "libro", "serie", "compleanno", "esame", "acquisto")


class VoceDiario(BaseModel):
    tipo: str
    titolo: str
    autore: str = ""
    data: str | None = None
    voto: int | None = None
    commento: str = ""
    stato: str = ""
    giorno: int | None = None
    mese: int | None = None
    anno: int | None = None
    extra: dict | None = None


def _numero(v):
    try:
        return None if v in ("", None) else round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _norm_extra(tipo: str, e: dict | None) -> dict:
    e = e or {}
    if tipo == "acquisto":
        x = {"prezzo": _numero(e.get("prezzo")), "vendita": _numero(e.get("vendita")),
             "data_vendita": e.get("data_vendita") or None, "categoria": e.get("categoria") or "altro"}
        if x["prezzo"] is None and x["vendita"] is None:
            raise HTTPException(400, "Manca il prezzo")
        if x["vendita"] is None:
            x["data_vendita"] = None
        return x
    if tipo == "esame":
        if e.get("esito") in ("idoneo", "non idoneo"):
            return {"esito": e["esito"], "cfu": _numero(e.get("cfu"))}
        moduli = []
        for i, m in enumerate(e.get("moduli") or []):
            v = _numero(m.get("voto"))
            if v is not None and not 18 <= v <= 30:
                raise HTTPException(400, "Il voto di ogni modulo deve essere tra 18 e 30")
            moduli.append({"nome": str(m.get("nome") or f"Modulo {i + 1}").strip() or f"Modulo {i + 1}",
                           "cfu": _numero(m.get("cfu")) or 6, "voto": v, "lode": bool(m.get("lode")) and v == 30,
                           "data": m.get("data") or None})
        if moduli:
            return {"moduli": moduli, "cfu": sum(m["cfu"] for m in moduli)}
        voto = _numero(e.get("voto"))
        if voto is None or not 18 <= voto <= 30:
            raise HTTPException(400, "Il voto deve essere tra 18 e 30")
        return {"voto": voto, "lode": bool(e.get("lode")) and voto == 30, "cfu": _numero(e.get("cfu")) or 6}
    return {}


def _riga_diario(r) -> dict:
    d = dict(r)
    d["extra"] = json.loads(d.get("extra") or "{}")
    return d


def _norm_diario(v: VoceDiario) -> VoceDiario:
    if v.tipo not in TIPI_DIARIO:
        raise HTTPException(400, "Tipo non valido")
    v.titolo = v.titolo.strip()
    if not v.titolo:
        raise HTTPException(400, "Manca il nome" if v.tipo == "compleanno" else "Manca il titolo")
    if v.voto is not None:
        v.voto = max(1, min(5, v.voto)) if v.voto else None
    if v.tipo == "compleanno":
        try:
            date(2000, v.mese or 0, v.giorno or 0)
        except (ValueError, TypeError):
            raise HTTPException(400, "Data del compleanno non valida")
    if v.data:
        try:
            date.fromisoformat(v.data[:10])
        except ValueError:
            raise HTTPException(400, "Data non valida")
    v.extra = _norm_extra(v.tipo, v.extra)
    return v


def _prossimo(giorno: int, mese: int) -> date:
    oggi = datetime.now(TZ).date()
    for anno in (oggi.year, oggi.year + 1, oggi.year + 2, oggi.year + 3, oggi.year + 4):
        try:
            d = date(anno, mese, giorno)
        except ValueError:  # 29 febbraio
            continue
        if d >= oggi:
            return d
    return oggi


@app.get("/api/diario")
def diario(tipo: str = "", _=Depends(autorizzato)):
    with db() as con:
        q = "SELECT * FROM diario" + (" WHERE tipo=?" if tipo else "")
        righe = [_riga_diario(r) for r in con.execute(q, (tipo,) if tipo else ())]
    comp = sorted([r for r in righe if r["tipo"] == "compleanno"], key=lambda r: _prossimo(r["giorno"], r["mese"]))
    altri = sorted([r for r in righe if r["tipo"] != "compleanno"], key=lambda r: (r["data"] or r["creato"] or "", r["id"]), reverse=True)
    return comp + altri


@app.post("/api/diario")
def nuova_voce_diario(v: VoceDiario, _=Depends(autorizzato)):
    v = _norm_diario(v)
    with db() as con:
        cur = con.execute("INSERT INTO diario (tipo, titolo, autore, data, voto, commento, stato, giorno, mese, anno, creato, extra) "
                          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (v.tipo, v.titolo, v.autore, v.data, v.voto, v.commento, v.stato,
                                                             v.giorno, v.mese, v.anno, datetime.now(TZ).isoformat(timespec="seconds"),
                                                             json.dumps(v.extra)))
        return _riga_diario(con.execute("SELECT * FROM diario WHERE id=?", (cur.lastrowid,)).fetchone())


@app.put("/api/diario/{vid}")
def modifica_voce_diario(vid: int, v: VoceDiario, _=Depends(sessione)):
    v = _norm_diario(v)
    with db() as con:
        con.execute("UPDATE diario SET tipo=?, titolo=?, autore=?, data=?, voto=?, commento=?, stato=?, giorno=?, mese=?, anno=?, extra=? WHERE id=?",
                    (v.tipo, v.titolo, v.autore, v.data, v.voto, v.commento, v.stato, v.giorno, v.mese, v.anno, json.dumps(v.extra), vid))
        r = con.execute("SELECT * FROM diario WHERE id=?", (vid,)).fetchone()
    if not r:
        raise HTTPException(404)
    return _riga_diario(r)


@app.get("/api/profilo")
def profilo(_=Depends(sessione)):
    with db() as con:
        return json.loads(imp_get(con, "profilo", "{}"))


@app.put("/api/profilo")
async def salva_profilo(request: Request, _=Depends(sessione)):
    dati = await request.json()
    if not isinstance(dati, dict):
        raise HTTPException(400, "Dati non validi")
    with db() as con:
        imp_set(con, "profilo", json.dumps({str(k)[:60]: str(v)[:2000] for k, v in dati.items()}))
    return {"ok": True}


@app.delete("/api/diario/{vid}")
def elimina_voce_diario(vid: int, _=Depends(sessione)):
    with db() as con:
        con.execute("DELETE FROM diario WHERE id=?", (vid,))
    return {"ok": True}


@app.get("/api/appuntamenti/{aid}.ics")
def ics_singolo(aid: int, _=Depends(autorizzato)):
    with db() as con:
        r = con.execute("SELECT * FROM appuntamenti WHERE id=?", (aid,)).fetchone()
    if not r:
        raise HTTPException(404)
    nome = re.sub(r"[^\w\- ]", "", r["titolo"])[:40] or "appuntamento"
    return Response(ics.calendario([_ev_ics(r)], "Scrigno", TZ), media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'inline; filename="{nome}.ics"'})


@app.get("/calendario/{token}.ics")
def feed_calendario(token: str):
    """Calendario in abbonamento per iPhone (Impostazioni › Calendario › Account › Aggiungi calendario)."""
    with db() as con:
        if not hmac.compare_digest(token, imp_get(con, "token_calendario", "")):
            raise HTTPException(404)
        eventi = [_ev_ics(r) for r in con.execute("SELECT * FROM appuntamenti")]
        for r in con.execute("SELECT * FROM documenti WHERE scadenza IS NOT NULL"):
            eventi.append({"uid": f"scadenza-{r['id']}@scrigno", "titolo": f"⏰ Scadenza: {Path(r['nome']).stem}",
                           "inizio": r["scadenza"], "fine": r["scadenza"], "tutto_il_giorno": True,
                           "note": f"Documento in Scrigno: {_percorso_cartella(con, r['cartella'])}",
                           "avvisi": [7 * 24 * 60, 12 * 60]})
        for r in con.execute("SELECT * FROM diario WHERE tipo='compleanno'"):
            d = _prossimo(r["giorno"], r["mese"]).replace(year=datetime.now(TZ).year) if not (r["mese"] == 2 and r["giorno"] == 29) else _prossimo(29, 2)
            eventi.append({"uid": f"compleanno-{r['id']}@scrigno", "titolo": f"🎂 Compleanno di {r['titolo']}", "inizio": d.isoformat(),
                           "fine": d.isoformat(), "tutto_il_giorno": True, "rrule": "FREQ=YEARLY",
                           "note": f"Nato/a nel {r['anno']}" if r["anno"] else "", "avvisi_assoluti": ["PT9H", "-PT15H"]})
    return Response(ics.calendario(eventi, "Scrigno", TZ), media_type="text/calendar; charset=utf-8")


# ======================================================================= frontend
@app.exception_handler(HTTPException)
async def errori(request: Request, exc: HTTPException):
    return JSONResponse({"errore": exc.detail}, status_code=exc.status_code)


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(BASE / "static" / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    return FileResponse(BASE / "static" / "sw.js", media_type="text/javascript")


@app.post("/condividi")
async def condividi_android(request: Request, s: str = Depends(sessione)):
    """Destinazione di condivisione per Android (Web Share Target)."""
    await carica(request, s)
    return Response(status_code=303, headers={"Location": "/#/da-smistare"})


app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


@app.get("/")
def home():
    return FileResponse(BASE / "static" / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/salute")
def salute():
    return PlainTextResponse("ok")


if __name__ == "__main__":
    import uvicorn
    print(f"\n  Scrigno è attivo. Apri dal telefono uno di questi indirizzi:")
    for ip in _ip_locali() or ["localhost"]:
        print(f"     http://{ip}:{PORT}")
    print(f"  Dati salvati in: {DATA}\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
