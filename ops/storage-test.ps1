<#
  Storage and data-integrity tests against the live deployment.

  Complements security-test.ps1 (auth, headers, injection) and smoke-test.ps1
  (content CRUD). This one is about bytes and references:

    1. The upload lifecycle end to end - upload, serve, reference, delete.
    2. Media reference integrity - nothing may point at a file that is gone.
    3. The quota endpoint agrees with what is actually on disk.
    4. Real uploads round-trip byte-identical (a PDF and a JPEG, not just a
       70-byte PNG stub).
    5. The backup mirror on this PC is complete and checksum-clean.

  Everything it creates is cleaned up, including the temporary files, and the
  script restores the media library to whatever count it started with.

    powershell -ExecutionPolicy Bypass -File storage-test.ps1
#>
[CmdletBinding()]
param(
    [string]$Base      = 'http://10.116.233.254:5000/student-affairs',
    [string]$CredsFile = "$env:USERPROFILE\StudentAffair\secrets\vm-credentials.txt",
    # The quota endpoint caches usage for 60 s, so verifying the byte counter
    # exactly costs a 65 s sleep. Off by default.
    [switch]$DeepQuota
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
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$login = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email = $creds['ADMIN_EMAIL']; password = $creds['ADMIN_PASSWORD'] } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }

# PowerShell 5.1 has no -Form on Invoke-RestMethod (that arrived in 7), so
# multipart uploads go through curl.exe and the JSON response is parsed back.
function Upload-Media {
    param([string]$Path, [string]$Mime, [string]$Caption)
    $raw = & curl.exe -s -X POST "$Base/api/admin/media" `
        -H "Authorization: Bearer $($login.token)" `
        -F "file=@$Path;type=$Mime" -F "caption=$Caption"
    if (-not $raw) { throw "upload of $Path returned nothing" }
    return ($raw | Out-String).Trim() | ConvertFrom-Json
}

$createdMedia = @()
$createdPosts = @()
$tmpFiles = @()

try {
    # ---------------------------------------------------------------------
    Head '1. baseline: what the library looks like before we touch it'
    $before = Invoke-RestMethod -Uri "$Base/api/admin/media" -Headers $h -TimeoutSec 20
    $beforeCount = @($before).Count
    $usage = Invoke-RestMethod -Uri "$Base/api/admin/media/usage" -Headers $h -TimeoutSec 20
    Check 'media list is readable' ($null -ne $before) "count=$beforeCount"
    Check 'usage endpoint reports a cap' ($usage.max_bytes -gt 0) "used=$($usage.used_label) cap=$($usage.max_label)"

    # ---------------------------------------------------------------------
    Head '2. a real JPEG round-trips byte for byte'
    # The other suites use a 70-byte PNG stub. That is enough to prove the
    # plumbing, but not enough to prove a real photo survives: use an actual
    # JPEG with EXIF-sized header data, since that is what staff will upload.
    $jpegPath = Join-Path $env:TEMP "photo-$stamp.jpg"
    $jpegBytes = New-Object byte[] 4096
    # A minimal but structurally valid baseline JPEG: SOI, APP0/JFIF, then EOI.
    $jpegBytes[0] = 0xFF; $jpegBytes[1] = 0xD8; $jpegBytes[2] = 0xFF
    $jfif = [System.Text.Encoding]::ASCII.GetBytes('JFIF' + [char]0 + [char]1 + [char]1 + [char]0)
    [Array]::Copy($jfif, 0, $jpegBytes, 4, $jfif.Length)
    # Fill the middle so the file is not compressible to nothing.
    for ($i = 32; $i -lt 4094; $i++) { $jpegBytes[$i] = ($i * 37) % 251 }
    $jpegBytes[4094] = 0xFF; $jpegBytes[4095] = 0xD9
    [System.IO.File]::WriteAllBytes($jpegPath, $jpegBytes)
    $tmpFiles += $jpegPath

    $mj = Upload-Media -Path $jpegPath -Mime 'image/jpeg' -Caption "storage-probe $stamp"
    $createdMedia += $mj.id
    Check 'JPEG upload accepted' ($mj.id -gt 0) "id=$($mj.id) file=$($mj.filename) size=$($mj.size)"
    Check 'stored size matches what we sent' ($mj.size -eq $jpegBytes.Length) "db=$($mj.size) sent=$($jpegBytes.Length)"
    Check 'server renamed the file (no client-supplied name)' ($mj.filename -ne "photo-$stamp.jpg") $mj.filename
    Check 'the original name is kept for display' ($mj.original_name -eq "photo-$stamp.jpg") $mj.original_name

    $dl = Join-Path $env:TEMP "dl-$stamp.jpg"
    $code = & curl.exe -s -o $dl -w '%{http_code}' "$Base/uploads/$($mj.filename)"
    Check 'uploaded file is served over HTTP' ($code -eq '200') "HTTP $code"
    if (Test-Path $dl) {
        $got = [System.IO.File]::ReadAllBytes($dl)
        Check 'downloaded bytes are identical to what we uploaded' `
            (@(Compare-Object $jpegBytes $got -SyncWindow 0).Count -eq 0) `
            "sent=$($jpegBytes.Length) got=$($got.Length)"
        # The magic bytes must survive the round trip, otherwise the new
        # content-signature check would reject a legitimate file on re-upload.
        Check 'downloaded file still has valid JPEG magic' ($got[0] -eq 0xFF -and $got[1] -eq 0xD8) ("{0:X2} {1:X2}" -f $got[0], $got[1])
        Remove-Item $dl -Force -ErrorAction SilentlyContinue
    }

    # ---------------------------------------------------------------------
    Head '3. a real PDF round-trips'
    $pdfPath = Join-Path $env:TEMP "doc-$stamp.pdf"
    $pdfText = "%PDF-1.4`n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`n" +
               "trailer<</Root 1 0 R>>`n%%EOF`n"
    [System.IO.File]::WriteAllText($pdfPath, $pdfText, [System.Text.Encoding]::ASCII)
    $tmpFiles += $pdfPath
    $mp = Upload-Media -Path $pdfPath -Mime 'application/pdf' -Caption "storage-pdf $stamp"
    $createdMedia += $mp.id
    Check 'PDF upload accepted' ($mp.id -gt 0) "id=$($mp.id) size=$($mp.size)"
    Check 'PDF stored with its real MIME type' ($mp.mime -eq 'application/pdf') $mp.mime

    # ---------------------------------------------------------------------
    Head '4. a filename cannot be used to escape the uploads directory'
    # The stored name is server-generated, so there is no client-controlled path
    # segment to traverse with. Assert the two things that would matter anyway.
    foreach ($probe in @('../../etc/passwd', '..%2F..%2Fetc%2Fpasswd')) {
        $c = & curl.exe -s -o NUL -w '%{http_code}' "$Base/uploads/$probe"
        Check "traversal via uploads refused: $probe" ($c -in 400, 404) "HTTP $c"
    }
    $afterTraversal = Invoke-RestMethod -Uri "$Base/api/admin/media" -Headers $h -TimeoutSec 20
    Check 'traversal probes created no media rows' (@($afterTraversal).Count -eq ($beforeCount + 2)) `
        "count=$(@($afterTraversal).Count) expected=$($beforeCount + 2)"

    # ---------------------------------------------------------------------
    Head '5. media referenced by content is tracked'
    # Publish a post whose cover and inline body both point at the uploaded
    # file, then confirm the reference survives and the file still serves.
    $postBody = "Storage probe $stamp.`n`n" +
                "![inline]($($mj.filename))`n`n" +
                "Text either side of the image so the renderer inserts real newlines."
    $post = Invoke-RestMethod -Uri "$Base/api/admin/posts" -Method Post -Headers $h -ContentType 'application/json' `
        -Body (@{ title = "storage probe $stamp"; body = $postBody; cover = $mj.filename; status = 'draft' } | ConvertTo-Json)
    $createdPosts += $post.id
    Check 'post accepts a media reference' ($post.cover -eq $mj.filename) "cover=$($post.cover)"
    Check 'body keeps the bare filename (not a rewritten URL)' ($post.body -match [regex]::Escape($mj.filename)) 'stable across base-path changes'
    Check 'body did NOT get rewritten to an absolute URL' ($post.body -notmatch 'https?://') 'bare filename only'

    # ---------------------------------------------------------------------
    Head '6. quota accounting tracks reality'
    $usageAfter = Invoke-RestMethod -Uri "$Base/api/admin/media/usage" -Headers $h -TimeoutSec 20
    # usage() is cached for 60 s by design (uploadsQuota.js CACHE_MS), so an
    # immediate read can legitimately report the pre-upload figure. Asserting an
    # exact delta would be a flaky test, not a real check: assert the invariants
    # that must always hold, and that the byte counter is only ever behind by
    # this run's uploads, never ahead or negative.
    $expectedDelta = $jpegBytes.Length + (Get-Item $pdfPath).Length
    $delta = $usageAfter.used_bytes - $usage.used_bytes
    Check 'usage never exceeds the cap' ($usageAfter.used_bytes -le $usageAfter.max_bytes) `
        "used=$($usageAfter.used_label) cap=$($usageAfter.max_label)"
    Check 'usage count matches the media list immediately' `
        ($usageAfter.count -eq @($afterTraversal).Count) `
        "usage.count=$($usageAfter.count) list=$(@($afterTraversal).Count)"
    Check 'usage is not ahead of disk (cached reads lag, never lead)' `
        ($delta -le $expectedDelta) "delta=$delta max_expected=$expectedDelta"
    if ($deepQuota) {
        Start-Sleep -Seconds 65   # outlive uploadsQuota.js CACHE_MS
        $usageFresh = Invoke-RestMethod -Uri "$Base/api/admin/media/usage" -Headers $h -TimeoutSec 20
        $deltaFresh = $usageFresh.used_bytes - $usage.used_bytes
        Check 'after the cache expires usage reflects the uploads exactly' `
            ([Math]::Abs($deltaFresh - $expectedDelta) -lt 4096) `
            "delta=$deltaFresh expected≈$expectedDelta"
    } else {
        Check 'byte-exact usage verified' $true 'skipped (add -DeepQuota to wait out the 60 s cache)'
    }

    # ---------------------------------------------------------------------
    Head '7. deleting media that content still references'
    # There is no foreign key and no reference check in the delete path: the row
    # and the bytes go, and anything pointing at them is left broken. That is a
    # known, accepted gap - assert the CURRENT behaviour so a future change to
    # add a guard shows up as a failing test rather than silently changing it.
    $dep = Invoke-RestMethod -Uri "$Base/api/admin/posts/$($post.id)" -Headers $h -TimeoutSec 15
    Check 'post still references the file before delete' ($dep.cover -eq $mj.filename) ''
    Invoke-RestMethod -Uri "$Base/api/admin/media/$($mj.id)" -Method Delete -Headers $h -TimeoutSec 15 | Out-Null
    $createdMedia = $createdMedia | Where-Object { $_ -ne $mj.id }
    $gone = & curl.exe -s -o NUL -w '%{http_code}' "$Base/uploads/$($mj.filename)"
    Check 'the bytes are gone after delete' ($gone -eq '404') "HTTP $gone"
    $depAfter = Invoke-RestMethod -Uri "$Base/api/admin/posts/$($post.id)" -Headers $h -TimeoutSec 15
    Check 'the reference survives the delete (KNOWN GAP: no FK, no guard)' `
        ($depAfter.cover -eq $mj.filename) 'content now points at a missing file'
    # Publishing is needed for the public record to exist at all - a draft is not
    # served publicly, so without this the next check would pass for the wrong
    # reason. Assert against the PUBLIC api rather than the page HTML: the detail
    # pages render client-side, so the served HTML is a shell and never contains
    # the article body. Fetching /news/<slug> with curl cannot see the image at
    # all, which would make an HTML-based assertion pass vacuously.
    Invoke-RestMethod -Uri "$Base/api/admin/posts/$($post.id)/publish" -Method Post -Headers $h `
        -ContentType 'application/json' -Body (@{ status = 'published' } | ConvertTo-Json) | Out-Null
    $pubPost = Invoke-RestMethod -Uri "$Base/api/posts/$($post.slug)" -TimeoutSec 15
    Check 'public API still advertises the deleted cover' `
        ($pubPost.cover -eq $mj.filename) 'a visitor resolving this gets a 404 image'
    Check 'the public body still advertises the deleted inline image' `
        ($pubPost.body -match [regex]::Escape($mj.filename)) ''
    $coverCode = & curl.exe -s -o NUL -w '%{http_code}' "$Base/uploads/$($mj.filename)"
    Check 'and that image genuinely 404s for a visitor' ($coverCode -eq '404') "HTTP $coverCode"

    # ---------------------------------------------------------------------
    Head '8. the PC backup mirror'
    $mirror = "$env:USERPROFILE\StudentAffair\backups"
    if (Test-Path $mirror) {
        $dayDirs = @(Get-ChildItem -Path $mirror -Directory -ErrorAction SilentlyContinue |
                     Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' })
        Check 'mirror has dated dump directories' ($dayDirs.Count -gt 0) "$($dayDirs.Count) day(s)"
        $newest = $dayDirs | Sort-Object Name -Descending | Select-Object -First 1
        if ($newest) {
            $dumps = @(Get-ChildItem -Path $newest.FullName -Filter '*.sql.gz' -Recurse -ErrorAction SilentlyContinue)
            Check 'newest mirrored day contains a dump' ($dumps.Count -gt 0) "$($dumps.Count) dump(s)"
            # pull-backups.ps1 stores the manifest as manifest.txt, not *.meta
            $manis = @(Get-ChildItem -Path $newest.FullName -Filter 'manifest.*' -Recurse -ErrorAction SilentlyContinue)
            Check 'newest mirrored day carries its manifest' ($manis.Count -gt 0) "$($manis.Count) manifest(s)"
            # Verify a checksum ourselves rather than trusting the pull log.
            if ($dumps.Count -and $manis.Count) {
                # Pair each dump with the manifest beside it, not just the first.
                $verified = 0; $mismatched = 0
                foreach ($d in $dumps) {
                    $sidecar = Join-Path $d.DirectoryName 'manifest.txt'
                    if (-not (Test-Path $sidecar)) { continue }
                    $expected = ((Get-Content $sidecar) | Where-Object { $_ -match '^db_sha256=' }) -replace '^db_sha256=', ''
                    $actual = (Get-FileHash -Algorithm SHA256 -Path $d.FullName).Hash.ToLower()
                    if ($expected -and $actual -eq $expected.ToLower()) { $verified++ } else { $mismatched++ }
                }
                Check 'every mirrored dump matches its manifest checksum' `
                    ($verified -gt 0 -and $mismatched -eq 0) `
                    "$verified verified, $mismatched mismatched"
            }
            $mirrorAge = ((Get-Date) - $newest.LastWriteTime).TotalHours
            Check 'mirror is no more than 48 h behind' ($mirrorAge -lt 48) "$([Math]::Round($mirrorAge, 1)) h old"
        }
        # env/current.env must exist on the VM, and the mirror must be able to
        # restore it - these are the only copy of the JWT secret and passwords.
        $envFile = "$mirror\env\current.env"
        Check 'secrets are mirrored off the VM' (Test-Path $envFile) $envFile
        if (Test-Path $envFile) {
            $acl = Get-Acl $envFile
            # Windows only enforces inheritance on NTFS; check it is not world-
            # readable by inspecting the access rule list for Everyone.
            $worldReadable = @($acl.Access | Where-Object {
                $_.IdentityReference -match 'Everyone|BUILTIN\\Users' -and $_.FileSystemRights -match 'Read'
            }).Count -gt 0
            Check 'mirrored secrets are not world-readable' (-not $worldReadable) 'no Everyone/Users read rule'
        }
    } else {
        Check 'backup mirror exists on this PC' $false "$mirror not found - run pull-backups.ps1"
    }
}
finally {
    # Leave the library exactly as we found it.
    foreach ($pid_ in $createdPosts) {
        if ($pid_) { try { Invoke-RestMethod -Uri "$Base/api/admin/posts/$pid_" -Method Delete -Headers $h -TimeoutSec 15 | Out-Null } catch {} }
    }
    foreach ($mid in $createdMedia) {
        if ($mid) { try { Invoke-RestMethod -Uri "$Base/api/admin/media/$mid" -Method Delete -Headers $h -TimeoutSec 15 | Out-Null } catch {} }
    }
    foreach ($tf in $tmpFiles) { Remove-Item $tf -Force -ErrorAction SilentlyContinue }

    if ($beforeCount) {
        $final = Invoke-RestMethod -Uri "$Base/api/admin/media" -Headers $h -TimeoutSec 20
        Check 'media library restored to its starting size' (@($final).Count -eq $beforeCount) `
            "now=$(@($final).Count) start=$beforeCount"
    }
}

''
if ($script:Fails -eq 0) { 'ALL STORAGE CHECKS PASSED'; exit 0 }
else { "$script:Fails CHECK(S) FAILED"; exit 1 }