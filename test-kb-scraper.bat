@echo off
REM Test KB Funds Python scraper
REM This will help diagnose why the scraper is failing

cd /d "%~dp0"

echo ========================================
echo KB Funds Scraper Diagnostic Test
echo ========================================
echo.

echo [1/5] Checking if Python is installed...
python --version
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH!
    echo Please install Python from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)
echo OK: Python is installed
echo.

echo [2/5] Checking if Selenium is installed...
python -c "import selenium; print('Selenium version:', selenium.__version__)" 2>nul
if errorlevel 1 (
    echo WARNING: Selenium is not installed!
    echo Installing Selenium...
    pip install selenium webdriver-manager
    if errorlevel 1 (
        echo ERROR: Failed to install Selenium
        echo Please run manually: pip install selenium webdriver-manager
        pause
        exit /b 1
    )
) else (
    echo OK: Selenium is installed
)
echo.

echo [3/5] Checking if webdriver-manager is installed...
python -c "import webdriver_manager; print('webdriver-manager is installed')" 2>nul
if errorlevel 1 (
    echo WARNING: webdriver-manager is not installed!
    echo Installing webdriver-manager...
    pip install webdriver-manager
    if errorlevel 1 (
        echo ERROR: Failed to install webdriver-manager
        echo Please run manually: pip install webdriver-manager
        pause
        exit /b 1
    )
) else (
    echo OK: webdriver-manager is installed
)
echo.

echo [4/5] Checking if Chrome is installed...
reg query "HKEY_CURRENT_USER\Software\Google\Chrome\BLBeacon" /v version >nul 2>&1
if errorlevel 1 (
    reg query "HKEY_LOCAL_MACHINE\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Google Chrome" >nul 2>&1
    if errorlevel 1 (
        echo WARNING: Chrome might not be installed!
        echo The scraper needs Google Chrome to work.
        echo Download from: https://www.google.com/chrome/
    ) else (
        echo OK: Chrome is installed (detected in registry)
    )
) else (
    echo OK: Chrome is installed
)
echo.

echo [5/5] Testing the scraper script...
if not exist "scripts\kb_funds_scraper.py" (
    echo ERROR: Scraper script not found at scripts\kb_funds_scraper.py
    echo The script should be created automatically when you call the API.
    echo.
    echo Testing by calling the API endpoint instead...
    echo.
    echo Make sure your Next.js server is running, then press any key to test...
    pause
    powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/kb-funds/scrape' -Method GET -UseBasicParsing; Write-Host 'Response:'; $response.Content } catch { Write-Host 'Error:' $_.Exception.Message }"
) else (
    echo Running scraper script directly...
    echo.
    echo NOTE: This will try to login to KB Invest website.
    echo Make sure your credentials are set in environment variables or .env.local
    echo.
    python scripts\kb_funds_scraper.py
    if errorlevel 1 (
        echo.
        echo ERROR: Scraper script failed!
        echo Check the error message above.
    ) else (
        echo.
        echo SUCCESS: Scraper script ran without errors!
        echo Check the output above for the result.
    )
)
echo.
echo ========================================
echo Diagnostic complete!
echo ========================================
pause


