# Diagnostic script to check if sync tasks exist and create them if missing
# Run this as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Checking Hourly Sync Tasks" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$stockMarketTaskName = "PortfolioTracker-SyncStockMarket-Hourly"
$kbFundsTaskName = "PortfolioTracker-SyncKBFunds-Hourly"

# Check if tasks exist
$stockMarketTask = Get-ScheduledTask -TaskName $stockMarketTaskName -ErrorAction SilentlyContinue
$kbFundsTask = Get-ScheduledTask -TaskName $kbFundsTaskName -ErrorAction SilentlyContinue

Write-Host "Task Status:" -ForegroundColor Yellow
Write-Host ""

if ($stockMarketTask) {
    Write-Host "✓ $stockMarketTaskName - EXISTS" -ForegroundColor Green
    Write-Host "  Last Run: $($stockMarketTask.State)" -ForegroundColor Gray
} else {
    Write-Host "✗ $stockMarketTaskName - NOT FOUND" -ForegroundColor Red
}

if ($kbFundsTask) {
    Write-Host "✓ $kbFundsTaskName - EXISTS" -ForegroundColor Green
    Write-Host "  Last Run: $($kbFundsTask.State)" -ForegroundColor Gray
} else {
    Write-Host "✗ $kbFundsTaskName - NOT FOUND" -ForegroundColor Red
}

Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠ WARNING: Not running as Administrator!" -ForegroundColor Red
    Write-Host "Tasks can only be created with Administrator privileges." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please:" -ForegroundColor Yellow
    Write-Host "1. Close this window" -ForegroundColor Yellow
    Write-Host "2. Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host "3. Run this script again" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

# If tasks don't exist, offer to create them
if (-not $stockMarketTask -or -not $kbFundsTask) {
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "Tasks Not Found - Would you like to create them now?" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    
    $response = Read-Host "Create missing tasks? (Y/N)"
    
    if ($response -eq 'Y' -or $response -eq 'y') {
        Write-Host ""
        Write-Host "Creating tasks..." -ForegroundColor Cyan
        
        # Check if setup script exists
        $setupScript = Join-Path $PSScriptRoot "setup-hourly-sync.ps1"
        if (Test-Path $setupScript) {
            Write-Host "Running setup script..." -ForegroundColor Cyan
            & $setupScript
        } else {
            Write-Host "Setup script not found. Creating tasks manually..." -ForegroundColor Yellow
            
            $scriptPath = $PSScriptRoot
            $stockMarketBat = Join-Path $scriptPath "sync-stock-market.bat"
            $kbFundsBat = Join-Path $scriptPath "sync-kb-funds.bat"
            
            if (-not (Test-Path $stockMarketBat)) {
                Write-Host "ERROR: sync-stock-market.bat not found!" -ForegroundColor Red
                Write-Host "Expected location: $stockMarketBat" -ForegroundColor Red
                pause
                exit 1
            }
            
            if (-not (Test-Path $kbFundsBat)) {
                Write-Host "ERROR: sync-kb-funds.bat not found!" -ForegroundColor Red
                Write-Host "Expected location: $kbFundsBat" -ForegroundColor Red
                pause
                exit 1
            }
            
            # Create Stock Market task
            if (-not $stockMarketTask) {
                Write-Host "Creating $stockMarketTaskName..." -ForegroundColor Cyan
                $action = New-ScheduledTaskAction -Execute $stockMarketBat -WorkingDirectory $scriptPath
                $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 365)
                $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
                $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
                
                Register-ScheduledTask -TaskName $stockMarketTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Sync Stock Market portfolios every hour" | Out-Null
                Write-Host "✓ Created $stockMarketTaskName" -ForegroundColor Green
            }
            
            # Create KB Funds task
            if (-not $kbFundsTask) {
                Write-Host "Creating $kbFundsTaskName..." -ForegroundColor Cyan
                $action = New-ScheduledTaskAction -Execute $kbFundsBat -WorkingDirectory $scriptPath
                $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 365)
                $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
                $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
                
                Register-ScheduledTask -TaskName $kbFundsTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Sync KB Funds every hour" | Out-Null
                Write-Host "✓ Created $kbFundsTaskName" -ForegroundColor Green
            }
            
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Green
            Write-Host "Tasks Created Successfully!" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Green
        }
    } else {
        Write-Host "Skipping task creation." -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "All tasks exist and are configured!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
}

Write-Host ""
Write-Host "To view tasks in Task Scheduler:" -ForegroundColor Yellow
Write-Host "1. Press Windows Key, type 'Task Scheduler'" -ForegroundColor Yellow
Write-Host "2. In Task Scheduler Library, look for tasks starting with 'PortfolioTracker-'" -ForegroundColor Yellow
Write-Host ""

pause


