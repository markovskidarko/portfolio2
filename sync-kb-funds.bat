@echo off
REM Sync KB Funds every hour
REM This script calls the /api/kb-funds/update endpoint

REM Set working directory to script location
cd /d "%~dp0"

REM Create logs directory if it doesn't exist
if not exist "logs" mkdir logs

REM Set log file with timestamp
set LOG_FILE=logs\kb-funds-sync-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%.log
set LOG_FILE=%LOG_FILE: =0%

REM Get the server URL (default to localhost:3000)
set SERVER_URL=http://localhost:3000

REM Log start
echo [%date% %time%] ======================================== >> "%LOG_FILE%"
echo [%date% %time%] Starting KB Funds sync... >> "%LOG_FILE%"
echo [%date% %time%] Server URL: %SERVER_URL% >> "%LOG_FILE%"
echo [%date% %time%] Working Directory: %CD% >> "%LOG_FILE%"

REM Check if PowerShell script exists
if not exist "sync-kb-funds.ps1" (
    echo [%date% %time%] ERROR: sync-kb-funds.ps1 not found! >> "%LOG_FILE%"
    echo [%date% %time%] Current directory: %CD% >> "%LOG_FILE%"
    exit /b 1
)

REM Call the KB Funds update endpoint using PowerShell
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0sync-kb-funds.ps1" 2>&1 >> "%LOG_FILE%"

if errorlevel 1 (
    echo [%date% %time%] ERROR: KB Funds sync failed with error code %errorlevel% >> "%LOG_FILE%"
    echo [%date% %time%] Check log file: %LOG_FILE% >> "%LOG_FILE%"
    exit /b 1
) else (
    echo [%date% %time%] KB Funds sync completed successfully >> "%LOG_FILE%"
)

