# Installa Scrigno in un'unica cartella "App personale" (C:\Users\<nome>\App personale),
# recupera i documenti della prima prova, fa pulizia in Download e crea l'icona sul Desktop.
# Uso (PowerShell):  irm https://raw.githubusercontent.com/romagnolilorenzo8-jpg/app-personale-/main/installa.ps1 | iex
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'

$dest = Join-Path $env:USERPROFILE 'App personale'
Write-Host ""
Write-Host "Installo Scrigno in: $dest" -ForegroundColor Cyan
New-Item -ItemType Directory -Force $dest | Out-Null

# 1. scarica l'ultima versione direttamente nella cartella (passando da una cartella temporanea)
$zip = Join-Path $env:TEMP 'scrigno.zip'
$tmp = Join-Path $env:TEMP 'scrigno-installa'
Invoke-WebRequest 'https://github.com/romagnolilorenzo8-jpg/app-personale-/archive/refs/heads/main.zip' -OutFile $zip -UseBasicParsing
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip $tmp -Force
Copy-Item (Join-Path $tmp 'app-personale--main\*') $dest -Recurse -Force
Remove-Item $zip, $tmp -Recurse -Force
Write-Host "App copiata." -ForegroundColor Green

# 2. recupera i documenti della prima prova e fa pulizia in Download
$cartelleDownload = @((Join-Path $env:USERPROFILE 'Downloads'))
try { $cartelleDownload += (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch {}
$datiNuovi = Join-Path $dest 'dati'
foreach ($dl in ($cartelleDownload | Select-Object -Unique)) {
  if (-not (Test-Path $dl)) { continue }
  foreach ($vecchia in Get-ChildItem $dl -Directory -Filter 'app-personale-*' -ErrorAction SilentlyContinue) {
    $db = Get-ChildItem $vecchia.FullName -Recurse -File -Filter 'scrigno.db' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($db) {
      if (Test-Path (Join-Path $datiNuovi 'scrigno.db')) {
        Write-Host "Attenzione: trovati documenti sia in $($vecchia.FullName) sia nella nuova cartella. Lascio la vecchia cartella dove si trova." -ForegroundColor Yellow
        continue
      }
      Copy-Item $db.Directory.FullName $datiNuovi -Recurse -Force
      Write-Host "Recuperati i documenti della prima prova." -ForegroundColor Green
    }
    try { Remove-Item $vecchia.FullName -Recurse -Force }
    catch { Write-Host "Non riesco a cancellare $($vecchia.FullName): chiudi la finestra nera di Scrigno e rilancia il comando." -ForegroundColor Yellow }
  }
  Get-ChildItem $dl -File -Filter 'app-personale-*.zip' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem $dl -File -Filter 'python-3*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}
Write-Host "Download ripulito." -ForegroundColor Green

# 3. icona "Scrigno" sul Desktop
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Scrigno.lnk'))
$lnk.TargetPath = Join-Path $dest 'avvia.bat'
$lnk.WorkingDirectory = $dest
$lnk.Description = 'Avvia Scrigno'
$lnk.Save()
Write-Host "Creata l'icona 'Scrigno' sul Desktop." -ForegroundColor Green

# 4. avvia Scrigno
Write-Host ""
Write-Host "Fatto! Avvio Scrigno in una nuova finestra..." -ForegroundColor Cyan
Start-Process (Join-Path $dest 'avvia.bat') -WorkingDirectory $dest
