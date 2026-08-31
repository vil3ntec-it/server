// ---------------------------------------------------------------------------
//  ساختنِ «نصب-برنامه.bat» — یک فایلِ تنها که همه‌چیز داخلش است
//
//      node tools/build-setup.mjs
//
//  چرا: وقتی زیپ را باز می‌کنید نباید ده‌ها فایل و پوشه ببینید. یک فایل
//  می‌بینید، دوبار کلیک می‌کنید، پوشه را انتخاب می‌کنید، تمام.
//
//  چطور کار می‌کند: خودِ فایلِ bat دو تکه است — بالایش دستورِ ویندوز، پایینش
//  کلِ برنامه به‌صورتِ base64. موقعِ اجرا، پاورشل همان فایل را می‌خواند،
//  تکهٔ پایین را باز می‌کند در پوشهٔ موقت، و پنجرهٔ نصب را باز می‌کند.
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MARK = '#####PAYLOAD#####';

const version = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'homelab-panel', 'server', 'package.json'), 'utf8')
).version;

// ۱) بستهٔ فشرده از فایل‌هایی که در گیت هستند (بدونِ data و node_modules)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-setup-'));
const zipPath = path.join(tmp, 'payload.zip');
execFileSync('git', ['archive', '--format=zip', `--prefix=pump-server-${version}/`, '-o', zipPath, 'HEAD'], {
  cwd: ROOT,
});
const payload = fs.readFileSync(zipPath).toString('base64').replace(/(.{120})/g, '$1\n');

// ۲) اسکریپتی که پاورشل اجرا می‌کند. با -EncodedCommand فرستاده می‌شود تا
//    هیچ کوتیشن و کاراکترِ عجیبی در مسیر، دستور را نشکند.
const psScript = `
$ErrorActionPreference = 'Stop'
$self = $env:PUMP_SETUP_SELF
$text = [System.IO.File]::ReadAllText($self, [System.Text.Encoding]::ASCII)
$mark = '${MARK}'
$at = $text.IndexOf($mark)
if ($at -lt 0) { throw 'Payload not found inside this file.' }
$b64 = ($text.Substring($at + $mark.Length) -replace '\\s', '')
$temp = Join-Path $env:TEMP ('pump-setup-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$zip = Join-Path $temp 'payload.zip'
[System.IO.File]::WriteAllBytes($zip, [Convert]::FromBase64String($b64))
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $temp)
Remove-Item -LiteralPath $zip -Force
$root = (Get-ChildItem -LiteralPath $temp -Directory | Select-Object -First 1).FullName
$installer = Join-Path $root 'homelab-panel\\desktop\\install.ps1'
if (-not (Test-Path -LiteralPath $installer)) { throw 'Installer missing inside payload.' }
Write-Output ('Ready: ' + $root)
& powershell -NoProfile -Sta -ExecutionPolicy Bypass -File $installer
`.trim();

const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

// ۳) خودِ فایلِ bat
const head = `@echo off
REM ===========================================================================
REM   Home Server App - Setup ${version}
REM   Just double-click this file. Everything is inside it.
REM ===========================================================================
title Home Server Setup ${version}
setlocal
set "PUMP_SETUP_SELF=%~f0"

echo.
echo    ============================================================
echo      Home Server App  -  Setup ${version}
echo    ============================================================
echo.
echo      Preparing files, please wait...
echo      The setup window will open by itself.
echo.

where powershell >nul 2>nul
if errorlevel 1 (
  echo      PowerShell was not found. This program runs on Windows only.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}

if errorlevel 1 (
  echo.
  echo      ------------------------------------------------------------
  echo      Setup did not finish. Please send a screenshot of this window.
  echo      ------------------------------------------------------------
  echo.
  pause
  exit /b 1
)

exit /b 0

${MARK}
${payload}
`;

const outPath = path.join(ROOT, 'dist', `نصب-برنامه.bat`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
// bat باید بدونِ BOM و با خطوطِ ویندوزی باشد، وگرنه cmd خطِ اولش را نمی‌فهمد
fs.writeFileSync(outPath, head.replace(/\r?\n/g, '\r\n'), 'ascii');
fs.rmSync(tmp, { recursive: true, force: true });

const size = fs.statSync(outPath).size;
console.log(`ساخته شد: ${outPath}`);
console.log(`نسخه: ${version} — حجم: ${(size / 1024 / 1024).toFixed(2)} مگابایت`);
