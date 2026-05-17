param(
  [string]$Source = "src/assets/app-logo.png"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-Bitmap {
  param(
    [int]$Width,
    [int]$Height
  )

  return New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function New-Graphics {
  param(
    [System.Drawing.Bitmap]$Bitmap
  )

  $graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  return $graphics
}

function Save-Png {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Destination
  )

  $directory = Split-Path -Parent $Destination
  if ($directory) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  $Bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Write-Icon {
  param(
    [System.Drawing.Image]$SourceImage,
    [string]$Destination,
    [int]$Size,
    [double]$Scale = 0.88,
    [string]$Background = "#FFFFFF"
  )

  $bitmap = New-Bitmap -Width $Size -Height $Size
  $graphics = New-Graphics -Bitmap $bitmap

  try {
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($Background))

    $scaled = [int][Math]::Round($Size * $Scale)
    $offset = [int][Math]::Round(($Size - $scaled) / 2)
    $graphics.DrawImage($SourceImage, $offset, $offset, $scaled, $scaled)

    Save-Png -Bitmap $bitmap -Destination $Destination
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Write-Splash {
  param(
    [System.Drawing.Image]$SourceImage,
    [string]$Destination,
    [int]$Width,
    [int]$Height,
    [double]$Scale = 0.34,
    [string]$Background = "#111827"
  )

  $bitmap = New-Bitmap -Width $Width -Height $Height
  $graphics = New-Graphics -Bitmap $bitmap

  try {
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($Background))

    $scaled = [int][Math]::Round(([Math]::Min($Width, $Height)) * $Scale)
    $left = [int][Math]::Round(($Width - $scaled) / 2)
    $top = [int][Math]::Round(($Height - $scaled) / 2)
    $graphics.DrawImage($SourceImage, $left, $top, $scaled, $scaled)

    Save-Png -Bitmap $bitmap -Destination $Destination
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root $Source

if (-not (Test-Path $sourcePath)) {
  throw "Logo source not found: $sourcePath"
}

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)

try {
  $iconTargets = @(
    @{ Path = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"; Size = 1024 },
    @{ Path = "android/app/src/main/res/mipmap-mdpi/ic_launcher.png"; Size = 48 },
    @{ Path = "android/app/src/main/res/mipmap-hdpi/ic_launcher.png"; Size = 72 },
    @{ Path = "android/app/src/main/res/mipmap-xhdpi/ic_launcher.png"; Size = 96 },
    @{ Path = "android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png"; Size = 144 },
    @{ Path = "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"; Size = 192 },
    @{ Path = "android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png"; Size = 48 },
    @{ Path = "android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png"; Size = 72 },
    @{ Path = "android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png"; Size = 96 },
    @{ Path = "android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png"; Size = 144 },
    @{ Path = "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png"; Size = 192 },
    @{ Path = "android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png"; Size = 108 },
    @{ Path = "android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png"; Size = 162 },
    @{ Path = "android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png"; Size = 216 },
    @{ Path = "android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png"; Size = 324 },
    @{ Path = "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png"; Size = 432 },
    @{ Path = "public/favicon.png"; Size = 512 }
  )

  foreach ($target in $iconTargets) {
    Write-Icon -SourceImage $sourceImage -Destination (Join-Path $root $target.Path) -Size $target.Size
  }

  $splashTargets = @(
    @{ Path = "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png"; Width = 2732; Height = 2732 },
    @{ Path = "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png"; Width = 2732; Height = 2732 },
    @{ Path = "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png"; Width = 2732; Height = 2732 },
    @{ Path = "android/app/src/main/res/drawable/splash.png"; Width = 480; Height = 320 },
    @{ Path = "android/app/src/main/res/drawable-land-mdpi/splash.png"; Width = 480; Height = 320 },
    @{ Path = "android/app/src/main/res/drawable-land-hdpi/splash.png"; Width = 800; Height = 480 },
    @{ Path = "android/app/src/main/res/drawable-land-xhdpi/splash.png"; Width = 1280; Height = 720 },
    @{ Path = "android/app/src/main/res/drawable-land-xxhdpi/splash.png"; Width = 1600; Height = 960 },
    @{ Path = "android/app/src/main/res/drawable-land-xxxhdpi/splash.png"; Width = 1920; Height = 1280 },
    @{ Path = "android/app/src/main/res/drawable-port-mdpi/splash.png"; Width = 320; Height = 480 },
    @{ Path = "android/app/src/main/res/drawable-port-hdpi/splash.png"; Width = 480; Height = 800 },
    @{ Path = "android/app/src/main/res/drawable-port-xhdpi/splash.png"; Width = 720; Height = 1280 },
    @{ Path = "android/app/src/main/res/drawable-port-xxhdpi/splash.png"; Width = 960; Height = 1600 },
    @{ Path = "android/app/src/main/res/drawable-port-xxxhdpi/splash.png"; Width = 1280; Height = 1920 }
  )

  foreach ($target in $splashTargets) {
    Write-Splash -SourceImage $sourceImage -Destination (Join-Path $root $target.Path) -Width $target.Width -Height $target.Height
  }
}
finally {
  $sourceImage.Dispose()
}

Write-Output "Generated native icons, splash assets, and favicon from $Source"
