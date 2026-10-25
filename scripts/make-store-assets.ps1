# Generates the Windows tile assets for the MSIX package and the 300x300 Store
# icon from the application logo. Run from the repository root:
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-store-assets.ps1
#
# The tiles use the app's dark surface colour with the mark centred; the source
# PNG is 512x512 with transparency, so each output is composited rather than
# stretched.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'src/img/writecanvas.png'
$appx = Join-Path $root 'build/appx'
$store = Join-Path $root 'store'
New-Item -ItemType Directory -Force -Path $appx, $store | Out-Null

$background = [System.Drawing.ColorTranslator]::FromHtml('#15181D')
$logo = [System.Drawing.Image]::FromFile($source)

function New-Asset {
  param(
    [string]$Path,
    [int]$Width,
    [int]$Height,
    [double]$Scale,        # logo size as a fraction of the smaller dimension
    [bool]$Transparent = $false
  )

  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  if ($Transparent) {
    $graphics.Clear([System.Drawing.Color]::Transparent)
  } else {
    $graphics.Clear($background)
  }

  $side = [Math]::Min($Width, $Height) * $Scale
  $x = ($Width - $side) / 2
  $y = ($Height - $side) / 2
  $graphics.DrawImage($logo, [int]$x, [int]$y, [int]$side, [int]$side)

  $graphics.Dispose()
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  Write-Host ("{0}  {1}x{2}" -f (Split-Path -Leaf $Path), $Width, $Height)
}

# Required by the MSIX manifest.
New-Asset -Path (Join-Path $appx 'StoreLogo.png')           -Width 50  -Height 50  -Scale 0.82
New-Asset -Path (Join-Path $appx 'Square44x44Logo.png')     -Width 44  -Height 44  -Scale 0.82
New-Asset -Path (Join-Path $appx 'Square150x150Logo.png')   -Width 150 -Height 150 -Scale 0.72
New-Asset -Path (Join-Path $appx 'Wide310x150Logo.png')     -Width 310 -Height 150 -Scale 0.72
New-Asset -Path (Join-Path $appx 'LargeTile.png')           -Width 310 -Height 310 -Scale 0.62
New-Asset -Path (Join-Path $appx 'SmallTile.png')           -Width 71  -Height 71  -Scale 0.78
New-Asset -Path (Join-Path $appx 'SplashScreen.png')        -Width 620 -Height 300 -Scale 0.56

# The Store listing icon, shown on product pages and in search.
New-Asset -Path (Join-Path $store 'AppTileIcon-300.png')    -Width 300 -Height 300 -Scale 0.70

$logo.Dispose()
Write-Host 'done'
