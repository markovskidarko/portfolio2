@echo off
REM Start Next.js development server on Windows
REM This script will run the dev server

cd /d "%~dp0"

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

REM Start the development server
echo Starting Next.js development server...
call npm run dev


