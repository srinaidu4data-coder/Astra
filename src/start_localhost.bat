@echo off
title Astra Local API - optional backend only
cd /d "%~dp0"

echo ============================================
echo   OPTIONAL: Astra API backend
echo ============================================
echo.
echo This is NOT the interview app.
echo The real app is the DESKTOP window from run.bat
echo.
echo Most of the time you do NOT need this page.
echo Press Ctrl+C to close, or leave it open for API tests only.
echo.

if not exist "venv\Scripts\python.exe" (
  echo ERROR: venv not found.
  pause
  exit /b 1
)

if exist .env (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

set PYTHONPATH=%CD%
set DATABASE_URL=sqlite:///./astra_backend.db

for /f "tokens=5" %%P in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
  taskkill /F /PID %%P >nul 2>&1
)

echo Starting optional API on http://127.0.0.1:8000 (no browser auto-open)
venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause
