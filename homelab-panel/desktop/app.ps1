# ---------------------------------------------------------------------------
#  برنامهٔ سرور خانگی — پنجرهٔ اصلی (WPF)
#
#  چرا WPF و نه WinForms: WinForms قیافهٔ ویندوزِ قدیم را دارد و نمی‌شود
#  خوشگلش کرد. WPF بومیِ ویندوز است (نه مرورگر و نه WebView) ولی رنگ، گوشهٔ
#  گرد، سایه، انیمیشن و خطِ دلخواه (وزیرمتن) را می‌پذیرد.
#
#  ظاهر در ui.xaml است و رفتار این‌جا. مغزِ کار (API، .env، به‌روزرسانی)
#  در lib.ps1 است تا بشود بدونِ پنجره آزمودش.
# ---------------------------------------------------------------------------

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms   # فقط برای پیام‌های ساده و کلیپ‌بورد

try {
  . (Join-Path $PSScriptRoot 'lib.ps1')
} catch {
  [System.Windows.MessageBox]::Show("فایلِ lib.ps1 بالا نیامد:`r`n`r`n$($_.Exception.Message)", 'سرور خانگی')
  exit 1
}

$script:DesktopDir  = $PSScriptRoot
$script:ServerDir   = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\server'))
$script:ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:EnvPath     = Join-Path $script:ServerDir '.env'
$script:Version     = Get-LocalVersion -ServerDir $script:ServerDir
$script:Clients     = @()
$script:Sites       = @()
$script:Overview    = $null
$script:BaseUrl     = ''
$script:LanUrl      = ''
$script:NetUrl      = ''
$script:UpdateReady = ''

function Get-PanelPort {
  $values = Read-EnvFile -Path $script:EnvPath
  if ($values.ContainsKey('HLP_PORT') -and $values['HLP_PORT'] -match '^\d+$') { return [int]$values['HLP_PORT'] }
  return 4700
}
$script:Port = Get-PanelPort

# ---------------------------------------------------------------------------
#  ساختنِ پنجره از روی XAML
# ---------------------------------------------------------------------------
$xamlPath = Join-Path $PSScriptRoot 'ui.xaml'
try {
  $xamlText = [System.IO.File]::ReadAllText($xamlPath, [System.Text.Encoding]::UTF8)
  $reader = New-Object System.Xml.XmlNodeReader ([xml]$xamlText)
  $script:Window = [Windows.Markup.XamlReader]::Load($reader)
} catch {
  $logPath = Write-AppError -ErrorRecord $_ -Where 'ساختنِ پنجره' -ServerDir $script:ServerDir
  [System.Windows.MessageBox]::Show("ظاهرِ برنامه بالا نیامد:`r`n`r`n$($_.Exception.Message)`r`n`r`nگزارش: $logPath", 'سرور خانگی')
  exit 1
}

<# هر عنصرِ نام‌دارِ XAML را با همان نام صدا می‌زنیم: $ui.BtnStart #>
$script:ui = @{}
foreach ($name in @(
    'LblVersion','LblServerState','BtnStart','BtnStop','LblTitle','LblSubtitle','BtnRefresh',
    'NavHome','NavApps','NavOtp','NavSites','NavSettings','NavTerminal','NavUpdate',
    'PageHome','PageApps','PageOtp','PageSites','PageSettings','PageTerminal','PageUpdate',
    'TxtMainAddress','LblAddressHint','BtnCopyMain','BtnCopyLan','BtnCopyNet',
    'CardAndroid','CardWeb','CardDesktop','LblAndroidCount','LblAndroidInfo',
    'LblWebCount','LblWebInfo','LblDesktopCount','LblDesktopInfo',
    'LblSms','LblMail','LblTunnel','LblAi','LblUsers','LblOnline','LblCodes','LblLogins',
    'CmbKindFilter','BtnNewApp','LstApps','LblAppTitle','TxtAppName','CmbAppKind','TxtAppSms',
    'TxtAppKey','TxtAppLen','ChkAppKeyReq','ChkAppEnabled','BtnSaveApp','BtnNewKey','BtnDelApp',
    'BtnCopyApi','TxtApiCard',
    'TxtOtpTarget','CmbOtpApp','BtnSendCode','TxtOtpCode','BtnVerifyCode','LblOtpState','TxtOtpOut',
    'LstSites',
    'TxtMailHost','TxtMailUser','TxtMailPort','TxtMailPass','CmbSmsProvider','TxtSmsSender',
    'TxtSmsKey','TxtSmsTemplate','ChkAi','LblAiNote','BtnSaveSettings','BtnOpenEnv','LblSettingsState',
    'BtnLogRefresh','BtnLogClear','BtnLogCopy','ChkLogAuto','TxtLog',
    'LblUpdateVersion','TxtBranch','ChkAutoCheck','BtnCheckUpdate','BtnDoUpdate','BtnShortcut','TxtUpdateOut'
  )) {
  $script:ui[$name] = $script:Window.FindName($name)
}
$ui = $script:ui

# ------------------------------ خطِ وزیر ------------------------------------
try {
  $fontDir = Join-Path $PSScriptRoot 'fonts'
  if (Test-Path -LiteralPath $fontDir) {
    $uri = 'file:///' + ($fontDir -replace '\\', '/') + '/#Vazirmatn'
    $script:Window.FontFamily = New-Object System.Windows.Media.FontFamily($uri)
  }
} catch { }   # اگر نشد، خطِ پیش‌فرضِ ویندوز
$script:Window.FontSize = 14

# آیکونِ برنامه روی نوارِ وظیفه و گوشهٔ پنجره
try {
  $iconPath = Join-Path $PSScriptRoot 'server.ico'
  if (Test-Path -LiteralPath $iconPath) {
    $script:Window.Icon = New-Object System.Windows.Media.Imaging.BitmapImage (New-Object Uri $iconPath)
  }
} catch { }

# ---------------------------------------------------------------------------
#  کمکی‌های کوچک
# ---------------------------------------------------------------------------
$script:Brushes = @{
  Ink   = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(238, 242, 255))
  Muted = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(142, 154, 196))
  Good  = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(61, 214, 140))
  Warn  = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(245, 177, 76))
  Bad   = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(255, 107, 107))
  Brand = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(76, 125, 255))
}

function Set-Text {
  param($Element, [string]$Text, $Brush = $null)
  if (-not $Element) { return }
  $Element.Text = $Text
  if ($Brush) { $Element.Foreground = $Brush }
}

function Copy-Clip {
  param([string]$Text)
  if (-not $Text) { return }
  try { [System.Windows.Clipboard]::SetText($Text) } catch { }
}

function Say {
  param([string]$Message)
  [System.Windows.MessageBox]::Show($Message, 'سرور خانگی') | Out-Null
}

function Ask {
  param([string]$Message)
  return ([System.Windows.MessageBox]::Show($Message, 'سرور خانگی', [System.Windows.MessageBoxButton]::YesNo) -eq [System.Windows.MessageBoxResult]::Yes)
}

function Pump {
  # تا پنجره وسطِ کارهای طولانی یخ نزند
  try {
    $frame = New-Object System.Windows.Threading.DispatcherFrame
    [System.Windows.Threading.Dispatcher]::CurrentDispatcher.BeginInvoke(
      [System.Windows.Threading.DispatcherPriority]::Background,
      [action] { $frame.Continue = $false }) | Out-Null
    [System.Windows.Threading.Dispatcher]::PushFrame($frame)
  } catch { }
}

function Admin {
  param([string]$Path, [string]$Method = 'GET', $Body = $null)
  return Invoke-AdminJson -ServerDir $script:ServerDir -Path $Path -Method $Method -Body $Body -Port $script:Port
}

# ---------------------------------------------------------------------------
#  رفت‌وآمد بینِ صفحه‌ها
# ---------------------------------------------------------------------------
$script:PageMap = @{
  NavHome     = @{ Page = 'PageHome';     Title = 'خانه';                    Sub = 'یک نگاه به همه‌چیز' }
  NavApps     = @{ Page = 'PageApps';     Title = 'برنامه‌ها و سایت‌ها';      Sub = 'هر کدام آدرس و کلیدِ خودش' }
  NavOtp      = @{ Page = 'PageOtp';      Title = 'ورود با کدِ یک‌بارمصرف';   Sub = 'همان مسیری که کاربرِ شما طی می‌کند' }
  NavSites    = @{ Page = 'PageSites';    Title = 'سایت‌های روی سرور';        Sub = 'بدونِ باز کردنِ مرورگر' }
  NavSettings = @{ Page = 'PageSettings'; Title = 'تنظیمات';                  Sub = 'پیامک، ایمیل، و دستیارِ هوشمند' }
  NavTerminal = @{ Page = 'PageTerminal'; Title = 'ترمینالِ سرور';            Sub = 'خروجیِ زنده — بدونِ پنجرهٔ سیاه' }
  NavUpdate   = @{ Page = 'PageUpdate';   Title = 'به‌روزرسانی';              Sub = 'نسخهٔ تازه را از GitHub می‌گیرد' }
}

function Show-Page {
  param([string]$NavName)

  $info = $script:PageMap[$NavName]
  if (-not $info) { return }

  foreach ($entry in $script:PageMap.GetEnumerator()) {
    $page = $ui[$entry.Value.Page]
    if ($page) { $page.Visibility = [System.Windows.Visibility]::Collapsed }
  }
  $current = $ui[$info.Page]
  if ($current) {
    $current.Visibility = [System.Windows.Visibility]::Visible
    # ورودِ نرمِ صفحه
    try {
      $fade = New-Object System.Windows.Media.Animation.DoubleAnimation(0.0, 1.0, (New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(180))))
      $current.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
    } catch { }
  }
  Set-Text $ui.LblTitle $info.Title
  Set-Text $ui.LblSubtitle $info.Sub
  $script:CurrentNav = $NavName

  switch ($NavName) {
    'NavApps'     { Update-Clients }
    'NavSites'    { Update-Sites }
    'NavTerminal' { Update-Terminal -Force $true }
    'NavSettings' { Update-SettingsForm }
  }
}

# ---------------------------------------------------------------------------
#  خواندنِ وضعیت از سرور
# ---------------------------------------------------------------------------
function Update-Status {
  $health = Get-ServerHealth -Port $script:Port
  if ($health) {
    Set-Text $ui.LblServerState "● سرور روشن است" $script:Brushes.Good
    $ui.BtnStart.IsEnabled = $false
    $ui.BtnStop.IsEnabled = $true
  } else {
    Set-Text $ui.LblServerState "● سرور خاموش است" $script:Brushes.Bad
    $ui.BtnStart.IsEnabled = $true
    $ui.BtnStop.IsEnabled = $false
  }
  return $health
}

function Update-Addresses {
  $lan = @(Get-LanAddresses)
  $script:LanUrl = if ($lan.Count -gt 0) { "http://$($lan[0]):$($script:Port)" } else { "http://localhost:$($script:Port)" }

  $script:NetUrl = ''
  if ($script:Overview -and $script:Overview.tunnel -and $script:Overview.tunnel.url) {
    $script:NetUrl = [string]$script:Overview.tunnel.url
  }

  $script:BaseUrl = if ($script:NetUrl) { $script:NetUrl } else { $script:LanUrl }
  Set-Text $ui.TxtMainAddress $script:BaseUrl

  if ($script:NetUrl) {
    Set-Text $ui.LblAddressHint 'این آدرسِ اینترنتی است: از هر جای دنیا کار می‌کند. هر کاربری که با شماره یا ایمیلِ خودش وارد شود، روی هر دستگاهی همان اطلاعاتِ حسابِ خودش را می‌بیند.'
  } else {
    Set-Text $ui.LblAddressHint 'این آدرسِ شبکهٔ خانگی است (فقط روی همین وای‌فای کار می‌کند). برای دسترسی از بیرونِ خانه، تونل را روشن کنید تا آدرسِ https داشته باشید.'
  }
}

function Update-Overview {
  $result = Admin '/api/app-admin/overview'
  if (-not $result.ok) {
    $script:Overview = $null
    Set-Text $ui.LblSms '—' $script:Brushes.Muted
    Set-Text $ui.LblMail '—' $script:Brushes.Muted
    Set-Text $ui.LblTunnel '—' $script:Brushes.Muted
    Set-Text $ui.LblAi '—' $script:Brushes.Muted
    foreach ($name in @('LblAndroidCount','LblWebCount','LblDesktopCount')) { Set-Text $ui[$name] '—' }
    foreach ($name in @('LblAndroidInfo','LblWebInfo','LblDesktopInfo')) { Set-Text $ui[$name] 'سرور خاموش است' }
    foreach ($name in @('LblUsers','LblOnline','LblCodes','LblLogins')) { Set-Text $ui[$name] '—' }
    Update-Addresses
    return
  }

  $data = $result.data
  $script:Overview = $data
  Set-Text $ui.LblVersion "نسخهٔ $($script:Version)"

  $delivery = $data.delivery
  if ($delivery.smsReady) { Set-Text $ui.LblSms "روشن ($($delivery.smsProvider))" $script:Brushes.Good }
  else { Set-Text $ui.LblSms 'تنظیم نشده' $script:Brushes.Warn }

  if ($delivery.emailReady) { Set-Text $ui.LblMail 'روشن' $script:Brushes.Good }
  else { Set-Text $ui.LblMail 'تنظیم نشده' $script:Brushes.Warn }

  if ($data.tunnel -and $data.tunnel.url) { Set-Text $ui.LblTunnel 'وصل' $script:Brushes.Good }
  elseif ($data.tunnel) { Set-Text $ui.LblTunnel ([string]$data.tunnel.status) $script:Brushes.Warn }
  else { Set-Text $ui.LblTunnel 'خاموش' $script:Brushes.Muted }

  if ($data.ai.enabled) { Set-Text $ui.LblAi 'روشن' $script:Brushes.Good }
  else { Set-Text $ui.LblAi 'خاموش' $script:Brushes.Muted }

  foreach ($row in @($data.kinds)) {
    $count = [string]$row.count
    $info = "$($row.users) کاربر · $($row.online) آنلاین · $($row.codesToday) کدِ امروز"
    switch ($row.kind) {
      'android' { Set-Text $ui.LblAndroidCount $count; Set-Text $ui.LblAndroidInfo $info }
      'web'     { Set-Text $ui.LblWebCount $count;     Set-Text $ui.LblWebInfo $info }
      'desktop' { Set-Text $ui.LblDesktopCount $count; Set-Text $ui.LblDesktopInfo $info }
    }
  }

  Set-Text $ui.LblUsers  ([string]$data.stats.users)
  Set-Text $ui.LblOnline ([string]$data.stats.activeSessions)
  Set-Text $ui.LblCodes  ([string]$data.stats.codesLastHour)
  Set-Text $ui.LblLogins ([string]$data.stats.loginsToday)

  Update-Addresses
}

# ---------------------------------------------------------------------------
#  برنامه‌ها و سایت‌ها
# ---------------------------------------------------------------------------
$script:KindNames = @{ android = 'برنامهٔ اندروید'; web = 'سایت'; desktop = 'برنامهٔ کامپیوتری' }
$script:KindOrder = @('android', 'web', 'desktop')

function Selected-Kind {
  $index = $ui.CmbKindFilter.SelectedIndex
  if ($index -le 0) { return '' }
  return $script:KindOrder[$index - 1]
}

function Update-Clients {
  param([string]$Select = '')

  $result = Admin '/api/app-admin/clients'
  $ui.LstApps.Items.Clear()
  if (-not $result.ok) {
    $script:Clients = @()
    Set-Text $ui.LblAppTitle 'برای دیدنِ برنامه‌ها، اول سرور را روشن کنید'
    Set-Text $ui.TxtApiCard ''
    return
  }

  $all = @($result.data.clients)
  $kind = Selected-Kind
  if ($kind) { $all = @($all | Where-Object { $_.kind -eq $kind }) }
  $script:Clients = $all

  foreach ($client in $all) {
    $mark = if ($client.enabled) { '●' } else { '○' }
    $lock = if ($client.requireKey) { ' 🔑' } else { '' }
    [void]$ui.LstApps.Items.Add("$mark  $($client.name)   —   $($client.kindLabel)   ·   $($client.users) کاربر$lock")
  }

  if ($all.Count -gt 0) {
    $index = 0
    if ($Select) {
      for ($i = 0; $i -lt $all.Count; $i++) { if ($all[$i].slug -eq $Select) { $index = $i; break } }
    }
    $ui.LstApps.SelectedIndex = $index
  } else {
    Set-Text $ui.LblAppTitle 'هنوز برنامه‌ای از این نوع نیست'
    Set-Text $ui.TxtApiCard ''
  }

  # فهرستِ برنامه‌ها برای صفحهٔ OTP هم به‌روز شود
  $selectedApp = [string]$ui.CmbOtpApp.SelectedItem
  $ui.CmbOtpApp.Items.Clear()
  foreach ($client in @($result.data.clients)) { [void]$ui.CmbOtpApp.Items.Add($client.slug) }
  if ($ui.CmbOtpApp.Items.Count -gt 0) {
    $ui.CmbOtpApp.SelectedIndex = 0
    if ($selectedApp) {
      for ($i = 0; $i -lt $ui.CmbOtpApp.Items.Count; $i++) {
        if ([string]$ui.CmbOtpApp.Items[$i] -eq $selectedApp) { $ui.CmbOtpApp.SelectedIndex = $i; break }
      }
    }
  }
}

function Get-SelectedClient {
  $index = $ui.LstApps.SelectedIndex
  if ($index -lt 0 -or $index -ge $script:Clients.Count) { return $null }
  return $script:Clients[$index]
}

function Show-ClientDetails {
  $client = Get-SelectedClient
  if (-not $client) { return }

  Set-Text $ui.LblAppTitle "$($client.name)   ·   شناسه: $($client.slug)"
  $ui.TxtAppName.Text = [string]$client.name
  $ui.TxtAppKey.Text = [string]$client.apiKey
  $ui.TxtAppSms.Text = [string]$client.smsText
  $ui.TxtAppLen.Text = if ($client.codeLength) { [string]$client.codeLength } else { '' }
  $ui.ChkAppKeyReq.IsChecked = [bool]$client.requireKey
  $ui.ChkAppEnabled.IsChecked = [bool]$client.enabled

  for ($i = 0; $i -lt $script:KindOrder.Count; $i++) {
    if ($script:KindOrder[$i] -eq $client.kind) { $ui.CmbAppKind.SelectedIndex = $i; break }
  }

  $length = if ($client.codeLength) { [int]$client.codeLength } else { 6 }
  $card = Get-ApiCard -Slug $client.slug -BaseUrl $script:BaseUrl -ApiKey ([string]$client.apiKey) `
    -KeyRequired ([bool]$client.requireKey) -CodeLength $length
  Set-Text $ui.TxtApiCard $card
}

function Update-Sites {
  $result = Admin '/api/sites'
  $ui.LstSites.Items.Clear()
  if (-not $result.ok -or -not $result.data) {
    [void]$ui.LstSites.Items.Add('برای دیدنِ سایت‌ها، اول سرور را روشن کنید.')
    return
  }
  $rows = @($result.data.sites)
  if ($rows.Count -eq 0) {
    [void]$ui.LstSites.Items.Add('هنوز سایتی روی این سرور ثبت نشده است.')
    return
  }
  foreach ($site in $rows) {
    $state = if ($site.running) { '● در حالِ اجرا' } else { '○ خاموش' }
    $port = if ($site.port) { "پورت $($site.port)" } else { 'بدونِ پورت' }
    $domain = if ($site.domain) { " · $($site.domain)" } else { '' }
    [void]$ui.LstSites.Items.Add("$state   $($site.name)   —   $($site.kind) · $port$domain")
  }
}

# ---------------------------------------------------------------------------
#  ترمینال
# ---------------------------------------------------------------------------
function Update-Terminal {
  param([bool]$Force = $false)
  $text = Get-PanelLog -ServerDir $script:ServerDir -Lines 400
  if (-not $Force -and $text -eq $ui.TxtLog.Text) { return }
  $ui.TxtLog.Text = $text
  $ui.TxtLog.ScrollToEnd()
}

# ---------------------------------------------------------------------------
#  تنظیمات
# ---------------------------------------------------------------------------
function Update-SettingsForm {
  $values = Read-EnvFile -Path $script:EnvPath
  $get = {
    param($key, $fallback)
    if ($values.ContainsKey($key) -and $values[$key]) { return [string]$values[$key] }
    return $fallback
  }

  $ui.TxtMailHost.Text = & $get 'OTP_EMAIL_HOST' 'smtp.gmail.com'
  $ui.TxtMailPort.Text = & $get 'OTP_EMAIL_PORT' '465'
  $ui.TxtMailUser.Text = & $get 'OTP_EMAIL_USER' ''
  $ui.TxtMailPass.Password = & $get 'OTP_EMAIL_PASS' ''
  $ui.TxtSmsKey.Password = & $get 'OTP_SMS_KEY' ''
  $ui.TxtSmsSender.Text = & $get 'OTP_SMS_SENDER' ''
  $ui.TxtSmsTemplate.Text = & $get 'OTP_SMS_TEMPLATE' ''

  $provider = & $get 'OTP_SMS_PROVIDER' 'none'
  for ($i = 0; $i -lt $ui.CmbSmsProvider.Items.Count; $i++) {
    if ([string]$ui.CmbSmsProvider.Items[$i] -eq $provider) { $ui.CmbSmsProvider.SelectedIndex = $i; break }
  }

  $aiOn = ((& $get 'HLP_AI_ENABLED' '1') -ne '0')
  $ui.ChkAi.IsChecked = $aiOn
  Set-Text $ui.LblAiNote $(if ($aiOn) {
    'روشن است: با سرور بالا می‌آید و سایت از راهِ /ai/support به آن می‌رسد.'
  } else {
    'خاموش است: هیچ پروسه‌ای برای دستیار اجرا نمی‌شود و رَم آزاد می‌ماند.'
  })
}

# ---------------------------------------------------------------------------
#  دکمه‌ها
# ---------------------------------------------------------------------------
function Restart-Server {
  Set-Text $ui.LblServerState '… در حالِ راه‌اندازیِ دوباره' $script:Brushes.Muted
  Pump
  Stop-PanelServer -ServerDir $script:ServerDir | Out-Null
  Start-Sleep -Seconds 2
  Start-PanelServer -ServerDir $script:ServerDir | Out-Null
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    Pump
    if (Get-ServerHealth -Port $script:Port) { break }
  }
  Refresh-All
}

function Refresh-All {
  Update-Status | Out-Null
  Update-Overview
  if ($script:CurrentNav -eq 'NavApps') { Update-Clients }
  if ($script:CurrentNav -eq 'NavSites') { Update-Sites }
}

$ui.BtnStart.Add_Click({
  if (-not (Find-NodeExe)) {
    Say "Node.js روی این کامپیوتر پیدا نشد.`r`n`r`nاول از nodejs.org نصبش کنید (نسخهٔ ۲۲ به بالا)."
    Start-Process 'https://nodejs.org/fa/download'
    return
  }
  Set-Text $ui.LblServerState '… در حالِ روشن شدن' $script:Brushes.Muted
  $ui.BtnStart.IsEnabled = $false
  Pump
  Start-PanelServer -ServerDir $script:ServerDir | Out-Null
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    Pump
    if (Get-ServerHealth -Port $script:Port) { break }
  }
  Refresh-All
})

$ui.BtnStop.Add_Click({
  Set-Text $ui.LblServerState '… در حالِ خاموش شدن' $script:Brushes.Muted
  Pump
  if (-not (Stop-PanelServer -ServerDir $script:ServerDir)) {
    Say 'سرور پیدا نشد. شاید از راهِ دیگری اجرا شده باشد.'
  }
  Start-Sleep -Seconds 1
  Refresh-All
})

$ui.BtnRefresh.Add_Click({ Refresh-All })

$ui.BtnCopyMain.Add_Click({ Copy-Clip $script:BaseUrl })
$ui.BtnCopyLan.Add_Click({ Copy-Clip $script:LanUrl })
$ui.BtnCopyNet.Add_Click({
  if ($script:NetUrl) { Copy-Clip $script:NetUrl }
  else { Say 'آدرسِ اینترنتی هنوز آماده نیست. سرور را روشن کنید و چند لحظه صبر کنید.' }
})

# سه کادرِ صفحهٔ نخست → صفحهٔ همان نوع
function Open-Kind {
  param([string]$Kind)
  $ui.NavApps.IsChecked = $true
  for ($i = 0; $i -lt $script:KindOrder.Count; $i++) {
    if ($script:KindOrder[$i] -eq $Kind) { $ui.CmbKindFilter.SelectedIndex = $i + 1; break }
  }
  Show-Page 'NavApps'
}
$ui.CardAndroid.Add_MouseLeftButtonUp({ Open-Kind 'android' })
$ui.CardWeb.Add_MouseLeftButtonUp({ Open-Kind 'web' })
$ui.CardDesktop.Add_MouseLeftButtonUp({ Open-Kind 'desktop' })

foreach ($navName in @('NavHome','NavApps','NavOtp','NavSites','NavSettings','NavTerminal','NavUpdate')) {
  $button = $ui[$navName]
  if (-not $button) { continue }
  $button.Add_Checked({
    param($sender, $eventArgs)
    Show-Page $sender.Name
  })
}

$ui.CmbKindFilter.Add_SelectionChanged({ if ($script:Ready) { Update-Clients } })
$ui.LstApps.Add_SelectionChanged({ Show-ClientDetails })

$ui.BtnNewApp.Add_Click({
  $name = Show-InputDialog -Title 'برنامهٔ تازه' -Message "نامِ برنامه یا سایت را بنویسید:`r`n(مثلاً: فروشگاه یعقوبی)"
  if (-not $name -or -not $name.Trim()) { return }
  $kind = Selected-Kind
  if (-not $kind) { $kind = 'web' }
  $result = Admin '/api/app-admin/clients' 'POST' @{ name = $name.Trim(); slug = $name.Trim(); kind = $kind }
  if (-not $result.ok) {
    $message = if ($result.data -and $result.data.message) { $result.data.message } else { $result.error }
    Say "ساخته نشد: $message"
    return
  }
  Update-Clients -Select $result.data.client.slug
  Update-Overview
})

$ui.BtnSaveApp.Add_Click({
  $client = Get-SelectedClient
  if (-not $client) { return }
  $kindIndex = $ui.CmbAppKind.SelectedIndex
  $kind = if ($kindIndex -ge 0) { $script:KindOrder[$kindIndex] } else { $client.kind }

  $result = Admin "/api/app-admin/clients/$($client.slug)" 'PUT' @{
    name       = $ui.TxtAppName.Text.Trim()
    kind       = $kind
    requireKey = [bool]$ui.ChkAppKeyReq.IsChecked
    enabled    = [bool]$ui.ChkAppEnabled.IsChecked
    smsText    = $ui.TxtAppSms.Text.Trim()
    codeLength = $ui.TxtAppLen.Text.Trim()
  }
  if (-not $result.ok) { Say "ذخیره نشد: $($result.error)"; return }
  Update-Clients -Select $client.slug
  Update-Overview
})

$ui.BtnNewKey.Add_Click({
  $client = Get-SelectedClient
  if (-not $client) { return }
  if (-not (Ask "کلیدِ تازه ساخته شود؟`r`n`r`nبرنامه‌هایی که کلیدِ قدیمی را دارند تا کلیدِ تازه را نگذارید وصل نمی‌شوند.")) { return }
  $result = Admin "/api/app-admin/clients/$($client.slug)/key" 'POST'
  if ($result.ok) { Update-Clients -Select $client.slug }
})

$ui.BtnDelApp.Add_Click({
  $client = Get-SelectedClient
  if (-not $client) { return }
  if (-not (Ask "برنامهٔ «$($client.name)» حذف شود؟`r`n`r`nکاربرانش می‌مانند؛ فقط تنظیمات و کلیدش پاک می‌شود.")) { return }
  $result = Admin "/api/app-admin/clients/$($client.slug)" 'DELETE'
  if ($result.ok) { Update-Clients; Update-Overview }
})

$ui.BtnCopyApi.Add_Click({ Copy-Clip $ui.TxtApiCard.Text })

# ------------------------------- OTP ---------------------------------------
function Format-Result {
  param($Result, [string]$Title)
  if (-not $Result.ok -and $Result.status -eq 0) {
    return "$Title`r`n`r`nسرور جواب نداد. آیا روشن است؟`r`n$($Result.error)"
  }
  $body = ''
  if ($Result.data) {
    try { $body = ($Result.data | ConvertTo-Json -Depth 6) } catch { $body = [string]$Result.data }
  }
  $hint = ''
  if ($Result.data -and $Result.data.message) { $hint = "`r`n$($Result.data.message)`r`n" }
  return "$Title — پاسخِ سرور: $($Result.status)$hint`r`n$body"
}

$ui.BtnSendCode.Add_Click({
  $target = $ui.TxtOtpTarget.Text.Trim()
  if (-not $target) { Set-Text $ui.LblOtpState 'اول شماره یا ایمیل را بنویسید' $script:Brushes.Warn; return }
  $app = [string]$ui.CmbOtpApp.SelectedItem
  if (-not $app) { $app = 'main' }

  Set-Text $ui.LblOtpState '… در حالِ فرستادن' $script:Brushes.Muted
  Pump
  $result = Invoke-Json -Url "http://127.0.0.1:$($script:Port)/api/app/auth/request-code" -Method 'POST' -Body @{ to = $target; app = $app }
  Set-Text $ui.TxtOtpOut (Format-Result -Result $result -Title 'درخواستِ کد')

  if ($result.ok -and $result.data.sent) {
    Set-Text $ui.LblOtpState "رفت — $($result.data.tookMs) میلی‌ثانیه" $script:Brushes.Good
  } elseif ($result.ok -and $result.data.needsSetup) {
    Set-Text $ui.LblOtpState 'پیامک/ایمیل تنظیم نشده — کد در ترمینال نوشته شد' $script:Brushes.Warn
  } else {
    Set-Text $ui.LblOtpState 'نرفت — نتیجه را بخوانید' $script:Brushes.Bad
  }
})

$ui.BtnVerifyCode.Add_Click({
  $target = $ui.TxtOtpTarget.Text.Trim()
  $code = $ui.TxtOtpCode.Text.Trim()
  if (-not $target -or -not $code) { Set-Text $ui.LblOtpState 'شماره و کد را بنویسید' $script:Brushes.Warn; return }
  $app = [string]$ui.CmbOtpApp.SelectedItem
  if (-not $app) { $app = 'main' }

  $result = Invoke-Json -Url "http://127.0.0.1:$($script:Port)/api/app/auth/verify-code" -Method 'POST' -Body @{ to = $target; code = $code; app = $app }
  Set-Text $ui.TxtOtpOut (Format-Result -Result $result -Title 'بررسیِ کد')
  if ($result.ok -and $result.data.ok) {
    Set-Text $ui.LblOtpState 'وارد شد ✔' $script:Brushes.Good
  } else {
    Set-Text $ui.LblOtpState 'کد قبول نشد' $script:Brushes.Bad
  }
})

# ----------------------------- تنظیمات -------------------------------------
$ui.BtnSaveSettings.Add_Click({
  $port = $ui.TxtMailPort.Text.Trim()
  if (-not $port) { $port = '465' }
  $mailPass = $ui.TxtMailPass.Password
  if ($mailPass -match '^\w{4}\s+\w{4}\s+\w{4}\s+\w{4}$') {
    $mailPass = ($mailPass -replace '\s', '')
    $ui.TxtMailPass.Password = $mailPass
  }

  $values = @{
    'OTP_EMAIL_HOST'   = $ui.TxtMailHost.Text.Trim()
    'OTP_EMAIL_PORT'   = $port
    'OTP_EMAIL_SECURE' = $(if ($port -eq '465') { '1' } else { '0' })
    'OTP_EMAIL_USER'   = $ui.TxtMailUser.Text.Trim()
    'OTP_EMAIL_PASS'   = $mailPass
    'OTP_EMAIL_FROM'   = $ui.TxtMailUser.Text.Trim()
    'OTP_SMS_PROVIDER' = [string]$ui.CmbSmsProvider.SelectedItem
    'OTP_SMS_KEY'      = $ui.TxtSmsKey.Password.Trim()
    'OTP_SMS_SENDER'   = $ui.TxtSmsSender.Text.Trim()
    'OTP_SMS_TEMPLATE' = $ui.TxtSmsTemplate.Text.Trim()
    'HLP_AI_ENABLED'   = $(if ($ui.ChkAi.IsChecked) { '1' } else { '0' })
  }
  if (-not $values['OTP_EMAIL_USER']) {
    $values['OTP_EMAIL_HOST'] = ''
    $values['OTP_EMAIL_PASS'] = ''
    $values['OTP_EMAIL_FROM'] = ''
  }

  Set-EnvValues -Path $script:EnvPath -Values $values | Out-Null
  Set-Text $ui.LblSettingsState 'ذخیره شد — سرور دوباره بالا می‌آید…' $script:Brushes.Muted
  Pump
  Restart-Server
  Set-Text $ui.LblSettingsState 'ذخیره شد و سرور دوباره بالا آمد ✔' $script:Brushes.Good
})

$ui.BtnOpenEnv.Add_Click({
  if (-not (Test-Path -LiteralPath $script:EnvPath)) { Set-EnvValues -Path $script:EnvPath -Values @{} | Out-Null }
  Start-Process 'notepad.exe' -ArgumentList """$($script:EnvPath)"""
})

# ----------------------------- ترمینال -------------------------------------
$ui.BtnLogRefresh.Add_Click({ Update-Terminal -Force $true })
$ui.BtnLogCopy.Add_Click({ Copy-Clip $ui.TxtLog.Text })
$ui.BtnLogClear.Add_Click({
  Clear-PanelLog -ServerDir $script:ServerDir | Out-Null
  Update-Terminal -Force $true
})

# --------------------------- به‌روزرسانی ------------------------------------
function Test-Update {
  param([bool]$Quiet = $false)

  $branch = $ui.TxtBranch.Text.Trim()
  if (-not $branch) { $branch = $script:DefaultBranch }
  Save-DesktopSettings -ServerDir $script:ServerDir -Settings @{ branch = $branch; autoCheck = [bool]$ui.ChkAutoCheck.IsChecked } | Out-Null

  if (-not $Quiet) {
    Set-Text $ui.TxtUpdateOut "در حالِ پرسیدن از GitHub (شاخهٔ $branch)…"
    Pump
  }

  $remote = Get-RemoteVersion -Branch $branch
  if (-not $remote) {
    if (-not $Quiet) { Set-Text $ui.TxtUpdateOut "نسخهٔ تازه خوانده نشد.`r`n`r`nیا اینترنت وصل نیست، یا نامِ شاخه ($branch) اشتباه است." }
    $ui.BtnDoUpdate.IsEnabled = $false
    return $false
  }

  if ((Compare-AppVersion -Left $remote -Right $script:Version) -eq 1) {
    Set-Text $ui.TxtUpdateOut "نسخهٔ تازه هست!`r`n`r`n  نسخهٔ شما:  $($script:Version)`r`n  روی GitHub: $remote`r`n`r`nدکمهٔ «به‌روزرسانی کن» را بزنید."
    $ui.BtnDoUpdate.IsEnabled = $true
    $script:UpdateReady = $remote
    return $true
  }

  $ui.BtnDoUpdate.IsEnabled = $false
  if (-not $Quiet) { Set-Text $ui.TxtUpdateOut "شما آخرین نسخه را دارید ($($script:Version))." }
  return $false
}

$ui.BtnCheckUpdate.Add_Click({ Test-Update | Out-Null })

$ui.BtnDoUpdate.Add_Click({
  if (-not (Ask 'سرور چند لحظه خاموش می‌شود و بعد خودش برمی‌گردد. ادامه بدهم؟')) { return }
  $branch = $ui.TxtBranch.Text.Trim()
  if (-not $branch) { $branch = $script:DefaultBranch }
  $ui.BtnDoUpdate.IsEnabled = $false
  Set-Text $ui.TxtUpdateOut ''

  $report = Install-Update -Branch $branch -ProjectRoot $script:ProjectRoot -ServerDir $script:ServerDir -OnStep {
    param($message)
    $ui.TxtUpdateOut.AppendText("$message`r`n")
    $ui.TxtUpdateOut.ScrollToEnd()
    Pump
  }

  if ($report.ok) {
    $ui.TxtUpdateOut.AppendText("`r`nتمام شد. نسخهٔ تازه: $($report.version)`r`nبرای اینکه خودِ پنجره هم تازه شود، یک‌بار ببندید و باز کنید.`r`n")
  } else {
    $ui.TxtUpdateOut.AppendText("`r`nبه‌روزرسانی نشد: $($report.error)`r`nدادهٔ شما دست‌نخورده است.`r`n")
  }
  Refresh-All
})

$ui.BtnShortcut.Add_Click({
  $linkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) (Get-ShortcutName)
  $link = New-ProgramShortcut -InstallRoot $script:ProjectRoot -LinkPath $linkPath
  if ($link) { Say "میان‌بر ساخته شد:`r`n$link" } else { Say 'میان‌بر ساخته نشد.' }
})

# ---------------------------------------------------------------------------
#  راه‌اندازی
# ---------------------------------------------------------------------------
$script:Ready = $false
$script:StartupErrors = @()

function Invoke-Safely {
  param([string]$Name, [scriptblock]$Work)
  try { & $Work } catch {
    $script:StartupErrors += $Name
    Write-AppError -ErrorRecord $_ -Where $Name -ServerDir $script:ServerDir | Out-Null
  }
}

# پر کردنِ فهرست‌های آماده
[void]$ui.CmbKindFilter.Items.Add('همه')
foreach ($kind in $script:KindOrder) {
  [void]$ui.CmbKindFilter.Items.Add($script:KindNames[$kind])
  [void]$ui.CmbAppKind.Items.Add($script:KindNames[$kind])
}
$ui.CmbKindFilter.SelectedIndex = 0
$ui.CmbAppKind.SelectedIndex = 1
foreach ($provider in @('none', 'kavenegar', 'smsir', 'melipayamak', 'ghasedak', 'webhook')) {
  [void]$ui.CmbSmsProvider.Items.Add($provider)
}
$ui.CmbSmsProvider.SelectedIndex = 0

Set-Text $ui.LblVersion "نسخهٔ $($script:Version)"
Set-Text $ui.LblUpdateVersion "نسخهٔ نصب‌شده: $($script:Version)"
$ui.TxtOtpTarget.Text = ''
$ui.TxtBranch.Text = $script:DefaultBranch

$script:Timer = New-Object System.Windows.Threading.DispatcherTimer
$script:Timer.Interval = [TimeSpan]::FromMilliseconds(2000)
$script:Ticks = 0
$script:Timer.Add_Tick({
  $script:Ticks++
  Invoke-Safely 'وضعیت' { Update-Status | Out-Null }
  if ($script:Ticks % 5 -eq 0) { Invoke-Safely 'خلاصه' { Update-Overview } }
  if ($script:CurrentNav -eq 'NavTerminal' -and $ui.ChkLogAuto.IsChecked) {
    Invoke-Safely 'ترمینال' { Update-Terminal }
  }
})

$script:Window.Add_ContentRendered({
  Hide-OwnConsole
  Show-WindowForReal -Form $script:Window
})

$script:Window.Add_Loaded({
  Invoke-Safely 'وضعیت' { Update-Status | Out-Null }
  Invoke-Safely 'خلاصه' { Update-Overview }
  Invoke-Safely 'تنظیمات' { Update-SettingsForm }
  Invoke-Safely 'ترمینال' { Update-Terminal -Force $true }
  Invoke-Safely 'به‌روزرسانی' {
    $saved = Get-DesktopSettings -ServerDir $script:ServerDir
    $ui.TxtBranch.Text = $saved.branch
    $ui.ChkAutoCheck.IsChecked = [bool]$saved.autoCheck
  }

  # اگر میان‌برِ دسکتاپ نبود (نصب نساخته بود، یا کسی پاکش کرده) همین‌جا ساخته
  # می‌شود — تا دفعهٔ بعد کاربر دنبالِ راهِ باز کردنِ برنامه نگردد.
  Invoke-Safely 'میان‌بر' {
    $made = Repair-DesktopShortcut -InstallRoot $script:ProjectRoot
    if ($made) { Set-Text $ui.LblSubtitle 'میان‌برِ برنامه روی دسکتاپ ساخته شد.' $script:Brushes.Good }
  }

  $script:Ready = $true
  Show-Page 'NavHome'
  $script:Timer.Start()

  if ($script:StartupErrors.Count -gt 0) {
    Set-Text $ui.LblSubtitle "چند بخش بالا نیامد: $($script:StartupErrors -join '، ')" $script:Brushes.Warn
  }

  if ($ui.ChkAutoCheck.IsChecked) {
    # ⚠️ این تایمر باید در سطحِ اسکریپت بماند: اگر متغیرِ محلی باشد، وقتی
    #    تیکش می‌زند دیگر پیدا نمی‌شود و $null.Stop() کلِ پنجره را می‌بندد.
    $script:StartupCheck = New-Object System.Windows.Threading.DispatcherTimer
    $script:StartupCheck.Interval = [TimeSpan]::FromMilliseconds(2500)
    $script:StartupCheck.Add_Tick({
      try { $script:StartupCheck.Stop() } catch { }
      Invoke-Safely 'بررسیِ نسخه' {
        if (Test-Update -Quiet $true) {
          $ui.NavUpdate.Content = 'به‌روزرسانی  ●'
        }
      }
    })
    $script:StartupCheck.Start()
  }
})

$script:Window.Add_Closed({
  try { $script:Timer.Stop() } catch { }
  try { if ($script:StartupCheck) { $script:StartupCheck.Stop() } } catch { }
})

<#
  تورِ ایمنی: اگر خطایی در هر دکمه یا تایمری رخ دهد، ویندوز آن را به بیرون
  پرتاب می‌کند و پنجره بسته می‌شود. این‌جا می‌گیریمش، در گزارش می‌نویسیم و
  بالای پنجره خبر می‌دهیم — ولی برنامه باز می‌ماند.
#>
try {
  $script:Window.Dispatcher.Add_UnhandledException({
    param($sender, $eventArgs)
    try {
      $logPath = Write-AppError -ErrorRecord $eventArgs.Exception -Where 'یکی از دکمه‌ها' -ServerDir $script:ServerDir
      Set-Text $ui.LblSubtitle "یک خطا رخ داد ولی برنامه باز ماند — گزارش: $logPath" $script:Brushes.Warn
    } catch { }
    $eventArgs.Handled = $true
  })
} catch { }

# پنجره تمام‌صفحه باز می‌شود — همان چیزی که خواسته شده
$script:Window.WindowState = [System.Windows.WindowState]::Maximized

try {
  $null = $script:Window.ShowDialog()
} catch {
  $logPath = Write-AppError -ErrorRecord $_ -Where 'اجرای پنجره' -ServerDir $script:ServerDir
  [System.Windows.MessageBox]::Show("برنامه بسته شد:`r`n`r`n$($_.Exception.Message)`r`n`r`nگزارش: $logPath", 'سرور خانگی') | Out-Null
}
