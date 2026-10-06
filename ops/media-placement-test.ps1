<#
  Proves the "you decide where the images go" workflow over real HTTP.

  Creates a post whose body holds TWO images at deliberately different points in
  the text, plus a cover, then checks the public API returns exactly that and
  that removing one reference leaves the other alone. The admin UI does the
  inserting at the cursor; this asserts the storage and rendering contract the
  UI depends on, so a regression in either shows up here.

  Also checks the event gallery still round-trips as an ARRAY (it used to be a
  hand-typed textarea, and a newline string instead of an array would break the
  public gallery's .map()).

    powershell -ExecutionPolicy Bypass -File media-placement-test.ps1
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
$login = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email = $creds['ADMIN_EMAIL']; password = $creds['ADMIN_PASSWORD'] } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$mediaIds = @()
$postId = $null
$eventId = $null

# A 1x1 and a 1x1 in different formats, so the two references are distinguishable.
$png1 = Join-Path $env:TEMP 'mp1.png'
$png2 = Join-Path $env:TEMP 'mp2.png'
[System.IO.File]::WriteAllBytes($png1, [Convert]::FromBase64String(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))
[System.IO.File]::WriteAllBytes($png2, [Convert]::FromBase64String(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAABqcLDeAAAAGElEQVR4nGP4z8DAwMDAxMDAwAAABQABmZ2xkAAAAAElFTkSuQmCC'))

function Upload-Png {
    param([string]$Path, [string]$Name)
    $tmp = Join-Path $env:TEMP $Name
    Copy-Item $Path $tmp -Force
    $out = & curl.exe -s -X POST -H "Authorization: Bearer $($login.token)" -F "file=@$tmp;type=image/png;filename=$Name" "$Base/api/admin/media"
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    $out | ConvertFrom-Json
}

try {
    Head '1. upload two distinct images'
    $m1 = Upload-Png $png1 'placement-first.png'
    $m2 = Upload-Png $png2 'placement-second.png'
    Check 'first image uploaded'  ([bool]$m1.id) "id=$($m1.id) $($m1.filename)"
    Check 'second image uploaded' ([bool]$m2.id) "id=$($m2.id) $($m2.filename)"
    Check 'the two uploads got different filenames' ($m1.filename -ne $m2.filename) "$($m1.filename) / $($m2.filename)"
    $mediaIds = @($m1.id, $m2.id)

    Head '2. a post with images placed at two different points'
    # Exactly what the editor produces: the caret sits after the first paragraph
    # for image one, and before the last paragraph for image two.
    $body = @"
Opening paragraph.

![placement first]($($m1.filename))

Middle paragraph.

Closing paragraph, with the second image above it.

![placement second]($($m2.filename))
"@
    $post = Invoke-RestMethod -Uri "$Base/api/admin/posts" -Method Post -Headers $h -ContentType 'application/json' `
        -Body (@{ title = "placement $stamp"; category = 'news'; body = $body; cover = $m1.filename } | ConvertTo-Json)
    $postId = $post.id
    Check 'post created with a cover and a body' ([bool]$postId) "id=$postId"

    $pub = Invoke-RestMethod -Uri "$Base/api/admin/posts/$postId/publish" -Method Post -Headers $h `
        -ContentType 'application/json' -Body (@{ status = 'published' } | ConvertTo-Json)

    Head '3. the stored body keeps bare filenames, in the right order'
    Check 'both image references survived the round trip' `
        ($pub.body -match [regex]::Escape($m1.filename) -and $pub.body -match [regex]::Escape($m2.filename)) `
        ($pub.body -split "`n" | Where-Object { $_ -match '!\[' } | ForEach-Object { $_.Trim() }) -join ' | '
    $firstAt  = $pub.body.IndexOf($m1.filename)
    $secondAt = $pub.body.IndexOf($m2.filename)
    Check 'the first image really is before the second' ($firstAt -ge 0 -and $secondAt -gt $firstAt) "offsets $firstAt / $secondAt"
    Check 'the body was NOT rewritten to absolute URLs' ($pub.body -notmatch 'https?://') 'bare filenames only, so BASE_PATH can change'

    Head '4. the public site resolves both to real URLs'
    $pubRow = Invoke-RestMethod -Uri "$Base/api/posts/$($pub.slug)" -TimeoutSec 15
    Check 'public post is readable' ([bool]$pubRow.id) "slug=$($pub.slug)"
    # mdToHtml rewrites ![alt](filename) -> <BASE>/uploads/<filename> at render
    # time; assert the media file is actually fetchable at that resolved path.
    foreach ($m in @($m1, $m2)) {
        $code = & curl.exe -s -o NUL -w '%{http_code}' "$Base/uploads/$($m.filename)"
        Check "media served at /uploads/$($m.filename)" ($code -eq '200') "HTTP $code"
    }

    Head '5. removing one reference leaves the other intact'
    $trimmed = ($pub.body -split "`n" | Where-Object { $_ -notmatch [regex]::Escape($m1.filename) }) -join "`n"
    $updated = Invoke-RestMethod -Uri "$Base/api/admin/posts/$postId" -Method Put -Headers $h -ContentType 'application/json' `
        -Body (@{ body = $trimmed } | ConvertTo-Json)
    Check 'the removed image is gone from the text' ($updated.body -notmatch [regex]::Escape($m1.filename))
    Check 'the other image is still there' ($updated.body -match [regex]::Escape($m2.filename))
    Check 'the cover was NOT removed (only the inline reference)' ($updated.cover -eq $m1.filename) "cover=$($updated.cover)"

    Head '6. event gallery round-trips as an array (it was a hand-typed textarea)'
    $gallery = @($m1.filename, $m2.filename)
    $ev = Invoke-RestMethod -Uri "$Base/api/admin/events" -Method Post -Headers $h -ContentType 'application/json' `
        -Body (@{ title = "gallery $stamp"; gallery = $gallery } | ConvertTo-Json)
    $eventId = $ev.id
    $isArray = $ev.gallery -is [array]
    Check 'gallery comes back as an array' $isArray "type=$($ev.gallery.GetType().Name) count=$(@($ev.gallery).Count)"
    Check 'gallery kept both filenames, in order' `
        ((@($ev.gallery) -join ',') -eq ($gallery -join ',')) (@($ev.gallery) -join ', ')
    # This is what would break: a newline string instead of an array makes
    # .map() throw on the public event page.
    if (-not $isArray) {
        Check 'public gallery would render (array .map works)' $false 'gallery is not an array - the public page calls .map() on it'
    } else {
        Invoke-RestMethod -Uri "$Base/api/admin/events/$eventId/publish" -Method Post -Headers $h `
            -ContentType 'application/json' -Body (@{ status = 'published' } | ConvertTo-Json) | Out-Null
        $evPub = Invoke-RestMethod -Uri "$Base/api/events/$($ev.slug)" -TimeoutSec 15
        Check 'public event gallery renders' (@($evPub.gallery).Count -eq 2) "$(@($evPub.gallery).Count) items"
    }

    Head '7. upload limits are now configurable, not hard-coded at 15 MB'
    $usage = Invoke-RestMethod -Uri "$Base/api/admin/media/usage" -Headers $h -TimeoutSec 15
    Check 'media quota reported' ($usage.max_bytes -gt 0) "cap=$($usage.max_label) used=$($usage.used_label)"
    $js = (Invoke-WebRequest -UseBasicParsing -Uri "$Base/admin/js/admin.js" -TimeoutSec 20).Content
    Check 'the hard-coded 15 MB hint is gone' ($js -notmatch 'up to 15&nbsp;MB') ''
    $mc = Invoke-WebRequest -UseBasicParsing -Uri "$Base/admin/js/modules.js" -TimeoutSec 20 -ErrorAction SilentlyContinue
    Check 'events gallery uses the picker, not a textarea' `
        (((Invoke-WebRequest -UseBasicParsing -Uri "$Base/admin/js/modules.js" -TimeoutSec 20).Content) -match "type: 'media-multi'") ''
}
catch {
    Check 'unexpected error' $false $_.Exception.Message
}
finally {
    # Clean up everything this test created.
    if ($eventId) { try { Invoke-RestMethod -Uri "$Base/api/admin/events/$eventId" -Method Delete -Headers $h | Out-Null } catch {} }
    if ($postId)  { try { Invoke-RestMethod -Uri "$Base/api/admin/posts/$postId" -Method Delete -Headers $h | Out-Null } catch {} }
    foreach ($id in $mediaIds) {
        if ($id) { try { Invoke-RestMethod -Uri "$Base/api/admin/media/$id" -Method Delete -Headers $h | Out-Null } catch {} }
    }
    Remove-Item $png1, $png2 -Force -ErrorAction SilentlyContinue
}

''
if ($script:Fails -eq 0) { 'ALL MEDIA PLACEMENT CHECKS PASSED'; exit 0 }
else { "$script:Fails CHECK(S) FAILED"; exit 1 }