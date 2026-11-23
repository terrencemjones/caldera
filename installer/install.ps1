# Caldera installer. scripts/build-installer.mjs wraps this in Caldera-Setup.cmd, with
# $Version and $Payload (base64 files: Html, Icon, Launcher, Uninstall) defined above it.
#
# Installs for the current user only, with no administrator rights:
#   %LOCALAPPDATA%\Caldera\   the app, its launcher and its browser profile
#   Start Menu and Desktop    shortcuts
#   Settings > Apps           an uninstall entry
$ErrorActionPreference = 'Stop'
$name = 'Caldera'
$dir = Join-Path $env:LOCALAPPDATA $name
$exe = Join-Path $dir "$name.exe"
$ico = Join-Path $dir "$name.ico"
$html = Join-Path $dir "$name.html"

function Unpack($key, $path) {
  [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($Payload[$key]))
}

function Find-Browser {
  foreach ($b in 'chrome.exe', 'msedge.exe') {
    foreach ($root in 'HKCU:', 'HKLM:') {
      $p = (Get-ItemProperty "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$b" -ErrorAction SilentlyContinue).'(default)'
      if ($p -and (Test-Path $p)) { return $p }
    }
  }
  return $null
}

Write-Host "Installing $name $Version..."
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# An open Caldera window keeps running the old copy; close it so the new one is used.
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains("--user-data-dir=`"$dir\profile`"") } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Unpack 'Html' $html
Unpack 'Icon' $ico
Unpack 'Uninstall' (Join-Path $dir 'uninstall.ps1')

# Build the launcher with the C# compiler that is part of Windows.
$source = Join-Path $dir 'Launcher.cs'
Unpack 'Launcher' $source
$built = $false
try {
  if (Test-Path $exe) { Remove-Item $exe -Force }
  $cp = New-Object System.CodeDom.Compiler.CompilerParameters
  $cp.GenerateExecutable = $true
  $cp.OutputAssembly = $exe
  $cp.CompilerOptions = "/target:winexe /optimize /win32icon:`"$ico`""
  [void]$cp.ReferencedAssemblies.Add('System.dll')
  Add-Type -TypeDefinition ([IO.File]::ReadAllText($source)) -CompilerParameters $cp -WarningAction SilentlyContinue
  $built = Test-Path $exe
} catch {
  Write-Host "Could not build the launcher ($($_.Exception.Message)). Using plain shortcuts instead."
}
Remove-Item $source -Force -ErrorAction SilentlyContinue

$links = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk")
)
if ($built) {
  foreach ($link in $links) {
    $p = Start-Process -FilePath $exe -ArgumentList '--shortcut', "`"$link`"" -PassThru
    $p.WaitForExit()
    if ($p.ExitCode -ne 0 -or -not (Test-Path $link)) { throw "Could not create the shortcut $link" }
  }
} else {
  # Fallback for locked-down PCs: shortcuts that open the browser's app window directly.
  # Everything works, but the taskbar treats the window as part of the browser.
  $browser = Find-Browser
  if (-not $browser) { throw "$name needs Google Chrome or Microsoft Edge, and neither was found." }
  $ws = New-Object -ComObject WScript.Shell
  foreach ($link in $links) {
    $s = $ws.CreateShortcut($link)
    $s.TargetPath = $browser
    $s.Arguments = "--app=`"$(([Uri]$html).AbsoluteUri)`" --user-data-dir=`"$dir\profile`" --no-first-run --no-default-browser-check --start-maximized"
    $s.WorkingDirectory = $dir
    $s.IconLocation = "$ico,0"
    $s.Description = "$name landscape studio"
    $s.Save()
  }
}

$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$name"
New-Item -Path $key -Force | Out-Null
$size = [int]((Get-ChildItem $dir -File | Measure-Object Length -Sum).Sum / 1KB)
$values = @{
  DisplayName     = $name
  DisplayVersion  = $Version
  Publisher       = 'terrencemjones'
  DisplayIcon     = $ico
  InstallLocation = $dir
  URLInfoAbout    = 'https://github.com/terrencemjones/caldera'
  UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\uninstall.ps1`""
}
foreach ($v in $values.GetEnumerator()) { Set-ItemProperty -Path $key -Name $v.Key -Value $v.Value }
foreach ($v in 'NoModify', 'NoRepair') { Set-ItemProperty -Path $key -Name $v -Value 1 -Type DWord }
Set-ItemProperty -Path $key -Name EstimatedSize -Value $size -Type DWord

Write-Host "Done. $name is in the Start menu and on the Desktop."
if (-not $env:CALDERA_SETUP_NO_LAUNCH) {
  Write-Host "Starting it now..."
  Start-Process -FilePath $links[0]
}
