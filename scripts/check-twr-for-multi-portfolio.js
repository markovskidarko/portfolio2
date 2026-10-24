const Database = require('better-sqlite3');
const path = require('path');
const { format, parseISO } = require('date-fns');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

// Simulate what the TWR calculation does
const accountIds = ['U15352922', 'U15405459', 'U22758796'];

console.log(`\n=== Simulating TWR Calculation for 3 Portfolios ===\n`);

// Get all NAV records
const getNAV = db.prepare(`
  SELECT account_id, date, nav_value
  FROM DailyNAV
  WHERE account_id IN (${accountIds.map(() => '?').join(',')})
  ORDER BY date ASC, account_id ASC
`);

const navRecords = getNAV.all(...accountIds);

// Group by date
const navByDate = {};
navRecords.forEach(record => {
  if (!navByDate[record.date]) {
    navByDate[record.date] = {};
  }
  navByDate[record.date][record.account_id] = record.nav_value;
});

// Build aggregated NAV curve
const allDates = Object.keys(navByDate).sort();
const equityCurve = [];

for (const date of allDates) {
  const navs = navByDate[date];
  const aggregatedNAV = Object.values(navs).reduce((sum, nav) => sum + (nav || 0), 0);
  equityCurve.push({
    date: parseISO(date),
    nav: aggregatedNAV,
    cumulativeReturn: 0
  });
}

console.log(`Built equity curve with ${equityCurve.length} points`);
console.log(`First date: ${equityCurve[0].date.toISOString().split('T')[0]}, NAV: $${equityCurve[0].nav.toFixed(2)}`);
console.log(`Last date: ${equityCurve[equityCurve.length - 1].date.toISOString().split('T')[0]}, NAV: $${equityCurve[equityCurve.length - 1].nav.toFixed(2)}\n`);

// Find first non-zero NAV
const firstNonZeroIndex = equityCurve.findIndex(p => p.nav > 1);
console.log(`First non-zero NAV index: ${firstNonZeroIndex}`);
if (firstNonZeroIndex >= 0) {
  console.log(`First non-zero NAV date: ${equityCurve[firstNonZeroIndex].date.toISOString().split('T')[0]}, NAV: $${equityCurve[firstNonZeroIndex].nav.toFixed(2)}\n`);
}

// Simulate TWR calculation (without cash flows for now)
let cumulativeMultiplier = 1.0;
for (let i = firstNonZeroIndex >= 0 ? firstNonZeroIndex : 0; i < equityCurve.length; i++) {
  if (i === firstNonZeroIndex || (firstNonZeroIndex < 0 && i === 0)) {
    equityCurve[i].cumulativeReturn = 0;
    continue;
  }
  
  const prevPoint = equityCurve[i - 1];
  const prevNAV = prevPoint.nav;
  const currNAV = equityCurve[i].nav;
  
  if (prevNAV > 0 && currNAV > 0) {
    const dailyReturn = (currNAV - prevNAV) / prevNAV;
    cumulativeMultiplier *= (1 + dailyReturn);
    equityCurve[i].cumulativeReturn = (cumulativeMultiplier - 1) * 100;
  } else {
    equityCurve[i].cumulativeReturn = prevPoint.cumulativeReturn || 0;
  }
}

// Show first 10 and last 10 points with TWR
console.log('First 10 points with TWR:');
equityCurve.slice(0, 10).forEach((point, idx) => {
  console.log(`  [${idx}] ${format(point.date, 'yyyy-MM-dd')}: NAV=$${point.nav.toFixed(2)}, TWR=${point.cumulativeReturn.toFixed(2)}%`);
});

console.log('\nLast 10 points with TWR:');
equityCurve.slice(-10).forEach((point, idx) => {
  const actualIdx = equityCurve.length - 10 + idx;
  console.log(`  [${actualIdx}] ${format(point.date, 'yyyy-MM-dd')}: NAV=$${point.nav.toFixed(2)}, TWR=${point.cumulativeReturn.toFixed(2)}%`);
});

// Check for invalid returns
const invalidReturns = equityCurve.filter(p => isNaN(p.cumulativeReturn) || !isFinite(p.cumulativeReturn) || p.cumulativeReturn === 0);
console.log(`\nPoints with invalid/zero returns: ${invalidReturns.length}/${equityCurve.length}`);

if (invalidReturns.length > 0 && invalidReturns.length < 20) {
  console.log('Invalid return points:');
  invalidReturns.slice(0, 10).forEach(point => {
    console.log(`  ${format(point.date, 'yyyy-MM-dd')}: NAV=$${point.nav.toFixed(2)}, TWR=${point.cumulativeReturn}`);
  });
}

db.close();













