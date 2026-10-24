import { fetchYahooPrices } from '../lib/price-services/yahoo-finance';

async function testPrices() {
  // Symbols from U15405459
  const symbols = [
    'AAPL', 'AMD', 'AMZN', 'ANET', 'ASML', 'AVGO', 'GOOGL', 'IONQ', 'META', 'MRVL',
    'MSFT', 'MU', 'NAAS', 'NFLX', 'NVDA', 'QBTS', 'QUBT', 'RGTI', 'TSM', 'VRAX'
  ];

  console.log('=== Testing Yahoo Finance Price Fetching ===\n');
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

