# 🔐 Scrigno — la mia app personale

Archivio personale per **documenti, password, bolli, assicurazioni, salute e visite mediche**.
Gira sul tuo computer o sul mini server di casa: i file restano tuoi e non passano da nessun servizio esterno.

| | |
|---|---|
| 🗂️ **Archivio a cartelle** | Già pronte: *Mezzi di trasporto › Motorino / Auto › Bollo, Assicurazione, Revisione…*, *Salute › Analisi del sangue, Dentista › Radiografie denti…*, *Assicurazioni*, *Documenti personali*, *Casa*, *Lavoro e tasse*. Puoi crearne, rinominarle, spostarle e cambiarne l'icona. |
| 📤 **Menu “Condividi” di iPhone** | Da qualsiasi app: *Condividi → Invia a Scrigno*. Il file arriva in **📥 Da smistare** e con un tocco lo sposti nella cartella giusta. |
| 🛡️ **Raccolte rapide** | “Tutte le assicurazioni”, “Tutti i bolli”, “Revisioni”: raccolgono i documenti da tutte le cartelle (es. assicurazione dell'auto + del motorino + della casa). |
| ⏰ **Scadenze** | Imposti la scadenza di bollo, assicurazione o carta d'identità e ricevi un avviso sul calendario 7 giorni prima. |
| 🗓️ **Visite → Calendario iPhone** | Scrivi *“il 16 dicembre avrò il controllo dal dentista dalle 10 alle 11”*: Scrigno capisce data, ora di inizio e fine, titolo e luogo, e l'appuntamento compare nel Calendario dell'iPhone con promemoria. |
| 🔑 **Password** | Cifrate (AES, chiave ricavata dalla tua password), con generatore e copia rapida. |
| 🌗 **Interfaccia** | Pensata per iPhone, si installa sulla schermata Home e funziona a schermo intero; tema chiaro e scuro automatici. |

---

## 0. Subito sull'iPhone, senza server (“modalità iPhone”)

L'app funziona anche **da sola sull'iPhone**: documenti, visite e password vengono salvati nella memoria del telefono (le password cifrate) e funziona anche senza internet.

**Da fare una volta sola (2 minuti, dall'iPhone):**
1. Apri **github.com** → il repository **app-personale-** → **Settings** → **Pages**.
2. In *Build and deployment*: Source **Deploy from a branch** → Branch **`claude/personal-docs-health-app-v5nfcp`**, cartella **`/docs`** → **Save**.
3. Dopo 1-2 minuti apri con **Safari**: **https://romagnolilorenzo8-jpg.github.io/app-personale-/**
4. Tocca **Condividi → Aggiungi alla schermata Home** e da quel momento apri Scrigno **solo dall'icona**.

Note:
- Online c'è solo il **codice** dell'app (il repository è pubblico): i tuoi documenti **non escono mai dal telefono**.
- In **Altro → Backup** crei un file con tutto, da salvare nell'app File. Fallo ogni tanto: se cancelli l'app o cambi telefono, è l'unica copia.
- Il menu “Condividi” e il Calendario funzionano tramite due Comandi Rapidi: le istruzioni passo passo sono in **Altro**.
- Quando il server di casa sarà pronto: crea un backup sull'iPhone, apri Scrigno dal server → **Altro → Importa backup dall'iPhone**.
- La cartella `docs/` si rigenera con `python3 tools/crea_versione_iphone.py` dopo ogni modifica a `server/static/`.

## 1. Avvio (prova sul tuo computer)

Serve **Python 3.10 o più recente** ([python.org](https://www.python.org/downloads/)).

- **Mac / Linux**: `./avvia.sh`
- **Windows**: doppio clic su `avvia.bat`

Il terminale mostra un indirizzo tipo `http://192.168.1.20:8080`. Aprilo con **Safari sull'iPhone**, collegato allo **stesso Wi-Fi**.
Al primo accesso scegli una password. **Non dimenticarla**: senza, le password salvate non si possono recuperare.

## 2. Sull'iPhone (una volta sola)

Le istruzioni passo passo, con l'indirizzo e il codice già pronti da copiare, sono nell'app: scheda **⚙️ Altro**.

1. **Installa l'app**: Safari → Condividi → *Aggiungi alla schermata Home*.
2. **Menu Condividi**: crea il Comando Rapido *Invia a Scrigno* (6 passaggi, servono circa 2 minuti).
3. **Calendario**: tocca *Collega calendario*. Da quel momento visite e scadenze compaiono da sole nel Calendario dell'iPhone.
4. **(Facoltativo) Siri**: comando *“Ehi Siri, nuova visita”* → detti l'appuntamento → viene creato subito nel Calendario.

## 3. Spostare tutto sul mini server di casa (PC vecchio)

Consiglio: installa **Ubuntu Server** o **Debian** (vanno bene anche su PC di 10-15 anni fa).

```bash
sudo apt install -y python3 python3-venv git
git clone <indirizzo-di-questo-repository> ~/app-personale-
cd ~/app-personale- && ./avvia.sh          # prima prova, poi Ctrl+C
# avvio automatico all'accensione:
sed -i "s/UTENTE/$USER/g" scrigno.service
sudo cp scrigno.service /etc/systemd/system/ && sudo systemctl enable --now scrigno
```

- Nel router dai al PC un **IP fisso** (DHCP statico), così l'indirizzo non cambia.
- Per portare i dati di prova sul server basta copiare la cartella `dati/`.
- **Backup**: tutto quello che conta è nella cartella `dati/` (database + file). Copiala ogni tanto su un disco esterno.
- **Fuori casa**: installa [Tailscale](https://tailscale.com) (gratuito) sul server e sull'iPhone. Scrigno è raggiungibile ovunque, in modo sicuro, **senza aprire porte sul router**. Sconsiglio di esporlo direttamente su Internet.

## Quanto spazio serve sul server?

I documenti occupano poco: un PDF 100 KB–2 MB, una foto 2–5 MB. **1.000 documenti ≈ 2–4 GB.** Lo spazio non è il problema: conta l'**affidabilità**.

- **Va bene:** il disco interno del PC (meglio se SSD) oppure un **SSD/HDD esterno USB** (un SSD da 250–500 GB costa 30–50 €).
- **Sconsigliata come disco principale:** la chiavetta USB. Funziona, ma è pensata per copiare file ogni tanto, non per restare accesa giorno e notte con un database che scrive di continuo. Si consuma e può rompersi senza preavviso.
- **La chiavetta da 256 GB usala per il backup:** una copia della cartella `dati/` ogni settimana. Due copie in due posti diversi ti proteggono quasi da tutto.

## Impostazioni avanzate (variabili d'ambiente)

| Variabile | Predefinito | Significato |
|---|---|---|
| `SCRIGNO_DATA` | `./dati` | Dove salvare database e file |
| `SCRIGNO_PORT` | `8080` | Porta del server |
| `SCRIGNO_TZ` | `Europe/Rome` | Fuso orario degli appuntamenti |

## Struttura

```
server/app.py        API (FastAPI) + database SQLite
server/nlp_it.py     comprende appuntamenti scritti in italiano
server/ics.py        genera i calendari per iPhone (.ics / abbonamento webcal)
server/static/       interfaccia web (HTML/CSS/JS, nessuna dipendenza esterna)
server/static/locale.js   modalità iPhone: archivio nella memoria del telefono, backup, cifratura
server/static/nlp.js      riconoscimento appuntamenti sul telefono (stesso risultato di nlp_it.py)
docs/                versione iPhone pubblicata con GitHub Pages (generata da tools/crea_versione_iphone.py)
tests/               test automatici:  python -m pytest tests/
```

## Perché una web app e non un'app dell'App Store?

Un'app nativa iOS richiede un Mac con Xcode e un account sviluppatore Apple (99 €/anno), e senza account va reinstallata ogni 7 giorni.
La web app installata sulla schermata Home ha lo stesso aspetto, si aggiorna da sola quando aggiorni il server e, grazie ai Comandi Rapidi, compare comunque nel menu Condividi e può scrivere nel Calendario.
