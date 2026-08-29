param(
  [Parameter(Mandatory)] [string] $UpstreamRoot,
  [Parameter(Mandatory)] [string] $BoostRoot,
  [string] $HookVersion = '1.5.9736.15764',
  [string] $ExpectedSha256 = '419b53fdff4e75dafb98f9066a0271da0f0c937b5b02e5beca2e39af527a34c5'
)

$ErrorActionPreference = 'Stop'
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
if ((& git -C $upstream rev-parse HEAD).Trim() -ne $expectedCommit) {
  throw "The GDIA checkout is not pinned to $expectedCommit."
}
if (@(& git -C $upstream status --porcelain).Count -ne 0) {
  throw 'The GDIA checkout is not clean. Use a fresh checkout; the script will apply Cairn changes itself.'
}
if (-not (Test-Path -LiteralPath (Join-Path $boost 'lib64-msvc-14.0'))) {
  throw 'BoostRoot does not contain lib64-msvc-14.0.'
}
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio Installer vswhere.exe was not found.'
}

& git -C $upstream apply --check $patchPath
if ($LASTEXITCODE -ne 0) { throw 'The Cairn native patch does not apply cleanly.' }
& git -C $upstream apply $patchPath
if ($LASTEXITCODE -ne 0) { throw 'Applying the Cairn native patch failed.' }

$msbuild = (& $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1)
if (-not $msbuild) { throw 'MSBuild was not found in a Visual Studio installation.' }

& $msbuild $solutionPath /m /t:GDIAHook /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143 /p:WindowsTargetPlatformVersion=10.0.26100.0 "/p:BOOST=$boost" "/p:IagdVersion=$HookVersion"
if ($LASTEXITCODE -ne 0) { throw 'The native hook build failed.' }

$actual = (Get-FileHash -LiteralPath $hookPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $ExpectedSha256.ToLowerInvariant()) {
  throw "The native hook built successfully but its SHA-256 was $actual, not $ExpectedSha256. Do not replace the verified hook until the difference is explained and a full compatibility round trip passes."
}

Write-Host "Verified native hook: $hookPath"
Write-Host "SHA-256: $actual"
