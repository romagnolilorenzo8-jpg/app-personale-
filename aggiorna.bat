@echo off
REM Aggiorna Scrigno all'ultima versione. I tuoi documenti NON vengono toccati.
REM Prima di avviarlo chiudi la finestra nera di Scrigno.
cd /d "%~dp0"
echo Scarico l'ultima versione di Scrigno...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $z=Join-Path $env:TEMP 'scrigno.zip'; $d=Join-Path $env:TEMP 'scrigno-agg'; Invoke-WebRequest 'https://github.com/romagnolilorenzo8-jpg/app-personale-/archive/refs/heads/main.zip' -OutFile $z -UseBasicParsing; if (Test-Path $d) { Remove-Item $d -Recurse -Force }; Expand-Archive $z $d -Force; Copy-Item (Join-Path $d 'app-personale--main\*') . -Recurse -Force -Exclude 'aggiorna.bat'; Remove-Item $z, $d -Recurse -Force"
if errorlevel 1 (
  echo Aggiornamento non riuscito: controlla la connessione e riprova.
  pause
  exit /b 1
)
echo Aggiornato! Avvio Scrigno...
call avvia.bat
