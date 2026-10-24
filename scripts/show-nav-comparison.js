const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');
const db = new Database(dbPath);

console.log('='.repeat(120));
console.log('SIDE MENU CARD: Live Data NAV vs Latest DB NAV per Portfolio');
console.log('='.repeat(120));
console.log('');

// Get all accounts
const getAllAccounts = db.prepare(`
  SELECT id, alias
  FROM Accounts
  WHERE id != 'HUNGARY_MIGRATION_HISTORY'
  ORDER BY alias
`);

const accounts = getAllAccounts.all();

console.log(`Found ${accounts.length} portfolio(s)\n`);

// Get latest NAV for each account
const getLatestNavByAccount = db.prepare(`
  SELECT date, nav_value
  FROM DailyNAV
  WHERE account_id = ?
  ORDER BY date DESC
  LIMIT 1
`);

// Get Jan 1 2026 NAV for each account (or closest date before/on Jan 1)
const getJan1Nav = db.prepare(`
  SELECT date, nav_value
  FROM DailyNAV
  WHERE account_id = ?
    AND date <= '2026-01-01'
  ORDER BY date DESC
  LIMIT 1
`);

// Get holdings for each account (latest holdings, no date column)
const getHoldings = db.prepare(`
  SELECT symbol, description, position, mark_price, position_value, cost_basis_money,
         currency, fx_rate_to_base
  FROM Holdings h1
  WHERE account_id = ?
    AND NOT EXISTS (
      SELECT 1 FROM Holdings h2
      WHERE h2.account_id = h1.account_id
        AND h2.symbol = h1.symbol
        AND h2.id > h1.id
    )
`);

// Get cash for each account
const getCash = db.prepare(`
  SELECT amount, currency, fx_rate_to_base, report_date
  FROM Cash
  WHERE account_id = ?
    AND report_date = (
      SELECT MAX(report_date)
      FROM Cash
      WHERE account_id = ?
    )
  LIMIT 1
`);

// Get live prices (for reference - we'll need to fetch from API or use cached values)
const getLivePrices = db.prepare(`
  SELECT symbol, price, previous_close, updated_at
  FROM live_prices
  ORDER BY updated_at DESC
`);

const livePrices = getLivePrices.all();
const priceMap = new Map();
livePrices.forEach(p => {
  // Use most recent price for each symbol
  if (!priceMap.has(p.symbol.toUpperCase())) {
    priceMap.set(p.symbol.toUpperCase(), {
      price: p.price,
      previousClose: p.previous_close,
      updatedAt: p.updated_at
    });
  }
});

console.log(`Live prices available: ${priceMap.size} symbols\n`);

// Process each account and collect summary data
const summaryData = [];

for (const account of accounts) {
  console.log('-'.repeat(120));
  console.log(`Portfolio: ${account.alias} (${account.id})`);
  console.log('-'.repeat(120));
  
  // Get latest NAV from database
  const latestNavRecord = getLatestNavByAccount.get(account.id);
  
  if (!latestNavRecord) {
    console.log('  ⚠️  No NAV records found in database\n');
    continue;
  }
  
  const latestDbNav = latestNavRecord.nav_value;
  const latestDbNavDate = latestNavRecord.date;
  
  // Get Jan 1 2026 NAV (or closest date before/on Jan 1)
  const jan1NavRecord = getJan1Nav.get(account.id);
  let jan1Nav = null;
  let jan1NavDate = null;
  
  if (jan1NavRecord) {
    jan1Nav = jan1NavRecord.nav_value;
    jan1NavDate = jan1NavRecord.date;
  } else {
    // If no Jan 1 record, try to find the first record of 2026
    const getFirst2026Nav = db.prepare(`
      SELECT date, nav_value
      FROM DailyNAV
      WHERE account_id = ?
        AND date >= '2026-01-01'
        AND date < '2026-01-10'
      ORDER BY date ASC
      LIMIT 1
    `);
    const first2026NavRecord = getFirst2026Nav.get(account.id);
    if (first2026NavRecord) {
      jan1Nav = first2026NavRecord.nav_value;
      jan1NavDate = first2026NavRecord.date;
    }
  }
  
  console.log(`\n  📊 Latest DB NAV:`);
  console.log(`     Date: ${latestDbNavDate}`);
  console.log(`     NAV:  $${latestDbNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  
  if (jan1Nav !== null && jan1NavDate) {
    console.log(`\n  📅 Jan 1 2026 NAV (or closest):`);
    console.log(`     Date: ${jan1NavDate}`);
    console.log(`     NAV:  $${jan1Nav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  } else {
    console.log(`\n  📅 Jan 1 2026 NAV: Not found (portfolio may have started after Jan 1)`);
  }
  
  // Get holdings
  const holdings = getHoldings.all(account.id);
  
  // Get cash
  const cashRecord = getCash.get(account.id, account.id);
  let accountCash = 0;
  if (cashRecord) {
    accountCash = cashRecord.amount * cashRecord.fx_rate_to_base;
    console.log(`\n  💵 Cash:`);
    console.log(`     Amount: ${cashRecord.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cashRecord.currency}`);
    console.log(`     Base Currency: $${accountCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }
  
  console.log(`\n  📈 Holdings (for Live Data NAV calculation):`);
  
  // Symbol mapping function (matches lib/symbol-mapper.ts)
  function mapSymbolForYahoo(symbol) {
    const symbolMap = {
      'EQQQ': 'EQQQ.SW',
      'EQQU': 'EQQQ.SW', // EQQU maps to the same as EQQQ
      'IUIT': 'IUIT.L',
      'VUSD': 'VUSD.L',
      'SMH': 'SMH.L'
    };
    return symbolMap[symbol.toUpperCase()] || symbol.toUpperCase();
  }
  
  // First pass: Deduplicate holdings by mapped symbol
  // Group holdings that map to the same Yahoo symbol (e.g., EQQQ and EQQU both map to EQQQ.SW)
  const holdingsByMappedSymbol = new Map();
  
  for (const holding of holdings) {
    const symbol = holding.symbol?.toUpperCase();
    
    // Skip cash (handled separately)
    if (symbol === 'CASH' || symbol === 'USD') {
      continue;
    }
    
    if (!symbol || !holding.position) {
      continue;
    }
    
    const mappedSymbol = mapSymbolForYahoo(symbol);
    
    if (!holdingsByMappedSymbol.has(mappedSymbol)) {
      holdingsByMappedSymbol.set(mappedSymbol, []);
    }
    
    holdingsByMappedSymbol.get(mappedSymbol).push({
      originalSymbol: symbol,
      mappedSymbol: mappedSymbol,
      quantity: holding.position,
      position_value: holding.position_value,
      description: holding.description
    });
  }
  
  // Second pass: Merge duplicates (same mapped symbol) and calculate values
  let totalPositionValue = 0;
  let positionBreakdown = [];
  
  for (const [mappedSymbol, duplicateHoldings] of holdingsByMappedSymbol.entries()) {
    // If multiple holdings map to same symbol, they're duplicates (e.g., EQQQ + EQQU)
    if (duplicateHoldings.length > 1) {
      // Check if they have the same quantity (definitely duplicates)
      const allSameQuantity = duplicateHoldings.every((h, i, arr) => 
        i === 0 || Math.abs(h.quantity - arr[0].quantity) < 0.1
      );
      
      if (allSameQuantity) {
        // Deduplicate: use max position value (they represent the same holding)
        const maxValue = Math.max(...duplicateHoldings.map(h => h.position_value || 0));
        const quantity = duplicateHoldings[0].quantity; // All have same quantity
        const originalSymbols = duplicateHoldings.map(h => h.originalSymbol).join('/');
        
        console.log(`     [DEDUPLICATED] ${originalSymbols} → ${mappedSymbol} (qty: ${quantity}, duplicates merged)`);
        
        // Try to find live price for mapped symbol
        const priceData = priceMap.get(mappedSymbol);
        
        if (priceData) {
          const positionValue = priceData.price * quantity;
          totalPositionValue += positionValue;
          
          positionBreakdown.push({
            symbol: `${originalSymbols} → ${mappedSymbol}`,
            quantity: quantity,
            livePrice: priceData.price,
            positionValue: positionValue,
            isDeduplicated: true
          });
        } else {
          // Fallback to position_value
          totalPositionValue += maxValue;
          positionBreakdown.push({
            symbol: `${originalSymbols} → ${mappedSymbol}`,
            quantity: quantity,
            livePrice: 'N/A',
            positionValue: maxValue,
            isDeduplicated: true
          });
        }
        continue; // Skip individual processing
      }
    }
    
    // Single holding or different quantities - process normally
    const holding = duplicateHoldings[0];
    const priceData = priceMap.get(mappedSymbol);
    
    if (priceData) {
      const positionValue = priceData.price * holding.quantity;
      totalPositionValue += positionValue;
      
      positionBreakdown.push({
        symbol: holding.originalSymbol === mappedSymbol ? holding.originalSymbol : `${holding.originalSymbol} → ${mappedSymbol}`,
        quantity: holding.quantity,
        livePrice: priceData.price,
        positionValue: positionValue,
        isDeduplicated: false
      });
    } else {
      // Fallback to position_value
      totalPositionValue += holding.position_value || 0;
      positionBreakdown.push({
        symbol: holding.originalSymbol === mappedSymbol ? holding.originalSymbol : `${holding.originalSymbol} → ${mappedSymbol}`,
        quantity: holding.quantity,
        livePrice: 'N/A',
        positionValue: holding.position_value || 0,
        isDeduplicated: false
      });
    }
  }
  
  // Display holdings breakdown
  positionBreakdown.forEach(pos => {
    const symbolDisplay = pos.symbol.padEnd(25);
    if (pos.livePrice !== 'N/A') {
      console.log(`     ${symbolDisplay}: ${pos.quantity.toString().padStart(10)} × $${pos.livePrice.toFixed(2).padStart(10)} = $${pos.positionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15)}`);
    } else {
      console.log(`     ${symbolDisplay}: ${pos.quantity.toString().padStart(10)} × [No live price] = $${pos.positionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15)}`);
    }
  });
  
  // Calculate Live Data NAV
  const liveDataNav = totalPositionValue + accountCash;
  
  console.log(`\n  ✅ CALCULATION:`);
  console.log(`     Total Position Value:  $${totalPositionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`     + Cash:                $${accountCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`     ──────────────────────────────────────────────`);
  console.log(`     Live Data NAV:         $${liveDataNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`     Latest DB NAV:         $${latestDbNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`     ──────────────────────────────────────────────`);
  
  // Calculate difference
  const navDifference = liveDataNav - latestDbNav;
  const navDifferencePercent = latestDbNav > 0 ? (navDifference / latestDbNav) * 100 : 0;
  
  console.log(`     Difference:            $${navDifference.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15)} (${navDifferencePercent >= 0 ? '+' : ''}${navDifferencePercent.toFixed(4)}%)`);
  
  console.log(`\n  📝 Today Performance (Side Menu Card):`);
  console.log(`     Formula: (Live Data NAV - Latest DB NAV) / Latest DB NAV × 100`);
  console.log(`     = ($${liveDataNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - $${latestDbNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) / $${latestDbNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × 100`);
  console.log(`     = $${navDifference.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / $${latestDbNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × 100`);
  console.log(`     = ${navDifferencePercent >= 0 ? '+' : ''}${navDifferencePercent.toFixed(2)}%`);
  
  // Calculate YTD if we have Jan 1 NAV
  let ytdReturn = null;
  let ytdValue = null;
  if (jan1Nav !== null && jan1Nav > 0 && latestDbNav > 0) {
    ytdValue = latestDbNav - jan1Nav;
    ytdReturn = (ytdValue / jan1Nav) * 100;
    
    console.log(`\n  📈 YTD Performance (Side Menu Card):`);
    console.log(`     Formula: (Current NAV - Jan 1 NAV) / Jan 1 NAV × 100`);
    console.log(`     = ($${latestDbNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - $${jan1Nav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) / $${jan1Nav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × 100`);
    console.log(`     = $${ytdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / $${jan1Nav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × 100`);
    console.log(`     = ${ytdReturn >= 0 ? '+' : ''}${ytdReturn.toFixed(2)}%`);
  } else {
    console.log(`\n  📈 YTD Performance: Cannot calculate (Jan 1 NAV not available)`);
  }
  
  // Store summary data
  summaryData.push({
    portfolio: account.alias,
    accountId: account.id,
    latestDbNav: latestDbNav,
    latestDbNavDate: latestDbNavDate,
    liveDataNav: liveDataNav,
    todayPercent: navDifferencePercent,
    jan1Nav: jan1Nav,
    jan1NavDate: jan1NavDate,
    ytdPercent: ytdReturn
  });
  
  console.log('');
}

console.log('='.repeat(120));
console.log('SUMMARY TABLE');
console.log('='.repeat(120));
console.log('');

// Print table header
const header = [
  'Portfolio',
  'Latest DB NAV',
  'Live Data NAV',
  'Jan 1 2026 NAV',
  'YTD %',
  'Today %'
];
console.log(header.map(h => h.padEnd(20)).join(' | '));
console.log('-'.repeat(120));

// Print table rows
for (const row of summaryData) {
  const portfolioName = row.portfolio.length > 18 ? row.portfolio.substring(0, 18) : row.portfolio;
  const latestNav = `$${row.latestDbNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const liveNav = `$${row.liveDataNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const jan1NavStr = row.jan1Nav !== null 
    ? `$${row.jan1Nav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'N/A';
  const ytdStr = row.ytdPercent !== null 
    ? `${row.ytdPercent >= 0 ? '+' : ''}${row.ytdPercent.toFixed(2)}%`
    : 'N/A';
  const todayStr = `${row.todayPercent >= 0 ? '+' : ''}${row.todayPercent.toFixed(2)}%`;
  
  const rowData = [
    portfolioName,
    latestNav,
    liveNav,
    jan1NavStr,
    ytdStr,
    todayStr
  ];
  console.log(rowData.map(d => d.padEnd(20)).join(' | '));
}

console.log('');
console.log('='.repeat(120));
console.log('NOTES:');
console.log('  • Live Data NAV = Current live prices × quantities + cash');
console.log('  • Latest DB NAV = Most recent NAV from DailyNAV table (last sync from IBKR)');
console.log('  • Jan 1 2026 NAV = NAV on or closest to January 1, 2026');
console.log('  • YTD % = (Latest DB NAV - Jan 1 NAV) / Jan 1 NAV × 100');
console.log('  • Today % = (Live Data NAV - Latest DB NAV) / Latest DB NAV × 100');
console.log('='.repeat(120));

db.close();

