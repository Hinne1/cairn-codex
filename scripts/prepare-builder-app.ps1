$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stageRoot = Join-Path $projectRoot 'dist\builder-app'
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'dist')).TrimEnd('\')
$resolvedStage = [System.IO.Path]::GetFullPath($stageRoot)
if (-not $resolvedStage.StartsWith($distRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to prepare an installer stage outside dist: $resolvedStage"
}

if (Test-Path -LiteralPath $resolvedStage) {
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'out') -Destination $resolvedStage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\helper-win-x64') -Destination (Join-Path $resolvedStage 'helper') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\prerequisites') -Destination (Join-Path $resolvedStage 'prerequisites') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $resolvedStage 'LICENSE.CAIRN-CODEX.txt') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination $resolvedStage -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $resolvedStage -Force
New-Item -ItemType Directory -Path (Join-Path $resolvedStage 'build') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'build\icon.svg') -Destination (Join-Path $resolvedStage 'build\icon.svg') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'build\icon.ico') -Destination (Join-Path $resolvedStage 'build\icon.ico') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'installer-prerequisites.nsh') -Destination (Join-Path $resolvedStage 'build\installer-prerequisites.nsh') -Force

$source = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$stagePackage = [ordered]@{
  name = [string]$source.name
  version = [string]$source.version
  private = $true
  description = [string]$source.description
  author = $source.author
  main = './out/main/index.js'
  type = 'module'
  build = [ordered]@{
    appId = 'com.hinnestolzenberg.cairncodex'
    productName = 'Cairn Codex'
    electronVersion = '43.3.0'
    asar = $true
    directories = [ordered]@{ output = '../builder' }
    files = @('out/**/*', 'package.json')
    extraResources = @(
      [ordered]@{ from = 'helper'; to = 'helper' },
      [ordered]@{ from = 'prerequisites'; to = 'prerequisites' },
      [ordered]@{ from = 'build/icon.ico'; to = 'icon.ico' }
    )
    extraFiles = @('LICENSE.CAIRN-CODEX.txt', 'THIRD_PARTY_NOTICES.md', 'README.md')
    win = [ordered]@{
      target = 'nsis'
      icon = 'build/icon.ico'
      artifactName = 'Cairn-Codex-${version}-Setup.${ext}'
    }
    nsis = [ordered]@{
      oneClick = $false
      perMachine = $false
      allowToChangeInstallationDirectory = $true
      createDesktopShortcut = $true
      createStartMenuShortcut = $true
      shortcutName = 'Cairn Codex'
      installerIcon = 'build/icon.ico'
      uninstallerIcon = 'build/icon.ico'
      installerHeaderIcon = 'build/icon.ico'
      deleteAppDataOnUninstall = $false
      include = 'build/installer-prerequisites.nsh'
    }
  }
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  (Join-Path $resolvedStage 'package.json'),
  (($stagePackage | ConvertTo-Json -Depth 5) + "`r`n"),
  $utf8NoBom)
