<#
  Run a bash script on the VM as root, non-interactively.

  The VM's sudo requires a password and its ticket is per-tty, so it cannot be
  cached between ssh sessions. This uploads a local script and runs it under
  `sudo -S bash`, which avoids nesting quoting levels and keeps the remote
  command a plain script file.

    .\vm-sudo.ps1 -Script .\vm\base-setup.sh -Pass '<password>'

  -Pass is passed in per call on purpose: the password is never written to a
  file on disk, here or on the VM.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Script,
    [Parameter(Mandatory = $true)][string] $Pass,
    [string] $RemotePath = '/tmp/opencode-task.sh'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Script)) { throw "local script not found: $Script" }

scp -o BatchMode=yes -o ConnectTimeout=20 $Script "vm-students:${RemotePath}"
if ($LASTEXITCODE -ne 0) { throw "scp of $Script to the VM failed" }

$remote = "chmod 700 '$RemotePath' && printf '%s\n' '$Pass' | sudo -S -p '' bash '$RemotePath'; rc=`$?; rm -f '$RemotePath'; exit `$rc"
ssh -o BatchMode=yes -o ConnectTimeout=20 vm-students $remote
$rc = $LASTEXITCODE

if ($rc -ne 0) { throw "remote script '$Script' exited $rc" }
exit 0
