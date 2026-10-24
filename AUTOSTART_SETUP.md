# Auto-Start Server Setup Guide

This guide explains how to set up your Next.js Portfolio Tracker server to automatically start when your Windows laptop restarts or when you log in.

## Method 1: Windows Task Scheduler (Recommended)

This is the most reliable method and gives you more control.

### Steps:

1. **Right-click** on `setup-autostart.ps1` and select **"Run with PowerShell"** or **"Run as Administrator"**
   - If you get an execution policy error, run PowerShell as Administrator and execute:
     ```powershell
     Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
     ```

2. The script will:
   - Create a scheduled task that runs on login
   - Use the `start-server.bat` file to start your server
   - Set appropriate permissions

3. **To verify it's set up:**
   - Open Task Scheduler (search for "Task Scheduler" in Windows)
   - Look for a task named "PortfolioTracker-AutoStart"

4. **To remove auto-start:**
   ```powershell
   Unregister-ScheduledTask -TaskName "PortfolioTracker-AutoStart" -Confirm:$false
   ```

## Method 2: Startup Folder (Simple)

This is the easiest method but less reliable.

### Steps:

1. **Double-click** `setup-autostart-simple.bat`
   - This will create a shortcut in your Windows Startup folder

2. The server will start automatically when you log in

3. **To remove auto-start:**
   - Press `Win + R`, type `shell:startup`, press Enter
   - Delete the "Portfolio Tracker Server" shortcut

## Method 3: Using PM2 (Advanced - For Production)

PM2 is a process manager that can keep your server running and auto-restart it.

### Installation:

1. Install PM2 globally:
   ```bash
   npm install -g pm2
   ```

2. Install PM2 Windows startup:
   ```bash
   pm2 startup
   ```
   - This will generate a command - copy and run it in an Administrator PowerShell

3. Start your server with PM2:
   ```bash
   pm2 start npm --name "portfolio-tracker" -- start
   ```

4. Save the PM2 process list:
   ```bash
   pm2 save
   ```

5. **To stop/restart:**
   ```bash
   pm2 stop portfolio-tracker
   pm2 restart portfolio-tracker
   pm2 delete portfolio-tracker  # Remove from auto-start
   ```

## Which Method Should I Use?

- **Method 1 (Task Scheduler)**: Best for most users - reliable and easy to manage
- **Method 2 (Startup Folder)**: Simplest but may not work if Windows is slow to start
- **Method 3 (PM2)**: Best for production servers - includes auto-restart on crashes

## Important Notes

1. **Build your app first** (if using production mode):
   ```bash
   npm run build
   ```

2. **For development mode**, use `start-server-dev.bat` instead of `start-server.bat`

3. **Check the server is running** by opening:
   - http://localhost:3000 (default Next.js port)

4. **If the server doesn't start**, check:
   - Node.js is installed and in PATH
   - Port 3000 is not already in use
   - Dependencies are installed (`npm install`)

## Troubleshooting

### Server doesn't start on login:
- Check Task Scheduler for errors
- Verify the path in the batch file is correct
- Check Windows Event Viewer for errors

### Port already in use:
- Change the port in `package.json` scripts:
  ```json
  "start": "next start -p 3001"
  ```

### Need to see server logs:
- The server will run in the background
- For PM2: `pm2 logs portfolio-tracker`
- For Task Scheduler: Check the task's history in Task Scheduler


