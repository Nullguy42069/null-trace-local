@echo off
REM ========================================
REM   NullTrace Local - Windows Start Script
REM ========================================

title NullTrace Local

set PROJECT_ROOT=%~dp0
set SERVER_DIR=%PROJECT_ROOT%server
set CLIENT_DIR=%PROJECT_ROOT%client

echo ========================================
echo    NullTrace Local
echo ========================================
echo.

REM 1. Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js v18+ from https://nodejs.org
    pause
    exit /b 1
)

REM 2. Verify Server Bundle
echo [*] Checking server bundle...
if not exist "%SERVER_DIR%\dist\server.js" (
    echo ERROR: Server bundle not found at server\dist\server.js
    echo Please ensure you have the complete repository with the pre-built server bundle.
    pause
    exit /b 1
)

REM 3. Install Server Dependencies
echo [*] Checking server dependencies...
if not exist "%SERVER_DIR%\node_modules" (
    echo     Installing server dependencies...
    cd /d "%SERVER_DIR%"
    call npm install --omit=dev
    cd /d "%PROJECT_ROOT%"
)

REM 4. Install Client Dependencies
echo [*] Checking client dependencies...
if not exist "%CLIENT_DIR%\node_modules" (
    echo     Installing client dependencies...
    cd /d "%CLIENT_DIR%"
    call npm install
    cd /d "%PROJECT_ROOT%"
)

REM 5. Check for .env configuration
if not exist "%SERVER_DIR%\.env" (
    echo.
    echo [!] No .env file found in server\
    echo     Copying .env.example -^> .env (using default public RPC^)
    echo     For better performance, edit server\.env with your own RPC URL
    copy "%SERVER_DIR%\.env.example" "%SERVER_DIR%\.env" >nul
    echo.
)

REM 6. Start Application
echo [*] Starting services...
echo.

echo -^> Starting Local API Server (Port 3003^)...
cd /d "%SERVER_DIR%"
start "NullTrace Server" /min cmd /c "npm start"

REM Wait for server to warm up
timeout /t 3 /nobreak >nul

echo -^> Starting Web Interface (Port 5173^)...
echo.
echo ========================================
echo   Frontend:  http://localhost:5173
echo   Backend:   http://localhost:3003
echo ========================================
echo.
echo Close this window to stop all services.
echo.

cd /d "%CLIENT_DIR%"
call npm run dev
