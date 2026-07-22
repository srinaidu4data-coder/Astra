@echo off
title InterviewPulse Backend
cd /d "%~dp0"
echo.
echo  InterviewPulse Copilot API
echo  HTTP  http://127.0.0.1:8787
echo  Live  ws://127.0.0.1:8787/ws/interview
echo  Keep this window open while using the app.
echo.

if exist "venv\Scripts\python.exe" (
  "venv\Scripts\python.exe" copilot_api.py
) else (
  python copilot_api.py
)

echo.
echo  Server stopped. Press any key to close.
pause >nul
