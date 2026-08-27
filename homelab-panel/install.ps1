# ---------------------------------------------------------------------------
#  نصبِ مرکز فرمان روی ویندوز
#
#  این فایل را مستقیم اجرا نکنید — روی install-windows.bat دوبار کلیک کنید.
#
#  کاری که می‌کند:
#    ۱) Node.js را می‌سنجد و اگر نبود، خودش نصبش می‌کند
#    ۲) اگر برنامه را ندارید، از GitHub می‌گیردش
#    ۳) وابستگی‌ها را نصب می‌کند و .env را می‌سازد
#    ۴) سلامتِ نصب را بررسی می‌کند
#    ۵) پنل را بالا می‌آورد و مرورگر را باز می‌کند
#
#  اجرای دوباره چیزی را خراب نمی‌کند.
# ---------------------------------------------------------------------------
param(
  [string]$Repo   = "vil3ntec-it/server",
  [string]$Branch = "",
  [string]$Target = ""
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Head($text) {
  Write-Host ""
  Write-Host "==============================================================" -ForegroundColor DarkGray
  Write-Host "   $text" -ForegroundColor Cyan
  Write-Host "==============================================================" -ForegroundColor DarkGray
  Write-Host ""
}
function Step($n, $text) { Write-Host "[$n/5] $text" -ForegroundColor White }
function OK($text)   { Write-Host "      [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "      [!]  $text" -ForegroundColor Yellow }
function Bad($text)  { Write-Host ""; Write-Host "  [X] $text" -ForegroundColor Red }

function Fail($text) {
  Bad $text
  Write-Host ""
  Write-Host "  اگر نفهمیدید مشکل چیست، همین متن را برای من بفرستید." -ForegroundColor DarkGray
  Write-Host ""
  Read-Host "  برای بستن، Enter بزنید"
  exit 1
}

Head "نصب مرکز فرمان و پنل سرور خانگی"

# ─────────────────────────── ۱) Node.js ───────────────────────────────────
Step 1 "بررسی Node.js ..."

function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  try { return [int]((& node -p "process.versions.node").Split(".")[0]) } catch { return 0 }
}

$major = Get-NodeMajor

if ($major -lt 22) {
  if ($major -eq 0) { Warn "Node.js نصب نیست." } else { Warn "Node.js نسخهٔ $major دارید؛ نسخهٔ ۲۲ یا بالاتر لازم است." }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "      خودم نصبش می‌کنم (با winget) ..." -ForegroundColor DarkGray
    & winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements | Out-Null

    # winget مسیر را در همین پنجره تازه نمی‌کند
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
    $major = Get-NodeMajor
  }

  if ($major -lt 22) {
    Bad "Node.js خودکار نصب نشد."
    Write-Host ""
    Write-Host "      صفحهٔ دانلود را برایتان باز می‌کنم." -ForegroundColor DarkGray
    Write-Host "      نسخهٔ LTS را نصب کنید، بعد همین فایل را دوباره اجرا کنید." -ForegroundColor DarkGray
    Start-Process "https://nodejs.org/fa/download"
    Write-Host ""
    Read-Host "  برای بستن، Enter بزنید"
    exit 1
  }
}
OK "Node.js نسخهٔ $major"

# ─────────────────── ۲) پیدا کردن یا گرفتنِ برنامه ─────────────────────────
Write-Host ""
Step 2 "پیدا کردن برنامه ..."

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-PanelRoot($path) {
  return (Test-Path (Join-Path $path "server\package.json")) -and (Test-Path (Join-Path $path "server\src\index.js"))
}

$panel = $null

# الف) کنارِ همین فایل
if (Test-PanelRoot $here) { $panel = $here }
# ب) یک پله پایین‌تر (اگر فایل کنارِ ریشهٔ مخزن باشد)
elseif (Test-PanelRoot (Join-Path $here "homelab-panel")) { $panel = Join-Path $here "homelab-panel" }
# ج) نصبِ قبلی
elseif ($Target -and (Test-PanelRoot (Join-Path $Target "homelab-panel"))) { $panel = Join-Path $Target "homelab-panel" }

if ($panel) {
  OK "برنامه پیدا شد: $panel"
} else {
  if (-not $Target) { $Target = Join-Path $env:LOCALAPPDATA "ControlCenter" }
  if (Test-PanelRoot (Join-Path $Target "homelab-panel")) {
    $panel = Join-Path $Target "homelab-panel"
    OK "نصبِ قبلی پیدا شد: $panel"
  } else {
    Write-Host "      برنامه این‌جا نیست — از GitHub می‌گیرمش." -ForegroundColor DarkGray
    Write-Host "      مخزن: $Repo" -ForegroundColor DarkGray

    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    $zip = Join-Path $env:TEMP "control-center-$(Get-Random).zip"
    $branches = if ($Branch) { @($Branch) } else { @("main", "master") }

    $got = $false
    foreach ($b in $branches) {
      $url = "https://codeload.github.com/$Repo/zip/refs/heads/$b"
      try {
        Write-Host "      دانلود از شاخهٔ $b ..." -ForegroundColor DarkGray
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
        $got = $true
        break
      } catch {
        Write-Host "      شاخهٔ $b نبود." -ForegroundColor DarkGray
      }
    }
    if (-not $got) { Fail "دانلود از GitHub نشد. اینترنت را بررسی کنید، یا نام مخزن/شاخه را با -Repo و -Branch بدهید." }

    $stage = Join-Path $env:TEMP "control-center-stage-$(Get-Random)"
    Expand-Archive -Path $zip -DestinationPath $stage -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue

    # GitHub همه‌چیز را داخل یک پوشهٔ سرشاخه می‌گذارد
    $top = Get-ChildItem -Path $stage -Directory | Select-Object -First 1
    if (-not $top) { Fail "بستهٔ دانلودشده خالی بود." }

    foreach ($item in Get-ChildItem -Path $top.FullName) {
      Copy-Item -Path $item.FullName -Destination $Target -Recurse -Force
    }
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

    if (-not (Test-PanelRoot (Join-Path $Target "homelab-panel"))) { Fail "بسته باز شد ولی فایل‌های پنل داخلش نبود." }
    $panel = Join-Path $Target "homelab-panel"
    OK "نصب شد در: $Target"
  }
}

$server = Join-Path $panel "server"
Set-Location $server

# ────────────────────────── ۳) وابستگی‌ها ─────────────────────────────────
Write-Host ""
Step 3 "نصب وابستگی‌ها ..."

if (Test-Path (Join-Path $server "node_modules\express")) {
  OK "از قبل نصب است"
} else {
  Write-Host "      (فقط بار اول، به اینترنت نیاز دارد)" -ForegroundColor DarkGray
  & npm.cmd install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "نصب وابستگی‌ها ناموفق بود. اینترنت را بررسی کنید." }
  OK "نصب شد"
}

$envFile = Join-Path $server ".env"
if (Test-Path $envFile) {
  OK ".env از قبل هست — دست نخورد"
} else {
  Copy-Item (Join-Path $server ".env.example") $envFile
  OK ".env ساخته شد"
}

# ───────────────────────── ۴) بررسی سلامت ─────────────────────────────────
Write-Host ""
Step 4 "بررسی سلامت نصب ..."
& node --disable-warning=ExperimentalWarning (Join-Path $server "scripts\doctor.mjs")
if ($LASTEXITCODE -ne 0) { Fail "بررسی سلامت مشکل پیدا کرد. پیام بالا را بخوانید." }

# ──────────────────────────── ۵) اجرا ─────────────────────────────────────
Write-Host ""
Step 5 "راه‌اندازی پنل ..."

$port = 4700
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^\s*HLP_PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}
$url = "http://localhost:$port"

Head "پنل در حال بالا آمدن است"
Write-Host "   آدرس:  $url" -ForegroundColor Green
Write-Host ""
Write-Host "   بار اول یک نام کاربری و رمز مدیر می‌سازید." -ForegroundColor DarkGray
Write-Host "   دفعه‌های بعد: server\start-windows.bat" -ForegroundColor DarkGray
Write-Host "   برای بستن: این پنجره را ببندید یا Ctrl+C بزنید." -ForegroundColor DarkGray
Write-Host ""

# مرورگر را چند ثانیه بعد باز کن تا سرور رسیده باشد
Start-Job -ScriptBlock { Start-Sleep -Seconds 4; Start-Process $using:url } | Out-Null

& node --disable-warning=ExperimentalWarning (Join-Path $server "src\index.js")

Write-Host ""
Write-Host "پنل بسته شد." -ForegroundColor DarkGray
Read-Host "برای بستن این پنجره، Enter بزنید"
