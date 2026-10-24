/**
 * Exchange Rate Service - Fetches USD/MKD rates from Central Bank and fallback sources
 */

export interface ExchangeRateResult {
  rate: number;
  date: string;
  source: string;
}

// Module-level cache for exchange rate (shared across all requests)
let cachedRate: { result: ExchangeRateResult; timestamp: number } | null = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Fetch USD/MKD rate from Central Bank of North Macedonia (NBRM)
 * Looks back up to 7 days to find the latest business day rate
 */
async function fetchFromCentralBank(): Promise<ExchangeRateResult | null> {
  // Look back up to 7 days to find a business day
  for (let i = 0; i < 7; i++) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - i);
    const dateStr = targetDate.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric'
    }).replace(/\//g, '.');

    const url = `https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate=${dateStr}&EndDate=${dateStr}&format=json`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        const data = await response.json();
        
        // If we found data for this date (business day)
        if (data && Array.isArray(data) && data.length > 0) {
          // Search for USD entry
          const usdEntry = data.find(entry => entry.oznaka === 'USD');
          
          if (usdEntry && usdEntry.sreden) {
            const rate = parseFloat(usdEntry.sreden);
            
            if (rate > 40 && rate < 80) { // Validate reasonable range
              console.log(`[Exchange Rate] ✅ Central Bank (NBRM): ${rate} MKD (${dateStr})`);
              return {
                rate,
                date: dateStr,
                source: 'Central Bank of North Macedonia'
              };
            }
          }
        }
      }
    } catch (error) {
      console.warn(`[Exchange Rate] Central Bank failed for ${dateStr}:`, error);
      // Continue to previous day
    }
  }
  
  return null;
}

/**
 * Fetch USD/MKD rate from CurrencyAPI (backup source)
 */
async function fetchFromCurrencyAPI(): Promise<ExchangeRateResult | null> {
  try {
    const response = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (response.ok) {
      const data = await response.json();
      const rate = data.usd?.mkd;
      
      if (rate && typeof rate === 'number' && rate > 40 && rate < 80) {
        console.log(`[Exchange Rate] ✅ CurrencyAPI (backup): ${rate} MKD`);
        return {
          rate,
          date: new Date().toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }).replace(/\//g, '.'),
          source: 'CurrencyAPI'
        };
      }
    }
  } catch (error) {
    console.warn('[Exchange Rate] CurrencyAPI failed:', error);
  }
  
  return null;
}

/**
 * Get current USD/MKD exchange rate from multiple sources
 * Priority: 1) Central Bank of North Macedonia, 2) CurrencyAPI
 * Uses module-level caching to avoid excessive API calls
 */
export async function getExchangeRate(): Promise<ExchangeRateResult> {
  // Check cache first
  const now = Date.now();
  if (cachedRate && (now - cachedRate.timestamp) < CACHE_DURATION) {
    return cachedRate.result;
  }
  
  console.log('[Exchange Rate] Fetching USD/MKD rate...');
  
  // Try Central Bank first (master source)
  const centralBankRate = await fetchFromCentralBank();
  if (centralBankRate) {
    cachedRate = { result: centralBankRate, timestamp: now };
    return centralBankRate;
  }
  
  // Fallback to CurrencyAPI
  console.log('[Exchange Rate] Central Bank failed, trying CurrencyAPI...');
  const currencyApiRate = await fetchFromCurrencyAPI();
  if (currencyApiRate) {
    cachedRate = { result: currencyApiRate, timestamp: now };
    return currencyApiRate;
  }
  
  // Ultimate fallback - use cached value if available, even if expired
  if (cachedRate) {
    console.warn('[Exchange Rate] ⚠️ All sources failed, using cached rate');
    return cachedRate.result;
  }
  
  // Ultimate fallback - should never happen
  console.error('[Exchange Rate] ❌ All sources failed!');
  throw new Error('Unable to fetch USD/MKD exchange rate from any source');
}

/**
 * Test function to verify exchange rate fetching
 */
export async function testExchangeRate(): Promise<void> {
  try {
    const result = await getExchangeRate();
    console.log('Exchange Rate Test Result:', result);
  } catch (error) {
    console.error('Exchange Rate Test Failed:', error);
  }
}


