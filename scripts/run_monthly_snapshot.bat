@echo off
echo Running Monthly Snapshot Job...
curl -X POST http://localhost:3000/api/cron/create-monthly-snapshots
echo.
echo Done.
pause
