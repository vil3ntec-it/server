# VILL3N site - Windows background service helper (no admin rights, no extra software).
#   service.ps1 install   -> start hidden now + start at every Windows sign-in (shortcut in the Startup folder)
#   service.ps1 remove    -> stop it and remove it from start-up (data is never touched)
param([Parameter(Mandatory = $true)][ValidateSet('install', 'remove', 'run')][string]$Action)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runBat = Join-Path $PSScriptRoot 'run.bat'
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'VILL3N Site.lnk'

function Start-Hidden {
  Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('"' + $runBat + '"') -WorkingDirectory $root -WindowStyle Hidden
}

function Stop-Site {
  # the runner loop that belongs to THIS folder
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($runBat) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # the server itself: its process id is written in data\.lock
  $lock = Join-Path $root 'data\.lock'
  if (Test-Path $lock) {
    $id = 0
    if ([int]::TryParse((Get-Content $lock -Raw).Trim(), [ref]$id) -and $id -gt 0) {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    }
  }
}

switch ($Action) {
  'run' { Start-Hidden }
  'install' {
    Stop-Site
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($shortcut)
    $s.TargetPath = Join-Path $PSHOME 'powershell.exe'
    $s.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'service.ps1') + '" run'
    $s.WorkingDirectory = $root
    $s.WindowStyle = 7
    $s.Description = 'VILL3N site (starts hidden at sign-in)'
    $s.Save()
    Start-Hidden
    Write-Host ''
    Write-Host ' Done. The site is running now and starts by itself whenever you sign in to Windows.'
    Write-Host ' Log file: data\logs\server.log'
  }
  'remove' {
    if (Test-Path $shortcut) { Remove-Item -Force $shortcut }
    Stop-Site
    Write-Host ''
    Write-Host ' Removed. The site no longer starts with Windows. Your data folder was not touched.'
  }
}
