#!/usr/bin/env bash
# Avvia LifeApp (Mac / Linux). La prima volta installa tutto il necessario.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Prima installazione, attendi 1-3 minuti…"
  python3 -m venv .venv
fi
.venv/bin/pip install -q --disable-pip-version-check -r requirements.txt || echo "Nessuna connessione: avvio con i componenti già installati."
cd server
exec ../.venv/bin/python app.py
