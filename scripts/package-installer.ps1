$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$helperProject = Join-Path $projectRoot 'src\helper\CairnCodex.GrimDawn\CairnCodex.GrimDawn.csproj'
$helperPublish = Join-Path $projectRoot 'dist\helper-win-x64'
$prerequisiteRoot = Join-Path $projectRoot 'dist\prerequisites'

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Electron application build failed.' }
  & dotnet publish $helperProject --configuration Release --runtime win-x64 --self-contained true --output $helperPublish
  if ($LASTEXITCODE -ne 0) { throw 'Self-contained helper publish failed.' }
  & (Join-Path $PSScriptRoot 'prepare-vc-redist.ps1') -OutputDirectory $prerequisiteRoot
  & (Join-Path $PSScriptRoot 'prepare-builder-app.ps1')
  & npx.cmd electron-builder --projectDir dist\builder-app --win nsis
  if ($LASTEXITCODE -ne 0) { throw 'NSIS installer build failed.' }
  & node (Join-Path $PSScriptRoot 'audit-package.mjs') (Join-Path $projectRoot 'dist\builder\win-unpacked')
  if ($LASTEXITCODE -ne 0) { throw 'Installer payload audit failed.' }
  $package = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
  $appIcon = Join-Path $projectRoot 'build\icon.ico'
  & (Join-Path $PSScriptRoot 'test-app-icon.ps1') `
    -ExecutablePath (Join-Path $projectRoot 'dist\builder\win-unpacked\Cairn Codex.exe') `
    -IconPath $appIcon
  if ($LASTEXITCODE -ne 0) { throw 'Installer application icon verification failed.' }
  & (Join-Path $PSScriptRoot 'test-app-icon.ps1') `
    -ExecutablePath (Join-Path $projectRoot "dist\builder\Cairn-Codex-$($package.version)-Setup.exe") `
    -IconPath $appIcon
  if ($LASTEXITCODE -ne 0) { throw 'Installer executable icon verification failed.' }
} finally {
  Pop-Location
}
