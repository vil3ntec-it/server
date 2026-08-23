# ---------------------------------------------------------------------------
#  مغزِ «برنامهٔ سرور خانگی» — بدونِ هیچ پنجره‌ای
#
#  هر کاری که برنامه انجام می‌دهد این‌جاست: خواندن و نوشتنِ .env، روشن و خاموش
#  کردنِ سرور، صدا زدنِ API، و به‌روزرسانی از GitHub. خودِ پنجره در app.ps1 است.
#
#  چرا جدا؟ تا بشود همین‌ها را بدونِ باز کردنِ پنجره آزمود (test\lib.tests.ps1).
# ---------------------------------------------------------------------------

# روی ویندوزهای قدیمی‌تر، اتصالِ https بدونِ این خط کار نمی‌کند
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch { }

$script:Repo = 'vil3ntec-it/server'

# شاخه‌ای که تغییرها روی آن می‌نشیند. هر وقت در main ادغام شد، در تبِ
# «به‌روزرسانی» بنویسید main — همان‌جا یادش می‌ماند.
$script:DefaultBranch = 'claude/server-connection-auth-sfxbex'

# ---------------------------------------------------------------------------
#  مسیرها
# ---------------------------------------------------------------------------

function Get-DesktopDir {
  return (Split-Path -Parent $PSCommandPath)
}

function Get-ServerDir {
  param([string]$From = '')
  if (-not $From) { $From = Get-DesktopDir }
  return (Join-Path (Split-Path -Parent $From) 'server')
}

function Get-ProjectRoot {
  param([string]$From = '')
  if (-not $From) { $From = Get-DesktopDir }
  # desktop → homelab-panel → ریشهٔ پروژه
  return (Split-Path -Parent (Split-Path -Parent $From))
}

<#
  .SYNOPSIS
  پوشهٔ دادهٔ سرور. معمولاً server\data است، مگر خودتان در .env جای دیگری
  گذاشته باشید (HLP_DATA_DIR) — آن‌وقت همان‌جا را می‌گیریم.
#>
function Get-DataDir {
  param([Parameter(Mandatory = $true)][string]$ServerDir)

  $fallback = Join-Path $ServerDir 'data'
  try {
    $values = Read-EnvFile -Path (Join-Path $ServerDir '.env')
    if ($values.ContainsKey('HLP_DATA_DIR') -and $values['HLP_DATA_DIR']) {
      $custom = [string]$values['HLP_DATA_DIR']
      if ([System.IO.Path]::IsPathRooted($custom)) { return $custom }
      return [System.IO.Path]::GetFullPath((Join-Path $ServerDir $custom))
    }
  } catch { }
  return $fallback
}

# ---------------------------------------------------------------------------
#  فایل .env — تنظیماتِ پیامک و ایمیل همین‌جا می‌نشیند
# ---------------------------------------------------------------------------

<#
  .SYNOPSIS
  همهٔ کلیدهای .env را به‌صورت یک جدول برمی‌گرداند (خط‌های کامنت نادیده).
#>
function Read-EnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $result = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $result }

  foreach ($raw in [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if ($value.Length -ge 2) {
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
          ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    $result[$key] = $value
  }
  return $result
}

<#
  .SYNOPSIS
  چند کلید را در .env می‌نویسد؛ بقیهٔ خط‌ها و کامنت‌ها دست نمی‌خورند.
  مقدارِ خالی یعنی «این کلید را بردار».
#>
function Set-EnvValues {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][hashtable]$Values
  )

  $lines = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $Path) {
    foreach ($line in [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)) {
      $lines.Add($line) | Out-Null
    }
  } else {
    $lines.Add('# تنظیماتِ سرور — این فایل را برنامهٔ سرور می‌نویسد و می‌خواند.') | Out-Null
    $lines.Add('') | Out-Null
  }

  foreach ($key in @($Values.Keys)) {
    $value = [string]$Values[$key]
    $found = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
      $trimmed = $lines[$i].Trim()
      if ($trimmed.StartsWith('#')) { continue }
      $eq = $trimmed.IndexOf('=')
      if ($eq -lt 1) { continue }
      if ($trimmed.Substring(0, $eq).Trim() -ne $key) { continue }

      $found = $true
      if ($value -eq '') { $lines[$i] = "# $key=" }
      else { $lines[$i] = "$key=$value" }
      break
    }

    if (-not $found -and $value -ne '') {
      $lines.Add("$key=$value") | Out-Null
    }
  }

  # ⚠️ بدونِ BOM: اگر BOM بگذاریم، اولین کلیدِ فایل برای سرور ناخوانا می‌شود
  $encoding = New-Object System.Text.UTF8Encoding($false)
  $text = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
  [System.IO.File]::WriteAllText($Path, $text, $encoding)
  return $Path
}

# ---------------------------------------------------------------------------
#  گفت‌وگو با سرور
# ---------------------------------------------------------------------------

<#
  .SYNOPSIS
  یک درخواستِ HTTP با پاسخِ JSON. متنِ فارسی را درست می‌خواند (UTF-8).
  همیشه یک جدول برمی‌گرداند: ok / status / data / error — هیچ‌وقت خطا پرت نمی‌کند.
#>
function Invoke-Json {
  param(
    [string]$Url,
    [string]$Method = 'GET',
    $Body = $null,
    [int]$TimeoutSec = 15
  )

  $params = @{
    Uri             = $Url
    Method          = $Method
    TimeoutSec      = $TimeoutSec
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $json = ($Body | ConvertTo-Json -Depth 6 -Compress)
    $params['Body'] = [System.Text.Encoding]::UTF8.GetBytes($json)
    $params['ContentType'] = 'application/json; charset=utf-8'
  }

  try {
    $response = Invoke-WebRequest @params
    $text = [System.Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
    $data = $null
    if ($text) { try { $data = $text | ConvertFrom-Json } catch { } }
    return @{ ok = $true; status = [int]$response.StatusCode; data = $data; error = $null }
  } catch {
    $status = 0
    $data = $null
    $text = $null
    $webResponse = $null
    try { $webResponse = $_.Exception.Response } catch { }
    if ($webResponse) {
      try { $status = [int]$webResponse.StatusCode } catch { }
      # ویندوز پاورشلِ ۵.۱: بدنهٔ خطا را از خودِ استریم می‌خوانیم (تا فارسی سالم بماند)
      try {
        if ($webResponse | Get-Member -Name 'GetResponseStream' -MemberType Method -ErrorAction SilentlyContinue) {
          $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream(), [System.Text.Encoding]::UTF8)
          $text = $reader.ReadToEnd()
          $reader.Close()
        }
      } catch { }
    }
    # پاورشل ۷: بدنهٔ خطا این‌جاست
    if (-not $text) {
      try { $text = $_.ErrorDetails.Message } catch { }
    }
    if ($text) { try { $data = $text | ConvertFrom-Json } catch { } }
    return @{ ok = $false; status = $status; data = $data; error = $_.Exception.Message }
  }
}

<#
  .SYNOPSIS
  سرور بالاست؟ اگر بله، شناسنامه‌اش را می‌دهد؛ اگر نه، $null.
#>
function Get-ServerHealth {
  param([int]$Port = 4700)
  $result = Invoke-Json -Url "http://127.0.0.1:$Port/health" -TimeoutSec 3
  if ($result.ok -and $result.data) { return $result.data }
  return $null
}

function Get-AppConfig {
  param([int]$Port = 4700)
  $result = Invoke-Json -Url "http://127.0.0.1:$Port/api/app/config" -TimeoutSec 5
  if ($result.ok -and $result.data) { return $result.data }
  return $null
}

<#
  .SYNOPSIS
  آدرس‌های شبکهٔ خانگیِ همین کامپیوتر (۱۹۲.۱۶۸.…)
#>
function Get-LanAddresses {
  $found = New-Object System.Collections.Generic.List[string]
  try {
    foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($nic.OperationalStatus -ne 'Up') { continue }
      if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }
      foreach ($ip in $nic.GetIPProperties().UnicastAddresses) {
        if ($ip.Address.AddressFamily -ne 'InterNetwork') { continue }
        $text = $ip.Address.ToString()
        if ($text.StartsWith('169.254.')) { continue }
        if (-not $found.Contains($text)) { $found.Add($text) | Out-Null }
      }
    }
  } catch { }
  return $found.ToArray()
}

# ---------------------------------------------------------------------------
#  روشن و خاموش کردنِ سرور
# ---------------------------------------------------------------------------

function Get-PanelPid {
  param([string]$ServerDir)
  $pidFile = Join-Path (Get-DataDir -ServerDir $ServerDir) 'panel.pid'
  if (-not (Test-Path -LiteralPath $pidFile)) { return 0 }
  try {
    $value = ([System.IO.File]::ReadAllText($pidFile)).Trim()
    if ($value -match '^\d+$') { return [int]$value }
  } catch { }
  return 0
}

<#
  .SYNOPSIS
  سرور را بی‌هیچ پنجره‌ای روشن می‌کند.
  هیچ ترمینالی باز نمی‌شود؛ همهٔ خروجی در data\panel.log می‌نشیند و برنامه
  همان را زنده در تبِ «ترمینالِ سرور» نشان می‌دهد.
#>
function Start-PanelServer {
  param([string]$ServerDir)

  $dataDir = Get-DataDir -ServerDir $ServerDir
  if (-not (Test-Path -LiteralPath $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  }
  Write-PanelLogMark -ServerDir $ServerDir -Message 'روشن کردنِ سرور'

  # run-quiet.bat خودش خروجی را به فایل می‌فرستد و اگر node_modules نبود نصبش می‌کند
  $quiet = Join-Path $ServerDir 'run-quiet.bat'
  if (Test-Path -LiteralPath $quiet) {
    Start-Process -FilePath $quiet -WorkingDirectory $ServerDir -WindowStyle Hidden | Out-Null
    return $true
  }

  $entry = Join-Path $ServerDir 'src\index.js'
  if (-not (Test-Path -LiteralPath $entry)) { return $false }
  $node = Find-NodeExe
  if (-not $node) { return $false }
  Start-Process -FilePath $node -ArgumentList @('--disable-warning=ExperimentalWarning', 'src\index.js') `
    -WorkingDirectory $ServerDir -WindowStyle Hidden | Out-Null
  return $true
}

function Stop-PanelServer {
  param([string]$ServerDir)

  Write-PanelLogMark -ServerDir $ServerDir -Message 'خاموش کردنِ سرور'
  $panelPid = Get-PanelPid -ServerDir $ServerDir
  if ($panelPid -le 0) { return $false }
  try {
    Stop-Process -Id $panelPid -Force -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

<#
  .SYNOPSIS
  فایلی که همهٔ خروجیِ سرور در آن می‌نشیند — همان چیزی که در پنجرهٔ سیاه
  می‌دیدید. حالا به‌جای پنجره، داخلِ خودِ برنامه نشان داده می‌شود.
#>
function Get-PanelLogPath {
  param([Parameter(Mandatory = $true)][string]$ServerDir)

  $candidates = @(
    (Join-Path (Get-DataDir -ServerDir $ServerDir) 'panel.log'),
    (Join-Path (Join-Path $ServerDir 'data') 'panel.log')
  )
  foreach ($path in $candidates) {
    if (Test-Path -LiteralPath $path) { return $path }
  }
  return $candidates[0]
}

<#
  .SYNOPSIS
  آخرین خط‌های ترمینالِ سرور.
#>
function Get-PanelLog {
  param([string]$ServerDir, [int]$Lines = 400)

  $logFile = Get-PanelLogPath -ServerDir $ServerDir
  if (-not (Test-Path -LiteralPath $logFile)) {
    return 'هنوز چیزی نوشته نشده. دکمهٔ «روشن کردنِ سرور» را بزنید تا همین‌جا زنده ببینید.'
  }
  try {
    # فایل ممکن است همین لحظه در حالِ نوشته شدن باشد، پس قفلش نمی‌کنیم
    $stream = New-Object System.IO.FileStream($logFile, [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close()
    $stream.Close()
    $all = $text -split "`r?`n"
    if ($all.Count -le $Lines) { return ($all -join [Environment]::NewLine) }
    return (($all[($all.Count - $Lines)..($all.Count - 1)]) -join [Environment]::NewLine)
  } catch {
    return "ترمینال خوانده نشد: $($_.Exception.Message)"
  }
}

<#
  .SYNOPSIS
  ترمینال را خالی می‌کند (فایلِ لاگ را صفر می‌کند).
#>
function Clear-PanelLog {
  param([string]$ServerDir)
  $logFile = Get-PanelLogPath -ServerDir $ServerDir
  try {
    [System.IO.File]::WriteAllText($logFile, '', (New-Object System.Text.UTF8Encoding($false)))
    return $true
  } catch {
    return $false
  }
}

<#
  .SYNOPSIS
  یک خطِ جداکننده در ترمینال می‌نویسد تا معلوم باشد از کجا شروعِ تازه است.
#>
function Write-PanelLogMark {
  param([string]$ServerDir, [string]$Message)
  try {
    $logFile = Get-PanelLogPath -ServerDir $ServerDir
    $dir = Split-Path -Parent $logFile
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $stamp = Get-Date -Format 'HH:mm:ss'
    $line = "`r`n────────────────  $stamp  $Message  ────────────────`r`n"
    [System.IO.File]::AppendAllText($logFile, $line, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

<#
  .SYNOPSIS
  Node.js کجاست؟ اگر نصب نباشد $null برمی‌گردد.
#>
function Find-NodeExe {
  try {
    $found = Get-Command 'node' -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
  } catch { }
  # ⚠️ اگر این متغیرها خالی باشند، Join-Path خطا می‌دهد و کلِ برنامه می‌خوابد.
  #    برای همین اول وجودشان بررسی می‌شود.
  $roots = @()
  foreach ($name in @('ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LOCALAPPDATA')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $roots += $value }
  }
  foreach ($root in $roots) {
    try {
      $guess = Join-Path $root 'nodejs\node.exe'
      if (Test-Path -LiteralPath $guess) { return $guess }
    } catch { }
  }
  return $null
}

# ---------------------------------------------------------------------------
#  نسخه و به‌روزرسانی
# ---------------------------------------------------------------------------

function Get-LocalVersion {
  param([string]$ServerDir)
  $packageFile = Join-Path $ServerDir 'package.json'
  if (-not (Test-Path -LiteralPath $packageFile)) { return '0.0.0' }
  try {
    $text = [System.IO.File]::ReadAllText($packageFile, [System.Text.Encoding]::UTF8)
    $version = ($text | ConvertFrom-Json).version
    if ($version) { return [string]$version }
  } catch { }
  return '0.0.0'
}

function Get-RemoteVersion {
  param([string]$Branch = 'main')
  $url = "https://raw.githubusercontent.com/$($script:Repo)/$Branch/homelab-panel/server/package.json"
  $result = Invoke-Json -Url $url -TimeoutSec 20
  if ($result.ok -and $result.data -and $result.data.version) {
    return [string]$result.data.version
  }
  return $null
}

<#
  .SYNOPSIS
  دو نسخه را مقایسه می‌کند:  1 یعنی اولی جدیدتر، -1 یعنی دومی، 0 یعنی برابر.
#>
function Compare-AppVersion {
  param([string]$Left, [string]$Right)

  $parse = {
    param($value)
    $numbers = @()
    foreach ($part in ([string]$value -replace '[^0-9.]', '').Split('.')) {
      if ($part -match '^\d+$') { $numbers += [int]$part } else { $numbers += 0 }
    }
    while ($numbers.Count -lt 3) { $numbers += 0 }
    return $numbers
  }

  $a = & $parse $Left
  $b = & $parse $Right
  $count = [Math]::Max($a.Count, $b.Count)
  for ($i = 0; $i -lt $count; $i++) {
    $x = if ($i -lt $a.Count) { $a[$i] } else { 0 }
    $y = if ($i -lt $b.Count) { $b[$i] } else { 0 }
    if ($x -gt $y) { return 1 }
    if ($x -lt $y) { return -1 }
  }
  return 0
}

<#
  .SYNOPSIS
  آیا این مسیر باید در به‌روزرسانی و پشتیبان نادیده گرفته شود؟
  سه چیز هرگز دست نمی‌خورد: دادهٔ شما، رمزهایتان، و پوشهٔ سنگینِ کتابخانه‌ها.
#>
function Test-SkipPath {
  param([string]$RelativePath)

  $normalized = ($RelativePath -replace '\\', '/')
  if ($normalized -match '(^|/)data/') { return $true }
  if ($normalized -match '(^|/)node_modules/') { return $true }
  if ($normalized -match '(^|/)\.git/') { return $true }
  if ($normalized -match '(^|/)\.env$') { return $true }
  return $false
}

<#
  .SYNOPSIS
  فهرستِ فایل‌هایی که باید کپی شوند، با مسیرِ نسبی‌شان.
#>
function Get-CopyList {
  param([Parameter(Mandatory = $true)][string]$FromDir)

  $list = New-Object System.Collections.Generic.List[object]
  $prefix = [System.IO.Path]::GetFullPath($FromDir).TrimEnd('\', '/')

  foreach ($item in (Get-ChildItem -LiteralPath $FromDir -Recurse -File -Force)) {
    $full = [System.IO.Path]::GetFullPath($item.FullName)
    $relative = $full.Substring($prefix.Length).TrimStart('\', '/')
    if (Test-SkipPath -RelativePath $relative) { continue }
    $list.Add([PSCustomObject]@{ Source = $item.FullName; Relative = $relative }) | Out-Null
  }
  return $list
}

<#
  .SYNOPSIS
  فایل‌های نسخهٔ تازه را روی پروژه کپی می‌کند.
  پوشهٔ data (دیتابیس و لاگ) و فایل .env (رمزها) دست نمی‌خورند.
#>
function Copy-UpdateFiles {
  param(
    [Parameter(Mandatory = $true)][string]$FromDir,
    [Parameter(Mandatory = $true)][string]$ToDir
  )

  $copied = 0
  foreach ($entry in (Get-CopyList -FromDir $FromDir)) {
    $target = Join-Path $ToDir $entry.Relative
    $targetDir = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $targetDir)) {
      New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $entry.Source -Destination $target -Force
    $copied++
  }
  return @{ copied = $copied }
}

<#
  .SYNOPSIS
  از کدِ فعلی پشتیبان می‌گیرد — فقط کد، نه دادهٔ شما.
  (دادهٔ شما در به‌روزرسانی اصلاً دست نمی‌خورد، پس پشتیبانش لازم نیست؛
   اگر می‌گرفتیم، پوشهٔ پشتیبان خودش را هم داخلِ خودش کپی می‌کرد.)
  سه پشتیبانِ آخر می‌ماند و قدیمی‌ترها خودشان پاک می‌شوند.
#>
function Backup-Project {
  param([string]$ProjectRoot, [string]$ServerDir, [int]$Keep = 3)

  $backupsDir = Join-Path (Get-DataDir -ServerDir $ServerDir) 'backups'
  if (-not (Test-Path -LiteralPath $backupsDir)) {
    New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
  }

  $stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
  $target = Join-Path $backupsDir "code-$stamp"
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
  }

  try {
    foreach ($entry in (Get-CopyList -FromDir $ProjectRoot)) {
      $destination = Join-Path $target $entry.Relative
      $destinationDir = Split-Path -Parent $destination
      if (-not (Test-Path -LiteralPath $destinationDir)) {
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
      }
      Copy-Item -LiteralPath $entry.Source -Destination $destination -Force
    }
  } catch {
    return $null
  }

  try {
    $old = @(Get-ChildItem -LiteralPath $backupsDir -Directory |
      Where-Object { $_.Name -like 'code-*' } |
      Sort-Object -Property Name -Descending)
    for ($i = $Keep; $i -lt $old.Count; $i++) {
      Remove-Item -LiteralPath $old[$i].FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch { }

  return $target
}

<#
  .SYNOPSIS
  کلِ کارِ به‌روزرسانی: دانلود، باز کردن، پشتیبان، کپی، نصبِ وابستگی‌ها.
  پیام‌های مرحله‌به‌مرحله را به $OnStep می‌دهد تا در پنجره دیده شود.
#>
function Install-Update {
  param(
    [string]$Branch = 'main',
    [string]$ProjectRoot,
    [string]$ServerDir,
    [scriptblock]$OnStep = $null
  )

  $say = {
    param($message)
    if ($OnStep) { & $OnStep $message }
  }

  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("hlp-update-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $temp -Force | Out-Null
  $zipPath = Join-Path $temp 'update.zip'

  try {
    & $say "دانلودِ نسخهٔ تازه از GitHub (شاخهٔ $Branch)…"
    $url = "https://codeload.github.com/$($script:Repo)/zip/refs/heads/$Branch"
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 180

    $size = (Get-Item -LiteralPath $zipPath).Length
    if ($size -lt 1024) { throw "فایلِ دانلودشده خراب است (فقط $size بایت)" }
    & $say ("دانلود شد: " + [Math]::Round($size / 1MB, 2) + " مگابایت")

    & $say 'باز کردنِ فایل…'
    $extractDir = Join-Path $temp 'files'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

    # داخلِ زیپ همیشه یک پوشهٔ اصلی هست؛ اسمش را حدس نمی‌زنیم، پیدایش می‌کنیم
    $roots = @(Get-ChildItem -LiteralPath $extractDir -Directory)
    if ($roots.Count -lt 1) { throw 'داخلِ فایلِ دانلودشده چیزی نبود' }
    $newRoot = $roots[0].FullName

    $newVersion = Get-LocalVersion -ServerDir (Join-Path (Join-Path $newRoot 'homelab-panel') 'server')
    & $say "نسخهٔ تازه: $newVersion"

    & $say 'گرفتنِ نسخهٔ پشتیبان از کدِ فعلی…'
    $backup = Backup-Project -ProjectRoot $ProjectRoot -ServerDir $ServerDir
    if ($backup) { & $say "پشتیبان: $backup" } else { & $say 'پشتیبان گرفته نشد (ادامه می‌دهیم)' }

    & $say 'خاموش کردنِ سرور…'
    Stop-PanelServer -ServerDir $ServerDir | Out-Null
    Start-Sleep -Seconds 2

    & $say 'کپیِ فایل‌های تازه…'
    $result = Copy-UpdateFiles -FromDir $newRoot -ToDir $ProjectRoot
    & $say "$($result.copied) فایل به‌روز شد (دادهٔ شما و فایل .env دست نخورد)"

    & $say 'بررسیِ وابستگی‌ها…'
    try {
      $npm = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList @('/c', 'npm install --omit=dev --no-audit --no-fund') `
        -WorkingDirectory $ServerDir -WindowStyle Hidden -Wait -PassThru
      if ($npm.ExitCode -ne 0) { & $say 'هشدار: نصبِ وابستگی‌ها خطا داد (شاید اینترنت قطع است)' }
    } catch {
      & $say "هشدار: npm اجرا نشد — $($_.Exception.Message)"
    }

    & $say 'روشن کردنِ دوبارهٔ سرور…'
    Start-PanelServer -ServerDir $ServerDir | Out-Null

    return @{ ok = $true; version = $newVersion; backup = $backup; files = $result.copied }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  } finally {
    try { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  }
}

# ---------------------------------------------------------------------------
#  نمونه‌کد برای برنامه‌نویسِ اپ
# ---------------------------------------------------------------------------

function Get-CodeSnippet {
  param([string]$Kind, [string]$BaseUrl)

  $b = $BaseUrl
  switch ($Kind) {
    'اندروید (Kotlin)' {
      return @"
// build.gradle:  implementation("com.squareup.okhttp3:okhttp:4.12.0")
// AndroidManifest.xml:  <uses-permission android:name="android.permission.INTERNET"/>
// اگر آدرس http است (بدون s)، این را هم در manifest بگذارید:
//     android:usesCleartextTraffic="true"

const val BASE = "$b"
val http = OkHttpClient()
val JSON = "application/json".toMediaType()

fun requestCode(phone: String) {
    val body = "{\"phone\":\"`$phone\"}".toRequestBody(JSON)
    val req = Request.Builder().url("`$BASE/api/app/auth/request-code").post(body).build()
    http.newCall(req).execute().use { println(it.body?.string()) }
}

fun verifyCode(phone: String, code: String): String? {
    val body = "{\"phone\":\"`$phone\",\"code\":\"`$code\"}".toRequestBody(JSON)
    val req = Request.Builder().url("`$BASE/api/app/auth/verify-code").post(body).build()
    http.newCall(req).execute().use { res ->
        val json = JSONObject(res.body!!.string())
        return if (json.optBoolean("ok")) json.getString("token") else null
    }
}
"@
    }
    'فلاتر' {
      return @"
// pubspec.yaml:  http: ^1.2.0
import 'dart:convert';
import 'package:http/http.dart' as http;

const base = "$b";

Future<void> requestCode(String phone) async {
  await http.post(Uri.parse("`$base/api/app/auth/request-code"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"phone": phone}));
}

Future<String?> verifyCode(String phone, String code) async {
  final r = await http.post(Uri.parse("`$base/api/app/auth/verify-code"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"phone": phone, "code": code}));
  final data = jsonDecode(r.body);
  return data["ok"] == true ? data["token"] as String : null;
}
"@
    }
    'ویندوز (C#)' {
      return @"
using System.Net.Http;
using System.Net.Http.Json;

const string Base = "$b";
var http = new HttpClient();

// ۱) فرستادن کد
await http.PostAsJsonAsync(`$"{Base}/api/app/auth/request-code", new { phone = "09121234567" });

// ۲) تایید کد و گرفتن توکن
var res = await http.PostAsJsonAsync(`$"{Base}/api/app/auth/verify-code",
        new { phone = "09121234567", code = "123456" });
var data = await res.Content.ReadFromJsonAsync<Dictionary<string, object>>();
var token = data["token"].ToString();

// ۳) درخواست‌های بعدی
http.DefaultRequestHeaders.Authorization = new("Bearer", token);
var me = await http.GetStringAsync(`$"{Base}/api/app/me");
"@
    }
    'سایت (JavaScript)' {
      return @"
// ۱) فرستادن کد
await fetch("$b/api/app/auth/request-code", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: "09121234567" })   // یا { email: "a@gmail.com" }
});

// ۲) تایید کد و گرفتن توکن
const res = await fetch("$b/api/app/auth/verify-code", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: "09121234567", code: "123456" })
});
const data = await res.json();     // { ok:true, token:"...", user:{...} }
localStorage.setItem("token", data.token);

// ۳) هر درخواست بعدی
await fetch("$b/api/app/me", {
  headers: { Authorization: "Bearer " + localStorage.getItem("token") }
});
"@
    }
    default {
      return @"
curl -X POST $b/api/app/auth/request-code -H "Content-Type: application/json" -d "{\"phone\":\"09121234567\"}"

curl -X POST $b/api/app/auth/verify-code -H "Content-Type: application/json" -d "{\"phone\":\"09121234567\",\"code\":\"123456\"}"

curl $b/api/app/me -H "Authorization: Bearer <token>"
"@
    }
  }
}

function Get-SnippetKinds {
  return @('سایت (JavaScript)', 'اندروید (Kotlin)', 'فلاتر', 'ویندوز (C#)', 'تستِ سریع (curl)')
}

# ---------------------------------------------------------------------------
#  نصبِ برنامه روی کامپیوتر
# ---------------------------------------------------------------------------

<#
  .SYNOPSIS
  آیا این پوشه، پوشهٔ خودِ برنامه است؟ (تا نصب‌کننده اشتباهی جای دیگری نریزد)
#>
function Test-ProgramFolder {
  param([string]$Root)
  if (-not $Root) { return $false }
  return (Test-Path -LiteralPath (Join-Path $Root 'homelab-panel\server\src\index.js'))
}

<#
  .SYNOPSIS
  آیا پوشهٔ مقصد برای نصب مناسب است؟ پیامِ فارسی برمی‌گرداند.
#>
function Test-InstallTarget {
  param([string]$Target)

  if (-not $Target -or -not $Target.Trim()) {
    return @{ ok = $false; message = 'مسیرِ نصب را انتخاب کنید' }
  }
  try {
    $full = [System.IO.Path]::GetFullPath($Target)
  } catch {
    return @{ ok = $false; message = 'این مسیر درست نیست' }
  }
  if ($full -match '[<>|?*]') {
    return @{ ok = $false; message = 'در نامِ پوشه نشانه‌های < > | ? * نگذارید' }
  }
  if (Test-Path -LiteralPath $full -PathType Leaf) {
    return @{ ok = $false; message = 'این یک فایل است، نه پوشه' }
  }
  if ((Test-Path -LiteralPath $full) -and (Test-ProgramFolder -Root $full)) {
    return @{ ok = $true; full = $full; upgrade = $true; message = 'در این پوشه نسخه‌ای از برنامه هست — روی همان به‌روزرسانی می‌شود (دادهٔ شما می‌ماند)' }
  }
  return @{ ok = $true; full = $full; upgrade = $false; message = 'آمادهٔ نصب' }
}

<#
  .SYNOPSIS
  یک میان‌بر می‌سازد که برنامه را بدونِ هیچ پنجرهٔ سیاهی باز می‌کند.
#>
function New-ProgramShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$LinkPath
  )

  $launcher = Join-Path $InstallRoot 'homelab-panel\desktop\launch.vbs'
  if (-not (Test-Path -LiteralPath $launcher)) { return $null }
  try {
    $dir = Split-Path -Parent $LinkPath
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($LinkPath)
    # wscript یعنی هیچ پنجرهٔ سیاهی حتی یک لحظه هم دیده نمی‌شود
    $link.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $link.Arguments = """$launcher"""
    $link.WorkingDirectory = Join-Path $InstallRoot 'homelab-panel\desktop'
    $link.Description = 'برنامهٔ سرور خانگی'
    $link.Save()
    return $LinkPath
  } catch {
    return $null
  }
}

# ---------------------------------------------------------------------------
#  تنظیماتِ خودِ برنامه (نه سرور) — شاخهٔ به‌روزرسانی و مانندِ آن
# ---------------------------------------------------------------------------

function Get-DesktopSettingsPath {
  param([Parameter(Mandatory = $true)][string]$ServerDir)
  return (Join-Path (Get-DataDir -ServerDir $ServerDir) 'desktop.json')
}

<#
  .SYNOPSIS
  تنظیماتِ ذخیره‌شدهٔ برنامه. اگر چیزی نبود، پیش‌فرض‌ها.
#>
function Get-DesktopSettings {
  param([Parameter(Mandatory = $true)][string]$ServerDir)

  $defaults = @{ branch = $script:DefaultBranch; autoCheck = $true }
  $path = Get-DesktopSettingsPath -ServerDir $ServerDir
  if (-not (Test-Path -LiteralPath $path)) { return $defaults }
  try {
    $saved = ([System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
    if ($saved.branch) { $defaults.branch = [string]$saved.branch }
    if ($null -ne $saved.autoCheck) { $defaults.autoCheck = [bool]$saved.autoCheck }
  } catch { }
  return $defaults
}

function Save-DesktopSettings {
  param(
    [Parameter(Mandatory = $true)][string]$ServerDir,
    [Parameter(Mandatory = $true)][hashtable]$Settings
  )
  $path = Get-DesktopSettingsPath -ServerDir $ServerDir
  try {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $json = ($Settings | ConvertTo-Json -Depth 4)
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
    return $true
  } catch {
    return $false
  }
}

# ---------------------------------------------------------------------------
#  مدیریتِ برنامه‌ها و سایت‌ها (از راهِ کلیدِ محلی)
# ---------------------------------------------------------------------------

<#
  .SYNOPSIS
  کلیدی که سرور برای برنامهٔ رویِ همین کامپیوتر گذاشته است.
  فقط برنامه‌ای که به فایل‌های سرور دسترسی دارد می‌تواند بخواندش.
#>
function Get-LocalAdminKey {
  param(
    [Parameter(Mandatory = $true)][string]$ServerDir,
    # فقط برای آزمون: وقتی پوشهٔ داده جای دیگری است و در .env هم ننوشته
    [string]$DataDir = ''
  )

  $base = if ($DataDir) { $DataDir } else { Get-DataDir -ServerDir $ServerDir }
  $path = Join-Path $base 'local-admin.key'
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $key = ([System.IO.File]::ReadAllText($path)).Trim()
    if ($key.Length -ge 32) { return $key }
  } catch { }
  return $null
}

<#
  .SYNOPSIS
  یک درخواستِ مدیریتی به سرورِ محلی، با کلیدِ محلی.
#>
function Invoke-AdminJson {
  param(
    [Parameter(Mandatory = $true)][string]$ServerDir,
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Method = 'GET',
    $Body = $null,
    [int]$Port = 4700,
    [string]$DataDir = ''
  )

  $key = Get-LocalAdminKey -ServerDir $ServerDir -DataDir $DataDir
  if (-not $key) {
    return @{ ok = $false; status = 0; data = $null; error = 'کلیدِ محلی پیدا نشد — سرور را یک بار روشن کنید' }
  }

  $params = @{
    Uri             = "http://127.0.0.1:$Port$Path"
    Method          = $Method
    TimeoutSec      = 15
    UseBasicParsing = $true
    Headers         = @{ 'X-Local-Key' = $key }
  }
  if ($null -ne $Body) {
    $json = ($Body | ConvertTo-Json -Depth 6 -Compress)
    $params['Body'] = [System.Text.Encoding]::UTF8.GetBytes($json)
    $params['ContentType'] = 'application/json; charset=utf-8'
  }

  try {
    $response = Invoke-WebRequest @params
    $text = [System.Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
    $data = $null
    if ($text) { try { $data = $text | ConvertFrom-Json } catch { } }
    return @{ ok = $true; status = [int]$response.StatusCode; data = $data; error = $null }
  } catch {
    $status = 0
    $text = $null
    $data = $null
    $webResponse = $null
    try { $webResponse = $_.Exception.Response } catch { }
    if ($webResponse) {
      try { $status = [int]$webResponse.StatusCode } catch { }
      try {
        if ($webResponse | Get-Member -Name 'GetResponseStream' -MemberType Method -ErrorAction SilentlyContinue) {
          $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream(), [System.Text.Encoding]::UTF8)
          $text = $reader.ReadToEnd()
          $reader.Close()
        }
      } catch { }
    }
    if (-not $text) { try { $text = $_.ErrorDetails.Message } catch { } }
    if ($text) { try { $data = $text | ConvertFrom-Json } catch { } }
    return @{ ok = $false; status = $status; data = $data; error = $_.Exception.Message }
  }
}

<#
  .SYNOPSIS
  متنِ آماده‌ای که به سازندهٔ هر برنامه می‌دهید: آدرس‌ها، کلید، و نمونهٔ درخواست.
#>
function Get-ApiCard {
  param(
    [Parameter(Mandatory = $true)][string]$Slug,
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [string]$ApiKey = '',
    [bool]$KeyRequired = $false,
    [int]$CodeLength = 6
  )

  $keyLine = if ($KeyRequired) { "کلید (اجباری):   $ApiKey" } else { "کلید (اختیاری):  $ApiKey" }
  $keyField = if ($KeyRequired) { ",`"key`":`"$ApiKey`"" } else { '' }

  return @"
شناسهٔ برنامه:   $Slug
آدرسِ سرور:      $BaseUrl
$keyLine

──────────  فرستادنِ کدِ $CodeLength رقمی  ──────────
POST $BaseUrl/api/app/auth/request-code
Content-Type: application/json

{"phone":"09121234567","app":"$Slug"$keyField}

  (به‌جای phone می‌شود email فرستاد: {"email":"a@gmail.com","app":"$Slug"})

──────────  تأییدِ کد و گرفتنِ توکن  ──────────
POST $BaseUrl/api/app/auth/verify-code
Content-Type: application/json

{"phone":"09121234567","code":"123456","app":"$Slug"$keyField}

  پاسخ:  {"ok":true,"token":"eyJ…","user":{…}}

──────────  درخواست‌های بعدی  ──────────
GET  $BaseUrl/api/app/me
Authorization: Bearer <token>

──────────  شناسنامه و تستِ اتصال  ──────────
GET  $BaseUrl/api/app/config?app=$Slug
GET  $BaseUrl/api/app/ping
"@
}

# ---------------------------------------------------------------------------
#  وقتی چیزی خراب می‌شود
#
#  برنامه بدونِ پنجرهٔ سیاه اجرا می‌شود، پس اگر خطایی بدهد کسی چیزی نمی‌بیند و
#  فقط «باز شد و گم شد» به‌نظر می‌رسد. این‌جا هر خطا هم در فایل نوشته می‌شود و
#  هم روی صفحه نشان داده می‌شود.
# ---------------------------------------------------------------------------

function Get-ErrorLogPath {
  param([string]$ServerDir = '')
  if ($ServerDir) {
    try { return (Join-Path (Get-DataDir -ServerDir $ServerDir) 'desktop-error.log') } catch { }
  }
  return (Join-Path ([System.IO.Path]::GetTempPath()) 'homelab-desktop-error.log')
}

<#
  .SYNOPSIS
  خطا را در فایل می‌نویسد و مسیرِ فایل را برمی‌گرداند.
#>
function Write-AppError {
  param(
    [Parameter(Mandatory = $true)]$ErrorRecord,
    [string]$Where = '',
    [string]$ServerDir = ''
  )

  $path = Get-ErrorLogPath -ServerDir $ServerDir
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $message = try { $ErrorRecord.Exception.Message } catch { [string]$ErrorRecord }
  $stack = try { $ErrorRecord.ScriptStackTrace } catch { '' }
  $line = "[$stamp] $Where`r`n$message`r`n$stack`r`n----------------------------------------`r`n"
  try {
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::AppendAllText($path, $line, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
  return $path
}

<#
  .SYNOPSIS
  یک کادرِ کوچکِ «یک چیز بنویس» — با خودِ WinForms، بدونِ وابستگی به چیزِ دیگر.
#>
function Show-InputDialog {
  param(
    [string]$Message = '',
    [string]$Title = 'برنامهٔ سرور خانگی',
    [string]$Default = ''
  )

  $dialog = New-Object System.Windows.Forms.Form
  $dialog.Text = $Title
  $dialog.Size = New-Object System.Drawing.Size(420, 190)
  $dialog.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
  $dialog.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $dialog.MinimizeBox = $false
  $dialog.MaximizeBox = $false
  $dialog.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
  $dialog.RightToLeftLayout = $true
  $dialog.Font = New-Object System.Drawing.Font('Tahoma', 9.75)

  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Message
  $label.Location = New-Object System.Drawing.Point(16, 16)
  $label.Size = New-Object System.Drawing.Size(380, 46)

  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point(16, 68)
  $box.Size = New-Object System.Drawing.Size(380, 26)
  $box.Text = $Default

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'باشد'
  $ok.Location = New-Object System.Drawing.Point(216, 106)
  $ok.Size = New-Object System.Drawing.Size(90, 30)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'بی‌خیال'
  $cancel.Location = New-Object System.Drawing.Point(112, 106)
  $cancel.Size = New-Object System.Drawing.Size(90, 30)
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

  $dialog.Controls.AddRange(@($label, $box, $ok, $cancel))
  $dialog.AcceptButton = $ok
  $dialog.CancelButton = $cancel

  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $box.Text }
  return ''
}
