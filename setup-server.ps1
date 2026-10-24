# =====================================================================
#  Portfolio server setup for Windows 11
#  - Starts your app at boot (and restarts it if it stops)
#  - Signs you in automatically (via Sysinternals Autologon)
#  - Opens Chrome on the app after sign-in
#  - Keeps Chrome Remote Desktop running
#  - Keeps the laptop awake and stops surprise update restarts
#
#  Run from an ADMIN PowerShell:
#     powershell -ExecutionPolicy Bypass -File .\setup-server.ps1
# =====================================================================
#Requires -RunAsAdministrator

# ======== EDIT THESE THREE LINES ========
$AppDir       = 'C:\Users\marko\Portfolio2'   # folder of your app
$StartCommand = 'npm run dev'                      # command you normally type to start it
$AppUrl       = 'http://localhost:3000'
# ========================================

$ErrorActionPreference = 'Stop'
$User = $env:USERNAME
$Base = 'C:\ServerSetup'
New-Item $Base -ItemType Directory -Force | Out-Null

if (-not (Test-Path $AppDir)) { throw "App folder not found: $AppDir  -> edit `$AppDir at the top of this script." }

# ---------------------------------------------------------------------
Write-Host "`n[1/6] App auto-start at boot" -ForegroundColor Cyan
# ---------------------------------------------------------------------
$runner = Join-Path $Base 'run-app.cmd'
@"
@echo off
cd /d "$AppDir"
:loop
echo [%date% %time%] starting app >> "$Base\app.log"
call $StartCommand >> "$Base\app.log" 2>&1
echo [%date% %time%] app stopped - restarting in 10s >> "$Base\app.log"
timeout /t 10 /nobreak > nul
goto loop
"@ | Set-Content $runner -Encoding ASCII

$cred = Get-Credential -UserName "$env:COMPUTERNAME\$User" `
        -Message 'Enter your Windows sign-in password (lets the app start at boot before anyone signs in)'

$action   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`""
$trigger  = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'PortfolioApp' -Action $action -Trigger $trigger -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
Write-Host "  Task 'PortfolioApp' created. Log: $Base\app.log"

# ---------------------------------------------------------------------
Write-Host "`n[2/6] Chrome opens the app after sign-in" -ForegroundColor Cyan
# ---------------------------------------------------------------------
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome not found.' }

$launcher = Join-Path $Base 'open-chrome.ps1'
@"
# Wait up to 5 minutes for the app to answer, then open Chrome on it
for (`$i = 0; `$i -lt 60; `$i++) {
  try { Invoke-WebRequest '$AppUrl' -UseBasicParsing -TimeoutSec 3 | Out-Null; break }
  catch { Start-Sleep -Seconds 5 }
}
Start-Process '$chrome' '--new-window --start-maximized --no-first-run $AppUrl'
"@ | Set-Content $launcher -Encoding UTF8

$a = New-ScheduledTaskAction -Execute 'powershell.exe' `
     -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$t = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$User"
$p = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$User" -LogonType Interactive
Register-ScheduledTask -TaskName 'PortfolioChrome' -Action $a -Trigger $t -Principal $p -Force | Out-Null
Write-Host "  Task 'PortfolioChrome' created."

# ---------------------------------------------------------------------
Write-Host "`n[3/6] Chrome Remote Desktop service" -ForegroundColor Cyan
# ---------------------------------------------------------------------
$crd = Get-Service chromoting -ErrorAction SilentlyContinue
if ($crd) {
  Set-Service chromoting -StartupType Automatic
  sc.exe failure chromoting reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
  if ($crd.Status -ne 'Running') { Start-Service chromoting }
  Write-Host '  Set to start automatically and restart if it fails.'
} else {
  Write-Warning '  Chrome Remote Desktop host service not found - reinstall it from remotedesktop.google.com/access'
}

# ---------------------------------------------------------------------
Write-Host "`n[4/6] Keep awake, screen on, no lock" -ForegroundColor Cyan
# ---------------------------------------------------------------------
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0   # closing lid = do nothing
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0    # no password on wake
powercfg /setactive SCHEME_CURRENT
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f | Out-Null  # Fast Startup off
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f | Out-Null
Write-Host '  Done (applies when plugged in).'

# ---------------------------------------------------------------------
Write-Host "`n[5/6] Windows Update: no automatic restarts" -ForegroundColor Cyan
# ---------------------------------------------------------------------
$wu = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
New-Item -Path $wu -Force | Out-Null
Set-ItemProperty $wu NoAutoRebootWithLoggedOnUsers 1 -Type DWord
Set-ItemProperty $wu AUOptions 3 -Type DWord
gpupdate /force | Out-Null
Write-Host '  Updates download, but you choose when to install/restart.'

# ---------------------------------------------------------------------
Write-Host "`n[6/6] Automatic sign-in" -ForegroundColor Cyan
# ---------------------------------------------------------------------
# Windows 11 hides password sign-in for Microsoft accounts; re-enable so Autologon works
$pl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device'
if (Test-Path $pl) { Set-ItemProperty $pl DevicePasswordLessBuildVersion 0 -Type DWord }

$auto = Join-Path $Base 'Autologon64.exe'
Invoke-WebRequest 'https://live.sysinternals.com/Autologon64.exe' -OutFile $auto -UseBasicParsing
Start-Process $auto -ArgumentList '/accepteula'
Write-Host '  Autologon window opened: enter your password and click Enable.'

Write-Host "`nAll set. Restart the laptop to test: it should sign in, start the app, and open Chrome on $AppUrl." -ForegroundColor Green
