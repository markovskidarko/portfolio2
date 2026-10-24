# KB Funds Sync Setup

The KB Funds sync endpoint (`/api/kb-funds/update`) now replicates the exact logic from the "Sync Prices" button in the KB Funds dashboard.

## How It Works

The sync endpoint (`/api/kb-funds/update`) does exactly what the "Sync Prices" button does:

1. **Runs Python Scraper**: Executes `scripts/fetch_kb_funds.py` to fetch KB Funds prices
2. **Processes Results**: Parses the JSON output from the Python script
3. **Updates Database**: Stores all price records in the `KBFundPrices` table
4. **Verifies Success**: Checks that all 3 funds (Stocks, Balanced, Gold) were processed

## Requirements

- **Python** must be installed and in PATH
- **Python dependencies** must be installed:
  ```bash
  pip install selenium webdriver-manager
  ```
- **Google Chrome** must be installed (for Selenium)
- **Python script** must exist at `scripts/fetch_kb_funds.py`

## Testing

Test the sync manually:

```bash
curl -X POST http://localhost:3000/api/kb-funds/update
```

Or use the sync script:
```bash
sync-kb-funds.bat
```

## Troubleshooting

### Error: "Scraper script not found"

Make sure `scripts/fetch_kb_funds.py` exists in your project directory.

### Error: "Scraper failed" or empty output

1. **Check Python is installed:**
   ```bash
   python --version
   ```

2. **Install Python dependencies:**
   ```bash
   pip install selenium webdriver-manager
   ```

3. **Verify Chrome is installed** (required for Selenium)

4. **Test the Python script manually:**
   ```bash
   python scripts/fetch_kb_funds.py
   ```

5. **Check server console logs** for detailed Python output

### Error: "Only X fund(s) processed"

The scraper should process all 3 funds (Stocks, Balanced, Gold). If you see this warning:
- Check the Python script output
- Verify the KB Invest website is accessible
- Check if login credentials are correct (in environment variables or script)

## Next Steps

1. **Provide file details**: Share the actual file format/structure so I can customize the parsers
2. **Set environment variables**: Add the file URLs/paths to `.env.local`
3. **Test the sync**: Run it manually to verify it works
4. **Schedule it**: The hourly sync task will automatically use the new file-based approach

