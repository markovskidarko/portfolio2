const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('=== CHECKING U16030763 ===\n');

// Check Deposits
const deposits = db.prepare(`
  SELECT amount, date, description, currency, fx_rate_to_base, transaction_id
  FROM Deposits
  WHERE account_id = 'U16030763'
  ORDER BY date ASC
`).all();

console.log(`Deposits (${deposits.length} records):`);
let totalDeposits = 0;
for (const d of deposits) {
  const usd = d.amount * d.fx_rate_to_base;
  totalDeposits += usd;
  console.log(`  ${d.date}: $${usd.toFixed(2)} (${d.amount} ${d.currency} × ${d.fx_rate_to_base}) - ${d.description || 'No description'}`);
}
console.log(`  Total Deposits: $${totalDeposits.toFixed(2)}`);

// Check Withdrawals
const withdrawals = db.prepare(`
  SELECT amount, date, description, currency, fx_rate_to_base, transaction_id
  FROM Withdrawals
  WHERE account_id = 'U16030763'
  ORDER BY date ASC
`).all();

console.log(`\nWithdrawals (${withdrawals.length} records):`);
let totalWithdrawals = 0;
for (const w of withdrawals) {
  const usd = w.amount * w.fx_rate_to_base;
  totalWithdrawals += usd;
  console.log(`  ${w.date}: $${usd.toFixed(2)} (${w.amount} ${w.currency} × ${w.fx_rate_to_base}) - ${w.description || 'No description'}`);
}
console.log(`  Total Withdrawals: $${totalWithdrawals.toFixed(2)}`);

// Check CSV account deposits
console.log('\n--- HUNGARY_MIGRATION_HISTORY (CSV Account) ---');
const csvDeposits = db.prepare(`
  SELECT amount, date, description, currency, fx_rate_to_base
  FROM Deposits
  WHERE account_id = 'HUNGARY_MIGRATION_HISTORY'
  ORDER BY date ASC
`).all();

console.log(`CSV Deposits (${csvDeposits.length} records):`);
let totalCSVDeposits = 0;
for (const d of csvDeposits) {
  const usd = d.amount * d.fx_rate_to_base;
  totalCSVDeposits += usd;
  console.log(`  ${d.date}: $${usd.toFixed(2)} - ${d.description || 'No description'}`);
}
console.log(`  Total CSV Deposits: $${totalCSVDeposits.toFixed(2)}`);

console.log(`\nExpected: $116,495 (CSV inception deposit) - $430 (withdrawal) = $116,065`);
console.log(`Current: $${totalDeposits.toFixed(2)} (U16030763 deposits) + $${totalCSVDeposits.toFixed(2)} (CSV deposits) - $${totalWithdrawals.toFixed(2)} (withdrawals) = $${(totalDeposits + totalCSVDeposits - totalWithdrawals).toFixed(2)}`);

db.close();
















