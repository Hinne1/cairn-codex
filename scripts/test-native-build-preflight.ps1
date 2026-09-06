$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'native-build-prerequisites.ps1')
$testRoot = Join-Path (Join-Path $PSScriptRoot '..\local-cache') ('native-build-preflight-' + [guid]::NewGuid().ToString('N'))
$sdkVersion = '10.0.22621.0'
$compilerVersion = '14.43.34808'
$inputs = @{
  BoostRoot = Join-Path $testRoot 'boost'
  VisualStudioRoot = Join-Path $testRoot 'vs'
  WindowsSdkRoot = Join-Path $testRoot 'sdk'
}
function Write-FixtureFile([string] $Path, [string] $Content = 'synthetic prerequisite') {
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  Set-Content -LiteralPath $Path -Value $Content -Encoding ascii
}
function Assert-Rejected([scriptblock] $Action, [string] $Expected) {
  $failure = $null
  try { & $Action | Out-Null } catch { $failure = $_.Exception.Message }
  if (-not $failure -or -not $failure.Contains($Expected)) {
    throw "Expected rejection containing '$Expected'; got '$failure'."
  }
}
$files = @(
  (Join-Path $inputs.VisualStudioRoot 'MSBuild\Current\Bin\MSBuild.exe'),
  (Join-Path $inputs.VisualStudioRoot 'MSBuild\Microsoft\VC\v170\Platforms\x64\PlatformToolsets\v143\Toolset.props'),
  (Join-Path $inputs.VisualStudioRoot "VC\Tools\MSVC\$compilerVersion\bin\HostX86\x64\cl.exe"),
  (Join-Path $inputs.VisualStudioRoot "VC\Tools\MSVC\$compilerVersion\bin\HostX86\x64\link.exe"),
  (Join-Path $inputs.VisualStudioRoot "VC\Tools\MSVC\$compilerVersion\atlmfc\include\atlbase.h"),
  (Join-Path $inputs.WindowsSdkRoot "Include\$sdkVersion\um\Windows.h"),
  (Join-Path $inputs.WindowsSdkRoot "Include\$sdkVersion\shared\sdkddkver.h"),
  (Join-Path $inputs.WindowsSdkRoot "Include\$sdkVersion\ucrt\stdio.h"),
  (Join-Path $inputs.WindowsSdkRoot "Lib\$sdkVersion\um\x64\kernel32.lib"),
  (Join-Path $inputs.WindowsSdkRoot "Lib\$sdkVersion\ucrt\x64\ucrt.lib"),
  (Join-Path $inputs.WindowsSdkRoot "bin\$sdkVersion\x86\rc.exe"),
  (Join-Path $inputs.WindowsSdkRoot "bin\$sdkVersion\x86\mt.exe"),
  (Join-Path $inputs.BoostRoot 'lib64-msvc-14.0\libboost_thread-vc143-mt-x64-1_78.lib')
)
foreach ($file in $files) { Write-FixtureFile $file }
$versionFile = Join-Path $inputs.VisualStudioRoot 'VC\Auxiliary\Build\Microsoft.VCToolsVersion.v143.default.txt'
$boostVersionFile = Join-Path $inputs.BoostRoot 'boost\version.hpp'
Write-FixtureFile $versionFile $compilerVersion
Write-FixtureFile $boostVersionFile '#define BOOST_VERSION 107800'
$result = Get-CairnNativeBuildPrerequisites @inputs
if ($result.WindowsSdkVersion -ne $sdkVersion -or $result.VCToolsVersion -ne $compilerVersion -or $result.PlatformToolset -ne 'v143') {
  throw 'Documented defaults did not resolve to the synthetic v143/22621 prerequisites.'
}
foreach ($file in $files) {
  Remove-Item -LiteralPath $file
  Assert-Rejected { Get-CairnNativeBuildPrerequisites @inputs } 'Missing '
  Write-FixtureFile $file
}
Assert-Rejected { Get-CairnNativeBuildPrerequisites @inputs -WindowsSdkVersion '10.0.26100.0' } 'Windows SDK 10.0.26100.0'
Assert-Rejected { Get-CairnNativeBuildPrerequisites @inputs -WindowsSdkVersion '../sdk' } 'WindowsSdkVersion'
Assert-Rejected { Get-CairnNativeBuildPrerequisites @inputs -VCToolsVersion '../compiler' } 'VCToolsVersion'
Assert-Rejected { Get-CairnNativeBuildPrerequisites @inputs -VCToolsVersion '14.29.30133' } 'VCToolsVersion'
Write-FixtureFile $boostVersionFile '#define BOOST_VERSION 108000'
Assert-Rejected { Get-CairnNativeBuildPrerequisites @inputs } 'Boost 1.78.0 headers'
Write-FixtureFile $boostVersionFile '#define BOOST_VERSION 107800'
Remove-Item -LiteralPath $versionFile
Assert-Rejected { Get-CairnNativeBuildPrerequisites @inputs } 'compiler version manifest'
$explicit = Get-CairnNativeBuildPrerequisites @inputs -VCToolsVersion $compilerVersion
if ($explicit.VCToolsVersion -ne $compilerVersion) { throw 'Explicit installed compiler selection failed.' }

$script = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'build-live-hook.ps1') -Raw
if ($script.IndexOf('$prerequisites = Get-CairnNativeBuildPrerequisites') -gt $script.IndexOf('& git -C $upstream apply $patchPath')) {
  throw 'Prerequisite rejection must precede patch application.'
}
if ($script -notmatch 'if \(\$PreflightOnly\)' -or $script -notmatch '\$actual -ne \$ExpectedSha256.ToLowerInvariant\(\)') {
  throw 'Read-only preflight and expected output hash rejection must remain available.'
}
Write-Host 'Native build prerequisite gates passed: documented defaults, 13 missing components, wrong SDK/compiler/Boost, and explicit compiler selection. No native build or injection was executed.'
