param(
  [Parameter(Mandatory)]
  [string] $ExecutablePath,

  [string] $IconPath
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($IconPath)) {
  $IconPath = Join-Path $projectRoot 'build\icon.ico'
}
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedIcon = (Resolve-Path -LiteralPath $IconPath).Path
Add-Type -AssemblyName System.Drawing

$associated = [System.Drawing.Icon]::ExtractAssociatedIcon($resolvedExecutable)
if ($null -eq $associated) { throw "Windows did not find an icon resource in $resolvedExecutable" }
$comparisonSize = [System.Drawing.Size]::new(32, 32)
$actual32 = [System.Drawing.Icon]::new($associated, $comparisonSize)
$iconBytes = [System.IO.File]::ReadAllBytes($resolvedIcon)
$frameCount = [System.BitConverter]::ToUInt16($iconBytes, 4)
$frameBytes = $null
for ($index = 0; $index -lt $frameCount; $index += 1) {
  $entry = 6 + ($index * 16)
  $frameWidth = [int]$iconBytes[$entry]
  if ($frameWidth -eq 0) { $frameWidth = 256 }
  if ($frameWidth -ne 32) { continue }
  $length = [System.BitConverter]::ToUInt32($iconBytes, $entry + 8)
  $offset = [System.BitConverter]::ToUInt32($iconBytes, $entry + 12)
  $frameBytes = New-Object byte[] $length
  [System.Array]::Copy($iconBytes, $offset, $frameBytes, 0, $length)
  break
}
if ($null -eq $frameBytes) { throw 'The expected ICO does not contain a 32px frame.' }
$expectedStream = [System.IO.MemoryStream]::new($frameBytes, $false)

try {
  $actualBitmap = $actual32.ToBitmap()
  $expectedBitmap = [System.Drawing.Bitmap]::FromStream($expectedStream)
  try {
    if ($actualBitmap.Width -ne $expectedBitmap.Width -or $actualBitmap.Height -ne $expectedBitmap.Height) {
      throw 'Packaged icon dimensions differ from the expected 32px frame.'
    }
    for ($y = 0; $y -lt $actualBitmap.Height; $y += 1) {
      for ($x = 0; $x -lt $actualBitmap.Width; $x += 1) {
        $actualPixel = $actualBitmap.GetPixel($x, $y)
        $expectedPixel = $expectedBitmap.GetPixel($x, $y)
        $actualArgb = $actualPixel.ToArgb()
        $expectedArgb = $expectedPixel.ToArgb()
        $bothTransparent = $actualPixel.A -eq 0 -and $expectedPixel.A -eq 0
        if (-not $bothTransparent -and $actualArgb -ne $expectedArgb) {
          throw "Packaged executable still has an unexpected icon resource at pixel $x,$y " +
            "(actual A=$($actualPixel.A) ARGB=$actualArgb; expected A=$($expectedPixel.A) ARGB=$expectedArgb)."
        }
      }
    }
  } finally {
    $actualBitmap.Dispose()
    $expectedBitmap.Dispose()
  }
} finally {
  $actual32.Dispose()
  $associated.Dispose()
  $expectedStream.Dispose()
}

Write-Host "Packaged executable icon verified: $resolvedExecutable"
