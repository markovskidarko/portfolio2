# Fix: Server Not Running Error

## The Problem

Your log shows:
```
ERROR: Unable to connect to the remote server
No connection could be made because the target machine actively refused it 127.0.0.1:3000
```

This means **your Next.js server is not running** on port 3000.

## Solution Options

### Option 1: Always Keep Server Running (Recommended)

The server needs to be running 24/7 for the sync tasks to work. You have two choices:

#### A. Use the Auto-Start Script (From Earlier)

If you set up the auto-start script (`start-server.bat`), the server should start automatically when you log in. Make sure it's working:

1. **Check if auto-start task exists:**
   - Open Task Scheduler
   - Look for `PortfolioTracker-AutoStart`
   - Make sure it's enabled

2. **Test it:**
   - Restart your computer
   - After login, check if server is running: Open browser to `http://localhost:3000`

#### B. Start Server Manually Before Sync Tasks Run

1. **Start the server:**
   ```cmd
   cd C:\Users\marko\Portfolio2
   npm start
   ```
   (Or `npm run dev` for development mode)

2. **Keep the window open** - The server must stay running

3. **Verify it's running:**
   - Open browser to `http://localhost:3000`
   - You should see your portfolio dashboard

### Option 2: Use Server-Check Scripts (New!)

I've created new batch files that check if the server is running and start it if needed:

1. **Update your Task Scheduler tasks** to use:
   - `sync-kb-funds-with-server-check.bat` (instead of `sync-kb-funds.bat`)
   - `sync-stock-market-with-server-check.bat` (instead of `sync-stock-market.bat`)

2. **These scripts will:**
   - Check if server is running
   - Start it automatically if not running
   - Then proceed with the sync

**To update your tasks:**

1. Open **Task Scheduler**
2. Find `PortfolioTracker-SyncKBFunds-Hourly`
3. Right-click → **Properties** → **Actions** tab
4. Change **Program/script** to:
   ```
   C:\Users\marko\Portfolio2\sync-kb-funds-with-server-check.bat
   ```
5. Click **OK**
6. Repeat for Stock Market task with `sync-stock-market-with-server-check.bat`

### Option 3: Run Server as Windows Service (Advanced)

For a more robust solution, you can run the server as a Windows service using PM2 or NSSM.

## Quick Fix Right Now

**To fix the immediate issue:**

1. **Start your server:**
   ```cmd
   cd C:\Users\marko\Portfolio2
   npm start
   ```

2. **Keep it running** - Don't close the window

3. **Test the sync manually:**
   ```cmd
   sync-kb-funds.bat
   ```

4. **It should work now!**

## Recommended Setup

For the best experience, I recommend:

1. **Set up auto-start** (from earlier guide) so server starts on login
2. **Use the server-check scripts** so sync tasks can start the server if needed
3. **Keep server running 24/7** for reliable hourly syncs

## Verify Server is Running

**Check if server is running:**

```powershell
# Test if server responds
Invoke-WebRequest -Uri "http://localhost:3000/api/health" -Method GET -UseBasicParsing
```

**Or simply:**
- Open browser to `http://localhost:3000`
- If you see your dashboard, server is running ✅
- If you get "can't reach this page", server is not running ❌

## Check What Port Your Server Uses

If your server runs on a different port (not 3000):

1. **Check your `package.json`:**
   ```json
   "scripts": {
     "start": "next start -p 3001"  // <-- Check this
   }
   ```

2. **Update the batch files:**
   - Edit `sync-kb-funds.bat`
   - Change: `set SERVER_URL=http://localhost:3000`
   - To: `set SERVER_URL=http://localhost:YOUR_PORT`

3. **Or set environment variable:**
   ```cmd
   set SERVER_URL=http://localhost:YOUR_PORT
   ```

## Summary

**The issue:** Server is not running on port 3000

**The fix:** 
1. Start the server: `npm start`
2. Keep it running
3. Or use the new server-check scripts that start it automatically

**Best practice:** Set up auto-start so server always runs when you log in.


