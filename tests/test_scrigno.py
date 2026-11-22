"""Test: python -m pytest tests/   (dalla cartella principale)"""
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

os.environ["SCRIGNO_DATA"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app import app  # noqa: E402
from nlp_it import analizza  # noqa: E402

OGGI = date(2026, 11, 22)  # domenica


def test_esempio_dentista():
    r = analizza("il 16 dicembre avrò il controllo dal dentista dalle 10 alle 11", OGGI)
    assert (r.titolo, r.data, r.ora_inizio, r.ora_fine) == ("Controllo dal dentista", "2026-12-16", "10:00", "11:00")
    assert r.categoria == "salute"


def test_data_passata_va_al_prossimo_anno():
    assert analizza("il 16 novembre dentista", OGGI).data == "2027-11-16"


def test_espressioni_varie():
    r = analizza("domani alle 15:30 analisi del sangue presso Ospedale San Marco", OGGI)
    assert (r.data, r.ora_inizio, r.ora_fine, r.luogo) == ("2026-11-23", "15:30", "16:30", "Ospedale San Marco")
    r = analizza("tra 3 giorni dermatologo alle 4 del pomeriggio", OGGI)
    assert (r.data, r.ora_inizio) == ("2026-11-25", "16:00")
    r = analizza("16/12 revisione motorino dalle 8.30 alle 9", OGGI)
    assert (r.titolo, r.ora_inizio, r.ora_fine, r.categoria) == ("Revisione motorino", "08:30", "09:00", "veicoli")
    r = analizza("il 3 dicembre igiene dentale", OGGI)
    assert r.tutto_il_giorno and r.data == "2026-12-03"
    r = analizza("venerdì 5 dicembre visita cardiologica dalle 14 alle 15 e 30", OGGI)
    assert (r.data, r.ora_fine, r.titolo) == ("2026-12-05", "15:30", "Visita cardiologica")


def test_flusso_completo():
    c = TestClient(app)
    assert c.post("/api/configura", json={"password": "segreta1"}).status_code == 200
    tok = c.get("/api/impostazioni").json()["token_api"]
    # invio dal Comando Rapido
    anon = TestClient(app)
    assert anon.get("/api/cartelle").status_code == 401
    r = anon.post("/api/documenti", headers={"X-Token": tok}, files={"file": ("polizza.pdf", b"%PDF", "application/pdf")})
    assert r.status_code == 200
    assert len(c.get("/api/documenti?da_smistare=true").json()) == 1
    # cassaforte cifrata
    c.post("/api/cassaforte", json={"titolo": "Banca", "segreto": "1234"})
    assert c.get("/api/cassaforte").json()[0]["segreto"] == "1234"
    c.post("/api/impostazioni/password", json={"attuale": "segreta1", "nuova": "segreta2"})
    assert c.get("/api/cassaforte").json()[0]["segreto"] == "1234"
    # appuntamento e calendario
    ev = anon.post("/api/appuntamenti/rapido", headers={"X-Token": tok},
                   json={"testo": "il 16 dicembre dentista dalle 10 alle 11"}).json()
    assert ev["inizio_iphone"].endswith("10:00")
    cal = c.get("/api/impostazioni").json()["token_calendario"]
    ics = anon.get(f"/calendario/{cal}.ics").text
    assert "BEGIN:VEVENT" in ics and "Dentista" in ics
    assert anon.get("/calendario/sbagliato.ics").status_code == 404
