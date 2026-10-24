const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('Last Date and NAV for each Portfolio:\n');
console.log('═'.repeat(80));
console.log(`${'Portfolio'.padEnd(40)} ${'Last Date'.padEnd(12)} ${'Last Date NAV'.padStart(15)}`);
console.log('═'.repeat(80));

// Get all accounts
const getAccounts = db.prepare(`
  SELECT id, alias
  FROM Accounts
  WHERE id != 'HUNGARY_MIGRATION_HISTORY'
  ORDER BY id
`);

const accounts = getAccounts.all();

if (accounts.length === 0) {
  console.log('No accounts found in database.');
  db.close();
  process.exit(0);
}

// Get the latest NAV for each account
const getLatestNav = db.prepare(`
  SELECT date, nav_value
  FROM DailyNAV
  WHERE account_id = ?
  ORDER BY date DESC
  LIMIT 1
`);

const results = [];

for (const account of accounts) {
  const accountId = account.id;
  const accountAlias = account.alias;
  
  try {
    const latestNav = getLatestNav.get(accountId);
    
    if (latestNav) {
      results.push({
        portfolio: accountAlias ? `${accountId} (${accountAlias})` : accountId,
        date: latestNav.date,
        nav: latestNav.nav_value
      });
    } else {
      results.push({
        portfolio: accountAlias ? `${accountId} (${accountAlias})` : accountId,
        date: 'N/A',
        nav: 0
      });
    }
  } catch (error) {
    results.push({
      portfolio: accountAlias ? `${accountId} (${accountAlias})` : accountId,
      date: 'ERROR',
      nav: 0
    });
  }
}

// Sort by portfolio ID
results.sort((a, b) => a.portfolio.localeCompare(b.portfolio));

// Print results
for (const result of results) {
  const portfolioDisplay = result.portfolio.length > 39 ? result.portfolio.substring(0, 36) + '...' : result.portfolio;
  const dateDisplay = result.date;
  const navDisplay = result.nav > 0 ? `$${result.nav.toFixed(2)}` : result.date === 'N/A' ? 'No NAV data' : result.date;
  
  console.log(`${portfolioDisplay.padEnd(40)} ${dateDisplay.padEnd(12)} ${navDisplay.padStart(15)}`);
}

console.log('═'.repeat(80));
console.log(`\nTotal portfolios: ${results.length}`);
console.log(`Portfolios with NAV data: ${results.filter(r => r.nav > 0).length}`);

// Also show aggregated totals if multiple portfolios
if (results.length > 1) {
  console.log('\n' + '─'.repeat(80));
  console.log('AGGREGATED (All Portfolios Combined):');
  console.log('─'.repeat(80));
  
  // Get latest date across all portfolios
  const getLatestDateAll = db.prepare(`
    SELECT MAX(date) as max_date
    FROM DailyNAV
  `);
  
  const latestDateAll = getLatestDateAll.get();
  
  if (latestDateAll && latestDateAll.max_date) {
    // Get aggregated NAV for that date
    const getAggregatedNav = db.prepare(`
      SELECT SUM(nav_value) as total_nav
      FROM DailyNAV
      WHERE date = ?
    `);
    
    const aggregatedNav = getAggregatedNav.get(latestDateAll.max_date);
    
    console.log(`Last Date: ${latestDateAll.max_date}`);
    console.log(`Aggregated NAV: ${aggregatedNav && aggregatedNav.total_nav ? `$${aggregatedNav.total_nav.toFixed(2)}` : 'N/A'}`);
  } else {
    console.log('No aggregated NAV data available');
  }
}

console.log('\n');

db.close();













