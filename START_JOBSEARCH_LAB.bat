@echo off
title InterviewPulse Job Search Lab (Enterprise + Night Scout)
cd /d "%~dp0"

echo.
echo  === InterviewPulse Job Search Lab — Enterprise + Night Scout ===
echo  API:   http://127.0.0.1:8787  (supervised + auto-restart)
echo  Night: worker polls schedules (searches while you sleep)
echo  UI:    http://127.0.0.1:5173/#/auto-apply
echo  Morning digest: /api/jobsearch/night/morning
echo.

REM Supervised API
start "JobSearch API Supervisor :8787" cmd /k "cd /d %~dp0src && venv\Scripts\python.exe -m jobsearch.supervisor"

timeout /t 3 /nobreak >nul
REM Night Scout worker — overnight searches, multi-tenant ready
start "Night Scout Worker" cmd /k "cd /d %~dp0src && venv\Scripts\python.exe -m jobsearch.night_worker --poll 30"

timeout /t 3 /nobreak >nul
start "Vite UI :5173" cmd /k "cd /d %~dp0interview-pulse-ai && npm.cmd run dev -- --host 127.0.0.1 --port 5173"

timeout /t 4 /nobreak >nul
start http://127.0.0.1:5173/#/jobsearch

echo.
echo Opened: API supervisor + Night Scout worker + UI
echo Keep terminals open. Morning results: GET /api/jobsearch/night/morning
echo Heartbeat: src\jobsearch_supervisor.heartbeat
echo Night DB:  src\data\night_scout.db
pause
