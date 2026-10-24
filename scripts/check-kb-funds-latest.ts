import { kbFundPriceQueries } from '../lib/database';
import { KB_FUND_UNITS } from '../lib/kb-funds';

// Get current USD/MKD exchange rate
async function getExchangeRate(): Promise<number> {
  const sources = [
    {
      name: 'ExchangeRate-API',
      url: 'https://api.exchangerate-api.com/v4/latest/USD',
      parser: (data: any) => data.rates?.MKD
    },
    {
      name: 'Open Exchange Rates API',
      url: 'https://open.er-api.com/v6/latest/USD', 
      parser: (data: any) => data.rates?.MKD
    },
    {
      name: 'CDN Currency API',
      url: 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/usd/mkd.json',
      parser: (data: any) => data.mkd
    }
  ];

  for (const source of sources) {
    try {
      console.log(`Trying ${source.name}...`);
      const response = await fetch(source.url);
      const data = await response.json();
      const mkdRate = source.parser(data);
      
      if (mkdRate && typeof mkdRate === 'number' && mkdRate > 40 && mkdRate < 80) {
        console.log(`✓ Exchange rate from ${source.name}: 1 USD = ${mkdRate} MKD`);
        return mkdRate;
      } else {
        console.warn(`Invalid rate from ${source.name}: ${mkdRate}`);
      }
    } catch (error) {
      console.warn(`Failed to fetch from ${source.name}:`, error);
    }
  }
  
  throw new Error('Unable to fetch USD/MKD exchange rate from any source');
}

const funds = ['Stocks', 'Balanced', 'Gold'] as const;

async function main() {
  const exchangeRate = await getExchangeRate();
  console.log(`\n📊 KB Funds Latest NAV Values`);
  console.log(`Exchange Rate: 1 USD = ${exchangeRate} MKD\n`);
  console.log('='.repeat(80));

  for (const fund of funds) {
    const prices = (await kbFundPriceQueries.getByFund(fund) as Array<{
      date: string;
      fund_name: string;
      price_per_unit_mkd: number;
    }>)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 2); // Get last 2 dates

    if (prices.length === 0) {
      console.log(`\n❌ ${fund}: No data found`);
      continue;
    }

    const units = KB_FUND_UNITS[fund];
    console.log(`\n${fund} Fund (${units.toLocaleString('en-US', { maximumFractionDigits: 4 })} units)`);
    console.log('-'.repeat(80));

    for (const price of prices) {
      const navMKD = price.price_per_unit_mkd * units;
      const navUSD = navMKD / exchangeRate;

      console.log(`  Date: ${price.date}`);
      console.log(`    Price per Unit (MKD): ${price.price_per_unit_mkd.toFixed(2)}`);
      console.log(`    NAV (MKD): ${navMKD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      console.log(`    NAV (USD): $${navUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      console.log('');
    }
  }

  console.log('='.repeat(80));
}

main().catch(console.error);


