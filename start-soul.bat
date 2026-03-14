@echo off
title Soul AI
cd /d "D:\Programer Project\soul"

echo ================================
echo    Soul AI - Starting...
echo ================================
echo.

:: Kill old Soul processes (suppress errors if none found)
taskkill /F /FI "WINDOWTITLE eq Soul AI" >nul 2>&1

:: Verify node is available
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found in PATH!
    echo Please install Node.js from https://nodejs.org/
    echo Or add it to your system PATH.
    pause
    exit /b 1
)

:: Verify npm is available
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm not found in PATH!
    echo Please install Node.js from https://nodejs.org/
    echo Or add it to your system PATH.
    pause
    exit /b 1
)

:: Build latest code
echo Building...
call npm.cmd run build >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Build failed, trying to start with existing dist...
) else (
    echo Build complete.
)
echo.

:: Open browser after 3-second delay (runs in background)
start "" cmd /c "timeout /t 3 /nobreak >nul & start "" "http://localhost:47779""

:: Start server (blocks — keeps window open)
echo Starting Soul server on http://localhost:47779 ...
echo Press Ctrl+C to stop.
echo.
node "D:\Programer Project\soul\dist\server.js"

pause
