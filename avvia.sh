#!/usr/bin/env bash
# Avvia Scrigno (Mac / Linux). La prima volta crea l'ambiente e installa le dipendenze.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Prima installazione…"
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi
cd server
exec ../.venv/bin/python app.py
