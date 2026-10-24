const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15352922';

console.log('\n=== Deduplicating Deposits by Transaction ID ===\n');

// Find all deposits with duplicate transaction_ids
const findDuplicates = db.prepare(`
  SELECT transaction_id, COUNT(*) as count
  FROM Deposits
  WHERE account_id = ? AND transaction_id IS NOT NULL AND transaction_id != ''
  GROUP BY transaction_id
  HAVING COUNT(*) > 1
`);

const duplicates = findDuplicates.all(accountId);

if (duplicates.length === 0) {
  console.log('✅ No duplicate deposits found');
  db.close();
  process.exit(0);
}

console.log(`Found ${duplicates.length} transaction ID(s) with duplicates:\n`);

let totalRemoved = 0;

for (const dup of duplicates) {
  console.log(`Transaction ID: ${dup.transaction_id} (Count: ${dup.count})`);
  
  // Get all records with this transaction_id
  const getRecords = db.prepare(`
    SELECT id, date, amount, description, created_at
    FROM Deposits
    WHERE account_id = ? AND transaction_id = ?
    ORDER BY date ASC, id ASC
  `);
  
  const records = getRecords.all(accountId, dup.transaction_id);
  
  console.log(`  Records:`);
  records.forEach((r, idx) => {
    const amountUSD = r.amount;
    console.log(`    [${idx + 1}] ID: ${r.id}, Date: ${r.date}, Amount: $${amountUSD.toFixed(2)}, Created: ${r.created_at}`);
  });
  
  // Keep the first record (earliest date), remove the rest
  const recordsToRemove = records.slice(1);
  
  if (recordsToRemove.length > 0) {
    console.log(`  → Keeping record ID ${records[0].id} (earliest date: ${records[0].date})`);
    console.log(`  → Removing ${recordsToRemove.length} duplicate(s):`);
    
    const deleteRecord = db.prepare('DELETE FROM Deposits WHERE id = ?');
    
    for (const record of recordsToRemove) {
      console.log(`    - Removing ID ${record.id} (Date: ${record.date}, Amount: $${record.amount.toFixed(2)})`);
      deleteRecord.run(record.id);
      totalRemoved++;
    }
  }
  
  console.log('');
}

console.log(`\n✅ Removed ${totalRemoved} duplicate deposit(s)`);

// Recalculate total
const getTotal = db.prepare(`
  SELECT SUM(amount * fx_rate_to_base) as total
  FROM Deposits
  WHERE account_id = ?
`);

const result = getTotal.get(accountId);
console.log(`\nNew Total Deposits: $${(result.total || 0).toFixed(2)}\n`);

db.close();













