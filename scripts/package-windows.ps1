$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageRoot = Join-Path $projectRoot 'dist\Cairn Codex-win32-x64'
$electronRoot = Join-Path $projectRoot 'node_modules\electron\dist'
$helperProject = Join-Path $projectRoot 'src\helper\CairnCodex.GrimDawn\CairnCodex.GrimDawn.csproj'
$helperPublish = Join-Path $projectRoot 'dist\helper-win-x64'

if (-not $packageRoot.StartsWith((Join-Path $projectRoot 'dist'), [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to package outside the project's dist directory: $packageRoot"
}

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Electron application build failed.' }

  & dotnet publish $helperProject --configuration Release --runtime win-x64 --self-contained false --output $helperPublish
  if ($LASTEXITCODE -ne 0) { throw 'Grim Dawn helper publish failed.' }

  if (Test-Path -LiteralPath $packageRoot) {
    $packagedHook = Join-Path $packageRoot 'resources\helper\native\ItemAssistantHook_x64.dll'
    if (Test-Path -LiteralPath $packagedHook) {
      try {
        $lockProbe = [System.IO.File]::Open(
          $packagedHook,
          [System.IO.FileMode]::Open,
          [System.IO.FileAccess]::ReadWrite,
          [System.IO.FileShare]::None
        )
        $lockProbe.Dispose()
      } catch {
        throw 'The packaged live hook is still loaded by Grim Dawn. Close Grim Dawn before replacing the distributable; the existing package was left untouched.'
      }
    }
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $packageRoot | Out-Null
  Copy-Item -Path (Join-Path $electronRoot '*') -Destination $packageRoot -Recurse -Force

  $electronExe = Join-Path $packageRoot 'electron.exe'
  $appExe = Join-Path $packageRoot 'Cairn Codex.exe'
  Move-Item -LiteralPath $electronExe -Destination $appExe -Force

  $resourcesRoot = Join-Path $packageRoot 'resources'
  $defaultApp = Join-Path $resourcesRoot 'default_app.asar'
  if (Test-Path -LiteralPath $defaultApp) {
    Remove-Item -LiteralPath $defaultApp -Force
  }

  $appRoot = Join-Path $resourcesRoot 'app'
  $appOut = Join-Path $appRoot 'out'
  $packagedHelper = Join-Path $resourcesRoot 'helper'
  New-Item -ItemType Directory -Path $appRoot, $appOut, $packagedHelper -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $appRoot -Force
  Copy-Item -Path (Join-Path $projectRoot 'out\*') -Destination $appOut -Recurse -Force
  Copy-Item -Path (Join-Path $helperPublish '*') -Destination $packagedHelper -Recurse -Force

  Write-Host ''
  Write-Host "Packaged Cairn Codex: $appExe"
} finally {
  Pop-Location
}
