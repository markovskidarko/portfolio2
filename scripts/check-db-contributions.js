const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('=== CHECKING DEPOSITS AND WITHDRAWALS IN DATABASE ===\n');

const accounts = ['U15352922', 'U15405459', 'U16030763', 'U22758796'];

for (const accountId of accounts) {
  console.log(`\n--- ${accountId} ---`);
  
  // Check Deposits
  const deposits = db.prepare(`
    SELECT amount, date, description, currency, fx_rate_to_base, transaction_id
    FROM Deposits
    WHERE account_id = ?
    ORDER BY date ASC
  `).all(accountId);
  
  console.log(`\nDeposits (${deposits.length} records):`);
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
    WHERE account_id = ?
    ORDER BY date ASC
  `).all(accountId);
  
  console.log(`\nWithdrawals (${withdrawals.length} records):`);
  let totalWithdrawals = 0;
  for (const w of withdrawals) {
    const usd = w.amount * w.fx_rate_to_base;
    totalWithdrawals += usd;
    console.log(`  ${w.date}: $${usd.toFixed(2)} (${w.amount} ${w.currency} × ${w.fx_rate_to_base}) - ${w.description || 'No description'}`);
  }
  console.log(`  Total Withdrawals: $${totalWithdrawals.toFixed(2)}`);
  
  // Check Internal Transfers
  const transfers = db.prepare(`
    SELECT type, direction, amount, date, description, from_account, to_account, currency, fx_rate_to_base
    FROM Transfers
    WHERE (from_account = ? OR to_account = ?)
    AND type = 'internal'
    ORDER BY date ASC
  `).all(accountId, accountId);
  
  console.log(`\nInternal Transfers (${transfers.length} records):`);
  let totalIn = 0;
  let totalOut = 0;
  for (const t of transfers) {
    const usd = t.amount * t.fx_rate_to_base;
    if (t.direction === 'IN') {
      totalIn += usd;
      console.log(`  ${t.date}: IN $${usd.toFixed(2)} from ${t.from_account || 'N/A'}`);
    } else if (t.direction === 'OUT') {
      totalOut += usd;
      console.log(`  ${t.date}: OUT $${usd.toFixed(2)} to ${t.to_account || 'N/A'}`);
    }
  }
  console.log(`  Total IN: $${totalIn.toFixed(2)}`);
  console.log(`  Total OUT: $${totalOut.toFixed(2)}`);
  
  // Net Contributions
  const netContributions = totalDeposits - totalWithdrawals;
  console.log(`\nNet Contributions (Deposits - Withdrawals): $${netContributions.toFixed(2)}`);
  console.log(`Net Contributions (with internal transfers): $${(netContributions - totalOut + totalIn).toFixed(2)}`);
}

db.close();
















