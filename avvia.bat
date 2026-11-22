@echo off
REM Avvia Scrigno (Windows). La prima volta installa tutto il necessario.
cd /d "%~dp0"
if not exist .venv (
  echo Prima installazione, attendi 1-3 minuti...
  py -3 -m venv .venv || python -m venv .venv
)
echo Controllo i componenti...
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements.txt || echo Nessuna connessione: avvio con i componenti gia installati.
cd server
..\.venv\Scripts\python app.py
pause
