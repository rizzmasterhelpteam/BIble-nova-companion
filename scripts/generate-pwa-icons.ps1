param(
  [string]$Source = "public/favicon.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root $Source
$destinationDirectory = Join-Path $root "public/icons"

if (-not (Test-Path $sourcePath)) {
  throw "PWA icon source not found: $sourcePath"
}

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)

try {
  foreach ($target in @(
    @{ Name = "icon-192.png"; Size = 192 },
    @{ Name = "icon-512.png"; Size = 512 }
  )) {
    $bitmap = New-Object System.Drawing.Bitmap(
      $target.Size,
      $target.Size,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.DrawImage($sourceImage, 0, 0, $target.Size, $target.Size)
      $bitmap.Save(
        (Join-Path $destinationDirectory $target.Name),
        [System.Drawing.Imaging.ImageFormat]::Png
      )
    }
    finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
}
finally {
  $sourceImage.Dispose()
}
