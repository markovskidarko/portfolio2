const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15352922'; // Long Term - ETF

console.log(`\n=== Checking Database Numbers for ${accountId} ===\n`);

// Get deposits
const getDeposits = db.prepare(`
  SELECT amount, date, description, currency, fx_rate_to_base, transaction_id
  FROM Deposits
  WHERE account_id = ?
  ORDER BY date ASC
`);

const deposits = getDeposits.all(accountId);
console.log(`\n📥 DEPOSITS (${deposits.length} records):`);
let totalDeposits = 0;
deposits.forEach(d => {
  const amountUSD = d.amount * d.fx_rate_to_base;
  totalDeposits += amountUSD;
  console.log(`  ${d.date}: $${amountUSD.toFixed(2)} (${d.amount} ${d.currency} @ ${d.fx_rate_to_base}) - ${d.description || 'No description'}`);
});
console.log(`\n  TOTAL DEPOSITS: $${totalDeposits.toFixed(2)}\n`);

// Get withdrawals
const getWithdrawals = db.prepare(`
  SELECT amount, date, description, currency, fx_rate_to_base, transaction_id
  FROM Withdrawals
  WHERE account_id = ?
  ORDER BY date ASC
`);

const withdrawals = getWithdrawals.all(accountId);
console.log(`\n📤 WITHDRAWALS (${withdrawals.length} records):`);
let totalWithdrawals = 0;
withdrawals.forEach(w => {
  const amountUSD = w.amount * w.fx_rate_to_base;
  totalWithdrawals += amountUSD;
  console.log(`  ${w.date}: $${amountUSD.toFixed(2)} (${w.amount} ${w.currency} @ ${w.fx_rate_to_base}) - ${w.description || 'No description'}`);
});
console.log(`\n  TOTAL WITHDRAWALS: $${totalWithdrawals.toFixed(2)}\n`);

// Get internal transfers (case-insensitive)
const getTransfers = db.prepare(`
  SELECT type, direction, amount, date, description, currency, fx_rate_to_base, from_account, to_account, transaction_id
  FROM Transfers
  WHERE account_id = ? AND UPPER(type) = 'INTERNAL'
  ORDER BY date ASC
`);

const transfers = getTransfers.all(accountId);
console.log(`\n🔄 INTERNAL TRANSFERS (${transfers.length} records):`);
let totalInternalIn = 0;
let totalInternalOut = 0;
transfers.forEach(t => {
  const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
  if (t.direction === 'IN') {
    totalInternalIn += amountUSD;
    console.log(`  ${t.date}: IN $${amountUSD.toFixed(2)} (${t.amount} ${t.currency} @ ${t.fx_rate_to_base}) - ${t.description || 'No description'}`);
    if (t.from_account) console.log(`    From: ${t.from_account}`);
  } else if (t.direction === 'OUT') {
    totalInternalOut += amountUSD;
    console.log(`  ${t.date}: OUT $${amountUSD.toFixed(2)} (${t.amount} ${t.currency} @ ${t.fx_rate_to_base}) - ${t.description || 'No description'}`);
    if (t.to_account) console.log(`    To: ${t.to_account}`);
  }
});
console.log(`\n  TOTAL INTERNAL IN: $${totalInternalIn.toFixed(2)}`);
console.log(`  TOTAL INTERNAL OUT: $${totalInternalOut.toFixed(2)}\n`);

// Calculate Net Contributions (Single Portfolio Formula)
const netContributions = totalDeposits - totalWithdrawals + totalInternalIn - totalInternalOut;

console.log(`\n=== NET CONTRIBUTIONS CALCULATION ===`);
console.log(`Formula: Deposits - Withdrawals + Internal IN - Internal OUT`);
console.log(`Calculation: $${totalDeposits.toFixed(2)} - $${totalWithdrawals.toFixed(2)} + $${totalInternalIn.toFixed(2)} - $${totalInternalOut.toFixed(2)}`);
console.log(`\nNET CONTRIBUTIONS: $${netContributions.toFixed(2)}\n`);

// Compare with screenshot
console.log(`\n=== COMPARISON WITH SCREENSHOT ===`);
console.log(`Screenshot shows:`);
console.log(`  Deposits: $590,000.00`);
console.log(`  Internal Transfers (OUT): -$264,620.00`);
console.log(`  Net: $325,380.00`);
console.log(`\nDatabase shows:`);
console.log(`  Deposits: $${totalDeposits.toFixed(2)}`);
console.log(`  Withdrawals: $${totalWithdrawals.toFixed(2)}`);
console.log(`  Internal IN: $${totalInternalIn.toFixed(2)}`);
console.log(`  Internal OUT: $${totalInternalOut.toFixed(2)}`);
console.log(`  Net: $${netContributions.toFixed(2)}`);

db.close();

