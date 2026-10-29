@echo off
setlocal
title PulseCast Radio - Full-Stack Launcher

:: Set absolute paths safely (handles spaces in path)
set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%~dp0backend"
set "FRONTEND_DIR=%~dp0frontend"

echo ======================================================================
echo    P U L S E C A S T   F U L L - S T A C K   R A D I O   S Y S T E M
echo       Starting BOTH Frontend and Backend Servers (SRS v2.0)
echo ======================================================================
echo.

:: 1. Verify Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Node.js is required to run the Express backend API.
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: 2. Check backend dependencies
if not exist "%BACKEND_DIR%\node_modules" (
    echo [INFO] Installing backend dependencies...
    cd /d "%BACKEND_DIR%"
    call npm install
    cd /d "%ROOT_DIR%"
    echo.
)

:: 3. Start Backend Server on Port 5000
echo [1/3] Starting Backend API Server on http://localhost:5000 ...
start "PulseCast Backend Server [Port 5000]" /D "%BACKEND_DIR%" cmd /k "title PulseCast Backend Server [Port 5000] & node src/server.js"

:: 4. Start Frontend Server on Port 8080
echo [2/3] Starting Dedicated Frontend Server on http://localhost:8080 ...
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "PulseCast Frontend Server [Port 8080]" /D "%FRONTEND_DIR%" cmd /k "title PulseCast Frontend Server [Port 8080] & python -m http.server 8080"
) else (
    where npx >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        start "PulseCast Frontend Server [Port 8080]" /D "%FRONTEND_DIR%" cmd /k "title PulseCast Frontend Server [Port 8080] & npx serve -l 8080 ."
    ) else (
        echo [NOTE] Python not detected. Frontend is also hosted directly through Express on port 5000.
    )
)

:: 5. Open Web Browser
echo [3/3] Opening web browser...
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:5000"

echo.
echo ======================================================================
echo    BOTH SERVERS ARE RUNNING SUCCESSFULLY!
echo ======================================================================
echo.
echo    * Full-Stack Web App:  http://localhost:5000
echo    * Backend REST API:    http://localhost:5000/api
echo    * Dedicated Frontend:  http://localhost:8080
echo.
echo    Pre-seeded Demo Accounts:
echo    - Administrator: admin@pulsecast.com    / AdminPassword123!
echo    - Listener:      listener@pulsecast.com / ListenerPass123!
echo.
echo    Active Windows:
echo    - PulseCast Backend Server [Port 5000]
echo    - PulseCast Frontend Server [Port 8080]
echo.
echo ======================================================================
echo    Press any key in this window to STOP BOTH SERVERS and exit.
echo ======================================================================
echo.
pause

echo Stopping backend and frontend servers...
taskkill /F /FI "WINDOWTITLE eq PulseCast Backend Server [Port 5000]*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq PulseCast Frontend Server [Port 8080]*" >nul 2>&1
echo Both servers stopped.
ping -n 2 127.0.0.1 >nul
