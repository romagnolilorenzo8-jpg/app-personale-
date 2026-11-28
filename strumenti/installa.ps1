# Installa (o aggiorna) LifeApp nella cartella "App personale" (C:\Users\<nome>\App personale).
# Si avvia con un doppio clic su installa.bat. I documenti già salvati non vengono mai cancellati.
$ErrorActionPreference = 'Stop'
$src  = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $env:USERPROFILE 'App personale'
Write-Host ""
Write-Host "Installo LifeApp in: $dest" -ForegroundColor Cyan

if ($src -ne $dest) {
  New-Item -ItemType Directory -Force $dest | Out-Null
  # 1. copia il programma (mai la cartella dei documenti)
  Get-ChildItem $src -Force | Where-Object { $_.Name -notin @('dati', '.venv') } |
    ForEach-Object { Copy-Item $_.FullName $dest -Recurse -Force }
  Write-Host "Programma copiato." -ForegroundColor Green

  # 2. cartelle Download dove cercare le copie precedenti
  $downloads = @((Join-Path $env:USERPROFILE 'Downloads'))
  try { $downloads += (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch {}
  $downloads = $downloads | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
  $vecchie = @()
  foreach ($dl in $downloads) { $vecchie += Get-ChildItem $dl -Directory -Filter 'app-personale-*' -ErrorAction SilentlyContinue }

  # 3. recupera i documenti della prova (solo se in App personale non ce ne sono ancora)
  $datiDest = Join-Path $dest 'dati'
  $db = $null
  if (-not (Test-Path (Join-Path $datiDest 'scrigno.db'))) {
    $db = $vecchie | ForEach-Object { Get-ChildItem $_.FullName -Recurse -File -Filter 'scrigno.db' -ErrorAction SilentlyContinue } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($db) {
      Copy-Item $db.Directory.FullName $datiDest -Recurse -Force
      Write-Host "Recuperati i documenti che avevi già caricato." -ForegroundColor Green
    }
  }

  # 4. pulizia di Download: vecchie copie, zip e installatore di Python
  $radice = $null
  foreach ($v in $vecchie) {
    $haDati = Get-ChildItem $v.FullName -Recurse -File -Filter 'scrigno.db' -ErrorAction SilentlyContinue | Select-Object -First 1
    $protetta = $haDati -and (-not $db -or $haDati.FullName -ne $db.FullName)
    if (($src + '\').StartsWith($v.FullName + '\', [StringComparison]::OrdinalIgnoreCase)) {
      if (-not $protetta) { $radice = $v.FullName }   # la cartella appena estratta: la cancello alla fine
      continue
    }
    if ($protetta) {
      Write-Host "Lascio $($v.FullName): contiene documenti non ancora copiati in App personale." -ForegroundColor Yellow
      continue
    }
    try { Remove-Item $v.FullName -Recurse -Force }
    catch { Write-Host "Non riesco a cancellare $($v.FullName): chiudi la finestra nera di LifeApp e riprova." -ForegroundColor Yellow }
  }
  foreach ($dl in $downloads) {
    Get-ChildItem $dl -File -Filter 'app-personale-*.zip' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $dl -File -Filter 'python-3*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  }
  Write-Host "Cartella Download ripulita." -ForegroundColor Green
}

# 5. icona "LifeApp" sul Desktop
$vecchia = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Scrigno.lnk'   # nome di prima
if (Test-Path $vecchia) { Remove-Item $vecchia -Force }
$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'LifeApp.lnk'))
$lnk.TargetPath = Join-Path $dest 'avvia.bat'
$lnk.WorkingDirectory = $dest
$lnk.IconLocation = (Join-Path $dest 'strumenti\lifeapp.ico') + ',0'
$lnk.Description = 'Avvia LifeApp'
$lnk.Save()
Write-Host "Creata l'icona 'LifeApp' sul Desktop." -ForegroundColor Green

# 6. avvia LifeApp e, alla fine, cancella la cartella estratta in Download
Start-Process (Join-Path $dest 'avvia.bat') -WorkingDirectory $dest
if ($radice) {
  Start-Process cmd.exe -ArgumentList "/c timeout /t 12 /nobreak >nul & rmdir /s /q `"$radice`"" -WindowStyle Hidden -WorkingDirectory $env:TEMP
}
Write-Host ""
Write-Host "Fatto! Da ora avvia LifeApp con l'icona sul Desktop." -ForegroundColor Cyan
Start-Sleep -Seconds 4
