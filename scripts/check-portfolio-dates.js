const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U22758796'; // 4th portfolio

console.log(`\n=== Checking NAV Data for ${accountId} ===\n`);

// Get NAV data
const getNAV = db.prepare(`
  SELECT date, nav_value
  FROM DailyNAV
  WHERE account_id = ?
  ORDER BY date ASC
`);

const navRecords = getNAV.all(accountId);
console.log(`Found ${navRecords.length} NAV records\n`);

if (navRecords.length === 0) {
  console.log('No NAV data found');
  db.close();
  process.exit(0);
}

console.log('First 10 NAV records:');
navRecords.slice(0, 10).forEach((record, idx) => {
  console.log(`  [${idx + 1}] ${record.date}: $${record.nav_value.toFixed(2)}`);
});

console.log('\nLast 10 NAV records:');
navRecords.slice(-10).forEach((record, idx) => {
  const actualIdx = navRecords.length - 10 + idx;
  console.log(`  [${actualIdx + 1}] ${record.date}: $${record.nav_value.toFixed(2)}`);
});

console.log(`\nFirst date: ${navRecords[0].date}`);
console.log(`Last date: ${navRecords[navRecords.length - 1].date}`);
console.log(`Total records: ${navRecords.length}`);

// Check for expected start date: 2025-11-11
const expectedStartDate = '2025-11-11';
const firstDate = navRecords[0].date;

if (firstDate === expectedStartDate) {
  console.log(`\n✅ First date matches expected start date: ${expectedStartDate}`);
} else {
  console.log(`\n❌ First date (${firstDate}) does NOT match expected start date (${expectedStartDate})`);
  
  // Find the expected date in the records
  const expectedRecord = navRecords.find(r => r.date === expectedStartDate);
  if (expectedRecord) {
    const expectedIdx = navRecords.findIndex(r => r.date === expectedStartDate);
    console.log(`   Found ${expectedStartDate} at index ${expectedIdx} with NAV: $${expectedRecord.nav_value.toFixed(2)}`);
    console.log(`   There are ${expectedIdx} records before the expected start date`);
    
    if (expectedIdx > 0) {
      console.log(`\n   Records before ${expectedStartDate}:`);
      navRecords.slice(0, expectedIdx).forEach((r, idx) => {
        console.log(`     ${r.date}: $${r.nav_value.toFixed(2)}`);
      });
    }
  } else {
    console.log(`   ${expectedStartDate} NOT FOUND in records`);
  }
}

// Check for zero or invalid NAVs at the start
console.log(`\n=== Checking for Zero/Invalid NAVs at Start ===`);
let zeroNavCount = 0;
for (let i = 0; i < Math.min(20, navRecords.length); i++) {
  if (navRecords[i].nav_value <= 0 || navRecords[i].nav_value < 1) {
    zeroNavCount++;
    console.log(`  ${navRecords[i].date}: $${navRecords[i].nav_value.toFixed(2)} (zero/invalid)`);
  }
}
if (zeroNavCount === 0) {
  console.log('  No zero/invalid NAVs found in first 20 records');
}

// Check deposits to understand account start
console.log(`\n=== Checking Deposits ===`);
const getDeposits = db.prepare(`
  SELECT date, amount, fx_rate_to_base
  FROM Deposits
  WHERE account_id = ?
  ORDER BY date ASC
`);

const deposits = getDeposits.all(accountId);
console.log(`Found ${deposits.length} deposit(s):`);
deposits.forEach(d => {
  const amountUSD = d.amount * d.fx_rate_to_base;
  console.log(`  ${d.date}: $${amountUSD.toFixed(2)}`);
});

// Check transfers (internal transfers IN might indicate account start)
console.log(`\n=== Checking Internal Transfers IN ===`);
const getTransfers = db.prepare(`
  SELECT date, direction, amount, fx_rate_to_base, from_account
  FROM Transfers
  WHERE account_id = ? AND UPPER(type) = 'INTERNAL' AND UPPER(direction) = 'IN'
  ORDER BY date ASC
`);

const transfersIn = getTransfers.all(accountId);
console.log(`Found ${transfersIn.length} internal transfer(s) IN:`);
transfersIn.forEach(t => {
  const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
  console.log(`  ${t.date}: $${amountUSD.toFixed(2)} from ${t.from_account || 'N/A'}`);
});

db.close();













