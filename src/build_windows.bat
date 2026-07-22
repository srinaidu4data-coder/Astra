@echo off
setlocal enabledelayedexpansion

REM Change to the directory where this script is located
cd /d "%~dp0"

echo === Building Astra Installer ===
echo.

REM --- Step 1: Python virtual environment ---

if not exist venv\Scripts\activate.bat (
    echo Virtual environment not found. Creating...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        echo Make sure Python 3.10-3.12 is installed, or run setup_windows.bat first.
        pause
        exit /b 1
    )
)

call venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERROR: Failed to activate virtual environment.
    pause
    exit /b 1
)

REM --- Step 2: Install dependencies ---

echo Installing dependencies...
pip install -r requirements.txt pyinstaller
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

REM --- Step 3: Build app with PyInstaller ---

echo.
echo Building app files with PyInstaller...
pyinstaller astra.spec --clean
if errorlevel 1 (
    echo ERROR: PyInstaller build failed.
    pause
    exit /b 1
)
echo PyInstaller complete: dist\Astra\

REM --- Step 4: Install Inno Setup if needed ---

set "ISCC="

REM Check if iscc is already in PATH
where iscc >nul 2>nul
if %errorlevel%==0 (
    set "ISCC=iscc"
    goto :build_installer
)

REM Check common install locations
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
    set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
    goto :build_installer
)
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" (
    set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
    goto :build_installer
)

REM Not found — download and install silently
echo.
echo Inno Setup not found. Downloading...
set "INNO_INSTALLER=%TEMP%\innosetup.exe"
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://jrsoftware.org/download.php/is.exe' -OutFile '%INNO_INSTALLER%'"

if not exist "%INNO_INSTALLER%" (
    echo ERROR: Failed to download Inno Setup.
    echo Download manually from https://jrsoftware.org/isinfo.php
    echo Then re-run this script.
    pause
    exit /b 1
)

echo Installing Inno Setup silently...
"%INNO_INSTALLER%" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
del "%INNO_INSTALLER%" >nul 2>&1

REM Verify installation
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
    set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
) else (
    echo ERROR: Inno Setup installation failed.
    echo Install manually from https://jrsoftware.org/isinfo.php
    pause
    exit /b 1
)

REM --- Step 5: Build installer ---

:build_installer
echo.
echo Building installer with Inno Setup...
"!ISCC!" installer\astra_setup.iss
if errorlevel 1 (
    echo ERROR: Inno Setup compilation failed.
    pause
    exit /b 1
)

echo.
echo === Build complete! ===
echo.
echo Installer: dist\AstraSetup.exe
echo.
echo Distribute AstraSetup.exe to users.
echo They run it and get: Next ^> Next ^> Install ^> Finish
pause
