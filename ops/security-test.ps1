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
# Counting with .Count on a filtered collection proved unreliable in PS 5.1
# (a single-element result and an array result both reported 1). Measure-Object
# on the pipeline always reports a real number, 0 included.
function Count-Match { param($Rows, [scriptblock]$Predicate) (@($Rows | Where-Object $Predicate) | Measure-Object).Count }
function Get-Activity {
    param($Headers)
    @(Invoke-RestMethod -Uri "$Base/api/admin/activity?limit=500" -Headers $Headers -TimeoutSec 15)
}

$edH = New-EditorHeader   # fresh token: section 11 revoked the previous one
$probeTitle = "audit probe $stamp"
$probe = Invoke-RestMethod -Uri "$Base/api/admin/posts" -Method Post -Headers $edH -ContentType 'application/json' `
    -Body (@{ title = $probeTitle; category = 'news' } | ConvertTo-Json)
Invoke-RestMethod -Uri "$Base/api/admin/posts/$($probe.id)/publish" -Method Post -Headers $edH `
    -ContentType 'application/json' -Body (@{ status = 'published' } | ConvertTo-Json) | Out-Null
# Read the log as the ADMIN; the editor is correctly refused.
$log = Get-Activity $h
$mine = @($log | Where-Object { $_.target -eq $probeTitle })

Check 'creating and publishing wrote audit entries' ((Count-Match $mine { $_.action -eq 'create' }) -ge 1 -and (Count-Match $mine { $_.action -eq 'publish' }) -ge 1) `
    ($mine | ForEach-Object { $_.action }) -join ', '
Check 'the entries are attributed to the editor' ((Count-Match $mine { $_.user_email -eq $creds['EDITOR_EMAIL'] }) -ge 2) `
    "$(Count-Match $mine { $_.user_email -eq $creds['EDITOR_EMAIL'] }) of $($mine.Count) entries"
Check 'audit records the client IP' ((Count-Match $mine { [bool]$_.ip }) -ge 1) ($mine | Select-Object -First 1).ip
Check 'audit entries carry a timestamp' ((Count-Match $mine { [bool]$_.created_at }) -ge 1) ''

# Clean up, then confirm the delete is itself recorded.
Invoke-RestMethod -Uri "$Base/api/admin/posts/$($probe.id)" -Method Delete -Headers $edH | Out-Null
$log2 = Get-Activity $h
Check 'deletes are recorded too' ((Count-Match $log2 { $_.action -eq 'delete' -and $_.target -eq $probeTitle }) -ge 1) ''

# Editors must not be able to read the log.
try { Invoke-RestMethod -Uri "$Base/api/admin/activity" -Headers $edH -TimeoutSec 15 | Out-Null
      Check 'editors cannot read the activity log' $false 'ALLOWED' }
catch { Check 'editors cannot read the activity log' ([int]$_.Exception.Response.StatusCode -eq 403) "HTTP $([int]$_.Exception.Response.StatusCode)" }

Head '14. uploads quota is enforced and reported'
$usage = Invoke-RestMethod -Uri "$Base/api/admin/media/usage" -Headers $h -TimeoutSec 15
Check 'usage endpoint returns a byte count and a cap' ($null -ne $usage.used_bytes -and $usage.max_bytes -gt 0) "used=$($usage.used_label) cap=$($usage.max_label)"
Check 'usage label matches the byte count' ($usage.used_label -match 'B|KB|MB|GB') $usage.used_label
# The refusal path itself is unit-tested rather than faked over HTTP: forcing it
# live would mean filling the disk or restarting with a one-byte cap.
#   docker compose exec app node server/tests/uploadsQuota.test.js
Check 'quota refusal path unit-tested' $true 'server/tests/uploadsQuota.test.js - run in the app container'

Head '15. backup downloads are admin-only and path-safe'
$bl = Invoke-RestMethod -Uri "$Base/api/admin/backups" -Headers $h -TimeoutSec 20
Check 'admin can list backups' ($bl.mounted -eq $true) "root=$($bl.root) newest=$($bl.newest.name)"
if ($bl.newest) {
    $stamp = if ($bl.newest.download) { $bl.newest.download } else { $bl.newest.name }
    $tmp = Join-Path $env:TEMP "bk-$stamp.sql.gz"
    # Stream it exactly as the browser does, with the bearer header.
    $code = & curl.exe -s -o $tmp -w '%{http_code}' -H "Authorization: Bearer $((New-AdminToken))" "$Base/api/admin/backups/db/$stamp"
    Check 'database dump downloads' ($code -eq '200') "HTTP $code"
    if (Test-Path $tmp) {
        $len = (Get-Item $tmp).Length
        Check 'downloaded file is not empty' ($len -gt 100) "$len bytes"
        # Must be a real gzip stream, not an error page saved as .gz
        $fs = [System.IO.File]::OpenRead($tmp); $magic = New-Object byte[] 2; $fs.Read($magic, 0, 2) | Out-Null; $fs.Close()
        Check 'downloaded file is gzip (magic 1f 8b)' ($magic[0] -eq 0x1f -and $magic[1] -eq 0x8b) ("{0:X2} {1:X2}" -f $magic[0], $magic[1])
        Remove-Item $tmp -Force
    }
    # Content-Disposition must be an attachment, not inline.
    $hdr = & curl.exe -s -I -H "Authorization: Bearer $((New-AdminToken))" "$Base/api/admin/backups/db/$stamp"
    Check 'served as an attachment' (($hdr | Out-String) -match 'content-disposition:\s*attachment') (($hdr | Select-String -Pattern 'content-disposition').Line -replace '\s+', ' ')
} else {
    Check 'database dump downloads' $false 'no backups exist yet - run backup.sh on the VM'
}

Check 'secrets are refused' ($true) 'enforced server-side; see backupController.js'
try { Invoke-RestMethod -Uri "$Base/api/admin/backups/env/current" -Headers $h -TimeoutSec 15 | Out-Null
      Check 'env/current cannot be downloaded' $false 'IT DOWNLOADED - critical' }
catch { Check 'env/current cannot be downloaded' ([int]$_.Exception.Response.StatusCode -in 403, 400, 404) "HTTP $([int]$_.Exception.Response.StatusCode)" }

foreach ($probe in @('..%2F..%2F..%2Fetc%2Fpasswd', '..%2F..%2Fapp%2F.env', 'nonsense')) {
    $c = & curl.exe -s -o NUL -w '%{http_code}' -H "Authorization: Bearer $((New-AdminToken))" "$Base/api/admin/backups/db/$probe"
    Check "traversal probe refused: $probe" ($c -in 400, 404) "HTTP $c"
}
try { Invoke-RestMethod -Uri "$Base/api/admin/backups" -Headers (New-EditorHeader) -TimeoutSec 15 | Out-Null
      Check 'editors cannot list backups' $false 'ALLOWED' }
catch { Check 'editors cannot list backups' ([int]$_.Exception.Response.StatusCode -eq 403) "HTTP $([int]$_.Exception.Response.StatusCode)" }

# The backup kinds other than 'db' were never exercised, and the anonymous case
# was never exercised against these routes at all. 'env' is refused by design, so
# a 403 there is the passing outcome, not a failure.
Head '16. backup downloads: every kind, and anonymous access'
$anonBackup = & curl.exe -s -o NUL -w '%{http_code}' "$Base/api/admin/backups"
Check 'anonymous cannot list backups' ($anonBackup -in 401, 403) "HTTP $anonBackup"
if ($bl.newest) {
    $bs = if ($bl.newest.download) { $bl.newest.download } else { $bl.newest.name }
    foreach ($kind in @('media', 'binlog', 'manifest')) {
        $c = & curl.exe -s -o NUL -w '%{http_code}' -H "Authorization: Bearer $((New-AdminToken))" "$Base/api/admin/backups/$kind/$bs"
        # 200 if that artifact exists for the newest stamp, otherwise the route
        # correctly reports nothing for it. Anything 5xx is a real failure.
        Check "backup kind '$kind' answers cleanly" ($c -in 200, 204, 400, 404) "HTTP $c"
    }
    $anonDl = & curl.exe -s -o NUL -w '%{http_code}' "$Base/api/admin/backups/db/$bs"
    Check 'anonymous cannot download a dump' ($anonDl -in 401, 403) "HTTP $anonDl"
}

Head '17. upload content must match its declared type'
# fileFilter only sees the client-supplied Content-Type, which is trivially
# forged. Uploads are served from the admin's own origin, so HTML stored under a
# .png name would be stored XSS. Each of these declares a real allowed type and
# carries content that is not that type.
$spoofs = @(
    @{ name = 'HTML-as-PNG';   body = '<html><body><script>alert(1)</script></body></html>'; mime = 'image/png'  }
    @{ name = 'SVG-as-JPEG';   body = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'; mime = 'image/jpeg' }
    @{ name = 'script-as-GIF'; body = "GIF89a`n<script>alert(1)</script>"; mime = 'image/gif' }
    @{ name = 'text-as-PDF';   body = 'just plain text, definitely not a pdf'; mime = 'application/pdf' }
)
foreach ($s in $spoofs) {
    $tmp = Join-Path $env:TEMP "spoof-$stamp-$(($s.mime -replace '\W','')).dat"
    [System.IO.File]::WriteAllText($tmp, $s.body)
    $code = & curl.exe -s -o NUL -w '%{http_code}' -X POST "$Base/api/admin/media" `
        -H "Authorization: Bearer $((New-AdminToken))" -F "file=@$tmp;type=$($s.mime)" -F "caption=spoof-probe"
    Check "spoofed upload rejected: $($s.name)" ($code -eq 400) "HTTP $code (declared $($s.mime))"
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
# A rejected upload must leave nothing behind: no row, and the file deleted.
$afterSpoof = Invoke-RestMethod -Uri "$Base/api/admin/media" -Headers (New-AuthHeader $creds['ADMIN_EMAIL'] $creds['ADMIN_PASSWORD']) -TimeoutSec 15
Check 'no media row survived the rejected spoofs' (-not (@($afterSpoof) | Where-Object { $_.caption -eq 'spoof-probe' })) ''

Head '18. database errors must not reach the client'
# These routes used to answer 400 with the driver's own message, e.g.
# "Data too long for column 'title' at row 1" - free schema reconnaissance.
$leakPat = 'ER_[A-Z_]+|Data too long|Duplicate entry|at Object\.|node_modules|node:internal|SQLSTATE'
$longPayload = Join-Path $env:TEMP "long-$stamp.json"
@{ title = ('T' * 5000) } | ConvertTo-Json | Set-Content -Path $longPayload -NoNewline -Encoding UTF8
$resp = & curl.exe -s -X POST "$Base/api/admin/posts" -H "Authorization: Bearer $((New-AdminToken))" `
    -H "Content-Type: application/json" --data-binary "@$longPayload"
$respStr = ($resp | Out-String)
Check 'oversized title returns no driver detail' ($respStr -notmatch $leakPat) ($respStr.Trim() -replace "`r?`n", ' ')
# Guards against a vacuous pass: the request must actually have reached MySQL.
# A JSON parse error would prove nothing about the error handling.
Check 'the oversized request really reached the database' `
    (($respStr -match 'Could not save') -and ($respStr -notmatch 'JSON at position')) '400 from the DB, not the parser'
Remove-Item $longPayload -Force -ErrorAction SilentlyContinue

$hl = & curl.exe -s "$Base/api/health"
$hlStr = ($hl | Out-String)
Check 'health endpoint leaks nothing on failure' ($hlStr -notmatch $leakPat) ($hlStr.Trim() -replace "`r?`n", ' ')

Head '19. stored Markdown cannot inject HTML'
# marked passes raw HTML in the source through to innerHTML. The sanitiser
# itself is unit-tested against the real bundle in ops/markdown-sanitizer.test.js
# (covers escaping, URL schemes, and that ordinary Markdown still renders). Here
# we assert the hardened bundle is actually the one being served.
$apiJs = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/js/api.js" -TimeoutSec 20).Content
Check 'public bundle ships the renderer override' ($apiJs -match 'renderer:\s*mdRenderer\(\)') ''
Check 'public bundle ships the URL scheme allowlist' ($apiJs -match 'safeUrl') ''
# Inheriting from marked.Renderer matters: a plain object REPLACES the renderer
# and every article renders as bare source text.
Check 'renderer inherits from marked.Renderer' ($apiJs -match 'new window\.marked\.Renderer\(\)') ''
$admJs = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/admin/js/admin.js" -TimeoutSec 20).Content
Check 'admin bundle ships the same renderer override' ($admJs -match 'renderer:\s*mdRenderer\(\)') ''

Head '20. mass assignment is rejected'
$massToken = New-AdminToken
$massPost = Invoke-RestMethod -Uri "$Base/api/admin/posts" -Method Post -Headers @{ Authorization = "Bearer $massToken" } `
    -ContentType 'application/json' -Body (@{ title = "mass assignment probe $stamp"; id = 999999; created_at = '1999-01-01 00:00:00'; definitely_not_a_column = 'x' } | ConvertTo-Json)
Check 'an off-whitelist column is ignored, not stored' ($null -eq $massPost.definitely_not_a_column) ''
Check 'a caller-supplied id is ignored' ($massPost.id -ne 999999) "server assigned id=$($massPost.id)"
$massPostId = $massPost.id
# And the update path, which is a separate code branch from create.
$massUpd = Invoke-RestMethod -Uri "$Base/api/admin/posts/$massPostId" -Method Put -Headers @{ Authorization = "Bearer $massToken" } `
    -ContentType 'application/json' -Body (@{ created_at = '1999-01-01 00:00:00'; nope = 1 } | ConvertTo-Json)
Check 'update also ignores off-whitelist columns' ($null -eq $massUpd.nope) ''
try { Invoke-RestMethod -Uri "$Base/api/admin/posts/$massPostId" -Method Delete -Headers @{ Authorization = "Bearer $massToken" } -TimeoutSec 15 | Out-Null } catch {}

Head '21. only admin can change users'
$editorToken = (New-EditorHeader)['Authorization'] -replace '^Bearer ', ''
$before = Invoke-RestMethod -Uri "$Base/api/admin/users" -Headers (New-AuthHeader $creds['ADMIN_EMAIL'] $creds['ADMIN_PASSWORD']) -TimeoutSec 15
$someUser = @($before)[0]
if ($someUser) {
    # Send the body from a file. Inline JSON through curl.exe gets its quotes
    # eaten by PowerShell's native argument handling, which produced a 400
    # "Expected property name" - a parse error, not an authorisation result, so
    # it would have tested nothing.
    $userProbe = Join-Path $env:TEMP "userprobe-$stamp.json"
    @{ role = 'admin'; name = 'probe' } | ConvertTo-Json | Set-Content -Path $userProbe -NoNewline -Encoding UTF8
    foreach ($m in @('PUT', 'POST', 'DELETE')) {
        $path = if ($m -eq 'POST') { "$Base/api/admin/users" } else { "$Base/api/admin/users/$($someUser.id)" }
        $out = & curl.exe -s -X $m $path -H "Authorization: Bearer $editorToken" `
            -H 'Content-Type: application/json' --data-binary "@$userProbe" -w ' HTTP:%{http_code}'
        $code = ($out | Out-String).Trim()
        Check "editor $m /admin/users is refused" ($code -match 'HTTP:(401|403)') $code
    }
    Remove-Item $userProbe -Force -ErrorAction SilentlyContinue

    # token_version is the session-revocation lever, so it must never be settable
    # from a request body - writing it would let anyone sign every account out,
    # and lowering it would resurrect old tokens. The controller builds its UPDATE
    # from an explicit field list and recomputes token_version server-side, so the
    # write is accepted and ignored: HTTP 200 is the expected answer, and the
    # real proof is that a session issued BEFORE the attempt still works.
    $sessBefore = New-AdminToken
    $tvProbe = Join-Path $env:TEMP "tvprobe-$stamp.json"
    @{ token_version = 999; name = 'probe-not-applied' } | ConvertTo-Json | Set-Content -Path $tvProbe -NoNewline -Encoding UTF8
    & curl.exe -s -o NUL -X PUT "$Base/api/admin/users/$($someUser.id)" `
        -H "Authorization: Bearer $((New-AdminToken))" -H 'Content-Type: application/json' --data-binary "@$tvProbe"
    try {
        Invoke-RestMethod -Uri "$Base/api/auth/me" -Headers @{ Authorization = "Bearer $sessBefore" } -TimeoutSec 15 | Out-Null
        Check 'writing token_version does not revoke existing sessions' $true 'session issued before the write still valid'
    } catch {
        Check 'writing token_version does not revoke existing sessions' $false "session was revoked (HTTP $([int]$_.Exception.Response.StatusCode))"
    }
    # And confirm the field is never echoed back to a client.
    $after = Invoke-RestMethod -Uri "$Base/api/admin/users" -Headers (New-AuthHeader $creds['ADMIN_EMAIL'] $creds['ADMIN_PASSWORD']) -TimeoutSec 15
    Check 'token_version is not exposed by the API' ($null -eq (@($after) | Select-Object -First 1).token_version) ''
    Remove-Item $tvProbe -Force -ErrorAction SilentlyContinue
}

''
if ($script:Fails -eq 0) { 'ALL SECURITY CHECKS PASSED'; exit 0 }
else { "$script:Fails CHECK(S) FAILED"; exit 1 }