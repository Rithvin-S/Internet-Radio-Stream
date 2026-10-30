@echo off
setlocal
title PulseCast Local Radio Server - http://localhost:5000

:: Set absolute paths safely (handles spaces in paths)
set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%~dp0backend"
set "PORT=5000"

echo ======================================================================
echo           P U L S E C A S T   L O C A L   R A D I O
echo        Full-Stack Internet Radio Platform (Local Server)
echo ======================================================================
echo.

:: 1. Verify Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in your system PATH!
    echo.
    echo Node.js is required to run the PulseCast local server.
    echo Please download and install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: 2. Check and install backend dependencies if needed
if not exist "%BACKEND_DIR%\node_modules" (
    echo [INFO] First-time setup: Installing required dependencies...
    cd /d "%BACKEND_DIR%"
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [ERROR] npm install encountered an error.
        echo Please ensure you have an active internet connection.
        echo.
        pause
        exit /b 1
    )
    cd /d "%ROOT_DIR%"
    echo.
)

:: 3. Free Port 5000 if occupied by a previous dangling process
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo [INFO] Freeing port %PORT% from previous instance PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: 4. Launch web browser to local site after a 1-second delay
echo [INFO] Opening default web browser to http://localhost:%PORT% ...
start "" cmd /c "ping -n 2 127.0.0.1 >nul & start http://localhost:%PORT%"

:: 5. Display local server information and demo accounts
echo.
echo ======================================================================
echo    LOCAL SERVER READY - FULL-STACK RADIO RUNNING ON PORT %PORT%
echo ======================================================================
echo.
echo    * Web Application:     http://localhost:%PORT%
echo    * Stations Directory:  http://localhost:%PORT%/stations.html
echo    * Station Management:  http://localhost:%PORT%/admin/stations.html
echo    * Schedule Calendar:   http://localhost:%PORT%/admin/schedules.html
echo    * Backend REST API:    http://localhost:%PORT%/api
echo.
echo    Pre-configured Demo Accounts:
echo    - Administrator: admin@pulsecast.com    / AdminPassword123!
echo    - Listener:      listener@pulsecast.com / ListenerPass123!
echo.
echo    ------------------------------------------------------------------
echo    Server logs will appear live below.
echo    Press Ctrl + C or close this window to stop the server.
echo ======================================================================
echo.

:: 6. Run the server directly in this window
cd /d "%BACKEND_DIR%"
node src/server.js

:: If node exits unexpectedly, pause so user can inspect the error
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [NOTICE] Server stopped with exit code %ERRORLEVEL%.
    echo.
    pause
)
