const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('=== CHECKING ALL TRANSACTIONS ===\n');

// Check HUNGARY_MIGRATION_HISTORY
console.log('--- HUNGARY_MIGRATION_HISTORY (CSV Account) ---');
const csvDeposits = db.prepare('SELECT * FROM Deposits WHERE account_id = ?').all('HUNGARY_MIGRATION_HISTORY');
console.log(`Deposits: ${csvDeposits.length}`);
csvDeposits.forEach(d => {
  console.log(`  ${d.date}: $${(d.amount * d.fx_rate_to_base).toFixed(2)} - ${d.description}`);
});

const csvWithdrawals = db.prepare('SELECT * FROM Withdrawals WHERE account_id = ?').all('HUNGARY_MIGRATION_HISTORY');
console.log(`Withdrawals: ${csvWithdrawals.length}`);
csvWithdrawals.forEach(w => {
  console.log(`  ${w.date}: $${(w.amount * w.fx_rate_to_base).toFixed(2)} - ${w.description}`);
});

// Check Transactions table for all accounts
console.log('\n=== CHECKING Transactions TABLE ===');
const accounts = ['U15352922', 'U15405459', 'U16030763', 'U22758796', 'HUNGARY_MIGRATION_HISTORY'];

for (const accountId of accounts) {
  const transactions = db.prepare(`
    SELECT type, amount, date, description, currency, fx_rate_to_base
    FROM Transactions
    WHERE account_id = ?
    ORDER BY date ASC
    LIMIT 50
  `).all(accountId);
  
  if (transactions.length > 0) {
    console.log(`\n${accountId} - Transactions (${transactions.length}):`);
    let deposits = 0, withdrawals = 0;
    transactions.forEach(t => {
      const usd = t.amount * t.fx_rate_to_base;
      if (t.type === 'deposit' || t.type === 'DEPOSIT') {
        deposits += Math.abs(usd);
        console.log(`  DEPOSIT: ${t.date}: $${Math.abs(usd).toFixed(2)} - ${t.description}`);
      } else if (t.type === 'withdrawal' || t.type === 'WITHDRAWAL') {
        withdrawals += Math.abs(usd);
        console.log(`  WITHDRAWAL: ${t.date}: $${Math.abs(usd).toFixed(2)} - ${t.description}`);
      } else {
        console.log(`  ${t.type}: ${t.date}: $${usd.toFixed(2)} - ${t.description}`);
      }
    });
    console.log(`  Total Deposits: $${deposits.toFixed(2)}`);
    console.log(`  Total Withdrawals: $${withdrawals.toFixed(2)}`);
  }
}

db.close();
















