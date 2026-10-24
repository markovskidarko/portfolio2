/**
 * Market Data Acquisition Module
 * Fetches historical market data for portfolio assets using Yahoo Finance API
 */

import { format, subYears } from "date-fns";
import { mapSymbolForYahoo } from "./symbol-mapper";

export interface AssetPriceData {
  date: Date;
  close: number;
  adjustedClose: number;
}

export interface AssetStatistics {
  symbol: string;
  annualizedReturn: number; // Annualized mean return (decimal, e.g., 0.15 = 15%)
  annualizedVolatility: number; // Annualized volatility (decimal, e.g., 0.20 = 20%)
  dataPoints: number; // Number of data points used
  startDate: Date;
  endDate: Date;
}

export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][]; // Correlation coefficient matrix (symmetric)
}

const TRADING_DAYS_PER_YEAR = 252;

/**
 * Fetch historical price data from Yahoo Finance for a single symbol
 * Attempts to fetch 10 years of data, falls back to maximum available
 */
export async function fetchHistoricalPrices(
  symbol: string,
  maxYears: number = 10
): Promise<AssetPriceData[]> {
  try {
    // Map symbol to Yahoo Finance format
    const mappedSymbol = mapSymbolForYahoo(symbol);
    
    // Yahoo Finance API for historical data
    // Use maximum range available (up to maxYears)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mappedSymbol)}?range=${maxYears}y&interval=1d`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[Market Data] Failed to fetch ${symbol}: HTTP ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      console.warn(`[Market Data] No data for symbol ${symbol}`);
      return [];
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const adjustedCloses = result.indicators?.adjclose?.[0]?.adjclose || [];
    
    if (timestamps.length === 0 || closes.length === 0) {
      console.warn(`[Market Data] No timestamp or price data for ${symbol}`);
      return [];
    }
    
    const priceData: AssetPriceData[] = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i] * 1000; // Convert to milliseconds
      const close = closes[i];
      const adjustedClose = adjustedCloses && adjustedCloses[i] !== undefined 
        ? adjustedCloses[i] 
        : close;
      
      if (close !== null && close !== undefined && close > 0) {
        priceData.push({
          date: new Date(timestamp),
          close: close,
          adjustedClose: adjustedClose || close,
        });
      }
    }
    
    // Sort by date (oldest first)
    priceData.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    console.log(`[Market Data] Fetched ${priceData.length} data points for ${symbol} (from ${format(priceData[0]?.date || new Date(), 'yyyy-MM-dd')} to ${format(priceData[priceData.length - 1]?.date || new Date(), 'yyyy-MM-dd')})`);
    
    return priceData;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[Market Data] Timeout fetching ${symbol}`);
    } else {
      console.warn(`[Market Data] Error fetching ${symbol}:`, error);
    }
    return [];
  }
}

/**
 * Calculate daily returns from price data
 */
function calculateDailyReturns(prices: AssetPriceData[]): number[] {
  const returns: number[] = [];
  
  for (let i = 1; i < prices.length; i++) {
    const prevAdjClose = prices[i - 1].adjustedClose;
    const currAdjClose = prices[i].adjustedClose;
    
    if (prevAdjClose > 0) {
      const dailyReturn = (currAdjClose / prevAdjClose) - 1;
      returns.push(dailyReturn);
    }
  }
  
  return returns;
}

/**
 * Calculate asset statistics (annualized return and volatility) from price data
 */
export function calculateAssetStatistics(
  symbol: string,
  prices: AssetPriceData[]
): AssetStatistics | null {
  if (prices.length < 2) {
    return null;
  }
  
  const dailyReturns = calculateDailyReturns(prices);
  
  if (dailyReturns.length === 0) {
    return null;
  }
  
  // Calculate mean and standard deviation
  const meanReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length;
  const volatility = Math.sqrt(variance);
  
  // Annualize metrics (using 252 trading days)
  const annualizedReturn = meanReturn * TRADING_DAYS_PER_YEAR;
  const annualizedVolatility = volatility * Math.sqrt(TRADING_DAYS_PER_YEAR);
  
  return {
    symbol,
    annualizedReturn,
    annualizedVolatility,
    dataPoints: dailyReturns.length,
    startDate: prices[0].date,
    endDate: prices[prices.length - 1].date,
  };
}

/**
 * Calculate correlation matrix for multiple assets based on their daily returns
 */
export function calculateCorrelationMatrix(
  assetsData: Map<string, AssetPriceData[]>
): CorrelationMatrix {
  const symbols = Array.from(assetsData.keys());
  const n = symbols.length;
  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
  
  // Convert price data to aligned daily returns
  // Find the common date range
  let commonStartDate: Date | null = null;
  let commonEndDate: Date | null = null;
  
  for (const prices of assetsData.values()) {
    if (prices.length === 0) continue;
    const start = prices[0].date;
    const end = prices[prices.length - 1].date;
    
    if (commonStartDate === null || start > commonStartDate) {
      commonStartDate = start;
    }
    if (commonEndDate === null || end < commonEndDate) {
      commonEndDate = end;
    }
  }
  
  if (commonStartDate === null || commonEndDate === null || commonStartDate >= commonEndDate) {
    // No overlap or invalid data - return identity matrix
    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
    }
    return { symbols, matrix };
  }
  
  // Create aligned return series
  const alignedReturns: Map<string, number[]> = new Map();
  
  for (const symbol of symbols) {
    const prices = assetsData.get(symbol) || [];
    // Filter to common date range
    const filteredPrices = prices.filter(p => 
      p.date >= commonStartDate! && p.date <= commonEndDate!
    );
    
    if (filteredPrices.length < 2) {
      alignedReturns.set(symbol, []);
      continue;
    }
    
    // Calculate returns for aligned dates
    const returns: number[] = [];
    for (let i = 1; i < filteredPrices.length; i++) {
      const prevAdjClose = filteredPrices[i - 1].adjustedClose;
      const currAdjClose = filteredPrices[i].adjustedClose;
      
      if (prevAdjClose > 0) {
        const dailyReturn = (currAdjClose / prevAdjClose) - 1;
        returns.push(dailyReturn);
      }
    }
    
    alignedReturns.set(symbol, returns);
  }
  
  // Calculate pairwise correlations
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1.0; // Perfect correlation with itself
      } else {
        const symbolI = symbols[i];
        const symbolJ = symbols[j];
        const returnsI = alignedReturns.get(symbolI) || [];
        const returnsJ = alignedReturns.get(symbolJ) || [];
        
        if (returnsI.length === 0 || returnsJ.length === 0) {
          matrix[i][j] = 0; // No data - assume no correlation
          continue;
        }
        
        // Align returns by index (assuming they're already aligned by date)
        const minLength = Math.min(returnsI.length, returnsJ.length);
        const alignedI = returnsI.slice(0, minLength);
        const alignedJ = returnsJ.slice(0, minLength);
        
        if (alignedI.length < 2) {
          matrix[i][j] = 0;
          continue;
        }
        
        // Calculate correlation coefficient
        const meanI = alignedI.reduce((sum, r) => sum + r, 0) / alignedI.length;
        const meanJ = alignedJ.reduce((sum, r) => sum + r, 0) / alignedJ.length;
        
        let covariance = 0;
        let varianceI = 0;
        let varianceJ = 0;
        
        for (let k = 0; k < alignedI.length; k++) {
          const devI = alignedI[k] - meanI;
          const devJ = alignedJ[k] - meanJ;
          covariance += devI * devJ;
          varianceI += devI * devI;
          varianceJ += devJ * devJ;
        }
        
        covariance /= alignedI.length;
        varianceI /= alignedI.length;
        varianceJ /= alignedI.length;
        
        const stdI = Math.sqrt(varianceI);
        const stdJ = Math.sqrt(varianceJ);
        
        if (stdI > 0 && stdJ > 0) {
          matrix[i][j] = covariance / (stdI * stdJ);
        } else {
          matrix[i][j] = 0;
        }
      }
    }
  }
  
  console.log(`[Market Data] Correlation matrix calculated for ${n} assets`);
  
  return { symbols, matrix };
}

/**
 * Fetch historical data for multiple symbols in parallel (with rate limiting)
 */
export async function fetchMultipleAssetData(
  symbols: string[],
  maxYears: number = 10
): Promise<Map<string, AssetPriceData[]>> {
  const results = new Map<string, AssetPriceData[]>();
  
  // Fetch in batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (symbol) => {
      const data = await fetchHistoricalPrices(symbol, maxYears);
      return { symbol, data };
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    for (const { symbol, data } of batchResults) {
      results.set(symbol, data);
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return results;
}

