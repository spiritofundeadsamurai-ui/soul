@echo off
title Soul AI (HTTPS)
cd /d "D:\Programer Project\soul"

:: Kill old Soul if running
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Soul AI" >nul 2>&1
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Soul AI (HTTPS)" >nul 2>&1

:: Build latest code
echo Building Soul v2.0...
call npm run build >nul 2>&1
if %errorlevel% neq 0 (
    echo Build failed! Running last working version...
) else (
    echo Build OK
)

:: Start Soul with HTTPS + open browser
echo Starting Soul (HTTPS)...
set SOUL_HTTPS=1
timeout /t 2 /nobreak >nul
start "" "https://localhost:47779"
node dist/server.js
pause
