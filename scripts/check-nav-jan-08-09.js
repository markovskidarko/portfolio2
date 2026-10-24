const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('Checking NAV values for January 8th and 9th, 2026...\n');

// Get all accounts
const getAccounts = db.prepare(`
  SELECT DISTINCT account_id 
  FROM DailyNAV 
  WHERE date IN ('2026-01-08', '2026-01-09')
  ORDER BY account_id
`);

const accounts = getAccounts.all();

if (accounts.length === 0) {
  console.log('No NAV records found for January 8th or 9th, 2026.');
  db.close();
  process.exit(0);
}

console.log(`Found ${accounts.length} account(s) with NAV data for these dates:\n`);

// Get NAV values for each date for each account
  const getNavByDate = db.prepare(`
  SELECT date, nav_value
  FROM DailyNAV
  WHERE account_id = ? AND date IN ('2026-01-08', '2026-01-09')
  ORDER BY date
`);

// Get account aliases if available
const getAccountAlias = db.prepare(`
  SELECT alias
  FROM Accounts
  WHERE id = ?
  LIMIT 1
`);

for (const account of accounts) {
  const accountId = account.account_id;
  
  // Try to get account alias/name
  let accountName = null;
  try {
    const nameResult = getAccountAlias.get(accountId);
    accountName = nameResult?.alias || null;
  } catch (error) {
    // Account name not available, continue
  }
  
  console.log(`${accountName ? `\n${accountName} ` : ''}(${accountId}):`);
  console.log('─'.repeat(60));
  
  const navRecords = getNavByDate.all(accountId);
  
  if (navRecords.length === 0) {
    console.log('  No NAV records found for this account');
    continue;
  }
  
  // Create a map for easy lookup
  const navMap = {};
  for (const record of navRecords) {
    navMap[record.date] = record.nav_value;
  }
  
  // Display NAV for January 8th
  if (navMap['2026-01-08']) {
    console.log(`  January 8th, 2026:  $${navMap['2026-01-08'].toFixed(2)}`);
  } else {
    console.log(`  January 8th, 2026:  MISSING`);
  }
  
  // Display NAV for January 9th
  if (navMap['2026-01-09']) {
    console.log(`  January 9th, 2026:  $${navMap['2026-01-09'].toFixed(2)}`);
  } else {
    console.log(`  January 9th, 2026:  MISSING`);
  }
  
  // Calculate change if both dates exist
  if (navMap['2026-01-08'] && navMap['2026-01-09']) {
    const change = navMap['2026-01-09'] - navMap['2026-01-08'];
    const changePercent = (change / navMap['2026-01-08']) * 100;
    console.log(`  Change:             $${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`);
  }
}

// Also show aggregated NAV if multiple accounts
if (accounts.length > 1) {
  console.log('\n' + '═'.repeat(60));
  console.log('AGGREGATED NAV (All Portfolios Combined):');
  console.log('═'.repeat(60));
  
  const getAggregatedNav = db.prepare(`
    SELECT date, SUM(nav_value) as total_nav
    FROM DailyNAV
    WHERE date IN ('2026-01-08', '2026-01-09')
    GROUP BY date
    ORDER BY date
  `);
  
  const aggregatedNavs = getAggregatedNav.all();
  
  const aggMap = {};
  for (const record of aggregatedNavs) {
    aggMap[record.date] = record.total_nav;
  }
  
  if (aggMap['2026-01-08']) {
    console.log(`  January 8th, 2026:  $${aggMap['2026-01-08'].toFixed(2)}`);
  } else {
    console.log(`  January 8th, 2026:  MISSING`);
  }
  
  if (aggMap['2026-01-09']) {
    console.log(`  January 9th, 2026:  $${aggMap['2026-01-09'].toFixed(2)}`);
  } else {
    console.log(`  January 9th, 2026:  MISSING`);
  }
  
  if (aggMap['2026-01-08'] && aggMap['2026-01-09']) {
    const change = aggMap['2026-01-09'] - aggMap['2026-01-08'];
    const changePercent = (change / aggMap['2026-01-08']) * 100;
    console.log(`  Change:             $${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`);
  }
}

console.log('\n');

db.close();

