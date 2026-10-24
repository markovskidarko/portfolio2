@echo off
REM Simple batch file to add server to Windows Startup folder
REM This is the easiest method but less reliable than Task Scheduler

echo Setting up auto-start via Startup folder...

REM Get the path to the Startup folder
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

REM Create a shortcut to the start-server.bat file
set "SCRIPT_PATH=%~dp0start-server.bat"
set "SHORTCUT_NAME=Portfolio Tracker Server.lnk"

REM Use PowerShell to create the shortcut
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_FOLDER%\%SHORTCUT_NAME%'); $Shortcut.TargetPath = '%SCRIPT_PATH%'; $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.Save()"

echo.
echo Shortcut created in Startup folder!
echo The server will start automatically when you log in.
echo.
echo To remove auto-start, delete the shortcut from:
echo %STARTUP_FOLDER%
echo.
pause


