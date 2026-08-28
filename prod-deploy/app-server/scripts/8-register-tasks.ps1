# ===========================================================================
# APP SERVER - step 8: register (or re-register) all scheduled jobs
# ===========================================================================
#   .\scripts\8-register-tasks.ps1        (run from an elevated PowerShell)
#
# Single source of truth for what runs on a schedule on this machine. Running
# it again is safe: every task it owns is dropped and re-created, so a stale
# registration from an earlier deployment cannot linger with old paths.
#
# Tasks run as SYSTEM (no logged-on user needed). The .bat files read
# CRON_SECRET from the deployment's .env themselves - nothing here depends on
# user-hive environment variables.
#
# NOTE: the legacy snapshot jobs (run_daily_snapshot / run_monthly_snapshot)
# are NOT registered here. The snapshot subsystem is being replaced; if this
# machine still has such tasks from a manual registration, this script lists
# them at the end so the operator can remove them deliberately.
# ===========================================================================

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$root      = Split-Path -Parent $PSScriptRoot
$scheduler = Join-Path $root "scheduler"
$prefix    = "testingsite-"

# task name (without prefix) -> @{ bat = file; EveryMinutes = N } for a
# repeating task, or @{ bat = file; DailyAt = "HH:mm" } for a daily one.
$tasks = @(
    @{ Name = "release-stale-tests";   Bat = "run_release_stale_tests.bat";   EveryMinutes = 5 }
    @{ Name = "rebuild-work-calendar"; Bat = "run_rebuild_work_calendar.bat"; DailyAt = "01:00" }
)

foreach ($t in $tasks) {
    $taskName = "$prefix$($t.Name)"
    $batPath  = Join-Path $scheduler $t.Bat
    if (-not (Test-Path $batPath)) { throw "Missing $batPath" }

    # Drop a previous registration of ours, if any.
    try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop } catch {}

    $action  = New-ScheduledTaskAction -Execute $batPath
    if ($t.DailyAt) {
        $trigger  = New-ScheduledTaskTrigger -Daily -At $t.DailyAt
        $schedule = "daily at $($t.DailyAt)"
    } else {
        $trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
                    -RepetitionInterval (New-TimeSpan -Minutes $t.EveryMinutes)
        $schedule = "every $($t.EveryMinutes) min"
    }
    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -StartWhenAvailable
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal | Out-Null
    Write-Host "  registered: $taskName  ($schedule -> $($t.Bat))" -ForegroundColor Green
}

# Surface leftovers the operator should look at.
$leftovers = Get-ScheduledTask | Where-Object {
    $_.TaskName -match "snapshot" -and $_.TaskName -notlike "$prefix*"
}
if ($leftovers) {
    Write-Host ""
    Write-Host "NOTE: found scheduled tasks with 'snapshot' in the name that this" -ForegroundColor Yellow
    Write-Host "script does not manage. The snapshot subsystem is being retired -" -ForegroundColor Yellow
    Write-Host "confirm and remove them manually:" -ForegroundColor Yellow
    $leftovers | ForEach-Object { Write-Host "  - $($_.TaskName)" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Done. Verify with:  Get-ScheduledTask -TaskName '$prefix*'" -ForegroundColor Cyan
