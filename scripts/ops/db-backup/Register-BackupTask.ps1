#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Registers (or removes) the Task Scheduler jobs that run Backup-Databases.ps1
    at noon and at night, Sunday to Thursday.

.DESCRIPTION
    Creates two tasks under \DigitalFactory\ :
        DB Backup - Noon    Sun-Thu at -NoonTime   (default 12:00)
        DB Backup - Night   Sun-Thu at -NightTime  (default 23:00)

    The tasks must run as a user that can reach Docker. With Docker Desktop that
    is the user running Docker Desktop (the default here: you are asked for its
    password so the task runs whether or not the user is logged on). With Docker
    Engine installed as a Windows service, -AsSystem works too.

.EXAMPLE
    .\Register-BackupTask.ps1

.EXAMPLE
    .\Register-BackupTask.ps1 -NightTime 22:30 -BackupRoot D:\backups\scheduled

.EXAMPLE
    .\Register-BackupTask.ps1 -Unregister
#>
param(
    [string]$ScriptPath = (Join-Path $PSScriptRoot 'Backup-Databases.ps1'),
    [string]$BackupRoot = 'C:\backups\scheduled',
    [ValidatePattern('^\d{2}:\d{2}$')][string]$NoonTime = '12:00',
    [ValidatePattern('^\d{2}:\d{2}$')][string]$NightTime = '23:00',
    [string]$TaskPath = '\DigitalFactory\',
    [switch]$AsSystem,
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$tasks = @(
    @{ Name = 'DB Backup - Noon';  Slot = 'Noon';  Time = $NoonTime }
    @{ Name = 'DB Backup - Night'; Slot = 'Night'; Time = $NightTime }
)

if ($Unregister) {
    foreach ($t in $tasks) {
        if (Get-ScheduledTask -TaskPath $TaskPath -TaskName $t.Name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $t.Name -Confirm:$false
            Write-Host "Removed $TaskPath$($t.Name)"
        }
    }
    return
}

$ScriptPath = (Resolve-Path $ScriptPath).Path
$workDays = 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

if ($AsSystem) {
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
    $cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" `
        -Message 'Windows account the backup runs as (must be able to run docker)'
}

foreach ($t in $tasks) {
    $at = [datetime]::ParseExact($t.Time, 'HH:mm', $null)
    $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $workDays -At $at
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`" -Slot $($t.Slot) -BackupRoot `"$BackupRoot`""
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory (Split-Path $ScriptPath)

    $common = @{
        TaskPath    = $TaskPath
        TaskName    = $t.Name
        Action      = $action
        Trigger     = $trigger
        Settings    = $settings
        Description = "PostgreSQL + MinIO backup ($($t.Slot)), Sun-Thu. Log: $BackupRoot\logs"
        Force       = $true
    }
    if ($AsSystem) {
        Register-ScheduledTask @common -Principal $principal | Out-Null
    } else {
        Register-ScheduledTask @common -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest | Out-Null
    }
    Write-Host "Registered $TaskPath$($t.Name)  (Sun-Thu at $($t.Time))"
}

Write-Host ''
Write-Host "Test now:  Start-ScheduledTask -TaskPath '$TaskPath' -TaskName 'DB Backup - Noon'"
Write-Host "Log:       $BackupRoot\logs"
