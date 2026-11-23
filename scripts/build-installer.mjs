// Builds dist/Caldera-Setup.cmd: a single file a Windows user double-clicks to install
// Caldera as an app (Start menu, Desktop, taskbar, Settings > Apps). It carries the
// standalone HTML, the icon, the launcher source and the uninstaller inside it.
// Usage: npm run installer
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const b64 = (path) => readFileSync(path).toString('base64');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const MARK = '::PS1::';

// The batch part hands the rest of this same file to PowerShell. It finds the marker by
// building it from two pieces, so the search never matches this command line itself.
const batch = [
  '@echo off',
  'setlocal',
  'title Caldera Setup',
  'set "CALDERA_SETUP=%~f0"',
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:CALDERA_SETUP); $m=':'+':PS1::'; iex $t.Substring($t.IndexOf($m)+$m.Length)"`,
  'if errorlevel 1 (',
  '  echo.',
  '  echo Caldera was not installed. The message above says why.',
  '  pause',
  ')',
  'exit /b',
  MARK,
].join('\r\n');

const payload = {
  Html: b64(join('dist', 'standalone.html')),
  Icon: b64(join('assets', 'caldera.ico')),
  Launcher: b64(join('installer', 'Launcher.cs')),
  Uninstall: b64(join('installer', 'uninstall.ps1')),
};

const script = [
  '',
  `$Version = '${version}'`,
  '$Payload = @{',
  ...Object.entries(payload).map(([k, v]) => `  ${k} = '${v}'`),
  '}',
  'try {',
  readFileSync(join('installer', 'install.ps1'), 'utf8'),
  '} catch {',
  '  Write-Host ""',
  '  Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red',
  '  exit 1',
  '}',
  '',
].join('\r\n');

const out = process.argv[2] ?? join('dist', 'Caldera-Setup.cmd');
writeFileSync(out, batch + script);
console.log(`${out} (${((batch.length + script.length) / 1024).toFixed(0)} KB)`);
