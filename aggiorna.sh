#!/usr/bin/env bash
# Aggiorna Scrigno all'ultima versione. I tuoi documenti NON vengono toccati.
set -e
cd "$(dirname "$0")"
T=$(mktemp -d)
curl -fsSL https://github.com/romagnolilorenzo8-jpg/app-personale-/archive/refs/heads/main.zip -o "$T/s.zip"
unzip -q "$T/s.zip" -d "$T"
cp -R "$T/app-personale--main/." .
rm -rf "$T"
echo "Aggiornato!"
exec ./avvia.sh
