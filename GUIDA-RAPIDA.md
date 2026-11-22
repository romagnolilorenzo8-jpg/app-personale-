# ✅ Scrigno — cosa fare, passo per passo

## A. Sull'iPhone (adesso, circa 10 minuti)

### 0. Accendi il sito dell'app (1 minuto, una volta sola)
1. In Safari apri **https://github.com/romagnolilorenzo8-jpg/app-personale-/settings/pages** (accedi a GitHub se te lo chiede).
2. Alla voce **Source** lascia **Deploy from a branch**.
3. Alla voce **Branch** scegli **gh-pages**, cartella **/ (root)** → **Save**.
4. Aspetta 2 minuti.

### 1. Apri e installa l'app (1 minuto)
1. Apri **Safari** e vai su **https://romagnolilorenzo8-jpg.github.io/app-personale-/**
2. Tocca **Condividi** (il quadrato con la freccia in su) → **Aggiungi alla schermata Home** → **Aggiungi**.
3. Chiudi Safari e apri **Scrigno dall'icona sulla Home**. D'ora in poi usa **solo l'icona**.
4. Segui la breve presentazione → **Inizia**.

### 2. Crea la cassaforte delle password (1 minuto)
Scheda **🔐 Password** → scegli una password principale e **segnatela in un posto sicuro**: se la perdi, le password salvate non si recuperano.

### 3. Collega il Calendario (3 minuti, una volta sola)
In Scrigno: **⚙️ Altro → Calendario dell'iPhone**: ci sono i 6 passaggi con i pulsanti “Copia”. In breve:
1. App **Comandi Rapidi** → **+** → chiamalo esattamente **Scrigno Calendario**.
2. Azione **Ottieni dizionario da** → *Input comando rapido*.
3. Azione **Aggiungi nuovo evento** → per Titolo, Data inizio, Data fine, Posizione e Note scegli la variabile *Dizionario* con le chiavi **titolo**, **inizio**, **fine**, **luogo**, **note**. Avviso: 1 giorno prima.
4. Torna in Scrigno → **Ho creato il comando** → **Prova il comando**: alla prima volta tocca **Consenti sempre**.
5. Controlla nel Calendario che domani alle 10:00 ci sia “🧪 Prova Scrigno”, poi cancellala.

### 4. (Facoltativo) “Invia a Scrigno” nel menu Condividi (2 minuti)
Istruzioni in **⚙️ Altro → Ricevere file dal menu “Condividi”**. Senza server i file passano dalla cartella **File › Scrigno › In arrivo**: poi in Scrigno tocca **Da smistare → Importa da File**.

### 5. Prova!
- **📷 Fotografa** un documento → scegli la cartella proposta → se è un bollo o un'assicurazione indica quando scade.
- **🗓️ Nuova visita** → scrivi *“il 16 dicembre controllo dal dentista dalle 10 alle 11”* → **Salva**.

### 6. Backup (ogni tanto, 1 minuto)
**⚙️ Altro → Backup → Crea backup e salvalo su File** → scegli **iCloud Drive**. Scrigno te lo ricorda dopo 30 giorni.

---

## B. Sul computer Windows (5 minuti)

Serve Python installato (da **python.org/downloads**, con la spunta **“Add python.exe to PATH”**).

1. Se è aperta la finestra nera di Scrigno, **chiudila**.
2. Premi il tasto **Windows**, scrivi **powershell** e premi **Invio**.
3. Incolla questa riga (clic destro) e premi **Invio**:
   ```
   irm https://raw.githubusercontent.com/romagnolilorenzo8-jpg/app-personale-/main/installa.ps1 | iex
   ```
4. Il comando crea la cartella **C:\Users\(tuo nome)\App personale** con tutto dentro (app e documenti nella sottocartella `dati`), recupera i documenti già caricati, pulisce Download, crea l'icona **Scrigno** sul Desktop e avvia l'app.

- **Per avviare Scrigno:** doppio clic sull'icona **Scrigno** del Desktop. Non chiudere la finestra nera finché lo usi.
- **Per aggiornare:** chiudi la finestra nera e fai doppio clic su **aggiorna.bat** nella cartella App personale.
- **Dove sono i documenti:** `App personale\dati\file` (con nomi in codice: si consultano dall'app) e l'elenco in `App personale\dati\scrigno.db`. Per il backup copia l'intera cartella **dati** sulla chiavetta.

## C. Più avanti: il server di casa
- Disco: quello interno del PC (meglio SSD) o un **SSD esterno USB**. La **chiavetta da 256 GB usala per i backup**, non come disco principale.
- I comandi per Linux sono nel **README.md** (sezione 3).

---

### Se il sito non si apre (errore 404)
Controlla di aver salvato il passo 0 con il ramo **gh-pages** e cartella **/ (root)**, aspetta altri 2 minuti e ricarica la pagina.
