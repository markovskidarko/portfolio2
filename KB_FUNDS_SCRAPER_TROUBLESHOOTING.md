# KB Funds Scraper Troubleshooting

## Error: "Invalid output format:"

This error means the Python scraper is returning empty or invalid output. Here's how to fix it:

## Common Causes

### 1. Python Not Installed

**Check:**
```cmd
python --version
```

**Fix:**
- Download and install Python from https://www.python.org/downloads/
- Make sure to check "Add Python to PATH" during installation
- Restart your computer after installation

### 2. Python Dependencies Not Installed

The scraper needs Selenium and ChromeDriver. Install them:

```cmd
pip install selenium webdriver-manager
```

**Or if you have multiple Python versions:**
```cmd
python -m pip install selenium webdriver-manager
```

### 3. Chrome/ChromeDriver Issues

The scraper uses Chrome browser. Make sure:
- Google Chrome is installed
- ChromeDriver will be downloaded automatically by webdriver-manager

**If Chrome is not installed:**
- Download from https://www.google.com/chrome/
- Install it
- Restart your computer

### 4. Website Structure Changed

The KB Invest website might have changed, causing the scraper to fail.

**Check:**
- Visit https://moivlozuvanja.kbinvest.mk/#/login
- See if the login page still works
- Check if the scraper script needs updating

## Quick Diagnostic

Run this to test if Python and dependencies are installed:

```cmd
python -c "from selenium import webdriver; from selenium.webdriver.chrome.service import Service; from webdriver_manager.chrome import ChromeDriverManager; print('All dependencies installed!')"
```

**If you get an error**, install the missing package:
```cmd
pip install selenium webdriver-manager
```

## Test the Scraper Manually

1. **Navigate to your project:**
   ```cmd
   cd C:\Users\marko\Portfolio2
   ```

2. **Check if the Python script exists:**
   ```cmd
   dir scripts\kb_funds_scraper.py
   ```

3. **Run it manually:**
   ```cmd
   python scripts\kb_funds_scraper.py
   ```

4. **Expected output:**
   ```
   DD.MM.YYYY;1234.56
   ```
   (Date and amount separated by semicolon)

5. **If it fails**, you'll see the actual error message

## Check Server Logs

The improved error handling now shows more details. Check your Next.js server console for:
- `[KB Funds Scraper] stdout:` - What Python printed
- `[KB Funds Scraper] stderr:` - Any Python errors
- `[KB Funds Scraper] Python process exited with code:` - Exit code

## Environment Variables

Make sure your KB Funds credentials are set:

**In `.env.local` or environment:**
```
KB_FUNDS_USERNAME=your_username
KB_FUNDS_PASSWORD=your_password
```

**Or the script will use defaults:**
- Username: `natmarkovska`
- Password: `sofievaMKD42*`

## Fix Steps Summary

1. **Install Python** (if not installed)
2. **Install dependencies:**
   ```cmd
   pip install selenium webdriver-manager
   ```
3. **Install Chrome** (if not installed)
4. **Test manually:**
   ```cmd
   python scripts\kb_funds_scraper.py
   ```
5. **Check server logs** for detailed error messages
6. **Verify credentials** in environment variables

## Alternative: Skip KB Funds Sync

If the scraper continues to fail, you can:

1. **Disable the KB Funds sync task** in Task Scheduler
2. **Or comment out the KB Funds sync** in your scheduled tasks
3. **Sync manually** when needed via the dashboard

## Get More Help

If you're still having issues:

1. **Run the scraper manually** and share the output
2. **Check server console** for detailed error messages
3. **Share the full error** from the log file

The improved error handling will now show exactly what Python is outputting, which will help identify the issue.


