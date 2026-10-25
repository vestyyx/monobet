# One-off: generate a tiny demo JPEG (colored rectangles — a playful guessed
# "what is this?" abstract photo) and print it as a base64 data URL.
Add-Type -AssemblyName System.Drawing

$w = 320; $h = 240
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 248, 240, 230))
$g.FillRectangle($bg, 0, 0, $w, $h)

$colors = @([System.Drawing.Color]::FromArgb(255, 240, 138, 29), [System.Drawing.Color]::FromArgb(255, 90, 140, 200), [System.Drawing.Color]::FromArgb(255, 120, 180, 120))
$rand = New-Object System.Random(7)
for ($i = 0; $i -lt 14; $i++) {
  $c = $colors[$i % 3]
  $b = New-Object System.Drawing.SolidBrush($c)
  $x = $rand.Next(0, $w - 60); $y = $rand.Next(0, $h - 60)
  $size = $rand.Next(24, 80)
  $g.FillEllipse($b, $x, $y, $size, $size)
  $b.Dispose()
}
$g.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()
$dataUrl = "data:image/jpeg;base64," + [Convert]::ToBase64String($ms.ToArray())
Set-Content -Path scripts\seed-photo-dataurl.txt -Value $dataUrl -NoNewline
"chars: $($dataUrl.Length)"
