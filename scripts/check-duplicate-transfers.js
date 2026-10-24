const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15352922';

console.log(`\n=== Checking for Duplicate Transfers for ${accountId} ===\n`);

// Get all transfers with full details
const getTransfers = db.prepare(`
  SELECT id, account_id, type, direction, amount, date, description, currency, fx_rate_to_base, from_account, to_account, transaction_id, created_at
  FROM Transfers
  WHERE account_id = ? AND type = 'internal'
  ORDER BY date ASC, id ASC
`);

const transfers = getTransfers.all(accountId);

console.log(`Found ${transfers.length} internal transfer(s):\n`);

// Group by date and amount to find duplicates
const grouped = {};
transfers.forEach(t => {
  const key = `${t.date}_${t.amount}_${t.direction}_${t.to_account || ''}`;
  if (!grouped[key]) {
    grouped[key] = [];
  }
  grouped[key].push(t);
});

// Find duplicates
const duplicates = Object.entries(grouped).filter(([key, records]) => records.length > 1);

if (duplicates.length > 0) {
  console.log(`⚠️  Found ${duplicates.length} set(s) of duplicate transfers:\n`);
  
  duplicates.forEach(([key, records]) => {
    console.log(`Duplicate Group (${records.length} records):`);
    records.forEach((r, idx) => {
      console.log(`  [${idx + 1}] ID: ${r.id}, Date: ${r.date}, Amount: $${r.amount}, Direction: ${r.direction}`);
      console.log(`      To Account: ${r.to_account || 'N/A'}, Transaction ID: ${r.transaction_id || 'N/A'}`);
      console.log(`      Description: ${r.description || 'N/A'}`);
      console.log(`      Created At: ${r.created_at}`);
      console.log('');
    });
    console.log('');
  });
  
  // Calculate total impact
  let totalDuplicateAmount = 0;
  duplicates.forEach(([key, records]) => {
    // Count all but the first as duplicates
    const duplicateRecords = records.slice(1);
    duplicateRecords.forEach(r => {
      totalDuplicateAmount += Math.abs(r.amount * r.fx_rate_to_base);
    });
  });
  
  console.log(`\n💰 Total duplicate amount: $${totalDuplicateAmount.toFixed(2)}`);
  console.log(`   This means Net Contributions is being understated by $${totalDuplicateAmount.toFixed(2)}`);
} else {
  console.log('✅ No duplicates found (all transfers are unique)');
}

// Show unique constraint details
console.log(`\n=== Unique Constraint Info ===`);
const indexInfo = db.prepare(`
  SELECT sql FROM sqlite_master 
  WHERE type='index' AND name='idx_transfers_unique'
`).get();

if (indexInfo) {
  console.log(`Unique Index: ${indexInfo.sql}`);
} else {
  console.log('⚠️  Unique index not found!');
}

db.close();













