# ===========================================================================
# APP SERVER - step 8: remove the scheduled tasks earlier releases registered
# ===========================================================================
#   .\scripts\8-register-tasks.ps1        (run from an elevated PowerShell)
#
# Since 2026-11-26 the app needs NO Windows scheduled task. Everything that
# used to run from Task Scheduler runs inside the app server itself, started
# when it boots (src/instrumentation.ts):
#   - release-stale-tests    every 5 minutes, in-app timer (src/app/lib/jobs/stale-tests-timer.ts)
#   - rebuild-work-calendar  at server start + after every work-hours save
#                            (src/app/lib/metrics/ledger/calendar-sync.ts)
#   - metrics-selfcheck      not needed on a schedule; a manual endpoint remains
#
# This script only unregisters the testingsite-* tasks an earlier release put
# here (their .bat files are gone, so they would fail every run). Running it
# again is safe. The file keeps its name so existing deployment notes still
# point at the right step.
# ===========================================================================

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$prefix  = "testingsite-"
$retired = @("release-stale-tests", "rebuild-work-calendar", "metrics-selfcheck")

foreach ($name in $retired) {
    $taskName = "$prefix$name"
    try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
        Write-Host "  removed: $taskName" -ForegroundColor Green
    } catch {
        Write-Host "  not registered: $taskName" -ForegroundColor DarkGray
    }
}

# Surface leftovers the operator should look at: anything else of ours, and the
# legacy snapshot tasks some machines registered by hand.
$leftovers = Get-ScheduledTask | Where-Object {
    $_.TaskName -like "$prefix*" -or $_.TaskName -match "snapshot"
}
if ($leftovers) {
    Write-Host ""
    Write-Host "NOTE: these scheduled tasks remain. The app needs none of them -" -ForegroundColor Yellow
    Write-Host "confirm what they are and remove them manually:" -ForegroundColor Yellow
    $leftovers | ForEach-Object { Write-Host "  - $($_.TaskName)" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Done. The app server runs its own background jobs; no scheduled task is needed." -ForegroundColor Cyan
