$ErrorActionPreference = 'Continue'
$deadline = (Get-Date).AddMinutes(40)
while ((Get-Date) -lt $deadline) {
  try {
    $html = & curl.exe -sS --max-time 20 -A "Mozilla/5.0" 'https://jobinterviewcracker.com/'
    $m = [regex]::Match($html, 'src="(/assets/index-[^"]+\.js)"')
    if (-not $m.Success) {
      Write-Output ("WAIT no_asset ts=" + (Get-Date -Format o))
      Start-Sleep -Seconds 60
      continue
    }
    $path = $m.Groups[1].Value
    $tmp = Join-Path $env:TEMP 'prod-ask-watch.js'
    & curl.exe -sS --max-time 90 -A "Mozilla/5.0" ("https://jobinterviewcracker.com" + $path) -o $tmp
    $len = (Get-Item $tmp).Length
    # Real bundles are hundreds of KB; SPA fallback is ~1.5KB HTML
    if ($len -lt 50000) {
      Write-Output ("WAIT broken_or_missing asset=" + $path + " size=" + $len + " ts=" + (Get-Date -Format o))
      Start-Sleep -Seconds 60
      continue
    }
    $js = Get-Content -Raw -Path $tmp -Encoding UTF8
    if ($js -match 'earn_floor|speak-ask-line|binding constraint') {
      Write-Output ("DONE ask_deployed asset=" + $path + " size=" + $len)
      exit 0
    }
    if ($js -match 'speak-cool-line') {
      Write-Output ("WAIT still_old_cool_only asset=" + $path + " size=" + $len + " ts=" + (Get-Date -Format o))
    } else {
      Write-Output ("WAIT unknown_js asset=" + $path + " size=" + $len + " ts=" + (Get-Date -Format o))
    }
  } catch {
    Write-Output ("WAIT error ts=" + (Get-Date -Format o))
  }
  Start-Sleep -Seconds 60
}
Write-Output 'FAILED timeout_no_ask_on_prod'
exit 1
