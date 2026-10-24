const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15352922'; // Long Term - ETF

console.log(`\n=== Checking TWR Calculation for ${accountId} ===\n`);

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

// Get deposits
const getDeposits = db.prepare(`
  SELECT date, amount, fx_rate_to_base
  FROM Deposits
  WHERE account_id = ?
  ORDER BY date ASC
`);

const deposits = getDeposits.all(accountId);
console.log(`Deposits: ${deposits.length} records`);
deposits.forEach(d => {
  const amountUSD = d.amount * d.fx_rate_to_base;
  console.log(`  ${d.date}: $${amountUSD.toFixed(2)}`);
});

// Get withdrawals
const getWithdrawals = db.prepare(`
  SELECT date, amount, fx_rate_to_base
  FROM Withdrawals
  WHERE account_id = ?
  ORDER BY date ASC
`);

const withdrawals = getWithdrawals.all(accountId);
console.log(`\nWithdrawals: ${withdrawals.length} records`);
if (withdrawals.length > 0) {
  withdrawals.forEach(w => {
    const amountUSD = w.amount * w.fx_rate_to_base;
    console.log(`  ${w.date}: $${amountUSD.toFixed(2)}`);
  });
}

// Get internal transfers
const getTransfers = db.prepare(`
  SELECT date, direction, amount, fx_rate_to_base
  FROM Transfers
  WHERE account_id = ? AND UPPER(type) = 'INTERNAL'
  ORDER BY date ASC
`);

const transfers = getTransfers.all(accountId);
console.log(`\nInternal Transfers: ${transfers.length} records`);
if (transfers.length > 0) {
  transfers.forEach(t => {
    const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
    console.log(`  ${t.date}: ${t.direction} $${amountUSD.toFixed(2)}`);
  });
}

// Calculate cash flows by date
const cashFlows = new Map();
deposits.forEach(d => {
  const dateKey = d.date;
  const amountUSD = d.amount * d.fx_rate_to_base;
  cashFlows.set(dateKey, (cashFlows.get(dateKey) || 0) + amountUSD);
});

withdrawals.forEach(w => {
  const dateKey = w.date;
  const amountUSD = w.amount * w.fx_rate_to_base;
  cashFlows.set(dateKey, (cashFlows.get(dateKey) || 0) - amountUSD);
});

// Get internal transfer dates
const internalTransferDates = new Set();
transfers.forEach(t => {
  internalTransferDates.add(t.date);
});

// Find first non-zero NAV
let firstNonZeroIndex = -1;
for (let i = 0; i < navRecords.length; i++) {
  if (navRecords[i].nav_value > 1) {
    firstNonZeroIndex = i;
    break;
  }
}

if (firstNonZeroIndex < 0) {
  console.log('\n❌ No non-zero NAV found');
  db.close();
  process.exit(0);
}

const startNAV = navRecords[firstNonZeroIndex].nav_value;
const startDate = navRecords[firstNonZeroIndex].date;
const endNAV = navRecords[navRecords.length - 1].nav_value;
const endDate = navRecords[navRecords.length - 1].date;

console.log(`\n=== TWR Calculation ===`);
console.log(`Start Date: ${startDate}, NAV: $${startNAV.toFixed(2)}`);
console.log(`End Date: ${endDate}, NAV: $${endNAV.toFixed(2)}`);

// Calculate TWR using Modified Dietz method
let cumulativeMultiplier = 1.0;

for (let i = firstNonZeroIndex; i < navRecords.length; i++) {
  if (i === firstNonZeroIndex) {
    continue; // Skip first point
  }
  
  const prevRecord = navRecords[i - 1];
  const currRecord = navRecords[i];
  const prevNAV = prevRecord.nav_value;
  const currNAV = currRecord.nav_value;
  const dateKey = currRecord.date;
  
  // Get cash flow for this date
  let netCashFlow = cashFlows.get(dateKey) || 0;
  
  // Check previous date for cash flow (deposits might be recorded day before)
  if (Math.abs(netCashFlow) < 1 && i > firstNonZeroIndex) {
    const prevDateKey = prevRecord.date;
    const prevCashFlow = cashFlows.get(prevDateKey) || 0;
    if (Math.abs(prevCashFlow) > 1 && currNAV > prevNAV * 1.5) {
      netCashFlow = prevCashFlow;
    }
  }
  
  // Calculate daily return
  let dailyReturn = 0;
  
  // Neutralize internal transfer dates
  if (internalTransferDates.has(dateKey)) {
    dailyReturn = 0;
  } else if (prevNAV > 0) {
    // Modified Dietz for cash flow days
    if (Math.abs(netCashFlow) > 1) {
      const denominator = prevNAV + 0.5 * netCashFlow;
      if (Math.abs(denominator) > 0.01) {
        dailyReturn = (currNAV - prevNAV - netCashFlow) / denominator;
      }
    } else {
      dailyReturn = (currNAV - prevNAV) / prevNAV;
    }
    
    // Clamp daily return
    dailyReturn = Math.max(-0.99, Math.min(10, dailyReturn));
    
    if (!isFinite(dailyReturn)) {
      dailyReturn = 0;
    }
  }
  
  cumulativeMultiplier *= (1 + dailyReturn);
  cumulativeMultiplier = Math.max(0.001, Math.min(1000, cumulativeMultiplier));
}

const twr = (cumulativeMultiplier - 1) * 100;

console.log(`\nCumulative Multiplier: ${cumulativeMultiplier.toFixed(6)}`);
console.log(`TWR: ${twr.toFixed(2)}%`);

// Calculate annualized yield
const startDateObj = new Date(startDate);
const endDateObj = new Date(endDate);
const daysHeld = Math.max(1, Math.floor((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)));
const twrDecimal = twr / 100;
const annualizedYield = daysHeld > 0 
  ? (Math.pow(1 + twrDecimal, 365 / daysHeld) - 1) * 100
  : 0;

console.log(`Days Held: ${daysHeld}`);
console.log(`Annualized Yield (CAGR): ${annualizedYield.toFixed(2)}%`);

// Compare with dashboard
console.log(`\n=== Dashboard Comparison ===`);
console.log(`Dashboard shows: TWR -53.05%, CAGR -41.98%`);
console.log(`Calculated: TWR ${twr.toFixed(2)}%, CAGR ${annualizedYield.toFixed(2)}%`);

db.close();













