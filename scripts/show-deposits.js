const Database = require('better-sqlite3');
const path = require('path');
const { join } = require('path');

const dbPath = join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = process.argv[2] || 'U15352922';

console.log(`\n=== Deposits for Account: ${accountId} ===\n`);

// Get deposits
const getDeposits = db.prepare(`
  SELECT 
    date,
    amount,
    description,
    currency,
    fx_rate_to_base,
    transaction_id,
    created_at
  FROM Deposits
  WHERE account_id = ?
  ORDER BY date ASC
`);

const deposits = getDeposits.all(accountId);

if (deposits.length === 0) {
  console.log(`No deposits found for account ${accountId}`);
} else {
  console.log(`Total deposits: ${deposits.length}\n`);
  
  let totalUSD = 0;
  let totalByCurrency = new Map();
  
  deposits.forEach((deposit, index) => {
    const amountUSD = deposit.amount * deposit.fx_rate_to_base;
    totalUSD += amountUSD;
    
    const currency = deposit.currency || 'USD';
    if (!totalByCurrency.has(currency)) {
      totalByCurrency.set(currency, 0);
    }
    totalByCurrency.set(currency, totalByCurrency.get(currency) + deposit.amount);
    
    console.log(`${index + 1}. Date: ${deposit.date}`);
    console.log(`   Amount: ${deposit.currency || 'USD'} ${deposit.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`   Amount (USD): $${amountUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`   FX Rate: ${deposit.fx_rate_to_base}`);
    console.log(`   Description: ${deposit.description || 'N/A'}`);
    if (deposit.transaction_id) {
      console.log(`   Transaction ID: ${deposit.transaction_id}`);
    }
    console.log(`   Created: ${deposit.created_at}`);
    console.log('');
  });
  
  console.log('=== Summary ===');
  console.log(`Total Deposits (USD): $${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('\nBy Currency:');
  for (const [currency, amount] of totalByCurrency.entries()) {
    console.log(`  ${currency}: ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }
  
  // Date range
  if (deposits.length > 0) {
    const dates = deposits.map(d => d.date).sort();
    console.log(`\nDate Range: ${dates[0]} to ${dates[dates.length - 1]}`);
  }
}

db.close();




