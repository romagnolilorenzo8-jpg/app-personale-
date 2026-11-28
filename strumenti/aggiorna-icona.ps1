# LifeApp: mette la nuova icona (stile iPhone) sul collegamento del Desktop.
# Se c'è già un collegamento "Scrigno" o "LifeApp" ne cambia solo l'icona (e il nome in LifeApp);
# se non c'è, ne crea uno che apre LifeApp nel browser.
$cartella = Join-Path $env:USERPROFILE 'App personale'
New-Item -ItemType Directory -Force $cartella | Out-Null
$ico = Join-Path $cartella 'lifeapp.ico'
Invoke-WebRequest 'https://romagnolilorenzo8-jpg.github.io/app-personale-/static/lifeapp.ico' -OutFile $ico
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$trovati = Get-ChildItem $desktop -Filter *.lnk | Where-Object { $_.BaseName -in @('Scrigno', 'LifeApp') }
if ($trovati) {
  foreach ($f in $trovati) {
    $l = $ws.CreateShortcut($f.FullName); $l.IconLocation = "$ico,0"; $l.Save()
    if ($f.BaseName -ne 'LifeApp') { Rename-Item $f.FullName 'LifeApp.lnk' -Force }
  }
} else {
  $l = $ws.CreateShortcut((Join-Path $desktop 'LifeApp.lnk'))
  $l.TargetPath = 'explorer.exe'; $l.Arguments = 'https://romagnolilorenzo8-jpg.github.io/app-personale-/'
  $l.IconLocation = "$ico,0"; $l.Description = 'Apri LifeApp'; $l.Save()
}
ie4uinit.exe -show   # aggiorna subito le icone di Windows
Write-Host 'Fatto: icona di LifeApp aggiornata sul Desktop.' -ForegroundColor Green
