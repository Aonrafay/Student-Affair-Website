<#
  Register the daily backup pull as a Windows scheduled task.

    powershell -ExecutionPolicy Bypass -File register-backup-task.ps1

  Two triggers on purpose: a daily 09:00 slot, plus "at log on". The PC is a
  laptop that is often off at 09:00, and the script always pulls the newest
  dumps, so a missed run is caught up on next log on instead of being lost.

  Runs as the interactive user (InteractiveToken) rather than storing the
  Windows password in the task. Consequence: it only runs while Aon-PC is
  logged on. Backups on the VM itself are unaffected - those run from cron.
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'StudentAffairs - Pull Backups from VM',
    [string]$ScriptPath = "$env:USERPROFILE\StudentAffair\pull-backups.ps1",
    [string]$AtLogOn  = '09:00'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ScriptPath)) { throw "pull-backups.ps1 not found at $ScriptPath" }
$action = 'powershell.exe'
$argSet = @(
    '-NoProfile'
    '-ExecutionPolicy', 'Bypass'
    '-WindowStyle', 'Hidden'
    '-File', ('"{0}"' -f $ScriptPath)
)

$daily = New-ScheduledTaskTrigger -Daily -At $AtLogOn
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
    -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Force `
    -Action (New-ScheduledTaskAction -Execute $action -Argument ($argSet -join ' ')) `
    -Trigger @($daily, $logon) `
    -Principal $principal `
    -Settings $settings `
    -Description 'Pulls the nightly Student Affairs CMS backups off the VM (ssh vm-students), verifies every checksum against the VM manifest, and prunes to a 7-day / 4-week local window.' | Out-Null

Write-Host "registered: $TaskName" -ForegroundColor Green
Get-ScheduledTask -TaskName $TaskName |
    Get-ScheduledTaskInfo |
    Select-Object TaskName, LastRunTime, LastTaskResult, NextRunTime |
    Format-List
