/**
 * Live Price Service - Fetches real-time prices from Yahoo Finance
 * Replaces TWS for getting live portfolio prices
 */

import { holdingQueries, livePriceQueries, cashQueries } from './database';
import { fetchYahooPrices } from './price-services/yahoo-finance';
import { mapSymbolForYahoo, normalizeSymbol } from './symbol-mapper';

interface LivePriceUpdate {
  symbol: string;
  price: number;
  previousClose: number | null;
  previousCloseDate: string | null;
  source: string;
}

/**
 * Get all unique symbols from all holdings across all accounts
 */
async function getAllPortfolioSymbols(): Promise<string[]> {
  const { getDatabase } = await import('./database');
  const sql = getDatabase();
  const allHoldings = await sql`
    SELECT DISTINCT h.symbol
    FROM "Holdings" h
    INNER JOIN (
      SELECT account_id, symbol, MAX(report_date) as max_date
      FROM "Holdings"
      GROUP BY account_id, symbol
    ) latest ON h.account_id = latest.account_id 
      AND h.symbol = latest.symbol 
      AND h.report_date = latest.max_date
    WHERE h.symbol IS NOT NULL 
      AND h.symbol != ''
      AND h.symbol != 'CASH'
  ` as unknown as Array<{ symbol: string }>;

  // Normalize symbols (deduplicate EQQQ/EQQU, etc.)
  const symbolSet = new Set<string>();
  for (const holding of allHoldings) {
    const normalized = normalizeSymbol(holding.symbol);
    symbolSet.add(normalized);
  }

  return Array.from(symbolSet);
}

/**
 * Update live prices from Yahoo Finance for all portfolio symbols
 */
export async function updateLivePricesFromYahoo(): Promise<{
  success: boolean;
  updated: number;
  failed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let updated = 0;
  let failed = 0;

  try {
    // Get all symbols from holdings
    const symbols = await getAllPortfolioSymbols();
    
    if (symbols.length === 0) {
      console.log('[Live Prices] No symbols found in holdings');
      return { success: true, updated: 0, failed: 0, errors: [] };
    }

    console.log(`[Live Prices] Fetching prices for ${symbols.length} symbols from Yahoo Finance...`);

    // Map symbols to Yahoo Finance format
    const symbolToMapped = new Map<string, string>();
    for (const symbol of symbols) {
      const mapped = mapSymbolForYahoo(symbol);
      symbolToMapped.set(symbol, mapped);
    }

    // Fetch prices from Yahoo Finance using mapped symbols
    const mappedSymbols = Array.from(symbolToMapped.values());
    const prices = await fetchYahooPrices(mappedSymbols);

    let staleInvalidated = 0;
    for (const [originalSymbol, mappedSymbol] of symbolToMapped.entries()) {
      // Yahoo Finance returns prices keyed by the symbol we passed (mapped symbol)
      const priceData = prices.get(mappedSymbol);

      if (priceData) {
        // Stale = no session-appropriate quote available (e.g. pre-market but
        // symbol has no pre-market print). Invalidate any cached row so the
        // portfolio falls back to Holdings.mark_price (last regular close from
        // the most recent Flex sync) instead of serving a stale "live" value.
        if (priceData.isStale) {
          await livePriceQueries.invalidate(mappedSymbol);
          staleInvalidated++;
          console.log(
            `[Live Prices] ✗ ${mappedSymbol}: no ${priceData.session}-session quote — invalidated cache, will use mark_price`
          );
          continue;
        }

        try {
          // Store using mapped symbol (Yahoo Finance format)
          await livePriceQueries.upsert(
            mappedSymbol,
            priceData.price,
            priceData.previousClose || null,
            priceData.previousClose ? new Date().toISOString().split('T')[0] : null,
            `Yahoo Finance (${priceData.session ?? 'unknown'})`
          );
          updated++;
        } catch (error) {
          console.error(`[Live Prices] Failed to update ${mappedSymbol}:`, error);
          errors.push(`Failed to update ${mappedSymbol}: ${error instanceof Error ? error.message : String(error)}`);
          failed++;
        }
      } else {
        console.warn(`[Live Prices] No price data for ${mappedSymbol}`);
        failed++;
        errors.push(`No price data for ${mappedSymbol}`);
      }
    }
    if (staleInvalidated > 0) {
      console.log(`[Live Prices] Invalidated ${staleInvalidated} stale symbol(s) — those positions will use mark_price from Holdings`);
    }

    console.log(`[Live Prices] ✅ Updated ${updated} prices, ${failed} failed`);

    return {
      success: updated > 0,
      updated,
      failed,
      errors: errors.slice(0, 10), // Limit errors to first 10
    };
  } catch (error) {
    console.error('[Live Prices] Error updating prices:', error);
    return {
      success: false,
      updated,
      failed,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Calculate live NAV for a specific account using Yahoo Finance prices
 */
export async function calculateAccountLiveNAV(accountId: string): Promise<number> {
  // Get latest holdings for this account
  const holdings = await holdingQueries.getLatestByAccount(accountId) as Array<{
    symbol: string;
    position: number;
    fx_rate_to_base: number;
    mark_price: number;
    position_value: number;
  }>;

  // Get cash
  const cashRecord = await cashQueries.getLatestByAccount(accountId) as {
    amount: number;
    currency: string;
    fx_rate_to_base: number;
    report_date: string;
  } | undefined;
  const cash = cashRecord ? cashRecord.amount * (cashRecord.fx_rate_to_base || 1) : 0;

  let totalValue = cash;

  // Deduplicate holdings by normalized symbol.
  // Prefer the row with larger absolute position (more robust than position_value,
  // which may be stale/zero for freshly edited or remapped symbols).
  const deduplicatedHoldings = new Map<string, typeof holdings[0]>();
  for (const holding of holdings) {
    const normalized = normalizeSymbol(holding.symbol);
    if (
      !deduplicatedHoldings.has(normalized) ||
      Math.abs(holding.position) > Math.abs(deduplicatedHoldings.get(normalized)?.position || 0)
    ) {
      deduplicatedHoldings.set(normalized, holding);
    }
  }

  for (const holding of deduplicatedHoldings.values()) {
    if (holding.symbol === 'CASH') {
      totalValue += holding.position_value;
      continue;
    }

    // Map symbol to Yahoo Finance format for lookup
    const mappedSymbol = mapSymbolForYahoo(holding.symbol);
    const livePrice = await livePriceQueries.get(mappedSymbol) as { price: number } | undefined;
    
    if (livePrice) {
      // Use live price
      const positionValueUSD = holding.position * livePrice.price * holding.fx_rate_to_base;
      totalValue += positionValueUSD;
    } else {
      // Fallback to mark price from holdings
      totalValue += holding.position_value;
    }
  }

  return totalValue;
}

/**
 * Calculate total live NAV across all accounts
 */
export async function calculateTotalLiveNAV(): Promise<number> {
  const { getDatabase } = await import('./database');
  const sql = getDatabase();
  const accounts = await sql`SELECT id FROM "Accounts" WHERE id != 'HUNGARY_MIGRATION_HISTORY'` as unknown as Array<{ id: string }>;
  
  let total = 0;
  for (const account of accounts) {
    total += await calculateAccountLiveNAV(account.id);
  }
  
  return total;
}
