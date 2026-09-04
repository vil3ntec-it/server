# ---------------------------------------------------------------------------
#  Fix the permanent address, through the panel's own API.
#
#  WHY THIS EXISTS: editing config.yml from outside does not stick. The panel
#  rebuilds that file from its database whenever it starts or syncs routes, so
#  any hand-repair is wiped within seconds. The only thing that lasts is asking
#  the panel to do it - which is exactly what the "create permanent address"
#  button does. This script presses that button from the command line.
#
#  This file is the readable source. The .bat next to it carries the same
#  script base64-encoded, because batch escaping of PowerShell is a minefield.
#  If you change this file, re-encode it:
#
#      [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-Content -Raw fix-address.ps1)))
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '  =========================================================='
Write-Host '    Fix the permanent address'
Write-Host '  =========================================================='
Write-Host ''

$base = Read-Host '  Panel address [http://127.0.0.1:4700]'
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'http://127.0.0.1:4700' }
$base = $base.TrimEnd('/')

# The panel has to be running - everything below talks to it
try {
  Invoke-RestMethod -Uri "$base/health" -TimeoutSec 8 | Out-Null
} catch {
  Write-Host ''
  Write-Host "  The panel is not answering at $base"
  Write-Host '  Start the panel first, then run this again.'
  Write-Host ''
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}

$target = Read-Host '  Address to create [api.vill3n.top]'
if ([string]::IsNullOrWhiteSpace($target)) { $target = 'api.vill3n.top' }

$user = Read-Host '  Panel username'
$sec = Read-Host '  Panel password' -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

function Show-Body($err) {
  # The useful part of a failure is the server's body, not the status line
  try {
    $s = $err.Exception.Response.GetResponseStream()
    $r = New-Object IO.StreamReader($s)
    $t = $r.ReadToEnd()
    if ($t) { Write-Host "  $t" }
  } catch { }
}

Write-Host ''
Write-Host '  [1/2] Signing in ...'
try {
  $login = Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post `
    -ContentType 'application/json' `
    -Body (@{ username = $user; password = $pass } | ConvertTo-Json)
} catch {
  Write-Host "  Sign-in failed: $($_.Exception.Message)"
  Show-Body $_
  Write-Host ''
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}

$token = $login.token
if (-not $token) {
  Write-Host '  The panel did not return a token.'
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}
$headers = @{ Authorization = "Bearer $token" }

Write-Host "  [2/2] Creating $target ..."
try {
  $result = Invoke-RestMethod -Uri "$base/api/site-server/tunnel/named/setup" -Method Post `
    -Headers $headers -ContentType 'application/json' `
    -Body (@{ hostname = $target } | ConvertTo-Json) -TimeoutSec 180

  Write-Host ''
  Write-Host '  =========================================================='
  Write-Host '    DONE.'
  Write-Host ''
  Write-Host "    Server address:  https://$target"
  Write-Host ''
  Write-Host '    Give it about 30 seconds, then open:'
  Write-Host "      https://$target/health"
  Write-Host '  =========================================================='
  $result | ConvertTo-Json -Depth 5
} catch {
  Write-Host ''
  Write-Host "  Failed: $($_.Exception.Message)"
  Show-Body $_
  Write-Host ''
  Write-Host '  Send this screen to the engineer.'
}

Write-Host ''
Read-Host '  Press Enter to close' | Out-Null
