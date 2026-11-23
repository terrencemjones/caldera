# Caldera uninstaller. Runs from Settings > Apps, or directly:
#   powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Caldera\uninstall.ps1" [-Quiet]
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$name = 'Caldera'
$dir = Join-Path $env:LOCALAPPDATA $name
Add-Type -AssemblyName System.Windows.Forms

if (-not $Quiet) {
  $answer = [Windows.Forms.MessageBox]::Show(
    "Remove $name from this computer?`n`nThis also deletes the scene and terrains saved inside the app. Images and movies you saved elsewhere are not touched.",
    "Uninstall $name", 'YesNo', 'Question')
  if ($answer -ne 'Yes') { exit 1 }
}

# Close the app; its browser profile cannot be deleted while it is open.
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains("--user-data-dir=`"$dir\profile`"") } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

foreach ($folder in 'Programs', 'Desktop') {
  Remove-Item (Join-Path ([Environment]::GetFolderPath($folder)) "$name.lnk") -Force -ErrorAction SilentlyContinue
}
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$name" -Recurse -Force -ErrorAction SilentlyContinue

Set-Location $env:TEMP
$left = $false
for ($i = 0; $i -lt 5; $i++) {
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  $left = Test-Path $dir
  if (-not $left) { break }
  Start-Sleep -Milliseconds 600
}

if (-not $Quiet) {
  $text = if ($left) { "$name was removed, but some files could not be deleted:`n$dir" } else { "$name was removed." }
  [void][Windows.Forms.MessageBox]::Show($text, "Uninstall $name", 'OK', 'Information')
}
