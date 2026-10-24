@echo off
REM Sync Stock Market portfolios every hour with server check
REM This version ensures the server is running before attempting sync

cd /d "%~dp0"

REM Create logs directory if it doesn't exist
if not exist "logs" mkdir logs

REM Set log file with timestamp
set LOG_FILE=logs\stock-market-sync-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%.log
set LOG_FILE=%LOG_FILE: =0%

REM Get the server URL (default to localhost:3000)
set SERVER_URL=http://localhost:3000

REM Log start
echo [%date% %time%] ======================================== >> "%LOG_FILE%"
echo [%date% %time%] Starting Stock Market sync with server check... >> "%LOG_FILE%"
echo [%date% %time%] Server URL: %SERVER_URL% >> "%LOG_FILE%"
echo [%date% %time%] Working Directory: %CD% >> "%LOG_FILE%"

REM Check if server is running
echo [%date% %time%] Checking if server is running... >> "%LOG_FILE%"
powershell -Command "try { $response = Invoke-WebRequest -Uri '%SERVER_URL%/api/health' -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; Write-Output 'Server is running' } catch { Write-Output 'Server is NOT running' }" >> "%LOG_FILE%" 2>&1

REM Try to start server if not running
powershell -Command "try { $response = Invoke-WebRequest -Uri '%SERVER_URL%/api/health' -Method GET -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; exit 0 } catch { exit 1 }"

if errorlevel 1 (
    echo [%date% %time%] Server is not running. Attempting to start it... >> "%LOG_FILE%"
    
    REM Check if start-server-with-check.bat exists
    if exist "start-server-with-check.bat" (
        call start-server-with-check.bat >> "%LOG_FILE%" 2>&1
        
        REM Wait a bit for server to start
        timeout /t 15 /nobreak >nul
        
        REM Check again
        powershell -Command "try { $response = Invoke-WebRequest -Uri '%SERVER_URL%/api/health' -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; exit 0 } catch { exit 1 }"
        
        if errorlevel 1 (
            echo [%date% %time%] ERROR: Server failed to start. Sync cannot proceed. >> "%LOG_FILE%"
            echo [%date% %time%] Please ensure the server is running manually: npm start >> "%LOG_FILE%"
            exit /b 1
        ) else (
            echo [%date% %time%] Server started successfully, proceeding with sync... >> "%LOG_FILE%"
        )
    ) else (
        echo [%date% %time%] ERROR: Server is not running and start-server-with-check.bat not found. >> "%LOG_FILE%"
        echo [%date% %time%] Please start the server manually: npm start >> "%LOG_FILE%"
        exit /b 1
    )
) else (
    echo [%date% %time%] Server is running, proceeding with sync... >> "%LOG_FILE%"
)

REM Check if PowerShell script exists
if not exist "sync-stock-market.ps1" (
    echo [%date% %time%] ERROR: sync-stock-market.ps1 not found! >> "%LOG_FILE%"
    echo [%date% %time%] Current directory: %CD% >> "%LOG_FILE%"
    exit /b 1
)

REM Call the sync endpoint using PowerShell
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0sync-stock-market.ps1" 2>&1 >> "%LOG_FILE%"

if errorlevel 1 (
    echo [%date% %time%] ERROR: Stock Market sync failed with error code %errorlevel% >> "%LOG_FILE%"
    echo [%date% %time%] Check log file: %LOG_FILE% >> "%LOG_FILE%"
    exit /b 1
) else (
    echo [%date% %time%] Stock Market sync completed successfully >> "%LOG_FILE%"
)


