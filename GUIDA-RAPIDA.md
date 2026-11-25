# ✅ LifeApp — cosa fare, passo per passo

## A. Sull'iPhone (adesso, circa 10 minuti)

### 0. Accendi il sito dell'app (1 minuto, una volta sola)
1. In Safari apri **https://github.com/romagnolilorenzo8-jpg/app-personale-/settings/pages** (accedi a GitHub se te lo chiede).
2. Alla voce **Source** lascia **Deploy from a branch**.
3. Alla voce **Branch** scegli **gh-pages**, cartella **/ (root)** → **Save**.
4. Aspetta 2 minuti.

### 1. Apri e installa l'app (1 minuto)
1. Apri **Safari** e vai su **https://romagnolilorenzo8-jpg.github.io/app-personale-/**
2. Tocca **Condividi** (il quadrato con la freccia in su) → **Aggiungi alla schermata Home** → **Aggiungi**.
3. Chiudi Safari e apri **LifeApp dall'icona sulla Home**. D'ora in poi usa **solo l'icona**.
4. Segui la breve presentazione → **Inizia**.

### 2. Crea la cassaforte delle password (1 minuto)
Scheda **🔐 Password** → scegli una password principale e **segnatela in un posto sicuro**: se la perdi, le password salvate non si recuperano.

### 3. Collega il Calendario (3 minuti, una volta sola)
In LifeApp: **⚙️ Altro → Calendario dell'iPhone**: ci sono i 6 passaggi con i pulsanti “Copia”. In breve:
1. App **Comandi Rapidi** → **+** → chiamalo esattamente **LifeApp Calendario**.
2. Azione **Ottieni dizionario da** → *Input comando rapido*.
3. Azione **Aggiungi nuovo evento** → per Titolo, Data inizio, Data fine, Posizione e Note scegli la variabile *Dizionario* con le chiavi **titolo**, **inizio**, **fine**, **luogo**, **note**. Avviso: 1 giorno prima.
4. Torna in LifeApp → **Ho creato il comando** → **Prova il comando**: alla prima volta tocca **Consenti sempre**.
5. Controlla nel Calendario che domani alle 10:00 ci sia “🧪 Prova LifeApp”, poi cancellala.

### 4. (Facoltativo) “Invia a LifeApp” nel menu Condividi (2 minuti)
Istruzioni in **⚙️ Altro → Ricevere file dal menu “Condividi”**. Senza server i file passano dalla cartella **File › LifeApp › In arrivo**: poi in LifeApp tocca **Da smistare → Importa da File**.

### 5. Prova!
- **📷 Fotografa** un documento → scegli la cartella proposta → se è un bollo o un'assicurazione indica quando scade.
- **🗓️ Nuova visita** → scrivi *“il 16 dicembre controllo dal dentista dalle 10 alle 11”* → **Salva**.

### 6. Backup (ogni tanto, 1 minuto)
**⚙️ Altro → Backup → Crea backup e salvalo su File** → scegli **iCloud Drive**. LifeApp te lo ricorda dopo 30 giorni.

---


## A-bis. Aprire LifeApp dal computer
1. Apri **https://romagnolilorenzo8-jpg.github.io/app-personale-/** con Chrome, Edge o Safari. Su schermo grande compare il menu a sinistra.
2. **Attenzione:** senza server, iPhone e computer **non si sincronizzano**. Ognuno ha il suo archivio.
3. Per portare sul computer quello che hai sull'iPhone:
   - sull'iPhone vai su **Altro → Backup → Crea backup** e salvalo su **iCloud Drive**;
   - sul computer scarica quel file da iCloud.com e apri **Altro → Ripristina da un backup**.
4. La sincronizzazione automatica tra i due arriverà con il server di casa.

## B. Sul computer Windows

### Installare o aggiornare (3 minuti)
1. Se è aperta la finestra nera di LifeApp, **chiudila**.
2. Sul sito di GitHub (dove hai già fatto l'accesso): **Code → Download ZIP**.
3. In **Download**: clic destro sullo zip appena scaricato → **Estrai tutto…** → **Estrai**.
4. Nella cartella estratta fai **doppio clic su `installa.bat`** (se Windows avvisa: **Ulteriori informazioni → Esegui comunque**).

Il programma fa tutto da solo:
- mette app e documenti in **C:\Users\(tuo nome)\App personale**;
- recupera i documenti che avevi già caricato;
- cancella zip e cartelle da **Download**;
- crea l'icona **LifeApp** sul Desktop e avvia l'app.

Per gli aggiornamenti futuri basta rifare questi stessi 4 passi: i documenti non vengono mai toccati.

### Usarlo
- **Avvio:** doppio clic sull'icona **LifeApp** del Desktop. Non chiudere la finestra nera finché lo usi.
- **Dove sono i documenti:** `App personale\dati\file` (i nomi sono in codice: si consultano dall'app) e l'elenco in `App personale\dati\scrigno.db`.
- **Backup:** copia l'intera cartella **dati** sulla chiavetta.

## C. Più avanti: il server di casa
- Disco: quello interno del PC (meglio SSD) o un **SSD esterno USB**. La **chiavetta da 256 GB usala per i backup**, non come disco principale.
- I comandi per Linux sono nel **README.md** (sezione 3).

---

### Se il sito non si apre (errore 404)
Controlla di aver salvato il passo 0 con il ramo **gh-pages** e cartella **/ (root)**, aspetta altri 2 minuti e ricarica la pagina.
