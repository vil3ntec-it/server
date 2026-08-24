# ---------------------------------------------------------------------------
#  آزمونِ مغزِ برنامهٔ سرور — بدونِ باز شدنِ هیچ پنجره‌ای
#      pwsh homelab-panel/desktop/test/lib.tests.ps1
#      (روی ویندوز: powershell -ExecutionPolicy Bypass -File ...)
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) 'lib.ps1')

$script:Passed = 0
$script:Failed = 0

function Check {
  param([string]$Name, [bool]$Ok, [string]$Extra = '')
  if ($Ok) {
    $script:Passed++
    Write-Host "  [ok] $Name"
  } else {
    $script:Failed++
    Write-Host "  [X ] $Name $Extra"
  }
}

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("hlp-desktop-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $temp -Force | Out-Null

try {
  # ------------------------------------------------------------------ .env --
  Write-Host "`n> فایل .env"
  $envPath = Join-Path $temp '.env'

  Set-EnvValues -Path $envPath -Values @{ 'OTP_SMS_PROVIDER' = 'kavenegar'; 'OTP_SMS_KEY' = 'abc123' } | Out-Null
  $values = Read-EnvFile -Path $envPath
  Check 'کلیدِ تازه نوشته می‌شود' ($values['OTP_SMS_PROVIDER'] -eq 'kavenegar')
  Check 'کلیدِ دوم هم نوشته می‌شود' ($values['OTP_SMS_KEY'] -eq 'abc123')

  $bytes = [System.IO.File]::ReadAllBytes($envPath)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  Check 'فایل بدونِ BOM نوشته می‌شود (وگرنه سرور اولین کلید را نمی‌خواند)' (-not $hasBom)

  Set-EnvValues -Path $envPath -Values @{ 'OTP_SMS_KEY' = 'xyz789' } | Out-Null
  $values = Read-EnvFile -Path $envPath
  Check 'کلیدِ موجود عوض می‌شود' ($values['OTP_SMS_KEY'] -eq 'xyz789')
  Check 'کلیدِ دیگر دست نمی‌خورد' ($values['OTP_SMS_PROVIDER'] -eq 'kavenegar')

  $lineCount = ([System.IO.File]::ReadAllLines($envPath) | Where-Object { $_ -match '^OTP_SMS_KEY=' }).Count
  Check 'کلید تکراری نمی‌شود' ($lineCount -eq 1) "شمار=$lineCount"

  Set-EnvValues -Path $envPath -Values @{ 'OTP_SMS_KEY' = '' } | Out-Null
  $values = Read-EnvFile -Path $envPath
  Check 'مقدارِ خالی یعنی کلید برداشته شود' (-not $values.ContainsKey('OTP_SMS_KEY'))

  Set-EnvValues -Path $envPath -Values @{ 'OTP_SMS_TEXT' = 'کد ورود شما: {code}' } | Out-Null
  $values = Read-EnvFile -Path $envPath
  Check 'متنِ فارسی سالم می‌ماند' ($values['OTP_SMS_TEXT'] -eq 'کد ورود شما: {code}') $values['OTP_SMS_TEXT']

  # کامنت‌های فایل نباید پاک شوند
  $handWritten = Join-Path $temp 'hand.env'
  [System.IO.File]::WriteAllText($handWritten, "# یادداشتِ من`nHLP_PORT=4700`n", (New-Object System.Text.UTF8Encoding($false)))
  Set-EnvValues -Path $handWritten -Values @{ 'HLP_PORT' = '4800' } | Out-Null
  $text = [System.IO.File]::ReadAllText($handWritten)
  Check 'کامنت‌های فایل دست نمی‌خورد' ($text.Contains('# یادداشتِ من'))
  Check 'پورت عوض شد' ($text.Contains('HLP_PORT=4800'))

  # ------------------------------------------------------------ پوشهٔ داده --
  Write-Host "`n> پیدا کردنِ پوشهٔ داده"
  $srv = Join-Path $temp 'srv1'
  New-Item -ItemType Directory -Path $srv -Force | Out-Null
  Check 'پیش‌فرض، پوشهٔ data کنارِ سرور است' ((Get-DataDir -ServerDir $srv) -eq (Join-Path $srv 'data'))

  Set-EnvValues -Path (Join-Path $srv '.env') -Values @{ 'HLP_DATA_DIR' = './my-data' } | Out-Null
  Check 'مسیرِ نسبیِ .env رعایت می‌شود' ((Get-DataDir -ServerDir $srv) -eq ([System.IO.Path]::GetFullPath((Join-Path $srv 'my-data'))))

  $absolute = Join-Path $temp 'elsewhere'
  Set-EnvValues -Path (Join-Path $srv '.env') -Values @{ 'HLP_DATA_DIR' = $absolute } | Out-Null
  Check 'مسیرِ کاملِ .env رعایت می‌شود' ((Get-DataDir -ServerDir $srv) -eq $absolute)

  # -------------------------------------------------------------- مقایسهٔ نسخه --
  Write-Host "`n> مقایسهٔ نسخه"
  Check '1.1.2 از 1.1.1 جدیدتر است' ((Compare-AppVersion -Left '1.1.2' -Right '1.1.1') -eq 1)
  Check '1.1.1 با 1.1.1 برابر است' ((Compare-AppVersion -Left '1.1.1' -Right '1.1.1') -eq 0)
  Check '1.1.0 از 1.1.1 قدیمی‌تر است' ((Compare-AppVersion -Left '1.1.0' -Right '1.1.1') -eq -1)
  Check '2.0.0 از 1.9.9 جدیدتر است' ((Compare-AppVersion -Left '2.0.0' -Right '1.9.9') -eq 1)
  Check '1.2 با 1.2.0 برابر است' ((Compare-AppVersion -Left '1.2' -Right '1.2.0') -eq 0)
  Check '1.10.0 از 1.9.0 جدیدتر است' ((Compare-AppVersion -Left '1.10.0' -Right '1.9.0') -eq 1)

  # ------------------------------------------------------ کپیِ به‌روزرسانی --
  Write-Host "`n> کپیِ فایل‌های به‌روزرسانی"
  $newRoot = Join-Path $temp 'new'
  $oldRoot = Join-Path $temp 'old'
  foreach ($dir in @(
      (Join-Path $newRoot 'homelab-panel/server/src'),
      (Join-Path $newRoot 'homelab-panel/server/data'),
      (Join-Path $newRoot 'homelab-panel/server/node_modules/express'),
      (Join-Path $oldRoot 'homelab-panel/server/src'),
      (Join-Path $oldRoot 'homelab-panel/server/data'))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  Set-Content -LiteralPath (Join-Path $newRoot 'homelab-panel/server/src/index.js') -Value 'new code' -NoNewline
  Set-Content -LiteralPath (Join-Path $newRoot 'homelab-panel/server/data/panel.db') -Value 'EMPTY DB' -NoNewline
  Set-Content -LiteralPath (Join-Path $newRoot 'homelab-panel/server/.env') -Value 'OTP_SMS_KEY=theirs' -NoNewline
  Set-Content -LiteralPath (Join-Path $newRoot 'homelab-panel/server/node_modules/express/index.js') -Value 'x' -NoNewline
  Set-Content -LiteralPath (Join-Path $newRoot 'README.md') -Value 'new readme' -NoNewline

  Set-Content -LiteralPath (Join-Path $oldRoot 'homelab-panel/server/src/index.js') -Value 'old code' -NoNewline
  Set-Content -LiteralPath (Join-Path $oldRoot 'homelab-panel/server/data/panel.db') -Value 'MY REAL DATA' -NoNewline
  Set-Content -LiteralPath (Join-Path $oldRoot 'homelab-panel/server/.env') -Value 'OTP_SMS_KEY=mine' -NoNewline

  $result = Copy-UpdateFiles -FromDir $newRoot -ToDir $oldRoot
  Check 'کدِ تازه کپی شد' ((Get-Content -LiteralPath (Join-Path $oldRoot 'homelab-panel/server/src/index.js') -Raw).Trim() -eq 'new code')
  Check 'فایلِ تازه ساخته شد' (Test-Path -LiteralPath (Join-Path $oldRoot 'README.md'))
  Check 'دیتابیسِ من دست نخورد' ((Get-Content -LiteralPath (Join-Path $oldRoot 'homelab-panel/server/data/panel.db') -Raw).Trim() -eq 'MY REAL DATA')
  Check 'رمزهای من (.env) دست نخورد' ((Get-Content -LiteralPath (Join-Path $oldRoot 'homelab-panel/server/.env') -Raw).Trim() -eq 'OTP_SMS_KEY=mine')
  Check 'node_modules کپی نشد' (-not (Test-Path -LiteralPath (Join-Path $oldRoot 'homelab-panel/server/node_modules/express/index.js')))
  Check 'شمارشِ فایل‌ها درست است' ($result.copied -eq 2) "copied=$($result.copied)"

  # ------------------------------------------------------------- پشتیبان --
  Write-Host "`n> نسخهٔ پشتیبان"
  $backupServerDir = Join-Path $oldRoot 'homelab-panel/server'
  $firstBackup = Backup-Project -ProjectRoot $oldRoot -ServerDir $backupServerDir
  Check 'پوشهٔ پشتیبان ساخته شد' ($firstBackup -and (Test-Path -LiteralPath $firstBackup)) "$firstBackup"
  Check 'کد در پشتیبان هست' (Test-Path -LiteralPath (Join-Path $firstBackup 'homelab-panel/server/src/index.js'))
  Check 'دادهٔ سنگین در پشتیبان نیست (وگرنه بی‌نهایت بزرگ می‌شد)' (-not (Test-Path -LiteralPath (Join-Path $firstBackup 'homelab-panel/server/data')))
  Check 'فایلِ رمزها در پشتیبان نیست' (-not (Test-Path -LiteralPath (Join-Path $firstBackup 'homelab-panel/server/.env')))

  $backupsDir = Join-Path (Join-Path $backupServerDir 'data') 'backups'
  foreach ($name in @('code-2024-01-01-0900', 'code-2024-01-02-0900', 'code-2024-01-03-0900', 'code-2024-01-04-0900')) {
    New-Item -ItemType Directory -Path (Join-Path $backupsDir $name) -Force | Out-Null
  }
  Backup-Project -ProjectRoot $oldRoot -ServerDir $backupServerDir | Out-Null
  $kept = @(Get-ChildItem -LiteralPath $backupsDir -Directory | Where-Object { $_.Name -like 'code-*' })
  Check 'فقط سه پشتیبانِ آخر می‌ماند' ($kept.Count -eq 3) "شمار=$($kept.Count)"

  Check 'مسیرِ data رد می‌شود' (Test-SkipPath -RelativePath 'homelab-panel/server/data/panel.db')
  Check 'مسیرِ node_modules رد می‌شود' (Test-SkipPath -RelativePath 'homelab-panel/server/node_modules/ws/index.js')
  Check 'فایلِ .env رد می‌شود' (Test-SkipPath -RelativePath 'homelab-panel/server/.env')
  Check 'کدِ معمولی رد نمی‌شود' (-not (Test-SkipPath -RelativePath 'homelab-panel/server/src/index.js'))
  Check 'پوشه‌ای به نامِ data-old رد نمی‌شود' (-not (Test-SkipPath -RelativePath 'homelab-panel/data-old/x.js'))

  # ------------------------------------------------------------ نسخهٔ محلی --
  Write-Host "`n> خواندنِ نسخه از package.json"
  $fakeServer = Join-Path $temp 'fake-server'
  New-Item -ItemType Directory -Path $fakeServer -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $fakeServer 'package.json') -Value '{ "name": "x", "version": "1.1.1" }'
  Check 'نسخه از package.json خوانده می‌شود' ((Get-LocalVersion -ServerDir $fakeServer) -eq '1.1.1')
  Check 'نبودنِ فایل، برنامه را نمی‌خواباند' ((Get-LocalVersion -ServerDir (Join-Path $temp 'nowhere')) -eq '0.0.0')

  # --------------------------------------------------- ظاهرِ برنامه (XAML) --
  Write-Host "`n> ظاهرِ برنامه"
  $desktopDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
  $xamlPath = Join-Path $desktopDir 'ui.xaml'
  $appPath = Join-Path $desktopDir 'app.ps1'

  Check 'فایلِ ظاهر هست' (Test-Path -LiteralPath $xamlPath)
  $xaml = $null
  try {
    $xaml = [xml][System.IO.File]::ReadAllText($xamlPath, [System.Text.Encoding]::UTF8)
    Check 'XAML خوانده می‌شود' ($null -ne $xaml)
  } catch {
    Check 'XAML خوانده می‌شود' $false $_.Exception.Message
  }

  if ($xaml) {
    # همهٔ نام‌های داخلِ ظاهر
    $names = New-Object System.Collections.Generic.HashSet[string]
    foreach ($node in $xaml.SelectNodes('//*')) {
      $value = $node.GetAttribute('Name', 'http://schemas.microsoft.com/winfx/2006/xaml')
      if ($value) { [void]$names.Add($value) }
    }
    Check 'ظاهر نام‌گذاری شده است' ($names.Count -gt 40) "شمار=$($names.Count)"

    $appText = [System.IO.File]::ReadAllText($appPath, [System.Text.Encoding]::UTF8)

    # نام‌هایی که کد از FindName می‌خواهد باید در ظاهر باشند
    $wanted = @()
    foreach ($match in [regex]::Matches($appText, "'([A-Z][A-Za-z0-9]+)'")) {
      $candidate = $match.Groups[1].Value
      if ($candidate -match '^(Lbl|Btn|Txt|Cmb|Chk|Lst|Nav|Page|Card)') { $wanted += $candidate }
    }
    $missing = @($wanted | Sort-Object -Unique | Where-Object { -not $names.Contains($_) })
    Check 'هر نامی که کد می‌خواهد در ظاهر هست' ($missing.Count -eq 0) ($missing -join '، ')

    # و برعکس: هر عنصرِ نام‌دار باید در کد به کار رفته باشد (وگرنه یعنی جا مانده)
    $unused = @($names | Where-Object { $_ -match '^(Lbl|Btn|Txt|Cmb|Chk|Lst|Nav|Page|Card)' -and $appText -notlike "*$_*" })
    Check 'چیزی در ظاهر بی‌استفاده نمانده' ($unused.Count -eq 0) ($unused -join '، ')

    Check 'خطِ وزیر همراهِ برنامه است' (Test-Path -LiteralPath (Join-Path $desktopDir 'fonts/Vazirmatn-Regular.ttf'))
    Check 'پنجره تمام‌صفحه باز می‌شود' ($appText.Contains('WindowState]::Maximized'))

    # کادرهایی که کاربر باید در آن‌ها بنویسد نباید فقط‌خواندنی باشند
    $mustType = @('TxtOtpTarget', 'TxtOtpCode', 'TxtBranch', 'TxtMailUser', 'TxtMailHost', 'TxtAppName')
    $locked = @()
    foreach ($node in $xaml.SelectNodes('//*')) {
      $nodeName = $node.GetAttribute('Name', 'http://schemas.microsoft.com/winfx/2006/xaml')
      if (-not $nodeName -or $mustType -notcontains $nodeName) { continue }
      $style = [string]$node.GetAttribute('Style')
      $readOnly = [string]$node.GetAttribute('IsReadOnly')
      # سبکِ Mono فقط‌خواندنی است، مگر خودش خلافش را بگوید
      if ($style -like '*Mono*' -and $readOnly -ne 'False') { $locked += $nodeName }
      if ($readOnly -eq 'True') { $locked += $nodeName }
    }
    Check 'کادرهای نوشتنی قفل نیستند' ($locked.Count -eq 0) ($locked -join '، ')

    # تایمرها باید در سطحِ اسکریپت باشند. اگر متغیرِ محلی باشند، وقتی تیکشان
    # می‌زند دیگر پیدا نمی‌شوند و $null.Stop() کلِ پنجره را می‌بندد.
    $badTimers = @()
    foreach ($match in [regex]::Matches($appText, '\$([A-Za-z:]+)\s*=\s*New-Object\s+System\.Windows\.Threading\.DispatcherTimer')) {
      $varName = $match.Groups[1].Value
      if ($varName -notlike 'script:*') { $badTimers += $varName }
    }
    Check 'تایمرها در سطحِ اسکریپت‌اند' ($badTimers.Count -eq 0) ($badTimers -join '، ')

    Check 'تورِ ایمنیِ خطاها هست' ($appText.Contains('Add_UnhandledException'))
    Check 'آیکونِ برنامه همراهش است' (Test-Path -LiteralPath (Join-Path $desktopDir 'server.ico'))
  }

  # ------------------------------------------------ بالا آمدن با ویندوز --
  Write-Host "`n> بالا آمدن با ویندوز"
  $autoState = Get-AutoStartState -ServerDir $temp
  Check 'وضعیتِ راه‌اندازیِ خودکار خوانده می‌شود' ($null -ne $autoState -and $autoState.ContainsKey('installed'))
  Check 'روی غیرِ ویندوز، بی‌سروصدا پشتیبانی‌نشده گزارش می‌شود' (($autoState.supported -eq $true) -or ($autoState.detail -like '*ویندوز*')) "$($autoState.detail)"

  $noLauncher = Enable-AutoStart -ServerDir (Join-Path $temp 'nowhere-at-all')
  Check 'بدونِ فایلِ اجرا، پیامِ روشن می‌دهد' ($noLauncher.ok -eq $false -and $noLauncher.message)

  # ------------------------------------------------------- گزارشِ خطاها --
  Write-Host "`n> گزارشِ خطا (تا پنجره بی‌صدا گم نشود)"
  $errServer = Join-Path $temp 'err-server'
  New-Item -ItemType Directory -Path (Join-Path $errServer 'data') -Force | Out-Null
  Check 'مسیرِ گزارشِ خطا کنارِ داده است' ((Get-ErrorLogPath -ServerDir $errServer) -eq (Join-Path (Join-Path $errServer 'data') 'desktop-error.log'))
  Check 'بدونِ پوشهٔ سرور هم مسیری دارد' ((Get-ErrorLogPath).Length -gt 0)

  try { throw 'یک خطای ساختگی' } catch {
    $written = Write-AppError -ErrorRecord $_ -Where 'آزمون' -ServerDir $errServer
    Check 'خطا در فایل نوشته می‌شود' (Test-Path -LiteralPath $written)
    $body = [System.IO.File]::ReadAllText($written)
    Check 'متنِ خطا و جایش نوشته می‌شود' ($body.Contains('یک خطای ساختگی') -and $body.Contains('آزمون'))
  }

  # همان اشکالی که پنجره را می‌بست: نبودنِ متغیرهای محیطی نباید خطا بدهد
  $savedProgram = $env:ProgramFiles
  try {
    $env:ProgramFiles = ''
    $node = Find-NodeExe
    Check 'نبودنِ ProgramFiles برنامه را نمی‌خواباند' ($true)
  } catch {
    Check 'نبودنِ ProgramFiles برنامه را نمی‌خواباند' ($false) $_.Exception.Message
  } finally {
    $env:ProgramFiles = $savedProgram
  }

  # ------------------------------------------------ تنظیماتِ خودِ برنامه --
  Write-Host "`n> تنظیماتِ برنامه (شاخهٔ به‌روزرسانی)"
  $prefServer = Join-Path $temp 'pref-server'
  New-Item -ItemType Directory -Path $prefServer -Force | Out-Null
  $pref = Get-DesktopSettings -ServerDir $prefServer
  Check 'پیش‌فرض دارد' ($pref.branch -and $pref.autoCheck -eq $true) "$($pref.branch)"

  Save-DesktopSettings -ServerDir $prefServer -Settings @{ branch = 'main'; autoCheck = $false } | Out-Null
  $pref2 = Get-DesktopSettings -ServerDir $prefServer
  Check 'شاخه یادش می‌ماند' ($pref2.branch -eq 'main')
  Check 'بررسیِ خودکار یادش می‌ماند' ($pref2.autoCheck -eq $false)

  Write-Host "`n> کارتِ آدرسِ API"
  $card = Get-ApiCard -Slug 'shop' -BaseUrl 'https://x.example.com' -ApiKey 'hlp_abc' -KeyRequired $true -CodeLength 6
  Check 'آدرسِ فرستادنِ کد در کارت هست' ($card.Contains('https://x.example.com/api/app/auth/request-code'))
  Check 'شناسهٔ برنامه در کارت هست' ($card.Contains('"app":"shop"'))
  Check 'کلید در کارت هست' ($card.Contains('hlp_abc') -and $card.Contains('"key":"hlp_abc"'))
  $cardNoKey = Get-ApiCard -Slug 'shop' -BaseUrl 'http://a' -ApiKey '' -KeyRequired $false
  Check 'وقتی کلید اجباری نیست، در نمونهٔ درخواست نمی‌آید' (-not $cardNoKey.Contains('"key"'))

  # ------------------------------------------------------- ترمینال و نصب --
  Write-Host "`n> ترمینالِ داخلِ برنامه"
  $termServer = Join-Path $temp 'term-server'
  New-Item -ItemType Directory -Path (Join-Path $termServer 'data') -Force | Out-Null
  $logPath = Get-PanelLogPath -ServerDir $termServer
  Check 'مسیرِ ترمینال کنارِ داده است' ($logPath -eq (Join-Path (Join-Path $termServer 'data') 'panel.log'))

  Check 'وقتی چیزی نیست، پیامِ راهنما می‌دهد' ((Get-PanelLog -ServerDir $termServer).Contains('روشن کردنِ سرور'))

  Write-PanelLogMark -ServerDir $termServer -Message 'روشن کردنِ سرور'
  [System.IO.File]::AppendAllText($logPath, "خط اول`r`nخط دوم`r`n", (New-Object System.Text.UTF8Encoding($false)))
  $shown = Get-PanelLog -ServerDir $termServer
  Check 'خط‌های ترمینال خوانده می‌شود' ($shown.Contains('خط دوم'))
  Check 'خطِ جداکننده نوشته می‌شود' ($shown.Contains('روشن کردنِ سرور'))

  [System.IO.File]::AppendAllText($logPath, (1..500 | ForEach-Object { "line $_`r`n" }) -join '', (New-Object System.Text.UTF8Encoding($false)))
  $tail = Get-PanelLog -ServerDir $termServer -Lines 50
  Check 'فقط دنبالهٔ ترمینال برمی‌گردد' ((($tail -split "`r?`n").Count -le 51) -and $tail.Contains('line 500')) "خط‌ها=$(($tail -split "`r?`n").Count)"

  $cleared = Clear-PanelLog -ServerDir $termServer
  Check 'پاک کردنِ ترمینال کار می‌کند' ($cleared -and ([System.IO.File]::ReadAllText($logPath) -eq ''))

  Write-Host "`n> نصب‌کننده"
  Check 'پوشهٔ برنامه شناخته می‌شود' (Test-ProgramFolder -Root $oldRoot)
  Check 'پوشهٔ بی‌ربط، پوشهٔ برنامه نیست' (-not (Test-ProgramFolder -Root $temp))

  $freshTarget = Join-Path $temp 'install-here'
  $checkFresh = Test-InstallTarget -Target $freshTarget
  Check 'پوشهٔ تازه برای نصب قبول است' ($checkFresh.ok -and -not $checkFresh.upgrade)

  $checkUpgrade = Test-InstallTarget -Target $oldRoot
  Check 'روی نصبِ قبلی، حالتِ به‌روزرسانی می‌شود' ($checkUpgrade.ok -and $checkUpgrade.upgrade)

  $checkEmpty = Test-InstallTarget -Target '   '
  Check 'مسیرِ خالی رد می‌شود' (-not $checkEmpty.ok)

  $someFile = Join-Path $temp 'not-a-folder.txt'
  Set-Content -LiteralPath $someFile -Value 'x'
  Check 'فایل به‌جای پوشه رد می‌شود' (-not (Test-InstallTarget -Target $someFile).ok)

  Check 'Node.js پیدا می‌شود' ($null -ne (Find-NodeExe))

  # --------------------------------------------------------------- نمونه‌کد --
  Write-Host "`n> نمونه‌کدها"
  foreach ($kind in (Get-SnippetKinds)) {
    $snippet = Get-CodeSnippet -Kind $kind -BaseUrl 'http://192.168.1.20:4700'
    Check "نمونهٔ «$kind» ساخته می‌شود" ($snippet.Contains('http://192.168.1.20:4700') -and $snippet.Length -gt 80)
  }

  # ------------------------------------------------- گفت‌وگو با سرورِ واقعی --
  Write-Host "`n> گفت‌وگو با سرورِ واقعی"
  $serverDir = Join-Path (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) '../server'
  $serverDir = [System.IO.Path]::GetFullPath($serverDir)
  $entry = Join-Path $serverDir 'src/index.js'

  if (Test-Path -LiteralPath $entry) {
    $port = 4795
    $dataDir = Join-Path $temp 'srv-data'
    $env:HLP_PORT = "$port"
    $env:HLP_HOST = '127.0.0.1'
    $env:HLP_DATA_DIR = $dataDir
    $env:HLP_SITES_ROOT = (Join-Path $temp 'srv-sites')
    $env:HLP_TUNNEL = '0'
    $env:HLP_AI_ENABLED = '0'
    $env:HLP_SITESYNC_PORT = '4794'

    $node = Start-Process -FilePath 'node' -ArgumentList @('--disable-warning=ExperimentalWarning', 'src/index.js') `
      -WorkingDirectory $serverDir -PassThru -RedirectStandardOutput (Join-Path $temp 'out.log') -RedirectStandardError (Join-Path $temp 'err.log')

    $up = $null
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Milliseconds 400
      $up = Get-ServerHealth -Port $port
      if ($up) { break }
    }
    Check 'سرور پیدا شد' ($null -ne $up)
    if ($up) {
      Check 'نسخه از /health می‌آید' ($up.version -eq (Get-LocalVersion -ServerDir $serverDir)) "health=$($up.version)"

      $cfg = Get-AppConfig -Port $port
      Check 'شناسنامهٔ ورودِ برنامه‌ها خوانده می‌شود' ($null -ne $cfg -and $cfg.login.codeLength -eq 6)

      $send = Invoke-Json -Url "http://127.0.0.1:$port/api/app/auth/request-code" -Method 'POST' -Body @{ phone = '09121234567' }
      Check 'درخواستِ کد از برنامه کار می‌کند' ($send.ok -and $send.data.ok -eq $true) "$($send.error)"
      Check 'پیامِ فارسیِ سرور سالم می‌رسد' ($send.data.message -and $send.data.message.Contains('کد'))  $send.data.message

      $bad = Invoke-Json -Url "http://127.0.0.1:$port/api/app/auth/request-code" -Method 'POST' -Body @{ phone = '12' }
      Check 'خطای ۴۰۰ هم با متنِ فارسی خوانده می‌شود' ((-not $bad.ok) -and $bad.status -eq 400 -and $bad.data.error -eq 'bad_phone') "status=$($bad.status)"

      Write-Host "`n> مدیریتِ برنامه‌ها از داخلِ برنامه (کلیدِ محلی)"
      $key = Get-LocalAdminKey -ServerDir $serverDir -DataDir $dataDir
      Check 'کلیدِ محلی خوانده می‌شود' ($key -and $key.Length -ge 32)

      $list = Invoke-AdminJson -ServerDir $serverDir -Path '/api/app-admin/clients' -Port $port -DataDir $dataDir
      Check 'فهرستِ برنامه‌ها گرفته می‌شود' ($list.ok -and $null -ne $list.data.clients) "$($list.error)"

      $created = Invoke-AdminJson -ServerDir $serverDir -Path '/api/app-admin/clients' -Method 'POST' `
        -Body @{ name = 'فروشگاه من'; slug = 'my-shop' } -Port $port -DataDir $dataDir
      Check 'برنامهٔ تازه از داخلِ برنامه ساخته می‌شود' ($created.ok -and $created.data.client.slug -eq 'my-shop') "$($created.error)"
      Check 'کلیدِ اختصاصی برمی‌گردد' ($created.data.client.apiKey -like 'hlp_*')

      $saved = Invoke-AdminJson -ServerDir $serverDir -Path '/api/app-admin/clients/my-shop' -Method 'PUT' `
        -Body @{ smsText = 'کد فروشگاه: {code}'; requireKey = $true } -Port $port -DataDir $dataDir
      Check 'تنظیماتِ برنامه ذخیره می‌شود' ($saved.ok -and $saved.data.client.requireKey -eq $true)

      $rotated = Invoke-AdminJson -ServerDir $serverDir -Path '/api/app-admin/clients/my-shop/key' -Method 'POST' -Port $port -DataDir $dataDir
      Check 'کلیدِ تازه ساخته می‌شود' ($rotated.ok -and $rotated.data.client.apiKey -ne $created.data.client.apiKey)

      $gone = Invoke-AdminJson -ServerDir $serverDir -Path '/api/app-admin/clients/my-shop' -Method 'DELETE' -Port $port -DataDir $dataDir
      Check 'برنامه حذف می‌شود' ($gone.ok)

      $log = Get-PanelLog -ServerDir $serverDir
      Check 'خواندنِ لاگ برنامه را نمی‌خواباند' ($log.Length -gt 0)
    }
    try { Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue } catch { }
  } else {
    Write-Host '  (سرور پیدا نشد — این بخش رد شد)'
  }
} finally {
  try { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}

Write-Host ""
if ($script:Failed -eq 0) {
  Write-Host "همه درست: $($script:Passed) آزمون"
  exit 0
} else {
  Write-Host "$($script:Passed) درست، $($script:Failed) خراب"
  exit 1
}
