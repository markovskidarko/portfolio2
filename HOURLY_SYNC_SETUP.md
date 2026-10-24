# Hourly Sync Setup Guide

This guide explains how to set up automatic hourly synchronization for:
1. **Stock Market** portfolios (via `/api/sync`)
2. **KB Funds** (via `/api/kb-funds/update`)

## Quick Setup (Recommended)

### Step 1: Run the Setup Script

1. **Right-click** on `setup-hourly-sync.ps1` and select **"Run with PowerShell"** or **"Run as Administrator"**
   - If you get an execution policy error, run PowerShell as Administrator and execute:
     ```powershell
     Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
     ```

2. The script will:
   - Create two scheduled tasks that run every hour
   - Start running immediately
   - Continue running every hour indefinitely

3. **Done!** Your syncs will now run automatically every hour.

## Manual Setup (Alternative)

If you prefer to set up tasks manually:

### Using Task Scheduler:

1. Open **Task Scheduler** (search for it in Windows)

2. Click **"Create Basic Task"** in the right panel

3. **For Stock Market Sync:**
   - Name: `PortfolioTracker-SyncStockMarket-Hourly`
   - Trigger: **Daily** → Set to repeat every **1 hour** for **Indefinitely**
   - Action: **Start a program**
   - Program: `C:\path\to\your\project\sync-stock-market.bat`
   - Start in: `C:\path\to\your\project`

4. **For KB Funds Sync:**
   - Repeat steps 2-3 with:
   - Name: `PortfolioTracker-SyncKBFunds-Hourly`
   - Program: `C:\path\to\your\project\sync-kb-funds.bat`

## Files Created

- `sync-stock-market.bat` - Batch file to sync Stock Market portfolios
- `sync-kb-funds.bat` - Batch file to sync KB Funds
- `sync-stock-market.ps1` - PowerShell alternative for Stock Market sync
- `sync-kb-funds.ps1` - PowerShell alternative for KB Funds sync
- `setup-hourly-sync.ps1` - Setup script to create scheduled tasks

## Verify It's Working

### Check Task Scheduler:

1. Open **Task Scheduler**
2. Look for tasks:
   - `PortfolioTracker-SyncStockMarket-Hourly`
   - `PortfolioTracker-SyncKBFunds-Hourly`
3. Check the **"Last Run Result"** column - should show `0x0` (success)

### Check Server Logs:

- The sync operations will log to your Next.js server console
- Look for messages like:
  - `[SYNC] ===== Step 1: Running Permanent Data Ingestion =====`
  - `[KB Funds Update] Starting KB Funds sync...`

### Test Manually:

You can test the syncs manually by running:
```bash
# Stock Market sync
.\sync-stock-market.bat

# KB Funds sync
.\sync-kb-funds.bat
```

Or using PowerShell:
```powershell
.\sync-stock-market.ps1
.\sync-kb-funds.ps1
```

## Configuration

### Change Server URL:

If your server is not running on `localhost:3000`, edit the batch files:

**In `sync-stock-market.bat` and `sync-kb-funds.bat`:**
```batch
set SERVER_URL=http://your-server:port
```

**Or set environment variable:**
```batch
set SERVER_URL=http://your-server:port
```

### Change Sync Frequency:

To change from hourly to a different interval:

1. Open **Task Scheduler**
2. Find the task (e.g., `PortfolioTracker-SyncStockMarket-Hourly`)
3. Right-click → **Properties**
4. Go to **Triggers** tab
5. Edit the trigger and change the **Repeat task every** setting

## Troubleshooting

### Task Not Running:

1. **Check Task Scheduler History:**
   - Open Task Scheduler
   - Find your task
   - Click on **"History"** tab to see errors

2. **Verify Server is Running:**
   - Make sure your Next.js server is running
   - Test the endpoint manually: `curl http://localhost:3000/api/sync`

3. **Check Permissions:**
   - The task needs to run with your user account
   - Make sure "Run whether user is logged on or not" is NOT checked (use "Run only when user is logged on")

### Sync Failing:

1. **Check Server Logs:**
   - Look at your Next.js server console for error messages

2. **Test Endpoints Manually:**
   ```bash
   curl -X POST http://localhost:3000/api/sync
   curl -X POST http://localhost:3000/api/kb-funds/update
   ```

3. **Check Network:**
   - Ensure the server is accessible
   - Check firewall settings

### Remove Scheduled Tasks:

To remove the hourly sync tasks:

**Using PowerShell (as Administrator):**
```powershell
Unregister-ScheduledTask -TaskName "PortfolioTracker-SyncStockMarket-Hourly" -Confirm:$false
Unregister-ScheduledTask -TaskName "PortfolioTracker-SyncKBFunds-Hourly" -Confirm:$false
```

**Or using Task Scheduler:**
1. Open Task Scheduler
2. Find the task
3. Right-click → **Delete**

## Schedule Details

- **Stock Market Sync**: Runs every hour via `POST /api/sync`
  - Syncs all portfolios from IBKR Flex Query API
  - Updates database with latest NAV and transaction data
  - Takes up to 5 minutes (maxDuration: 300 seconds)

- **KB Funds Sync**: Runs every hour via `POST /api/kb-funds/update`
  - Scrapes KB Funds website for latest prices
  - Updates database with new price data
  - Takes up to 2 minutes (maxDuration: 120 seconds)

## Notes

- Tasks will run even if the laptop is on battery
- Tasks will start when the system is available (not during sleep)
- Each task has a 10-minute execution time limit
- Tasks run in the background and won't show windows
- Logs are written to the server console, not to separate log files


