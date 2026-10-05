<#
  Pull backups from the VM to this PC.

  Scheduled task, runs daily. Keeps a rolling local window (7 daily +
  4 weekly) under $Root\backups. Verifies every pulled file against the
  sha256 list in the manifest the VM writes, and fails loudly if a checksum
  does not match - a backup nobody verified is not a backup.

  Run manually to test:  powershell -ExecutionPolicy Bypass -File pull-backups.ps1

  Note on native commands: under $ErrorActionPreference = 'Stop', PowerShell
  5.1 turns ANY stderr line from a native command into a terminating error -
  including scp's progress meter - so scp's own exit code never gets read and
  the resulting message ("...db.sql.gz: No such file or directory") is a lie.
  Every native call therefore goes through Invoke-Native, which relaxes the
  preference, runs quietly, and decides success from the exit code.
#>
[CmdletBinding()]
param(
    [int]    $KeepDaily  = 7,
    [int]    $KeepWeekly = 4,
    [string] $SshHost    = 'vm-students',
    [string] $RemoteBase = '/opt/student-affairs/backups',
    [string] $Root       = "$env:USERPROFILE\StudentAffair",
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
    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red }
    elseif ($Level -eq 'WARN') { Write-Host $line -ForegroundColor Yellow }
    else { Write-Host $line }
}

# Run a native command, tolerating stderr, and report the real exit code.
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

$sshArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', $SshHost)
$scpArgs = @('-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20')

# scp needs the host attached to the FILE PATH ("host:/path"). Passing a bare
# hostname as a separate argument makes scp treat it as a local source file.
function Get-RemoteSpec {
    param([string]$Path)
    '{0}:{1}' -f $SshHost, $Path
}

function Copy-FromVm {
    param([string]$RemotePath, [string]$LocalPath)
    return Invoke-Native scp ($scpArgs + @((Get-RemoteSpec $RemotePath), $LocalPath))
}

try {
    Write-Log "starting pull from $SshHost"

    # --- 1. can we reach the VM at all, without a password prompt? ----------
    $probe = Invoke-Native ssh ($sshArgs + @('echo READY'))
    if ($probe.Exit -ne 0 -or ($probe.Out -join '') -notmatch 'READY') {
        throw "cannot reach $SshHost non-interactively (is the public key installed?): $($probe.Out -join ' ')"
    }

    # --- 2. which backups are newest? ---------------------------------------
    $listArgs = $sshArgs + @(
        "ls -1 $RemoteBase/db/*.sql.gz 2>/dev/null | sed 's|.*/||; s|\.sql\.gz$||' | sort -r | head -3"
    )
    $ls = Invoke-Native ssh $listArgs
    $stamps = @($ls.Out | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d{8}-\d{6}$' })
    if ($stamps.Count -eq 0) {
        throw "no database dumps found on $SshHost under $RemoteBase/db (has backup.sh ever run?)"
    }
    Write-Log "newest stamps: $($stamps -join ', ')"

    # --- 3. pull each one ----------------------------------------------------
    $dayDir = Join-Path $Root ('backups\' + (Get-Date -Format 'yyyy-MM-dd'))
    New-Item -ItemType Directory -Path $dayDir -Force | Out-Null

    $pulled = 0
    foreach ($stamp in $stamps) {
        $dest = Join-Path $dayDir $stamp
        New-Item -ItemType Directory -Path $dest -Force | Out-Null

        $files = @(
            @{ Remote = "$RemoteBase/db/$stamp.sql.gz";    Local = 'db.sql.gz' }
            @{ Remote = "$RemoteBase/uploads/$stamp.tgz";  Local = 'uploads.tgz' }
            @{ Remote = "$RemoteBase/$stamp.manifest";     Local = 'manifest.txt' }
            @{ Remote = "$RemoteBase/env/$stamp.env";      Local = 'app.env' }
        )

        $allOk = $true
        foreach ($f in $files) {
            $local = Join-Path $dest $f.Local
            $r = Copy-FromVm $f.Remote $local
            if ($r.Exit -ne 0 -or -not (Test-Path $local)) {
                Write-Log "could not pull $($f.Remote) (exit $($r.Exit)) $($r.Out -join ' ')" 'WARN'
                $allOk = $false
            }
        }
        if ($allOk) { $pulled++ }
        Write-Log "pulled $stamp"
    }

    # --- 4. weekly keeper ----------------------------------------------------
    $weeklyDir = Join-Path $Root 'backups\_weekly'
    New-Item -ItemType Directory -Path $weeklyDir -Force | Out-Null
    $wArgs = $sshArgs + @(
        "ls -1 $RemoteBase/weekly/*.sql.gz 2>/dev/null | sed 's|.*/||; s|\.sql\.gz$||' | sort -r | head -$KeepWeekly"
    )
    $w = Invoke-Native ssh $wArgs
    $wStamps = @($w.Out | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d{8}-\d{6}$' })
    foreach ($stamp in $wStamps) {
        $pairs = @(@("db/$stamp.sql.gz", 'db.sql.gz'), @("uploads/$stamp.tgz", 'uploads.tgz'))
        foreach ($pair in $pairs) {
            $local = Join-Path $weeklyDir $pair[1]
            $r = Copy-FromVm "$RemoteBase/weekly/$($pair[0])" $local
            if ($r.Exit -ne 0) { Write-Log "could not pull weekly $($pair[0])" 'WARN' }
        }
    }
    if ($wStamps.Count -gt 0) { Write-Log "pulled weekly: $($wStamps -join ', ')" }

    # --- 5. verify checksums -------------------------------------------------
    # Without this a truncated or corrupted copy still looks like a backup.
    $checked = 0; $bad = 0
    foreach ($dir in Get-ChildItem -Path $dayDir -Directory) {
        $manifestPath = Join-Path $dir.FullName 'manifest.txt'
        if (-not (Test-Path $manifestPath)) { continue }
        foreach ($line in Get-Content $manifestPath) {
            if ($line -notmatch '^([0-9a-f]{64})\s+(.+)$') { continue }
            $expected = $Matches[1]
            $remoteName = Split-Path $Matches[2] -Leaf
            $localName = switch -Regex ($remoteName) {
                '\.sql\.gz$' { 'db.sql.gz' }
                '\.tgz$'     { 'uploads.tgz' }
                '\.env$'     { 'app.env' }
                default      { $null }
            }
            if (-not $localName) { continue }
            $lp = Join-Path $dir.FullName $localName
            if (-not (Test-Path $lp)) { continue }
            $actual = (Get-FileHash -Path $lp -Algorithm SHA256).Hash.ToLower()
            $checked++
            if ($actual -ne $expected) {
                $bad++
                Write-Log "CHECKSUM MISMATCH $($dir.Name)\$localName vm=$expected local=$actual" 'ERROR'
            }
        }
    }
    if ($checked -eq 0) { throw "no checksums verified - manifest missing or unreadable" }
    if ($bad -gt 0) { throw "$bad of $checked pulled files failed checksum verification" }
    Write-Log "verified $checked file checksums, all match"

    # --- 6. prune the local window ------------------------------------------
    $backupRoot = Join-Path $Root 'backups'
    $dailyDirs = Get-ChildItem -Path $backupRoot -Directory |
                 Where-Object { $_.Name -ne '_weekly' } | Sort-Object Name -Descending
    foreach ($old in @($dailyDirs | Select-Object -Skip $KeepDaily)) {
        Remove-Item -LiteralPath $old.FullName -Recurse -Force
        Write-Log "pruned local $($old.Name)"
    }
    $wFiles = Get-ChildItem -Path $weeklyDir -Filter '*.sql.gz' | Sort-Object Name -Descending
    foreach ($old in @($wFiles | Select-Object -Skip $KeepWeekly)) {
        Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath ($old.FullName -replace '\.sql\.gz$', '.tgz') -Force -ErrorAction SilentlyContinue
        Write-Log "pruned weekly $($old.Name)"
    }

    $totals = Get-ChildItem -Path $backupRoot -Recurse -File | Measure-Object Length -Sum
    Write-Log ("OK - {0}/{1} stamps pulled, {2} local files, {3:N1} MB, checksums {4}/{4} good" -f `
        $pulled, $stamps.Count, $totals.Count, ($totals.Sum / 1MB), $checked)
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)" 'ERROR'
    exit 1
}
