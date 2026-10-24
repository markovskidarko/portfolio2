const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('=== CHECKING ALL TRANSFERS ===\n');

const accounts = ['U15352922', 'U15405459', 'U16030763', 'U22758796'];

for (const accountId of accounts) {
  console.log(`\n--- ${accountId} ---`);
  
  const transfers = db.prepare(`
    SELECT type, direction, amount, date, description, from_account, to_account, currency, fx_rate_to_base
    FROM Transfers
    WHERE from_account = ? OR to_account = ?
    ORDER BY date ASC
  `).all(accountId, accountId);
  
  if (transfers.length > 0) {
    console.log(`Transfers (${transfers.length}):`);
    transfers.forEach(t => {
      const usd = t.amount * t.fx_rate_to_base;
      if (t.from_account === accountId) {
        console.log(`  ${t.date}: OUT $${usd.toFixed(2)} to ${t.to_account} (${t.type}) - ${t.description || ''}`);
      } else {
        console.log(`  ${t.date}: IN $${usd.toFixed(2)} from ${t.from_account} (${t.type}) - ${t.description || ''}`);
      }
    });
  } else {
    console.log('No transfers found');
  }
}

db.close();
















