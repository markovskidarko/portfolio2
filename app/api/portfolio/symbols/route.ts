export const dynamic = 'force-dynamic'
/**
 * API endpoint to get available stock symbols from user's portfolio holdings
 * Used for Monte Carlo custom portfolio selection
 */

import { NextResponse } from 'next/server';
import { getDatabase, holdingQueries } from '@/lib/database';
import { normalizeSymbol } from '@/lib/symbol-mapper';

export async function GET() {
  try {
    const db = getDatabase();
    
    // Get all accounts excluding Hungary Migration History
    const accounts = await db`SELECT id FROM "Accounts" WHERE id != 'HUNGARY_MIGRATION_HISTORY'` as unknown as Array<{ id: string }>;

    const allSymbols = new Set<string>();
    
    // Collect all unique symbols from all accounts
    for (const account of accounts) {
      const holdings = await holdingQueries.getLatestByAccount(account.id) as unknown as Array<{
        symbol: string;
        position: number;
      }>;

      for (const holding of holdings) {
        if (holding.symbol && holding.position > 0) {
          const normalizedSymbol = normalizeSymbol(holding.symbol);
          // Only include symbols with letters (exclude cash positions, etc.)
          if (/[A-Za-z]/.test(normalizedSymbol) && normalizedSymbol.length > 1) {
            allSymbols.add(normalizedSymbol);
          }
        }
      }
    }

    // Sort symbols alphabetically
    const sortedSymbols = Array.from(allSymbols).sort();
    
    console.log(`[Portfolio Symbols] Found ${sortedSymbols.length} unique symbols`);
    
    return NextResponse.json({
      symbols: sortedSymbols,
      count: sortedSymbols.length
    });

  } catch (error) {
    console.error('[Portfolio Symbols] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio symbols', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}



