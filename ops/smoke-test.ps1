<#
  End-to-end smoke test against the live VM deployment.

  Exercises the real CMS workflow over HTTP: login -> create draft -> confirm
  the public API hides it -> publish -> confirm it is public -> unpublish ->
  confirm hidden again -> upload media -> confirm the file is served.
  Then deletes everything it created, so the site is left with only seeded data.

    powershell -ExecutionPolicy Bypass -File smoke-test.ps1
    powershell -ExecutionPolicy Bypass -File smoke-test.ps1 -KeepData

  -KeepData leaves the test post and media in place, which is what you want
  when the next step is to prove the backup captured them.
#>
[CmdletBinding()]
param(
    [string]$Base        = 'http://10.116.233.254:5000/student-affairs',
    [string]$CredsFile   = "$env:USERPROFILE\StudentAffair\secrets\vm-credentials.txt",
    [switch]$KeepData
)

$ErrorActionPreference = 'Stop'
$script:Failures = 0

function Check {
    param([string]$What, [bool]$Ok, [string]$Detail = '')
    $tag = if ($Ok) { 'PASS' } else { 'FAIL'; }
    if (-not $Ok) { $script:Failures++ }
    '{0}  {1}{2}' -f $tag, $What, $(if ($Detail) { "  ($Detail)" } else { '' })
}

# --- credentials -------------------------------------------------------------
$creds = @{}
Get-Content $CredsFile | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $creds[$Matches[1]] = $Matches[2] } }
if (-not $creds['ADMIN_EMAIL']) { throw "could not read ADMIN_EMAIL from $CredsFile" }

# --- login -------------------------------------------------------------------
$login = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post `
    -ContentType 'application/json' `
    -Body (@{ email = $creds['ADMIN_EMAIL']; password = $creds['ADMIN_PASSWORD'] } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.token)" }
Check 'admin login returns a token' ([bool]$login.token) "role=$($login.user.role)"

$stamp   = Get-Date -Format 'HHmmss'
$title   = "ZZ Deploy Smoke Test $stamp"
$created = $null
$mediaId = $null
$mediaFile = $null

try {
    # --- create as draft ------------------------------------------------------
    $created = Invoke-RestMethod -Uri "$Base/api/admin/posts" -Method Post -Headers $headers `
        -ContentType 'application/json' -Body (@{
            title    = $title
            category = 'announcement'
            excerpt  = 'Temporary record created by the deployment smoke test.'
            body     = 'Created and deleted automatically. Safe to ignore.'
        } | ConvertTo-Json)
    Check 'create post (draft)' ($created.status -eq 'draft') "id=$($created.id) slug=$($created.slug)"

    # --- public API must hide drafts -----------------------------------------
    $hidden = $false
    try { Invoke-RestMethod -Uri "$Base/api/posts/$($created.slug)" -TimeoutSec 15 | Out-Null }
    catch { $hidden = ($_.Exception.Response.StatusCode.value__ -eq 404) }
    Check 'draft is hidden from the public API' $hidden

    # --- publish --------------------------------------------------------------
    $pub = Invoke-RestMethod -Uri "$Base/api/admin/posts/$($created.id)/publish" -Method Post `
        -Headers $headers -ContentType 'application/json' `
        -Body (@{ status = 'published' } | ConvertTo-Json)
    Check 'publish post' ($pub.status -eq 'published') "status=$($pub.status)"

    $visible = $false
    try {
        $row = Invoke-RestMethod -Uri "$Base/api/posts/$($created.slug)" -TimeoutSec 15
        $visible = ($row.id -eq $created.id)
    } catch { $visible = $false }
    Check 'published post is public' $visible

    # --- unpublish ------------------------------------------------------------
    $unpub = Invoke-RestMethod -Uri "$Base/api/admin/posts/$($created.id)/publish" -Method Post `
        -Headers $headers -ContentType 'application/json' `
        -Body (@{ status = 'draft' } | ConvertTo-Json)
    Check 'unpublish post' ($unpub.status -eq 'draft') "status=$($unpub.status)"

    $hiddenAgain = $false
    try { Invoke-RestMethod -Uri "$Base/api/posts/$($created.slug)" -TimeoutSec 15 | Out-Null }
    catch { $hiddenAgain = ($_.Exception.Response.StatusCode.value__ -eq 404) }
    Check 'unpublished post disappears again' $hiddenAgain

    # --- media upload ---------------------------------------------------------
    # Smallest valid PNG there is; multer validates on mimetype + size only.
    $png = Join-Path $env:TEMP 'smoke-test.png'
    [System.IO.File]::WriteAllBytes($png, [Convert]::FromBase64String(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))

    $uploadOut = & curl.exe -s -X POST -H "Authorization: Bearer $($login.token)" `
        -F "file=@$png;type=image/png;filename=smoke-$stamp.png" "$Base/api/admin/media"
    $media = $uploadOut | ConvertFrom-Json
    Check 'upload media' ([bool]$media.id) "id=$($media.id) file=$($media.filename)"
    $mediaId   = $media.id
    $mediaFile = $media.filename

    $served = $false
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$Base/uploads/$mediaFile" -TimeoutSec 15
        $served = ($r.StatusCode -eq 200 -and $r.RawContentLength -gt 0)
    } catch { $served = $false }
    Check 'uploaded file is served over HTTP' $served "bytes=$($r.RawContentLength)"

    Remove-Item $png -Force -ErrorAction SilentlyContinue

    # --- favicon + not-found wiring -------------------------------------------
    # Browsers probe /favicon.ico unprompted; it used to 404 because only css/
    # and js/ were mounted static. The icons live beside the page templates, so
    # this also pins the decision NOT to mount public/ wholesale.
    $ico = $null
    try { $ico = Invoke-WebRequest -UseBasicParsing -Uri "$Base/favicon.ico" -TimeoutSec 15 } catch {}
    $icoOk = $ico -and $ico.StatusCode -eq 200 -and $ico.RawContentLength -gt 1000
    # ICO magic: 00 00 01 00
    $icoMagic = $false
    if ($icoOk) {
        $bytes = $ico.Content
        if ($bytes -is [byte[]]) { $icoMagic = ($bytes[0] -eq 0 -and $bytes[1] -eq 0 -and $bytes[2] -eq 1 -and $bytes[3] -eq 0) }
    }
    Check 'favicon.ico is served and is a real ICO' ($icoOk -and $icoMagic) `
        "status=$($ico.StatusCode) bytes=$($ico.RawContentLength) ctype=$($ico.Headers['Content-Type'])"

    foreach ($pair in @(@('/favicon.svg', 'svg'), @('/apple-touch-icon.png', 'apple-touch-icon.png'), @('/favicon-32x32.png', 'favicon-32x32.png'))) {
        $code = & curl.exe -s -o NUL -w '%{http_code}' --max-time 10 "$Base$($pair[0])"
        Check "$($pair[1]) is served" ($code -eq '200') "HTTP $code"
    }

    $home = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/" -TimeoutSec 15).Content
    Check 'pages declare the icon links' (($home -match 'rel="icon"') -and ($home -match 'apple-touch-icon')) ''

    # The templates must only be reachable through renderHtml, which substitutes
    # __BASE_PATH__ / __CSP_NONCE__. Serving them raw would leak token strings.
    $tmpl = & curl.exe -s -o NUL -w '%{http_code}' --max-time 10 "$Base/news-detail.html"
    Check 'raw page templates are NOT served as static files' ($tmpl -eq '404') "HTTP $tmpl (expect 404)"

    # Detail pages are a static shell, so a bad slug still returns 200 and the
    # not-found is decided client-side. Assert every detail renderer routes its
    # catch through the 404-aware helper instead of the generic error state.
    $siteJs  = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/js/site.js" -TimeoutSec 20).Content
    $pagesJs = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/js/pages.js" -TimeoutSec 20).Content
    Check 'site.js exposes the 404-aware detail error helper' `
        (($siteJs -match 'stateNotFound') -and ($siteJs -match 'stateDetailError')) ''

    foreach ($pair in @(@('article', 'newsDetail'), @('event', 'eventDetail'), @('society', 'societyDetail'), @('partner', 'partnerDetail'))) {
        # Isolate the function body, then confirm its catch is not stateError.
        $start = $pagesJs.IndexOf("function $($pair[1])(")
        if ($start -lt 0) { Check "$($pair[1]) exists" $false 'function not found'; continue }
        $nextFn = $pagesJs.IndexOf('  function ', $start + 10)
        if ($nextFn -lt 0) { $nextFn = $pagesJs.Length }
        $body = $pagesJs.Substring($start, $nextFn - $start)
        Check "$($pair[1]) renders a not-found state on 404" `
            (($body -match 'stateDetailError') -and ($body -notmatch 'SITE\.stateError')) ''
    }
}
finally {
    if ($KeepData) {
        "`n-KeepData set: leaving post id=$($created.id) and media id=$mediaId in place."
        ' Delete them later with cleanup-testdata.ps1'
    }
    else {
        # --- cleanup ------------------------------------------------------------
        if ($mediaId) {
            try { Invoke-RestMethod -Uri "$Base/api/admin/media/$mediaId" -Method Delete -Headers $headers | Out-Null
                  Check 'delete test media' $true } catch { Check 'delete test media' $false $_.Exception.Message }
        }
        if ($created) {
            try { Invoke-RestMethod -Uri "$Base/api/admin/posts/$($created.id)" -Method Delete -Headers $headers | Out-Null
                  Check 'delete test post' $true } catch { Check 'delete test post' $false $_.Exception.Message }
        }
        $left = $false
        try { $left = [bool](Invoke-RestMethod -Uri "$Base/api/posts/$($created.slug)" -TimeoutSec 15) } catch { $left = $false }
        Check 'test post gone from the public site' (-not $left)
    }
}

''
if ($script:Failures -eq 0) { 'SMOKE TEST PASSED'; exit 0 }
else { "SMOKE TEST FAILED ($script:Failures check(s) failed)"; exit 1 }
