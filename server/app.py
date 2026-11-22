"""Scrigno — archivio personale: documenti, password, scadenze e visite mediche.

Avvio:  python -m uvicorn app:app --host 0.0.0.0 --port 8080   (dalla cartella server/)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
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
DATA = Path(os.environ.get("SCRIGNO_DATA", BASE.parent / "dati")).resolve()
FILES = DATA / "file"
DB_PATH = DATA / "scrigno.db"
TZ = ZoneInfo(os.environ.get("SCRIGNO_TZ", "Europe/Rome"))
PORT = int(os.environ.get("SCRIGNO_PORT", "8080"))
MAX_UPLOAD = 200 * 1024 * 1024
FILES.mkdir(parents=True, exist_ok=True)

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


@app.get("/api/cartelle")
def cartelle(_=Depends(autorizzato)):
    with db() as con:
        righe = [dict(r) for r in con.execute("SELECT * FROM cartelle ORDER BY ordine, nome")]
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
    return {"ok": True}


@app.get("/api/documenti/{did}/file")
def scarica(did: int, scarica: bool = False, _=Depends(autorizzato)):
    with db() as con:
        r = con.execute("SELECT * FROM documenti WHERE id=?", (did,)).fetchone()
    if not r or not (FILES / r["file"]).exists():
        raise HTTPException(404, "File non trovato")
    return FileResponse(FILES / r["file"], media_type=r["mime"], filename=r["nome"],
                        content_disposition_type="attachment" if scarica else "inline")


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
