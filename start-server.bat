@echo off
REM Start Next.js server on Windows
REM This script assumes the project is already built

cd /d "%~dp0"

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

REM Start the server
echo Starting Next.js server...
call npm start


