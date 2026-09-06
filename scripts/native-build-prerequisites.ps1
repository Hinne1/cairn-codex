function Assert-CairnNativeBuildFile {
  param([string] $Path, [string] $Description)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing $Description`: $Path. Install the documented native build prerequisites before applying the patch."
  }
}

function Get-CairnNativeBuildPrerequisites {
  param(
    [Parameter(Mandatory)] [string] $BoostRoot,
    [Parameter(Mandatory)] [string] $VisualStudioRoot,
    [Parameter(Mandatory)] [string] $WindowsSdkRoot,
    [ValidatePattern('^10\.0\.\d+\.0$')] [string] $WindowsSdkVersion = '10.0.22621.0',
    [string] $VCToolsVersion
  )

  $msbuild = Join-Path $VisualStudioRoot 'MSBuild\Current\Bin\MSBuild.exe'
  Assert-CairnNativeBuildFile $msbuild 'Visual Studio 2022 MSBuild'
  Assert-CairnNativeBuildFile (Join-Path $VisualStudioRoot 'MSBuild\Microsoft\VC\v170\Platforms\x64\PlatformToolsets\v143\Toolset.props') 'v143 x64 C++ toolset'
  if (-not $VCToolsVersion) {
    $versionFile = Join-Path $VisualStudioRoot 'VC\Auxiliary\Build\Microsoft.VCToolsVersion.v143.default.txt'
    Assert-CairnNativeBuildFile $versionFile 'v143 compiler version manifest'
    $VCToolsVersion = (Get-Content -LiteralPath $versionFile -Raw).Trim()
  }
  if ($VCToolsVersion -notmatch '^14\.(?:3\d|4\d)\.\d+$') {
    throw 'VCToolsVersion must identify an installed Visual Studio 2022 v143 compiler (14.3x or 14.4x).'
  }
  $compilerRoot = Join-Path $VisualStudioRoot "VC\Tools\MSVC\$VCToolsVersion"
  foreach ($file in @('bin\HostX86\x64\cl.exe', 'bin\HostX86\x64\link.exe', 'include\vector', 'lib\x64\msvcrt.lib', 'atlmfc\include\atlbase.h', 'atlmfc\lib\x64\atls.lib')) {
    Assert-CairnNativeBuildFile (Join-Path $compilerRoot $file) "v143 compiler/ATL component $VCToolsVersion"
  }
  foreach ($file in @(
    "Include\$WindowsSdkVersion\um\Windows.h", "Include\$WindowsSdkVersion\shared\sdkddkver.h",
    "Include\$WindowsSdkVersion\ucrt\stdio.h", "Lib\$WindowsSdkVersion\um\x64\kernel32.lib",
    "Lib\$WindowsSdkVersion\ucrt\x64\ucrt.lib", "bin\$WindowsSdkVersion\x86\rc.exe",
    "bin\$WindowsSdkVersion\x86\mt.exe"
  )) {
    Assert-CairnNativeBuildFile (Join-Path $WindowsSdkRoot $file) "Windows SDK $WindowsSdkVersion x64 build component"
  }
  $boostVersionPath = Join-Path $BoostRoot 'boost\version.hpp'
  Assert-CairnNativeBuildFile $boostVersionPath 'Boost 1.78.0 headers'
  if ((Get-Content -LiteralPath $boostVersionPath -Raw) -notmatch '(?m)^\s*#\s*define\s+BOOST_VERSION\s+107800\s*$') {
    throw 'BoostRoot must contain the documented Boost 1.78.0 headers.'
  }
  Assert-CairnNativeBuildFile (Join-Path $BoostRoot 'lib64-msvc-14.0\libboost_thread-vc143-mt-x64-1_78.lib') 'Boost 1.78.0 v143 x64 thread library'

  [pscustomobject]@{
    MSBuild = $msbuild
    PlatformToolset = 'v143'
    VCToolsVersion = $VCToolsVersion
    CompilerRoot = $compilerRoot
    WindowsSdkRoot = (Resolve-Path -LiteralPath $WindowsSdkRoot).Path
    WindowsSdkVersion = $WindowsSdkVersion
    BoostRoot = (Resolve-Path -LiteralPath $BoostRoot).Path
  }
}

function ConvertTo-CairnMSBuildValue {
  param([string] $Value)
  # Escape MSBuild's special characters, including list separators, once. This
  # is an MSBuild property value passed as one argument, never shell source.
  [regex]::Replace($Value, '[%$@();''?*]', {
    param($match)
    '%' + ([int][char]$match.Value).ToString('X2')
  })
}
