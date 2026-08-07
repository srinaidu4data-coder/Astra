@echo off
setlocal
cd /d "%~dp0"

echo.
echo  SAP BTP Odyssey — Local Edition
echo  Independent learning product. Not affiliated with SAP.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is required. Install Node 20+ from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo npm install failed
    pause
    exit /b 1
  )
)

echo Generating curriculum...
call npm.cmd run generate:content
echo Building web UI...
call npm.cmd run build:web
if errorlevel 1 (
  echo Web build failed
  pause
  exit /b 1
)

echo.
echo Starting product on http://localhost:8787
echo Press Ctrl+C to stop.
echo.
start "" "http://localhost:8787"
call npm.cmd run start -w @btp-odyssey/api

endlocal
