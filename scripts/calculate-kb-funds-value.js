const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('=== KB FUNDS CURRENT VALUE CALCULATION ===\n');

// Constants
const KB_FUND_UNITS = {
  'Stocks': 40345.9594,
  'Balanced': 23886.3365,
  'Gold': 28266.8087,
};

// Get latest date
const latestDateQuery = db.prepare(`
  SELECT MAX(date) as latest_date
  FROM KBFundPrices
`);
const latestDateResult = latestDateQuery.get();
const latestDate = latestDateResult?.latest_date;

if (!latestDate) {
  console.log('ERROR: No data found in database');
  process.exit(1);
}

console.log(`Latest date in database: ${latestDate}\n`);

// Get prices for latest date
const pricesQuery = db.prepare(`
  SELECT fund_name, price_per_unit_mkd
  FROM KBFundPrices
  WHERE date = ?
  ORDER BY fund_name
`);
const prices = pricesQuery.all(latestDate);

console.log('=== PRICES FROM DATABASE ===');
prices.forEach(p => {
  console.log(`${p.fund_name}: ${p.price_per_unit_mkd} MKD per unit`);
});
console.log('');

// Calculate values
let totalValueMKD = 0;
const fundValues = [];

console.log('=== CALCULATION STEP BY STEP ===\n');

for (const price of prices) {
  const fundName = price.fund_name;
  const pricePerUnit = price.price_per_unit_mkd;
  const units = KB_FUND_UNITS[fundName];
  
  if (!units) {
    console.log(`WARNING: No units defined for ${fundName}`);
    continue;
  }
  
  const valueMKD = pricePerUnit * units;
  totalValueMKD += valueMKD;
  
  fundValues.push({
    fund: fundName,
    pricePerUnit,
    units,
    valueMKD
  });
  
  console.log(`${fundName}:`);
  console.log(`  Price per unit: ${pricePerUnit.toLocaleString()} MKD`);
  console.log(`  Units: ${units.toLocaleString()}`);
  console.log(`  Value MKD = ${pricePerUnit.toLocaleString()} × ${units.toLocaleString()}`);
  console.log(`  Value MKD = ${valueMKD.toLocaleString()} MKD`);
  console.log('');
}

console.log('=== TOTAL VALUE ===');
console.log(`Total Value MKD = ${fundValues.map(f => f.valueMKD.toLocaleString()).join(' + ')}`);
console.log(`Total Value MKD = ${totalValueMKD.toLocaleString()} MKD`);
console.log('');

// Exchange rate (1 USD = 58 MKD)
const exchangeRate = 58;
console.log(`Exchange Rate: 1 USD = ${exchangeRate} MKD`);
console.log('');

// Convert to USD
const totalValueUSD = totalValueMKD / exchangeRate;

console.log('=== CONVERSION TO USD ===');
console.log(`Total Value USD = ${totalValueMKD.toLocaleString()} MKD ÷ ${exchangeRate}`);
console.log(`Total Value USD = $${totalValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
console.log('');

// Breakdown by fund in USD
console.log('=== BREAKDOWN BY FUND (USD) ===');
fundValues.forEach(f => {
  const valueUSD = f.valueMKD / exchangeRate;
  console.log(`${f.fund}: $${valueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
});

db.close();




