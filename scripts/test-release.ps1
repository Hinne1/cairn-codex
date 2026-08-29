$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $projectRoot
try {
  & npm.cmd run verify
  if ($LASTEXITCODE -ne 0) { throw 'Game-independent verification failed.' }

  & npm.cmd run smoke:desktop
  if ($LASTEXITCODE -ne 0) { throw 'Installed-game desktop smoke test failed.' }

  & npm.cmd run package:release
  if ($LASTEXITCODE -ne 0) { throw 'Release packaging failed.' }

  & npm.cmd run test:installer
  if ($LASTEXITCODE -ne 0) { throw 'Installer lifecycle test failed.' }
} finally {
  Pop-Location
}
