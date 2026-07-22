@echo off
title Astra Interview Helper
cd /d "%~dp0"

echo ============================================
echo   ASTRA - REAL APP (desktop window)
echo ============================================
echo.
echo This opens the interview helper on your desktop.
echo It is NOT a website. Ignore Chrome / "Astra Proxy".
echo.
echo Look for the Astra window on your taskbar.
echo.

if not exist "venv\Scripts\python.exe" (
  echo ERROR: Virtual environment not found!
  echo Please run setup_windows.bat first.
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

python main.py %*

if errorlevel 1 (
  echo.
  echo ERROR: Application exited with an error.
  pause
)
pause
