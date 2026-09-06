$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installer-qualification-safety.ps1')
$identity = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installer-identity.json') -Raw | ConvertFrom-Json
$script:checks = 0
function Reject([scriptblock] $Run, [string] $Name) {
  $rejected = $false
  try { & $Run } catch { $rejected = $true }
  if (-not $rejected) { throw "Accepted unsafe state: $Name" }
  $script:checks += 1
}
function EmptyRecords {
  @(Get-CairnInstallerRegistryRecords $identity.installerGuid { param($Hive, $View, $Path)
    if ($Path -notin @("Software\$($identity.installerGuid)", "Software\Microsoft\Windows\CurrentVersion\Uninstall\$($identity.installerGuid)")) { throw 'Wrong production key.' }
    [pscustomobject]@{ Exists = $false; InstallLocation = $null; UninstallString = $null }
  })
}
$empty = EmptyRecords
Assert-CairnInstallerRegistryEmpty $empty
if ($empty.Count -ne 8) { throw 'Did not probe all hives and views.' }
for ($index = 0; $index -lt 8; $index += 1) {
  $records = EmptyRecords
  $records[$index].Exists = $true
  Reject { Assert-CairnInstallerRegistryEmpty $records } "existing registration $index"
}
Reject { Assert-CairnInstallerRegistryEmpty @($empty[0..6]) } 'missing registry view'
Reject { Assert-CairnInstallerRegistryEmpty @($empty[0..6] + $empty[0]) } 'duplicate registry view'
Reject { Get-CairnInstallerRegistryRecords $identity.installerGuid { throw 'Access denied' } } 'unreadable registry'
Reject { Get-CairnInstallerRegistryRecords $identity.installerGuid { [pscustomobject]@{ Exists = 'false' } } } 'malformed registry'
Reject { Get-CairnInstallerRegistryRecords '------------------------------------' } 'invalid GUID'
Assert-CairnNoRunningApplication { @('System', 'explorer') }
Reject { Assert-CairnNoRunningApplication { @('System', 'cairn codex') } } 'portable CC running'
Reject { Assert-CairnNoRunningApplication { throw 'Access denied' } } 'unreadable processes'
Reject { Assert-CairnNoRunningApplication { @() } } 'empty processes'
Reject { Assert-CairnNoRunningApplication { @('System', $null) } } 'malformed processes'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixtureRoot = Join-Path $projectRoot ('local-cache\installer-safety-' + [Guid]::NewGuid().ToString('N'))
Assert-CairnQualificationPath $fixtureRoot -MustBeAbsent
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
  Assert-CairnQualificationPath (Join-Path $fixtureRoot 'fresh\nested') -MustBeAbsent
  Reject { Assert-CairnQualificationPath $fixtureRoot -MustBeAbsent } 'existing test root'
  $target = Join-Path $fixtureRoot 'target'
  $junction = Join-Path $fixtureRoot 'junction'
  New-Item -ItemType Directory -Path $target | Out-Null
  New-Item -ItemType Junction -Path $junction -Target $target | Out-Null
  try {
    Reject { Assert-CairnQualificationPath (Join-Path $junction 'fresh') -MustBeAbsent } 'reparse ancestor'
  } finally { (Get-Item -LiteralPath $junction -Force).Delete() }
  $file = Join-Path $fixtureRoot 'file'
  [IO.File]::WriteAllText($file, 'fixture')
  Reject { Assert-CairnQualificationPath (Join-Path $file 'fresh') -MustBeAbsent } 'file ancestor'

  $installedRoot = Join-Path $fixtureRoot 'installed'
  function InstalledRecords {
    $records = EmptyRecords
    foreach ($record in $records) {
      if ($record.Hive -eq 'CurrentUser') {
        $record.Exists = $true
        if ($record.Kind -eq 'Install') { $record.InstallLocation = $installedRoot }
        else { $record.UninstallString = '"' + (Join-Path $installedRoot 'Uninstall Cairn Codex.exe') + '" /currentuser' }
      }
    }
    $records
  }
  Assert-CairnInstalledRegistration @(InstalledRecords) $installedRoot
  foreach ($index in 0..7) {
    $records = InstalledRecords
    $records[$index].Exists = -not $records[$index].Exists
    Reject { Assert-CairnInstalledRegistration $records $installedRoot } "wrong installed scope $index"
  }
  foreach ($index in 0..3) {
    $records = InstalledRecords
    if ($records[$index].Kind -eq 'Install') { $records[$index].InstallLocation = $target }
    else { $records[$index].UninstallString = '"' + (Join-Path $target 'Uninstall Cairn Codex.exe') + '" /allusers' }
    Reject { Assert-CairnInstalledRegistration $records $installedRoot } "unowned install or uninstaller $index"
  }
  $folders = [ordered]@{}
  foreach ($name in @('ApplicationData', 'LocalApplicationData', 'ProgramFiles', 'ProgramFilesX86', 'DesktopDirectory', 'CommonDesktopDirectory', 'Programs', 'CommonPrograms', 'UserProgramFiles')) {
    $folders[$name] = Join-Path $fixtureRoot $name
  }
  $conflicts = @(Get-CairnQualificationConflicts ([pscustomobject]$folders) $identity)
  if ($conflicts.Count -ne 14 -or $conflicts -notcontains (Join-Path $folders.UserProgramFiles $identity.productName)) { throw 'Incomplete known-folder coverage.' }
  foreach ($path in $conflicts) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Reject { Assert-CairnQualificationPath $path -MustBeAbsent } 'existing product path'
  }
} finally {
  $resolved = [IO.Path]::GetFullPath($fixtureRoot)
  $prefix = [IO.Path]::GetFullPath((Join-Path $projectRoot 'local-cache')) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing fixture cleanup outside local-cache.' }
  Assert-CairnQualificationPath $resolved
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Host "Installer safety passed: $script:checks unsafe synthetic states rejected; no installer, uninstaller, registry mutation, or application launch."
