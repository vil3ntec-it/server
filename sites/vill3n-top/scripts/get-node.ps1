# Downloads a portable Node.js into <site>\runtime\node (no installer, no admin rights, nothing added to the system).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
$version = 'v22.12.0'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$name = "node-$version-win-$arch"
$zip = Join-Path $runtime "$name.zip"
try {
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/$name.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $runtime -Force
  $target = Join-Path $runtime 'node'
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Rename-Item -Path (Join-Path $runtime $name) -NewName 'node'
  Remove-Item -Force $zip
  Write-Host " Node.js $version is ready in runtime\node"
} catch {
  Write-Host " Download failed: $($_.Exception.Message)"
  exit 1
}
