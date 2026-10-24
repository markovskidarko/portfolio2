# Troubleshooting: Tasks Not Showing in Task Scheduler

If you don't see the tasks in Task Scheduler, follow these steps:

## Step 1: Run Diagnostic Script

1. **Open PowerShell as Administrator** (right-click → Run as Administrator)

2. **Navigate to your project:**
   ```powershell
   cd C:\Users\marko\Portfolio2
   ```

3. **Run the diagnostic script:**
   ```powershell
   .\check-sync-tasks.ps1
   ```

This will:
- Check if tasks exist
- Show you what's wrong
- Offer to create them if missing

## Step 2: Check Task Scheduler Location

Tasks might be in a different location. In Task Scheduler:

1. **Look in "Task Scheduler Library"** (left panel)
2. **Scroll down** - tasks are alphabetical
3. **Search for "PortfolioTracker"** using Ctrl+F
4. **Check "Active Tasks"** tab at the bottom

## Step 3: Manual Creation (If Diagnostic Doesn't Work)

If the diagnostic script doesn't work, create tasks manually:

### Create Stock Market Sync Task:

1. Open **Task Scheduler**
2. Click **"Create Basic Task"** (right panel)
3. **Name:** `PortfolioTracker-SyncStockMarket-Hourly`
4. **Description:** `Sync Stock Market portfolios every hour`
5. **Trigger:** 
   - Select **"Daily"**
   - Set start time to **now**
   - Check **"Repeat task every"** → **1 hour**
   - Set **"for a duration of"** → **Indefinitely**
6. **Action:**
   - Select **"Start a program"**
   - **Program/script:** `C:\Users\marko\Portfolio2\sync-stock-market.bat`
   - **Start in:** `C:\Users\marko\Portfolio2`
7. **Finish** and check **"Open the Properties dialog"**
8. In **Properties:**
   - **General tab:** Check **"Run whether user is logged on or not"** (or keep "Run only when user is logged on")
   - **General tab:** Check **"Run with highest privileges"**
   - **Settings tab:** Check **"Allow task to be run on demand"**
   - **Settings tab:** Check **"Run task as soon as possible after a scheduled start is missed"**

### Create KB Funds Sync Task:

Repeat the same steps with:
- **Name:** `PortfolioTracker-SyncKBFunds-Hourly`
- **Program/script:** `C:\Users\marko\Portfolio2\sync-kb-funds.bat`

## Step 4: Verify Scripts Exist

Make sure these files exist in your project folder:

```powershell
cd C:\Users\marko\Portfolio2
ls sync-*.bat
ls sync-*.ps1
```

You should see:
- `sync-stock-market.bat`
- `sync-kb-funds.bat`
- `sync-stock-market.ps1`
- `sync-kb-funds.ps1`

## Step 5: Test Scripts Manually

Before scheduling, test that the scripts work:

```powershell
# Test Stock Market sync
.\sync-stock-market.bat

# Test KB Funds sync
.\sync-kb-funds.bat
```

Make sure your Next.js server is running at `http://localhost:3000` when testing.

## Common Issues

### Issue: "Access Denied" Error

**Solution:** Make sure you're running PowerShell as Administrator

### Issue: Tasks Created But Not Running

**Check:**
1. Open Task Scheduler
2. Find your task
3. Right-click → **Properties**
4. **General tab:** Make sure "Run whether user is logged on or not" is checked OR "Run only when user is logged on" is checked (depending on your preference)
5. **Triggers tab:** Verify the trigger is set to repeat every hour

### Issue: Scripts Run But Server Not Responding

**Check:**
1. Is your Next.js server running?
2. Test manually: Open browser to `http://localhost:3000/api/sync` (should show an error about POST method, but confirms server is running)
3. Check server console for errors

### Issue: Can't Find Tasks in Task Scheduler

**Try:**
1. In Task Scheduler, click **"View"** menu
2. Check **"Show Hidden Tasks"**
3. Use **Ctrl+F** to search for "PortfolioTracker"
4. Check **"Active Tasks"** tab at the bottom

## Quick Fix: Re-run Setup Script

If nothing works, try running the setup script again with verbose output:

```powershell
cd C:\Users\marko\Portfolio2
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\setup-hourly-sync.ps1
```

Watch for any error messages and share them if you need help.

## Still Not Working?

If tasks still don't appear:

1. **Check Windows Event Viewer:**
   - Press `Windows Key + X`
   - Select **"Event Viewer"**
   - Go to **Windows Logs** → **Application**
   - Look for errors related to Task Scheduler

2. **Try creating a simple test task:**
   - In Task Scheduler, create a basic task that runs `notepad.exe`
   - If that works, the issue is with the script paths
   - If that doesn't work, there's a system-level issue

3. **Check file paths:**
   - Make sure all batch files are in `C:\Users\marko\Portfolio2`
   - Paths in Task Scheduler must be exact (no typos)


