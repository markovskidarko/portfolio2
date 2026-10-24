export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { getDatabase, livePriceQueries, holdingQueries } from '@/lib/database';
import { mapSymbolForYahoo } from '@/lib/symbol-mapper';

/**
 * GET /api/prices?symbols=AAPL,MSFT,GOOGL&accountIds=U123,U456
 * Returns prices with previousClose and latest DB position values for given symbols
 * Maps symbols to Yahoo Finance format before querying (e.g., EQQQ -> EQQQ.SW)
 * If accountIds provided, also returns latest DB position_value for Today% calculation
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    const accountIdsParam = searchParams.get('accountIds');
    
    if (!symbolsParam) {
      return NextResponse.json(
        { success: false, error: 'Symbols parameter is required' },
        { status: 400 }
      );
    }
    
    const originalSymbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    
    if (originalSymbols.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid symbols provided' },
        { status: 400 }
      );
    }
    
    
    // Map original symbols to Yahoo Finance format (e.g., EQQQ -> EQQQ.SW, VUSD -> VUSD.L)
    const symbolMapping = new Map<string, string>(); // original -> mapped
    for (const originalSymbol of originalSymbols) {
      const mappedSymbol = mapSymbolForYahoo(originalSymbol);
      symbolMapping.set(originalSymbol, mappedSymbol);
    }
    
    const prices: Record<string, { price: number; previousClose?: number; latestDbPositionValue?: number }> = {};
    
    // Query database using mapped symbols, but return results keyed by original symbols
    for (const [originalSymbol, mappedSymbol] of symbolMapping.entries()) {
      try {
        // Query using mapped symbol (as stored in database)
        const priceRecord = await livePriceQueries.get(mappedSymbol) as {
          price: number;
          previous_close: number | null;
        } | undefined;
        
        if (priceRecord) {
          // Return result keyed by original symbol (for component to match)
          prices[originalSymbol] = {
            price: priceRecord.price,
            previousClose: priceRecord.previous_close || undefined,
          };
          console.log(`[Prices API] Found price for ${originalSymbol} (mapped: ${mappedSymbol}): $${priceRecord.price.toFixed(2)}, prev: ${priceRecord.previous_close || 'N/A'}`);
        } else {
          console.warn(`[Prices API] Symbol ${originalSymbol} (mapped: ${mappedSymbol}) not found in database`);
        }
      } catch (error) {
        // Symbol not found in database - skip
        console.warn(`[Prices API] Error querying ${originalSymbol} (mapped: ${mappedSymbol}):`, error);
      }
    }
    
    // If accountIds provided, fetch latest DB position values for Today% calculation
    if (accountIdsParam) {
      const accountIds = accountIdsParam.split(',').map(id => id.trim()).filter(Boolean);
      
      if (accountIds.length > 0) {
        // Get latest holdings for each account and aggregate position values by symbol
        const latestDbPositionValues = new Map<string, number>(); // original symbol -> total position_value
        
        for (const accountId of accountIds) {
          try {
            const holdings = await holdingQueries.getLatestByAccount(accountId) as Array<{
              symbol: string;
              position_value: number;
            }>;
            
            for (const holding of holdings) {
              const originalSymbol = holding.symbol.toUpperCase();
              // Map to check if this symbol is in our requested list
              if (originalSymbols.includes(originalSymbol)) {
                const currentValue = latestDbPositionValues.get(originalSymbol) || 0;
                latestDbPositionValues.set(originalSymbol, currentValue + holding.position_value);
              }
            }
          } catch (error) {
            console.warn(`[Prices API] Error fetching holdings for account ${accountId}:`, error);
          }
        }
        
        // Add latest DB position values to prices
        for (const [originalSymbol, dbPositionValue] of latestDbPositionValues.entries()) {
          if (prices[originalSymbol]) {
            prices[originalSymbol].latestDbPositionValue = dbPositionValue;
          }
        }
      }
    }
    
    return NextResponse.json({
      success: true,
      prices,
    });
  } catch (error) {
    console.error('[Prices API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}


