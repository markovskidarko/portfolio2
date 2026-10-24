const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('=== FIXING KB FUNDS PRICES IN DATABASE ===\n');
console.log('Issue: Prices are stored 100x too high (e.g., 25902 instead of 259.02)\n');

// Get all prices
const getAllPrices = db.prepare(`
  SELECT id, date, fund_name, price_per_unit_mkd
  FROM KBFundPrices
  ORDER BY fund_name, date
`);

const prices = getAllPrices.all();

console.log(`Found ${prices.length} price records to fix\n`);

// Count how many need fixing (prices > 1000 are likely wrong)
let needsFixing = 0;
let alreadyCorrect = 0;

for (const price of prices) {
  if (price.price_per_unit_mkd > 1000) {
    needsFixing++;
  } else {
    alreadyCorrect++;
  }
}

console.log(`Records that need fixing (price > 1000): ${needsFixing}`);
console.log(`Records that appear correct (price <= 1000): ${alreadyCorrect}\n`);

if (needsFixing === 0) {
  console.log('No records need fixing. Exiting.');
  db.close();
  process.exit(0);
}

// Prepare update statement
const updatePrice = db.prepare(`
  UPDATE KBFundPrices
  SET price_per_unit_mkd = ?
  WHERE id = ?
`);

// Start transaction
const updateMany = db.transaction((prices) => {
  let fixed = 0;
  let skipped = 0;
  
  for (const price of prices) {
    const oldPrice = price.price_per_unit_mkd;
    
    // Only fix prices that are > 1000 (likely 100x too high)
    if (oldPrice > 1000) {
      const newPrice = oldPrice / 100;
      updatePrice.run(newPrice, price.id);
      fixed++;
      
      if (fixed <= 5) {
        console.log(`Fixed: ${price.fund_name} ${price.date}: ${oldPrice} -> ${newPrice.toFixed(2)} MKD`);
      }
    } else {
      skipped++;
    }
  }
  
  return { fixed, skipped };
});

console.log('Starting fix...\n');
const result = updateMany(prices);

console.log(`\n=== FIX COMPLETE ===`);
console.log(`Fixed: ${result.fixed} records`);
console.log(`Skipped: ${result.skipped} records (already correct)\n`);

// Verify the fix
console.log('=== VERIFICATION ===');
const verifyQuery = db.prepare(`
  SELECT fund_name, date, price_per_unit_mkd
  FROM KBFundPrices
  WHERE date = (SELECT MAX(date) FROM KBFundPrices)
  ORDER BY fund_name
`);

const latestPrices = verifyQuery.all();
console.log('Latest prices after fix:');
latestPrices.forEach(p => {
  console.log(`  ${p.fund_name}: ${p.price_per_unit_mkd.toFixed(2)} MKD`);
});

// Calculate current value with fixed prices
const KB_FUND_UNITS = {
  'Stocks': 40345.9594,
  'Balanced': 23886.3365,
  'Gold': 28266.8087,
};

console.log('\n=== RECALCULATED CURRENT VALUE ===');
let totalValueMKD = 0;
for (const price of latestPrices) {
  const units = KB_FUND_UNITS[price.fund_name] || 0;
  const valueMKD = price.price_per_unit_mkd * units;
  const valueUSD = valueMKD / 58;
  totalValueMKD += valueMKD;
  console.log(`${price.fund_name}: ${price.price_per_unit_mkd.toFixed(2)} × ${units.toLocaleString()} = ${valueMKD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} MKD = $${valueUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
}

const totalValueUSD = totalValueMKD / 58;
console.log(`\nTotal Value: ${totalValueMKD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} MKD = $${totalValueUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

db.close();
console.log('\nDatabase fix complete!');




