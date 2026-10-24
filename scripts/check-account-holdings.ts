import { holdingQueries } from '../lib/database';
import { normalizeSymbol, mapSymbolForYahoo } from '../lib/symbol-mapper';

const accounts = ['U16030763', 'U15352922', 'U15405459', 'U22758796'];

console.log('=== Checking Holdings for Accounts ===\n');

async function main() {
  for (const accountId of accounts) {
    const holdings = await holdingQueries.getLatestByAccount(accountId) as Array<{
      symbol: string;
      position: number;
      mark_price: number;
      position_value: number;
      currency: string;
      fx_rate_to_base: number;
    }>;

    console.log(`\nAccount ${accountId}: ${holdings.length} holdings`);
    console.log('----------------------------------------');

    if (holdings.length === 0) {
      console.log('  ⚠️  NO HOLDINGS FOUND');
      continue;
    }

    const allSymbols = new Set<string>();

    for (const holding of holdings) {
      const normalizedSym = normalizeSymbol(holding.symbol);
      const yahooSym = mapSymbolForYahoo(normalizedSym);
      allSymbols.add(normalizedSym);

      console.log(`  Symbol: ${holding.symbol}`);
      console.log(`    Normalized: ${normalizedSym}`);
      console.log(`    Yahoo Finance: ${yahooSym}`);
      console.log(`    Position: ${holding.position} shares`);
      console.log(`    Mark Price: $${holding.mark_price}`);
      console.log(`    Position Value: $${holding.position_value.toFixed(2)}`);
      console.log(`    Currency: ${holding.currency}`);
      console.log(`    FX Rate: ${holding.fx_rate_to_base}`);
      console.log('');
    }

    console.log(`\n  Total unique symbols (normalized): ${allSymbols.size}`);
    console.log(`  Symbols: ${Array.from(allSymbols).join(', ')}`);
    console.log(`  Yahoo Finance symbols: ${Array.from(allSymbols).map(s => mapSymbolForYahoo(s)).join(', ')}`);
  }
}

main().catch(console.error);
