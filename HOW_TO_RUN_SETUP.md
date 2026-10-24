# How to Run the Hourly Sync Setup Script

## Method 1: Using PowerShell (Recommended)

### Step-by-Step Instructions:

1. **Open PowerShell as Administrator:**
   - Press `Windows Key`
   - Type `PowerShell`
   - Right-click on **"Windows PowerShell"**
   - Select **"Run as Administrator"**
   - Click **"Yes"** when prompted by User Account Control

2. **Navigate to your project folder:**
   ```powershell
   cd C:\Users\marko\Portfolio2
   ```
   (Replace with your actual project path if different)

3. **Check if the script exists:**
   ```powershell
   ls setup-hourly-sync.ps1
   ```
   (Should show the file if it exists)

4. **Set execution policy (if needed):**
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
   - Type `Y` and press Enter when prompted

5. **Run the setup script:**
   ```powershell
   .\setup-hourly-sync.ps1
   ```
   (The `.\` is important - it tells PowerShell to run the script in the current directory)

6. **Wait for completion:**
   - You should see messages like:
     - "Creating scheduled task 'PortfolioTracker-SyncStockMarket-Hourly'..."
     - "Task 'PortfolioTracker-SyncStockMarket-Hourly' created successfully!"
     - "Hourly sync tasks created successfully!"

7. **Press any key to close** when it says "Press any key to continue..."

## Method 2: Right-Click Method (Easier)

1. **Open File Explorer** and navigate to your project folder:
   - `C:\Users\marko\Portfolio2`

2. **Find the file:** `setup-hourly-sync.ps1`

3. **Right-click** on `setup-hourly-sync.ps1`

4. **Select:** "Run with PowerShell" or "Run with PowerShell (as Administrator)"

5. **If you get an error** about execution policy:
   - Open PowerShell as Administrator (Method 1, Step 1)
   - Run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
   - Type `Y` and press Enter
   - Try the right-click method again

## Method 3: Using Command Prompt

1. **Open Command Prompt as Administrator:**
   - Press `Windows Key`
   - Type `cmd`
   - Right-click on **"Command Prompt"**
   - Select **"Run as Administrator"**

2. **Navigate to your project:**
   ```cmd
   cd C:\Users\marko\Portfolio2
   ```

3. **Run PowerShell from Command Prompt:**
   ```cmd
   powershell -ExecutionPolicy Bypass -File setup-hourly-sync.ps1
   ```

## Troubleshooting

### Error: "Cannot be loaded because running scripts is disabled"

**Solution:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
Type `Y` and press Enter.

### Error: "File cannot be loaded because the execution of scripts is disabled on this system"

**Solution:**
Run this in PowerShell as Administrator:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine
```
Type `Y` and press Enter.

### Error: "The term 'setup-hourly-sync.ps1' is not recognized"

**Solution:**
Make sure you're in the correct directory:
```powershell
# Check current directory
pwd

# Navigate to project folder
cd C:\Users\marko\Portfolio2

# List files to verify script exists
ls *.ps1
```

### Script runs but tasks aren't created

**Check:**
1. Make sure you ran PowerShell as **Administrator**
2. Check Task Scheduler manually:
   - Press `Windows Key`, type "Task Scheduler"
   - Look for tasks starting with "PortfolioTracker-"

## Verify It Worked

After running the script:

1. **Open Task Scheduler:**
   - Press `Windows Key`
   - Type "Task Scheduler"
   - Press Enter

2. **Look for these tasks:**
   - `PortfolioTracker-SyncStockMarket-Hourly`
   - `PortfolioTracker-SyncKBFunds-Hourly`

3. **Check task properties:**
   - Right-click on a task → Properties
   - Go to "Triggers" tab
   - Should show "Daily" trigger with "Repeat task every: 1 hour"

## Quick Copy-Paste Commands

If you're in PowerShell as Administrator, you can copy and paste these commands one by one:

```powershell
# Navigate to project
cd C:\Users\marko\Portfolio2

# Set execution policy (if needed)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Run the setup script
.\setup-hourly-sync.ps1
```

## What Happens After Setup

Once the script completes successfully:

- ✅ Two scheduled tasks are created
- ✅ Tasks will run every hour automatically
- ✅ First run happens immediately
- ✅ Tasks run in the background (no windows pop up)
- ✅ Logs appear in your Next.js server console

## Need Help?

If you're still having issues:

1. **Check the error message** - copy it exactly
2. **Verify you're in the right folder** - run `pwd` in PowerShell
3. **Check file exists** - run `ls setup-hourly-sync.ps1`
4. **Try running with full path:**
   ```powershell
   & "C:\Users\marko\Portfolio2\setup-hourly-sync.ps1"
   ```


