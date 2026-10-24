const Database = require('better-sqlite3');
const path = require('path');
const { format, parseISO } = require('date-fns');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

const accountId = 'U15352922'; // Second portfolio

console.log(`\n=== Investigating November 6, 2025 NAV Drop for ${accountId} ===\n`);

// Get NAV records around Nov 6, 2025
const getNAV = db.prepare(`
  SELECT date, nav_value
  FROM DailyNAV
  WHERE account_id = ? AND date >= '2025-11-01' AND date <= '2025-11-15'
  ORDER BY date ASC
`);

const navRecords = getNAV.all(accountId);

console.log('NAV Records around Nov 6, 2025:');
navRecords.forEach((record, idx) => {
  const prevRecord = idx > 0 ? navRecords[idx - 1] : null;
  if (prevRecord) {
    const navChange = record.nav_value - prevRecord.nav_value;
    const navChangePercent = prevRecord.nav_value > 0 ? (navChange / prevRecord.nav_value) * 100 : 0;
    const marker = record.date === '2025-11-06' ? ' ⚠️ TARGET DATE' : '';
    console.log(`  ${record.date}: $${record.nav_value.toFixed(2)} (change: ${navChange >= 0 ? '+' : ''}$${navChange.toFixed(2)}, ${navChangePercent >= 0 ? '+' : ''}${navChangePercent.toFixed(2)}%)${marker}`);
  } else {
    const marker = record.date === '2025-11-06' ? ' ⚠️ TARGET DATE' : '';
    console.log(`  ${record.date}: $${record.nav_value.toFixed(2)}${marker}`);
  }
});

// Get deposits around this date
const getDeposits = db.prepare(`
  SELECT date, amount, fx_rate_to_base, description, transaction_id
  FROM Deposits
  WHERE account_id = ? AND date >= '2025-11-01' AND date <= '2025-11-15'
  ORDER BY date ASC
`);

const deposits = getDeposits.all(accountId);
console.log('\nDeposits around Nov 6, 2025:');
if (deposits.length > 0) {
  deposits.forEach(d => {
    const amountUSD = d.amount * d.fx_rate_to_base;
    const marker = d.date === '2025-11-06' ? ' ⚠️ ON TARGET DATE' : '';
    console.log(`  ${d.date}: +$${amountUSD.toFixed(2)} - ${d.description || 'N/A'}${marker}`);
  });
} else {
  console.log('  None');
}

// Get withdrawals around this date
const getWithdrawals = db.prepare(`
  SELECT date, amount, fx_rate_to_base, description, transaction_id
  FROM Withdrawals
  WHERE account_id = ? AND date >= '2025-11-01' AND date <= '2025-11-15'
  ORDER BY date ASC
`);

const withdrawals = getWithdrawals.all(accountId);
console.log('\nWithdrawals around Nov 6, 2025:');
if (withdrawals.length > 0) {
  withdrawals.forEach(w => {
    const amountUSD = w.amount * w.fx_rate_to_base;
    const marker = w.date === '2025-11-06' ? ' ⚠️ ON TARGET DATE' : '';
    console.log(`  ${w.date}: -$${amountUSD.toFixed(2)} - ${w.description || 'N/A'}${marker}`);
  });
} else {
  console.log('  None');
}

// Get internal transfers around this date
const getTransfers = db.prepare(`
  SELECT date, direction, amount, fx_rate_to_base, description, from_account, to_account, transaction_id
  FROM Transfers
  WHERE account_id = ? AND date >= '2025-11-01' AND date <= '2025-11-15'
  ORDER BY date ASC
`);

const transfers = getTransfers.all(accountId);
console.log('\nInternal Transfers around Nov 6, 2025:');
if (transfers.length > 0) {
  transfers.forEach(t => {
    const amountUSD = Math.abs(t.amount * t.fx_rate_to_base);
    const marker = t.date === '2025-11-06' ? ' ⚠️ ON TARGET DATE' : '';
    console.log(`  ${t.date}: ${t.direction} $${amountUSD.toFixed(2)} - ${t.description || 'N/A'}${marker}`);
  });
} else {
  console.log('  None');
}

// Detailed analysis for Nov 6
console.log('\n=== Detailed Analysis for November 6, 2025 ===');
const nov6Record = navRecords.find(r => r.date === '2025-11-06');
const nov5Record = navRecords.find(r => r.date === '2025-11-05');
const nov7Record = navRecords.find(r => r.date === '2025-11-07');

if (nov6Record && nov5Record) {
  const navChange = nov6Record.nav_value - nov5Record.nav_value;
  const navChangePercent = nov5Record.nav_value > 0 ? (navChange / nov5Record.nav_value) * 100 : 0;
  
  console.log(`\nNAV Change on Nov 6:`);
  console.log(`  Previous NAV (Nov 5): $${nov5Record.nav_value.toFixed(2)}`);
  console.log(`  Current NAV (Nov 6): $${nov6Record.nav_value.toFixed(2)}`);
  console.log(`  Change: ${navChange >= 0 ? '+' : ''}$${navChange.toFixed(2)} (${navChangePercent >= 0 ? '+' : ''}${navChangePercent.toFixed(2)}%)`);
  
  // Check for cash flows on Nov 6
  const depositOnNov6 = deposits.find(d => d.date === '2025-11-06');
  const withdrawalOnNov6 = withdrawals.find(w => w.date === '2025-11-06');
  const transferOnNov6 = transfers.find(t => t.date === '2025-11-06');
  
  let totalCashFlow = 0;
  if (depositOnNov6) {
    const amount = depositOnNov6.amount * depositOnNov6.fx_rate_to_base;
    totalCashFlow += amount;
    console.log(`  Deposit: +$${amount.toFixed(2)}`);
  }
  if (withdrawalOnNov6) {
    const amount = withdrawalOnNov6.amount * withdrawalOnNov6.fx_rate_to_base;
    totalCashFlow -= amount;
    console.log(`  Withdrawal: -$${amount.toFixed(2)}`);
  }
  if (transferOnNov6) {
    const amount = Math.abs(transferOnNov6.amount * transferOnNov6.fx_rate_to_base);
    console.log(`  Internal Transfer ${transferOnNov6.direction}: $${amount.toFixed(2)} (should be neutralized)`);
  }
  
  console.log(`  Total Cash Flow: ${totalCashFlow >= 0 ? '+' : ''}$${totalCashFlow.toFixed(2)}`);
  
  // Calculate expected market return
  if (Math.abs(totalCashFlow) > 1) {
    // Beginning of Day formula: Return = (EndingNAV) / (PreviousNAV + TodayCashFlow) - 1
    const bodReturn = (nov6Record.nav_value / (nov5Record.nav_value + totalCashFlow)) - 1;
    // End of Day formula: Return = (EndingNAV - TodayCashFlow) / PreviousNAV - 1
    const eodReturn = ((nov6Record.nav_value - totalCashFlow) / nov5Record.nav_value) - 1;
    
    console.log(`\nTWR Calculation (if cash flow neutralized):`);
    console.log(`  Beginning of Day formula: ${(bodReturn * 100).toFixed(2)}%`);
    console.log(`  End of Day formula: ${(eodReturn * 100).toFixed(2)}%`);
    console.log(`  Simple return (no cash flow adjustment): ${(navChangePercent).toFixed(2)}%`);
  } else {
    console.log(`\nTWR Calculation (no cash flow):`);
    console.log(`  Simple return: ${(navChangePercent).toFixed(2)}%`);
  }
  
  // Check adjacent days
  if (nov7Record) {
    const nextDayChange = nov7Record.nav_value - nov6Record.nav_value;
    const nextDayChangePercent = nov6Record.nav_value > 0 ? (nextDayChange / nov6Record.nav_value) * 100 : 0;
    console.log(`\nNext Day (Nov 7) NAV Change: ${nextDayChange >= 0 ? '+' : ''}$${nextDayChange.toFixed(2)} (${nextDayChangePercent >= 0 ? '+' : ''}${nextDayChangePercent.toFixed(2)}%)`);
    
    // Check if Nov 6 cash flow appears in Nov 7 NAV
    if (Math.abs(totalCashFlow) > 1000) {
      const navChangeMatchesCashFlow = Math.abs(Math.abs(nextDayChange) - Math.abs(totalCashFlow)) / Math.max(Math.abs(totalCashFlow), 1) < 0.15;
      if (navChangeMatchesCashFlow) {
        console.log(`  ⚠️ NAV change on Nov 7 (${Math.abs(nextDayChange).toFixed(2)}) closely matches Nov 6 cash flow (${Math.abs(totalCashFlow).toFixed(2)})`);
        console.log(`     This suggests the cash flow appears in NAV on Nov 7, not Nov 6!`);
      }
    }
  }
}

db.close();













