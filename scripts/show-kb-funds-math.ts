import { kbFundPriceQueries } from '../lib/database';
import { KB_FUND_UNITS, calculateValuation } from '../lib/kb-funds';

// Get USD/MKD exchange rate dynamically
async function getExchangeRate(): Promise<number> {
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await response.json();
    const mkdRate = data.rates?.MKD;
    if (mkdRate && mkdRate > 40 && mkdRate < 80) {
      return mkdRate;
    }
  } catch (error) {
    console.warn('Failed to fetch live exchange rate, using example rate');
  }
  return 53.5; // Example rate for demonstration
}

const funds = ['Stocks', 'Balanced', 'Gold'] as const;

async function main() {
  // Get latest prices for all funds
  const allPrices = await kbFundPriceQueries.getAll() as unknown as Array<{
    date: string;
    fund_name: string;
    price_per_unit_mkd: number;
  }>;

  // Get the latest date for each fund
  const latestDates = new Map<string, string>();

  for (const fundName of funds) {
    const fundPrices = allPrices.filter(p => p.fund_name === fundName);
    if (fundPrices.length > 0) {
      const dates = fundPrices.map(p => p.date).sort().reverse();
      latestDates.set(fundName, dates[0]);
    }
  }

  // Find the most recent date across all funds
  const allDates = Array.from(latestDates.values()).sort().reverse();
  const latestDate = allDates[0];

  console.log('='.repeat(80));
  console.log('KB FUNDS CURRENT VALUE CALCULATION');
  console.log('='.repeat(80));
  console.log(`\nLatest Date Available: ${latestDate}\n`);

  const usdRate = await getExchangeRate();
  console.log(`USD/MKD Exchange Rate: 1 USD = ${usdRate} MKD\n`);

  console.log('='.repeat(80));
  console.log('FORMULA FOR EACH FUND:');
  console.log('='.repeat(80));
  console.log(`
For each fund:
  Value (MKD) = Price Per Unit (MKD) × Number of Units
  Value (USD) = Value (MKD) ÷ USD/MKD Exchange Rate

For Total Portfolio:
  Total Value (MKD) = Sum of all fund values (MKD)
  Total Value (USD) = Total Value (MKD) ÷ USD/MKD Exchange Rate
`);

  console.log('='.repeat(80));
  console.log('CALCULATION FOR LATEST DATE:');
  console.log('='.repeat(80));

  let totalValueMKD = 0;
  let totalValueUSD = 0;

  for (const fundName of funds) {
    const fundLatestDate = latestDates.get(fundName);
    if (!fundLatestDate) {
      console.log(`\n${fundName} Fund: No price data available`);
      continue;
    }

    // Get the latest price for this fund (may be on a different date)
    const fundPrices = allPrices
      .filter(p => p.fund_name === fundName)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (fundPrices.length > 0) {
      const pricePerUnit = fundPrices[0].price_per_unit_mkd;
      const priceDate = fundPrices[0].date;
      const units = KB_FUND_UNITS[fundName];
      const valueMKD = pricePerUnit * units;
      const valueUSD = valueMKD / usdRate;

      totalValueMKD += valueMKD;
      totalValueUSD += valueUSD;

      console.log(`\n${fundName} Fund:`);
      console.log(`  Date: ${priceDate}`);
      console.log(`  Price Per Unit (MKD): ${pricePerUnit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} MKD`);
      console.log(`  Number of Units: ${units.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}`);
      console.log(`  Value (MKD) = ${pricePerUnit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} × ${units.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}`);
      console.log(`  Value (MKD) = ${valueMKD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} MKD`);
      console.log(`  Value (USD) = ${valueMKD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ÷ ${usdRate}`);
      console.log(`  Value (USD) = $${valueUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('TOTAL PORTFOLIO VALUE:');
  console.log('='.repeat(80));
  console.log(`\nTotal Value (MKD) = Sum of all fund values (MKD)`);
  console.log(`Total Value (MKD) = ${totalValueMKD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} MKD`);
  console.log(`\nTotal Value (USD) = Total Value (MKD) ÷ USD/MKD Exchange Rate`);
  console.log(`Total Value (USD) = ${totalValueMKD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ÷ ${usdRate}`);
  console.log(`Total Value (USD) = $${totalValueUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

  console.log(`\n${'='.repeat(80)}`);
  console.log('CONSTANTS (Fixed Number of Units per Fund):');
  console.log('='.repeat(80));
  for (const [fund, units] of Object.entries(KB_FUND_UNITS)) {
    console.log(`  ${fund}: ${units.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})} units`);
  }
}

main().catch(console.error);
