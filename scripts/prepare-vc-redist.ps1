param(
  [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'

# Load the security module from the active PowerShell runtime. Developer shells
# can prepend a different PowerShell edition's module cache to PSModulePath,
# which makes command auto-loading select an incompatible assembly.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist')).TrimEnd('\')
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $distRoot 'prerequisites'
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $resolvedOutput.StartsWith($distRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to stage the VC++ prerequisite outside dist: $resolvedOutput"
}

$downloadUrl = 'https://aka.ms/vc14/vc_redist.x64.exe'
$minimumVersion = [Version]'14.43.0.0'
$cacheRoot = Join-Path $projectRoot 'local-cache\prerequisites'
$cachedRedist = if ($env:CAIRN_CODEX_VC_REDIST_PATH) {
  [IO.Path]::GetFullPath($env:CAIRN_CODEX_VC_REDIST_PATH)
} else {
  Join-Path $cacheRoot 'vc_redist.x64.exe'
}

function Get-VerifiedRedist {
  param([Parameter(Mandatory)] [string] $Path)

  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $file = Get-Item -LiteralPath $Path
  $version = try { [Version]$file.VersionInfo.FileVersion } catch { return $null }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  $signer = $signature.SignerCertificate.Subject
  if ($signature.Status -ne 'Valid' -or
      $signer -notmatch '(?i)(?:^|,)\s*O=Microsoft Corporation(?:,|$)' -or
      $file.VersionInfo.ProductName -notmatch '(?i)Microsoft Visual C\+\+.*Redistributable' -or
      $version -lt $minimumVersion) {
    return $null
  }
  return [ordered]@{
    path = $file.FullName
    version = $version.ToString()
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    signer = $signer
  }
}

$verified = Get-VerifiedRedist -Path $cachedRedist
if (-not $verified) {
  if ($env:CAIRN_CODEX_VC_REDIST_PATH) {
    throw 'CAIRN_CODEX_VC_REDIST_PATH is not a valid Microsoft-signed x64 VC++ Redistributable 14.43 or newer.'
  }
  New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
  $temporary = Join-Path $cacheRoot ("vc_redist.x64.$([Guid]::NewGuid().ToString('N')).tmp.exe")
  try {
    Write-Host 'Downloading the latest Microsoft-signed x64 VC++ Redistributable.'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $temporary
    $verified = Get-VerifiedRedist -Path $temporary
    if (-not $verified) {
      throw 'The downloaded x64 VC++ Redistributable failed Microsoft signature, product, or minimum-version verification.'
    }
    Move-Item -LiteralPath $temporary -Destination $cachedRedist -Force
    $verified = Get-VerifiedRedist -Path $cachedRedist
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$outputRedist = Join-Path $resolvedOutput 'vc_redist.x64.exe'
Copy-Item -LiteralPath $verified.path -Destination $outputRedist -Force
$manifest = [ordered]@{
  schemaVersion = 1
  source = $downloadUrl
  version = $verified.version
  minimumVersion = $minimumVersion.ToString()
  sha256 = $verified.sha256
  signer = $verified.signer
}
$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText(
  (Join-Path $resolvedOutput 'vc-redist-manifest.json'),
  (($manifest | ConvertTo-Json) + "`r`n"),
  $utf8NoBom)

Write-Host "Verified VC++ x64 prerequisite $($verified.version) ($($verified.sha256))."
