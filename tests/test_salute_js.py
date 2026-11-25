"""Cibo, calorie e attività (server/static/salute.js, eseguito con node)."""
import json
import subprocess
from pathlib import Path

R = Path(__file__).resolve().parent.parent


def js(codice):
    pre = f"const S = require({json.dumps(str(R / 'server/static/salute.js'))});\n"
    return json.loads(subprocess.run(["node", "-e", pre + codice], capture_output=True, text=True, check=True).stdout)


def test_leggi_pasto():
    out = js("""console.log(JSON.stringify(["80 g di pasta e 2 uova", "una mela, 2 fette di pane con prosciutto crudo", "mezzo litro di latte",
      "pasta integrale 100 g", "un cucchiaio di olio", "200 g di Gocciole"].map((t) => S.leggiPasto(t).map((x) => [x.nome, x.grammi, x.alimento ? S.valori(x.alimento, x.grammi).kcal : null]))));""")
    assert out == [
        [["Pasta", 80, 282], ["Uova", 110, 143]],
        [["Mela", 170, 88], ["Pane", 60, 159], ["Prosciutto crudo", 50, 134]],
        [["Latte", 500, 230]],
        [["Pasta integrale", 100, 340]],
        [["Olio d'oliva", 10, 90]],
        [["Gocciole", 200, None]],
    ]


def test_cibi_miei_hanno_la_precedenza():
    out = js("""const miei = [{ nome: "Gocciole", kcal: 489, p: 7, c: 66, g: 21, porz: 30 }];
      console.log(JSON.stringify(S.leggiPasto("50 g di gocciole e gocciole", miei).map((x) => [x.nome, x.grammi, x.alimento.kcal])));""")
    assert out == [["Gocciole", 50, 489], ["Gocciole", 30, 489]]


def test_calorie_attivita_fabbisogno():
    out = js("""console.log(JSON.stringify([S.kcalAttivita({ sport: "Corsa", minuti: 30, km: 5 }, 75), S.kcalAttivita({ sport: "Camminata", passi: 8000 }, 70),
      S.bmr({ sesso: "M", eta: 24, peso: 75, altezza: 178 }), S.bmr({ sesso: "F", eta: 30, peso: 60, altezza: 165 }), S.bmr({ sesso: "M" }),
      S.leggiSalute("LifeApp-Salute;2026-11-25;520,4;8.400"),
      S.daStrava({ id: 9, name: "Corsa mattutina", sport_type: "Run", moving_time: 1800, distance: 5000, start_date_local: "2026-11-24T07:10:00Z" }, 75),
      S.daStrava({ id: 10, name: "Giro", sport_type: "Ride", moving_time: 3600, distance: 25000, kilojoules: 600, start_date_local: "2026-11-23T10:00:00Z" }),
      S.daOff({ product_name: "Gocciole", brands: "Pavesi", nutriments: { "energy-kcal_100g": 489, proteins_100g: 7.2, carbohydrates_100g: 66, fat_100g: 21 }, serving_quantity: 30 }, "8013355998771")]));""")
    corsa, cammina, bm, bf, nessuno, salute, strava, bici, off = out
    assert corsa == 338 and cammina == 320 and bm == 1748 and bf == 1320 and nessuno is None
    assert salute == [{"data": "2026-11-25", "kcal": 520, "passi": 8400}]
    assert strava["data"] == "2026-11-24" and strava["extra"] == {"sport": "Corsa", "minuti": 30, "km": 5, "passi": None, "kcal": 338, "fonte": "strava", "ext_id": "strava-9"}
    assert bici["extra"]["sport"] == "Bici" and bici["extra"]["kcal"] == 600
    assert off == {"nome": "Gocciole (Pavesi)", "codice": "8013355998771", "kcal": 489, "p": 7.2, "c": 66, "g": 21, "pezzo": 30, "porz": 30}
