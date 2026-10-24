# Direct test of KB Funds scraper
# This will show you exactly what Python is outputting

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing KB Funds Scraper Directly" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Python is installed
Write-Host "[1/4] Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✓ Python is installed: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Python is NOT installed!" -ForegroundColor Red
    Write-Host "Please install Python from https://www.python.org/downloads/" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host ""

# Check if dependencies are installed
Write-Host "[2/4] Checking Python dependencies..." -ForegroundColor Yellow
try {
    python -c "import selenium; print('Selenium:', selenium.__version__)" 2>&1 | Out-Null
    Write-Host "✓ Selenium is installed" -ForegroundColor Green
} catch {
    Write-Host "✗ Selenium is NOT installed!" -ForegroundColor Red
    Write-Host "Installing Selenium..." -ForegroundColor Yellow
    pip install selenium webdriver-manager
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
        pause
        exit 1
    }
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
}

Write-Host ""

# Check if script exists
Write-Host "[3/4] Checking scraper script..." -ForegroundColor Yellow
$scriptPath = Join-Path $PSScriptRoot "scripts\kb_funds_scraper.py"
if (Test-Path $scriptPath) {
    Write-Host "✓ Scraper script found: $scriptPath" -ForegroundColor Green
} else {
    Write-Host "✗ Scraper script NOT found!" -ForegroundColor Red
    Write-Host "Expected location: $scriptPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The script should be created automatically when you call the API." -ForegroundColor Yellow
    Write-Host "Let's test by calling the API endpoint instead..." -ForegroundColor Yellow
    Write-Host ""
    
    # Test API endpoint
    try {
        Write-Host "Calling http://localhost:3000/api/kb-funds/scrape..." -ForegroundColor Cyan
        $response = Invoke-WebRequest -Uri "http://localhost:3000/api/kb-funds/scrape" -Method GET -UseBasicParsing -TimeoutSec 120
        Write-Host "Response Status: $($response.StatusCode)" -ForegroundColor Green
        Write-Host "Response Body:" -ForegroundColor Cyan
        $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
    } catch {
        Write-Host "✗ API call failed!" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "Response: $responseBody" -ForegroundColor Yellow
        }
    }
    pause
    exit 0
}

Write-Host ""

# Run the scraper directly
Write-Host "[4/4] Running scraper script..." -ForegroundColor Yellow
Write-Host "NOTE: This will attempt to login to KB Invest website" -ForegroundColor Yellow
Write-Host "Make sure your credentials are set in .env.local or environment variables" -ForegroundColor Yellow
Write-Host ""
Write-Host "Running: python $scriptPath" -ForegroundColor Cyan
Write-Host ""

$env:KB_FUNDS_USERNAME = if ($env:KB_FUNDS_USERNAME) { $env:KB_FUNDS_USERNAME } else { "natmarkovska" }
$env:KB_FUNDS_PASSWORD = if ($env:KB_FUNDS_PASSWORD) { $env:KB_FUNDS_PASSWORD } else { "sofievaMKD42*" }

$process = Start-Process -FilePath "python" -ArgumentList $scriptPath -NoNewWindow -Wait -PassThru -RedirectStandardOutput "scraper-output.txt" -RedirectStandardError "scraper-error.txt"

Write-Host "Exit Code: $($process.ExitCode)" -ForegroundColor $(if ($process.ExitCode -eq 0) { "Green" } else { "Red" })
Write-Host ""

if (Test-Path "scraper-output.txt") {
    Write-Host "=== STDOUT (Output) ===" -ForegroundColor Cyan
    Get-Content "scraper-output.txt"
    Write-Host ""
}

if (Test-Path "scraper-error.txt") {
    $errorContent = Get-Content "scraper-error.txt" -Raw
    if ($errorContent.Trim()) {
        Write-Host "=== STDERR (Errors) ===" -ForegroundColor Red
        Write-Host $errorContent
        Write-Host ""
    }
}

if ($process.ExitCode -eq 0) {
    $output = if (Test-Path "scraper-output.txt") { Get-Content "scraper-output.txt" -Raw } else { "" }
    if ($output.Trim()) {
        Write-Host "✓ Scraper completed successfully!" -ForegroundColor Green
        Write-Host "Output: $output" -ForegroundColor Green
    } else {
        Write-Host "✗ Scraper returned empty output!" -ForegroundColor Red
        Write-Host "This is the same issue you're seeing in the sync." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Possible causes:" -ForegroundColor Yellow
        Write-Host "1. Website structure changed - scraper can't find elements" -ForegroundColor Yellow
        Write-Host "2. Login failed - check credentials" -ForegroundColor Yellow
        Write-Host "3. Chrome/ChromeDriver issue" -ForegroundColor Yellow
        Write-Host "4. Network/timeout issue" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ Scraper failed with exit code $($process.ExitCode)" -ForegroundColor Red
    Write-Host "Check the error output above for details." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Clean up temp files
if (Test-Path "scraper-output.txt") { Remove-Item "scraper-output.txt" }
if (Test-Path "scraper-error.txt") { Remove-Item "scraper-error.txt" }

pause


