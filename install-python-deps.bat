@echo off
REM Install Python dependencies for KB Funds scraper

echo Installing Python dependencies for KB Funds scraper...
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH!
    echo.
    echo Please:
    echo 1. Install Python from https://www.python.org/downloads/
    echo 2. Make sure to check "Add Python to PATH" during installation
    echo 3. Restart your computer after installation
    echo 4. Run this script again
    pause
    exit /b 1
)

echo Python is installed. Installing dependencies...
echo.

echo Installing selenium...
pip install selenium
if errorlevel 1 (
    echo ERROR: Failed to install selenium
    echo Try: python -m pip install selenium
    pause
    exit /b 1
)

echo.
echo Installing webdriver-manager...
pip install webdriver-manager
if errorlevel 1 (
    echo ERROR: Failed to install webdriver-manager
    echo Try: python -m pip install webdriver-manager
    pause
    exit /b 1
)

echo.
echo ========================================
echo Dependencies installed successfully!
echo ========================================
echo.
echo You can now test the scraper with: test-kb-scraper.bat
echo.
pause


