param(
  [string] $InstallerPath,
  [string] $ReleaseManifestPath,
  [switch] $DisposableWindows,
  [switch] $PreflightOnly
)

$ErrorActionPreference = 'Stop'
if (-not $DisposableWindows -and -not $PreflightOnly) {
  throw 'Installer qualification requires -DisposableWindows inside a fresh disposable Windows VM. This installer uses production registry and shortcut identities; /D alone is not isolation. See docs/installer-qualification.md.'
}
if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess -or [Environment]::OSVersion.Platform -ne 'Win32NT') {
  throw 'Use 64-bit PowerShell on disposable Windows x64.'
}
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force
. (Join-Path $PSScriptRoot 'installer-qualification-safety.ps1')

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$identity = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installer-identity.json') -Raw | ConvertFrom-Json
$folders = Get-CairnQualificationFolders
Assert-CairnInstallerRegistryEmpty @(Get-CairnInstallerRegistryRecords $identity.installerGuid)
Assert-CairnNoRunningApplication
foreach ($path in @(Get-CairnQualificationConflicts $folders $identity)) { Assert-CairnQualificationPath $path -MustBeAbsent }
if ($PreflightOnly) {
  Write-Host 'Read-only preflight passed. No installer, uninstaller, cleanup, or qualification was run.'
  return
}
$packageJson = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
if (-not $InstallerPath) {
  $InstallerPath = Join-Path $projectRoot "dist\release\Cairn-Codex-$version-Setup.exe"
}
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not $ReleaseManifestPath) { $ReleaseManifestPath = Join-Path $projectRoot "dist\release\Cairn-Codex-$version-win-x64.manifest.json" }
$release = Get-Content -LiteralPath $ReleaseManifestPath -Raw | ConvertFrom-Json
$installerHash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($release.appId -ne $identity.appId -or $release.installerGuid -ne $identity.installerGuid -or
    $release.platform -ne 'win-x64' -or $release.version -ne $version -or $release.dirty -isnot [bool] -or $release.dirty -or
    $release.commit -notmatch '^[a-f0-9]{40}$' -or $release.installer -ne (Split-Path $InstallerPath -Leaf) -or
    $release.installerSha256 -ne $installerHash) {
  throw 'Installer does not match a clean release manifest and the production identity. Nothing was installed.'
}
$testRoot = Join-Path $projectRoot ('local-cache\installer-qualification-' + [Guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot 'installed'
$profileRoot = Join-Path $testRoot 'profile'
$screenshotPath = Join-Path $testRoot 'installed-first-run.png'

foreach ($path in @($testRoot, $installRoot, $profileRoot)) {
  if (-not $path.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use installer test path outside the project: $path"
  }
}

Assert-CairnQualificationPath $testRoot -MustBeAbsent

function Wait-QualificationProcess($Process, [string] $Stage) {
  if (-not $Process.WaitForExit(180000)) { throw "$Stage timed out. Preserve this VM and its evidence; no process was killed or cleanup attempted." }
  $Process.Refresh()
  if ($Process.ExitCode -ne 0) { throw "$Stage exited with code $($Process.ExitCode). Preserve qualification evidence." }
}
New-Item -ItemType Directory -Path $installRoot, $profileRoot -Force | Out-Null
$evidencePath = Join-Path $testRoot 'qualification.json'
$evidence = [ordered]@{ status = 'started'; version = $version; commit = $release.commit; installerSha256 = $installerHash; startedUtc = [DateTime]::UtcNow.ToString('o') }
$evidence | ConvertTo-Json | Set-Content -LiteralPath $evidencePath -Encoding UTF8

# Repeat volatile checks immediately before launching the production installer.
Assert-CairnInstallerRegistryEmpty @(Get-CairnInstallerRegistryRecords $identity.installerGuid)
Assert-CairnNoRunningApplication
foreach ($path in @(Get-CairnQualificationConflicts $folders $identity)) { Assert-CairnQualificationPath $path -MustBeAbsent }

Write-Host "Installing release candidate into $installRoot"
$installer = Start-Process -FilePath $InstallerPath -ArgumentList @('/S', '/currentuser', "/D=$installRoot") -WindowStyle Hidden -PassThru
Wait-QualificationProcess $installer 'Installer'

$appPath = Join-Path $installRoot 'Cairn Codex.exe'
$uninstallerPath = Join-Path $installRoot 'Uninstall Cairn Codex.exe'
if (-not (Test-Path -LiteralPath $appPath)) { throw 'Installed application executable was not created.' }
if (-not (Test-Path -LiteralPath $uninstallerPath)) { throw 'Installed uninstaller was not created.' }
Assert-CairnInstalledRegistration @(Get-CairnInstallerRegistryRecords $identity.installerGuid) $installRoot
Assert-CairnInstalledShortcuts $folders $identity $appPath
$prerequisiteRoot = Join-Path $installRoot 'resources\prerequisites'
$vcRedist = Join-Path $prerequisiteRoot 'vc_redist.x64.exe'
$vcManifestPath = Join-Path $prerequisiteRoot 'vc-redist-manifest.json'
if (-not (Test-Path -LiteralPath $vcRedist) -or -not (Test-Path -LiteralPath $vcManifestPath)) {
  throw 'Installed application is missing the bundled VC++ prerequisite or its manifest.'
}
$vcManifest = Get-Content -LiteralPath $vcManifestPath -Raw | ConvertFrom-Json
$vcHash = (Get-FileHash -LiteralPath $vcRedist -Algorithm SHA256).Hash.ToLowerInvariant()
if ($vcHash -ne [string]$vcManifest.sha256) { throw 'Installed VC++ prerequisite failed its manifest hash check.' }
$vcSignature = Get-AuthenticodeSignature -LiteralPath $vcRedist
if ($vcSignature.Status -ne 'Valid' -or $vcSignature.SignerCertificate.Subject -notmatch '(?i)O=Microsoft Corporation') {
  throw 'Installed VC++ prerequisite does not have a valid Microsoft signature.'
}

$sentinelRoots = @($profileRoot)
foreach ($base in @($folders.ApplicationData, $folders.LocalApplicationData)) {
  foreach ($name in @($identity.userDataName, $identity.productName)) {
    $path = Join-Path $base $name
    Assert-CairnQualificationPath $path -MustBeAbsent
    New-Item -ItemType Directory -Path $path | Out-Null
    $sentinelRoots += $path
  }
}
$sentinelContent = 'Cairn user data must survive uninstall: ' + [Guid]::NewGuid().ToString('N')
$sentinelPaths = @($sentinelRoots | ForEach-Object { Join-Path $_ 'preserve-on-uninstall.txt' })
foreach ($path in $sentinelPaths) { [IO.File]::WriteAllText($path, $sentinelContent) }
Push-Location $projectRoot
try {
  & node --experimental-strip-types --disable-warning=ExperimentalWarning (Join-Path $PSScriptRoot 'seed-verification-profile.mjs') $profileRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not seed the isolated installed-package catalog.' }
} finally { Pop-Location }
$oldScreenshotPath = $env:CAIRN_CODEX_SCREENSHOT_PATH
$oldScreenshotRoute = $env:CAIRN_CODEX_SCREENSHOT_ROUTE_HASH
$oldScreenshotWait = $env:CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN
$operationalVariables = @(
  'CAIRN_CODEX_DATABASE_PATH', 'CAIRN_CODEX_ARCHIVE_BACKUP_DIR', 'CAIRN_CODEX_MIGRATION_BACKUP_DIR',
  'CAIRN_CODEX_INGEST_REQUEST', 'CAIRN_CODEX_IMPORT_GDIA', 'CAIRN_CODEX_RETRIEVAL_PLAN_REQUEST',
  'CAIRN_CODEX_RETRIEVE_REQUEST', 'CAIRN_CODEX_SMOKE_TEST'
)
$oldOperationalEnvironment = @{}
foreach ($name in $operationalVariables) {
  $oldOperationalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  foreach ($name in $operationalVariables) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  $env:CAIRN_CODEX_SCREENSHOT_PATH = $screenshotPath
  $env:CAIRN_CODEX_SCREENSHOT_ROUTE_HASH = '#cc-route=1&view=settings'
  $env:CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN = '0'
  Write-Host 'Launching the installed application with an isolated first-run profile.'
  $application = Start-Process -FilePath $appPath -ArgumentList @("--user-data-dir=`"$profileRoot`"") -WindowStyle Hidden -PassThru
  Wait-QualificationProcess $application 'Installed application'
} finally {
  foreach ($name in $operationalVariables) {
    [Environment]::SetEnvironmentVariable($name, $oldOperationalEnvironment[$name], 'Process')
  }
  $env:CAIRN_CODEX_SCREENSHOT_PATH = $oldScreenshotPath
  $env:CAIRN_CODEX_SCREENSHOT_ROUTE_HASH = $oldScreenshotRoute
  $env:CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN = $oldScreenshotWait
}
if (-not (Test-Path -LiteralPath $screenshotPath)) { throw 'Installed application did not produce its first-run screenshot.' }
if ((Get-Item -LiteralPath $screenshotPath).Length -lt 10kb) { throw 'Installed first-run screenshot is unexpectedly small.' }

Write-Host 'Uninstalling the release candidate.'
Assert-CairnNoRunningApplication
Assert-CairnInstalledRegistration @(Get-CairnInstallerRegistryRecords $identity.installerGuid) $installRoot
Assert-CairnInstalledShortcuts $folders $identity $appPath
$uninstaller = Start-Process -FilePath $uninstallerPath -ArgumentList @('/S', '/currentuser') -WindowStyle Hidden -PassThru
Wait-QualificationProcess $uninstaller 'Uninstaller'
for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $appPath); $attempt += 1) {
  Start-Sleep -Milliseconds 100
}
if (Test-Path -LiteralPath $appPath) { throw 'Application executable remains after uninstall.' }
foreach ($path in $sentinelPaths) {
  if (-not (Test-Path -LiteralPath $path) -or [IO.File]::ReadAllText($path) -cne $sentinelContent) { throw 'User-data sentinel was changed or removed by uninstall.' }
}
Assert-CairnInstallerRegistryEmpty @(Get-CairnInstallerRegistryRecords $identity.installerGuid)
foreach ($base in @($folders.DesktopDirectory, $folders.CommonDesktopDirectory, $folders.Programs, $folders.CommonPrograms)) {
  Assert-CairnQualificationPath (Join-Path $base ($identity.shortcutName + '.lnk')) -MustBeAbsent
}
$evidence.status = 'passed'
$evidence.completedUtc = [DateTime]::UtcNow.ToString('o')
$evidence | ConvertTo-Json | Set-Content -LiteralPath $evidencePath -Encoding UTF8

Write-Host "Installer lifecycle passed. Screenshot: $screenshotPath"
