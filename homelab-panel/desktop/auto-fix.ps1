# ---------------------------------------------------------------------------
#  «تعمیرِ خودکار» — پوستهٔ ویندوزیِ auto-fix.mjs
#
#  هیچ پرسشی ندارد: نه نشانیِ پنل، نه نامِ کاربری، نه رمز، نه آدرسِ مقصد. همه را
#  از روی خودِ نصب پیدا می‌کند. کارش سه بخش است:
#
#     ۱) auto-fix.mjs را با Nodeِ خودِ سرور اجرا می‌کند (تشخیص و تعمیر)
#     ۲) سرور را خاموش و دوباره روشن می‌کند تا تنظیماتِ تازه سوار شود
#     ۳) خودش آدرس را از اینترنت صدا می‌زند و می‌بیند بالا آمده یا نه
#
#  در آخر یک گزارشِ فارسی روی دسکتاپ می‌سازد و در مرورگر باز می‌کند — چون
#  پنجرهٔ cmd فارسی را درست نشان نمی‌دهد و متنِ انگلیسی هم به کارِ کسی نمی‌آید.
#
#  این فایل خواندنی است؛ همین کد داخلِ «تعمیر-خودکار.bat» هم هست. اگر این‌جا را
#  عوض کردید، دوباره بسازیدش:
#
#      node homelab-panel/desktop/build-auto-fix.mjs
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Continue'
$EmbeddedBrain = ''   # BUILD: اینجا با متنِ auto-fix.mjs پر می‌شود

Write-Host ''
Write-Host '  =========================================================='
Write-Host '    Automatic repair - server address'
Write-Host '  =========================================================='
Write-Host ''
Write-Host '  Nothing to type. This finds the problem and fixes it.'
Write-Host ''

# ------------------------------ پیدا کردنِ نصب ------------------------------
#  ⚠️ چرا [IO.Path]::Combine و نه Join-Path:
#  Join-Path از راهِ درایوهای PowerShell می‌رود و اگر درایوی مثلِ «F:» روی این
#  کامپیوتر نباشد، خطای «A drive with the name F does not exist» می‌دهد و
#  چون خطای خاتمه‌دهنده است، کلِ جست‌وجو همان‌جا می‌ایستد. Combine فقط رشته را
#  می‌چسباند و هیچ‌وقت خطا نمی‌دهد.
#  یک پوشه وقتی «پوشهٔ سرور» است که یا کدش آن‌جا باشد یا دیتابیسش — نصبِ
#  دستی و نصبِ از zip هر دو دیده شده‌اند و شکلشان یکی نیست.
function Test-ServerDir {
  param([string]$Dir)
  try {
    if (-not $Dir) { return $false }
    if (Test-Path -LiteralPath ([IO.Path]::Combine($Dir, 'src\index.js'))) { return $true }
    return (Test-Path -LiteralPath ([IO.Path]::Combine($Dir, 'data\panel.db')))
  } catch { return $false }
}

function Find-ServerDir {
  $tries = @()
  foreach ($root in @($env:USERPROFILE, "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents",
                      'C:\', 'D:\', 'E:\', 'F:\')) {
    if (-not $root) { continue }
    $tries += [IO.Path]::Combine($root, 'PumpServer\homelab-panel\server')
    $tries += [IO.Path]::Combine($root, 'homelab-panel\server')
  }
  if ($PSScriptRoot) { $tries += [IO.Path]::Combine((Split-Path -Parent $PSScriptRoot), 'server') }

  # پوشه‌ای که خودِ این فایل در آن است — اگر کاربر آن را کنارِ نصب گذاشته باشد
  $here = $env:AUTOFIX_HERE
  if ($here) {
    $here = $here.TrimEnd('\')
    $tries += [IO.Path]::Combine($here, 'homelab-panel\server')
    $tries += [IO.Path]::Combine($here, 'PumpServer\homelab-panel\server')
    $tries += [IO.Path]::Combine($here, 'server')
    $tries += [IO.Path]::Combine((Split-Path -Parent $here), 'server')
  }
  foreach ($dir in $tries) { if (Test-ServerDir $dir) { return $dir } }

  # ── ۲) میان‌برِ خودِ برنامه ────────────────────────────────────────────────
  #  نصب‌کننده می‌تواند هرجایی نصب کند («D:\New folder (2)\...» هم دیده شده)،
  #  پس حدس زدنِ مسیر جواب نمی‌دهد. ولی میان‌برِ دسکتاپ پوشهٔ کاری‌اش را دارد و
  #  آن دقیقاً همان جایی است که برنامه نصب شده.
  try {
    $ws = New-Object -ComObject WScript.Shell
    foreach ($folder in @([Environment]::GetFolderPath('Desktop'),
                          [Environment]::GetFolderPath('Programs'),
                          [Environment]::GetFolderPath('CommonPrograms'))) {
      if (-not $folder) { continue }
      foreach ($lnk in (Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue)) {
        $work = ''
        try { $work = [string]$ws.CreateShortcut($lnk.FullName).WorkingDirectory } catch { continue }
        if (-not $work) { continue }
        # پوشهٔ کاریِ میان‌بر ...\homelab-panel\desktop است
        $guess = [IO.Path]::Combine((Split-Path -Parent $work), 'server')
        if (Test-ServerDir $guess) { return $guess }
      }
    }
  } catch { }

  # ── ۳) گشتنِ درایوها ─────────────────────────────────────────────────────
  #
  #  ⚠️ اولین نسخه دنبالِ پوشه‌ای به نامِ «homelab-panel» می‌گشت و روی کامپیوترِ
  #  واقعی هیچ‌چیز پیدا نکرد. اسمِ پوشه قابلِ اتکا نیست: نصب دستی، از zip، با
  #  نامِ عوض‌شده، یا چند لایه عمیق‌تر از آن‌که گشته می‌شد.
  #
  #  چیزی که همیشه هست و اسمش هیچ‌وقت عوض نمی‌شود، خودِ دیتابیسِ پنل است:
  #  panel.db. پس دنبالِ همان می‌گردیم و از رویش به پوشهٔ سرور می‌رسیم:
  #      ...\server\data\panel.db   ⇒   ...\server
  Write-Host '  Searching the drives (this can take a minute) ...'
  $script:Seen = @()
  foreach ($drive in [IO.DriveInfo]::GetDrives()) {
    try {
      if (-not $drive.IsReady) { continue }
      if ($drive.DriveType -ne 'Fixed' -and $drive.DriveType -ne 'Removable') { continue }
      $root = $drive.RootDirectory.FullName
      Write-Host "      looking in $root"
      foreach ($hit in (Get-ChildItem -LiteralPath $root -Filter 'panel.db' -File -Recurse -Depth 7 `
                        -Force -ErrorAction SilentlyContinue)) {
        # panel.db داخلِ پوشهٔ data است و پوشهٔ بالاترش همان server
        $guess = Split-Path -Parent (Split-Path -Parent $hit.FullName)
        $script:Seen += $hit.FullName
        if (Test-ServerDir $guess) { return $guess }
      }
    } catch { }
  }

  # ── ۴) اگر باز هم نشد، بگو چه دیدی ───────────────────────────────────────
  #  خالی برگشتن بدونِ توضیح یعنی یک رفت‌وبرگشتِ دیگر. این‌جا هرچه پیدا شده و
  #  فهرستِ پوشه‌های سرِ هر درایو چاپ می‌شود تا از روی همین صفحه معلوم شود
  #  برنامه کجاست.
  Write-Host ''
  if ($script:Seen.Count) {
    Write-Host '  Found these panel.db files, but none had server\src\index.js next to them:'
    foreach ($f in $script:Seen) { Write-Host "      $f" }
  } else {
    Write-Host '  No panel.db anywhere. Top-level folders on each drive:'
    foreach ($drive in [IO.DriveInfo]::GetDrives()) {
      try {
        if (-not $drive.IsReady) { continue }
        if ($drive.DriveType -ne 'Fixed' -and $drive.DriveType -ne 'Removable') { continue }
        $root = $drive.RootDirectory.FullName
        $names = (Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue |
                  Select-Object -First 30 -ExpandProperty Name) -join ', '
        Write-Host "      $root  ->  $names"
      } catch { }
    }
  }
  Write-Host ''
  return ''
}

function Find-NodeExe {
  param([string]$ServerDir)
  # اول Nodeی که کنارِ خودِ سرور نصب شده، بعد Nodeی سیستم
  foreach ($guess in @(
      [IO.Path]::Combine($ServerDir, 'nodejs\node.exe'),
      [IO.Path]::Combine((Split-Path -Parent (Split-Path -Parent $ServerDir)), 'nodejs\node.exe'))) {
    try { if ($guess -and (Test-Path -LiteralPath $guess)) { return $guess } } catch { }
  }
  try {
    $cmd = Get-Command 'node' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  } catch { }
  foreach ($name in @('ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)', 'LOCALAPPDATA')) {
    $root = [Environment]::GetEnvironmentVariable($name)
    if (-not $root) { continue }
    $guess = [IO.Path]::Combine($root, 'nodejs\node.exe')
    if (Test-Path -LiteralPath $guess) { return $guess }
  }
  return ''
}

$server = Find-ServerDir
if (-not $server) {
  Write-Host '  Could not find the installed panel on this computer.'
  Write-Host '  Looked in: the usual folders, the desktop shortcut, and every drive.'
  Write-Host '  If the panel is on another drive, put this file next to it and run it there.'
  Write-Host ''
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}
Write-Host "  Found: $server"

$node = Find-NodeExe -ServerDir $server
if (-not $node) {
  Write-Host '  Node.js was not found on this computer.'
  Write-Host '  Install it from https://nodejs.org and run this again.'
  Write-Host ''
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}

# --------------------------- مغزِ کار: auto-fix.mjs -------------------------
$brain = ''
if ($PSScriptRoot) {
  $beside = [IO.Path]::Combine($PSScriptRoot, 'auto-fix.mjs')
  if (Test-Path -LiteralPath $beside) { $brain = [IO.File]::ReadAllText($beside) }
}
if (-not $brain) { $brain = $EmbeddedBrain }
if (-not $brain) {
  Write-Host '  The repair script is missing from this file.'
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}

$work = [IO.Path]::Combine($env:TEMP, 'panel-auto-fix.mjs')
# ⚠️ بدونِ BOM — Node فایلِ ماژول را با BOM هم می‌خواند ولی برخی نسخه‌ها نه
[IO.File]::WriteAllText($work, $brain, (New-Object Text.UTF8Encoding($false)))

Write-Host ''
Write-Host '  [1/3] Looking for the problem ...'
function Invoke-Brain {
  param([string[]]$NodeArgs)
  $text = & $node @NodeArgs 2>&1 | Out-String
  $found = ($text -split "`n" | Where-Object { $_ -match '##RESULT##' } | Select-Object -Last 1)
  if ($found) {
    try { return @{ raw = $text; data = (($found -replace '^.*##RESULT##', '').Trim() | ConvertFrom-Json) } } catch { }
  }
  return @{ raw = $text; data = $null }
}

# ⚠️ --disable-warning فقط از Node 21 به بعد هست. اگر Nodeی قدیمی‌تری روی این
#    کامپیوتر جلوتر پیدا شده باشد، همان پرچم کلِ اجرا را می‌خواباند و کاربر
#    فقط یک صفحهٔ خالی می‌بیند. پس یک بار هم بدونِ پرچم امتحان می‌شود.
$run = Invoke-Brain @('--disable-warning=ExperimentalWarning', $work, '--server', $server)
if (-not $run.data) { $run = Invoke-Brain @($work, '--server', $server) }
$raw = $run.raw
$result = $run.data
if (-not $result) {
  Write-Host '  The check did not finish. Raw output:'
  Write-Host $raw
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}

foreach ($s in $result.steps)    { Write-Host "      fixed:   $s" }
foreach ($b in $result.blockers) { Write-Host "      blocked: $b" }

# ------------------------- خاموش و روشن کردنِ سرور --------------------------
Write-Host '  [2/3] Restarting the server ...'
$dataDir = [IO.Path]::Combine($server, 'data')
$pidFile = [IO.Path]::Combine($dataDir, 'panel.pid')
if (Test-Path -LiteralPath $pidFile) {
  try {
    $panelPid = ([IO.File]::ReadAllText($pidFile)).Trim()
    if ($panelPid -match '^\d+$') { Stop-Process -Id ([int]$panelPid) -Force -ErrorAction SilentlyContinue }
  } catch { }
}
Start-Sleep -Seconds 2
$quiet = [IO.Path]::Combine($server, 'run-quiet.bat')
try {
  if (Test-Path -LiteralPath $quiet) {
    Start-Process -FilePath $quiet -WorkingDirectory $server -WindowStyle Hidden | Out-Null
  } else {
    Start-Process -FilePath $node -ArgumentList @('--disable-warning=ExperimentalWarning', 'src\index.js') `
      -WorkingDirectory $server -WindowStyle Hidden | Out-Null
  }
} catch {
  Write-Host "      could not start the server: $($_.Exception.Message)"
  Write-Host '      open the panel from its desktop shortcut instead.'
}

# ------------------------------ بررسیِ نهایی -------------------------------
#  ⚠️ تونل چند ده ثانیه طول می‌کشد تا به Cloudflare وصل شود. یک بار امتحان
#  کردن همیشه «هنوز نه» می‌دهد و کاربر فکر می‌کند درست نشده.
Write-Host '  [3/3] Checking the address from the internet (up to 3 minutes) ...'
$host_ = [string]$result.hostname
$liveOk = $false
$liveMsg = ''
if ($host_) {
  # ⚠️ هر تلاشِ ناموفق هم صبر دارد هم مهلتِ اتصال. با ۲۴ تلاش و مهلتِ ۸ ثانیه،
  #    بدترین حالت پنج دقیقه می‌شد — یعنی کاربر فکر می‌کرد فایل قفل کرده.
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 4
    try {
      $ping = Invoke-WebRequest -Uri "https://$host_/health" -TimeoutSec 6 -UseBasicParsing
      if ($ping.StatusCode -eq 200) { $liveOk = $true; break }
      $liveMsg = "HTTP $($ping.StatusCode)"
    } catch {
      $liveMsg = $_.Exception.Message
    }
    Write-Host '      still waiting ...'
  }
}

# ------------------------------ گزارشِ فارسی -------------------------------
function Esc($t) { [Net.WebUtility]::HtmlEncode([string]$t) }

$rows = ''
foreach ($s in $result.steps)    { $rows += "<li class='fix'>$(Esc $s)</li>" }
foreach ($b in $result.blockers) { $rows += "<li class='stop'>$(Esc $b)</li>" }
foreach ($n in $result.notes)    { $rows += "<li class='note'>$(Esc $n)</li>" }
if (-not $rows) { $rows = "<li class='note'>چیزی برای تعمیر پیدا نشد.</li>" }

# حرفِ خودِ cloudflared — همان چیزی که تا امروز هیچ‌جا دیده نمی‌شد
$cfLog = ''
if ($result.probe -and $result.probe.lines -and $result.probe.lines.Count) {
  $rowsLog = ''
  foreach ($l in $result.probe.lines) { $rowsLog += "$(Esc $l)`n" }
  $cfLog = "<p class='dim'>حرفِ خودِ cloudflared:</p><pre class='log'>$rowsLog</pre>"
}

$verdict = if ($liveOk) { 'آدرس بالا آمد ✅' }
           elseif ($result.blockers.Count) { 'یک کارِ دستی مانده ⛔' }
           else { 'تعمیر انجام شد، ولی آدرس هنوز جواب نداد ⏳' }
$verdictClass = if ($liveOk) { 'ok' } elseif ($result.blockers.Count) { 'bad' } else { 'wait' }

$tail = if ($liveOk) {
  "<p>سرور آماده است. در برنامهٔ اندروید همین نشانی را بگذارید:</p><p class='addr'>https://$(Esc $host_)</p>"
} elseif ($result.blockers.Count) {
  "<p>هرچه بالا با ⛔ نشان داده شده، از این فایل برنمی‌آید و باید یک بار در خودِ پنل انجام شود.</p>"
} else {
  "<p>تنظیمات درست شد ولی Cloudflare هنوز جواب نمی‌دهد. پنج دقیقه صبر کنید و این نشانی را باز کنید:</p>" +
  "<p class='addr'>https://$(Esc $host_)/health</p><p>اگر باز هم نشد، همین صفحه را برای مهندس بفرستید.</p>" +
  "<p class='dim'>آخرین پاسخ: $(Esc $liveMsg)</p>"
}

$html = @"
<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8">
<title>گزارشِ تعمیرِ خودکار</title>
<style>
 body{font-family:Tahoma,'Segoe UI',sans-serif;background:#F2F5FA;color:#101A2B;margin:0;padding:32px}
 .card{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 32px;
       box-shadow:0 8px 28px rgba(16,26,43,.08)}
 h1{font-size:20px;margin:0 0 4px}
 .verdict{font-size:17px;font-weight:bold;padding:14px 16px;border-radius:12px;margin:18px 0}
 .ok{background:#E8F6EE;color:#0B6B3A} .bad{background:#FDECEC;color:#A81E1E}
 .wait{background:#FFF6E5;color:#8A5A00}
 ul{list-style:none;padding:0;margin:0} li{padding:10px 14px;border-radius:10px;margin-bottom:8px;font-size:14px}
 .fix{background:#EAF2FF;border-right:4px solid #0F62B4}
 .stop{background:#FDECEC;border-right:4px solid #C62828}
 .note{background:#F5F7FA;border-right:4px solid #C9D2E0;color:#4A5568}
 .addr{font-family:Consolas,monospace;direction:ltr;text-align:left;background:#101A2B;color:#8FD3FF;
       padding:12px 14px;border-radius:10px;font-size:15px}
 .dim{color:#7A8699;font-size:12px}
 .log{direction:ltr;text-align:left;background:#101A2B;color:#C8D6E5;padding:12px 14px;
      border-radius:10px;font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap;
      word-break:break-all;overflow-x:auto}
 .meta{color:#7A8699;font-size:12px;margin-top:22px;border-top:1px solid #E4E9F2;padding-top:14px}
</style>
<div class="card">
  <h1>گزارشِ تعمیرِ خودکار</h1>
  <div class="dim">$(Get-Date -Format 'yyyy-MM-dd HH:mm')</div>
  <div class="verdict $verdictClass">$verdict</div>
  <ul>$rows</ul>
  $tail
  $cfLog
  <div class="meta">پوشهٔ سرور: $(Esc $result.server)<br>تونل: $(Esc $result.tunnelId)<br>پورت: $(Esc $result.port)</div>
</div></html>
"@

# ⚠️ اگر مسیرِ دسکتاپ خالی برگردد (پروفایلِ غیرعادی)، Combine رشتهٔ بی‌ریشه
#    می‌سازد و نوشتن می‌خورد و کاربر هیچ گزارشی نمی‌بیند. پس پوشهٔ موقت هم هست.
$desk = [Environment]::GetFolderPath('Desktop')
if (-not $desk) { $desk = $env:TEMP }
$report = [IO.Path]::Combine($desk, 'گزارش-تعمیر.html')
try {
  [IO.File]::WriteAllText($report, $html, (New-Object Text.UTF8Encoding($false)))
} catch {
  $report = ''
}
# ⚠️ باز نشدنِ مرورگر نباید گزارش را «نبود» جلوه دهد — فایل نوشته شده و مسیرش
#    باید گفته شود، وگرنه کاربر فکر می‌کند هیچ گزارشی ساخته نشده.
if ($report) { try { Start-Process $report | Out-Null } catch { } }

Write-Host ''
Write-Host '  =========================================================='
if ($liveOk) {
  Write-Host '    DONE - the address is answering.'
  Write-Host "    https://$host_"
} elseif ($result.blockers.Count) {
  Write-Host '    One step is left that must be done in the panel.'
} else {
  Write-Host '    Repaired. The address may need a few more minutes.'
}
if ($report) {
  Write-Host '    A Persian report was saved here (open it to read the details):'
  Write-Host "    $report"
}
Write-Host '  =========================================================='
Write-Host ''
Read-Host '  Press Enter to close' | Out-Null
