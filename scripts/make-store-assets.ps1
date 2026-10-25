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

# The two smaller Store display tiles.
New-Asset -Path (Join-Path $store 'StoreTile-150.png')      -Width 150 -Height 150 -Scale 0.72
New-Asset -Path (Join-Path $store 'StoreTile-71.png')       -Width 71  -Height 71  -Scale 0.78

# Poster art (9:16) and box art (1:1): the mark plus the product name on the dark
# surface. Partner Center accepts the name on these, and the poster keeps every
# element inside the top two-thirds because some layouts draw an overlay over the
# bottom third.
function New-Branded {
  param([string]$Path, [int]$Width, [int]$Height)

  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear($background)

  $unit = [Math]::Min($Width, $Height) / 720.0
  $logoSide = [int](400 * $unit)
  $logoX = [int](($Width - $logoSide) / 2)
  $logoY = [int]($Height * 0.17)
  $graphics.DrawImage($logo, $logoX, $logoY, $logoSide, $logoSide)

  $fontSize = [int](92 * $unit)
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#F2F4F8'))
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $box = New-Object System.Drawing.RectangleF(0, [float]($logoY + $logoSide + 24 * $unit), [float]$Width, [float]($fontSize * 1.4))
  $graphics.DrawString('WriteCanvas', $font, $brush, $box, $format)

  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#7C5CFF'))
  $lineWidth = [int](160 * $unit)
  $lineY = [int]($box.Y + $box.Height + 18 * $unit)
  $graphics.FillRectangle($accent, [int](($Width - $lineWidth) / 2), $lineY, $lineWidth, [Math]::Max(3, [int](4 * $unit)))

  $graphics.Dispose()
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  Write-Host ("{0}  {1}x{2}" -f (Split-Path -Leaf $Path), $Width, $Height)
}

New-Branded -Path (Join-Path $store 'PosterArt-720x1080.png')    -Width 720  -Height 1080
New-Branded -Path (Join-Path $store 'PosterArt-1440x2160.png')   -Width 1440 -Height 2160
New-Branded -Path (Join-Path $store 'BoxArt-1080x1080.png')      -Width 1080 -Height 1080

$logo.Dispose()
Write-Host 'done'
