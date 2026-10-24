/**
 * TradingView Screener API price fetching service
 * Uses TradingView's screener API to fetch live stock prices
 */

export interface PriceData {
  symbol: string;
  price: number;
  currency: string;
  timestamp: Date;
}

/**
 * Fetch prices from TradingView quote API
 * Uses TradingView's quote endpoint to get symbol data
 */
export async function fetchTradingViewPrice(symbol: string): Promise<PriceData | null> {
  try {
    // TradingView quote API endpoint
    // Format: GET https://symbol-search.tradingview.com/symbol_search/?text={symbol}&exchange=&lang=en&search_type=undefined&domain=production&sort_by_country=US
    // Then use the quote endpoint: https://scanner.tradingview.com/america/scan
    const url = 'https://scanner.tradingview.com/america/scan';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        filter: [
          {
            left: 'name',
            operation: 'match',
            right: symbol,
          },
        ],
        columns: ['name', 'close'],
        sort: { sortBy: 'name', sortOrder: 'asc' },
        range: [0, 1],
      }),
    });

    if (!response.ok) {
      console.error(`[TradingView] Failed to fetch ${symbol}: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      console.error(`[TradingView] No data for symbol ${symbol}`);
      return null;
    }

    const symbolData = data.data[0];
    // TradingView returns data in format: { s: [symbol info], d: [data array] }
    // 'close' column is typically at index 4 in the d array, but let's try to find it
    const priceData = symbolData.d;
    if (!priceData || priceData.length < 2) {
      console.error(`[TradingView] Invalid data format for symbol ${symbol}`);
      return null;
    }

    // Try to find close price - it's typically the last numeric value
    let price: number | null = null;
    for (let i = priceData.length - 1; i >= 0; i--) {
      if (typeof priceData[i] === 'number' && priceData[i] > 0) {
        price = priceData[i];
        break;
      }
    }
    
    if (price === null) {
      console.error(`[TradingView] No price data found for symbol ${symbol}`);
      return null;
    }

    return {
      symbol,
      price: price,
      currency: 'USD', // TradingView typically returns USD
      timestamp: new Date(),
    };
  } catch (error) {
    console.error(`[TradingView] Error fetching ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch multiple prices from TradingView (can batch multiple symbols in one request)
 */
export async function fetchTradingViewPrices(symbols: string[]): Promise<Map<string, PriceData>> {
  const prices = new Map<string, PriceData>();
  
  try {
    // TradingView screener API supports batching
    const url = 'https://scanner.tradingview.com/symbols';
    
    // Create filter for all symbols
    const filters = symbols.map(symbol => ({
      left: 'name',
      operation: 'match',
      right: symbol,
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        filter: filters.length === 1 ? filters[0] : {
          left: 'name',
          operation: 'in_range',
          right: symbols,
        },
        columns: ['name', 'close'],
        sort: { sortBy: 'name', sortOrder: 'asc' },
        range: [0, symbols.length],
      }),
    });

    if (!response.ok) {
      console.error(`[TradingView] Failed to fetch batch: HTTP ${response.status}`);
      // Fallback to individual requests
      return await fetchTradingViewPricesIndividual(symbols);
    }

    const data = await response.json();
    
    if (data.data && Array.isArray(data.data)) {
      for (const symbolData of data.data) {
        const symbol = symbolData.s?.[0]; // symbol name
        const price = symbolData.d?.[1]; // close price
        
        if (symbol && price !== null && price !== undefined) {
          prices.set(symbol, {
            symbol,
            price: parseFloat(price),
            currency: 'USD',
            timestamp: new Date(),
          });
        }
      }
    }

    // Fetch any missing symbols individually
    const missingSymbols = symbols.filter(s => !prices.has(s));
    if (missingSymbols.length > 0) {
      const individualPrices = await fetchTradingViewPricesIndividual(missingSymbols);
      for (const [symbol, priceData] of individualPrices.entries()) {
        prices.set(symbol, priceData);
      }
    }
  } catch (error) {
    console.error('[TradingView] Error in batch fetch, falling back to individual requests:', error);
    return await fetchTradingViewPricesIndividual(symbols);
  }

  return prices;
}

/**
 * Fallback: Fetch prices individually
 */
async function fetchTradingViewPricesIndividual(symbols: string[]): Promise<Map<string, PriceData>> {
  const prices = new Map<string, PriceData>();
  
  // Add small delay between requests to be respectful
  for (const symbol of symbols) {
    const priceData = await fetchTradingViewPrice(symbol);
    if (priceData) {
      prices.set(symbol, priceData);
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return prices;
}

