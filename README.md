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
tests/               test automatici:  python -m pytest tests/
```

## Perché una web app e non un'app dell'App Store?

Un'app nativa iOS richiede un Mac con Xcode e un account sviluppatore Apple (99 €/anno), e senza account va reinstallata ogni 7 giorni.
La web app installata sulla schermata Home ha lo stesso aspetto, si aggiorna da sola quando aggiorni il server e, grazie ai Comandi Rapidi, compare comunque nel menu Condividi e può scrivere nel Calendario.
