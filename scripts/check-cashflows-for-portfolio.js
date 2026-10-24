const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15405459'; // 3rd portfolio from screenshot

console.log(`\n=== Checking Cash Flows for ${accountId} ===\n`);

// Get deposits
const getDeposits = db.prepare(`
  SELECT date, amount, fx_rate_to_base, description, transaction_id
  FROM Deposits
  WHERE account_id = ?
  ORDER BY date ASC
`);

const deposits = getDeposits.all(accountId);
console.log(`Deposits (${deposits.length} records):`);
deposits.forEach(d => {
  const amountUSD = d.amount * d.fx_rate_to_base;
  console.log(`  ${d.date}: +$${amountUSD.toFixed(2)} - ${d.description || 'N/A'}`);
});

// Get withdrawals
const getWithdrawals = db.prepare(`
  SELECT date, amount, fx_rate_to_base, description, transaction_id
  FROM Withdrawals
  WHERE account_id = ?
  ORDER BY date ASC
`);

const withdrawals = getWithdrawals.all(accountId);
console.log(`\nWithdrawals (${withdrawals.length} records):`);
withdrawals.forEach(w => {
  const amountUSD = w.amount * w.fx_rate_to_base;
  console.log(`  ${w.date}: -$${amountUSD.toFixed(2)} - ${w.description || 'N/A'}`);
});

// Get internal transfers
const getTransfers = db.prepare(`
  SELECT date, direction, amount, fx_rate_to_base, description, from_account, to_account, transaction_id
  FROM Transfers
  WHERE account_id = ? AND UPPER(type) = 'INTERNAL'
  ORDER BY date ASC
`);

const transfers = getTransfers.all(accountId);
console.log(`\nInternal Transfers (${transfers.length} records):`);
transfers.forEach(t => {
  const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
  console.log(`  ${t.date}: ${t.direction} $${amountUSD.toFixed(2)} - ${t.description || 'N/A'}`);
  if (t.from_account) console.log(`    From: ${t.from_account}`);
  if (t.to_account) console.log(`    To: ${t.to_account}`);
});

// Build cash flow map (like the TWR calculation does)
const cashFlows = new Map();
const internalTransferDates = new Set();

// Mark internal transfer dates
transfers.forEach(t => {
  internalTransferDates.add(t.date);
});

// Add deposits (skip if internal transfer date)
deposits.forEach(d => {
  if (!internalTransferDates.has(d.date)) {
    const amountUSD = d.amount * d.fx_rate_to_base;
    cashFlows.set(d.date, (cashFlows.get(d.date) || 0) + amountUSD);
  } else {
    console.log(`\n⚠️  Deposit on ${d.date} ($${(d.amount * d.fx_rate_to_base).toFixed(2)}) is on an internal transfer date - should be excluded from TWR`);
  }
});

// Add withdrawals (skip if internal transfer date)
withdrawals.forEach(w => {
  if (!internalTransferDates.has(w.date)) {
    const amountUSD = w.amount * w.fx_rate_to_base;
    cashFlows.set(w.date, (cashFlows.get(w.date) || 0) - amountUSD);
  } else {
    console.log(`\n⚠️  Withdrawal on ${w.date} ($${(w.amount * w.fx_rate_to_base).toFixed(2)}) is on an internal transfer date - should be excluded from TWR`);
  }
});

console.log(`\n=== Cash Flow Map (for TWR calculation) ===`);
const sortedDates = Array.from(cashFlows.keys()).sort();
console.log(`Total dates with cash flows: ${sortedDates.length}`);
sortedDates.forEach(date => {
  const flow = cashFlows.get(date);
  console.log(`  ${date}: ${flow >= 0 ? '+' : ''}$${flow.toFixed(2)}`);
});

console.log(`\n=== Internal Transfer Dates (TWR neutralized) ===`);
const sortedTransferDates = Array.from(internalTransferDates).sort();
console.log(`Total internal transfer dates: ${sortedTransferDates.length}`);
sortedTransferDates.forEach(date => {
  console.log(`  ${date}`);
});

db.close();













