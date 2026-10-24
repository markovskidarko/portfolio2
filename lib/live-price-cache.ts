/**
 * Live Price Cache Service
 * Reads prices from cache (live_prices table) - NO fetching on-demand
 * Price fetching is done by the background worker (/api/update-live-prices)
 */

import { livePriceQueries } from '@/lib/database';
import { fetchYahooPrices } from '@/lib/price-services/yahoo-finance';
import type { PriceData } from '@/lib/price-services/yahoo-finance';

const CACHE_STALE_MS = 60000; // 60 seconds - prices are considered stale after this
const CACHE_MAX_AGE_MS = 3600000; // 1 hour - use cached prices even if stale if fetch fails

/**
 * Get prices ONLY from cache (live_prices table) - no fetching
 * This is the function used by the dashboard API
 * @param symbols Array of symbols to get prices for (already mapped to Yahoo Finance format)
 * @returns Map of symbol -> PriceData (only cached prices, no fetching)
 */
export async function getPricesFromCache(symbols: string[]): Promise<Map<string, PriceData>> {
  
  const prices = new Map<string, PriceData>();
  const now = Date.now();
  
  // Only read from cache - no fetching
  for (const symbol of symbols) {
    const cached = await livePriceQueries.get(symbol) as {
      price: number;
      previous_close?: number | null;
      previous_close_date?: string | null;
      updated_at: string;
      source: string;
    } | undefined;
    
    if (cached) {
      const updatedAt = new Date(cached.updated_at).getTime();
      const age = now - updatedAt;
      
      // Use cached price regardless of age (background worker will update it)
      const timestamp = new Date(cached.updated_at);
      prices.set(symbol, {
        symbol,
        price: cached.price,
        previousClose: cached.previous_close !== null && cached.previous_close !== undefined ? cached.previous_close : undefined,
        currency: 'USD', // Default, could be enhanced
        timestamp: timestamp,
      });
      
      // Debug log for all symbols to verify previous_close retrieval
      if (cached.previous_close !== null && cached.previous_close !== undefined) {
        console.log(`[Price Cache] ✓ ${symbol}: Price=$${cached.price.toFixed(2)}, PreviousClose=$${cached.previous_close.toFixed(2)} (date: ${cached.previous_close_date ?? 'NULL'})`);
      } else {
        console.warn(`[Price Cache] ⚠️ ${symbol}: Price=$${cached.price.toFixed(2)}, PreviousClose=NULL (not in database)`);
      }
    }
  }
  
  console.log(`[Price Cache] Retrieved ${prices.size}/${symbols.length} prices from cache (read-only)`);
  return prices;
}

/**
 * Get prices from cache, fetching if stale or missing
 * @param symbols Array of symbols to get prices for (already mapped to Yahoo Finance format)
 * @returns Map of symbol -> PriceData
 */
export async function getCachedPrices(symbols: string[]): Promise<Map<string, PriceData>> {
  
  const prices = new Map<string, PriceData>();
  const symbolsToFetch: string[] = [];
  const staleCache = new Map<string, { price: number; updated_at: string }>();
  const now = Date.now();
  
  // Check cache for each symbol
  for (const symbol of symbols) {
    const cached = await livePriceQueries.get(symbol) as {
      price: number;
      previous_close?: number;
      updated_at: string;
      source: string;
    } | undefined;
    
    if (cached) {
      const updatedAt = new Date(cached.updated_at).getTime();
      const age = now - updatedAt;
      
      if (age < CACHE_STALE_MS) {
        // Cache is fresh, use it
        prices.set(symbol, {
          symbol,
          price: cached.price,
          previousClose: cached.previous_close ?? undefined,
          currency: 'USD', // Default, could be enhanced
          timestamp: new Date(cached.updated_at),
        });
        continue;
      } else if (age < CACHE_MAX_AGE_MS) {
        // Cache is stale but not too old - save as fallback
        staleCache.set(symbol, { price: cached.price, updated_at: cached.updated_at });
      }
    }
    
    // Cache is stale or missing, mark for fetching
    symbolsToFetch.push(symbol);
  }
  
  // Fetch missing/stale prices with timeout
  if (symbolsToFetch.length > 0) {
    console.log(`[Price Cache] Fetching ${symbolsToFetch.length} stale/missing prices: ${symbolsToFetch.join(', ')}`);
    
    try {
      // Set a maximum time budget: 30 seconds for fetching prices
      // If it takes longer, use stale cache or skip
      const fetchPromise = fetchYahooPrices(symbolsToFetch);
      const timeoutPromise = new Promise<Map<string, PriceData>>((resolve) => {
        setTimeout(() => {
          console.warn(`[Price Cache] Price fetch taking too long, using stale cache where available`);
          resolve(new Map()); // Return empty map, will fall back to stale cache
        }, 30000); // 30 second timeout
      });
      
      const fetchedPrices = await Promise.race([fetchPromise, timeoutPromise]);
      
      // Update cache with fetched prices
      for (const [symbol, priceData] of fetchedPrices.entries()) {
        await livePriceQueries.upsert(symbol, priceData.price, priceData.previousClose ?? null, null, 'yahoo');
        prices.set(symbol, priceData);
        staleCache.delete(symbol); // Remove from stale cache if successfully fetched
      }
      
      // Use stale cache for symbols that weren't successfully fetched
      for (const symbol of symbolsToFetch) {
        if (!prices.has(symbol) && staleCache.has(symbol)) {
          const stale = staleCache.get(symbol)!;
          console.log(`[Price Cache] Using stale cache for ${symbol} (age: ${Math.round((now - new Date(stale.updated_at).getTime()) / 1000)}s)`);
          prices.set(symbol, {
            symbol,
            price: stale.price,
            currency: 'USD',
            timestamp: new Date(stale.updated_at),
          });
        }
      }
    } catch (error) {
      console.error(`[Price Cache] Error fetching prices:`, error);
      // Fall back to stale cache on error
      for (const symbol of symbolsToFetch) {
        if (!prices.has(symbol) && staleCache.has(symbol)) {
          const stale = staleCache.get(symbol)!;
          // Get previous_close from DB if available
          const cachedFromDb = await livePriceQueries.get(symbol) as { previous_close?: number } | undefined;
          console.log(`[Price Cache] Using stale cache for ${symbol} due to fetch error`);
          prices.set(symbol, {
            symbol,
            price: stale.price,
            previousClose: cachedFromDb?.previous_close ?? undefined,
            currency: 'USD',
            timestamp: new Date(stale.updated_at),
          });
        }
      }
    }
  }
  
  return prices;
}

