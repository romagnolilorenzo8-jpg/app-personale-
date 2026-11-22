@echo off
REM Avvia Scrigno (Windows). La prima volta crea l'ambiente e installa le dipendenze.
cd /d "%~dp0"
if not exist .venv (
  echo Prima installazione...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\pip install -q -r requirements.txt
)
cd server
..\.venv\Scripts\python app.py
pause
