$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageRoot = Join-Path $projectRoot 'dist\package\Cairn Codex-win32-x64'
$electronRoot = Join-Path $projectRoot 'node_modules\electron\dist'
$helperProject = Join-Path $projectRoot 'src\helper\CairnCodex.GrimDawn\CairnCodex.GrimDawn.csproj'
$helperPublish = Join-Path $projectRoot 'dist\helper-win-x64'

function Get-FileSha256 {
  param([Parameter(Mandatory)] [string] $Path)

  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite
  )
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Clear-PackagePreservingHook {
  param(
    [Parameter(Mandatory)] [string] $Root,
    [Parameter(Mandatory)] [string] $Hook
  )

  $resolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  $resolvedHook = [System.IO.Path]::GetFullPath($Hook)
  if (-not $resolvedHook.StartsWith($resolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to preserve a hook outside the package directory: $resolvedHook"
  }

  Get-ChildItem -LiteralPath $resolvedRoot -Recurse -Force -File |
    Where-Object { -not $_.FullName.Equals($resolvedHook, [StringComparison]::OrdinalIgnoreCase) } |
    Remove-Item -Force

  Get-ChildItem -LiteralPath $resolvedRoot -Recurse -Force -Directory |
    Sort-Object { $_.FullName.Length } -Descending |
    Where-Object {
      -not $resolvedHook.StartsWith($_.FullName.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
    } |
    Remove-Item -Force
}

function Copy-PublishedHelperPreservingHook {
  param(
    [Parameter(Mandatory)] [string] $Source,
    [Parameter(Mandatory)] [string] $Destination,
    [Parameter(Mandatory)] [string] $HookName
  )

  Get-ChildItem -LiteralPath $Source -Force |
    Where-Object { $_.Name -ne 'native' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force }

  $sourceNative = Join-Path $Source 'native'
  $destinationNative = Join-Path $Destination 'native'
  New-Item -ItemType Directory -Path $destinationNative -Force | Out-Null
  Get-ChildItem -LiteralPath $sourceNative -Force |
    Where-Object { $_.Name -ne $HookName } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destinationNative -Recurse -Force }
}

if (-not $packageRoot.StartsWith((Join-Path $projectRoot 'dist\package'), [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to package outside the project's dist directory: $packageRoot"
}

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Electron application build failed.' }

  # Some clean CI environments restore the npm package without running
  # Electron's binary-download postinstall. The TypeScript build does not need
  # that runtime, but the portable package does. Recover it deterministically
  # from Electron's pinned install script instead of failing later at Copy-Item.
  if (-not (Test-Path -LiteralPath $electronRoot)) {
    $electronInstall = Join-Path $projectRoot 'node_modules\electron\install.js'
    if (-not (Test-Path -LiteralPath $electronInstall)) {
      throw "Electron package is incomplete; missing installer: $electronInstall"
    }

    Write-Host 'Electron runtime is absent; downloading the pinned runtime for packaging.'
    & node $electronInstall
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $electronRoot)) {
      throw 'Electron runtime download failed; portable packaging cannot continue.'
    }
  }

  # Public packages must not depend on a separately installed .NET runtime.
  & dotnet publish $helperProject --configuration Release --runtime win-x64 --self-contained true --output $helperPublish
  if ($LASTEXITCODE -ne 0) { throw 'Grim Dawn helper publish failed.' }

  $hookName = 'ItemAssistantHook_x64.dll'
  $packagedHook = Join-Path $packageRoot "resources\helper\native\$hookName"
  $publishedHook = Join-Path $helperPublish "native\$hookName"
  $preserveLiveHook = $false
  if (Test-Path -LiteralPath $packageRoot) {
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
        $packagedHash = Get-FileSha256 -Path $packagedHook
        $publishedHash = Get-FileSha256 -Path $publishedHook
        if ($packagedHash -ne $publishedHash) {
          throw 'Grim Dawn has the previous live hook loaded and the native hook has changed. Close Grim Dawn before packaging this hook update; the existing package was left untouched.'
        }
        $preserveLiveHook = $true
        Write-Host 'Grim Dawn is using an unchanged live hook; preserving that DLL while updating the rest of Cairn Codex.'
      }
    }
    if ($preserveLiveHook) {
      Clear-PackagePreservingHook -Root $packageRoot -Hook $packagedHook
    } else {
      Remove-Item -LiteralPath $packageRoot -Recurse -Force
    }
  }
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
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
  if ($preserveLiveHook) {
    Copy-PublishedHelperPreservingHook -Source $helperPublish -Destination $packagedHelper -HookName $hookName
  } else {
    Copy-Item -Path (Join-Path $helperPublish '*') -Destination $packagedHelper -Recurse -Force
  }

  # Electron ships its own top-level LICENSE. Keep that file and add Cairn's
  # license under an unambiguous name rather than overwriting it.
  Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $packageRoot 'LICENSE.CAIRN-CODEX.txt') -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination $packageRoot -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $packageRoot -Force

  Write-Host ''
  Write-Host "Packaged Cairn Codex: $appExe"
} finally {
  Pop-Location
}
