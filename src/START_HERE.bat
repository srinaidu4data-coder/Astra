@echo off
title Astra - Interview Helper
cd /d "%~dp0"

echo ============================================
echo   ASTRA INTERVIEW HELPER
echo ============================================
echo.
echo Opening the REAL app (desktop window).
echo You will NOT need the browser for this.
echo Look on your taskbar for "Astra".
echo.

if not exist "venv\Scripts\python.exe" (
  echo ERROR: venv missing. Run setup_windows.bat first.
  pause
  exit /b 1
)

if exist .env (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

call venv\Scripts\activate.bat
set PYTHONPATH=%CD%

echo Starting desktop app...
python main.py

if errorlevel 1 (
  echo.
  echo App closed with an error.
  pause
)
