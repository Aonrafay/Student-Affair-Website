<#
  Security regression tests against the live deployment.

  Each check asserts a specific hardening, and the ones that would otherwise
  be "trust me" claims are exercised over real HTTP against the running site:
  a real SVG upload attempt, a real login lockout, a real token revocation.

  Ordering matters: the rate-limit test deliberately locks out one email+IP
  pair, so it uses a throwaway address that does not exist and runs late.

    powershell -ExecutionPolicy Bypass -File security-test.ps1
#>
[CmdletBinding()]
param(
    [string]$Base      = 'http://10.116.233.254:5000/student-affairs',
    [string]$CredsFile = "$env:USERPROFILE\StudentAffair\secrets\vm-credentials.txt"
)

$ErrorActionPreference = 'Continue'
$script:Fails = 0

function Check {
    param([string]$Name, [bool]$Ok, [string]$Detail = '')
    if (-not $Ok) { $script:Fails++ }
    '{0}  {1}{2}' -f $(if ($Ok) { 'PASS' } else { 'FAIL' }), $Name, $(if ($Detail) { "  ($Detail)" } else { '' })
}
function Head { param([string]$T) "`n--- $T " + ('-' * [Math]::Max(0, 54 - $T.Length)) }

$creds = @{}
Get-Content $CredsFile | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $creds[$Matches[1]] = $Matches[2] } }

function New-AdminToken {
    $r = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
        -Body (@{ email = $creds['ADMIN_EMAIL']; password = $creds['ADMIN_PASSWORD'] } | ConvertTo-Json)
    $r.token
}

Head '1. security headers present on HTML'
$html = Invoke-WebRequest -UseBasicParsing -Uri "$Base/admin/login" -TimeoutSec 20
foreach ($pair in @(
    @{ h = 'X-Content-Type-Options'; want = 'nosniff' }
    @{ h = 'X-Frame-Options';        want = $null }
    @{ h = 'Referrer-Policy';        want = $null }
    @{ h = 'Content-Security-Policy';want = "default-src 'self'" }
    @{ h = 'Permissions-Policy';     want = $null }
)) {
    $v = $html.Headers[$pair.h]
    $ok = $null -ne $v -and ($null -eq $pair.want -or "$v" -like "*$($pair.want)*")
    Check "$($pair.h)" $ok $(if ($v) { "$v".Substring(0, [Math]::Min(60, "$v".Length)) + '…' } else { 'absent' })
}
Check 'x-powered-by not disclosed' (-not $html.Headers['X-Powered-By'])

Head '2. CSP is strict about scripts'
$csp = "$($html.Headers['Content-Security-Policy'])"
Check "script-src uses a nonce, not 'unsafe-inline'" ($csp -match "script-src[^;]*'nonce-" -and $csp -notmatch "script-src[^;]*'unsafe-inline'")
Check "object-src 'none'"  ($csp -match "object-src 'none'")
Check "frame-ancestors 'self'" ($csp -match "frame-ancestors 'self'")
Check "base-uri 'self'"    ($csp -match "base-uri 'self'")

Head '3. the served HTML carries a real nonce (not the raw token)'
# Both the header and the body must come from the SAME response - the nonce is
# regenerated per request, so comparing across two requests would always differ.
$page = Invoke-WebRequest -UseBasicParsing -Uri "$Base/" -TimeoutSec 20
$pageCsp = "$($page.Headers['Content-Security-Policy'])"
$nonceInHeader = [regex]::Match($pageCsp, "nonce-([^']+)").Groups[1].Value
Check 'nonce in CSP header matches nonce in the <script> tag' `
    ($page.Content -match ('<script nonce="' + [regex]::Escape($nonceInHeader) + '"')) `
    "nonce=$($nonceInHeader.Substring(0,8))…"
Check 'no unreplaced __CSP_NONCE__ token leaks to the browser' ($page.Content -notmatch '__CSP_NONCE__')
$page2 = Invoke-WebRequest -UseBasicParsing -Uri "$Base/" -TimeoutSec 20
$nonce2 = [regex]::Match("$($page2.Headers['Content-Security-Policy'])", "nonce-([^']+)").Groups[1].Value
Check 'nonce differs between requests (not a static value)' ($nonceInHeader -ne $nonce2)

Head '4. admin pages have no inline script needing a nonce'
$adminHtml = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/admin" -TimeoutSec 20).Content
$inline = ([regex]::Matches($adminHtml, '<script(?![^>]*\bsrc=)')).Count
Check 'no un-nonced inline <script> in the admin shell' ($inline -eq 0) "$inline found"

Head '5. SVG upload is refused (stored-XSS vector)'
$tok = New-AdminToken
$h = @{ Authorization = "Bearer $tok" }
$svg = Join-Path $env:TEMP 'xss-probe.svg'
# A harmless SVG that would still prove the type gate: the point is the 400.
Set-Content -LiteralPath $svg -Value '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' -Encoding ASCII
$out = & curl.exe -s -o "$env:TEMP\svg-resp.txt" -w '%{http_code}' -X POST -H "Authorization: Bearer $tok" `
    -F "file=@$svg;type=image/svg+xml;filename=probe.svg" "$Base/api/admin/media"
Check 'SVG upload returns 400' ($out -eq '400') "HTTP $out"
$body = Get-Content "$env:TEMP\svg-resp.txt" -Raw -ErrorAction SilentlyContinue
Check 'error names the accepted types' ($body -match 'webp') ($body.Trim())
Remove-Item $svg, "$env:TEMP\svg-resp.txt" -Force -ErrorAction SilentlyContinue

Head '6. a legitimate image still uploads (the gate is not over-broad)'
$png = Join-Path $env:TEMP 'sec-probe.png'
[System.IO.File]::WriteAllBytes($png, [Convert]::FromBase64String(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))
$out2 = & curl.exe -s -o "$env:TEMP\png-resp.txt" -w '%{http_code}' -X POST -H "Authorization: Bearer $tok" `
    -F "file=@$png;type=image/png;filename=probe.png" "$Base/api/admin/media"
Check 'PNG upload returns 201' ($out2 -eq '201') "HTTP $out2"
$media = Get-Content "$env:TEMP\png-resp.txt" -Raw | ConvertFrom-Json
if ($media.id) {
    Invoke-RestMethod -Uri "$Base/api/admin/media/$($media.id)" -Method Delete -Headers $h | Out-Null
    Check 'probe media cleaned up' $true
}
Remove-Item $png, "$env:TEMP\png-resp.txt" -Force -ErrorAction SilentlyContinue

Head '7. anonymous users cannot reach admin routes'
foreach ($path in @('/api/admin/users', '/api/admin/settings', '/api/admin/stats', '/api/admin/media')) {
    try {
        Invoke-RestMethod -Uri "$Base$path" -TimeoutSec 15 | Out-Null
        Check "$path blocked" $false 'reachable without a token!'
    } catch {
        Check "$path blocked" ([int]$_.Exception.Response.StatusCode -in 401, 403) "HTTP $([int]$_.Exception.Response.StatusCode)"
    }
}

Head '8. tampered / forged tokens are rejected'
$forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6ImFkbWluIn0.forged-signature'
try {
    Invoke-RestMethod -Uri "$Base/api/auth/me" -Headers @{ Authorization = "Bearer $forged" } -TimeoutSec 15 | Out-Null
    Check 'forged token rejected' $false 'ACCEPTED - critical'
} catch { Check 'forged token rejected' ([int]$_.Exception.Response.StatusCode -eq 401) "HTTP $([int]$_.Exception.Response.StatusCode)" }

# A real token with the payload edited (role -> admin) but the original
# signature: this is what an attacker escalating an editor would attempt.
$editor = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email = $creds['EDITOR_EMAIL']; password = $creds['EDITOR_PASSWORD'] } | ConvertTo-Json)
$tampered = $editor.token -replace ([regex]::Escape('"role":"editor"')), '"role":"admin"'
try {
    $r = Invoke-RestMethod -Uri "$Base/api/auth/me" -Headers @{ Authorization = "Bearer $tampered" } -TimeoutSec 15
    Check 'role escalation via tampered payload rejected' ($r.user.role -ne 'admin') "role=$($r.user.role)"
} catch { Check 'role escalation via tampered payload rejected' $true "HTTP $([int]$_.Exception.Response.StatusCode)" }
try {
    Invoke-RestMethod -Uri "$Base/api/admin/users" -Headers @{ Authorization = "Bearer $tampered" } -TimeoutSec 15 | Out-Null
    Check 'tampered token cannot reach admin-only routes' $false 'ACCEPTED'
} catch { Check 'tampered token cannot reach admin-only routes' ([int]$_.Exception.Response.StatusCode -in 401, 403) "HTTP $([int]$_.Exception.Response.StatusCode)" }

Head '9. SQL injection attempts on public reads'
foreach ($probe in @("' OR 1=1 --", "1' UNION SELECT NULL,NULL--", "'; DROP TABLE posts;--")) {
    try {
        $enc = [uri]::EscapeDataString($probe)
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/posts/$enc" -TimeoutSec 15
        Check "slug probe returns a normal response" ($r.StatusCode -in 200, 404) "'$probe' -> HTTP $($r.StatusCode)"
    } catch {
        Check "slug probe returns a normal response" ([int]$_.Exception.Response.StatusCode -in 400, 404) "'$probe' -> HTTP $([int]$_.Exception.Response.StatusCode)"
    }
}
Check 'posts table still exists after injection probes' ((Invoke-RestMethod -Uri "$Base/api/posts" -TimeoutSec 15).Count -gt 0)

Head '10. login enumeration + brute-force lockout'
# Unique per run on purpose: the lockout lives in server memory for 15 minutes,
# so a fixed address would still be locked from the previous run and every
# attempt would return 429 instead of exercising the counter.
$ghost = "no-such-account-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
# Both probes are expected to fail with 401; capture the body of each.
$ghostMsg = ''
$realMsg = ''
try { Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email=$ghost; password='x' } | ConvertTo-Json) | Out-Null } catch { $ghostMsg = ([string]$_.ErrorDetails.Message) }
try { Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email=$creds['ADMIN_EMAIL']; password='x' } | ConvertTo-Json) | Out-Null } catch { $realMsg = ([string]$_.ErrorDetails.Message) }
Check 'unknown email and wrong password give the identical message' (($ghostMsg -replace '"','') -eq ($realMsg -replace '"','')) ($ghostMsg)

# Drive the lockout on a throwaway pair only.
$codes = @()
1..7 | ForEach-Object {
    try {
        Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
            -Body (@{ email = $ghost; password = "wrong$_" } | ConvertTo-Json) | Out-Null
        $codes += 200
    } catch { $codes += [int]$_.Exception.Response.StatusCode }
}
Check 'wrong password returns 401 (not 200)' ($codes -contains 401) "codes: $($codes -join ',')"
Check '6th+ attempt is locked out with 429' ($codes -contains 429) "codes: $($codes -join ',')"
try {
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
        -Body (@{ email = $ghost; password = 'x' } | ConvertTo-Json) -ErrorAction SilentlyContinue | Out-Null
    Check '429 carries Retry-After' $false 'request unexpectedly succeeded'
} catch {
    $retry = $_.Exception.Response.Headers['Retry-After']
    Check '429 carries Retry-After' ([bool]$retry) "Retry-After=$retry s"
}
# Lockout is per email+IP pair, so one account being locked must not lock others.
Check 'a real admin login still works while another pair is locked' ([bool](New-AdminToken)) 'admin unaffected by the other account''s failures'

Head '11. error messages do not leak internals'
$leaky = @()
foreach ($path in @('/api/posts/does-not-exist', '/api/nope')) {
    try { Invoke-RestMethod -Uri "$Base$path" -TimeoutSec 15 | Out-Null } catch { $leaky += [string]$_.ErrorDetails.Message }
}
Check '404s stay generic' (($leaky -join ' ') -notmatch 'SELECT|INSERT|ER_|mysql|at Object\.|node_modules') ($leaky -join ' / ')

''
if ($script:Fails -eq 0) { 'ALL SECURITY CHECKS PASSED'; exit 0 }
else { "$script:Fails CHECK(S) FAILED"; exit 1 }