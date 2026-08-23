# ---------------------------------------------------------------------------
#  برنامهٔ سرور خانگی — پنجرهٔ ویندوزیِ واقعی (WinForms)
#
#  نه مرورگر است نه WebView؛ همان دکمه‌ها و کادرهای خودِ ویندوز.
#  با فایلِ «برنامه-سرور.bat» باز می‌شود.
#
#  کاری که می‌کند:
#    • سرور را روشن/خاموش می‌کند و می‌گوید بالاست یا نه
#    • آدرسی که باید در اپِ اندروید/ویندوز/سایت بگذارید را نشان می‌دهد
#    • ورود با کدِ شش‌رقمی را همین‌جا تست می‌کند
#    • تنظیماتِ پیامک و جی‌میل را در .env می‌نویسد
#    • خودش را از GitHub به‌روز می‌کند
# ---------------------------------------------------------------------------

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# اگر چیزی از پایه خراب شد، به‌جای «هیچ اتفاقی نیفتاد» یک پیام دیده شود
trap {
  try {
    [System.Windows.Forms.MessageBox]::Show(
      "برنامه بالا نیامد:`r`n`r`n$($_.Exception.Message)`r`n`r`n$($_.ScriptStackTrace)",
      'برنامهٔ سرور خانگی') | Out-Null
  } catch { }
  exit 1
}

. (Join-Path $PSScriptRoot 'lib.ps1')

$script:DesktopDir = $PSScriptRoot
$script:ServerDir  = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\server'))
$script:ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:EnvPath    = Join-Path $script:ServerDir '.env'
$script:Version    = Get-LocalVersion -ServerDir $script:ServerDir
$script:Config     = $null
$script:BaseUrl    = 'http://localhost:4700'

function Get-PanelPort {
  $values = Read-EnvFile -Path $script:EnvPath
  if ($values.ContainsKey('HLP_PORT') -and $values['HLP_PORT'] -match '^\d+$') { return [int]$values['HLP_PORT'] }
  return 4700
}
$script:Port = Get-PanelPort

# ---------------------------------------------------------------------------
#  ساختنِ کنترل‌ها — چند کمکیِ کوتاه تا کدِ پایین شلوغ نشود
# ---------------------------------------------------------------------------
$Ink   = [System.Drawing.Color]::FromArgb(18, 23, 43)
$Muted = [System.Drawing.Color]::FromArgb(105, 113, 140)
$Brand = [System.Drawing.Color]::FromArgb(43, 87, 214)
$Good  = [System.Drawing.Color]::FromArgb(15, 130, 80)
$Bad   = [System.Drawing.Color]::FromArgb(200, 40, 35)
$Face  = New-Object System.Drawing.Font('Tahoma', 9.75)
$Bold  = New-Object System.Drawing.Font('Tahoma', 9.75, [System.Drawing.FontStyle]::Bold)
$Mono  = New-Object System.Drawing.Font('Consolas', 9.75)

function New-Label {
  param([string]$Text, [int]$X, [int]$Y, [int]$Width = 300, [int]$Height = 22,
        $Color = $null, $Font = $null)
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point($X, $Y)
  $label.Size = New-Object System.Drawing.Size($Width, $Height)
  $label.ForeColor = if ($Color) { $Color } else { $Ink }
  $label.Font = if ($Font) { $Font } else { $Face }
  return $label
}

function New-Box {
  param([int]$X, [int]$Y, [int]$Width, [string]$Value = '', [bool]$Password = $false)
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point($X, $Y)
  $box.Size = New-Object System.Drawing.Size($Width, 24)
  $box.Font = $Face
  $box.Text = $Value
  if ($Password) { $box.UseSystemPasswordChar = $true }
  return $box
}

function New-Button {
  param([string]$Text, [int]$X, [int]$Y, [int]$Width = 130, [int]$Height = 30, [bool]$Primary = $false)
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.Size = New-Object System.Drawing.Size($Width, $Height)
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

function New-Output {
  param([int]$X, [int]$Y, [int]$Width, [int]$Height, [bool]$Code = $false)
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point($X, $Y)
  $box.Size = New-Object System.Drawing.Size($Width, $Height)
  $box.Multiline = $true
  $box.ReadOnly = $true
  $box.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
  $box.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 255)
  if ($Code) {
    $box.Font = $Mono
    $box.RightToLeft = [System.Windows.Forms.RightToLeft]::No
    $box.WordWrap = $false
    $box.ScrollBars = [System.Windows.Forms.ScrollBars]::Both
  } else {
    $box.Font = $Face
  }
  return $box
}

function Copy-Text {
  param([string]$Text)
  if (-not $Text) { return }
  try { [System.Windows.Forms.Clipboard]::SetText($Text) } catch { }
}

function Show-Busy {
  param([string]$Message)
  $script:StatusLabel.Text = $Message
  $script:StatusLabel.ForeColor = $Muted
  [System.Windows.Forms.Application]::DoEvents()
}

# ---------------------------------------------------------------------------
#  پنجرهٔ اصلی
# ---------------------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "برنامهٔ سرور خانگی — نسخهٔ $($script:Version)"
$form.Size = New-Object System.Drawing.Size(1000, 720)
$form.MinimumSize = New-Object System.Drawing.Size(880, 620)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true
$form.Font = $Face
$form.BackColor = [System.Drawing.Color]::White

# ------------------------------ نوارِ بالا ---------------------------------
$header = New-Object System.Windows.Forms.Panel
$header.Dock = [System.Windows.Forms.DockStyle]::Top
$header.Height = 70
$header.BackColor = [System.Drawing.Color]::FromArgb(243, 246, 252)

$script:StatusLabel = New-Label -Text 'در حالِ بررسی…' -X 16 -Y 12 -Width 420 -Height 24 -Color $Muted -Font $Bold
$script:SubLabel = New-Label -Text '' -X 16 -Y 38 -Width 520 -Height 22 -Color $Muted
$header.Controls.AddRange(@($script:StatusLabel, $script:SubLabel))

$btnStart = New-Button -Text 'روشن کردنِ سرور' -X 470 -Y 20 -Width 150 -Primary $true
$btnStop = New-Button -Text 'خاموش کردن' -X 628 -Y 20 -Width 120
$btnPanel = New-Button -Text 'پنلِ مدیریت' -X 756 -Y 20 -Width 120
$header.Controls.AddRange(@($btnStart, $btnStop, $btnPanel))

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Dock = [System.Windows.Forms.DockStyle]::Fill
$tabs.Font = $Face
$tabs.Padding = New-Object System.Drawing.Point(14, 6)

function New-Tab {
  param([string]$Title)
  $page = New-Object System.Windows.Forms.TabPage
  $page.Text = $Title
  $page.BackColor = [System.Drawing.Color]::White
  $page.Padding = New-Object System.Windows.Forms.Padding(14)
  return $page
}

# ═══════════════════════════ ۱) آدرسِ سرور ═══════════════════════════════
$tabAddress = New-Tab -Title '  آدرسِ سرور  '

$tabAddress.Controls.Add((New-Label -Text 'این آدرس را در برنامهٔ اندروید / ویندوز / سایتِ خودتان بگذارید:' -X 18 -Y 16 -Width 600 -Font $Bold))
$script:AddressBox = New-Output -X 18 -Y 46 -Width 900 -Height 150 -Code $true
$tabAddress.Controls.Add($script:AddressBox)

$btnCopyLan = New-Button -Text 'کپیِ آدرسِ خانگی' -X 18 -Y 206 -Width 160
$btnCopyNet = New-Button -Text 'کپیِ آدرسِ اینترنتی' -X 186 -Y 206 -Width 170
$btnRefreshAddress = New-Button -Text 'بررسیِ دوباره' -X 364 -Y 206 -Width 130
$tabAddress.Controls.AddRange(@($btnCopyLan, $btnCopyNet, $btnRefreshAddress))

$help = New-Output -X 18 -Y 250 -Width 900 -Height 250
$help.Text = @'
کدام آدرس را کجا بگذارم؟

  • برنامه روی همین کامپیوتر است            →  آدرسِ localhost
  • گوشی یا لپ‌تاپِ دیگر، روی همان وای‌فای   →  آدرسِ خانگی (۱۹۲.۱۶۸.…)
  • از بیرونِ خانه، یا سایتی که روی هاست است →  آدرسِ اینترنتی (https)

چهار دلیلِ همیشگیِ «وصل نمی‌شود»:

  ۱) سایتِ شما https است ولی آدرسِ سرور را http گذاشته‌اید — مرورگر جلویش را می‌گیرد.
     راه‌حل: آدرسِ اینترنتی (https) را بگذارید.

  ۲) اپِ اندروید با آدرسِ http: اندروید ۹ به بالا جلویش را می‌گیرد.
     راه‌حل: یا آدرسِ https، یا در AndroidManifest.xml:  android:usesCleartextTraffic="true"

  ۳) فایروالِ ویندوز پورت را بسته — بارِ اول که ویندوز پرسید، «Allow» را بزنید.

  ۴) گوشی روی اینترنتِ همراه است، نه وای‌فایِ خانه — آن‌وقت آدرسِ ۱۹۲.۱۶۸.… کار نمی‌کند.
'@
$tabAddress.Controls.Add($help)

# ═══════════════════════ ۲) تستِ ورود با کد ══════════════════════════════
$tabLogin = New-Tab -Title '  تستِ ورود با کد  '

$tabLogin.Controls.Add((New-Label -Text 'شمارهٔ موبایل یا ایمیل:' -X 18 -Y 20 -Width 160))
$script:TargetBox = New-Box -X 182 -Y 17 -Width 260 -Value ''
$tabLogin.Controls.Add($script:TargetBox)

$tabLogin.Controls.Add((New-Label -Text 'نامِ برنامه:' -X 456 -Y 20 -Width 80))
$script:AppBox = New-Box -X 540 -Y 17 -Width 150 -Value 'main'
$tabLogin.Controls.Add($script:AppBox)

$btnSendCode = New-Button -Text 'فرستادنِ کد' -X 704 -Y 15 -Width 130 -Primary $true
$tabLogin.Controls.Add($btnSendCode)

$tabLogin.Controls.Add((New-Label -Text 'کدِ شش‌رقمی:' -X 18 -Y 62 -Width 160))
$script:CodeBox = New-Box -X 182 -Y 59 -Width 150
$script:CodeBox.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$tabLogin.Controls.Add($script:CodeBox)

$btnVerifyCode = New-Button -Text 'تأییدِ کد' -X 346 -Y 57 -Width 120
$tabLogin.Controls.Add($btnVerifyCode)

$tabLogin.Controls.Add((New-Label -Text 'نتیجه:' -X 18 -Y 100 -Width 100 -Font $Bold))
$script:LoginOut = New-Output -X 18 -Y 126 -Width 900 -Height 380 -Code $true
$script:LoginOut.Text = 'شماره یا ایمیل را بنویسید و «فرستادنِ کد» را بزنید.'
$tabLogin.Controls.Add($script:LoginOut)

# ═══════════════════ ۳) تنظیماتِ پیامک و ایمیل ═══════════════════════════
$tabSettings = New-Tab -Title '  پیامک و ایمیل  '

$groupMail = New-Object System.Windows.Forms.GroupBox
$groupMail.Text = ' ایمیل (جی‌میل یا هر SMTP) '
$groupMail.Location = New-Object System.Drawing.Point(18, 14)
$groupMail.Size = New-Object System.Drawing.Size(440, 250)
$groupMail.Font = $Bold

$groupMail.Controls.Add((New-Label -Text 'سرورِ ایمیل:' -X 16 -Y 32 -Width 110 -Font $Face))
$script:MailHost = New-Box -X 130 -Y 29 -Width 280 -Value 'smtp.gmail.com'
$groupMail.Controls.Add($script:MailHost)

$groupMail.Controls.Add((New-Label -Text 'پورت:' -X 16 -Y 66 -Width 110 -Font $Face))
$script:MailPort = New-Box -X 130 -Y 63 -Width 90 -Value '465'
$groupMail.Controls.Add($script:MailPort)
$groupMail.Controls.Add((New-Label -Text '۴۶۵ یا ۵۸۷' -X 228 -Y 66 -Width 120 -Color $Muted -Font $Face))

$groupMail.Controls.Add((New-Label -Text 'آدرسِ ایمیل:' -X 16 -Y 100 -Width 110 -Font $Face))
$script:MailUser = New-Box -X 130 -Y 97 -Width 280
$script:MailUser.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$groupMail.Controls.Add($script:MailUser)

$groupMail.Controls.Add((New-Label -Text 'رمز:' -X 16 -Y 134 -Width 110 -Font $Face))
$script:MailPass = New-Box -X 130 -Y 131 -Width 280 -Password $true
$groupMail.Controls.Add($script:MailPass)

$mailNote = New-Label -Text 'جی‌میل: رمزِ عادی کار نمی‌کند. باید App Password بسازید (رمزِ ۱۶ حرفیِ گوگل).' -X 16 -Y 170 -Width 400 -Height 60 -Color $Muted -Font $Face
$groupMail.Controls.Add($mailNote)

$groupSms = New-Object System.Windows.Forms.GroupBox
$groupSms.Text = ' پیامک '
$groupSms.Location = New-Object System.Drawing.Point(474, 14)
$groupSms.Size = New-Object System.Drawing.Size(444, 250)
$groupSms.Font = $Bold

$groupSms.Controls.Add((New-Label -Text 'سرویس:' -X 16 -Y 32 -Width 100 -Font $Face))
$script:SmsProvider = New-Object System.Windows.Forms.ComboBox
$script:SmsProvider.Location = New-Object System.Drawing.Point(120, 29)
$script:SmsProvider.Size = New-Object System.Drawing.Size(180, 24)
$script:SmsProvider.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$script:SmsProvider.Font = $Face
[void]$script:SmsProvider.Items.AddRange(@('none', 'kavenegar', 'smsir', 'melipayamak', 'ghasedak', 'webhook'))
$script:SmsProvider.SelectedIndex = 0
$groupSms.Controls.Add($script:SmsProvider)

$groupSms.Controls.Add((New-Label -Text 'کلید (API Key):' -X 16 -Y 66 -Width 100 -Font $Face))
$script:SmsKey = New-Box -X 120 -Y 63 -Width 300 -Password $true
$groupSms.Controls.Add($script:SmsKey)

$groupSms.Controls.Add((New-Label -Text 'شمارهٔ خط:' -X 16 -Y 100 -Width 100 -Font $Face))
$script:SmsSender = New-Box -X 120 -Y 97 -Width 180
$groupSms.Controls.Add($script:SmsSender)

$groupSms.Controls.Add((New-Label -Text 'قالبِ تأیید:' -X 16 -Y 134 -Width 100 -Font $Face))
$script:SmsTemplate = New-Box -X 120 -Y 131 -Width 180
$groupSms.Controls.Add($script:SmsTemplate)

$smsNote = New-Label -Text 'اگر قالبِ تأیید ندارید، خالی بگذارید تا پیامکِ ساده فرستاده شود.' -X 16 -Y 170 -Width 400 -Height 50 -Color $Muted -Font $Face
$groupSms.Controls.Add($smsNote)

$tabSettings.Controls.AddRange(@($groupMail, $groupSms))

$btnSaveSettings = New-Button -Text 'ذخیره و راه‌اندازیِ دوبارهٔ سرور' -X 18 -Y 278 -Width 250 -Primary $true
$btnOpenEnv = New-Button -Text 'باز کردنِ فایل .env' -X 276 -Y 278 -Width 160
$tabSettings.Controls.AddRange(@($btnSaveSettings, $btnOpenEnv))

$script:SettingsOut = New-Output -X 18 -Y 320 -Width 900 -Height 190
$script:SettingsOut.Text = 'تنظیمات در فایل .env کنارِ سرور ذخیره می‌شود. بعد از ذخیره، سرور خودش دوباره بالا می‌آید.'
$tabSettings.Controls.Add($script:SettingsOut)

# ═══════════════════════ ۴) کدِ آمادهٔ برنامه ════════════════════════════
$tabCode = New-Tab -Title '  کدِ برنامه‌ها  '

$tabCode.Controls.Add((New-Label -Text 'برنامه‌ات با چه چیزی نوشته شده؟' -X 18 -Y 18 -Width 240))
$script:SnippetKind = New-Object System.Windows.Forms.ComboBox
$script:SnippetKind.Location = New-Object System.Drawing.Point(262, 15)
$script:SnippetKind.Size = New-Object System.Drawing.Size(220, 24)
$script:SnippetKind.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$script:SnippetKind.Font = $Face
[void]$script:SnippetKind.Items.AddRange((Get-SnippetKinds))
$script:SnippetKind.SelectedIndex = 0
$tabCode.Controls.Add($script:SnippetKind)

$btnCopyCode = New-Button -Text 'کپیِ کد' -X 496 -Y 13 -Width 120 -Primary $true
$tabCode.Controls.Add($btnCopyCode)

$script:SnippetBox = New-Output -X 18 -Y 52 -Width 900 -Height 460 -Code $true
$tabCode.Controls.Add($script:SnippetBox)

# ═══════════════════ ۵) ترمینالِ سرور (داخلِ خودِ برنامه) ══════════════════
#  دیگر هیچ پنجرهٔ سیاهی باز نمی‌شود؛ همان چیزی که آن‌جا می‌دیدید این‌جاست.
$tabLog = New-Tab -Title '  ترمینالِ سرور  '

$btnRefreshLog = New-Button -Text 'تازه کردن' -X 18 -Y 14 -Width 110
$btnClearLog = New-Button -Text 'پاک کردن' -X 136 -Y 14 -Width 110
$btnCopyLog = New-Button -Text 'کپیِ متن' -X 254 -Y 14 -Width 110
$script:AutoLog = New-Object System.Windows.Forms.CheckBox
$script:AutoLog.Text = 'دنبال کردنِ زنده'
$script:AutoLog.Location = New-Object System.Drawing.Point(376, 18)
$script:AutoLog.Size = New-Object System.Drawing.Size(160, 24)
$script:AutoLog.Font = $Face
$script:AutoLog.Checked = $true
$tabLog.Controls.AddRange(@($btnRefreshLog, $btnClearLog, $btnCopyLog, $script:AutoLog))

$tabLog.Controls.Add((New-Label -Text 'اگر پیامک/ایمیل تنظیم نشده باشد، کدِ ورود همین‌جا نوشته می‌شود.' -X 546 -Y 18 -Width 380 -Color $Muted))

$script:LogBox = New-Output -X 18 -Y 50 -Width 900 -Height 460 -Code $true
# ظاهرِ ترمینالِ واقعی
$script:LogBox.BackColor = [System.Drawing.Color]::FromArgb(15, 20, 36)
$script:LogBox.ForeColor = [System.Drawing.Color]::FromArgb(205, 232, 212)
$tabLog.Controls.Add($script:LogBox)

# ═══════════════════════ ۶) به‌روزرسانی ═════════════════════════════════
$tabUpdate = New-Tab -Title '  به‌روزرسانی  '

$tabUpdate.Controls.Add((New-Label -Text "نسخهٔ نصب‌شده روی این کامپیوتر:  $($script:Version)" -X 18 -Y 18 -Width 420 -Font $Bold))

$tabUpdate.Controls.Add((New-Label -Text 'شاخهٔ به‌روزرسانی:' -X 18 -Y 56 -Width 130))
$script:BranchBox = New-Box -X 152 -Y 53 -Width 320 -Value 'main'
$script:BranchBox.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$tabUpdate.Controls.Add($script:BranchBox)

$btnCheckUpdate = New-Button -Text 'بررسیِ نسخهٔ تازه' -X 486 -Y 51 -Width 160
$script:BtnDoUpdate = New-Button -Text 'به‌روزرسانی کن' -X 654 -Y 51 -Width 160 -Primary $true
$script:BtnDoUpdate.Enabled = $false
$tabUpdate.Controls.AddRange(@($btnCheckUpdate, $script:BtnDoUpdate))

$btnShortcut = New-Button -Text 'ساختنِ میان‌بر روی دسکتاپ' -X 18 -Y 92 -Width 220
$tabUpdate.Controls.Add($btnShortcut)

$script:UpdateOut = New-Output -X 18 -Y 132 -Width 900 -Height 380
$script:UpdateOut.Text = @'
اول «بررسیِ نسخهٔ تازه» را بزنید.

اگر نسخهٔ تازه‌ای باشد، دکمهٔ «به‌روزرسانی کن» روشن می‌شود و بعد خودش:
  ۱) از کدِ فعلی نسخهٔ پشتیبان می‌گیرد (در data\backups)
  ۲) نسخهٔ تازه را از GitHub می‌گیرد
  ۳) سرور را خاموش، فایل‌ها را عوض، و دوباره روشن می‌کند

پوشهٔ data (دیتابیس، کاربران، لاگ) و فایل .env (رمزها) هرگز پاک نمی‌شوند.
'@
$tabUpdate.Controls.Add($script:UpdateOut)

$tabs.TabPages.AddRange(@($tabAddress, $tabLogin, $tabSettings, $tabCode, $tabLog, $tabUpdate))
$form.Controls.Add($tabs)
$form.Controls.Add($header)

# ---------------------------------------------------------------------------
#  رفتارها
# ---------------------------------------------------------------------------

function Update-Status {
  $health = Get-ServerHealth -Port $script:Port
  if ($health) {
    $script:StatusLabel.Text = "● سرور روشن است — نسخهٔ $($health.version)"
    $script:StatusLabel.ForeColor = $Good
    $script:SubLabel.Text = "پورت $($script:Port) · پنل: http://localhost:$($script:Port)"
    $btnStart.Enabled = $false
    $btnStop.Enabled = $true
  } else {
    $script:StatusLabel.Text = '● سرور خاموش است'
    $script:StatusLabel.ForeColor = $Bad
    $script:SubLabel.Text = 'دکمهٔ «روشن کردنِ سرور» را بزنید.'
    $btnStart.Enabled = $true
    $btnStop.Enabled = $false
  }
  return $health
}

function Update-Addresses {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("روی همین کامپیوتر:   http://localhost:$($script:Port)") | Out-Null

  $script:LanUrl = ''
  foreach ($ip in (Get-LanAddresses)) {
    if (-not $script:LanUrl) { $script:LanUrl = "http://$($ip):$($script:Port)" }
    $lines.Add("در شبکهٔ خانگی:      http://$($ip):$($script:Port)") | Out-Null
  }
  if (-not $script:LanUrl) { $lines.Add('در شبکهٔ خانگی:      (کارتِ شبکه‌ای پیدا نشد)') | Out-Null }

  $script:NetUrl = ''
  $script:Config = Get-AppConfig -Port $script:Port
  if ($script:Config) {
    if ($script:Config.server -and $script:Config.server.internet) {
      $script:NetUrl = [string]$script:Config.server.internet
      $lines.Add("از اینترنت (تونل):   $($script:NetUrl)") | Out-Null
    } else {
      $lines.Add('از اینترنت (تونل):   هنوز آماده نیست — در پنل، بخشِ «تونل»') | Out-Null
    }
    $sms = if ($script:Config.login.smsReady) { 'روشن' } else { 'خاموش' }
    $mail = if ($script:Config.login.emailReady) { 'روشن' } else { 'خاموش' }
    $lines.Add('') | Out-Null
    $lines.Add("وضعیتِ فرستادنِ کد:   پیامک: $sms   ·   ایمیل: $mail") | Out-Null
  } else {
    $lines.Add('') | Out-Null
    $lines.Add('(سرور خاموش است — برای دیدنِ آدرسِ اینترنتی و وضعیتِ پیامک، روشنش کنید)') | Out-Null
  }

  $script:AddressBox.Text = ($lines -join [Environment]::NewLine)

  $script:BaseUrl = if ($script:NetUrl) { $script:NetUrl } elseif ($script:LanUrl) { $script:LanUrl } else { "http://localhost:$($script:Port)" }
  Update-Snippet
}

function Update-Snippet {
  $kind = [string]$script:SnippetKind.SelectedItem
  $script:SnippetBox.Text = (Get-CodeSnippet -Kind $kind -BaseUrl $script:BaseUrl)
}

function Load-Settings {
  $values = Read-EnvFile -Path $script:EnvPath
  $get = {
    param($key, $fallback)
    if ($values.ContainsKey($key) -and $values[$key]) { return [string]$values[$key] }
    return $fallback
  }
  $script:MailHost.Text = & $get 'OTP_EMAIL_HOST' 'smtp.gmail.com'
  $script:MailPort.Text = & $get 'OTP_EMAIL_PORT' '465'
  $script:MailUser.Text = & $get 'OTP_EMAIL_USER' ''
  $script:MailPass.Text = & $get 'OTP_EMAIL_PASS' ''
  $script:SmsKey.Text = & $get 'OTP_SMS_KEY' ''
  $script:SmsSender.Text = & $get 'OTP_SMS_SENDER' ''
  $script:SmsTemplate.Text = & $get 'OTP_SMS_TEMPLATE' ''

  $provider = & $get 'OTP_SMS_PROVIDER' 'none'
  $index = $script:SmsProvider.Items.IndexOf($provider)
  if ($index -lt 0) { $index = 0 }
  $script:SmsProvider.SelectedIndex = $index
}

function Restart-Server {
  Show-Busy 'در حالِ خاموش کردنِ سرور…'
  Stop-PanelServer -ServerDir $script:ServerDir | Out-Null
  Start-Sleep -Seconds 2
  Show-Busy 'در حالِ روشن کردنِ سرور…'
  Start-PanelServer -ServerDir $script:ServerDir | Out-Null
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    Update-Terminal
    [System.Windows.Forms.Application]::DoEvents()
    if (Get-ServerHealth -Port $script:Port) { break }
  }
  Update-Status | Out-Null
  Update-Addresses
}

# ------------------------------- دکمه‌ها -----------------------------------
$btnStart.Add_Click({
  if (-not (Find-NodeExe)) {
    [System.Windows.Forms.MessageBox]::Show(
      "Node.js روی این کامپیوتر پیدا نشد.`r`n`r`nاول از nodejs.org نصبش کنید (نسخهٔ ۲۲ به بالا)، بعد دوباره امتحان کنید.",
      'برنامهٔ سرور') | Out-Null
    Start-Process 'https://nodejs.org/fa/download'
    return
  }
  Show-Busy 'در حالِ روشن کردنِ سرور… (بارِ اول ممکن است کمی طول بکشد)'
  # ترمینال را نشان می‌دهیم تا ببیند دارد چه اتفاقی می‌افتد
  $tabs.SelectedTab = $tabLog
  Start-PanelServer -ServerDir $script:ServerDir | Out-Null
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    Update-Terminal
    [System.Windows.Forms.Application]::DoEvents()
    if (Get-ServerHealth -Port $script:Port) { break }
  }
  Update-Terminal -Force $true
  Update-Status | Out-Null
  Update-Addresses
})

$btnStop.Add_Click({
  Show-Busy 'در حالِ خاموش کردن…'
  if (-not (Stop-PanelServer -ServerDir $script:ServerDir)) {
    [System.Windows.Forms.MessageBox]::Show('سرور پیدا نشد. شاید از راهِ دیگری اجرا شده باشد.', 'برنامهٔ سرور') | Out-Null
  }
  Start-Sleep -Seconds 1
  Update-Terminal -Force $true
  Update-Status | Out-Null
})

$btnPanel.Add_Click({
  Start-Process "http://localhost:$($script:Port)"
})

$btnCopyLan.Add_Click({ Copy-Text -Text $script:LanUrl })
$btnCopyNet.Add_Click({
  if ($script:NetUrl) { Copy-Text -Text $script:NetUrl }
  else { [System.Windows.Forms.MessageBox]::Show('آدرسِ اینترنتی هنوز آماده نیست. سرور را روشن کنید و چند لحظه صبر کنید.', 'برنامهٔ سرور') | Out-Null }
})
$btnRefreshAddress.Add_Click({ Update-Status | Out-Null; Update-Addresses })

$script:SnippetKind.Add_SelectedIndexChanged({ Update-Snippet })
$btnCopyCode.Add_Click({ Copy-Text -Text $script:SnippetBox.Text })

$btnSendCode.Add_Click({
  $target = $script:TargetBox.Text.Trim()
  if (-not $target) {
    $script:LoginOut.Text = 'اول شماره یا ایمیل را بنویسید.'
    return
  }
  Show-Busy 'در حالِ فرستادنِ کد…'
  $appName = $script:AppBox.Text.Trim()
  if (-not $appName) { $appName = 'main' }
  $result = Invoke-Json -Url "http://127.0.0.1:$($script:Port)/api/app/auth/request-code" -Method 'POST' -Body @{ to = $target; app = $appName }
  $script:LoginOut.Text = (Format-Result -Result $result -Title 'درخواستِ کد')
  Update-Status | Out-Null
})

$btnVerifyCode.Add_Click({
  $target = $script:TargetBox.Text.Trim()
  $code = $script:CodeBox.Text.Trim()
  if (-not $target -or -not $code) {
    $script:LoginOut.Text = 'شماره/ایمیل و کد را بنویسید.'
    return
  }
  Show-Busy 'در حالِ بررسیِ کد…'
  $appName = $script:AppBox.Text.Trim()
  if (-not $appName) { $appName = 'main' }
  $result = Invoke-Json -Url "http://127.0.0.1:$($script:Port)/api/app/auth/verify-code" -Method 'POST' -Body @{ to = $target; code = $code; app = $appName }
  $script:LoginOut.Text = (Format-Result -Result $result -Title 'بررسیِ کد')
  Update-Status | Out-Null
})

function Format-Result {
  param($Result, [string]$Title)

  if (-not $Result.ok -and $Result.status -eq 0) {
    return "$Title`r`n`r`nسرور جواب نداد. آیا روشن است؟`r`n$($Result.error)"
  }
  $body = ''
  if ($Result.data) {
    try { $body = ($Result.data | ConvertTo-Json -Depth 6) } catch { $body = [string]$Result.data }
  }
  $head = "$Title — پاسخِ سرور: $($Result.status)"
  $hint = ''
  if ($Result.data -and $Result.data.message) { $hint = "`r`n$($Result.data.message)`r`n" }
  return "$head$hint`r`n$body"
}

$btnSaveSettings.Add_Click({
  $port = $script:MailPort.Text.Trim()
  if (-not $port) { $port = '465' }

  # App Password گوگل را چهار حرف چهار حرف نشان می‌دهد؛ مردم با فاصله کپی می‌کنند
  # و بعد «رمز اشتباه» می‌گیرند. همین‌جا فاصله‌ها را برمی‌داریم.
  $mailPass = $script:MailPass.Text
  if ($mailPass -match '^\w{4}\s+\w{4}\s+\w{4}\s+\w{4}$') {
    $mailPass = ($mailPass -replace '\s', '')
    $script:MailPass.Text = $mailPass
  }
  $secure = '0'
  if ($port -eq '465') { $secure = '1' }

  $values = @{
    'OTP_EMAIL_HOST'   = $script:MailHost.Text.Trim()
    'OTP_EMAIL_PORT'   = $port
    'OTP_EMAIL_SECURE' = $secure
    'OTP_EMAIL_USER'   = $script:MailUser.Text.Trim()
    'OTP_EMAIL_PASS'   = $mailPass
    'OTP_EMAIL_FROM'   = $script:MailUser.Text.Trim()
    'OTP_SMS_PROVIDER' = [string]$script:SmsProvider.SelectedItem
    'OTP_SMS_KEY'      = $script:SmsKey.Text.Trim()
    'OTP_SMS_SENDER'   = $script:SmsSender.Text.Trim()
    'OTP_SMS_TEMPLATE' = $script:SmsTemplate.Text.Trim()
  }
  # اگر ایمیل خالی است، کلِ بخشِ ایمیل برداشته شود تا سرور فکر نکند تنظیم شده
  if (-not $values['OTP_EMAIL_USER']) {
    $values['OTP_EMAIL_HOST'] = ''
    $values['OTP_EMAIL_PASS'] = ''
    $values['OTP_EMAIL_FROM'] = ''
  }

  Set-EnvValues -Path $script:EnvPath -Values $values | Out-Null
  $script:SettingsOut.Text = "ذخیره شد در:`r`n$($script:EnvPath)`r`n`r`nحالا سرور دوباره بالا می‌آید تا تنظیماتِ تازه خوانده شود…"
  [System.Windows.Forms.Application]::DoEvents()
  Restart-Server
  $ready = ''
  if ($script:Config) {
    $sms = if ($script:Config.login.smsReady) { 'روشن' } else { 'خاموش' }
    $mail = if ($script:Config.login.emailReady) { 'روشن' } else { 'خاموش' }
    $ready = "`r`n`r`nوضعیتِ تازه →  پیامک: $sms   ·   ایمیل: $mail"
  }
  $script:SettingsOut.Text = "ذخیره شد و سرور دوباره بالا آمد.$ready`r`n`r`nحالا در تبِ «تستِ ورود با کد» شمارهٔ خودتان را امتحان کنید."
})

$btnOpenEnv.Add_Click({
  if (-not (Test-Path -LiteralPath $script:EnvPath)) {
    Set-EnvValues -Path $script:EnvPath -Values @{} | Out-Null
  }
  Start-Process 'notepad.exe' -ArgumentList "`"$($script:EnvPath)`""
})

<#
  .SYNOPSIS
  ترمینال را تازه می‌کند. فقط وقتی متن عوض شده باشد دست می‌زند، تا اگر کاربر
  چیزی را انتخاب کرده یا بالا رفته، هر ثانیه از دستش نپرد.
#>
function Update-Terminal {
  param([bool]$Force = $false)

  $text = Get-PanelLog -ServerDir $script:ServerDir -Lines 400
  if (-not $Force -and $text -eq $script:LogBox.Text) { return }
  $script:LogBox.Text = $text
  $script:LogBox.SelectionStart = $script:LogBox.TextLength
  $script:LogBox.ScrollToCaret()
}

$btnRefreshLog.Add_Click({ Update-Terminal -Force $true })
$btnCopyLog.Add_Click({ Copy-Text -Text $script:LogBox.Text })
$btnClearLog.Add_Click({
  Clear-PanelLog -ServerDir $script:ServerDir | Out-Null
  Update-Terminal -Force $true
})

$btnCheckUpdate.Add_Click({
  $branch = $script:BranchBox.Text.Trim()
  if (-not $branch) { $branch = 'main' }
  $script:UpdateOut.Text = "در حالِ پرسیدن از GitHub (شاخهٔ $branch)…"
  [System.Windows.Forms.Application]::DoEvents()

  $remote = Get-RemoteVersion -Branch $branch
  if (-not $remote) {
    $script:UpdateOut.Text = "نسخهٔ تازه خوانده نشد.`r`n`r`nیا اینترنت وصل نیست، یا نامِ شاخه ($branch) اشتباه است."
    $script:BtnDoUpdate.Enabled = $false
    return
  }

  $compare = Compare-AppVersion -Left $remote -Right $script:Version
  if ($compare -eq 1) {
    $script:UpdateOut.Text = "نسخهٔ تازه هست!`r`n`r`n  نسخهٔ شما:  $($script:Version)`r`n  روی GitHub: $remote`r`n`r`nدکمهٔ «به‌روزرسانی کن» را بزنید."
    $script:BtnDoUpdate.Enabled = $true
  } elseif ($compare -eq 0) {
    $script:UpdateOut.Text = "شما آخرین نسخه را دارید ($($script:Version))."
    $script:BtnDoUpdate.Enabled = $false
  } else {
    $script:UpdateOut.Text = "نسخهٔ شما ($($script:Version)) از نسخهٔ روی GitHub ($remote) جدیدتر است."
    $script:BtnDoUpdate.Enabled = $false
  }
})

$script:BtnDoUpdate.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show(
    'سرور چند لحظه خاموش می‌شود و بعد خودش برمی‌گردد. ادامه بدهم؟',
    'به‌روزرسانی',
    [System.Windows.Forms.MessageBoxButtons]::YesNo)
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }

  $branch = $script:BranchBox.Text.Trim()
  if (-not $branch) { $branch = 'main' }
  $script:BtnDoUpdate.Enabled = $false
  $script:UpdateOut.Text = ''

  $report = Install-Update -Branch $branch -ProjectRoot $script:ProjectRoot -ServerDir $script:ServerDir -OnStep {
    param($message)
    $script:UpdateOut.AppendText("$message`r`n")
    [System.Windows.Forms.Application]::DoEvents()
  }

  if ($report.ok) {
    $script:UpdateOut.AppendText("`r`nتمام شد. نسخهٔ تازه: $($report.version)`r`n")
    $script:UpdateOut.AppendText("برای اینکه خودِ همین پنجره هم تازه شود، یک‌بار ببندید و دوباره باز کنید.`r`n")
  } else {
    $script:UpdateOut.AppendText("`r`nبه‌روزرسانی نشد: $($report.error)`r`n")
    $script:UpdateOut.AppendText('دادهٔ شما دست‌نخورده است. دوباره امتحان کنید یا اینترنت را بررسی کنید.')
  }
  Update-Status | Out-Null
  Update-Addresses
})

$btnShortcut.Add_Click({
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $linkPath = Join-Path $desktop 'برنامهٔ سرور خانگی.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = Join-Path $script:DesktopDir 'برنامه-سرور.bat'
    $link.WorkingDirectory = $script:DesktopDir
    $link.Description = 'برنامهٔ سرور خانگی'
    $link.Save()
    [System.Windows.Forms.MessageBox]::Show("میان‌بر ساخته شد:`r`n$linkPath", 'برنامهٔ سرور') | Out-Null
  } catch {
    [System.Windows.Forms.MessageBox]::Show("میان‌بر ساخته نشد: $($_.Exception.Message)", 'برنامهٔ سرور') | Out-Null
  }
})

# ------------------------------- تایمر -------------------------------------
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$script:Ticks = 0
$timer.Add_Tick({
  $script:Ticks++
  # وضعیت هر ۳ ثانیه، ترمینال هر ۱.۵ ثانیه (تا زنده به‌نظر برسد)
  if ($script:Ticks % 2 -eq 0) { Update-Status | Out-Null }
  if ($script:AutoLog.Checked -and $tabs.SelectedTab -eq $tabLog) { Update-Terminal }
})

$form.Add_Shown({
  Load-Settings
  Update-Status | Out-Null
  Update-Addresses
  Update-Terminal -Force $true
  $timer.Start()
})

$form.Add_FormClosed({ $timer.Stop() })

[void]$form.ShowDialog()
