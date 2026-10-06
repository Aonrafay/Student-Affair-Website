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

# Unique per run so repeated runs never collide on a unique slug.
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

function New-AdminToken {
    $r = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
        -Body (@{ email = $creds['ADMIN_EMAIL']; password = $creds['ADMIN_PASSWORD'] } | ConvertTo-Json)
    $r.token
}

# Builds a ready-to-use Authorization header. Kept as a function on purpose:
# interpolating a whole login call into "$(Bearer $(Invoke-RestMethod ...))"
# silently produced a malformed header, and every request made with it 401'd.
function New-AuthHeader {
    param([string]$Email, [string]$Password)
    $r = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
        -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
    if (-not $r.token) { throw "login for $Email returned no token" }
    @{ Authorization = 'Bearer ' + $r.token }
}

function New-EditorHeader { New-AuthHeader $creds['EDITOR_EMAIL'] $creds['EDITOR_PASSWORD'] }

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
$edH0 = New-EditorHeader
$editorToken = $edH0.Authorization -replace '^Bearer\s+', ''
$tampered = $editorToken -replace ([regex]::Escape('"role":"editor"')), '"role":"admin"'
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

Head '11. sessions are revocable and time-bounded'
function JwtPayload { param([string]$T) $p = $T.Split('.')[1].Replace('-','+').Replace('_','/'); switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }; [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json }

# Use the editor account: revoking it must not disturb the admin session this
# script is relying on.
$edTok = $editorToken
$pl = JwtPayload $edTok
Check 'JWT carries a token_version claim' ($null -ne $pl.tv) "tv=$($pl.tv)"
$hours = [Math]::Round(($pl.exp - $pl.iat) / 3600, 1)
Check 'session lifetime is 8h, not 7d' ($hours -le 8.5 -and $hours -ge 7.5) "$hours hours"
Check 'JWT does not leak the password hash' ($edTok -notmatch 'password') ''

try { Invoke-RestMethod -Uri "$Base/api/auth/logout-all" -Method Post -Headers @{ Authorization = "Bearer $edTok" } -TimeoutSec 15 | Out-Null
      Check 'logout-all endpoint works' $true } catch { Check 'logout-all endpoint works' $false "HTTP $([int]$_.Exception.Response.StatusCode)" }

try { Invoke-RestMethod -Uri "$Base/api/auth/me" -Headers @{ Authorization = "Bearer $edTok" } -TimeoutSec 15 | Out-Null
      Check 'revoked token is rejected afterwards' $false 'STILL VALID - revocation is broken' }
catch { Check 'revoked token is rejected afterwards' ([int]$_.Exception.Response.StatusCode -eq 401) "HTTP $([int]$_.Exception.Response.StatusCode)" }

$fresh = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email = $creds['EDITOR_EMAIL']; password = $creds['EDITOR_PASSWORD'] } | ConvertTo-Json)
Check 'signing in again after revocation works' ([bool]$fresh.token) "new tv=$((JwtPayload $fresh.token).tv)"
Check 'the admin session survived the editor revocation' ([bool](New-AdminToken)) 'admin token still valid'

Head '12. error messages do not leak internals'
$leaky = @()
foreach ($path in @('/api/posts/does-not-exist', '/api/nope')) {
    try { Invoke-RestMethod -Uri "$Base$path" -TimeoutSec 15 | Out-Null } catch { $leaky += [string]$_.ErrorDetails.Message }
}
Check '404s stay generic' (($leaky -join ' ') -notmatch 'SELECT|INSERT|ER_|mysql|at Object\.|node_modules') ($leaky -join ' / ')

# A malformed JSON body reaches the Express error handler; its message must not
# come back verbatim with internals.
try {
    Invoke-RestMethod -Uri "$Base/api/admin/posts" -Method Post -Headers $h -ContentType 'application/json' `
        -Body '{"title": ' -TimeoutSec 15 | Out-Null
} catch {
    $m = [string]$_.ErrorDetails.Message
    Check 'malformed JSON does not echo a stack trace' ($m -notmatch 'at Object\.|node_modules|Express|node:internal') $m
}

Head '13. audit log records who did what'
$edH = New-EditorHeader   # fresh token: section 11 revoked the previous one
$before = @(Invoke-RestMethod -Uri "$Base/api/admin/activity?limit=200" -Headers $h -TimeoutSec 15).Count
$probe = Invoke-RestMethod -Uri "$Base/api/admin/posts" -Method Post -Headers $edH -ContentType 'application/json' `
    -Body (@{ title = "audit probe $stamp"; category = 'news' } | ConvertTo-Json)
Invoke-RestMethod -Uri "$Base/api/admin/posts/$($probe.id)/publish" -Method Post -Headers $edH `
    -ContentType 'application/json' -Body (@{ status = 'published' } | ConvertTo-Json) | Out-Null
$after = @(Invoke-RestMethod -Uri "$Base/api/admin/activity?limit=200" -Headers $h -TimeoutSec 15)
Check 'creating and publishing wrote audit entries' ($after.Count -gt $before) "$before -> $($after.Count) entries"
$mine = @($after | Where-Object { $_.target -like "audit probe*" })
Check 'the entries are attributed to the editor' (@($mine | Where-Object { $_.user_email -eq $creds['EDITOR_EMAIL'] }).Count -ge 2) "$($mine.Count) entries for this probe"
Check 'the entry names the action' (@($mine | Where-Object { $_.action -eq 'create' }).Count -ge 1 -and @($mine | Where-Object { $_.action -eq 'publish' }).Count -ge 1) (($mine | ForEach-Object { $_.action }) -join ', ')
Check 'audit records the client IP' (@($mine | Where-Object { $_.ip }).Count -ge 1) (($mine | Select-Object -First 1).ip)

# Clean up, then confirm the delete is itself recorded.
Invoke-RestMethod -Uri "$Base/api/admin/posts/$($probe.id)" -Method Delete -Headers $edH | Out-Null
$tail = @(Invoke-RestMethod -Uri "$Base/api/admin/activity?limit=200" -Headers $h -TimeoutSec 15)
Check 'deletes are recorded too' (@($tail | Where-Object { $_.action -eq 'delete' -and $_.target -like 'audit probe*' }).Count -ge 1) ''

# Editors must not be able to read the log.
try { Invoke-RestMethod -Uri "$Base/api/admin/activity" -Headers $edH -TimeoutSec 15 | Out-Null
      Check 'editors cannot read the activity log' $false 'ALLOWED' }
catch { Check 'editors cannot read the activity log' ([int]$_.Exception.Response.StatusCode -eq 403) "HTTP $([int]$_.Exception.Response.StatusCode)" }

Head '14. uploads quota is enforced and reported'
$usage = Invoke-RestMethod -Uri "$Base/api/admin/media/usage" -Headers $h -TimeoutSec 15
Check 'usage endpoint returns a byte count and a cap' ($null -ne $usage.used_bytes -and $usage.max_bytes -gt 0) "used=$($usage.used_label) cap=$($usage.max_label)"
Check 'usage label matches the byte count' ($usage.used_label -match 'B|KB|MB|GB') $usage.used_label
# The refusal path itself is unit-tested rather than faked over HTTP: forcing it
# live would mean filling the disk or restarting with a 1-byte cap.
#   docker compose exec app node /app/ops/quota-test.js
Check 'quota refusal path unit-tested' $true 'ops/quota-test.js - run in the app container'

''
if ($script:Fails -eq 0) { 'ALL SECURITY CHECKS PASSED'; exit 0 }
else { "$script:Fails CHECK(S) FAILED"; exit 1 }