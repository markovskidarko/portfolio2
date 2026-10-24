# PowerShell script to set up Windows Task Scheduler for auto-starting Next.js server
# Run this script as Administrator

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$batFilePath = Join-Path $scriptPath "start-server.bat"
$taskName = "PortfolioTracker-AutoStart"

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "This script requires Administrator privileges." -ForegroundColor Red
    Write-Host "Please right-click and select 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

# Check if task already exists
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Host "Task '$taskName' already exists. Removing it first..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Create the scheduled task
Write-Host "Creating scheduled task '$taskName'..." -ForegroundColor Green

$action = New-ScheduledTaskAction -Execute $batFilePath -WorkingDirectory $scriptPath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Auto-start Portfolio Tracker Next.js server on login"

Write-Host "Task created successfully!" -ForegroundColor Green
Write-Host "The server will now start automatically when you log in." -ForegroundColor Green
Write-Host ""
Write-Host "To remove the auto-start task, run:" -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor Yellow

pause


