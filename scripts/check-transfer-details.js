const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15352922';

console.log(`\n=== Checking ALL Transfers for ${accountId} ===\n`);

// Get ALL transfers (any type)
const getAllTransfers = db.prepare(`
  SELECT id, account_id, type, direction, amount, date, description, currency, fx_rate_to_base, from_account, to_account, transaction_id, created_at
  FROM Transfers
  WHERE account_id = ?
  ORDER BY date ASC, id ASC
`);

const transfers = getAllTransfers.all(accountId);

console.log(`Found ${transfers.length} transfer(s) total:\n`);

transfers.forEach((t, idx) => {
  const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
  console.log(`[${idx + 1}] ID: ${t.id}`);
  console.log(`    Type: "${t.type}"`);
  console.log(`    Direction: ${t.direction}`);
  console.log(`    Date: ${t.date}`);
  console.log(`    Amount: $${amountUSD.toFixed(2)} (${t.amount} ${t.currency} @ ${t.fx_rate_to_base})`);
  console.log(`    To Account: ${t.to_account || 'N/A'}`);
  console.log(`    From Account: ${t.from_account || 'N/A'}`);
  console.log(`    Transaction ID: ${t.transaction_id || 'N/A'}`);
  console.log(`    Description: ${t.description || 'N/A'}`);
  console.log(`    Created At: ${t.created_at}`);
  console.log('');
});

// Check for duplicates based on the unique constraint
console.log(`\n=== Checking for Duplicates (based on unique constraint) ===\n`);
const uniqueConstraint = db.prepare(`
  SELECT account_id, date, amount, COALESCE(transaction_id, '') as tx_id, type, direction, COUNT(*) as count
  FROM Transfers
  WHERE account_id = ?
  GROUP BY account_id, date, amount, COALESCE(transaction_id, ''), type, direction
  HAVING COUNT(*) > 1
`);

const duplicates = uniqueConstraint.all(accountId);

if (duplicates.length > 0) {
  console.log(`⚠️  Found ${duplicates.length} duplicate group(s) based on unique constraint:\n`);
  duplicates.forEach(dup => {
    console.log(`Duplicate Group:`);
    console.log(`  Date: ${dup.date}`);
    console.log(`  Amount: $${Math.abs(dup.amount).toFixed(2)}`);
    console.log(`  Type: ${dup.type}`);
    console.log(`  Direction: ${dup.direction}`);
    console.log(`  Transaction ID: ${dup.tx_id || 'N/A'}`);
    console.log(`  Count: ${dup.count}`);
    console.log('');
    
    // Get all records in this duplicate group
    const getDupRecords = db.prepare(`
      SELECT id, account_id, type, direction, amount, date, description, from_account, to_account, transaction_id, created_at
      FROM Transfers
      WHERE account_id = ? AND date = ? AND amount = ? AND COALESCE(transaction_id, '') = ? AND type = ? AND direction = ?
      ORDER BY id ASC
    `);
    
    const dupRecords = getDupRecords.all(accountId, dup.date, dup.amount, dup.tx_id, dup.type, dup.direction);
    console.log(`  Records:`);
    dupRecords.forEach((r, idx) => {
      console.log(`    [${idx + 1}] ID: ${r.id}, Created: ${r.created_at}`);
      console.log(`        Description: ${r.description || 'N/A'}`);
      console.log(`        From: ${r.from_account || 'N/A'}, To: ${r.to_account || 'N/A'}`);
    });
    console.log('');
  });
} else {
  console.log('✅ No duplicates found based on unique constraint');
}

// Check if dates are different but amounts are the same (potential duplicates with different dates)
console.log(`\n=== Checking for Similar Transfers (same amount, different dates) ===\n`);
const similarTransfers = db.prepare(`
  SELECT amount, COUNT(DISTINCT date) as date_count, COUNT(*) as total_count, GROUP_CONCAT(DISTINCT date) as dates
  FROM Transfers
  WHERE account_id = ? AND direction = 'OUT'
  GROUP BY ABS(amount)
  HAVING COUNT(DISTINCT date) > 1 AND COUNT(*) > 1
`);

const similar = similarTransfers.all(accountId);

if (similar.length > 0) {
  console.log(`⚠️  Found ${similar.length} group(s) of transfers with same amount but different dates:\n`);
  similar.forEach(s => {
    console.log(`Amount: $${Math.abs(s.amount).toFixed(2)}`);
    console.log(`  Different dates: ${s.dates}`);
    console.log(`  Total records: ${s.total_count}`);
    console.log('');
    
    // Get all records
    const getSimilar = db.prepare(`
      SELECT id, date, amount, direction, to_account, transaction_id, description, created_at
      FROM Transfers
      WHERE account_id = ? AND ABS(amount) = ABS(?)
      ORDER BY date ASC, id ASC
    `);
    
    const records = getSimilar.all(accountId, s.amount);
    records.forEach((r, idx) => {
      console.log(`    [${idx + 1}] ID: ${r.id}, Date: ${r.date}, To: ${r.to_account || 'N/A'}, TX ID: ${r.transaction_id || 'N/A'}`);
      console.log(`        Created: ${r.created_at}`);
    });
    console.log('');
  });
} else {
  console.log('✅ No similar transfers found');
}

db.close();













