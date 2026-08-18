@echo off
echo Running Release Stale Tests Job...
REM The /api/cron endpoints are allowlisted past the auth middleware and guarded
REM by a shared secret. They are CLOSED unless CRON_SECRET is set on the SERVER
REM (the app answers 503 when it isn't) — there is no unauthenticated path.
REM Set the same value here, e.g.  setx CRON_SECRET your-secret  then reopen the
REM shell. Under Task Scheduler make sure the account running the task actually
REM sees the variable (setx writes to the user hive; SYSTEM will not see it).
REM
REM This job releases items stuck in "in test"/"in research" for over 30
REM minutes with no submitted result (abandoned tab, crash, lost connection).
REM Schedule it to run every 5 minutes — much more often than the 30-minute
REM threshold, so a stuck item never waits much longer than that to clear.
if not defined CRON_SECRET (
  echo ERROR: CRON_SECRET is not set for this account - refusing to send a bogus header.
  exit /b 1
)
REM --fail: turn a 401/503 into a non-zero exit code so a broken job is visible
REM in Task Scheduler instead of failing silently every run.
curl --fail --silent --show-error -X POST -H "x-cron-secret: %CRON_SECRET%" http://localhost:3000/api/cron/release-stale-tests
if errorlevel 1 (
  echo.
  echo ERROR: the release-stale-tests request failed.
  exit /b 1
)
echo.
echo Done.
