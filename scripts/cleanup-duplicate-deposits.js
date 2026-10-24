const Database = require('better-sqlite3');
const path = require('path');
const { join } = require('path');

const dbPath = join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('\n=== Cleaning up duplicate deposits ===\n');

// Find duplicates by transaction_id
const findDuplicates = db.prepare(`
  SELECT 
    account_id,
    transaction_id,
    COUNT(*) as count,
    GROUP_CONCAT(id) as ids
  FROM Deposits
  WHERE transaction_id IS NOT NULL
  GROUP BY account_id, transaction_id
  HAVING COUNT(*) > 1
`);

const duplicates = findDuplicates.all();

if (duplicates.length === 0) {
  console.log('No duplicate deposits found.');
} else {
  console.log(`Found ${duplicates.length} duplicate deposit group(s):\n`);
  
  let totalRemoved = 0;
  
  for (const dup of duplicates) {
    const ids = dup.ids.split(',').map(id => parseInt(id));
    // Keep the first one (lowest ID), remove the rest
    const idsToRemove = ids.slice(1);
    
    console.log(`Account: ${dup.account_id}, Transaction ID: ${dup.transaction_id}`);
    console.log(`  Found ${dup.count} duplicates (IDs: ${ids.join(', ')})`);
    console.log(`  Keeping ID: ${ids[0]}, Removing IDs: ${idsToRemove.join(', ')}`);
    
    // Get details of deposits being removed
    const getDetails = db.prepare(`
      SELECT date, amount, description FROM Deposits WHERE id = ?
    `);
    
    for (const idToRemove of idsToRemove) {
      const details = getDetails.get(idToRemove);
      console.log(`    Removing: ID ${idToRemove} - ${details.date}, $${details.amount}, ${details.description}`);
      
      const deleteStmt = db.prepare(`DELETE FROM Deposits WHERE id = ?`);
      deleteStmt.run(idToRemove);
      totalRemoved++;
    }
    console.log('');
  }
  
  console.log(`\n✓ Removed ${totalRemoved} duplicate deposit record(s).`);
}

db.close();




