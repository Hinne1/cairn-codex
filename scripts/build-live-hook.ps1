param(
  [Parameter(Mandatory)] [string] $UpstreamRoot,
  [Parameter(Mandatory)] [string] $BoostRoot,
  [ValidatePattern('^10\.0\.\d+\.0$')] [string] $WindowsSdkVersion = '10.0.22621.0',
  [string] $WindowsSdkRoot,
  [string] $VCToolsVersion,
  [switch] $PreflightOnly,
  [ValidatePattern('^\d+\.\d+\.\d+\.\d+$')]
  [string] $HookVersion = '1.5.9736.15764',
  [ValidatePattern('^[a-fA-F0-9]{64}$')]
  [string] $ExpectedSha256 = '419b53fdff4e75dafb98f9066a0271da0f0c937b5b02e5beca2e39af527a34c5'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'native-build-prerequisites.ps1')
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$upstream = (Resolve-Path $UpstreamRoot).Path
$boost = (Resolve-Path $BoostRoot).Path
$expectedCommit = 'babced1cccd09c60ba0b36cf8c3cfe431910c754'
$patchPath = Join-Path $projectRoot 'native\patches\iagd-cairn.patch'
$solutionPath = Join-Path $upstream 'HookDll\Hook\GDIAHook.sln'
$hookPath = Join-Path $upstream 'HookDll\Hook\x64\Release\ItemAssistantHook_x64.dll'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'

if (-not (Test-Path -LiteralPath (Join-Path $upstream '.git'))) {
  throw 'UpstreamRoot must be a clean Git clone of Grim Dawn Item Assistant.'
}
$upstreamCommit = & git -C $upstream rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Could not read the GDIA checkout commit.' }
if ($upstreamCommit.Trim() -ne $expectedCommit) {
  throw "The GDIA checkout is not pinned to $expectedCommit."
}
$upstreamStatus = @(& git -C $upstream status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the GDIA checkout state.' }
if ($upstreamStatus.Count -ne 0) {
  throw 'The GDIA checkout is not clean. Use a fresh checkout; the script will apply Cairn changes itself.'
}
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio Installer vswhere.exe was not found.'
}

$visualStudioRoot = (& $vswhere -latest -products '*' -version '[17.0,18.0)' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $visualStudioRoot) { throw 'Visual Studio 2022 with the v143 x64 C++ build tools was not found.' }
if (-not $WindowsSdkRoot) {
  $WindowsSdkRoot = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -Name KitsRoot10 -ErrorAction SilentlyContinue).KitsRoot10
  if (-not $WindowsSdkRoot) { throw 'Windows SDK installation root was not found. Install SDK 10.0.22621.0 or specify -WindowsSdkRoot explicitly.' }
}
$prerequisites = Get-CairnNativeBuildPrerequisites -BoostRoot $boost -VisualStudioRoot $visualStudioRoot -WindowsSdkRoot $WindowsSdkRoot -WindowsSdkVersion $WindowsSdkVersion -VCToolsVersion $VCToolsVersion
$compiler = $prerequisites.CompilerRoot
$sdk = $prerequisites.WindowsSdkRoot.TrimEnd('\') + '\'
$detours = Join-Path $upstream 'HookDll\Detours-master'
Assert-CairnNativeBuildFile (Join-Path $detours 'src\detours.h') 'pinned Detours headers'
Assert-CairnNativeBuildFile (Join-Path $detours 'x64\detours.lib') 'pinned Detours x64 library'
# Upstream embeds older machine-specific paths before $(BOOST). Global properties
# override those lists instead of allowing unchecked headers/libraries to win.
$includePath = @(
  $boost, (Join-Path $detours 'src'), (Join-Path $upstream 'HookDll'),
  (Join-Path $compiler 'include'), (Join-Path $compiler 'atlmfc\include'),
  (Join-Path $sdk "Include\$WindowsSdkVersion\ucrt"),
  (Join-Path $sdk "Include\$WindowsSdkVersion\shared"),
  (Join-Path $sdk "Include\$WindowsSdkVersion\um")
) -join ';'
$libraryPath = @(
  (Join-Path $boost 'lib64-msvc-14.0'), (Join-Path $detours 'x64'),
  (Join-Path $compiler 'lib\x64'), (Join-Path $compiler 'atlmfc\lib\x64'),
  (Join-Path $sdk "Lib\$WindowsSdkVersion\um\x64"),
  (Join-Path $sdk "Lib\$WindowsSdkVersion\ucrt\x64")
) -join ';'
$buildArguments = @(
  '/m', '/t:GDIAHook', '/p:Configuration=Release', '/p:Platform=x64',
  '/p:PlatformToolset=v143', '/p:PreferredToolArchitecture=x86',
  "/p:VCToolsVersion=$($prerequisites.VCToolsVersion)", "/p:WindowsTargetPlatformVersion=$WindowsSdkVersion",
  "/p:WindowsSdkDir=$(ConvertTo-CairnMSBuildValue $sdk)",
  "/p:UniversalCRTSdkDir=$(ConvertTo-CairnMSBuildValue $sdk)", "/p:UCRTVersion=$WindowsSdkVersion",
  "/p:IncludePath=$(ConvertTo-CairnMSBuildValue $includePath)",
  "/p:LibraryPath=$(ConvertTo-CairnMSBuildValue $libraryPath)",
  "/p:BOOST=$(ConvertTo-CairnMSBuildValue $boost)", "/p:IagdVersion=$HookVersion"
)
& git -C $upstream apply --check $patchPath
if ($LASTEXITCODE -ne 0) { throw 'The Cairn native patch does not apply cleanly.' }
Write-Host "Native build inputs: v143 compiler $($prerequisites.VCToolsVersion), Windows SDK $WindowsSdkVersion, Boost 1.78.0, hook version $HookVersion."
if ($PreflightOnly) {
  $prerequisites | Add-Member -NotePropertyName BuildArguments -NotePropertyValue $buildArguments
  $prerequisites
  return
}
& git -C $upstream apply $patchPath
if ($LASTEXITCODE -ne 0) { throw 'Applying the Cairn native patch failed.' }

& $prerequisites.MSBuild $solutionPath @buildArguments
if ($LASTEXITCODE -ne 0) { throw 'The native hook build failed.' }

$actual = (Get-FileHash -LiteralPath $hookPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $ExpectedSha256.ToLowerInvariant()) {
  throw "The native hook built successfully but its SHA-256 was $actual, not $ExpectedSha256. Do not replace the verified hook until the difference is explained and a full compatibility round trip passes."
}

Write-Host "Verified native hook: $hookPath"
Write-Host "SHA-256: $actual"
