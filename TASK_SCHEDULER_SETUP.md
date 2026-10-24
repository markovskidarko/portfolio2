# Task Scheduler Setup - Exact Configuration

## KB Funds Sync Task

### Task Settings:

1. **Open Task Scheduler**
   - Press `Windows Key`, type "Task Scheduler", press Enter

2. **Create New Task** (or edit existing `PortfolioTracker-SyncKBFunds-Hourly`)

3. **General Tab:**
   - **Name:** `PortfolioTracker-SyncKBFunds-Hourly`
   - **Description:** `Sync KB Funds prices every hour`
   - ✅ Check **"Run whether user is logged on or not"** OR **"Run only when user is logged on"** (your choice)
   - ✅ Check **"Run with highest privileges"**
   - **Configure for:** Windows 10/11

4. **Triggers Tab:**
   - Click **"New"**
   - **Begin the task:** On a schedule
   - **Settings:**
     - **Daily** (or **One time** - we'll set repetition)
   - **Start:** Today's date, current time (or any time)
   - ✅ Check **"Repeat task every"**
     - **1 hour**
   - **for a duration of:** **Indefinitely**
   - Click **OK**

5. **Actions Tab:**
   - Click **"New"**
   - **Action:** Start a program
   - **Program/script:** 
     ```
     C:\Users\marko\Portfolio2\sync-kb-funds.bat
     ```
     (Use the full path - replace `marko` with your username if different)
   
   - **Add arguments (optional):** (leave empty)
   
   - **Start in (optional):**
     ```
     C:\Users\marko\Portfolio2
     ```
     (This is IMPORTANT - must match your project folder)

6. **Conditions Tab:**
   - ✅ Check **"Start the task only if the computer is on AC power"** (uncheck if you want it to run on battery)
   - ✅ Check **"Wake the computer to run this task"** (optional)
   - ✅ Check **"Start the task only if the following network connection is available"** (uncheck if you want it to run without network)

7. **Settings Tab:**
   - ✅ Check **"Allow task to be run on demand"**
   - ✅ Check **"Run task as soon as possible after a scheduled start is missed"**
   - ✅ Check **"If the running task does not end when requested, force it to stop"**
   - **If the task is already running:** Choose **"Do not start a new instance"** (recommended)

8. **Click OK** to save

## Stock Market Sync Task

Same steps as above, but use:

- **Name:** `PortfolioTracker-SyncStockMarket-Hourly`
- **Program/script:** 
  ```
  C:\Users\marko\Portfolio2\sync-stock-market.bat
  ```
- **Start in:**
  ```
  C:\Users\marko\Portfolio2
  ```

## Quick Setup Using Script

Alternatively, you can use the setup script I created earlier:

1. **Right-click** `setup-hourly-sync.ps1`
2. **Run with PowerShell** (as Administrator)
3. It will create both tasks automatically

## Verify Paths

Before setting up, verify your project path:

1. **Open File Explorer**
2. **Navigate to your project:** `C:\Users\marko\Portfolio2`
3. **Check that these files exist:**
   - `sync-kb-funds.bat`
   - `sync-stock-market.bat`
   - `sync-kb-funds.ps1`
   - `sync-stock-market.ps1`

## Important Notes

- **Replace `marko`** with your actual Windows username if different
- **Use full paths** - don't use relative paths
- **"Start in" must match** your project folder exactly
- **Server must be running** - Make sure your Next.js server is running (or use the `-with-server-check.bat` versions)

## Test Before Scheduling

Test the script manually first:

1. **Open Command Prompt**
2. **Run:**
   ```cmd
   cd C:\Users\marko\Portfolio2
   sync-kb-funds.bat
   ```
3. **Check if it works** - Look for success messages
4. **Then set up the scheduled task**

## Troubleshooting

### Task runs but nothing happens:
- Check the log files in `logs/` folder
- Verify server is running at `http://localhost:3000`
- Check Task Scheduler History tab for errors

### "File not found" error:
- Verify the path in "Program/script" is correct
- Verify "Start in" path is correct
- Use full absolute paths

### Task doesn't run:
- Check Task Scheduler History tab
- Verify trigger is set to repeat every hour
- Check if task is enabled (right-click → Enable)


