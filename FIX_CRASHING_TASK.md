# Fix: Task Crashing in Task Scheduler

If your sync task is crashing, follow these steps:

## What I Fixed

I've updated the batch files to:
1. ✅ **Create log files** - All output goes to `logs/` folder so you can see what's wrong
2. ✅ **Better error handling** - More detailed error messages
3. ✅ **Check if server is running** - Tests connection before trying sync
4. ✅ **Better path handling** - Ensures correct working directory

## Step 1: Update Your Task in Task Scheduler

Since the batch files are now improved, you need to update your task:

1. **Open Task Scheduler**
2. **Find your task:** `PortfolioTracker-SyncKBFunds-Hourly`
3. **Right-click** → **Properties**
4. **Actions tab:**
   - **Program/script:** `C:\Users\marko\Portfolio2\sync-kb-funds.bat`
   - **Start in:** `C:\Users\marko\Portfolio2`
   - Make sure paths are **exact** (no quotes needed)
5. **General tab:**
   - Check **"Run whether user is logged on or not"** OR **"Run only when user is logged on"** (your choice)
   - Check **"Run with highest privileges"**
6. **Settings tab:**
   - Check **"Allow task to be run on demand"**
   - Check **"Run task as soon as possible after a scheduled start is missed"**
   - **If the running task does not end when requested, force it to stop:** Check this
7. Click **OK**

## Step 2: Check the Log Files

After the task runs (or crashes), check the log files:

1. **Navigate to:** `C:\Users\marko\Portfolio2\logs\`
2. **Look for files like:**
   - `kb-funds-sync-20241215-143022.log`
   - `stock-market-sync-20241215-143022.log`

3. **Open the log file** - it will show you exactly what went wrong

## Step 3: Common Issues and Fixes

### Issue: "Server is not reachable"

**Problem:** Your Next.js server isn't running

**Fix:**
1. Make sure your server is running: `npm start` or `npm run dev`
2. Test manually: Open browser to `http://localhost:3000`
3. If server is on different port, edit the batch file:
   ```batch
   set SERVER_URL=http://localhost:YOUR_PORT
   ```

### Issue: "sync-kb-funds.ps1 not found"

**Problem:** Task can't find the PowerShell script

**Fix:**
1. Make sure all files are in `C:\Users\marko\Portfolio2\`
2. Check that these files exist:
   - `sync-kb-funds.bat`
   - `sync-kb-funds.ps1`
   - `sync-stock-market.bat`
   - `sync-stock-market.ps1`

### Issue: "Access Denied" or "Permission Error"

**Problem:** Task doesn't have permissions

**Fix:**
1. In Task Scheduler, task Properties → **General tab**
2. Check **"Run with highest privileges"**
3. Make sure **"Run whether user is logged on or not"** is checked

### Issue: Task runs but nothing happens

**Problem:** Server might be running but endpoint fails

**Fix:**
1. Check the log file for detailed error messages
2. Test the endpoint manually:
   ```powershell
   Invoke-WebRequest -Uri "http://localhost:3000/api/kb-funds/update" -Method POST
   ```

## Step 4: Test the Script Manually

Before relying on Task Scheduler, test the script manually:

1. **Open Command Prompt or PowerShell**
2. **Navigate to project:**
   ```cmd
   cd C:\Users\marko\Portfolio2
   ```
3. **Run the batch file:**
   ```cmd
   sync-kb-funds.bat
   ```
4. **Check the output** - it should show what's happening
5. **Check the log file** in `logs/` folder

## Step 5: View Logs in Real-Time

To see what's happening when the task runs:

1. **Open Task Scheduler**
2. **Find your task**
3. **Right-click** → **Run**
4. **Immediately check** the `logs/` folder for the new log file
5. **Open the log file** to see what happened

## Quick Diagnostic

Run this to see what's wrong:

```powershell
cd C:\Users\marko\Portfolio2
.\sync-kb-funds.bat
```

Then check:
```powershell
Get-ChildItem logs\ | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content
```

This will show you the latest log file contents.

## Still Crashing?

If it's still crashing after these fixes:

1. **Share the log file contents** - The log will tell us exactly what's wrong
2. **Check Task Scheduler History:**
   - Open Task Scheduler
   - Find your task
   - Click **"History"** tab
   - Look for error events (red X icon)
   - Double-click to see details

3. **Verify server is running:**
   ```powershell
   Test-NetConnection -ComputerName localhost -Port 3000
   ```

4. **Test endpoint manually:**
   ```powershell
   Invoke-WebRequest -Uri "http://localhost:3000/api/kb-funds/update" -Method POST -ContentType "application/json"
   ```

## What the Logs Will Show

The improved scripts now log:
- ✅ Timestamp of each step
- ✅ Server URL being used
- ✅ Working directory
- ✅ Whether server is reachable
- ✅ Full error messages with details
- ✅ HTTP status codes
- ✅ Response content

This will help us identify exactly what's going wrong!


