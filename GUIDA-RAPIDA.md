# ✅ Scrigno — cosa fare, passo per passo

## A. Sull'iPhone (adesso, circa 10 minuti)

### 1. Apri e installa l'app (1 minuto)
1. Apri **Safari** e vai su **https://romagnolilorenzo8-jpg.github.io/app-personale-/**
   - Se compare “404”: vedi la sezione **Se il sito non si apre** in fondo.
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

## B. Sul computer (stasera, 15 minuti) — per provare la versione con server

1. Installa Python da **https://www.python.org/downloads/**
   - **Windows:** durante l'installazione spunta **“Add python.exe to PATH”**.
2. Scarica Scrigno: **https://github.com/romagnolilorenzo8-jpg/app-personale-** → pulsante verde **Code** → **Download ZIP** → estrai la cartella.
3. Avvia:
   - **Windows:** doppio clic su **avvia.bat** (se Windows avvisa, “Ulteriori informazioni” → “Esegui comunque”).
   - **Mac:** apri il Terminale nella cartella e scrivi `./avvia.sh`.
   - La prima volta scarica i componenti (1-2 minuti), poi mostra un indirizzo tipo `http://192.168.1.20:8080`.
4. Se Windows chiede di consentire l'accesso alla rete: **Consenti** sulle reti **private**.
5. Sull'iPhone, **collegato allo stesso Wi-Fi**, apri quell'indirizzo con Safari e scegli la password.
6. Per portarci i dati dell'iPhone: sull'iPhone **Altro → Backup**, poi nella versione del computer **Altro → Importa backup dall'iPhone**.

Se qualcosa non va, copia il messaggio che vedi (o fai uno screenshot) e mandamelo.

---

## C. Più avanti: il server di casa
- Disco: quello interno del PC (meglio SSD) o un **SSD esterno USB**. La **chiavetta da 256 GB usala per i backup**, non come disco principale.
- I comandi per Linux sono nel **README.md** (sezione 3).

---

### Se il sito non si apre (errore 404)
Dall'iPhone vai su **github.com/romagnolilorenzo8-jpg/app-personale-** → **Settings** (se non lo vedi: menu **⋯**) → **Pages** → *Source*: **Deploy from a branch** → Branch **gh-pages**, cartella **/ (root)** → **Save**. Aspetta 2 minuti e riprova.
