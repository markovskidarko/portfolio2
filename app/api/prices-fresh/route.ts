export const dynamic = 'force-dynamic'
/**
 * GET /api/prices-fresh?symbols=AAPL,MSFT,GOOGL
 * Returns fresh prices with previousClose fetched directly from Yahoo Finance
 * This ensures we always match Yahoo Finance's current values
 */
import { NextResponse } from 'next/server';
import { mapSymbolForYahoo } from '@/lib/symbol-mapper';
import { fetchYahooPrice } from '@/lib/price-services/yahoo-finance';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    
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
    
    // Map original symbols to Yahoo Finance format
    const symbolMapping = new Map<string, string>(); // original -> mapped
    for (const originalSymbol of originalSymbols) {
      const mappedSymbol = mapSymbolForYahoo(originalSymbol);
      symbolMapping.set(originalSymbol, mappedSymbol);
    }
    
    const prices: Record<string, { price: number; previousClose?: number }> = {};
    
    // Fetch fresh data from Yahoo Finance for each symbol
    console.log(`[Prices Fresh API] Fetching fresh data from Yahoo Finance for ${originalSymbols.length} symbols...`);
    
    for (const [originalSymbol, mappedSymbol] of symbolMapping.entries()) {
      try {
        console.log(`[Prices Fresh API] Fetching ${originalSymbol} (mapped: ${mappedSymbol}) from Yahoo Finance...`);
        const yahooData = await fetchYahooPrice(mappedSymbol);
        
        if (yahooData) {
          // Return result keyed by original symbol (for component to match)
          prices[originalSymbol] = {
            price: yahooData.price,
            previousClose: yahooData.previousClose || undefined,
          };
          console.log(`[Prices Fresh API] ✓ ${originalSymbol}: Price=$${yahooData.price.toFixed(2)}, PreviousClose=${yahooData.previousClose ? `$${yahooData.previousClose.toFixed(2)}` : 'NULL'}`);
        } else {
          console.warn(`[Prices Fresh API] ⚠️ ${originalSymbol} (mapped: ${mappedSymbol}): No data returned from Yahoo Finance`);
        }
      } catch (error) {
        console.error(`[Prices Fresh API] ❌ Error fetching ${originalSymbol} (mapped: ${mappedSymbol}) from Yahoo Finance:`, error);
        // Continue with other symbols even if one fails
      }
    }
    
    console.log(`[Prices Fresh API] ✅ Fetched ${Object.keys(prices).length}/${originalSymbols.length} prices from Yahoo Finance`);
    
    return NextResponse.json({
      success: true,
      prices,
    });
  } catch (error) {
    console.error('[Prices Fresh API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}












