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
