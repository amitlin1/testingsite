@echo off
echo Running Monthly Snapshot Job...
REM The /api/cron endpoints are allowlisted past the auth middleware and guarded
REM by a shared secret. They are CLOSED unless CRON_SECRET is set on the SERVER
REM (the app answers 503 when it isn't) — there is no unauthenticated path.
REM Set the same value here, e.g.  setx CRON_SECRET your-secret  then reopen the
REM shell. Under Task Scheduler make sure the account running the task actually
REM sees the variable (setx writes to the user hive; SYSTEM will not see it).
if not defined CRON_SECRET (
  echo ERROR: CRON_SECRET is not set for this account - refusing to send a bogus header.
  exit /b 1
)
REM --fail: turn a 401/503 into a non-zero exit code so a broken job is visible
REM in Task Scheduler instead of failing silently every night.
curl --fail --silent --show-error -X POST -H "x-cron-secret: %CRON_SECRET%" http://localhost:3000/api/cron/create-monthly-snapshots
if errorlevel 1 (
  echo.
  echo ERROR: the snapshot request failed.
  exit /b 1
)
echo.
echo Done.
