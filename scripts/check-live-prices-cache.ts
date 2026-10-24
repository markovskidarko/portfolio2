import { livePriceQueries } from '../lib/database';
import { normalizeSymbol, mapSymbolForYahoo } from '../lib/symbol-mapper';

// Symbols from U15405459
const symbols = [
  'AAPL', 'AMD', 'AMZN', 'ANET', 'ASML', 'AVGO', 'GOOGL', 'IONQ', 'META', 'MRVL',
  'MSFT', 'MU', 'NAAS', 'NFLX', 'NVDA', 'QBTS', 'QUBT', 'RGTI', 'TSM', 'VRAX'
];

console.log('=== Checking Live Prices Cache ===\n');

async function main() {
  const now = Date.now();
  let foundCount = 0;
  let staleCount = 0;
  let missingCount = 0;

  for (const symbol of symbols) {
    const normalizedSym = normalizeSymbol(symbol);
    const yahooSym = mapSymbolForYahoo(normalizedSym);

    const cached = await livePriceQueries.get(yahooSym) as {
      price: number;
      previous_close?: number;
      updated_at: string;
      source: string;
    } | undefined;

    if (cached) {
      const updatedAt = new Date(cached.updated_at).getTime();
      const age = now - updatedAt;
      const ageSeconds = Math.round(age / 1000);
      const ageMinutes = Math.round(age / 60000);

      if (age < 60000) {
        console.log(`✓ ${symbol} (${yahooSym}): $${cached.price} (updated ${ageSeconds}s ago)`);
        foundCount++;
      } else {
        console.log(`⚠ ${symbol} (${yahooSym}): $${cached.price} (STALE - updated ${ageMinutes}m ago)`);
        staleCount++;
      }
    } else {
      console.log(`✗ ${symbol} (${yahooSym}): NOT IN CACHE`);
      missingCount++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total symbols: ${symbols.length}`);
  console.log(`Fresh in cache: ${foundCount}`);
  console.log(`Stale in cache: ${staleCount}`);
  console.log(`Missing from cache: ${missingCount}`);
}

main().catch(console.error);
