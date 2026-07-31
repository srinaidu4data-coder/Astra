@echo off
title InterviewPulse Job Search Lab
cd /d "%~dp0"

echo.
echo  === InterviewPulse Job Search Lab ===
echo  API:  http://127.0.0.1:8787
echo  UI:   http://127.0.0.1:5173/#/jobsearch
echo  Key:  src\.env  OPENAI_API_KEY=sk-...
echo.

start "Copilot API :8787" cmd /k "cd /d %~dp0src && venv\Scripts\python.exe copilot_api.py"
timeout /t 3 /nobreak >nul
start "Vite UI :5173" cmd /k "cd /d %~dp0interview-pulse-ai && npm.cmd run dev -- --host 127.0.0.1 --port 5173"

timeout /t 4 /nobreak >nul
start http://127.0.0.1:5173/#/jobsearch

echo Opened two terminals (API + UI) and your browser.
echo Keep both terminal windows open while testing.
pause
