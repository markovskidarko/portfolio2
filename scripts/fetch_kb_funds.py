"""
KB Invest Historical Prices Scraper
Fetches historical price data for Balanced, Stocks, and Gold funds from KB Invest website.
"""

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from webdriver_manager.chrome import ChromeDriverManager
import time
import json
import os
import sys
from datetime import datetime
import pandas as pd
import io
import tempfile
import glob
import subprocess
import platform
import requests
import re
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

# Get script directory for processed files folder
scriptPath = os.path.abspath(__file__)
scriptDir = os.path.dirname(scriptPath)

# Configuration
BASE_URL = "https://kbinvest.mk/WebEn/Historical_Prices.aspx"
FUNDS = ["Balanced", "Stocks", "Gold"]
TIMEOUT = 30

# Download directory - use dedicated folder for KB Funds
DOWNLOAD_DIR = os.path.abspath(os.path.join(scriptDir, '..', 'data', 'kb_funds_downloads'))

# Fund unit quantities (fixed)
FUND_UNITS = {
    "Stocks": 40345.9594,
    "Balanced": 23886.3365,
    "Gold": 28266.8087,
}

def setup_driver(force_headless=True):
    """
    Setup Chrome driver with download support.
    
    Args:
        force_headless: If True, run in headless mode. If False, run in visible mode.
                       Use False as absolute fallback if headless downloads continue to fail.
    """
    # Ensure download directory exists
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    
    # Clear download directory at start - ensure it's completely empty
    if os.path.exists(DOWNLOAD_DIR):
        for filename in os.listdir(DOWNLOAD_DIR):
            file_path = os.path.join(DOWNLOAD_DIR, filename)
            try:
                if os.path.isfile(file_path):
                    os.remove(file_path)
                    print(f"Cleared old file: {filename}", file=sys.stderr)
                elif os.path.isdir(file_path):
                    # Remove subdirectories too if any
                    import shutil
                    shutil.rmtree(file_path)
                    print(f"Removed old directory: {filename}", file=sys.stderr)
            except Exception as e:
                print(f"WARNING: Could not remove {filename}: {e}", file=sys.stderr)
        # Verify directory is empty
        remaining = os.listdir(DOWNLOAD_DIR)
        if remaining:
            print(f"WARNING: Download directory still contains files after cleanup: {remaining}", file=sys.stderr)
        else:
            print(f"[INFO] Download directory cleared successfully - initial count will be 0", file=sys.stderr)
    
    options = webdriver.ChromeOptions()
    # Absolute Fallback: Non-Headless for Exports Only
    # If headless continues to fail, set force_headless=False to run in visible mode
    if force_headless:
        # Re-enable Headless Mode: Use 'new' for the latest headless engine
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        print(f"[INFO] Running in HEADLESS mode", file=sys.stderr)
    else:
        print(f"[INFO] Running in VISIBLE mode (headless disabled due to download issues)", file=sys.stderr)
    
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    # Check for "Safe Browsing" Blocks: Prevent invisible "harmful file" prompts in headless mode
    options.add_argument("--safebrowsing-disable-download-protection")
    options.add_argument("--allow-running-insecure-content")
    # Chrome Options for Silent Download: Additional flags to bypass security prompts
    options.add_argument("--disable-web-security")
    options.add_argument("--disable-popup-blocking")
    # Force Download via Network Emulation: Treat "Content-Disposition: attachment" as forced download
    options.add_argument("--disable-features=DownloadBubble,DownloadBubbleV2")
    
    # Set download preferences to use dedicated KB Funds download folder
    download_dir_abs = os.path.abspath(DOWNLOAD_DIR)
    prefs = {
        "download.default_directory": download_dir_abs,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
        "profile.default_content_settings.popups": 0,
        # Chrome Options for Silent Download: Enable automatic downloads
        "profile.default_content_setting_values.automatic_downloads": 1
    }
    options.add_experimental_option("prefs", prefs)
    
    # Suppress Console Windows (Windows Only)
    service = Service(ChromeDriverManager().install())
    if platform.system() == 'Windows':
        service.creation_flags = subprocess.CREATE_NO_WINDOW
    
    driver = webdriver.Chrome(service=service, options=options)
    
    # Replace CDP Command with Broad Permission: Use Browser.setDownloadBehavior for entire session
    # This applies to the entire session, not just the current page
    print(f"[INFO] Setting up Browser.setDownloadBehavior for headless mode (session-wide)...", file=sys.stderr)
    # Convert to raw string for Windows paths
    download_path_raw = download_dir_abs.replace('\\', '/') if platform.system() == 'Windows' else download_dir_abs
    try:
        driver.execute_cdp_cmd('Browser.setDownloadBehavior', {
            'behavior': 'allowAndName',
            'downloadPath': download_path_raw,
            'eventsEnabled': True
        })
        print(f"[INFO] Browser.setDownloadBehavior configured: {download_path_raw}", file=sys.stderr)
    except Exception as e:
        # Fallback to Page.setDownloadBehavior if Browser.setDownloadBehavior is not supported
        print(f"[WARNING] Browser.setDownloadBehavior not supported, using Page.setDownloadBehavior: {e}", file=sys.stderr)
        driver.execute_cdp_cmd('Page.setDownloadBehavior', {
            'behavior': 'allow',
            'downloadPath': download_path_raw
        })
        print(f"[INFO] Page.setDownloadBehavior configured: {download_path_raw}", file=sys.stderr)
    
    return driver

def wait_for_download_and_rename(download_dir, fund_name, initial_file_count, driver=None, max_wait=60):
    """
    Wait for a new file to appear in the download directory (fund-specific), then immediately rename it.
    Returns the path to the renamed file, or None if timeout.
    
    Args:
        download_dir: Directory to monitor
        fund_name: Name of the fund (for unique identification)
        initial_file_count: Number of files before clicking Export (to detect new file)
        driver: WebDriver instance for diagnostic snapshots (optional)
        max_wait: Maximum wait time in seconds (default 60)
    """
    start_time = time.time()
    print(f"[{fund_name}] Waiting for download to start (initial file count: {initial_file_count})...", file=sys.stderr)
    
    while time.time() - start_time < max_wait:
        if not os.path.exists(download_dir):
            time.sleep(1)
            continue
        
        files = os.listdir(download_dir)
        current_file_count = len([f for f in files if os.path.isfile(os.path.join(download_dir, f))])
        
        # Check for downloading files (.crdownload or .tmp)
        downloading = [f for f in files if f.endswith('.crdownload') or f.endswith('.tmp')]
        
        if downloading:
            # Download in progress, wait
            print(f"[{fund_name}] Download in progress ({len(downloading)} downloading files)...", file=sys.stderr)
            time.sleep(1)
            continue
        
        # Check if we have a new file (count increased or new .xls/.xlsx/.htm file)
        if current_file_count > initial_file_count:
            # New file appeared, find it
            initial_files_set = set(files[:initial_file_count]) if initial_file_count > 0 else set()
            current_files_set = set(files)
            new_files = [f for f in (current_files_set - initial_files_set) 
                        if os.path.isfile(os.path.join(download_dir, f))
                        and not f.endswith('.crdownload') 
                        and not f.endswith('.tmp')]
            
            # Check for Excel or HTML files (KB Invest sometimes downloads as .htm)
            xls_files = [f for f in new_files if f.endswith(('.xls', '.xlsx', '.htm'))]
            
            if xls_files:
                # Get the most recently created file
                full_paths = [os.path.join(download_dir, f) for f in xls_files]
                new_file = max(full_paths, key=os.path.getctime)
                new_file_basename = os.path.basename(new_file)
                
                # Determine correct extension (force .xls if .htm)
                file_ext = '.xls' if new_file_basename.endswith('.htm') else os.path.splitext(new_file_basename)[1]
                
                # Immediately rename to include fund name (prevents other funds from seeing it)
                target_filename = f"{fund_name}_latest{file_ext}"
                target_path = os.path.join(download_dir, target_filename)
                
                try:
                    # If target already exists, remove it first
                    if os.path.exists(target_path):
                        os.remove(target_path)
                    
                    os.rename(new_file, target_path)
                    print(f"[{fund_name}] [Success] Renamed generic download '{new_file_basename}' to '{target_filename}'. Proceeding to Parse.", file=sys.stderr)
                    return target_path
                except Exception as e:
                    print(f"[{fund_name}] ERROR: Failed to rename file {new_file_basename} to {target_filename}: {e}", file=sys.stderr)
                    # Return original file if rename fails
                    return new_file
            elif new_files:
                # New files appeared but not Excel/HTML - wait a bit more
                print(f"[{fund_name}] New files detected but not Excel format: {new_files}", file=sys.stderr)
                time.sleep(1)
        else:
            # No new file yet, check if we're still waiting
            elapsed = time.time() - start_time
            if elapsed > 5 and elapsed % 10 < 1:  # Log every 10 seconds
                print(f"[{fund_name}] Still waiting for download ({int(elapsed)}s elapsed)...", file=sys.stderr)
        
        time.sleep(1)
    
    # Diagnostic: Snapshot the DOM on Failure
    print(f"[{fund_name}] ERROR: Download timeout after {max_wait}s. Generating diagnostic snapshot...", file=sys.stderr)
    
    if driver:
        try:
            # Get last 500 characters of HTML
            html_content = driver.execute_script("return document.documentElement.outerHTML;")
            html_snippet = html_content[-500:] if len(html_content) > 500 else html_content
            print(f"[{fund_name}] [DIAGNOSTIC] Last 500 chars of HTML:", file=sys.stderr)
            print(html_snippet, file=sys.stderr)
            
            # Get list of all active network requests
            try:
                # Use Performance API to check network activity
                network_info = driver.execute_script("""
                    if (window.performance && window.performance.getEntriesByType) {
                        const entries = window.performance.getEntriesByType('resource');
                        return entries.slice(-10).map(e => ({
                            name: e.name,
                            type: e.initiatorType,
                            duration: e.duration,
                            transferSize: e.transferSize
                        }));
                    }
                    return [];
                """)
                print(f"[{fund_name}] [DIAGNOSTIC] Recent network requests:", file=sys.stderr)
                for req in network_info:
                    print(f"  - {req.get('name', 'N/A')}: {req.get('type', 'N/A')} ({req.get('duration', 0):.2f}ms, {req.get('transferSize', 0)} bytes)", file=sys.stderr)
            except Exception as e:
                print(f"[{fund_name}] [DIAGNOSTIC] Could not get network info: {e}", file=sys.stderr)
            
            # Check for error responses in page
            error_check = driver.execute_script("""
                const errorElements = document.querySelectorAll('.error, .alert-danger, [class*="error"], [class*="exception"]');
                const errorTexts = Array.from(errorElements).slice(0, 5).map(el => el.textContent.trim()).filter(t => t);
                return errorTexts;
            """)
            if error_check:
                print(f"[{fund_name}] [DIAGNOSTIC] Error messages found on page:", file=sys.stderr)
                for err in error_check:
                    print(f"  - {err[:200]}", file=sys.stderr)
            
            # Check HTTP status if available
            try:
                status_check = driver.execute_script("""
                    if (window.location && window.location.href) {
                        return window.location.href;
                    }
                    return null;
                """)
                print(f"[{fund_name}] [DIAGNOSTIC] Current page URL: {status_check}", file=sys.stderr)
            except:
                pass
                
        except Exception as diag_error:
            print(f"[{fund_name}] [DIAGNOSTIC] Failed to generate diagnostic snapshot: {diag_error}", file=sys.stderr)
    else:
        print(f"[{fund_name}] [DIAGNOSTIC] Driver not available for diagnostics", file=sys.stderr)
    
    print(f"[{fund_name}] ERROR: Download timeout after {max_wait}s. Skipping this fund.", file=sys.stderr)
    return None

def parse_xls(file_path, fund_name):
    """
    Parse an XLS file (HTML table) and extract price data using BeautifulSoup.
    Returns list of {date, fund_name, price_per_unit_mkd}
    
    Note: KB Invest exports are HTML files with .xls extension, not true Excel binary files.
    Uses BeautifulSoup to manually find and extract table rows.
    """
    if not file_path or not os.path.exists(file_path):
        print(f"[{fund_name}] ERROR: File not found: {file_path}", file=sys.stderr)
        return []
    
    prices = []
    
    # Implementation Strategy: Load file content and parse with BeautifulSoup
    print(f"[{fund_name}] Reading file content and parsing with BeautifulSoup...", file=sys.stderr)
    
    try:
        # Read file content (try multiple encodings)
        content = None
        for encoding in ['utf-8', 'utf-16', 'windows-1252', 'latin-1']:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    content = f.read()
                print(f"[{fund_name}] Successfully read file with {encoding} encoding ({len(content)} chars)", file=sys.stderr)
                break
            except UnicodeDecodeError:
                continue
        
        if content is None:
            # Try reading as binary
            with open(file_path, 'rb') as f:
                content = f.read().decode('utf-8', errors='ignore')
            print(f"[{fund_name}] Read file as binary and decoded with UTF-8 (errors ignored)", file=sys.stderr)
        
        # Parse with BeautifulSoup
        soup = BeautifulSoup(content, 'html.parser')
        
        # The Hunt: Search for any <tr> tags that contain exactly 3 <td> or <th> elements
        # KB Invest table structure:
        # - First row is header
        # - Column 1 (index 0) is Number List
        # - Column 2 (index 1) is Date
        # - Column 3 (index 2) is Value
        all_rows = soup.find_all('tr')
        print(f"[{fund_name}] Found {len(all_rows)} total <tr> tags in HTML", file=sys.stderr)
        
        # Verify first row is header by checking for header-like text
        header_row_index = 0
        date_col_index = 1  # Column 2 (0-indexed: index 1) is Date
        price_col_index = 2  # Column 3 (0-indexed: index 2) is Value
        
        # Check if first row looks like a header
        first_row = all_rows[0] if len(all_rows) > 0 else None
        if first_row:
            cells = first_row.find_all(['td', 'th'])
            if len(cells) == 3:
                cell_texts = [cell.get_text(strip=True).lower() for cell in cells]
                # Look for header indicators in first row
                has_header = any(word in ' '.join(cell_texts) for word in ['датум', 'date', 'вредност', 'value', 'цена', 'price'])
                if has_header:
                    print(f"[{fund_name}] First row confirmed as header. Column structure: [Number List, Date, Value]", file=sys.stderr)
                    print(f"[{fund_name}] Using Date column at index {date_col_index}, Value column at index {price_col_index}", file=sys.stderr)
                else:
                    print(f"[{fund_name}] WARNING: First row doesn't look like header, but treating it as header anyway", file=sys.stderr)
        
        # Extract all subsequent rows (after header - first row)
        data_rows = all_rows[1:] if len(all_rows) > 1 else []
        print(f"[{fund_name}] Found {len(data_rows)} data rows after header (skipping first row)", file=sys.stderr)
        
        if len(data_rows) == 0:
            # Diagnostic Snapshot: Print first 1000 characters if no rows found
            print(f"[{fund_name}] ERROR: No data rows found", file=sys.stderr)
            print(f"[{fund_name}] [DIAGNOSTIC] First 1000 characters of file content:", file=sys.stderr)
            print(content[:1000], file=sys.stderr)
            return []
        
        # Extract data from rows
        # Table structure: Column 1 (index 0) = Number List, Column 2 (index 1) = Date, Column 3 (index 2) = Value
        valid_rows = []
        for row_idx, row in enumerate(data_rows):
            cells = row.find_all(['td', 'th'])
            if len(cells) == 3:  # Must have exactly 3 columns
                # Clean the Strings: Strip whitespace and \xa0 (non-breaking space)
                cell_texts = []
                for cell in cells:
                    text = cell.get_text()
                    # Remove non-breaking spaces and clean whitespace
                    text = text.replace('\xa0', ' ').strip()
                    cell_texts.append(text)
                
                if len(cell_texts) >= 3:
                    # Column 1 (index 0) = Number List (ignore this)
                    # Column 2 (index 1) = Date
                    # Column 3 (index 2) = Value
                    date_str_raw = cell_texts[1] if len(cell_texts) > 1 else None  # Column 2 (index 1)
                    price_str_raw = cell_texts[2] if len(cell_texts) > 2 else None  # Column 3 (index 2)
                    
                    if date_str_raw and price_str_raw:
                        valid_rows.append({
                            'date_str': date_str_raw,
                            'price_str': price_str_raw
                        })
        
        print(f"[{fund_name}] Extracted {len(valid_rows)} valid rows from HTML table", file=sys.stderr)
        
        if len(valid_rows) == 0:
            print(f"[{fund_name}] ERROR: No valid rows extracted", file=sys.stderr)
            return []
        
        # Process valid rows: Convert dates and parse prices
        for row_data in valid_rows:
            try:
                date_str_raw = row_data['date_str']
                price_str_raw = row_data['price_str']
                
                # Skip empty values
                if not date_str_raw or not price_str_raw:
                    continue
                
                # Date Conversion: Convert to YYYY-MM-DD using pd.to_datetime or dateutil.parser
                date_str = None
                try:
                    # Try pd.to_datetime first
                    parsed_date = pd.to_datetime(date_str_raw, errors='coerce', dayfirst=True)
                    if pd.notna(parsed_date):
                        date_str = parsed_date.strftime('%Y-%m-%d')
                    else:
                        # Fallback to dateutil.parser
                        parsed_date = date_parser.parse(date_str_raw, dayfirst=True)
                        date_str = parsed_date.strftime('%Y-%m-%d')
                except Exception as date_error:
                    # Try manual parsing for common formats
                    date_formats = [
                        '%d.%m.%Y',  # DD.MM.YYYY (Macedonian format)
                        '%d/%m/%Y',  # DD/MM/YYYY
                        '%Y-%m-%d',  # YYYY-MM-DD
                        '%m/%d/%Y',  # MM/DD/YYYY
                    ]
                    for fmt in date_formats:
                        try:
                            dt = datetime.strptime(date_str_raw.strip(), fmt)
                            date_str = dt.strftime('%Y-%m-%d')
                            break
                        except:
                            continue
                
                if not date_str:
                    continue  # Skip if date couldn't be parsed
                
                # Value Parsing: Convert price string to float
                # KB Invest exports use dot (.) as decimal separator (e.g., "259.02")
                price_str_clean = price_str_raw.strip()
                # Remove MKD and formatting
                price_str_clean = price_str_clean.replace('MKD', '').replace('Mkd', '').replace('mkd', '').strip()
                
                # Handle different number formats:
                # 1. Simple decimal with dot: "259.02" -> keep as "259.02"
                # 2. Macedonian format: "123.456,78" (dots for thousands, comma for decimal) -> "123456.78"
                # 3. English format: "123,456.78" (comma for thousands, dot for decimal) -> "123456.78"
                # 4. Simple decimal with comma: "259,02" -> "259.02"
                
                if '.' in price_str_clean and ',' in price_str_clean:
                    # Both dot and comma present - determine which is decimal
                    dot_pos = price_str_clean.rfind('.')
                    comma_pos = price_str_clean.rfind(',')
                    
                    if dot_pos > comma_pos:
                        # Dot comes after comma: "123,456.78" (English format)
                        # Comma is thousands, dot is decimal - remove comma, keep dot
                        price_str_clean = price_str_clean.replace(',', '')
                    else:
                        # Comma comes after dot: "123.456,78" (Macedonian format)
                        # Dot is thousands, comma is decimal - remove dots, convert comma to dot
                        price_str_clean = price_str_clean.replace('.', '').replace(',', '.')
                elif ',' in price_str_clean:
                    # Only comma - check if it's likely decimal or thousands
                    comma_pos = price_str_clean.rfind(',')
                    # If comma is in last 3 positions, it's probably decimal (e.g., "259,02")
                    if len(price_str_clean) - comma_pos <= 3:
                        # Comma is decimal separator - convert to dot
                        price_str_clean = price_str_clean.replace(',', '.')
                    else:
                        # Comma is thousands separator (e.g., "1,234") - remove it
                        price_str_clean = price_str_clean.replace(',', '')
                elif '.' in price_str_clean:
                    # Only dot - check position to determine if decimal or thousands
                    dot_pos = price_str_clean.rfind('.')
                    # If dot is in last 3 positions, it's decimal (e.g., "259.02")
                    # If dot is earlier, it might be thousands, but for KB Invest prices,
                    # single dot is usually decimal separator
                    if len(price_str_clean) - dot_pos <= 3:
                        # Dot is decimal separator - KEEP IT (don't remove)
                        pass  # Keep the dot as is
                    else:
                        # Dot might be thousands, but for typical prices (100-1000 range),
                        # if there's only one dot, it's likely decimal
                        # Keep it as decimal separator
                        pass
                # If no dot or comma, price is already clean (e.g., "259")
                
                try:
                    price = float(price_str_clean)
                except ValueError:
                    print(f"[{fund_name}] WARNING: Could not parse price '{price_str_raw}' -> '{price_str_clean}'", file=sys.stderr)
                    continue  # Skip if price couldn't be parsed
                
                # Validate price is reasonable (should be between 100 and 1000 MKD per unit)
                if price < 100 or price > 1000:
                    print(f"[{fund_name}] WARNING: Price seems incorrect: {price} MKD (expected 100-1000). Original: '{price_str_raw}' -> Cleaned: '{price_str_clean}'", file=sys.stderr)
                    # Don't skip - just log warning, might be valid
                
                # Validate price is positive
                if price and price > 0:
                    # Calculate total value MKD (price * units)
                    units = FUND_UNITS.get(fund_name, 0)
                    total_value_mkd = price * units
                    
                    prices.append({
                        'date': date_str,
                        'fund_name': fund_name,
                        'price_per_unit_mkd': price,
                        'total_value_mkd': total_value_mkd
                    })
            except Exception as row_error:
                continue  # Skip this row if any error occurs
        
        print(f"[{fund_name}] Successfully parsed {len(prices)} price records", file=sys.stderr)
        
        # Data Validation: Print first 5 rows
        if len(prices) > 0:
            print(f"\n[Success] Parsed {len(prices)} rows for {fund_name}. Sample data:", file=sys.stderr)
            for sample in prices[:5]:
                print(f"  {sample}", file=sys.stderr)
            print(f"[{fund_name}] Date range: {prices[0]['date']} to {prices[-1]['date']}\n", file=sys.stderr)
        
        return prices
        
    except Exception as e:
        print(f"[{fund_name}] ERROR: Failed to parse HTML file {file_path}: {e}", file=sys.stderr)
        import traceback
        print(f"[{fund_name}] Traceback: {traceback.format_exc()}", file=sys.stderr)
        return []

def scrape_fund_prices(driver, fund_name):
    """
    Scrape historical prices for a specific fund - STREAMLINED VERSION.
    Returns list of {date, fund_name, price_per_unit_mkd}
    """
    try:
        driver.get(BASE_URL)
        
        # CDP Download Permission will be set immediately before Export click (see Step 4)
        # This ensures it's fresh for each fund's export operation
        
        # Reliability Check: Extra logging for headless mode
        print(f"[{fund_name}] [INFO] Headless browser acting on {fund_name}...", file=sys.stderr)
        
        wait = WebDriverWait(driver, TIMEOUT)
        
        # STREAMLINED SEQUENCE: 4 steps with fixed pauses
        # Step 1: Select Fund from dropdown (Wait 2s)
        print(f"[{fund_name}] Step 1: Selecting fund from dropdown...", file=sys.stderr)
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "select")))
        select_element = wait.until(EC.presence_of_element_located((By.TAG_NAME, "select")))
        select = Select(select_element)
        
        try:
            select.select_by_visible_text(fund_name)
        except:
            # Try case-insensitive
            for option in select.options:
                if option.text.lower() == fund_name.lower():
                    select.select_by_visible_text(option.text)
                    break
        
        time.sleep(2)  # Wait 2s
        
        # Wait for chart to initialize (minimal wait)
        try:
            wait.until(EC.presence_of_element_located((By.XPATH, "//*[contains(@class, 'highcharts-container')]")))
            time.sleep(1)
        except:
            pass
        
        # STREAMLINED SEQUENCE: 4 steps with fixed pauses
        # Step 2: Trigger '1M' via Highcharts API (Wait 1s)
        print(f"[{fund_name}] Step 2: Triggering '1M' timeframe...", file=sys.stderr)
        try:
            driver.execute_script("""
                if (typeof Highcharts !== 'undefined' && Highcharts.charts && Highcharts.charts[0]) {
                    const chart = Highcharts.charts[0];
                    if (chart.rangeSelector && chart.rangeSelector.clickButton) {
                        chart.rangeSelector.clickButton(0, true);
                    }
                }
            """)
            time.sleep(1)  # Wait 1s
        except Exception as e:
            print(f"[{fund_name}] WARNING: Could not trigger '1M': {e}", file=sys.stderr)
        
        # Step 3: Trigger 'All' (Сите) via Highcharts API (Wait 5s)
        print(f"[{fund_name}] Step 3: Triggering 'Сите' (All) timeframe...", file=sys.stderr)
        try:
            driver.execute_script("""
                if (typeof Highcharts !== 'undefined' && Highcharts.charts && Highcharts.charts[0]) {
                    const chart = Highcharts.charts[0];
                    if (chart.rangeSelector && chart.rangeSelector.clickButton) {
                        chart.rangeSelector.clickButton(5, true);
                    }
                }
            """)
            time.sleep(5)  # Wait 5s to ensure server registers the range change
        except Exception as e:
            print(f"[{fund_name}] WARNING: Could not trigger 'All': {e}", file=sys.stderr)
        
        # Add a "Wait for Stability" after 'All' click: Wait for table to refresh
        # Since the page uses an UpdatePanel, wait until the price table is re-attached or visible
        print(f"[{fund_name}] Waiting for table stability after 'All' timeframe selection...", file=sys.stderr)
        max_retries = 10
        retry_count = 0
        table_stable = False
        
        while retry_count < max_retries and not table_stable:
            try:
                # Check if the historical prices table is visible and has content
                table_check = driver.execute_script("""
                    const table = document.getElementById('HistoricalPricesTable');
                    if (!table) return { visible: false, rows: 0 };
                    const rows = table.querySelectorAll('tbody tr');
                    return { 
                        visible: table.offsetParent !== null && table.style.display !== 'none',
                        rows: rows.length
                    };
                """)
                
                if table_check and table_check.get('visible') and table_check.get('rows', 0) > 5:
                    table_stable = True
                    print(f"[{fund_name}] Table is stable: {table_check.get('rows')} rows visible", file=sys.stderr)
                else:
                    retry_count += 1
                    time.sleep(1)
            except Exception as e:
                retry_count += 1
                time.sleep(1)
        
        if not table_stable:
            print(f"[{fund_name}] WARNING: Could not verify table stability, proceeding anyway...", file=sys.stderr)
        else:
            # Additional small wait to ensure DOM is fully updated
            time.sleep(2)
        
        # Wait for loading overlay to disappear after "All" timeframe
        print(f"[{fund_name}] Waiting for loading overlay to disappear after 'All' timeframe...", file=sys.stderr)
        try:
            overlay_selectors = [
                (By.CSS_SELECTOR, ".loading"),
                (By.CSS_SELECTOR, ".overlay"),
                (By.CSS_SELECTOR, ".processing"),
                (By.CSS_SELECTOR, "[class*='loading']"),
                (By.CSS_SELECTOR, "[class*='overlay']"),
                (By.CSS_SELECTOR, "[class*='processing']"),
            ]
            
            for selector_type, selector_value in overlay_selectors:
                try:
                    WebDriverWait(driver, 5).until(
                        EC.invisibility_of_element_located((selector_type, selector_value))
                    )
                except:
                    pass  # Overlay not present, that's fine
            
            print(f"[{fund_name}] Loading overlays cleared after 'All' timeframe", file=sys.stderr)
        except:
            print(f"[{fund_name}] WARNING: Could not verify overlay absence, proceeding anyway...", file=sys.stderr)
        
        # Additional wait for ASP.NET UpdatePanel to complete refresh
        time.sleep(2)
        
        # Step 4: Capture Identity and Download Directly via Requests
        # Stop fighting with Chrome's headless download settings - use requests instead
        # Critical Timing: Capture tokens AFTER page refresh from "All" timeframe
        print(f"[{fund_name}] Step 4: Capturing Selenium identity for direct download via requests (post-refresh)...", file=sys.stderr)
        
        # 1. Capture the "Identity" from Selenium (POST-REFRESH)
        try:
            # Get cookies
            selenium_cookies = driver.get_cookies()
            print(f"[{fund_name}] Captured {len(selenium_cookies)} cookies from Selenium session", file=sys.stderr)
            
            # Get User-Agent
            user_agent = driver.execute_script("return navigator.userAgent;")
            print(f"[{fund_name}] Captured User-Agent: {user_agent[:50]}...", file=sys.stderr)
            
            # Session Persistence: Verify User-Agent matches (critical for ASP.NET session validation)
            print(f"[{fund_name}] User-Agent for requests session will match Selenium: {user_agent[:80]}...", file=sys.stderr)
            
            # Get current URL for Referer
            current_url = driver.current_url
            print(f"[{fund_name}] Current URL: {current_url}", file=sys.stderr)
            
            # Critical Timing for Token Capture: Get ASP.NET Hidden Fields AFTER refresh
            # Clean the Token Values: Use .get_attribute('value') instead of page source regex
            print(f"[{fund_name}] Capturing ASP.NET hidden fields post-refresh (using .get_attribute)...", file=sys.stderr)
            
            try:
                # Use Selenium to find hidden input elements and get their values
                viewstate_input = driver.find_element(By.NAME, "__VIEWSTATE")
                viewstate = viewstate_input.get_attribute('value') if viewstate_input else ''
                
                viewstate_generator_input = driver.find_element(By.NAME, "__VIEWSTATEGENERATOR")
                viewstate_generator = viewstate_generator_input.get_attribute('value') if viewstate_generator_input else ''
                
                eventvalidation_input = driver.find_element(By.NAME, "__EVENTVALIDATION")
                eventvalidation = eventvalidation_input.get_attribute('value') if eventvalidation_input else ''
                
                print(f"[{fund_name}] Captured ASP.NET hidden fields (via .get_attribute): VIEWSTATE={len(viewstate)} chars, GENERATOR={viewstate_generator}, VALIDATION={len(eventvalidation)} chars", file=sys.stderr)
            except Exception as e:
                print(f"[{fund_name}] WARNING: Could not find hidden fields via find_element, falling back to page source regex: {e}", file=sys.stderr)
                # Fallback to page source regex
                page_source = driver.page_source
                viewstate_match = re.search(r'name="__VIEWSTATE"\s+value="([^"]+)"', page_source, re.IGNORECASE)
                viewstate_generator_match = re.search(r'name="__VIEWSTATEGENERATOR"\s+value="([^"]+)"', page_source, re.IGNORECASE)
                eventvalidation_match = re.search(r'name="__EVENTVALIDATION"\s+value="([^"]+)"', page_source, re.IGNORECASE)
                
                viewstate = viewstate_match.group(1) if viewstate_match else ''
                viewstate_generator = viewstate_generator_match.group(1) if viewstate_generator_match else ''
                eventvalidation = eventvalidation_match.group(1) if eventvalidation_match else ''
                
                print(f"[{fund_name}] Captured ASP.NET hidden fields (via regex fallback): VIEWSTATE={len(viewstate)} chars, GENERATOR={viewstate_generator}, VALIDATION={len(eventvalidation)} chars", file=sys.stderr)
            
            # Validate we have the required fields
            if not viewstate or not viewstate_generator or not eventvalidation:
                print(f"[{fund_name}] ERROR: Missing required ASP.NET hidden fields (VIEWSTATE: {len(viewstate)}, GENERATOR: {viewstate_generator}, VALIDATION: {len(eventvalidation)})", file=sys.stderr)
                return []
            
            # Find the Export button ID/name for the POST target (post-refresh)
            try:
                export_button = driver.find_element(By.XPATH, "//input[contains(@value, 'Export')]")
                event_target = export_button.get_attribute('name') or export_button.get_attribute('id') or 'ctl00$MainContent$btnExportToExcel'
                print(f"[{fund_name}] Export button event target (post-refresh): {event_target}", file=sys.stderr)
            except Exception as e:
                print(f"[{fund_name}] WARNING: Could not find Export button via find_element, using default: {e}", file=sys.stderr)
                event_target = 'ctl00$MainContent$btnExportToExcel'
            
            # Get dropdown selection (fund ID) - ensure it's included in payload
            dropdown_name = None
            dropdown_value = None
            try:
                select_element = driver.find_element(By.TAG_NAME, "select")
                dropdown_name = select_element.get_attribute('name') or select_element.get_attribute('id')
                dropdown_value = select_element.get_attribute('value') or driver.execute_script("return arguments[0].options[arguments[0].selectedIndex].value;", select_element)
                print(f"[{fund_name}] Dropdown selection: {dropdown_name} = {dropdown_value}", file=sys.stderr)
            except Exception as e:
                print(f"[{fund_name}] WARNING: Could not capture dropdown selection: {e}", file=sys.stderr)
            
            # 2. Initialize the requests Session
            print(f"[{fund_name}] Initializing requests session...", file=sys.stderr)
            session = requests.Session()
            
            # Transfer cookies from Selenium to requests session
            for cookie in selenium_cookies:
                session.cookies.set(cookie['name'], cookie['value'], domain=cookie.get('domain', ''))
            
            # Set headers (User-Agent and Referer) - Session Persistence: Exact match with Selenium
            session.headers.update({
                'User-Agent': user_agent,  # Must match Selenium exactly
                'Referer': current_url,
                'Content-Type': 'application/x-www-form-urlencoded',  # Verify Content-Type
                'Accept': 'application/vnd.ms-excel,application/octet-stream,*/*'
            })
            
            print(f"[{fund_name}] Requests session initialized with cookies and headers (User-Agent: {user_agent[:80]}...)", file=sys.stderr)
            
            # 3. Trigger the Manual POST Request
            # Complete the POST Payload: Include entire form state
            print(f"[{fund_name}] Performing POST request to trigger export...", file=sys.stderr)
            
            # Build POST payload with ASP.NET form fields (all required fields)
            post_data = {
                '__EVENTTARGET': event_target,
                '__EVENTARGUMENT': '',  # Empty string as required
                '__VIEWSTATE': viewstate,  # Post-refresh value
                '__VIEWSTATEGENERATOR': viewstate_generator,  # Post-refresh value
                '__EVENTVALIDATION': eventvalidation  # Post-refresh value
            }
            
            # Add dropdown selection (fund ID) - required for ASP.NET form state
            if dropdown_name and dropdown_value:
                post_data[dropdown_name] = dropdown_value
                print(f"[{fund_name}] Added dropdown to POST payload: {dropdown_name}={dropdown_value}", file=sys.stderr)
            
            print(f"[{fund_name}] POST payload prepared with {len(post_data)} fields", file=sys.stderr)
            
            # Perform POST request with explicit Content-Type header
            # Verify Content-Type: Ensure the POST request is sent with correct headers
            response = session.post(
                BASE_URL,
                data=post_data,
                headers={
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': user_agent,
                    'Referer': current_url
                },
                timeout=60
            )
            
            print(f"[{fund_name}] POST response status: {response.status_code}", file=sys.stderr)
            print(f"[{fund_name}] Response Content-Type: {response.headers.get('Content-Type', 'N/A')}", file=sys.stderr)
            print(f"[{fund_name}] Response Content-Length: {len(response.content)} bytes", file=sys.stderr)
            
            # Check for ASP.NET 500 error
            if response.status_code == 500:
                print(f"[{fund_name}] ERROR: ASP.NET 500 Error - Server rejected request", file=sys.stderr)
                print(f"[{fund_name}] Response content (first 1000 chars): {response.text[:1000]}", file=sys.stderr)
                return []
            
            # 4. Handle the Stream and Save
            if response.status_code == 200:
                # 5. Verification
                content = response.content
                
                # Check if response is HTML or empty (error)
                if content.startswith(b'<html') or content.startswith(b'<!DOCTYPE') or len(content) < 1024:
                    print(f"[{fund_name}] ERROR: Direct download returned HTML/Empty instead of XLS.", file=sys.stderr)
                    print(f"[{fund_name}] Response preview (first 200 chars): {content[:200]}", file=sys.stderr)
                    return []
                
                # Save file directly
                download_dir = DOWNLOAD_DIR
                if not os.path.exists(download_dir):
                    os.makedirs(download_dir, exist_ok=True)
                
                target_filename = f"{fund_name}_latest.xls"
                target_path = os.path.join(download_dir, target_filename)
                
                # Remove existing file if it exists
                if os.path.exists(target_path):
                    os.remove(target_path)
                
                # Write binary content to file
                with open(target_path, 'wb') as f:
                    f.write(content)
                
                print(f"[{fund_name}] Successfully downloaded file via requests: {target_path} ({len(content)} bytes)", file=sys.stderr)
                
                # Verify file is valid Excel (starts with expected Excel signature or has .xls extension)
                if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
                    latest_file = target_path
                    print(f"[{fund_name}] File download verified: {target_path} ({os.path.getsize(target_path)} bytes)", file=sys.stderr)
                else:
                    print(f"[{fund_name}] ERROR: Downloaded file is invalid or empty", file=sys.stderr)
                    return []
            else:
                print(f"[{fund_name}] ERROR: POST request failed with status {response.status_code}", file=sys.stderr)
                print(f"[{fund_name}] Response content (first 500 chars): {response.text[:500]}", file=sys.stderr)
                return []
                
        except Exception as e:
            print(f"[{fund_name}] ERROR: Failed to download via requests: {e}", file=sys.stderr)
            import traceback
            print(f"[{fund_name}] Traceback: {traceback.format_exc()}", file=sys.stderr)
            return []
        
        # Verify latest_file was set
        if 'latest_file' not in locals() or not latest_file:
            print(f"[{fund_name}] ERROR: File download failed - latest_file not set", file=sys.stderr)
            return []
        
        # Continue with file parsing
        print(f"[{fund_name}] Proceeding to parse downloaded file...", file=sys.stderr)
        
        # Parse the XLS file using dedicated function with fund_name parameter
        print(f"[{fund_name}] Parsing file...", file=sys.stderr)
        prices = parse_xls(latest_file, fund_name)
        
        if not prices:
            print(f"[{fund_name}] ERROR: No price data extracted", file=sys.stderr)
            return []
        
        print(f"[{fund_name}] Successfully extracted {len(prices)} price records", file=sys.stderr)
        
        # Clean up: Move processed file to processed folder
        processed_dir = os.path.join(scriptDir, 'processed')
        try:
            os.makedirs(processed_dir, exist_ok=True)
            # Move file to processed folder (already has fund name and timestamp)
            filename = os.path.basename(latest_file)
            processed_file = os.path.join(processed_dir, filename)
            os.rename(latest_file, processed_file)
            print(f"[Success] Moved processed file to: {processed_file}", file=sys.stderr)
        except Exception as e:
            # If move fails, try to delete
            try:
                os.remove(latest_file)
                print(f"[Success] Deleted processed file: {latest_file}", file=sys.stderr)
            except Exception as del_error:
                print(f"WARNING: Could not clean up file {latest_file}: {del_error}", file=sys.stderr)
        
        return prices
        
    except Exception as e:
        print(f"ERROR scraping {fund_name}: {e}", file=sys.stderr)
        return []

def get_latest_file(download_dir):
    """Get the most recently created file in the download directory"""
    files = glob.glob(os.path.join(download_dir, "*.xls*"))
    return max(files, key=os.path.getctime) if files else None

def insert_prices_to_database(prices):
    """Insert parsed prices into database via API endpoint with automatic port detection"""
    if not prices:
        return {'success': False, 'error': 'No prices to insert'}
    
    try:
        # Prepare data for API (use price_mkd field name as expected by API)
        api_data = []
        for price in prices:
            api_data.append({
                'date': price['date'],
                'fund_name': price['fund_name'],
                'price_mkd': price['price_per_unit_mkd']
            })
        
        # Send to API endpoint with automatic port detection
        import urllib.request
        import urllib.parse
        import urllib.error
        
        data = json.dumps({'data': api_data}).encode('utf-8')
        
        # Try both common Next.js ports (3000 and 3001)
        ports = [3000, 3001]
        last_error = None
        
        for port in ports:
            try:
                api_url = f'http://localhost:{port}/api/kb-funds/historical/insert/batch'
                print(f"[Database] Trying API endpoint: {api_url}", file=sys.stderr)
                
                req = urllib.request.Request(
                    api_url,
                    data=data,
                    headers={'Content-Type': 'application/json'}
                )
                
                with urllib.request.urlopen(req, timeout=60) as response:
                    result = json.loads(response.read().decode('utf-8'))
                    print(f"[Database] Successfully connected to port {port}", file=sys.stderr)
                    return result
            except urllib.error.URLError as e:
                last_error = e
                print(f"[Database] Port {port} not available: {e}", file=sys.stderr)
                continue
            except Exception as e:
                last_error = e
                print(f"[Database] Error on port {port}: {e}", file=sys.stderr)
                continue
        
        # If both ports failed, return error
        error_msg = f"Failed to connect to API on ports {ports}. Last error: {last_error}"
        print(f"[Database] ERROR: {error_msg}", file=sys.stderr)
        return {'success': False, 'error': error_msg}
        
    except Exception as e:
        print(f"[Database] ERROR: Failed to insert prices: {e}", file=sys.stderr)
        import traceback
        print(f"[Database] Traceback: {traceback.format_exc()}", file=sys.stderr)
        return {'success': False, 'error': str(e)}

def main():
    """Main function to scrape all funds and parse downloaded files"""
    # Inception date for all funds: 10.12.2025 (filter out dates before this)
    INCEPTION_DATE = datetime(2025, 12, 10)
    
    # Cleanup phase: Clear download directory at start
    try:
        if os.path.exists(DOWNLOAD_DIR):
            for filename in os.listdir(DOWNLOAD_DIR):
                file_path = os.path.join(DOWNLOAD_DIR, filename)
                try:
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                        print(f"[Cleanup] Removed old file: {filename}", file=sys.stderr)
                except Exception as e:
                    print(f"WARNING: Could not remove {filename}: {e}", file=sys.stderr)
        else:
            os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    except Exception as e:
        print(f"WARNING: Could not clean download directory: {e}", file=sys.stderr)
    
    # --- INVISIBLE CHROME SETUP (using user's provided script) ---
    from selenium.webdriver.chrome.options import Options
    
    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    
    prefs = {
        "download.default_directory": DOWNLOAD_DIR,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True
    }
    chrome_options.add_experimental_option("prefs", prefs)
    
    driver = None
    all_prices = []
    
    try:
        driver = webdriver.Chrome(options=chrome_options)
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"[INFO] Starting headless browser scraper...", file=sys.stderr)
        print(f"[INFO] Downloads will be saved to: {DOWNLOAD_DIR}", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)
        
        # --- START BATCH (using user's provided script logic) ---
        for fund_name in FUNDS:
            try:
                print(f"\n--- Processing: {fund_name} (Background Mode) ---", file=sys.stderr)
                driver.get(BASE_URL)
                time.sleep(10)
                
                # 1. Select Fund
                dropdown = driver.find_element(By.ID, "DropDown_Fond")
                Select(dropdown).select_by_visible_text(
                    next(opt.text for opt in Select(dropdown).options if fund_name.lower() in opt.text.lower())
                )
                print(f"[{fund_name}] Fund Selected.", file=sys.stderr)
                time.sleep(12)
                
                # 2. THE 6M API CALL (Direct Injection)
                print(f"[{fund_name}] Action: Injecting 6M range command...", file=sys.stderr)
                api_script = """
                try {
                    var charts = Highcharts.charts.filter(c => c !== undefined);
                    if (charts.length > 0) {
                        var chart = charts[0];
                        var xAxis = chart.xAxis[0];
                        var sixMonths = 180 * 24 * 3600 * 1000;
                        
                        // Set extremes and redraw
                        xAxis.setExtremes(xAxis.dataMax - sixMonths, xAxis.dataMax, true);
                        
                        // Force sync with range selector
                        if (chart.rangeSelector && chart.rangeSelector.buttons) {
                            for(var i=0; i<chart.rangeSelector.buttons.length; i++) {
                                if(chart.rangeSelector.buttons[i].text.textStr.toLowerCase().includes('6m')) {
                                    chart.rangeSelector.buttons[i].element.onclick();
                                    break;
                                }
                            }
                        }
                        chart.redraw();
                        return "6M_SUCCESS";
                    }
                    return "CHART_NOT_FOUND";
                } catch (e) { return "ERROR: " + e.message; }
                """
                driver.execute_script(api_script)
                time.sleep(10)
                
                # 3. TRIGGER EXPORT
                print(f"[{fund_name}] Action: Triggering Export...", file=sys.stderr)
                driver.execute_script("document.getElementById('btnExportToExcel').click();")
                
                # 4. File Handling
                print(f"[{fund_name}] Waiting for download to finish...", file=sys.stderr)
                time.sleep(15)
                latest = get_latest_file(DOWNLOAD_DIR)
                if latest:
                    size = os.path.getsize(latest)
                    new_path = os.path.join(DOWNLOAD_DIR, f"{fund_name}_6M.xls")
                    if os.path.exists(new_path):
                        os.remove(new_path)
                    os.rename(latest, new_path)
                    print(f"[{fund_name}] DONE: {fund_name}_6M.xls saved ({size} bytes).", file=sys.stderr)
                else:
                    print(f"[{fund_name}] No file detected. Check if download was blocked.", file=sys.stderr)
                
            except Exception as e:
                print(f"[{fund_name}] Error during processing: {e}", file=sys.stderr)
                import traceback
                print(f"[{fund_name}] Traceback: {traceback.format_exc()}", file=sys.stderr)
                continue
        
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"[INFO] Download phase complete. Starting file parsing...", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)
        
        # Parse all downloaded files
        downloaded_files = glob.glob(os.path.join(DOWNLOAD_DIR, "*.xls*"))
        print(f"[Parser] Found {len(downloaded_files)} files to parse", file=sys.stderr)
        
        for file_path in downloaded_files:
            filename = os.path.basename(file_path)
            # Extract fund name from filename (e.g., "Balanced_6M.xls" -> "Balanced")
            fund_name = None
            for fund in FUNDS:
                if fund.lower() in filename.lower():
                    fund_name = fund
                    break
            
            if not fund_name:
                print(f"[Parser] WARNING: Could not identify fund from filename: {filename}", file=sys.stderr)
                continue
            
            print(f"\n[Parser] Parsing {filename} for {fund_name}...", file=sys.stderr)
            try:
                prices = parse_xls(file_path, fund_name)
                
                # Filter out dates before inception date
                filtered_prices = []
                for price in prices:
                    try:
                        price_date = datetime.strptime(price['date'], '%Y-%m-%d')
                        if price_date >= INCEPTION_DATE:
                            filtered_prices.append(price)
                        else:
                            print(f"[Parser] Skipping date before inception: {price['date']}", file=sys.stderr)
                    except:
                        # If date parsing fails, include it anyway (let database handle it)
                        filtered_prices.append(price)
                
                if filtered_prices:
                    all_prices.extend(filtered_prices)
                    print(f"[Parser] Extracted {len(filtered_prices)} valid records from {filename}", file=sys.stderr)
                else:
                    print(f"[Parser] WARNING: No valid records extracted from {filename}", file=sys.stderr)
            except Exception as e:
                print(f"[Parser] ERROR: Failed to parse {filename}: {e}", file=sys.stderr)
                import traceback
                print(f"[Parser] Traceback: {traceback.format_exc()}", file=sys.stderr)
                continue
        
        # Insert all prices into database
        if all_prices:
            print(f"\n{'='*60}", file=sys.stderr)
            print(f"[Database] Inserting {len(all_prices)} records into database...", file=sys.stderr)
            print(f"{'='*60}", file=sys.stderr)
            
            result = insert_prices_to_database(all_prices)
            if result.get('success'):
                print(f"[Database] Success: {result.get('inserted', 0)} inserted, {result.get('updated', 0)} updated, {result.get('errors', 0)} errors", file=sys.stderr)
            else:
                print(f"[Database] ERROR: {result.get('error', 'Unknown error')}", file=sys.stderr)
    
    finally:
        # Cleanup logic: Ensure driver.quit() is called in finally block
        if driver:
            try:
                driver.quit()
                print("[Cleanup] Driver closed successfully", file=sys.stderr)
            except Exception as e:
                print(f"WARNING: Error closing driver: {e}", file=sys.stderr)
    
    # Output JSON
    output = {
        'success': True,
        'timestamp': datetime.now().isoformat(),
        'data': all_prices,
        'total_records': len(all_prices)
    }
    
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"[Summary] Total records extracted: {len(all_prices)}", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    
    # Verification: Check if all 3 funds were successfully processed
    funds_processed = set()
    for price in all_prices:
        funds_processed.add(price.get('fund_name'))
    
    if len(funds_processed) == 3:
        print(f"[Final Success] 3 funds processed, total records: {len(all_prices)}", file=sys.stderr)
    else:
        print(f"[WARNING] Only {len(funds_processed)} fund(s) processed: {', '.join(sorted(funds_processed))}", file=sys.stderr)
        print(f"[WARNING] Expected 3 funds: Balanced, Stocks, Gold", file=sys.stderr)
    
    print(f"{'='*60}\n", file=sys.stderr)
    
    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()

