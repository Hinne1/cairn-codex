function Get-CairnInstallerRegistryRecords {
  param(
    [Parameter(Mandatory)] [string] $InstallerGuid,
    [scriptblock] $ReadKey = {
      param($Hive, $View, $Path)
      $base = $null
      $key = $null
      try {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
          [Microsoft.Win32.RegistryHive]::$Hive, [Microsoft.Win32.RegistryView]::$View)
        $key = $base.OpenSubKey($Path, $false)
        [pscustomobject]@{
          Exists = $null -ne $key
          InstallLocation = if ($key) { $key.GetValue('InstallLocation') } else { $null }
          UninstallString = if ($key) { $key.GetValue('UninstallString') } else { $null }
        }
      } finally {
        if ($key) { $key.Dispose() }
        if ($base) { $base.Dispose() }
      }
    }
  )
  if ($InstallerGuid -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'Invalid installer identity.' }
  foreach ($hive in @('CurrentUser', 'LocalMachine')) {
    foreach ($view in @('Registry32', 'Registry64')) {
      foreach ($kind in @('Install', 'Uninstall')) {
        $path = if ($kind -eq 'Install') { "Software\$InstallerGuid" } else { "Software\Microsoft\Windows\CurrentVersion\Uninstall\$InstallerGuid" }
        try { $value = & $ReadKey $hive $view $path } catch {
          throw "Cannot verify installer registry state ($hive/$view/$kind). Qualification was not started."
        }
        if ($null -eq $value -or $value.Exists -isnot [bool]) { throw 'Incomplete installer registry probe.' }
        [pscustomobject]@{
          Hive = $hive; View = $view; Kind = $kind; Exists = $value.Exists
          InstallLocation = $value.InstallLocation; UninstallString = $value.UninstallString
        }
      }
    }
  }
}

function Assert-CairnInstallerRegistryShape {
  param([array] $Records)
  if ($Records.Count -ne 8) { throw 'Incomplete installer registry state; all hives and views are required.' }
  foreach ($hive in @('CurrentUser', 'LocalMachine')) {
    foreach ($view in @('Registry32', 'Registry64')) {
      foreach ($kind in @('Install', 'Uninstall')) {
        $matching = @($Records | Where-Object { $_.Hive -eq $hive -and $_.View -eq $view -and $_.Kind -eq $kind })
        if ($matching.Count -ne 1 -or $matching[0].Exists -isnot [bool]) { throw 'Incomplete or duplicate installer registry state.' }
      }
    }
  }
}

function Assert-CairnInstallerRegistryEmpty {
  param([array] $Records)
  Assert-CairnInstallerRegistryShape $Records
  if (@($Records | Where-Object Exists).Count -ne 0) {
    throw 'An existing Cairn installation or interrupted qualification is registered. Use a fresh disposable Windows environment; no uninstaller or cleanup was run.'
  }
}

function Assert-CairnNoRunningApplication {
  param([scriptblock] $ReadProcesses = { @(Get-Process -ErrorAction Stop | Select-Object -ExpandProperty ProcessName) })
  try { $names = @(& $ReadProcesses) } catch { throw 'Cannot verify running processes. Installer qualification was not started.' }
  if ($names.Count -eq 0 -or @($names | Where-Object { $_ -isnot [string] -or -not $_ }).Count -gt 0) {
    throw 'Incomplete process enumeration. Installer qualification was not started.'
  }
  if ($names -contains 'Cairn Codex') { throw 'Cairn Codex is running, possibly from a portable folder. Do not run qualification on this account; no process was stopped.' }
}

function Assert-CairnQualificationPath {
  param([Parameter(Mandatory)] [string] $Path, [switch] $MustBeAbsent)
  $current = [IO.Path]::GetFullPath($Path)
  $first = $true
  while ($current) {
    $item = $null
    try { $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop } catch [System.Management.Automation.ItemNotFoundException] { }
    if ($item) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Qualification paths must not traverse a reparse point.' }
      if ($first -and $MustBeAbsent) { throw 'A qualification or existing product path already exists. Preserve it and use a fresh disposable environment.' }
      if (-not $first -and -not $item.PSIsContainer) { throw 'Qualification path has a file ancestor.' }
    }
    $first = $false
    $parent = [IO.Directory]::GetParent($current)
    $current = if ($parent) { $parent.FullName } else { $null }
  }
}

function Get-CairnQualificationFolders {
  param(
    [scriptblock] $ReadSpecialFolder = { param($Name) [Environment]::GetFolderPath([Environment+SpecialFolder]::$Name, [Environment+SpecialFolderOption]::DoNotVerify) },
    [scriptblock] $ReadUserProgramFiles = { [CairnQualificationKnownFolder]::Read('5CD7AEE2-2219-4A67-B85D-6C9CE15660CB') }
  )
  if (-not ('CairnQualificationKnownFolder' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CairnQualificationKnownFolder {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
  public static string Read(string value) {
    Guid id = new Guid(value); IntPtr path = IntPtr.Zero;
    try {
      // KF_FLAG_DONT_VERIFY resolves a fresh account's not-yet-created path.
      // Never use KF_FLAG_CREATE: this preflight is read-only.
      Marshal.ThrowExceptionForHR(SHGetKnownFolderPath(ref id, 0x4000, IntPtr.Zero, out path));
      return Marshal.PtrToStringUni(path);
    } finally { if (path != IntPtr.Zero) Marshal.FreeCoTaskMem(path); }
  }
}
'@
  }
  $folders = [ordered]@{}
  foreach ($name in @('ApplicationData', 'LocalApplicationData', 'ProgramFiles', 'ProgramFilesX86', 'DesktopDirectory', 'CommonDesktopDirectory', 'Programs', 'CommonPrograms')) {
    $value = & $ReadSpecialFolder $name
    if (-not $value) { throw "Cannot resolve Windows known folder $name." }
    $folders[$name] = $value
  }
  $folders.UserProgramFiles = & $ReadUserProgramFiles
  if (-not $folders.UserProgramFiles) { throw 'Cannot resolve Windows UserProgramFiles.' }
  foreach ($path in $folders.Values) { Assert-CairnQualificationPath $path }
  [pscustomobject]$folders
}

function Assert-CairnNoPreviousQualification {
  param([Parameter(Mandatory)] [string] $CacheRoot)
  Assert-CairnQualificationPath $CacheRoot
  if (-not (Test-Path -LiteralPath $CacheRoot)) { return }
  # Reject every previous root, including absent/malformed evidence and runs
  # interrupted before NSIS wrote registration. Never recurse or clean it up.
  foreach ($entry in Get-ChildItem -LiteralPath $CacheRoot -Force -ErrorAction Stop) {
    if ($entry.Name -like 'installer-qualification-*' -or $entry.Name -eq 'installer-lifecycle') {
      throw 'Previous installer qualification evidence exists. Preserve it for investigation and use a fresh disposable Windows snapshot; no installer or cleanup was run.'
    }
  }
}

function Get-CairnQualificationConflicts {
  param($Folders, $Identity)
  foreach ($base in @($Folders.ApplicationData, $Folders.LocalApplicationData)) {
    foreach ($name in @($Identity.userDataName, $Identity.productName)) { Join-Path $base $name }
  }
  foreach ($base in @($Folders.UserProgramFiles, $Folders.ProgramFiles, $Folders.ProgramFilesX86)) {
    foreach ($name in @($Identity.userDataName, $Identity.productName)) { Join-Path $base $name }
  }
  foreach ($base in @($Folders.DesktopDirectory, $Folders.CommonDesktopDirectory, $Folders.Programs, $Folders.CommonPrograms)) {
    Join-Path $base ($Identity.shortcutName + '.lnk')
  }
}

function Assert-CairnInstalledRegistration {
  param([array] $Records, [string] $InstallRoot)
  Assert-CairnInstallerRegistryShape $Records
  $present = @($Records | Where-Object Exists)
  # These HKCU Software keys are shared across WOW64 views. HKLM Software is not.
  if ($present.Count -ne 4 -or @($present | Where-Object { $_.Hive -ne 'CurrentUser' }).Count -gt 0) {
    throw 'Qualification installer registered outside the expected shared HKCU scope.'
  }
  foreach ($record in @($present | Where-Object { $_.Kind -eq 'Install' })) {
    if (-not $record.InstallLocation -or [IO.Path]::GetFullPath($record.InstallLocation).TrimEnd('\') -ne [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')) {
      throw 'Installer registration does not identify the owned qualification directory.'
    }
  }
  $expected = '"' + (Join-Path $InstallRoot 'Uninstall Cairn Codex.exe') + '" /currentuser'
  foreach ($record in @($present | Where-Object { $_.Kind -eq 'Uninstall' })) {
    if ($record.UninstallString -ne $expected) { throw 'Installer uninstaller command does not match the owned per-user test installation.' }
  }
}

function Assert-CairnInstalledShortcuts {
  param($Folders, $Identity, [string] $AppPath)
  $shell = New-Object -ComObject WScript.Shell
  try {
    foreach ($base in @($Folders.DesktopDirectory, $Folders.Programs)) {
      $path = Join-Path $base ($Identity.shortcutName + '.lnk')
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Expected qualification shortcut was not created.' }
      Assert-CairnQualificationPath $path
      $shortcut = $shell.CreateShortcut($path)
      try {
        if ([IO.Path]::GetFullPath($shortcut.TargetPath) -ne [IO.Path]::GetFullPath($AppPath)) { throw 'Qualification shortcut points outside the owned installation.' }
      } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    }
    foreach ($base in @($Folders.CommonDesktopDirectory, $Folders.CommonPrograms)) {
      Assert-CairnQualificationPath (Join-Path $base ($Identity.shortcutName + '.lnk')) -MustBeAbsent
    }
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
}
