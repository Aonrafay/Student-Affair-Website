$ErrorActionPreference = 'Continue'
$Base = 'http://10.116.233.254:5000/student-affairs'
$fail = 0
function Check($n, $ok, $d = '') {
  if ($ok) { "PASS  $n  $d" } else { $script:fail++; "FAIL  $n  $d" }
}

$login = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ email = 'admin@niit.edu.pk'; password = '0581696f34efce3e928a68b2' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }

# --- 1. upload content spoofing -------------------------------------------
$html = "<html><body><script>alert(1)</script>spoofed</body></html>"
$tmp = Join-Path $env:TEMP 'spoof.png'
Set-Content -Path $tmp -Value $html -NoNewline -Encoding UTF8

# Declare it as a PNG. Before the fix this stored HTML under a .png name.
$resp = $null
try {
  $resp = curl.exe -s -X POST "$Base/api/admin/media" -H "Authorization: Bearer $($login.token)" `
    -F "file=@$tmp;type=image/png" -F "caption=x" -w "`nHTTP:%{http_code}"
} catch {}
$body = $resp -join "`n"
Check 'HTML declared as image/png is rejected' ($body -match 'HTTP:400') ($body -split "`n" | Select-Object -Last 1)
Check 'rejection explains the mismatch' ($body -match 'do not look like|rejected') ''

# Confirm nothing was actually stored, and no stray file was left behind.
$media = Invoke-RestMethod -Uri "$Base/api/admin/media" -Headers $h
Check 'no media row was created by the spoof' (-not (@($media) | Where-Object { $_.caption -eq 'x' })) ''

# --- 2. driver errors must not reach the client ----------------------------
# A title far longer than the VARCHAR forces ER_DATA_TOO_LONG out of MySQL.
# Before the fix the response body read "Data too long for column 'title' at row
# 1", naming the table and column. Build the JSON in a file: passing a long
# string inline through -d goes through PowerShell quoting and arrives malformed,
# which fails as a JSON parse error and never exercises the database at all.
$longTitle = 'T' * 5000
$payload = Join-Path $env:TEMP 'longtitle.json'
@{ title = $longTitle } | ConvertTo-Json | Set-Content -Path $payload -NoNewline -Encoding UTF8

$r = curl.exe -s -X POST "$Base/api/admin/posts" `
  -H "Authorization: Bearer $($login.token)" `
  -H "Content-Type: application/json" --data-binary "@$payload" -w "`nHTTP:%{http_code}"
$rBody = $r -join "`n"
$leaks = ($rBody -match "ER_DATA_TOO_LONG|Data too long|ER_") -or
         ($rBody -match 'at Object\.|node_modules|node:internal')
Check 'oversized title does not leak the driver error' (-not $leaks) `
    ($rBody.Trim() -replace "`r?`n", ' ')
Check 'oversized title was rejected at the DB (proves the path ran)' `
    ($rBody -match 'HTTP:400' -and $rBody -notmatch 'JSON at position') 'reached MySQL, not the JSON parser'
Remove-Item $payload -Force -ErrorAction SilentlyContinue

# --- 3. health endpoint leak ----------------------------------------------
$health = curl.exe -s "$Base/api/health" -w "`nHTTP:%{http_code}"
$hBody = $health -join "`n"
Check 'health returns no error field on success' ($hBody -match '"db":true' -and $hBody -notmatch '"error"') ($hBody.Trim())

# --- 4. sanitiser is live ---------------------------------------------------
$js = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/js/api.js").Content
Check 'api.js ships the renderer override' ($js -match 'renderer: mdRenderer\(\)') ''
Check 'api.js ships the scheme allowlist' ($js -match 'safeUrl') ''

Remove-Item $tmp -Force -ErrorAction SilentlyContinue
''
if ($fail -eq 0) { 'FIX VERIFICATION PASSED'; exit 0 } else { "$fail FAILED"; exit 1 }