@echo off
REM Start Next.js server with port check
REM This ensures the server is running before sync tasks run

cd /d "%~dp0"

REM Check if server is already running on port 3000
echo Checking if server is running on port 3000...
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -Method GET -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; Write-Host 'Server is already running!'; exit 0 } catch { Write-Host 'Server is not running, starting it...'; exit 1 }"

if errorlevel 1 (
    echo Server not running, starting it now...
    
    REM Check if node_modules exists
    if not exist "node_modules" (
        echo Installing dependencies...
        call npm install
    )
    
    REM Check if .next build exists, if not build it
    if not exist ".next" (
        echo Building Next.js application...
        call npm run build
    )
    
    REM Start the server in a new window
    echo Starting Next.js server...
    start "Next.js Server" cmd /k "npm start"
    
    REM Wait a bit for server to start
    echo Waiting for server to start...
    timeout /t 10 /nobreak >nul
    
    REM Check if server started successfully
    powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop; Write-Host 'Server started successfully!'; exit 0 } catch { Write-Host 'Server failed to start!'; exit 1 }"
    
    if errorlevel 1 (
        echo ERROR: Server failed to start. Please start it manually.
        exit /b 1
    )
) else (
    echo Server is already running, no action needed.
)


