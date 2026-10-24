const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

// Accounts: U15352922, U15405459, U22758796 (3 portfolios)
const accountIds = ['U15352922', 'U15405459', 'U22758796'];

console.log(`\n=== Checking Equity Curve for Multiple Portfolios ===\n`);
console.log(`Accounts: ${accountIds.join(', ')}\n`);

// Get NAV records for all accounts
const getNAV = db.prepare(`
  SELECT account_id, date, nav_value
  FROM DailyNAV
  WHERE account_id IN (${accountIds.map(() => '?').join(',')})
  ORDER BY date ASC, account_id ASC
`);

const navRecords = getNAV.all(...accountIds);

console.log(`Total NAV records: ${navRecords.length}\n`);

// Group by date
const navByDate = {};
navRecords.forEach(record => {
  if (!navByDate[record.date]) {
    navByDate[record.date] = {};
  }
  navByDate[record.date][record.account_id] = record.nav_value;
});

// Find date range
const allDates = Object.keys(navByDate).sort();
console.log(`Date range: ${allDates[0]} to ${allDates[allDates.length - 1]}`);
console.log(`Total unique dates: ${allDates.length}\n`);

// Check aggregated NAV for each date
console.log('First 20 dates with aggregated NAV:');
let count = 0;
for (const date of allDates) {
  const navs = navByDate[date];
  const aggregatedNAV = Object.values(navs).reduce((sum, nav) => sum + (nav || 0), 0);
  
  if (count < 20 || aggregatedNAV > 0) {
    const accountsList = accountIds.map(accId => {
      const nav = navs[accId] || 0;
      return `${accId}: $${nav.toFixed(2)}`;
    }).join(', ');
    console.log(`  ${date}: $${aggregatedNAV.toFixed(2)} (${accountsList})`);
    count++;
  }
  
  if (count >= 20) break;
}

console.log('\nLast 10 dates with aggregated NAV:');
for (const date of allDates.slice(-10)) {
  const navs = navByDate[date];
  const aggregatedNAV = Object.values(navs).reduce((sum, nav) => sum + (nav || 0), 0);
  const accountsList = accountIds.map(accId => {
    const nav = navs[accId] || 0;
    return `${accId}: $${nav.toFixed(2)}`;
  }).join(', ');
  console.log(`  ${date}: $${aggregatedNAV.toFixed(2)} (${accountsList})`);
}

// Check for dates where all accounts have zero NAV
console.log('\n=== Checking for Zero NAV Dates ===');
let zeroNavCount = 0;
for (const date of allDates) {
  const navs = navByDate[date];
  const aggregatedNAV = Object.values(navs).reduce((sum, nav) => sum + (nav || 0), 0);
  if (aggregatedNAV === 0) {
    zeroNavCount++;
    if (zeroNavCount <= 10) {
      console.log(`  ${date}: $0.00`);
    }
  }
}
if (zeroNavCount > 10) {
  console.log(`  ... and ${zeroNavCount - 10} more dates with $0 NAV`);
}

// Find first non-zero aggregated NAV date
const firstNonZeroDate = allDates.find(date => {
  const navs = navByDate[date];
  const aggregatedNAV = Object.values(navs).reduce((sum, nav) => sum + (nav || 0), 0);
  return aggregatedNAV > 1;
});

console.log(`\nFirst non-zero aggregated NAV date: ${firstNonZeroDate || 'NOT FOUND'}`);

// Check each account's date range
console.log('\n=== Account Date Ranges ===');
accountIds.forEach(accId => {
  const accountRecords = navRecords.filter(r => r.account_id === accId);
  if (accountRecords.length > 0) {
    const firstDate = accountRecords[0].date;
    const lastDate = accountRecords[accountRecords.length - 1].date;
    const firstNonZero = accountRecords.find(r => r.nav_value > 1);
    console.log(`${accId}:`);
    console.log(`  First record: ${firstDate} (NAV: $${accountRecords[0].nav_value.toFixed(2)})`);
    console.log(`  Last record: ${lastDate} (NAV: $${accountRecords[accountRecords.length - 1].nav_value.toFixed(2)})`);
    console.log(`  First non-zero NAV: ${firstNonZero ? firstNonZero.date : 'N/A'} (NAV: $${firstNonZero ? firstNonZero.nav_value.toFixed(2) : 'N/A'})`);
    console.log(`  Total records: ${accountRecords.length}`);
  }
});

db.close();













