@echo off
echo Running Monthly Snapshot Job...
REM The /api/cron endpoints are allowlisted past the auth middleware and guarded
REM by a shared secret. In PRODUCTION set the CRON_SECRET env var (matching the
REM server's CRON_SECRET), e.g.  setx CRON_SECRET your-secret  then reopen the shell.
REM In dev CRON_SECRET is unset on the server, so the header is ignored.
curl -X POST -H "x-cron-secret: %CRON_SECRET%" http://localhost:3000/api/cron/create-monthly-snapshots
echo.
echo Done.
pause
