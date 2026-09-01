param(
  [string] $InstallerPath
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -Force

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageJson = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
if (-not $InstallerPath) {
  $InstallerPath = Join-Path $projectRoot "dist\release\Cairn-Codex-$version-Setup.exe"
}
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$testRoot = Join-Path $projectRoot 'local-cache\installer-lifecycle'
$installRoot = Join-Path $testRoot 'installed'
$profileRoot = Join-Path $testRoot 'profile'
$screenshotPath = Join-Path $testRoot 'installed-first-run.png'

foreach ($path in @($testRoot, $installRoot, $profileRoot)) {
  if (-not $path.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use installer test path outside the project: $path"
  }
}

if (Test-Path -LiteralPath $testRoot) {
  $previousUninstaller = Join-Path $installRoot 'Uninstall Cairn Codex.exe'
  if (Test-Path -LiteralPath $previousUninstaller) {
    $previous = Start-Process -FilePath $previousUninstaller -ArgumentList @('/S') -WindowStyle Hidden -Wait -PassThru
    if ($previous.ExitCode -ne 0) { throw "Previous test uninstaller exited with code $($previous.ExitCode)." }
  }
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $installRoot, $profileRoot -Force | Out-Null

Write-Host "Installing release candidate into $installRoot"
$installer = Start-Process -FilePath $InstallerPath -ArgumentList @('/S', "/D=$installRoot") -WindowStyle Hidden -Wait -PassThru
if ($installer.ExitCode -ne 0) { throw "Installer exited with code $($installer.ExitCode)." }

$appPath = Join-Path $installRoot 'Cairn Codex.exe'
$uninstallerPath = Join-Path $installRoot 'Uninstall Cairn Codex.exe'
if (-not (Test-Path -LiteralPath $appPath)) { throw 'Installed application executable was not created.' }
if (-not (Test-Path -LiteralPath $uninstallerPath)) { throw 'Installed uninstaller was not created.' }
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

$sentinelPath = Join-Path $profileRoot 'preserve-on-uninstall.txt'
Set-Content -LiteralPath $sentinelPath -Value 'Cairn user data must survive uninstall.' -Encoding UTF8
$oldScreenshotPath = $env:CAIRN_CODEX_SCREENSHOT_PATH
$oldScreenshotCategory = $env:CAIRN_CODEX_SCREENSHOT_CATEGORY
$oldScreenshotWait = $env:CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN
$oldScreenshotFixture = $env:CAIRN_CODEX_SCREENSHOT_FIXTURE
try {
  $env:CAIRN_CODEX_SCREENSHOT_PATH = $screenshotPath
  $env:CAIRN_CODEX_SCREENSHOT_CATEGORY = 'Settings'
  $env:CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN = '0'
  $env:CAIRN_CODEX_SCREENSHOT_FIXTURE = 'onboarding'
  Write-Host 'Launching the installed application with an isolated first-run profile.'
  $application = Start-Process -FilePath $appPath -ArgumentList @("--user-data-dir=$profileRoot") -WindowStyle Hidden -Wait -PassThru
  if ($application.ExitCode -ne 0) { throw "Installed application exited with code $($application.ExitCode)." }
} finally {
  $env:CAIRN_CODEX_SCREENSHOT_PATH = $oldScreenshotPath
  $env:CAIRN_CODEX_SCREENSHOT_CATEGORY = $oldScreenshotCategory
  $env:CAIRN_CODEX_SCREENSHOT_WAIT_FOR_SCAN = $oldScreenshotWait
  $env:CAIRN_CODEX_SCREENSHOT_FIXTURE = $oldScreenshotFixture
}
if (-not (Test-Path -LiteralPath $screenshotPath)) { throw 'Installed application did not produce its first-run screenshot.' }
if ((Get-Item -LiteralPath $screenshotPath).Length -lt 10kb) { throw 'Installed first-run screenshot is unexpectedly small.' }

Write-Host 'Uninstalling the release candidate.'
$uninstaller = Start-Process -FilePath $uninstallerPath -ArgumentList @('/S') -WindowStyle Hidden -Wait -PassThru
if ($uninstaller.ExitCode -ne 0) { throw "Uninstaller exited with code $($uninstaller.ExitCode)." }
for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $appPath); $attempt += 1) {
  Start-Sleep -Milliseconds 100
}
if (Test-Path -LiteralPath $appPath) { throw 'Application executable remains after uninstall.' }
if (-not (Test-Path -LiteralPath $sentinelPath)) { throw 'User-data sentinel was removed by uninstall.' }

Write-Host "Installer lifecycle passed. Screenshot: $screenshotPath"
