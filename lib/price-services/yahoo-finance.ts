/**
 * Yahoo Finance price fetching service
 */

import { mapSymbolForYahoo } from '../symbol-mapper';
import {
  selectPriceFromYahooMeta,
  type MarketSession,
  type YahooChartMetaLike,
} from '../market-session';

export type { MarketSession };

export interface PriceData {
  symbol: string;
  price: number;
  previousClose?: number;
  currency: string;
  timestamp: Date;
  change?: number;
  changePercent?: number;
  /** Active session when price was selected (pre / regular / post / closed). */
  session?: MarketSession;
  /**
   * True when `price` is just `previousClose` because no session-appropriate
   * quote was available (e.g. pre-market session but no pre-market print yet).
   * Callers should treat this as "no live data" rather than overwriting a
   * previously-cached real price.
   */
  isStale?: boolean;
}

export interface HistoricalPriceData {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Fetch price for a single symbol from Yahoo Finance with retry logic
 */
export async function fetchYahooPrice(symbol: string, retries: number = 2): Promise<PriceData | null> {
  const mappedSymbol = mapSymbolForYahoo(symbol);
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Use 1-minute intraday bars so we can read actual pre/post-market trades.
      // Yahoo's meta.preMarketPrice / postMarketPrice are unreliable on the
      // /chart endpoint (often null even when trades are printing), but the
      // intraday bar series under indicators.quote DOES include extended-hours
      // prints when includePrePost=true. We synthesize the session-specific
      // meta fields from the most recent bar in each session window below.
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mappedSymbol)}?interval=1m&range=1d&includePrePost=true`;
      
      if (attempt === 0) {
        console.log(`[Yahoo Finance] Fetching ${symbol} (mapped to ${mappedSymbol})`);
      } else {
        console.log(`[Yahoo Finance] Retrying ${symbol} (${mappedSymbol}) - attempt ${attempt + 1}/${retries + 1}`);
      }
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout (increased for reliability)
      
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          if (attempt < retries && (response.status === 429 || response.status >= 500)) {
            // Retry on rate limit or server errors
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
            continue;
          }
          console.error(`[Yahoo Finance] Failed to fetch ${symbol} (${mappedSymbol}): ${response.status} ${response.statusText}`);
          return null;
        }
        
        const data = await response.json();
        
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
          console.error(`[Yahoo Finance] No data for ${symbol} (${mappedSymbol}). Response:`, JSON.stringify(data).substring(0, 200));
          return null;
        }
        
        const result = data.chart.result[0];
        const meta = result.meta as YahooChartMetaLike & { currency?: string };

        if (!meta) {
          console.error(`[Yahoo Finance] Invalid data structure for ${symbol} (${mappedSymbol}): missing meta`);
          return null;
        }

        // Build a session-aware meta by reading the most recent intraday bar
        // in each session window from currentTradingPeriod. This replaces
        // Yahoo's flaky meta.preMarketPrice/postMarketPrice fields with values
        // we derived from the actual trade tape.
        const augmentedMeta = augmentMetaWithIntradayBars(meta, result);
        const selected = selectPriceFromYahooMeta(augmentedMeta);
        const currentPrice = selected.price || 0;
        const previousClose = selected.previousClose || 0;
        const change = currentPrice - previousClose;
        const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
        
        const staleSuffix = selected.isStale ? ' [STALE: no session quote, using previousClose]' : '';
        if (attempt > 0) {
          console.log(
            `[Yahoo Finance] ✓ ${symbol} (${mappedSymbol}) after ${attempt + 1} attempts: $${currentPrice} [${selected.session}]${staleSuffix}`
          );
        } else {
          console.log(
            `[Yahoo Finance] ✓ ${symbol} (${mappedSymbol}): $${currentPrice} [${selected.session}]${staleSuffix} (prev: $${previousClose})`
          );
        }

        return {
          symbol,
          price: currentPrice,
          previousClose,
          currency: meta.currency || 'USD',
          timestamp: selected.timestamp,
          change,
          changePercent,
          session: selected.session,
          isStale: selected.isStale,
        };
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        // Check if it's a timeout or connection error
        if (fetchError.name === 'AbortError' || 
            fetchError.code === 'UND_ERR_CONNECT_TIMEOUT' ||
            fetchError.message?.includes('timeout') ||
            fetchError.message?.includes('ECONNRESET')) {
          
          if (attempt < retries) {
            const delay = 1000 * (attempt + 1); // Exponential backoff: 1s, 2s, 3s
            console.warn(`[Yahoo Finance] Timeout/connection error for ${symbol} (${mappedSymbol}), retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          } else {
            console.error(`[Yahoo Finance] Timeout/connection error for ${symbol} (${mappedSymbol}) after ${retries + 1} attempts`);
            return null;
          }
        }
        
        // For other errors, don't retry
        throw fetchError;
      }
    } catch (error: any) {
      if (attempt < retries && (error.code === 'UND_ERR_CONNECT_TIMEOUT' || error.message?.includes('timeout'))) {
        const delay = 1000 * (attempt + 1);
        console.warn(`[Yahoo Finance] Error for ${symbol} (${mappedSymbol}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      console.error(`[Yahoo Finance] Error fetching ${symbol} (${mappedSymbol}):`, error);
      return null;
    }
  }

  return null;
}

/**
 * Read the most recent non-null close from the intraday bar series whose
 * timestamp falls inside the given [start, end) window. Returns undefined when
 * no bar in that window has a price (no trades printed during the session yet).
 */
function latestBarCloseInWindow(
  timestamps: number[] | undefined,
  closes: (number | null)[] | undefined,
  startSec: number,
  endSec: number
): { close: number; ts: number } | undefined {
  if (!timestamps || !closes || timestamps.length === 0) return undefined;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const ts = timestamps[i];
    const c = closes[i];
    if (ts >= startSec && ts < endSec && c != null && c > 0) {
      return { close: c, ts };
    }
  }
  return undefined;
}

/**
 * Yahoo's meta.preMarketPrice / postMarketPrice fields on the chart endpoint
 * are unreliable — frequently null even while real extended-hours trades print.
 * This helper rebuilds those fields by scanning the actual intraday bars in
 * each session window from currentTradingPeriod, so the strict selector in
 * `selectPriceFromYahooMeta` has the right inputs to pick from.
 */
function augmentMetaWithIntradayBars(
  meta: YahooChartMetaLike & { currency?: string },
  result: any
): YahooChartMetaLike & { currency?: string } {
  const period = meta.currentTradingPeriod;
  if (!period?.pre || !period?.regular || !period?.post) {
    // Symbol has no session windows (e.g. crypto) — leave meta untouched.
    return meta;
  }

  const timestamps: number[] | undefined = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  const closes: (number | null)[] | undefined = quote?.close;
  if (!timestamps || !closes) return meta;

  const augmented: YahooChartMetaLike & { currency?: string } = { ...meta };

  const preBar = latestBarCloseInWindow(timestamps, closes, period.pre.start, period.pre.end);
  if (preBar) {
    augmented.preMarketPrice = preBar.close;
    augmented.preMarketTime = preBar.ts;
  }

  const regBar = latestBarCloseInWindow(timestamps, closes, period.regular.start, period.regular.end);

  // Decide previousClose BEFORE overriding regularMarketPrice. Two cases:
  //   - Today has a regular-session bar → meta.regularMarketPrice (about to be
  //     overwritten) was the latest INTRADAY tick from Yahoo, so the prior
  //     trading day's close is in meta.chartPreviousClose / meta.previousClose.
  //   - Today has no regular bar (pre-market, or closed before open) →
  //     meta.regularMarketPrice IS yesterday's close (regularMarketTime points
  //     to the previous session). Use it as previousClose so pre-market % is
  //     measured against the most recent regular close, not 2 days back.
  if (regBar) {
    augmented.previousClose =
      meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPrice;
    augmented.regularMarketPrice = regBar.close;
    augmented.regularMarketTime = regBar.ts;
  } else {
    augmented.previousClose =
      meta.regularMarketPrice ?? meta.previousClose ?? meta.chartPreviousClose;
  }

  const postBar = latestBarCloseInWindow(timestamps, closes, period.post.start, period.post.end);
  if (postBar) {
    augmented.postMarketPrice = postBar.close;
    augmented.postMarketTime = postBar.ts;
  }

  return augmented;
}

/**
 * Fetch prices for multiple symbols from Yahoo Finance
 * Fetches symbols in batches to avoid overwhelming the API
 */
export async function fetchYahooPrices(symbols: string[]): Promise<Map<string, PriceData>> {
  if (symbols.length === 0) {
    return new Map();
  }
  
  const prices = new Map<string, PriceData>();
  const BATCH_SIZE = 5; // Process 5 symbols at a time (reduced to avoid rate limiting)
  const BATCH_DELAY = 1000; // 1 second delay between batches (increased to avoid rate limiting)
  
  // Process symbols in batches to avoid rate limiting and connection issues
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    
    // Fetch batch in parallel
    const fetchPromises = batch.map(async (symbol) => {
      try {
        const priceData = await fetchYahooPrice(symbol);
        if (priceData) {
          return { symbol, priceData };
        }
      } catch (error) {
        console.error(`[Yahoo Finance] Error fetching ${symbol}:`, error);
      }
      return null;
    });
    
    const results = await Promise.all(fetchPromises);
    
    for (const result of results) {
      if (result) {
        prices.set(result.symbol, result.priceData);
      }
    }
    
    // Add delay between batches (except for the last batch)
    if (i + BATCH_SIZE < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
  
  return prices;
}

/**
 * Fetch historical price data for a symbol from Yahoo Finance
 */
export async function fetchYahooHistoricalData(
  symbol: string, 
  startDate: Date, 
  endDate: Date
): Promise<HistoricalPriceData[]> {
  const mappedSymbol = mapSymbolForYahoo(symbol);
  
  try {
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);
    
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mappedSymbol)}?period1=${startTimestamp}&period2=${endTimestamp}&interval=1d`;
    console.log(`[Yahoo Finance Historical] Fetching ${symbol} (${mappedSymbol}) from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      console.error(`[Yahoo Finance Historical] Failed to fetch ${symbol}: ${response.status} ${response.statusText}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      console.error(`[Yahoo Finance Historical] No data for ${symbol}`);
      return [];
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    const adjclose = result.indicators?.adjclose?.[0];
    
    if (!timestamps || !quote) {
      console.error(`[Yahoo Finance Historical] Invalid data structure for ${symbol}`);
      return [];
    }
    
    const historicalData: HistoricalPriceData[] = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      // Skip entries with null values
      if (quote.close[i] === null || quote.open[i] === null) continue;
      
      // Use adjusted close if available (accounts for dividends), otherwise use regular close
      const adjustedClose = adjclose && adjclose[i] !== null ? adjclose[i] : quote.close[i];
      
      historicalData.push({
        date: new Date(timestamps[i] * 1000),
        open: quote.open[i] || 0,
        high: quote.high[i] || 0,
        low: quote.low[i] || 0,
        close: adjustedClose || quote.close[i] || 0, // Use adjusted close for total return
        volume: quote.volume[i] || 0
      });
    }
    
    // Sort by date (oldest first)
    historicalData.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    console.log(`[Yahoo Finance Historical] Retrieved ${historicalData.length} data points for ${symbol}`);
    return historicalData;
    
  } catch (error) {
    console.error(`[Yahoo Finance Historical] Error fetching ${symbol}:`, error);
    return [];
  }
}
