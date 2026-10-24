import { fetchYahooPrices } from '../lib/price-services/yahoo-finance';

// Symbols from U22758796
const symbols = ['AMD', 'ANET', 'ASML', 'AVGO', 'GOOGL', 'IONQ', 'MU', 'NVDA', 'QBTS', 'RGTI', 'TSM'];

async function testPrices() {
  console.log('=== Testing Yahoo Finance Price Fetching for U22758796 ===\n');
  console.log(`Fetching prices for ${symbols.length} symbols...\n`);

  const prices = await fetchYahooPrices(symbols);

  console.log(`\nSuccessfully fetched ${prices.size}/${symbols.length} prices\n`);

  for (const symbol of symbols) {
    const priceData = prices.get(symbol);
    if (priceData) {
      console.log(`✓ ${symbol}: $${priceData.price} (prev: $${priceData.previousClose || 'N/A'})`);
    } else {
      console.log(`✗ ${symbol}: NOT FOUND`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total symbols: ${symbols.length}`);
  console.log(`Successfully fetched: ${prices.size}`);
  console.log(`Failed: ${symbols.length - prices.size}`);
}

testPrices().catch(console.error);



