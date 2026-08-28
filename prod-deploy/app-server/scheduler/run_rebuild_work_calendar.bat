@echo off
REM ===========================================================================
REM Rebuild the work calendar - runs daily at 01:00 via Task Scheduler.
REM Registered by scripts\8-register-tasks.ps1 (run that, don't register by hand).
REM
REM Keeps the rolling [-24mo, +12mo] work-span horizon built; a new calendar
REM version is published only when the settings digest actually changed.
REM The same rebuild also fires after every write on the work-hours settings
REM screen - this nightly run is what keeps the horizon rolling regardless.
REM
REM CRON_SECRET is read from the deployment's .env file, NOT from the user
REM environment: setx writes to the user hive, and a task running as SYSTEM
REM never sees it - the old dev-machine .bat failed silently for exactly that
REM reason. The .env file is the single source the containers read too.
REM
REM The request goes through nginx on localhost:80 (the app container's :3000
REM is not published on the prod app server).
REM ===========================================================================
setlocal

set "ENVFILE=%~dp0..\.env"
if not exist "%ENVFILE%" (
  echo ERROR: %ENVFILE% not found - is this the deployed app-server folder?
  exit /b 1
)

set "CRON_SECRET="
for /f "usebackq tokens=1,* delims==" %%A in ("%ENVFILE%") do (
  if /i "%%A"=="CRON_SECRET" set "CRON_SECRET=%%B"
)

if not defined CRON_SECRET (
  echo ERROR: CRON_SECRET is not set in %ENVFILE% - refusing to send a bogus header.
  exit /b 1
)

REM --fail: turn 401/503 into a non-zero exit code so a broken job shows up as
REM a failed Last Run Result in Task Scheduler instead of failing silently.
REM (A healthy overlap-skip returns HTTP 200 with status "skipped_overlap".)
curl --fail --silent --show-error -X POST -H "x-cron-secret: %CRON_SECRET%" http://localhost/api/cron/rebuild-work-calendar
if errorlevel 1 (
  echo ERROR: the rebuild-work-calendar request failed.
  exit /b 1
)
exit /b 0
