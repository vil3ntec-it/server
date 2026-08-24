# ---------------------------------------------------------------------------
#  حذفِ برنامهٔ سرور خانگی
#
#  دو چیز کاملاً جدا هستند و کاربر باید بتواند جداگانه تصمیم بگیرد:
#      ۱) فایل‌های خودِ برنامه   (کد، اسکریپت‌ها، فونت)
#      ۲) دادهٔ سرور            (دیتابیس، کاربران، تنظیمات، سایت‌ها)
#
#  پیش‌فرض: دادهٔ شما پاک نمی‌شود. برای پاک کردنش باید صریحاً تیک بزنید و
#  یک بار دیگر هم تأیید کنید.
# ---------------------------------------------------------------------------

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

try {
  . (Join-Path $PSScriptRoot 'lib.ps1')
} catch {
  [System.Windows.Forms.MessageBox]::Show("lib.ps1 بالا نیامد:`r`n$($_.Exception.Message)", 'حذفِ برنامه') | Out-Null
  exit 1
}

$script:ServerDir   = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\server'))
$script:ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:DataDir     = Get-DataDir -ServerDir $script:ServerDir

$Ink   = [System.Drawing.Color]::FromArgb(18, 23, 43)
$Muted = [System.Drawing.Color]::FromArgb(105, 113, 140)
$Bad   = [System.Drawing.Color]::FromArgb(200, 40, 35)
$Face  = New-Object System.Drawing.Font('Tahoma', 9.75)
$Bold  = New-Object System.Drawing.Font('Tahoma', 11, [System.Drawing.FontStyle]::Bold)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'حذفِ برنامهٔ سرور خانگی'
$form.Size = New-Object System.Drawing.Size(620, 430)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true
$form.Font = $Face
$form.BackColor = [System.Drawing.Color]::White
try {
  $iconPath = Join-Path $PSScriptRoot 'server.ico'
  if (Test-Path -LiteralPath $iconPath) { $form.Icon = New-Object System.Drawing.Icon($iconPath) }
} catch { }

$title = New-Object System.Windows.Forms.Label
$title.Text = 'حذفِ برنامه'
$title.Font = $Bold
$title.ForeColor = $Ink
$title.Location = New-Object System.Drawing.Point(24, 22)
$title.Size = New-Object System.Drawing.Size(400, 28)

$info = New-Object System.Windows.Forms.Label
$info.Location = New-Object System.Drawing.Point(24, 56)
$info.Size = New-Object System.Drawing.Size(550, 74)
$info.ForeColor = $Muted
$info.Text = "فایل‌های برنامه از این پوشه پاک می‌شوند:`r`n$($script:ProjectRoot)`r`n`r`nدادهٔ شما (دیتابیس، کاربران، تنظیمات) این‌جاست:`r`n$($script:DataDir)"

$keepData = New-Object System.Windows.Forms.RadioButton
$keepData.Text = 'دادهٔ سرور بماند  (پیشنهاد می‌شود)'
$keepData.Location = New-Object System.Drawing.Point(24, 146)
$keepData.Size = New-Object System.Drawing.Size(520, 26)
$keepData.Checked = $true

$dropData = New-Object System.Windows.Forms.RadioButton
$dropData.Text = 'دادهٔ سرور هم پاک شود  (برگشت‌ناپذیر)'
$dropData.Location = New-Object System.Drawing.Point(24, 176)
$dropData.Size = New-Object System.Drawing.Size(520, 26)
$dropData.ForeColor = $Bad

$out = New-Object System.Windows.Forms.TextBox
$out.Location = New-Object System.Drawing.Point(24, 214)
$out.Size = New-Object System.Drawing.Size(552, 120)
$out.Multiline = $true
$out.ReadOnly = $true
$out.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$out.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 255)

$btnRemove = New-Object System.Windows.Forms.Button
$btnRemove.Text = 'حذف کن'
$btnRemove.Location = New-Object System.Drawing.Point(430, 348)
$btnRemove.Size = New-Object System.Drawing.Size(146, 34)
$btnRemove.BackColor = [System.Drawing.Color]::FromArgb(200, 40, 35)
$btnRemove.ForeColor = [System.Drawing.Color]::White
$btnRemove.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = 'بی‌خیال'
$btnClose.Location = New-Object System.Drawing.Point(24, 348)
$btnClose.Size = New-Object System.Drawing.Size(120, 34)
$btnClose.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$form.Controls.AddRange(@($title, $info, $keepData, $dropData, $out, $btnRemove, $btnClose))

function Write-Line {
  param([string]$Text)
  $out.AppendText($Text + "`r`n")
  [System.Windows.Forms.Application]::DoEvents()
}

$btnClose.Add_Click({ $form.Close() })

$btnRemove.Add_Click({
  $alsoData = $dropData.Checked
  $question = if ($alsoData) {
    "مطمئنید؟`r`n`r`nهمهٔ دادهٔ سرور — دیتابیس، کاربران، تنظیمات — برای همیشه پاک می‌شود و برگشتی ندارد."
  } else {
    "برنامه حذف شود؟`r`n`r`nدادهٔ شما سرِ جایش می‌ماند."
  }
  if ([System.Windows.Forms.MessageBox]::Show($question, 'حذفِ برنامه',
      [System.Windows.Forms.MessageBoxButtons]::YesNo) -ne [System.Windows.Forms.DialogResult]::Yes) { return }

  if ($alsoData) {
    if ([System.Windows.Forms.MessageBox]::Show("آخرین پرسش: واقعاً دادهٔ سرور پاک شود؟",
        'پاک کردنِ داده', [System.Windows.Forms.MessageBoxButtons]::YesNo) -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  }

  $btnRemove.Enabled = $false
  Write-Line 'بستنِ برنامه و سرور…'
  try { Stop-PanelServer -ServerDir $script:ServerDir | Out-Null } catch { }
  try { Stop-RunningApp | Out-Null } catch { }
  Start-Sleep -Seconds 2

  Write-Line 'برداشتنِ راه‌اندازیِ خودکار…'
  try { Disable-AutoStart | Out-Null } catch { }

  Write-Line 'برداشتنِ میان‌برها…'
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    foreach ($name in @((Get-ShortcutName), 'برنامهٔ سرور خانگی.lnk')) {
      $link = Join-Path $folder $name
      if (Test-Path -LiteralPath $link) {
        try { Remove-Item -LiteralPath $link -Force; Write-Line "  $link" } catch { }
      }
    }
  }

  if (-not $alsoData) {
    Write-Line ''
    Write-Line "دادهٔ شما دست‌نخورده این‌جا می‌ماند:"
    Write-Line "  $($script:DataDir)"
  }

  Write-Line ''
  Write-Line 'پاک کردنِ فایل‌های برنامه…'
  $removed = 0
  $kept = 0
  try {
    foreach ($entry in (Get-ChildItem -LiteralPath $script:ProjectRoot -Force -ErrorAction SilentlyContinue)) {
      $isData = $false
      try { $isData = ($entry.FullName -eq $script:DataDir) -or ($script:DataDir -like ($entry.FullName + '*')) } catch { }
      if ($isData -and -not $alsoData) { $kept++; continue }
      try {
        Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction Stop
        $removed++
      } catch {
        Write-Line "  نشد: $($entry.Name)  ($($_.Exception.Message))"
      }
    }
  } catch {
    Write-Line "خطا: $($_.Exception.Message)"
  }

  Write-Line ''
  Write-Line "$removed مورد پاک شد$(if ($kept -gt 0) { "، $kept مورد نگه داشته شد" })."
  Write-Line 'تمام شد. این پنجره را ببندید.'
  $btnClose.Text = 'بستن'
})

$form.Add_Shown({
  Show-WindowForReal -Form $form
  Write-Line 'یکی از دو گزینهٔ بالا را انتخاب کنید و «حذف کن» را بزنید.'
})

try {
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
  $form.TopMost = $true
  $form.Show()
  Show-WindowForReal -Form $form
  $form.TopMost = $false
  [System.Windows.Forms.Application]::Run($form)
} catch {
  [System.Windows.Forms.MessageBox]::Show("حذف‌کننده باز نشد:`r`n$($_.Exception.Message)", 'حذفِ برنامه') | Out-Null
}
