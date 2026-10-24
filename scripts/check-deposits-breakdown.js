const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15352922'; // Long Term - ETF

console.log(`\n=== Detailed Deposits Breakdown for ${accountId} ===\n`);

// Get all deposits with full details
const getDeposits = db.prepare(`
  SELECT id, amount, date, description, currency, fx_rate_to_base, transaction_id, created_at
  FROM Deposits
  WHERE account_id = ?
  ORDER BY date ASC, id ASC
`);

const deposits = getDeposits.all(accountId);

console.log(`Found ${deposits.length} deposit record(s):\n`);

let totalDeposits = 0;
let depositsByDate = {};

deposits.forEach((d, idx) => {
  const amountUSD = d.amount * d.fx_rate_to_base;
  totalDeposits += amountUSD;
  
  // Group by date
  if (!depositsByDate[d.date]) {
    depositsByDate[d.date] = [];
  }
  depositsByDate[d.date].push(d);
  
  console.log(`[${idx + 1}] ID: ${d.id}`);
  console.log(`    Date: ${d.date}`);
  console.log(`    Amount: $${amountUSD.toFixed(2)} (${d.amount} ${d.currency} @ ${d.fx_rate_to_base})`);
  console.log(`    Description: ${d.description || 'No description'}`);
  console.log(`    Transaction ID: ${d.transaction_id || 'N/A'}`);
  console.log(`    Created At: ${d.created_at}`);
  console.log('');
});

console.log(`\n=== Summary by Date ===\n`);

Object.keys(depositsByDate).sort().forEach(date => {
  const dateDeposits = depositsByDate[date];
  const dateTotal = dateDeposits.reduce((sum, d) => sum + (d.amount * d.fx_rate_to_base), 0);
  console.log(`${date}: ${dateDeposits.length} record(s), Total: $${dateTotal.toFixed(2)}`);
  
  if (dateDeposits.length > 1) {
    console.log(`  ⚠️  DUPLICATE DETECTED: Multiple deposits on same date!`);
    dateDeposits.forEach((d, idx) => {
      const amountUSD = d.amount * d.fx_rate_to_base;
      console.log(`    [${idx + 1}] ID: ${d.id}, Amount: $${amountUSD.toFixed(2)}, TX ID: ${d.transaction_id || 'N/A'}, Created: ${d.created_at}`);
    });
  }
  console.log('');
});

console.log(`\n=== Total Deposits: $${totalDeposits.toFixed(2)} ===\n`);

// Check for duplicates based on transaction_id
console.log(`=== Checking for Duplicate Transaction IDs ===\n`);
const checkDuplicates = db.prepare(`
  SELECT transaction_id, date, COUNT(*) as count, GROUP_CONCAT(id) as ids, GROUP_CONCAT(amount) as amounts
  FROM Deposits
  WHERE account_id = ? AND transaction_id IS NOT NULL AND transaction_id != ''
  GROUP BY transaction_id
  HAVING COUNT(*) > 1
`);

const duplicates = checkDuplicates.all(accountId);

if (duplicates.length > 0) {
  console.log(`⚠️  Found ${duplicates.length} duplicate transaction ID(s):\n`);
  duplicates.forEach(dup => {
    console.log(`Transaction ID: ${dup.transaction_id}`);
    console.log(`  Count: ${dup.count}`);
    console.log(`  Record IDs: ${dup.ids}`);
    console.log(`  Amounts: ${dup.amounts}`);
    console.log('');
  });
} else {
  console.log('✅ No duplicate transaction IDs found');
}

// Check for duplicates based on date + amount
console.log(`\n=== Checking for Duplicate Date + Amount Combinations ===\n`);
const checkDateAmountDuplicates = db.prepare(`
  SELECT date, amount, COUNT(*) as count, GROUP_CONCAT(id) as ids, GROUP_CONCAT(transaction_id) as tx_ids
  FROM Deposits
  WHERE account_id = ?
  GROUP BY date, amount
  HAVING COUNT(*) > 1
`);

const dateAmountDuplicates = checkDateAmountDuplicates.all(accountId);

if (dateAmountDuplicates.length > 0) {
  console.log(`⚠️  Found ${dateAmountDuplicates.length} duplicate date+amount combination(s):\n`);
  dateAmountDuplicates.forEach(dup => {
    console.log(`Date: ${dup.date}, Amount: $${Math.abs(dup.amount).toFixed(2)}`);
    console.log(`  Count: ${dup.count}`);
    console.log(`  Record IDs: ${dup.ids}`);
    console.log(`  Transaction IDs: ${dup.tx_ids || 'N/A'}`);
    console.log('');
  });
} else {
  console.log('✅ No duplicate date+amount combinations found');
}

// Check Transactions table for deposits/withdrawals
console.log(`\n=== Checking Transactions Table for Deposits/Withdrawals ===\n`);
const getTransactions = db.prepare(`
  SELECT id, type, amount, date, description, transaction_id
  FROM Transactions
  WHERE account_id = ? AND (type LIKE '%deposit%' OR type LIKE '%withdrawal%' OR description LIKE '%CASH RECEIPTS%')
  ORDER BY date ASC
`);

const transactions = getTransactions.all(accountId);

if (transactions.length > 0) {
  console.log(`Found ${transactions.length} deposit/withdrawal transaction(s) in Transactions table:\n`);
  transactions.forEach((t, idx) => {
    console.log(`[${idx + 1}] Date: ${t.date}, Type: ${t.type}, Amount: $${Math.abs(t.amount).toFixed(2)}`);
    console.log(`    Description: ${t.description || 'N/A'}`);
    console.log(`    Transaction ID: ${t.transaction_id || 'N/A'}`);
    console.log('');
  });
} else {
  console.log('No deposit/withdrawal transactions found in Transactions table');
}

db.close();













