# PowerShell script to set up Windows Task Scheduler for hourly sync operations
# Run this script as Administrator

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$stockMarketBat = Join-Path $scriptPath "sync-stock-market.bat"
$kbFundsBat = Join-Path $scriptPath "sync-kb-funds.bat"

$stockMarketTaskName = "PortfolioTracker-SyncStockMarket-Hourly"
$kbFundsTaskName = "PortfolioTracker-SyncKBFunds-Hourly"

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "This script requires Administrator privileges." -ForegroundColor Red
    Write-Host "Please right-click and select 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

# Function to create hourly scheduled task
function Create-HourlyTask {
    param(
        [string]$TaskName,
        [string]$BatFilePath,
        [string]$Description
    )
    
    # Check if task already exists
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    
    if ($existingTask) {
        Write-Host "Task '$TaskName' already exists. Removing it first..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    
    # Create the scheduled task to run every hour
    Write-Host "Creating scheduled task '$TaskName'..." -ForegroundColor Green
    
    $action = New-ScheduledTaskAction -Execute $BatFilePath -WorkingDirectory $scriptPath
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 365)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $Description
    
    Write-Host "Task '$TaskName' created successfully!" -ForegroundColor Green
}

# Create Stock Market sync task
Create-HourlyTask -TaskName $stockMarketTaskName -BatFilePath $stockMarketBat -Description "Sync Stock Market portfolios every hour"

# Create KB Funds sync task
Create-HourlyTask -TaskName $kbFundsTaskName -BatFilePath $kbFundsBat -Description "Sync KB Funds every hour"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Hourly sync tasks created successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Tasks created:" -ForegroundColor Yellow
Write-Host "  1. $stockMarketTaskName" -ForegroundColor Cyan
Write-Host "  2. $kbFundsTaskName" -ForegroundColor Cyan
Write-Host ""
Write-Host "Both tasks will run every hour starting now." -ForegroundColor Green
Write-Host ""
Write-Host "To view tasks in Task Scheduler:" -ForegroundColor Yellow
Write-Host "  - Open Task Scheduler (search in Windows)" -ForegroundColor Yellow
Write-Host "  - Look for tasks starting with 'PortfolioTracker-'" -ForegroundColor Yellow
Write-Host ""
Write-Host "To remove the tasks, run:" -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$stockMarketTaskName' -Confirm:`$false" -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$kbFundsTaskName' -Confirm:`$false" -ForegroundColor Yellow
Write-Host ""

pause


