@echo off
echo Running Daily Snapshot Job...
curl -X POST http://localhost:3000/api/cron/create-daily-snapshots
echo.
echo Done.
pause
