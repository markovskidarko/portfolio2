const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('=== DEBUGGING DATA INGESTION ===\n');

// Check what's actually in Transfers table
console.log('--- Transfers Table ---');
const allTransfers = db.prepare('SELECT * FROM Transfers ORDER BY date').all();
console.log(`Total transfers: ${allTransfers.length}`);
allTransfers.forEach(t => {
  console.log(`  ${t.date}: ${t.account_id} - ${t.type} ${t.direction} $${(t.amount * t.fx_rate_to_base).toFixed(2)} from ${t.from_account || 'N/A'} to ${t.to_account || 'N/A'}`);
});

// Check Transactions table
console.log('\n--- Transactions Table (sample) ---');
const transactions = db.prepare(`
  SELECT account_id, type, amount, date, description 
  FROM Transactions 
  WHERE account_id IN ('U15352922', 'U15405459', 'U16030763', 'U22758796')
  ORDER BY date 
  LIMIT 50
`).all();
console.log(`Found ${transactions.length} transactions:`);
transactions.forEach(t => {
  console.log(`  ${t.date}: ${t.account_id} - ${t.type} $${t.amount.toFixed(2)} - ${t.description || ''}`);
});

// Check for deposits that might be in Transactions but not Deposits
console.log('\n--- Missing Deposits Check ---');
const accounts = ['U15352922', 'U15405459', 'U16030763', 'U22758796'];
for (const accountId of accounts) {
  const txDeposits = db.prepare(`
    SELECT type, amount, date, description 
    FROM Transactions 
    WHERE account_id = ? 
    AND (type LIKE '%deposit%' OR description LIKE '%deposit%')
    AND type NOT LIKE '%dividend%'
    ORDER BY date
  `).all(accountId);
  
  const dbDeposits = db.prepare('SELECT COUNT(*) as count FROM Deposits WHERE account_id = ?').get(accountId);
  
  if (txDeposits.length > 0 || dbDeposits.count === 0) {
    console.log(`\n${accountId}:`);
    console.log(`  Transactions table deposits: ${txDeposits.length}`);
    console.log(`  Deposits table records: ${dbDeposits.count}`);
    if (txDeposits.length > 0) {
      txDeposits.forEach(d => {
        console.log(`    ${d.date}: $${d.amount.toFixed(2)} - ${d.description || d.type}`);
      });
    }
  }
}

db.close();
















