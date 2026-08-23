# ---------------------------------------------------------------------------
#  نصب‌کنندهٔ «برنامهٔ سرور خانگی»
#
#  مثلِ نصب‌کنندهٔ هر برنامهٔ ویندوزیِ دیگر: خوش‌آمد ← انتخابِ پوشه ← نصب ← پایان.
#  پنجرهٔ سیاه هم ندارد؛ خروجیِ نصب داخلِ خودِ همین پنجره دیده می‌شود.
# ---------------------------------------------------------------------------

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

try {
  . (Join-Path $PSScriptRoot 'lib.ps1')
} catch {
  [System.Windows.Forms.MessageBox]::Show(
    "فایلِ lib.ps1 بالا نیامد:`r`n`r`n$($_.Exception.Message)", 'نصبِ برنامهٔ سرور خانگی') | Out-Null
  exit 1
}

$script:SourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:Version = Get-LocalVersion -ServerDir (Join-Path (Join-Path $script:SourceRoot 'homelab-panel') 'server')
$script:Target = Join-Path $env:USERPROFILE 'PumpServer'
$script:Busy = $false
$script:Done = $false

$Ink   = [System.Drawing.Color]::FromArgb(18, 23, 43)
$Muted = [System.Drawing.Color]::FromArgb(105, 113, 140)
$Brand = [System.Drawing.Color]::FromArgb(43, 87, 214)
$Bad   = [System.Drawing.Color]::FromArgb(200, 40, 35)
$Face  = New-Object System.Drawing.Font('Tahoma', 9.75)
$Bold  = New-Object System.Drawing.Font('Tahoma', 11, [System.Drawing.FontStyle]::Bold)
$Small = New-Object System.Drawing.Font('Tahoma', 8.5)
$Mono  = New-Object System.Drawing.Font('Consolas', 9)

function New-Text {
  param([string]$Text, [int]$X, [int]$Y, [int]$Width = 400, [int]$Height = 24, $Color = $null, $Font = $null)
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point($X, $Y)
  $label.Size = New-Object System.Drawing.Size($Width, $Height)
  $label.ForeColor = if ($Color) { $Color } else { $Ink }
  $label.Font = if ($Font) { $Font } else { $Face }
  return $label
}

function New-Btn {
  param([string]$Text, [int]$X, [int]$Y, [int]$Width = 120, [bool]$Primary = $false)
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.Size = New-Object System.Drawing.Size($Width, 32)
  $button.Font = $Face
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.FlatAppearance.BorderSize = 1
  if ($Primary) {
    $button.BackColor = $Brand
    $button.ForeColor = [System.Drawing.Color]::White
    $button.FlatAppearance.BorderColor = $Brand
  } else {
    $button.BackColor = [System.Drawing.Color]::FromArgb(238, 242, 253)
    $button.ForeColor = $Brand
    $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(214, 223, 245)
  }
  return $button
}

# ------------------------------- پنجره -------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "نصبِ برنامهٔ سرور خانگی — نسخهٔ $($script:Version)"
$form.Size = New-Object System.Drawing.Size(680, 500)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true
$form.Font = $Face
$form.BackColor = [System.Drawing.Color]::White

$body = New-Object System.Windows.Forms.Panel
$body.Dock = [System.Windows.Forms.DockStyle]::Fill
$form.Controls.Add($body)

$footer = New-Object System.Windows.Forms.Panel
$footer.Dock = [System.Windows.Forms.DockStyle]::Bottom
$footer.Height = 58
$footer.BackColor = [System.Drawing.Color]::FromArgb(243, 246, 252)
$form.Controls.Add($footer)

$btnBack = New-Btn -Text 'قبلی' -X 300 -Y 13
$btnNext = New-Btn -Text 'بعدی' -X 430 -Y 13 -Width 130 -Primary $true
$btnClose = New-Btn -Text 'بستن' -X 20 -Y 13 -Width 100
$footer.Controls.AddRange(@($btnBack, $btnNext, $btnClose))

# ─────────────────────────── صفحهٔ ۱: خوش‌آمد ───────────────────────────────
$page1 = New-Object System.Windows.Forms.Panel
$page1.Dock = [System.Windows.Forms.DockStyle]::Fill
$page1.Controls.Add((New-Text -Text 'برنامهٔ سرور خانگی' -X 30 -Y 34 -Width 500 -Height 32 -Font $Bold))
$page1.Controls.Add((New-Text -Text "نسخهٔ $($script:Version)" -X 30 -Y 68 -Width 300 -Color $Muted))

$welcome = New-Object System.Windows.Forms.Label
$welcome.Location = New-Object System.Drawing.Point(30, 110)
$welcome.Size = New-Object System.Drawing.Size(600, 250)
$welcome.Font = $Face
$welcome.ForeColor = $Ink
$welcome.Text = @'
این برنامه سرورِ خانگیِ شما را روی همین کامپیوتر نصب و اداره می‌کند:

    •  روشن و خاموش کردنِ سرور با یک دکمه — بدونِ هیچ پنجرهٔ سیاهی
    •  ترمینالِ سرور داخلِ خودِ برنامه دیده می‌شود
    •  آدرسی که باید در اپِ اندروید / ویندوز / سایت بگذارید
    •  ورودِ کاربران با شمارهٔ موبایل یا ایمیل و کدِ شش‌رقمی
    •  تنظیماتِ پیامک و جی‌میل، بدونِ دست زدن به فایل
    •  به‌روزرسانی از داخلِ خودِ برنامه

پیش‌نیاز: Node.js نسخهٔ ۲۲ به بالا. اگر نصب نباشد، همین‌جا خبرتان می‌کنیم.

برای ادامه «بعدی» را بزنید.
'@
$page1.Controls.Add($welcome)

# ────────────────────────── صفحهٔ ۲: انتخابِ پوشه ───────────────────────────
$page2 = New-Object System.Windows.Forms.Panel
$page2.Dock = [System.Windows.Forms.DockStyle]::Fill
$page2.Visible = $false

$page2.Controls.Add((New-Text -Text 'کجا نصب شود؟' -X 30 -Y 26 -Width 400 -Height 28 -Font $Bold))
$page2.Controls.Add((New-Text -Text 'برنامه در این پوشه نصب می‌شود. اگر جای دیگری می‌خواهید، «انتخابِ پوشه» را بزنید.' -X 30 -Y 58 -Width 600 -Color $Muted))

$script:PathBox = New-Object System.Windows.Forms.TextBox
$script:PathBox.Location = New-Object System.Drawing.Point(30, 92)
$script:PathBox.Size = New-Object System.Drawing.Size(470, 26)
$script:PathBox.Font = $Face
$script:PathBox.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$script:PathBox.Text = $script:Target
$page2.Controls.Add($script:PathBox)

$btnBrowse = New-Btn -Text 'انتخابِ پوشه' -X 510 -Y 90 -Width 120
$page2.Controls.Add($btnBrowse)

$script:PathNote = New-Text -Text '' -X 30 -Y 126 -Width 600 -Height 40 -Color $Muted -Font $Small
$page2.Controls.Add($script:PathNote)

$script:OptShortcut = New-Object System.Windows.Forms.CheckBox
$script:OptShortcut.Text = 'میان‌بر روی دسکتاپ بساز'
$script:OptShortcut.Location = New-Object System.Drawing.Point(30, 176)
$script:OptShortcut.Size = New-Object System.Drawing.Size(300, 24)
$script:OptShortcut.Checked = $true
$script:OptShortcut.Font = $Face

$script:OptMenu = New-Object System.Windows.Forms.CheckBox
$script:OptMenu.Text = 'در منوی استارت هم بگذار'
$script:OptMenu.Location = New-Object System.Drawing.Point(30, 206)
$script:OptMenu.Size = New-Object System.Drawing.Size(300, 24)
$script:OptMenu.Checked = $true
$script:OptMenu.Font = $Face

$script:OptNpm = New-Object System.Windows.Forms.CheckBox
$script:OptNpm.Text = 'وابستگی‌ها را هم نصب کن (اینترنت لازم دارد — بارِ اول)'
$script:OptNpm.Location = New-Object System.Drawing.Point(30, 236)
$script:OptNpm.Size = New-Object System.Drawing.Size(450, 24)
$script:OptNpm.Checked = $true
$script:OptNpm.Font = $Face

$script:OptRun = New-Object System.Windows.Forms.CheckBox
$script:OptRun.Text = 'بعد از نصب، برنامه را باز کن'
$script:OptRun.Location = New-Object System.Drawing.Point(30, 266)
$script:OptRun.Size = New-Object System.Drawing.Size(300, 24)
$script:OptRun.Checked = $true
$script:OptRun.Font = $Face

$page2.Controls.AddRange(@($script:OptShortcut, $script:OptMenu, $script:OptNpm, $script:OptRun))

$script:NodeNote = New-Text -Text '' -X 30 -Y 304 -Width 480 -Height 44 -Color $Bad -Font $Small
$script:BtnNode = New-Btn -Text 'دانلودِ Node.js' -X 510 -Y 306 -Width 120
$script:BtnNode.Visible = $false
$page2.Controls.AddRange(@($script:NodeNote, $script:BtnNode))

# ─────────────────────────── صفحهٔ ۳: نصب ──────────────────────────────────
$page3 = New-Object System.Windows.Forms.Panel
$page3.Dock = [System.Windows.Forms.DockStyle]::Fill
$page3.Visible = $false

$script:StepLabel = New-Text -Text 'آمادهٔ نصب…' -X 30 -Y 24 -Width 560 -Height 26 -Font $Bold
$page3.Controls.Add($script:StepLabel)

$script:Bar = New-Object System.Windows.Forms.ProgressBar
$script:Bar.Location = New-Object System.Drawing.Point(30, 58)
$script:Bar.Size = New-Object System.Drawing.Size(600, 16)
$script:Bar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
$page3.Controls.Add($script:Bar)

$script:Console = New-Object System.Windows.Forms.TextBox
$script:Console.Location = New-Object System.Drawing.Point(30, 88)
$script:Console.Size = New-Object System.Drawing.Size(600, 270)
$script:Console.Multiline = $true
$script:Console.ReadOnly = $true
$script:Console.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$script:Console.BackColor = [System.Drawing.Color]::FromArgb(15, 20, 36)
$script:Console.ForeColor = [System.Drawing.Color]::FromArgb(200, 230, 210)
$script:Console.Font = $Mono
$script:Console.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$page3.Controls.Add($script:Console)

$body.Controls.AddRange(@($page1, $page2, $page3))

# ---------------------------------------------------------------------------
#  حرکت بینِ صفحه‌ها
# ---------------------------------------------------------------------------
$script:Page = 1

function Show-Page {
  param([int]$Number)
  $script:Page = $Number
  $page1.Visible = ($Number -eq 1)
  $page2.Visible = ($Number -eq 2)
  $page3.Visible = ($Number -eq 3)
  $btnBack.Enabled = ($Number -eq 2)
  switch ($Number) {
    1 { $btnNext.Text = 'بعدی'; $btnNext.Enabled = $true }
    2 { $btnNext.Text = 'نصب کن'; $btnNext.Enabled = $true; Update-PathNote }
    3 { $btnNext.Text = 'پایان'; $btnNext.Enabled = $script:Done }
  }
}

function Update-PathNote {
  $check = Test-InstallTarget -Target $script:PathBox.Text
  $script:PathNote.Text = $check.message
  $script:PathNote.ForeColor = if ($check.ok) { $Muted } else { $Bad }
  $btnNext.Enabled = [bool]$check.ok
}

function Write-Console {
  param([string]$Message)
  $script:Console.AppendText($Message + "`r`n")
  $script:Console.SelectionStart = $script:Console.TextLength
  $script:Console.ScrollToCaret()
  [System.Windows.Forms.Application]::DoEvents()
}

$script:PathBox.Add_TextChanged({ Update-PathNote })

$btnBrowse.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'پوشه‌ای که برنامه در آن نصب شود'
  $dialog.ShowNewFolderButton = $true
  # از «این رایانه» شروع شود، نه از پوشهٔ دانلود
  try {
    $dialog.RootFolder = [System.Environment+SpecialFolder]::MyComputer
    $current = $script:PathBox.Text.Trim()
    $parent = if ($current) { Split-Path -Parent $current } else { '' }
    if ($parent -and (Test-Path -LiteralPath $parent)) { $dialog.SelectedPath = $parent }
    elseif (Test-Path -LiteralPath $env:USERPROFILE) { $dialog.SelectedPath = $env:USERPROFILE }
  } catch { }
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $chosen = $dialog.SelectedPath
    # اگر پوشهٔ برنامه را انتخاب نکرده، یک پوشهٔ اختصاصی داخلش می‌سازیم
    if (-not (Test-ProgramFolder -Root $chosen)) {
      if ((Split-Path -Leaf $chosen) -ne 'PumpServer') { $chosen = Join-Path $chosen 'PumpServer' }
    }
    $script:PathBox.Text = $chosen
  }
})

$script:BtnNode.Add_Click({ Start-Process 'https://nodejs.org/fa/download' })

$btnBack.Add_Click({ if (-not $script:Busy) { Show-Page -Number 1 } })

$btnClose.Add_Click({
  if ($script:Busy) {
    [System.Windows.Forms.MessageBox]::Show('نصب در حالِ انجام است؛ چند لحظه صبر کنید.', 'نصب') | Out-Null
    return
  }
  $form.Close()
})

# ---------------------------------------------------------------------------
#  خودِ نصب
# ---------------------------------------------------------------------------
function Start-Install {
  $check = Test-InstallTarget -Target $script:PathBox.Text
  if (-not $check.ok) {
    [System.Windows.Forms.MessageBox]::Show($check.message, 'نصب') | Out-Null
    return
  }
  $target = $check.full
  $script:Busy = $true
  $btnNext.Enabled = $false
  $btnBack.Enabled = $false
  Show-Page -Number 3

  try {
    Write-Console "نصب در: $target"
    Write-Console ''

    $script:StepLabel.Text = 'بستنِ نسخهٔ در حالِ اجرا…'
    [System.Windows.Forms.Application]::DoEvents()
    $closed = Stop-RunningApp
    if ($closed -gt 0) {
      Write-Console "$closed نسخهٔ در حالِ اجرا بسته شد (وگرنه فایل‌ها قفل می‌ماندند)."
      Start-Sleep -Milliseconds 800
    }

    $script:StepLabel.Text = 'کپیِ فایل‌ها…'
    $script:Bar.Value = 10
    [System.Windows.Forms.Application]::DoEvents()

    if (-not (Test-Path -LiteralPath $target)) {
      New-Item -ItemType Directory -Path $target -Force | Out-Null
    }
    $copied = Copy-UpdateFiles -FromDir $script:SourceRoot -ToDir $target
    Write-Console "$($copied.copied) فایل کپی شد."
    if ($check.upgrade) { Write-Console 'نسخهٔ قبلی به‌روزرسانی شد — دادهٔ شما و فایل .env دست نخورد.' }
    $script:Bar.Value = 40

    $serverDir = Join-Path (Join-Path $target 'homelab-panel') 'server'

    if ($script:OptNpm.Checked) {
      $node = Find-NodeExe
      if (-not $node) {
        Write-Console ''
        Write-Console 'Node.js پیدا نشد — نصبِ وابستگی‌ها رد شد.'
        Write-Console 'اول Node.js را از nodejs.org نصب کنید؛ بعد برنامه را باز کنید،'
        Write-Console 'با اولین «روشن کردنِ سرور» خودش وابستگی‌ها را می‌گیرد.'
      } else {
        $script:StepLabel.Text = 'نصبِ وابستگی‌ها (npm install) — کمی طول می‌کشد…'
        Write-Console ''
        Write-Console 'npm install --omit=dev'
        [System.Windows.Forms.Application]::DoEvents()

        $dataDir = Join-Path $serverDir 'data'
        if (-not (Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
        $npmLog = Join-Path $dataDir 'install.log'
        if (Test-Path -LiteralPath $npmLog) { Remove-Item -LiteralPath $npmLog -Force -ErrorAction SilentlyContinue }

        $arguments = "/c npm install --omit=dev --no-audit --no-fund > ""$npmLog"" 2>&1"
        $process = Start-Process -FilePath 'cmd.exe' -ArgumentList $arguments `
          -WorkingDirectory $serverDir -WindowStyle Hidden -PassThru

        $shown = 0
        while (-not $process.HasExited) {
          Start-Sleep -Milliseconds 400
          $shown = Show-NewLogLines -Path $npmLog -From $shown
          if ($script:Bar.Value -lt 85) { $script:Bar.Value = $script:Bar.Value + 1 }
          [System.Windows.Forms.Application]::DoEvents()
        }
        $shown = Show-NewLogLines -Path $npmLog -From $shown
        if ($process.ExitCode -eq 0) { Write-Console 'وابستگی‌ها نصب شد.' }
        else { Write-Console "هشدار: npm با کدِ $($process.ExitCode) تمام شد. (اینترنت وصل است؟)" }
      }
    }

    $script:Bar.Value = 90
    $script:StepLabel.Text = 'ساختنِ میان‌برها…'
    [System.Windows.Forms.Application]::DoEvents()

    if ($script:OptShortcut.Checked) {
      $desktopPath = [Environment]::GetFolderPath('Desktop')
      $linkPath = Join-Path $desktopPath 'برنامهٔ سرور خانگی.lnk'
      $link = New-ProgramShortcut -InstallRoot $target -LinkPath $linkPath
      if ($link -and (Test-Path -LiteralPath $linkPath)) {
        Write-Console "✔ میان‌برِ دسکتاپ ساخته شد: $linkPath"
      } else {
        # اگر نشد، دستِ‌کم یک میان‌برِ ساده بسازیم تا کاربر بی‌راه نماند
        Write-Console 'میان‌برِ دسکتاپ ساخته نشد — به‌جایش از این فایل باز کنید:'
        Write-Console (Join-Path $target 'homelab-panel\desktop\برنامه-سرور.bat')
      }
    }
    if ($script:OptMenu.Checked) {
      $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'برنامهٔ سرور خانگی.lnk'
      $link = New-ProgramShortcut -InstallRoot $target -LinkPath $menu
      if ($link) { Write-Console "منوی استارت: $link" }
    }

    $script:Bar.Value = 100
    $script:StepLabel.Text = 'نصب تمام شد ✔'
    Write-Console ''
    Write-Console '──────────────────────────────────────────'
    Write-Console 'تمام شد. برنامه را از میان‌برِ روی دسکتاپ باز کنید.'
    $script:Done = $true
    $script:InstalledAt = $target
  } catch {
    $script:StepLabel.Text = 'نصب ناتمام ماند'
    Write-Console ''
    Write-Console "خطا: $($_.Exception.Message)"
    $script:Done = $true
  } finally {
    $script:Busy = $false
    $btnNext.Text = 'پایان'
    $btnNext.Enabled = $true
  }
}

<#
  .SYNOPSIS
  خط‌های تازهٔ فایلِ لاگ را در کنسولِ نصب نشان می‌دهد و می‌گوید تا کجا خوانده شد.
#>
function Show-NewLogLines {
  param([string]$Path, [int]$From)

  if (-not (Test-Path -LiteralPath $Path)) { return $From }
  try {
    $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close()
    $stream.Close()
    if ($text.Length -le $From) { return $From }
    $fresh = $text.Substring($From).TrimEnd()
    if ($fresh) {
      foreach ($line in ($fresh -split "`r?`n")) {
        if ($line.Trim()) { Write-Console $line }
      }
    }
    return $text.Length
  } catch {
    return $From
  }
}

$btnNext.Add_Click({
  if ($script:Page -eq 1) { Show-Page -Number 2; return }
  if ($script:Page -eq 2) { Start-Install; return }

  # صفحهٔ ۳ — پایان
  if ($script:OptRun.Checked -and $script:InstalledAt) {
    $launcher = Join-Path $script:InstalledAt 'homelab-panel\desktop\launch.vbs'
    if (Test-Path -LiteralPath $launcher) {
      Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList """$launcher"""
    }
  }
  $form.Close()
})

$form.Add_Shown({
  # پنجرهٔ سیاهِ نصب عمداً پنهان نمی‌شود: اگر چیزی خراب شد، باید دیده شود
  Show-WindowForReal -Form $form
  Show-Page -Number 1
  $nodeFound = $true
  try { $nodeFound = [bool](Find-NodeExe) } catch { $nodeFound = $false }
  if (-not $nodeFound) {
    $script:NodeNote.Text = 'Node.js روی این کامپیوتر پیدا نشد. برنامه نصب می‌شود، ولی تا Node.js نباشد سرور بالا نمی‌آید.'
    $script:BtnNode.Visible = $true
  }
  if (-not (Test-ProgramFolder -Root $script:SourceRoot)) {
    [System.Windows.Forms.MessageBox]::Show(
      "فایل‌های برنامه کنارِ این نصب‌کننده پیدا نشد.`r`n`r`nزیپ را کامل باز کنید و بعد نصب‌کننده را از داخلِ همان پوشه اجرا کنید.",
      'نصب') | Out-Null
    $btnNext.Enabled = $false
  }
})

$openedAt = Get-Date
try {
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
  $form.ShowInTaskbar = $true
  $form.TopMost = $true
  $form.Show()
  Show-WindowForReal -Form $form
  $form.TopMost = $false
  [System.Windows.Forms.Application]::Run($form)

  if (((Get-Date) - $openedAt).TotalSeconds -lt 1.5) {
    [System.Windows.Forms.MessageBox]::Show(
      "پنجرهٔ نصب باز شد ولی بی‌درنگ بسته شد.`r`n`r`nفایلِ «اگر-باز-نشد.bat» را اجرا کنید تا علتش دیده شود.",
      'نصبِ برنامهٔ سرور خانگی') | Out-Null
  }
} catch {
  $logPath = Join-Path ([System.IO.Path]::GetTempPath()) 'homelab-install-error.log'
  try {
    [System.IO.File]::AppendAllText($logPath, "$(Get-Date)`r`n$($_.Exception.Message)`r`n$($_.ScriptStackTrace)`r`n`r`n")
  } catch { }
  [System.Windows.Forms.MessageBox]::Show(
    "نصب‌کننده بسته شد:`r`n`r`n$($_.Exception.Message)`r`n`r`nگزارش: $logPath",
    'نصبِ برنامهٔ سرور خانگی') | Out-Null
}
