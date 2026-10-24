export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { getExchangeRate } from '@/lib/exchange-rate';

export const maxDuration = 120; // 2 minutes for scraping

/**
 * GET /api/kb-funds/scrape - Scrape KB Invest website and return current portfolio value
 */
export async function GET() {
  try {
    // Path to the Python script
    const scriptDir = join(process.cwd(), 'scripts');
    const scriptPath = join(scriptDir, 'kb_funds_scraper.py');

    // Ensure scripts directory exists
    if (!existsSync(scriptDir)) {
      await mkdir(scriptDir, { recursive: true });
    }

    // Check if script exists, if not create it
    if (!existsSync(scriptPath)) {
      const scriptContent = `from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import time
import re
import urllib.request
import json
import os

# --- CONFIGURATION ---
USERNAME = os.getenv("KB_FUNDS_USERNAME", "natmarkovska")
PASSWORD = os.getenv("KB_FUNDS_PASSWORD", "sofievaMKD42*")
LOGIN_URL = "https://moivlozuvanja.kbinvest.mk/#/login?returnUrl=%2Fhome"

def clean_value_to_float(text):
    """
    Converts '18.116.472,89 MKD' -> float(18116472.89)
    """
    if not text: return 0.0
    clean = text.replace("MKD", "").replace("Mkd", "").strip()
    clean = clean.replace(".", "")
    clean = clean.replace(",", ".")
    try:
        return float(clean)
    except:
        return 0.0

def extract_date_from_text(text):
    match = re.search(r'\\d{2}\\.\\d{2}\\.\\d{4}', text)
    return match.group(0) if match else "00.00.0000"

def get_usd_to_mkd_rate():
    """
    Fetches USD -> MKD rate from Central Bank of North Macedonia with CurrencyAPI fallback.
    """
    import urllib.request
    import json
    from datetime import datetime, timedelta
    
    # Try Central Bank first (master source)
    for i in range(7):
        target_date = (datetime.now() - timedelta(days=i)).strftime("%d.%m.%Y")
        url = f"https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate={target_date}&EndDate={target_date}&format=json"
        
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            
            with urllib.request.urlopen(req, timeout=10) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode())
                    
                    if data and len(data) > 0:
                        for entry in data:
                            if entry.get("oznaka") == "USD":
                                rate = float(entry.get("sreden"))
                                if 40 <= rate <= 80:
                                    print(f"✓ Central Bank rate: 1 USD = {rate} MKD ({target_date})")
                                    return rate
                                    
        except Exception as e:
            print(f"Central Bank failed for {target_date}: {e}")
            continue
    
    # Fallback to CurrencyAPI
    print("Central Bank failed, trying CurrencyAPI...")
    try:
        req = urllib.request.Request('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json')
        req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            rate = data.get('usd', {}).get('mkd')
            
            if rate and 40 <= rate <= 80:
                print(f"✓ CurrencyAPI rate: 1 USD = {rate} MKD")
                return float(rate)
                
    except Exception as e:
        print(f"CurrencyAPI failed: {e}")
    
    # If all sources fail, raise an error
    raise Exception("Unable to fetch USD/MKD exchange rate from any source") 

def scrape_and_convert():
    # --- HEADLESS SETUP ---
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 20)

    res_date = "00.00.0000"
    mkd_balance = 0.0

    try:
        # 1. LOGIN
        driver.get(LOGIN_URL)
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "input")))
        time.sleep(2) 
        
        inputs = driver.find_elements(By.TAG_NAME, "input")
        user_field = None
        pass_field = None
        
        for inp in inputs:
            inp_type = inp.get_attribute("type")
            if inp_type == "password":
                pass_field = inp
            elif inp_type in ["text", "email", "url", "search"] and user_field is None:
                user_field = inp

        if user_field and pass_field:
            user_field.clear()
            user_field.send_keys(USERNAME)
            pass_field.clear()
            pass_field.send_keys(PASSWORD)
            
            try:
                login_btn = driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
            except:
                login_btn = driver.find_element(By.XPATH, "//button[contains(., 'Влез') or contains(., 'Log')]")
            driver.execute_script("arguments[0].click();", login_btn)
        else:
            print(f"00.00.0000;0.00")
            return

        # 2. WAIT FOR DATA
        wait.until(EC.presence_of_element_located((By.XPATH, "//*[contains(text(), 'Вкупна состојба')]")))
        time.sleep(5) 

        # 3. EXTRACT DATE
        try:
            date_label = driver.find_element(By.XPATH, "//*[contains(text(), 'Вкупна состојба на ден')]")
            found_date = extract_date_from_text(date_label.text)
            if found_date == "00.00.0000":
                parent_text = date_label.find_element(By.XPATH, "./..").text
                found_date = extract_date_from_text(parent_text)
            res_date = found_date
        except:
            pass

        # 4. EXTRACT BALANCE (MKD)
        try:
            total_bal_element = driver.find_element(By.XPATH, "//*[contains(text(), 'Состојба')]/following::*[contains(text(), 'MKD')][1]")
            mkd_balance = clean_value_to_float(total_bal_element.text)
        except:
            pass

        # 5. CONVERT TO USD
        rate = get_usd_to_mkd_rate()
        
        if rate and mkd_balance > 0:
            usd_balance = mkd_balance / rate
            formatted_usd = "{:.2f}".format(usd_balance)
            # Output: Date;Amount (No text)
            print(f"{res_date};{formatted_usd}")
        else:
            print(f"{res_date};0.00")

    except Exception as e:
        print(f"00.00.0000;0.00")

    finally:
        driver.quit()

if __name__ == "__main__":
    scrape_and_convert()
`;
      await writeFile(scriptPath, scriptContent, 'utf-8');
    }

    // Run the Python script
    return new Promise<Response>((resolve) => {
      const pythonProcess = spawn('python', [scriptPath], {
        env: {
          ...process.env,
          KB_FUNDS_USERNAME: process.env.KB_FUNDS_USERNAME || 'natmarkovska',
          KB_FUNDS_PASSWORD: process.env.KB_FUNDS_PASSWORD || 'sofievaMKD42*',
        },
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        // Log all output for debugging
        console.log('[KB Funds Scraper] Python process exited with code:', code);
        console.log('[KB Funds Scraper] stdout:', stdout);
        console.log('[KB Funds Scraper] stderr:', stderr);

        if (code !== 0) {
          const errorMsg = stderr || stdout || 'Unknown error';
          console.error('[KB Funds Scraper] Python script failed:', errorMsg);
          resolve(NextResponse.json(
            { success: false, error: `Scraper failed (exit code ${code}): ${errorMsg}` },
            { status: 500 }
          ));
          return;
        }

        // Check if output is empty
        const trimmedOutput = stdout.trim();
        if (!trimmedOutput || trimmedOutput.length === 0) {
          console.error('[KB Funds Scraper] Empty output from Python script');
          console.error('[KB Funds Scraper] stderr was:', stderr);
          resolve(NextResponse.json(
            { success: false, error: `Scraper returned empty output. Check if Python, Selenium, and ChromeDriver are installed. stderr: ${stderr || 'none'}` },
            { status: 500 }
          ));
          return;
        }

        try {
          // Parse output: "DD.MM.YYYY;amount"
          const parts = trimmedOutput.split(';');
          if (parts.length !== 2) {
            console.error('[KB Funds Scraper] Invalid output format. Expected "DD.MM.YYYY;amount", got:', trimmedOutput);
            throw new Error(`Invalid output format: "${trimmedOutput}". Expected format: "DD.MM.YYYY;amount"`);
          }

          const date = parts[0].trim();
          const amountStr = parts[1].trim();
          const amount = parseFloat(amountStr);

          if (isNaN(amount)) {
            console.error('[KB Funds Scraper] Invalid amount:', amountStr);
            throw new Error(`Invalid amount: "${amountStr}". Could not parse as number.`);
          }

          // Validate date format
          if (!date || date === '00.00.0000') {
            console.warn('[KB Funds Scraper] Warning: Date is 00.00.0000, using today\'s date');
            const today = new Date();
            const formattedDate = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
            resolve(NextResponse.json({
              success: true,
              date: formattedDate,
              amount,
              timestamp: new Date().toISOString(),
            }));
            return;
          }

          resolve(NextResponse.json({
            success: true,
            date,
            amount,
            timestamp: new Date().toISOString(),
          }));
        } catch (error) {
          console.error('[KB Funds Scraper] Error parsing output:', error);
          console.error('[KB Funds Scraper] Raw stdout:', JSON.stringify(stdout));
          console.error('[KB Funds Scraper] Raw stderr:', JSON.stringify(stderr));
          resolve(NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Parse error', details: { stdout, stderr } },
            { status: 500 }
          ));
        }
      });
    });
  } catch (error) {
    console.error('[KB Funds Scraper] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

