@echo off
setlocal enabledelayedexpansion

REM Change to the directory where this script is located
cd /d "%~dp0"

echo === Astra Interview Copilot - Windows Setup ===
echo.

REM Define installer paths and URLs upfront (before any if blocks)
set "PYTHON_INSTALLER=%TEMP%\python-installer.exe"
set "PYTHON_URL=https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
set "RUSTUP_INSTALLER=%TEMP%\rustup-init.exe"
set "RUSTUP_URL=https://win.rustup.rs/x86_64"
set "PYTHON_CMD=python"

REM Check Python version (need 3.10-3.12, not 3.13+ due to onnxruntime compatibility)
set "NEED_PYTHON=0"

python --version >nul 2>&1
if errorlevel 1 (
    set "NEED_PYTHON=1"
) else (
    REM Check if Python version is compatible (3.10-3.12)
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set "PYTHON_VER=%%v"
    for /f "tokens=1,2 delims=." %%a in ("!PYTHON_VER!") do (
        set "PY_MAJOR=%%a"
        set "PY_MINOR=%%b"
    )

    if !PY_MAJOR! NEQ 3 (
        set "NEED_PYTHON=1"
    ) else if !PY_MINOR! LSS 10 (
        echo Python !PYTHON_VER! found but version 3.10-3.12 required.
        set "NEED_PYTHON=1"
    ) else if !PY_MINOR! GTR 12 (
        echo Python !PYTHON_VER! found but version 3.10-3.12 required ^(onnxruntime not yet available for 3.13+^).
        set "NEED_PYTHON=1"
    ) else (
        echo Python !PYTHON_VER! found - compatible.
    )
)

if "!NEED_PYTHON!"=="1" (
    echo Installing Python 3.11.9...
    echo.

    echo Downloading Python 3.11.9...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%PYTHON_INSTALLER%'"

    if not exist "%PYTHON_INSTALLER%" (
        echo ERROR: Failed to download Python installer.
        echo Please download and install Python 3.11 manually from https://www.python.org/downloads/release/python-3119/
        pause
        exit /b 1
    )

    echo Installing Python 3.11.9 silently ^(this may take a minute^)...
    "%PYTHON_INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1

    if errorlevel 1 (
        echo ERROR: Python installation failed.
        echo Please download and install Python 3.11 manually from https://www.python.org/downloads/release/python-3119/
        del "%PYTHON_INSTALLER%" >nul 2>&1
        pause
        exit /b 1
    )

    echo Python 3.11.9 installed successfully.
    del "%PYTHON_INSTALLER%" >nul 2>&1

    REM Use the specific Python 3.11 path
    set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    set "PATH=%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;!PATH!"

    REM Verify installation
    "!PYTHON_CMD!" --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python installed but not accessible. Please restart your terminal and run this script again.
        pause
        exit /b 1
    )

    echo.
)

REM Check Rust/Cargo (required for tokenizers package)
cargo --version >nul 2>&1
if errorlevel 1 (
    echo Rust/Cargo not found. Installing Rust...
    echo.

    echo Downloading Rust installer...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%RUSTUP_URL%' -OutFile '%RUSTUP_INSTALLER%'"

    if not exist "%RUSTUP_INSTALLER%" (
        echo ERROR: Failed to download Rust installer.
        echo Please install Rust manually from https://rustup.rs/
        pause
        exit /b 1
    )

    echo Installing Rust silently ^(this may take a few minutes^)...
    "%RUSTUP_INSTALLER%" -y --default-toolchain stable --profile minimal

    if errorlevel 1 (
        echo ERROR: Rust installation failed.
        echo Please install Rust manually from https://rustup.rs/
        del "%RUSTUP_INSTALLER%" >nul 2>&1
        pause
        exit /b 1
    )

    echo Rust installed successfully.
    del "%RUSTUP_INSTALLER%" >nul 2>&1

    REM Add Rust to PATH for current session
    set "PATH=%USERPROFILE%\.cargo\bin;!PATH!"

    REM Verify installation
    cargo --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Rust installed but not accessible. Please restart your terminal and run this script again.
        pause
        exit /b 1
    )

    echo.
)

REM Remove existing venv if present (may be from incompatible Python version)
if exist venv (
    echo Removing existing virtual environment...
    echo This may take a moment...

    REM Kill any Python processes that might lock the venv
    taskkill /f /im python.exe >nul 2>&1
    taskkill /f /im pythonw.exe >nul 2>&1

    REM Wait a moment for processes to release files
    timeout /t 2 /nobreak >nul

    REM Try to remove the venv folder
    rmdir /s /q venv 2>nul

    REM If still exists, try again with del first
    if exist venv (
        del /f /s /q venv\* >nul 2>&1
        rmdir /s /q venv 2>nul
    )

    if exist venv (
        echo WARNING: Could not fully remove old venv. Proceeding anyway...
    ) else (
        echo Old virtual environment removed.
    )
)

REM Create virtual environment
echo Creating virtual environment...
"!PYTHON_CMD!" -m venv venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

REM Note about API key setup
echo.
echo NOTE: On first run, you'll be prompted to set up your OpenAI API key.
echo The key will be stored in: %%APPDATA%%\astra\.env

echo.
echo === Setup complete! ===
echo Run 'run.bat' to start Astra.
endlocal
pause
