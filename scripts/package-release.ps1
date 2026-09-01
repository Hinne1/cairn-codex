param(
  [switch] $AllowDirty
)

$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageScript = Join-Path $PSScriptRoot 'package-windows.ps1'
$packageJson = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
$packageRoot = Join-Path $projectRoot 'dist\package\Cairn Codex-win32-x64'
$releaseRoot = Join-Path $projectRoot 'dist\release'
$artifactName = "Cairn-Codex-$version-win-x64"
$zipPath = Join-Path $releaseRoot "$artifactName.zip"
$checksumPath = Join-Path $releaseRoot "$artifactName.sha256"
$manifestPath = Join-Path $releaseRoot "$artifactName.manifest.json"
$installerSource = Join-Path $projectRoot "dist\builder\Cairn-Codex-$version-Setup.exe"
$installerPath = Join-Path $releaseRoot "Cairn-Codex-$version-Setup.exe"

function Get-CairnSha256([string] $Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

function Get-UnsignedBetaSignatureStatus([string] $Path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'NotSigned') {
    throw "The unsigned-beta release policy expected an unsigned Cairn binary, but $Path reported Authenticode status $($signature.Status). Review every release target and native fingerprint deliberately before changing the policy."
  }
  return [string]$signature.Status
}

$dirtyFiles = @(& git -c "safe.directory=$projectRoot" -C $projectRoot status --porcelain)
if ($dirtyFiles.Count -gt 0 -and -not $AllowDirty) {
  throw 'Refusing to create a release artifact from a dirty worktree. Commit or stash changes, or pass -AllowDirty for a local test build.'
}

& $packageScript
if ($LASTEXITCODE -ne 0) { throw 'Windows package creation failed.' }

& node (Join-Path $PSScriptRoot 'audit-package.mjs') $packageRoot
if ($LASTEXITCODE -ne 0) { throw 'Packaged-content audit failed.' }

$packagedHelper = Join-Path $packageRoot 'resources\helper\CairnCodex.GrimDawn.exe'
& node (Join-Path $PSScriptRoot 'smoke-helper.mjs') $packagedHelper
if ($LASTEXITCODE -ne 0) { throw 'Packaged helper self-test failed.' }

Push-Location $projectRoot
try {
  & (Join-Path $PSScriptRoot 'prepare-builder-app.ps1')
  & npx.cmd electron-builder --projectDir dist\builder-app --win nsis
  if ($LASTEXITCODE -ne 0) { throw 'NSIS installer build failed.' }
} finally {
  Pop-Location
}
$installerPayload = Join-Path $projectRoot 'dist\builder\win-unpacked'
& node (Join-Path $PSScriptRoot 'audit-package.mjs') $installerPayload
if ($LASTEXITCODE -ne 0) { throw 'Installer payload audit failed.' }

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
Copy-Item -LiteralPath $installerSource -Destination $installerPath -Force

$authenticode = [ordered]@{
  portableApp = Get-UnsignedBetaSignatureStatus (Join-Path $packageRoot 'Cairn Codex.exe')
  portableHelper = Get-UnsignedBetaSignatureStatus (Join-Path $packageRoot 'resources\helper\CairnCodex.GrimDawn.exe')
  portableHook = Get-UnsignedBetaSignatureStatus (Join-Path $packageRoot 'resources\helper\native\ItemAssistantHook_x64.dll')
  portableInjector = Get-UnsignedBetaSignatureStatus (Join-Path $packageRoot 'resources\helper\native\DllInjector64.exe')
  installedApp = Get-UnsignedBetaSignatureStatus (Join-Path $installerPayload 'Cairn Codex.exe')
  installedHelper = Get-UnsignedBetaSignatureStatus (Join-Path $installerPayload 'resources\helper\CairnCodex.GrimDawn.exe')
  installedHook = Get-UnsignedBetaSignatureStatus (Join-Path $installerPayload 'resources\helper\native\ItemAssistantHook_x64.dll')
  installedInjector = Get-UnsignedBetaSignatureStatus (Join-Path $installerPayload 'resources\helper\native\DllInjector64.exe')
  installer = Get-UnsignedBetaSignatureStatus $installerPath
}

$hash = Get-CairnSha256 $zipPath
$installerHash = Get-CairnSha256 $installerPath
$hookPath = Join-Path $packageRoot 'resources\helper\native\ItemAssistantHook_x64.dll'
$injectorPath = Join-Path $packageRoot 'resources\helper\native\DllInjector64.exe'
$vcRedistManifest = Get-Content (Join-Path $packageRoot 'resources\prerequisites\vc-redist-manifest.json') -Raw | ConvertFrom-Json
$manifest = [ordered]@{
  product = 'Cairn Codex'
  version = $version
  platform = 'win-x64'
  artifact = Split-Path $zipPath -Leaf
  artifactSha256 = $hash
  installer = Split-Path $installerPath -Leaf
  installerSha256 = $installerHash
  hookSha256 = Get-CairnSha256 $hookPath
  injectorSha256 = Get-CairnSha256 $injectorPath
  vcRedistVersion = [string]$vcRedistManifest.version
  vcRedistSha256 = [string]$vcRedistManifest.sha256
  authenticodePolicy = 'unsigned-beta'
  authenticode = $authenticode
  commit = (& git -c "safe.directory=$projectRoot" -C $projectRoot rev-parse HEAD).Trim()
  dirty = $dirtyFiles.Count -gt 0
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  $checksumPath,
  "$hash  $($manifest.artifact)`r`n$installerHash  $($manifest.installer)`r`n",
  $utf8NoBom)
[System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json) + "`r`n"), $utf8NoBom)

Write-Host ''
Write-Host "Release artifact: $zipPath"
Write-Host "SHA-256: $hash"
Write-Host "Installer: $installerPath"
Write-Host "Installer SHA-256: $installerHash"
