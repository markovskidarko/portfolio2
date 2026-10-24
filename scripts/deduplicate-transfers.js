const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('\n=== Deduplicating Transfers by Transaction ID ===\n');

// Find all transfers with duplicate transaction_ids
const findDuplicates = db.prepare(`
  SELECT transaction_id, account_id, COUNT(*) as count
  FROM Transfers
  WHERE transaction_id IS NOT NULL AND transaction_id != ''
  GROUP BY transaction_id, account_id
  HAVING COUNT(*) > 1
`);

const duplicates = findDuplicates.all();

if (duplicates.length === 0) {
  console.log('✅ No duplicate transfers found');
  db.close();
  process.exit(0);
}

console.log(`Found ${duplicates.length} transaction ID(s) with duplicates:\n`);

let totalRemoved = 0;

for (const dup of duplicates) {
  console.log(`Transaction ID: ${dup.transaction_id} (Account: ${dup.account_id}, Count: ${dup.count})`);
  
  // Get all records with this transaction_id
  const getRecords = db.prepare(`
    SELECT id, date, amount, direction, type, description, from_account, to_account, created_at
    FROM Transfers
    WHERE transaction_id = ? AND account_id = ?
    ORDER BY date ASC, id ASC
  `);
  
  const records = getRecords.all(dup.transaction_id, dup.account_id);
  
  console.log(`  Records:`);
  records.forEach((r, idx) => {
    console.log(`    [${idx + 1}] ID: ${r.id}, Date: ${r.date}, Amount: $${Math.abs(r.amount).toFixed(2)}, Created: ${r.created_at}`);
  });
  
  // Keep the first record (earliest date), remove the rest
  const recordsToRemove = records.slice(1);
  
  if (recordsToRemove.length > 0) {
    console.log(`  → Keeping record ID ${records[0].id} (earliest date: ${records[0].date})`);
    console.log(`  → Removing ${recordsToRemove.length} duplicate(s):`);
    
    const deleteRecord = db.prepare('DELETE FROM Transfers WHERE id = ?');
    
    for (const record of recordsToRemove) {
      console.log(`    - Removing ID ${record.id} (Date: ${record.date})`);
      deleteRecord.run(record.id);
      totalRemoved++;
    }
  }
  
  console.log('');
}

console.log(`\n✅ Removed ${totalRemoved} duplicate transfer(s)`);
console.log(`\nVerifying...`);

// Verify no duplicates remain
const verifyDuplicates = db.prepare(`
  SELECT transaction_id, account_id, COUNT(*) as count
  FROM Transfers
  WHERE transaction_id IS NOT NULL AND transaction_id != ''
  GROUP BY transaction_id, account_id
  HAVING COUNT(*) > 1
`);

const remaining = verifyDuplicates.all();

if (remaining.length === 0) {
  console.log('✅ No duplicates remain');
} else {
  console.log(`⚠️  Still found ${remaining.length} duplicate group(s):`);
  remaining.forEach(r => {
    console.log(`  Transaction ID: ${r.transaction_id} (Account: ${r.account_id}, Count: ${r.count})`);
  });
}

db.close();













