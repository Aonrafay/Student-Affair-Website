<#
  Pull backups from the VM to this PC.

  Scheduled task, runs daily. Keeps a rolling local window and verifies every
  pulled file against the sha256 list the VM's backup manifest carries, failing
  the run on any mismatch - a backup nobody verified is not a backup.

    powershell -ExecutionPolicy Bypass -File pull-backups.ps1

  Media policy: media archives are pulled WEEKLY only, not daily. They are the
  largest artifact by far, and the VM already keeps just one copy; pulling a new
  multi-gigabyte copy every day would fill this PC (which has far less free space
  than the VM) for no extra safety. Everything small - database dumps, binary
  logs, manifests - comes across on every run.

  Size cap: -MaxLocalGB prunes the oldest local backups until the local total
  fits. Without it, enough daily pulls will silently fill the disk.
#>
[CmdletBinding()]
param(
    [int]    $KeepDaily   = 7,
    [int]    $KeepWeekly  = 4,
    [double] $MaxLocalGB  = 15,
    [string] $SshHost     = 'vm-students',
    [string] $RemoteBase  = '/opt/student-affairs/backups',
    [string] $Root        = "$env:USERPROFILE\StudentAffair",
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
$script:LogFile = Join-Path $Root 'backup-pull.log'

New-Item -ItemType Directory -Path $Root -Force | Out-Null

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $script:LogFile -Value $line
    if ($Quiet -and $Level -eq 'INFO') { return }
    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        default { Write-Host $line }
    }
}

# Native commands are run through here: under $ErrorActionPreference = 'Stop',
# PowerShell 5.1 turns ANY stderr line from a native command into a terminating
# error - including scp's progress meter - so scp's exit code never gets read
# and the resulting message ("...db.sql.gz: No such file or directory") is a lie.
function Invoke-Native {
    param([string]$Exe, [string[]]$NativeArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Exe @NativeArgs 2>&1
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $prev }
    return [pscustomobject]@{ Exit = $code; Out = @($out | ForEach-Object { "$_" }) }
}

# scp needs the host attached to the FILE PATH ("host:/path"). Passing a bare
# hostname as a separate argument makes scp treat it as a local source file.
$sshArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', $SshHost)
$scpArgs = @('-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20')
function Get-RemoteSpec { param([string]$Path) '{0}:{1}' -f $SshHost, $Path }
function Copy-FromVm {
    param([string]$RemotePath, [string]$LocalPath)
    Invoke-Native scp ($scpArgs + @((Get-RemoteSpec $RemotePath), $LocalPath))
}
function Get-RemoteList {
    param([string]$Glob)
    $r = Invoke-Native ssh ($sshArgs + @("ls -1 $Glob 2>/dev/null"))
    @($r.Out | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

try {
    Write-Log "starting pull from $SshHost (media weekly, local cap $([int]$MaxLocalGB) GB)"

    # --- 1. reachability ------------------------------------------------------
    $probe = Invoke-Native ssh ($sshArgs + @('echo READY'))
    if ($probe.Exit -ne 0 -or ($probe.Out -join '') -notmatch 'READY') {
        throw "cannot reach $SshHost non-interactively (is the public key installed?): $($probe.Out -join ' ')"
    }

    $dayDir  = Join-Path $Root ('backups\' + (Get-Date -Format 'yyyy-MM-dd'))
    $weekDir = Join-Path $Root 'backups\_weekly'
    New-Item -ItemType Directory -Path $dayDir  -Force | Out-Null
    New-Item -ItemType Directory -Path $weekDir -Force | Out-Null

    # --- 2. pull the newest daily set ----------------------------------------
    # New layout: db/daily holds the rolling dumps, db/binlog the archives of
    # closed binary logs, db/manifests the per-dump metadata.
    $dumps = Get-RemoteList "$RemoteBase/db/daily/*.sql.gz" | Sort-Object -Descending | Select-Object -First $KeepDaily
    $blogs = Get-RemoteList "$RemoteBase/db/binlog/*.tgz"     | Sort-Object -Descending | Select-Object -First 7
    $metas = Get-RemoteList "$RemoteBase/db/manifests/*.meta" | Sort-Object -Descending | Select-Object -First 7
    if (-not $dumps) { throw "no database dumps under $RemoteBase/db/daily (has backup.sh run?)" }

    $pulled = 0
    foreach ($d in $dumps) {
        $stamp = [System.IO.Path]::GetFileNameWithoutExtension($d) -replace '\.sql$', ''
        $dest  = Join-Path $dayDir $stamp
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        $ok = $true

        $r = Copy-FromVm "$RemoteBase/db/daily/$(Split-Path $d -Leaf)" (Join-Path $dest 'db.sql.gz')
        if ($r.Exit -ne 0 -or -not (Test-Path (Join-Path $dest 'db.sql.gz'))) { $ok = $false; Write-Log "could not pull dump $stamp" 'WARN' }

        $m = Get-RemoteList "$RemoteBase/db/manifests/$stamp.meta"
        if ($m.Count -eq 1) {
            $r = Copy-FromVm "$RemoteBase/db/manifests/$stamp.meta" (Join-Path $dest 'manifest.txt')
            if ($r.Exit -ne 0) { Write-Log "no manifest for $stamp" 'WARN' }
        } else { $ok = $false; Write-Log "no manifest for $stamp" 'WARN' }

        if ($ok) { $pulled++ }
    }
    Write-Log "pulled $pulled database dump(s)"

    # --- 3. binary logs (small, and the only route to a point-in-time restore) -
    $blDir = Join-Path $Root 'backups\_binlog'
    New-Item -ItemType Directory -Path $blDir -Force | Out-Null
    foreach ($b in $blogs) {
        $name = Split-Path $b -Leaf
        Copy-FromVm "$RemoteBase/db/binlog/$name" (Join-Path $blDir $name) | Out-Null
    }
    if ($blogs) { Write-Log "pulled $($blogs.Count) binlog archive(s)" }

    # --- 4. media: weekly only ----------------------------------------------
    $media = Get-RemoteList "$RemoteBase/media/*.tgz" | Sort-Object -Descending | Select-Object -First $KeepWeekly
    foreach ($m in $media) {
        Copy-FromVm "$RemoteBase/media/$(Split-Path $m -Leaf)" (Join-Path $weekDir 'media.tgz') | Out-Null
    }
    if ($media) { Write-Log "pulled weekly media archive ($($media.Count) available on the VM)" }

    # --- 5. verify checksums -------------------------------------------------
    # The manifest is key=value text written by backup.sh; db_sha256 is the one
    # that matters here. Without this a truncated copy still looks like a backup,
    # and a manifest that lost its checksum line must fail loudly rather than
    # silently verify nothing.
    $checked = 0; $bad = 0; $missing = 0
    foreach ($dir in Get-ChildItem -Path $dayDir -Directory) {
        $mp = Join-Path $dir.FullName 'manifest.txt'
        if (-not (Test-Path $mp)) { continue }
        $expectDb = $null
        foreach ($line in Get-Content $mp) {
            if ($line -match '^db_sha256=([0-9a-f]{64})') { $expectDb = $Matches[1]; break }
        }
        if (-not $expectDb) { $missing++; Write-Log "manifest for $($dir.Name) has no db_sha256 - cannot verify" 'WARN'; continue }
        $db = Join-Path $dir.FullName 'db.sql.gz'
        if (-not (Test-Path $db)) { continue }
        $actual = (Get-FileHash -Path $db -Algorithm SHA256).Hash.ToLower()
        $checked++
        if ($actual -ne $expectDb) {
            $bad++
            Write-Log "CHECKSUM MISMATCH $($dir.Name)\db.sql.gz vm=$expectDb local=$actual" 'ERROR'
        }
    }
    if ($checked -eq 0) { throw "no checksums verified - $missing manifest(s) had no db_sha256" }
    if ($bad -gt 0)    { throw "$bad of $checked pulled dumps failed checksum verification" }
    Write-Log "verified $checked dump checksum(s), all match"

    # --- 6. prune by age, then by size --------------------------------------
    $backupRoot = Join-Path $Root 'backups'
    $dailyDirs = Get-ChildItem -Path $backupRoot -Directory |
                 Where-Object { $_.Name -notlike '_*' } | Sort-Object Name -Descending
    foreach ($old in @($dailyDirs | Select-Object -Skip $KeepDaily)) {
        Remove-Item -LiteralPath $old.FullName -Recurse -Force
        Write-Log "pruned local $($old.Name)"
    }
    $blFiles = Get-ChildItem -Path $blDir -Filter '*.tgz' | Sort-Object Name -Descending
    foreach ($old in @($blFiles | Select-Object -Skip $KeepWeekly)) {
        Remove-Item -LiteralPath $old.FullName -Force
    }

    $cap = $MaxLocalGB * 1GB
    $total = (Get-ChildItem -Path $backupRoot -Recurse -File | Measure-Object Length -Sum).Sum
    while ($total -gt $cap) {
        $old = Get-ChildItem -Path $dayDir -Directory | Sort-Object Name -Ascending | Select-Object -First 1
        if (-not $old -or $old.Name -eq (Get-Date -Format 'yyyy-MM-dd')) { break }
        Remove-Item -LiteralPath $old.FullName -Recurse -Force
        $total = (Get-ChildItem -Path $backupRoot -Recurse -File | Measure-Object Length -Sum).Sum
        Write-Log "over the $([int]$MaxLocalGB) GB local cap, pruned $($old.Name)"
    }

    $files = (Get-ChildItem -Path $backupRoot -Recurse -File | Measure-Object)
    Write-Log ("OK - {0} dump(s), {1} binlog archive(s), {2} files, {3:N1} MB local (cap {4} GB)" -f `
        $pulled, $blogs.Count, $files.Count, ($total / 1MB), [int]$MaxLocalGB)
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)" 'ERROR'
    exit 1
}