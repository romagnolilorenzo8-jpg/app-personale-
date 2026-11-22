@echo off
REM Installa o aggiorna Scrigno nella cartella "App personale". I documenti non vengono toccati.
REM Prima chiudi la finestra nera di Scrigno, se e aperta.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0strumenti\installa.ps1"
if errorlevel 1 pause
exit
