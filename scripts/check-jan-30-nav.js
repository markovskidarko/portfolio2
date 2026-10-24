const Database = require('better-sqlite3');
const path = require('path');
const { format, parseISO, addDays, subDays } = require('date-fns');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15352922'; // Second portfolio

console.log(`\n=== Investigating January 30, 2025 NAV Drop for ${accountId} ===\n`);

// Get NAV records around Jan 30, 2025
const getNAV = db.prepare(`
  SELECT date, nav_value
  FROM DailyNAV
  WHERE account_id = ? AND date >= '2025-01-25' AND date <= '2025-02-05'
  ORDER BY date ASC
`);

const navRecords = getNAV.all(accountId);

console.log('NAV Records around Jan 30, 2025:');
navRecords.forEach(record => {
  const prevRecord = navRecords[navRecords.findIndex(r => r.date === record.date) - 1];
  if (prevRecord) {
    const navChange = record.nav_value - prevRecord.nav_value;
    const navChangePercent = prevRecord.nav_value > 0 ? (navChange / prevRecord.nav_value) * 100 : 0;
    console.log(`  ${record.date}: $${record.nav_value.toFixed(2)} (change: ${navChange >= 0 ? '+' : ''}$${navChange.toFixed(2)}, ${navChangePercent >= 0 ? '+' : ''}${navChangePercent.toFixed(2)}%)`);
  } else {
    console.log(`  ${record.date}: $${record.nav_value.toFixed(2)}`);
  }
});

// Get deposits around this date
const getDeposits = db.prepare(`
  SELECT date, amount, fx_rate_to_base, description, transaction_id
  FROM Deposits
  WHERE account_id = ? AND date >= '2025-01-25' AND date <= '2025-02-05'
  ORDER BY date ASC
`);

const deposits = getDeposits.all(accountId);
console.log('\nDeposits around Jan 30, 2025:');
deposits.forEach(d => {
  const amountUSD = d.amount * d.fx_rate_to_base;
  console.log(`  ${d.date}: +$${amountUSD.toFixed(2)} - ${d.description || 'N/A'}`);
});

// Get internal transfers around this date
const getTransfers = db.prepare(`
  SELECT date, direction, amount, fx_rate_to_base, description, from_account, to_account, transaction_id
  FROM Transfers
  WHERE account_id = ? AND date >= '2025-01-25' AND date <= '2025-02-05'
  ORDER BY date ASC
`);

const transfers = getTransfers.all(accountId);
console.log('\nInternal Transfers around Jan 30, 2025:');
transfers.forEach(t => {
  const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
  console.log(`  ${t.date}: ${t.direction} $${amountUSD.toFixed(2)} - ${t.description || 'N/A'}`);
});

// Calculate what the NAV change should be
console.log('\n=== Expected vs Actual NAV Changes ===');
for (let i = 1; i < navRecords.length; i++) {
  const curr = navRecords[i];
  const prev = navRecords[i - 1];
  const navChange = curr.nav_value - prev.nav_value;
  const navChangePercent = prev.nav_value > 0 ? (navChange / prev.nav_value) * 100 : 0;
  
  // Check for deposits/withdrawals on this date
  const depositOnDate = deposits.find(d => d.date === curr.date);
  const transferOnDate = transfers.find(t => t.date === curr.date);
  
  if (depositOnDate || transferOnDate || Math.abs(navChangePercent) > 5) {
    console.log(`\n${curr.date}:`);
    console.log(`  NAV: $${prev.nav_value.toFixed(2)} → $${curr.nav_value.toFixed(2)}`);
    console.log(`  Change: ${navChange >= 0 ? '+' : ''}$${navChange.toFixed(2)} (${navChangePercent >= 0 ? '+' : ''}${navChangePercent.toFixed(2)}%)`);
    
    if (depositOnDate) {
      const depositAmount = depositOnDate.amount * depositOnDate.fx_rate_to_base;
      console.log(`  Deposit on this date: +$${depositAmount.toFixed(2)}`);
      console.log(`  Expected NAV after deposit (no market movement): $${(prev.nav_value + depositAmount).toFixed(2)}`);
      console.log(`  Actual NAV: $${curr.nav_value.toFixed(2)}`);
      const marketChange = curr.nav_value - prev.nav_value - depositAmount;
      console.log(`  Implied market movement: ${marketChange >= 0 ? '+' : ''}$${marketChange.toFixed(2)}`);
    }
    
    if (transferOnDate) {
      const transferAmount = Math.abs(transferOnDate.amount * transferOnDate.fx_rate_to_base);
      console.log(`  Internal Transfer on this date: ${transferOnDate.direction} $${transferAmount.toFixed(2)}`);
      console.log(`  ⚠️ This date should be neutralized in TWR (return = 0%)`);
    }
  }
}

db.close();













