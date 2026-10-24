const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('\n=== Checking ALL Internal Transfers in Database ===\n');

// Get all internal transfers
const getAllTransfers = db.prepare(`
  SELECT account_id, type, direction, amount, date, description, currency, fx_rate_to_base, from_account, to_account, transaction_id
  FROM Transfers
  WHERE type = 'internal'
  ORDER BY account_id, date ASC
`);

const transfers = getAllTransfers.all();
console.log(`Found ${transfers.length} internal transfer(s):\n`);

transfers.forEach(t => {
  const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
  console.log(`Account: ${t.account_id}`);
  console.log(`  ${t.date}: ${t.direction} $${amountUSD.toFixed(2)} (${t.amount} ${t.currency} @ ${t.fx_rate_to_base})`);
  console.log(`  Description: ${t.description || 'No description'}`);
  if (t.from_account) console.log(`  From: ${t.from_account}`);
  if (t.to_account) console.log(`  To: ${t.to_account}`);
  console.log('');
});

// Check if there are transfers in Transactions table
const getTransactions = db.prepare(`
  SELECT account_id, type, amount, date, description
  FROM Transactions
  WHERE type LIKE '%transfer%' OR description LIKE '%transfer%'
  ORDER BY account_id, date ASC
`);

const transactions = getTransactions.all();
if (transactions.length > 0) {
  console.log(`\n=== Found ${transactions.length} transfer-related transaction(s) in Transactions table ===\n`);
  transactions.forEach(t => {
    console.log(`Account: ${t.account_id}`);
    console.log(`  ${t.date}: ${t.type} $${Math.abs(t.amount).toFixed(2)}`);
    console.log(`  Description: ${t.description || 'No description'}`);
    console.log('');
  });
}

// Check U15352922 specifically for any transfers
console.log('\n=== Checking U15352922 for ALL transfers (any type) ===\n');
const getAccountTransfers = db.prepare(`
  SELECT type, direction, amount, date, description, currency, fx_rate_to_base, from_account, to_account
  FROM Transfers
  WHERE account_id = ?
  ORDER BY date ASC
`);

const accountTransfers = getAccountTransfers.all('U15352922');
console.log(`Found ${accountTransfers.length} transfer(s) for U15352922:\n`);
accountTransfers.forEach(t => {
  const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
  console.log(`  ${t.date}: ${t.type} ${t.direction} $${amountUSD.toFixed(2)} (${t.amount} ${t.currency} @ ${t.fx_rate_to_base})`);
  console.log(`  Description: ${t.description || 'No description'}`);
  if (t.from_account) console.log(`  From: ${t.from_account}`);
  if (t.to_account) console.log(`  To: ${t.to_account}`);
  console.log('');
});

db.close();

