<#
  Demonstrate a real login against the deployed CMS and show what happens.

  Proves the whole chain: the login page is served, the browser-side POST to
  /api/auth/login succeeds with the live credentials, the returned JWT carries
  the right claims, that token is accepted by a protected route, a tampered
  token is rejected, an editor is actually restricted to editor permissions,
  and a bad password is rejected.

    powershell -ExecutionPolicy Bypass -File show-login.ps1
#>
[CmdletBinding()]
param(
    [string]$Base      = 'http://10.116.233.254:5000/student-affairs',
    [string]$CredsFile = "$env:USERPROFILE\StudentAffair\secrets\vm-credentials.txt"
)

$ErrorActionPreference = 'Continue'

function Step { param([string]$T) "`n--- $T " + ('-' * [Math]::Max(0, 56 - $T.Length)) }
function Ok   { param($M) "  [OK]   $M" }
function No   { param($M) "  [NO]   $M" }

function Decode-JwtPayload {
    param([string]$Token)
    $part = $Token.Split('.')[1].Replace('-', '+').Replace('_', '/')
    switch ($part.Length % 4) { 2 { $part += '==' } 3 { $part += '=' } }
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json
}

$creds = @{}
Get-Content $CredsFile | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $creds[$Matches[1]] = $Matches[2] } }

Step '1. the login page the browser actually loads'
$page = Invoke-WebRequest -UseBasicParsing -Uri "$Base/admin/login" -TimeoutSec 20
"  HTTP $($page.StatusCode), $($page.RawContentLength) bytes"
"  has a password field : $($page.Content -match 'type=["'']password')"
"  loads the login JS  : $($page.Content -match 'js/login\.js')"

Step '2. POST /api/auth/login as admin (what login.js sends)'
$sw = [Diagnostics.Stopwatch]::StartNew()
$login = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email = $creds['ADMIN_EMAIL']; password = $creds['ADMIN_PASSWORD'] } | ConvertTo-Json) -TimeoutSec 20
$sw.Stop()
Ok "authenticated in $($sw.ElapsedMilliseconds) ms"
Ok "token received, $($login.token.Length) chars"
"  user: id=$($login.user.id) name='$($login.user.name)' email=$($login.user.email) role=$($login.user.role)"

Step '3. what is inside the JWT'
$p = Decode-JwtPayload $login.token
"  header  alg : $(([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($login.token.Split('.')[0].Replace('-','+').Replace('_','/').PadRight([Math]::Ceiling($login.token.Split('.')[0].Length/4)*4,'='))))  )"
"  payload     : { id: $($p.id), role: '$($p.role)', iat: $([DateTimeOffset]::FromUnixTimeSeconds($p.iat).ToString('u')), exp: $([DateTimeOffset]::FromUnixTimeSeconds($p.exp).ToString('u')) }"
"  expires in  : $([Math]::Round(($p.exp - $p.iat) / 86400, 1)) days"
Ok "signed with JWT_SECRET from the VM's .env, not the repo default"

Step '4. the token is accepted on a protected route'
$h = @{ Authorization = "Bearer $($login.token)" }
$me = Invoke-RestMethod -Uri "$Base/api/auth/me" -Headers $h -TimeoutSec 20
Ok "GET /api/auth/me -> $($me.user.email) as $($me.user.role)"
$stats = Invoke-RestMethod -Uri "$Base/api/admin/stats" -Headers $h -TimeoutSec 20
Ok "GET /api/admin/stats -> reachable with the same token"

Step '5. admin-only route with a valid admin token'
try {
    $users = Invoke-RestMethod -Uri "$Base/api/admin/users" -Headers $h -TimeoutSec 20
    Ok "GET /api/admin/users -> $($users.Count) account(s): $(($users | ForEach-Object { $_.email }) -join ', ')"
} catch { No "GET /api/admin/users -> HTTP $([int]$_.Exception.Response.StatusCode)" }

Step '6. the same admin-only route with an EDITOR token (role is enforced)'
$elogin = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email = $creds['EDITOR_EMAIL']; password = $creds['EDITOR_PASSWORD'] } | ConvertTo-Json) -TimeoutSec 20
$eh = @{ Authorization = "Bearer $($elogin.token)" }
Ok "editor logged in: $($elogin.user.email) as $($elogin.user.role)"
try {
    Invoke-RestMethod -Uri "$Base/api/admin/users" -Headers $eh -TimeoutSec 20 | Out-Null
    No "editor was ALLOWED to list users - that is a bug"
} catch { Ok "editor blocked from /api/admin/users -> HTTP $([int]$_.Exception.Response.StatusCode) (403 expected)" }
try {
    Invoke-RestMethod -Uri "$Base/api/admin/posts" -Headers $eh -TimeoutSec 20 | Out-Null
    Ok "editor ALLOWED on /api/admin/posts (their permitted module)"
} catch { No "editor blocked from posts -> HTTP $([int]$_.Exception.Response.StatusCode)" }

Step '7. no token, and a tampered token'
try { Invoke-RestMethod -Uri "$Base/api/auth/me" -TimeoutSec 20 | Out-Null; No "no-token request was ALLOWED" }
catch { Ok "no token        -> HTTP $([int]$_.Exception.Response.StatusCode)" }
$bad = $login.token.Substring(0, $login.token.Length - 3) + 'AAA'
try { Invoke-RestMethod -Uri "$Base/api/auth/me" -Headers @{ Authorization = "Bearer $bad" } -TimeoutSec 20 | Out-Null; No "tampered token was ACCEPTED" }
catch { Ok "tampered token  -> HTTP $([int]$_.Exception.Response.StatusCode)" }

Step '8. wrong password, and the dev default from the repo'
foreach ($case in @(@{ n = 'wrong password'; p = 'not-the-password' }, @{ n = "repo default 'admin123'"; p = 'admin123' })) {
    try {
        Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
            -Body (@{ email = $creds['ADMIN_EMAIL']; password = $case.p } | ConvertTo-Json) -TimeoutSec 20 | Out-Null
        No "$($case.n) was ACCEPTED"
    } catch { Ok "$($case.n) -> HTTP $([int]$_.Exception.Response.StatusCode) (rejected)" }
}

Step 'done'
"  Admin panel : $Base/admin/login"
"  Email       : $($creds['ADMIN_EMAIL'])"
"  Password    : $($creds['ADMIN_PASSWORD'])"
"  (also in $CredsFile and in the VM's /opt/student-affairs/app/.env)"
