/**
 * Database-backed aggregator that reads from SQLite instead of XML files
 * This eliminates hardcoding and ensures all data comes from synced database records
 */
import { getDatabase, navQueries, accountQueries, transactionQueries, transferQueries, depositQueries, withdrawalQueries, dividendQueries, interestQueries, feeQueries, taxQueries, holdingQueries, changeInNAVQueries, cashQueries } from './database';
import { deduplicateWithdrawals } from './transaction-categorizer';
import { startOfDay, parseISO, eachDayOfInterval, format } from 'date-fns';
import type {
  ProcessedAccount,
  AggregatedData,
  CombinedPosition,
  EquityCurvePoint,
  FeesAndIncome,
  ProcessedChangeInNAV,
  ProcessedCashTransaction,
  ProcessedTransfer,
} from './types';
import { formatCurrency } from './utils';
import { calculateDailyReturn, calculateDailyReturnModifiedDietz, detectCashFlowLag } from './calculations';

const CSV_VIRTUAL_ACCOUNT_ID = "HUNGARY_MIGRATION_HISTORY";
const XML_ACCOUNT_ID = "U16030763";

/**
 * Normalize description for comparison (remove extra spaces, convert to uppercase)
 */
function normalizeDescription(description: string): string {
  return description.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Normalize symbol - EQQU and EQQQ are the same ticker
 */
function normalizeSymbol(symbol: string | null | undefined): string {
  if (!symbol) return '';
  const normalized = symbol.toUpperCase().trim();
  // EQQU and EQQQ are the same ETF
  if (normalized === 'EQQU') return 'EQQQ';
  // SMH.L (London-listed) and SMH (US-listed) are the same VanEck Semiconductor ETF
  if (normalized === 'SMH.L') return 'SMH';
  return normalized;
}

/**
 * Deduplicate dividends by transaction_id (if available) or by normalized symbol + amount + date
 * Note: EQQU and EQQQ are treated as the same symbol
 */
function deduplicateDividends(dividends: Array<{
  amount: number;
  date: string;
  description: string | null;
  symbol: string | null;
  currency: string;
  fx_rate_to_base: number;
  transaction_id: string | null;
}>, accountId: string): typeof dividends {
  const seenDividends = new Map<string, typeof dividends[0]>();
  
  for (const dividend of dividends) {
    const normalizedSymbol = normalizeSymbol(dividend.symbol);
    const amountUSD = dividend.amount * dividend.fx_rate_to_base;
    
    // Create deduplication key: transaction_id (if available) or normalized symbol + amount + date
    const dedupKey = dividend.transaction_id 
      ? `${accountId}_${dividend.transaction_id}`
      : `${accountId}_${normalizedSymbol}_${amountUSD.toFixed(2)}_${dividend.date}`;
    
    // Keep the first occurrence (or the one with transaction_id if available)
    if (!seenDividends.has(dedupKey) || (!seenDividends.get(dedupKey)?.transaction_id && dividend.transaction_id)) {
      seenDividends.set(dedupKey, dividend);
    }
  }
  
  const uniqueDividends = Array.from(seenDividends.values());
  if (uniqueDividends.length < dividends.length) {
    console.log(`[DB-AGGREGATOR] [FEES & INCOME] Deduplicated ${dividends.length} dividends to ${uniqueDividends.length} for account ${accountId} (removed ${dividends.length - uniqueDividends.length} duplicates)`);
  }
  
  return uniqueDividends;
}

/**
 * Deduplicate interest by transaction_id (if available) or by amount + date
 */
function deduplicateInterest(interest: Array<{
  amount: number;
  date: string;
  description: string | null;
  currency: string;
  fx_rate_to_base: number;
  transaction_id: string | null;
}>, accountId: string): typeof interest {
  const seenInterest = new Map<string, typeof interest[0]>();
  
  for (const int of interest) {
    const amountUSD = int.amount * int.fx_rate_to_base;
    const dedupKey = int.transaction_id 
      ? `${accountId}_${int.transaction_id}`
      : `${accountId}_${amountUSD.toFixed(2)}_${int.date}`;
    
    if (!seenInterest.has(dedupKey) || (!seenInterest.get(dedupKey)?.transaction_id && int.transaction_id)) {
      seenInterest.set(dedupKey, int);
    }
  }
  
  const uniqueInterest = Array.from(seenInterest.values());
  if (uniqueInterest.length < interest.length) {
    console.log(`[DB-AGGREGATOR] [FEES & INCOME] Deduplicated ${interest.length} interest records to ${uniqueInterest.length} for account ${accountId} (removed ${interest.length - uniqueInterest.length} duplicates)`);
  }
  
  return uniqueInterest;
}

/**
 * Deduplicate fees by transaction_id (if available) or by amount + date + fee_type
 */
function deduplicateFees(fees: Array<{
  amount: number;
  date: string;
  description: string | null;
  fee_type: string | null;
  currency: string;
  fx_rate_to_base: number;
  transaction_id: string | null;
}>, accountId: string): typeof fees {
  const seenFees = new Map<string, typeof fees[0]>();
  
  for (const fee of fees) {
    const amountUSD = fee.amount * fee.fx_rate_to_base;
    const dedupKey = fee.transaction_id 
      ? `${accountId}_${fee.transaction_id}`
      : `${accountId}_${fee.fee_type || 'fee'}_${amountUSD.toFixed(2)}_${fee.date}`;
    
    if (!seenFees.has(dedupKey) || (!seenFees.get(dedupKey)?.transaction_id && fee.transaction_id)) {
      seenFees.set(dedupKey, fee);
    }
  }
  
  const uniqueFees = Array.from(seenFees.values());
  if (uniqueFees.length < fees.length) {
    console.log(`[DB-AGGREGATOR] [FEES & INCOME] Deduplicated ${fees.length} fees to ${uniqueFees.length} for account ${accountId} (removed ${fees.length - uniqueFees.length} duplicates)`);
  }
  
  return uniqueFees;
}

/**
 * Deduplicate taxes by transaction_id (if available) or by amount + date + tax_type
 */
function deduplicateTaxes(taxes: Array<{
  amount: number;
  date: string;
  description: string | null;
  tax_type: string | null;
  currency: string;
  fx_rate_to_base: number;
  transaction_id: string | null;
}>, accountId: string): typeof taxes {
  const seenTaxes = new Map<string, typeof taxes[0]>();
  
  for (const tax of taxes) {
    const amountUSD = tax.amount * tax.fx_rate_to_base;
    const dedupKey = tax.transaction_id 
      ? `${accountId}_${tax.transaction_id}`
      : `${accountId}_${tax.tax_type || 'tax'}_${amountUSD.toFixed(2)}_${tax.date}`;
    
    if (!seenTaxes.has(dedupKey) || (!seenTaxes.get(dedupKey)?.transaction_id && tax.transaction_id)) {
      seenTaxes.set(dedupKey, tax);
    }
  }
  
  const uniqueTaxes = Array.from(seenTaxes.values());
  if (uniqueTaxes.length < taxes.length) {
    console.log(`[DB-AGGREGATOR] [FEES & INCOME] Deduplicated ${taxes.length} taxes to ${uniqueTaxes.length} for account ${accountId} (removed ${taxes.length - uniqueTaxes.length} duplicates)`);
  }
  
  return uniqueTaxes;
}

/**
 * Deduplicate holdings that have the same description but different symbols
 * This handles cases like EQQQ vs EQQU (same ETF, different symbols)
 */
function deduplicateHoldingsByDescription(positions: CombinedPosition[]): CombinedPosition[] {
  // Group positions by normalized description
  const descriptionMap = new Map<string, CombinedPosition[]>();
  
  for (const position of positions) {
    // Skip cash positions
    if (position.isCash) {
      continue;
    }
    
    const normalizedDesc = normalizeDescription(position.description || position.symbol);
    if (!descriptionMap.has(normalizedDesc)) {
      descriptionMap.set(normalizedDesc, []);
    }
    descriptionMap.get(normalizedDesc)!.push(position);
  }
  
  const deduplicated: CombinedPosition[] = [];
  const mergedSymbols = new Set<string>();
  
  for (const [normalizedDesc, duplicates] of descriptionMap.entries()) {
    if (duplicates.length === 1) {
      // No duplicates, keep as is
      deduplicated.push(duplicates[0]);
    } else {
      // Multiple positions with same description - merge them
      // Check if they're likely the same holding (same position quantity AND same accounts)
      const shouldMerge = duplicates.every((pos, i, arr) => {
        if (i === 0) return true;
        const first = arr[0];
        
        // Check if positions are from the same account(s)
        const firstAccountIds = new Set(first.accounts.map(a => a.accountId).sort());
        const posAccountIds = new Set(pos.accounts.map(a => a.accountId).sort());
        
        // Check if account sets are exactly the same
        const sameAccounts = firstAccountIds.size === posAccountIds.size &&
          Array.from(firstAccountIds).every(id => posAccountIds.has(id));
        
        // Check if position quantities are EXACTLY the same (or very close - within 0.1 units)
        const positionDiff = Math.abs(first.totalPosition - pos.totalPosition);
        const exactPositions = positionDiff < 0.1;
        
        return sameAccounts && exactPositions;
      });
      
      if (shouldMerge) {
        // Merge all duplicates into one position
        // Use the symbol with highest value or first alphabetically
        duplicates.sort((a, b) => {
          if (Math.abs(b.totalValue - a.totalValue) > 1) {
            return b.totalValue - a.totalValue; // Prefer higher value
          }
          return a.symbol.localeCompare(b.symbol); // Then alphabetically
        });
        
        const primary = duplicates[0];
        // For duplicates, use the maximum values (they represent the same holding with different symbols)
        // Don't sum them - they're the same position just reported differently
        const merged: CombinedPosition = {
          symbol: primary.symbol,
          description: primary.description,
          totalPosition: Math.max(...duplicates.map(p => p.totalPosition)),
          totalValue: Math.max(...duplicates.map(p => p.totalValue)),
          totalCostBasis: Math.max(...duplicates.map(p => p.totalCostBasis)),
          totalUnrealizedPnl: Math.max(...duplicates.map(p => p.totalUnrealizedPnl)),
          totalPercentOfNAV: Math.max(...duplicates.map(p => p.totalPercentOfNAV)),
          accounts: primary.accounts, // Keep accounts from primary (should be the same across duplicates)
          isCash: false,
        };
        
        deduplicated.push(merged);
        
        // Track merged symbols
        duplicates.forEach(p => {
          if (p.symbol !== primary.symbol) {
            mergedSymbols.add(p.symbol);
          }
        });
        
        console.log(`[DB-AGGREGATOR] Merged duplicate holdings: ${duplicates.map(p => p.symbol).join(', ')} -> ${primary.symbol} (${normalizedDesc})`);
      } else {
        // Don't merge - they're likely different holdings with similar descriptions
        deduplicated.push(...duplicates);
      }
    }
  }
  
  // Add cash positions back
  const cashPositions = positions.filter(p => p.isCash);
  deduplicated.push(...cashPositions);
  
  // Re-sort by value
  return deduplicated.sort((a, b) => {
    if (a.isCash && !b.isCash) return 1;
    if (!a.isCash && b.isCash) return -1;
    return b.totalValue - a.totalValue;
  });
}

/**
 * Combine positions across all accounts, grouping by symbol
 */
export async function combinePositionsFromDB(accounts: ProcessedAccount[]): Promise<CombinedPosition[]> {
  const positionMap = new Map<string, CombinedPosition>();
  
  // Track positions per account to avoid duplicates
  const accountPositionMap = new Map<string, Set<string>>();
  
  // Calculate total NAV for percentage calculations
  const totalNAV = accounts.reduce(
    (sum, acc) => sum + acc.changeInNAV.endingValue * acc.changeInNAV.fxRateToBase,
    0
  );

  for (const account of accounts) {
    // Initialize account tracking if not exists
    if (!accountPositionMap.has(account.accountId)) {
      accountPositionMap.set(account.accountId, new Set());
    }
    const accountPositions = accountPositionMap.get(account.accountId)!;

    for (const position of account.openPositions) {
      const symbol = position.symbol;
      
      // Skip if we've already processed this account+symbol combination
      if (accountPositions.has(symbol)) {
        console.warn(`[DB-AGGREGATOR] Duplicate position detected: ${account.accountId} - ${symbol}. Keeping first occurrence.`);
        continue;
      }
      accountPositions.add(symbol);

      const valueUSD = position.positionValue * position.fxRateToBase;
      const costBasisUSD = position.costBasisMoney * position.fxRateToBase;
      const unrealizedPnlUSD = position.fifoPnlUnrealized * position.fxRateToBase;

      if (!positionMap.has(symbol)) {
        positionMap.set(symbol, {
          symbol,
          description: position.description,
          totalPosition: 0,
          totalValue: 0,
          totalCostBasis: 0,
          totalUnrealizedPnl: 0,
          totalPercentOfNAV: 0,
          accounts: [],
        });
      }

      const combined = positionMap.get(symbol)!;
      combined.totalPosition += position.position;
      combined.totalValue += valueUSD;
      combined.totalCostBasis += costBasisUSD;
      combined.totalUnrealizedPnl += unrealizedPnlUSD;

      // Check if this account already exists in the accounts array for this symbol
      const existingAccountIndex = combined.accounts.findIndex(
        (a) => a.accountId === account.accountId
      );
      
      if (existingAccountIndex >= 0) {
        // Update existing account entry
        const existing = combined.accounts[existingAccountIndex];
        existing.position += position.position;
        existing.value += valueUSD;
        existing.costBasis += costBasisUSD;
        existing.unrealizedPnl += unrealizedPnlUSD;
      } else {
        // Add new account entry
        combined.accounts.push({
          accountId: account.accountId,
          accountAlias: account.accountAlias,
          position: position.position,
          value: valueUSD,
          costBasis: costBasisUSD,
          unrealizedPnl: unrealizedPnlUSD,
          percentOfNAV: position.percentOfNAV,
        });
      }
    }
  }

  // Calculate totalPercentOfNAV for each combined position
  for (const combined of positionMap.values()) {
    combined.totalPercentOfNAV = totalNAV > 0 ? (combined.totalValue / totalNAV) * 100 : 0;
  }

  let combinedPositions = Array.from(positionMap.values()).sort(
    (a, b) => b.totalValue - a.totalValue
  );

  // Deduplicate holdings with same description but different symbols
  // This handles cases like EQQQ vs EQQU (same ETF, different symbols)
  combinedPositions = deduplicateHoldingsByDescription(combinedPositions);

  // Load cash from database instead of calculating
  const cashByAccount = new Map<string, { cashUSD: number; accountAlias: string }>();
  
  for (const account of accounts) {
    // CRITICAL: Exclude CSV virtual account from cash calculation
    // CSV account is only for NAV history, not for current cash positions
    if (account.accountId === CSV_VIRTUAL_ACCOUNT_ID) {
      console.log(`[DB-AGGREGATOR] Skipping CSV account from cash calculation (CSV is for NAV history only)`);
      continue; // Skip CSV account - don't include its cash
    }
    
    const cashRecord = await cashQueries.getLatestByAccount(account.accountId) as {
      amount: number;
      currency: string;
      fx_rate_to_base: number;
      report_date: string;
    } | undefined;
    
    if (cashRecord) {
      const cashUSD = cashRecord.amount * cashRecord.fx_rate_to_base;
      if (Math.abs(cashUSD) > 0.01) { // Include if cash > $0.01 (positive or negative)
        cashByAccount.set(account.accountId, {
          cashUSD,
          accountAlias: account.accountAlias,
        });
        console.log(`[DB-AGGREGATOR] Loaded cash for ${account.accountId}: ${formatCurrency(cashUSD)} (as of ${cashRecord.report_date})`);
      }
    } else {
      // Fallback: calculate cash if not in database
      const accountNAV = account.changeInNAV.endingValue * account.changeInNAV.fxRateToBase;
      const accountPositionValue = account.openPositions.reduce(
        (sum, pos) => sum + (pos.positionValue * pos.fxRateToBase),
        0
      );
      const cashUSD = accountNAV - accountPositionValue;
      
      if (Math.abs(cashUSD) > 0.01) {
        cashByAccount.set(account.accountId, {
          cashUSD,
          accountAlias: account.accountAlias,
        });
        console.log(`[DB-AGGREGATOR] ⚠️ Calculated cash for ${account.accountId}: ${formatCurrency(cashUSD)} (cash not found in database)`);
      }
    }
  }

  if (cashByAccount.size > 0) {
    const totalCash = Array.from(cashByAccount.values()).reduce(
      (sum, c) => sum + c.cashUSD,
      0
    );

    const cashPosition: CombinedPosition = {
      symbol: "CASH",
      description: "Cash & Cash Equivalents",
      totalPosition: totalCash,
      totalValue: totalCash,
      totalCostBasis: totalCash,
      totalUnrealizedPnl: 0,
      totalPercentOfNAV: totalNAV > 0 ? (totalCash / totalNAV) * 100 : 0,
      accounts: Array.from(cashByAccount.entries()).map(([accountId, cash]) => ({
        accountId,
        accountAlias: cash.accountAlias,
        position: cash.cashUSD,
        value: cash.cashUSD,
        costBasis: cash.cashUSD,
        unrealizedPnl: 0,
        percentOfNAV: totalNAV > 0 ? (cash.cashUSD / totalNAV) * 100 : 0,
      })),
      isCash: true,
    };

    // Add cash at the end of positions
    combinedPositions = [...combinedPositions, cashPosition];
  }

  return combinedPositions;
}

/**
 * Get aggregated equity curve from database with proper migration handover logic
 */
export async function buildEquityCurveFromDB(
  selectedAccountIds: Set<string> | null = null
): Promise<EquityCurvePoint[]> {
  
  // Get earliest date from database
  const earliestDate = await navQueries.getEarliestDate();
  
  if (!earliestDate) {
    console.log('[DB-AGGREGATOR] No NAV data found in database');
    return [];
  }
  
  // Get all accounts
  const accounts = await accountQueries.getAll() as Array<{ id: string; alias: string; currency: string }>;
  
  // Filter accounts if selection is provided
  // IMPORTANT: Auto-include CSV virtual account if U16030763 is selected
  let accountsToProcess = accounts;
  if (selectedAccountIds && selectedAccountIds.size > 0) {
    const filtered = accounts.filter(acc => selectedAccountIds.has(acc.id));
    
    // Auto-include CSV virtual account if U16030763 is selected
    // This ensures CSV history is included without showing it in the sidebar
    // For multiple portfolios, CSV is included for NAV history continuity but excluded from net contributions
    if (selectedAccountIds.has(XML_ACCOUNT_ID)) {
      const csvAccount = accounts.find(acc => acc.id === CSV_VIRTUAL_ACCOUNT_ID);
      if (csvAccount && !filtered.find(acc => acc.id === CSV_VIRTUAL_ACCOUNT_ID)) {
        filtered.push(csvAccount);
        const isMultiplePortfolios = selectedAccountIds.size > 1;
        console.log(`[DB-AGGREGATOR] [EQUITY CURVE] Auto-including CSV account (${CSV_VIRTUAL_ACCOUNT_ID}) because U16030763 is selected${isMultiplePortfolios ? ' (MULTIPLE PORTFOLIO MODE - CSV only for NAV history)' : ' (SINGLE PORTFOLIO MODE)'}`);
      }
    }
    
    console.log(`[DB-AGGREGATOR] [EQUITY CURVE] Processing ${filtered.length} account(s): [${filtered.map(a => a.id).join(', ')}]`);
    accountsToProcess = filtered;
  } else {
    // If no selection (All), exclude CSV virtual account to prevent double-counting
    accountsToProcess = accounts.filter(acc => acc.id !== CSV_VIRTUAL_ACCOUNT_ID);
  }
  
  if (accountsToProcess.length === 0) {
    return [];
  }
  
  // Get date range from selected accounts only (not all accounts)
  // This optimizes performance for individual portfolio views
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  
  // For single-account views, find the first non-zero NAV date instead of earliest date
  // This prevents charts from starting with hundreds of zero NAV records
  const isSingleAccount = accountsToProcess.length === 1;
  
  for (const account of accountsToProcess) {
    const navRecords = await navQueries.getByAccount(account.id) as Array<{ date: string; nav_value: number }>;
    if (navRecords.length > 0) {
      if (isSingleAccount) {
        // For single account: find first non-zero NAV date
        const firstNonZeroRecord = navRecords.find(r => r.nav_value > 1);
        if (firstNonZeroRecord) {
          const firstNonZeroDate = parseISO(firstNonZeroRecord.date);
          const lastDate = parseISO(navRecords[navRecords.length - 1].date);
          if (!minDate || firstNonZeroDate < minDate) {
            minDate = firstNonZeroDate;
          }
          if (!maxDate || lastDate > maxDate) {
            maxDate = lastDate;
          }
          console.log(`[DB-AGGREGATOR] Account ${account.id}: First non-zero NAV date: ${firstNonZeroRecord.date} (NAV: $${firstNonZeroRecord.nav_value.toFixed(2)})`);
        } else {
          // No non-zero NAV found, fall back to first date
          const firstDate = parseISO(navRecords[0].date);
          const lastDate = parseISO(navRecords[navRecords.length - 1].date);
          if (!minDate || firstDate < minDate) {
            minDate = firstDate;
          }
          if (!maxDate || lastDate > maxDate) {
            maxDate = lastDate;
          }
        }
      } else {
        // For multiple accounts: use earliest date (multi-account logic)
        const firstDate = parseISO(navRecords[0].date);
        const lastDate = parseISO(navRecords[navRecords.length - 1].date);
        if (!minDate || firstDate < minDate) {
          minDate = firstDate;
        }
        if (!maxDate || lastDate > maxDate) {
          maxDate = lastDate;
        }
      }
    }
  }
  
  if (!minDate || !maxDate) {
    return [];
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = maxDate > today ? today : maxDate;
  
  console.log(`[DB-AGGREGATOR] Building equity curve from ${format(minDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')} ${isSingleAccount ? '(single account - starting from first non-zero NAV)' : '(multiple accounts)'}`);
  
  // Build date range from selected accounts' date range
  const allDates = eachDayOfInterval({ start: minDate, end: endDate });
  
  // Get NAV records for all selected accounts
  const accountNAVMaps = new Map<string, Map<string, number>>();
  const accountLastDates = new Map<string, Date>();
  
  for (const account of accountsToProcess) {
    const navRecords = await navQueries.getByAccount(account.id) as Array<{ date: string; nav_value: number }>;
    const navMap = new Map<string, number>();
    
    let lastDate: Date | null = null;
    for (const record of navRecords) {
      navMap.set(record.date, record.nav_value);
      const recordDate = parseISO(record.date);
      if (!lastDate || recordDate > lastDate) {
        lastDate = recordDate;
      }
    }
    
    accountNAVMaps.set(account.id, navMap);
    if (lastDate) {
      accountLastDates.set(account.id, lastDate);
    }
  }
  
  // Build aggregated equity curve
  const equityCurve: EquityCurvePoint[] = [];
  const lastKnownNAV = new Map<string, number>();
  
  // Track CSV account end date for migration handover
  const csvLastDate = accountLastDates.get(CSV_VIRTUAL_ACCOUNT_ID);
  
  for (const date of allDates) {
    const dateKey = format(date, 'yyyy-MM-dd');
    let aggregatedNAV = 0;
    const accountBreakdown: { [accountId: string]: number } = {};
    
    // Detect migration handover: CSV account ending, XML account starting
    // CRITICAL: On Aug 20-26, if both CSV and XML have data, use ONLY XML to prevent double-counting
    let isMigrationHandoverDay = false;
    let shouldExcludeCSV = false;
    
    // Check if we're in the migration period (Aug 21-26, 2024)
    // Aug 20 is CSV-only (CSV ends on Aug 20)
    const aug20Key = "2024-08-20";
    const aug21Key = "2024-08-21";
    const aug26Key = "2024-08-26";
    const isAug20 = dateKey === aug20Key;
    const isInMigrationPeriod = dateKey >= aug21Key && dateKey <= aug26Key;
    
    if (csvLastDate && (isInMigrationPeriod || csvLastDate)) {
      const prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateKey = format(prevDate, 'yyyy-MM-dd');
      
      const prevCSVNav = accountNAVMaps.get(CSV_VIRTUAL_ACCOUNT_ID)?.get(prevDateKey) || lastKnownNAV.get(CSV_VIRTUAL_ACCOUNT_ID) || 0;
      const prevXMLNav = accountNAVMaps.get(XML_ACCOUNT_ID)?.get(prevDateKey) || lastKnownNAV.get(XML_ACCOUNT_ID) || 0;
      
      const currCSVNav = accountNAVMaps.get(CSV_VIRTUAL_ACCOUNT_ID)?.get(dateKey) || 0;
      const currXMLNav = accountNAVMaps.get(XML_ACCOUNT_ID)?.get(dateKey) || 0;
      
      // CRITICAL: Migration handover detection
      // Aug 20: CSV-only (CSV ends here, XML starts but use CSV for this day)
      // Aug 21-26: Migration period - use XML only, exclude CSV
      if (isAug20) {
        // Aug 20: Use CSV only (CSV's last day), exclude XML
        shouldExcludeCSV = false; // Don't exclude CSV on Aug 20
        // Exclude XML on Aug 20 instead - but we handle this in the aggregation loop
        console.log(`[DB-AGGREGATOR] Aug 20 (CSV last day): Using CSV only, excluding XML`);
      } else if (isInMigrationPeriod) {
        // During migration period, check if XML account exists and has data
        const xmlAccountExists = accountsToProcess.some(acc => acc.id === XML_ACCOUNT_ID);
        
        // If both CSV and XML have data on the same day, exclude CSV (use XML only)
        if (xmlAccountExists && currCSVNav > 0 && currXMLNav > 0) {
          // BOTH have data - exclude CSV to prevent double-counting
          shouldExcludeCSV = true;
          isMigrationHandoverDay = true;
          console.log(`[DB-AGGREGATOR] 🔧 Migration period (${dateKey}): BOTH CSV and XML have data - Excluding CSV (${formatCurrency(currCSVNav)}) - using XML only (${formatCurrency(currXMLNav)})`);
        } else if (xmlAccountExists && currXMLNav > 0 && currCSVNav === 0) {
          // Only XML has data during migration - exclude CSV
          shouldExcludeCSV = true;
          isMigrationHandoverDay = true;
          console.log(`[DB-AGGREGATOR] 🔧 Migration period (${dateKey}): XML has data, excluding CSV - using XML only (${formatCurrency(currXMLNav)})`);
        } else if (currCSVNav > 0 && currXMLNav === 0 && (!xmlAccountExists || prevXMLNav === 0)) {
          // Only CSV has data (before XML starts in migration period) - use CSV
          shouldExcludeCSV = false;
          console.log(`[DB-AGGREGATOR] Migration period (${dateKey}): Using CSV only (${formatCurrency(currCSVNav)}) - XML not started yet`);
        }
      } else if (prevCSVNav > 50000 && currXMLNav > 50000 && (date > csvLastDate || currCSVNav === 0)) {
        // CSV ending AND XML starting
        isMigrationHandoverDay = true;
        shouldExcludeCSV = true;
        console.log(`[DB-AGGREGATOR] Migration handover detected on ${dateKey}: CSV ending (${formatCurrency(prevCSVNav)}), XML starting (${formatCurrency(currXMLNav)})`);
      }
    }
    
    // Also exclude CSV after its last date
    if (csvLastDate && date > csvLastDate) {
      shouldExcludeCSV = true;
    }
    
    // Aggregate NAVs from all accounts
    for (const account of accountsToProcess) {
      const accountId = account.id;
      const navMap = accountNAVMaps.get(accountId);
      const accountLastDate = accountLastDates.get(accountId);
      
      // Skip CSV account if:
      // 1. Account has ended (after lastDate)
      // 2. Migration handover day (use only XML during migration period Aug 21-26)
      if (accountId === CSV_VIRTUAL_ACCOUNT_ID) {
        if ((accountLastDate && date > accountLastDate) || shouldExcludeCSV) {
          // CSV is excluded - do NOT add to aggregated NAV
          lastKnownNAV.set(accountId, 0);
          accountBreakdown[accountId] = 0;
          continue; // Skip CSV account - use XML only
        }
      }
      
      // Skip XML account on Aug 20 (use CSV only on CSV's last day)
      if (accountId === XML_ACCOUNT_ID && isAug20) {
        // Aug 20: Exclude XML, use CSV only
        accountBreakdown[accountId] = 0;
        continue; // Skip XML account on Aug 20
      }
      
      // Get NAV for this date (from database - NO hardcoding)
      let accountNAV = 0;
      if (navMap?.has(dateKey)) {
        accountNAV = navMap.get(dateKey)!;
        // Only update lastKnownNAV if account is not excluded
        if (!(accountId === CSV_VIRTUAL_ACCOUNT_ID && shouldExcludeCSV)) {
          lastKnownNAV.set(accountId, accountNAV);
        }
      } else if (lastKnownNAV.has(accountId) && !(accountId === CSV_VIRTUAL_ACCOUNT_ID && shouldExcludeCSV)) {
        // Carry forward last known NAV (for gaps in data), but not if CSV is excluded
        accountNAV = lastKnownNAV.get(accountId) || 0;
      }
      
      // Add to aggregated NAV only if account is not excluded
      if (accountId === CSV_VIRTUAL_ACCOUNT_ID && shouldExcludeCSV) {
        // CSV is excluded - do NOT add to aggregated NAV
        accountBreakdown[accountId] = 0;
      } else if (accountId === XML_ACCOUNT_ID && isAug20) {
        // XML is excluded on Aug 20 - do NOT add to aggregated NAV
        accountBreakdown[accountId] = 0;
      } else if (accountNAV > 0) {
        // Add account NAV to aggregated total
        aggregatedNAV += accountNAV;
        accountBreakdown[accountId] = accountNAV;
      } else {
        // Account has no NAV for this date
        accountBreakdown[accountId] = 0;
      }
    }
    
    // Debug logging for Aug 20-21 (only for U16030763)
    if (dateKey >= "2024-08-20" && dateKey <= "2024-08-21" && accountsToProcess.some(acc => acc.id === XML_ACCOUNT_ID)) {
      console.log(`[DB-AGGREGATOR] 📊 ${dateKey}: aggregatedNAV=${formatCurrency(aggregatedNAV)}, breakdown=${JSON.stringify(accountBreakdown)}`);
    }
    
    // Only add point if we have NAV data
    if (aggregatedNAV > 0 || equityCurve.length === 0) {
      equityCurve.push({
        date,
        nav: aggregatedNAV,
        cumulativeReturn: 0, // Will be calculated in TWR calculation
        accountBreakdown: Object.keys(accountBreakdown).length > 0 ? accountBreakdown : undefined,
      });
    }
  }
  
  const firstDate = equityCurve[0]?.date || new Date();
  const lastDate = equityCurve[equityCurve.length - 1]?.date || new Date();
  console.log(`[DB-AGGREGATOR] Built equity curve: ${equityCurve.length} points from ${format(firstDate instanceof Date ? firstDate : new Date(firstDate), 'yyyy-MM-dd')} to ${format(lastDate instanceof Date ? lastDate : new Date(lastDate), 'yyyy-MM-dd')}`);
  
  return equityCurve;
}

/**
 * Get account data from database
 */
export async function getAccountsFromDB(selectedAccountIds: Set<string> | null = null): Promise<ProcessedAccount[]> {
  const accounts = await accountQueries.getAll() as Array<{ id: string; alias: string; currency: string }>;
  
  // Filter if needed
  // IMPORTANT: Auto-include CSV virtual account if U16030763 is selected
  let accountsToProcess = accounts;
  if (selectedAccountIds && selectedAccountIds.size > 0) {
    console.log(`[DB-AGGREGATOR] [GET ACCOUNTS] Selected account IDs: [${Array.from(selectedAccountIds).join(', ')}]`);
    const filtered = accounts.filter(acc => selectedAccountIds.has(acc.id));
    
    // Auto-include CSV virtual account if U16030763 is selected
    if (selectedAccountIds.has(XML_ACCOUNT_ID)) {
      const csvAccount = accounts.find(acc => acc.id === CSV_VIRTUAL_ACCOUNT_ID);
      if (csvAccount && !filtered.find(acc => acc.id === CSV_VIRTUAL_ACCOUNT_ID)) {
        filtered.push(csvAccount);
        console.log(`[DB-AGGREGATOR] [GET ACCOUNTS] Auto-including CSV account (${CSV_VIRTUAL_ACCOUNT_ID}) because U16030763 is selected`);
      }
    }
    
    console.log(`[DB-AGGREGATOR] [GET ACCOUNTS] Processing ${filtered.length} account(s): [${filtered.map(a => a.id).join(', ')}]`);
    accountsToProcess = filtered;
  } else {
    // If no selection (All), exclude CSV virtual account to prevent double-counting
    accountsToProcess = accounts.filter(acc => acc.id !== CSV_VIRTUAL_ACCOUNT_ID);
  }
  
  // Get DailyNAV, Transactions, Holdings, ChangeInNAV for each account
  const processedAccounts: ProcessedAccount[] = [];
  
  for (const account of accountsToProcess) {
    const navRecords = await navQueries.getByAccount(account.id) as Array<{ date: string; nav_value: number }>;
    const transactions = await transactionQueries.getByAccount(account.id) as Array<{
      type: string;
      amount: number;
      date: string;
      description: string;
      symbol: string;
    }>;
    
    if (navRecords.length === 0) continue;
    
    // Find latest NAV
    const latestNav = navRecords[navRecords.length - 1];
    const earliestNav = navRecords[0];
    
    // Load ChangeInNAV from database (most recent period)
    const changeInNAVRecord = await changeInNAVQueries.getByAccount(account.id) as {
      from_date: string;
      to_date: string;
      starting_value: number;
      ending_value: number;
      deposits_withdrawals: number;
      dividends: number;
      interest: number;
      commissions: number;
      withholding_tax: number;
      other_fees: number;
      twr: number;
      fx_rate_to_base: number;
    } | undefined;
    
    // Build ChangeInNAV from database if available, otherwise calculate from NAV and transactions
    let changeInNAV: ProcessedChangeInNAV;
    
    if (changeInNAVRecord) {
      // Use stored ChangeInNAV from database
      changeInNAV = {
        fromDate: parseISO(changeInNAVRecord.from_date),
        toDate: parseISO(changeInNAVRecord.to_date),
        startingValue: changeInNAVRecord.starting_value,
        endingValue: changeInNAVRecord.ending_value,
        depositsWithdrawals: changeInNAVRecord.deposits_withdrawals,
        dividends: changeInNAVRecord.dividends,
        interest: changeInNAVRecord.interest,
        commissions: changeInNAVRecord.commissions,
        withholdingTax: changeInNAVRecord.withholding_tax,
        otherFees: changeInNAVRecord.other_fees,
        twr: changeInNAVRecord.twr,
        fxRateToBase: changeInNAVRecord.fx_rate_to_base,
      };
    } else {
      // Fallback: Calculate from NAV and transactions (for backward compatibility)
      changeInNAV = {
        fromDate: parseISO(earliestNav.date),
        toDate: parseISO(latestNav.date),
        startingValue: earliestNav.nav_value,
        endingValue: latestNav.nav_value,
        depositsWithdrawals: 0,
        dividends: 0,
        interest: 0,
        commissions: 0,
        withholdingTax: 0,
        otherFees: 0,
        twr: 0,
        fxRateToBase: account.currency === 'USD' ? 1 : 1,
      };
      
      // Calculate fees and income from transactions (fallback only)
      for (const tx of transactions) {
        const amount = Math.abs(tx.amount);
        const type = tx.type.toLowerCase();
        
        if (type.includes('dividend')) {
          changeInNAV.dividends += amount;
        } else if (type.includes('interest')) {
          changeInNAV.interest += amount;
        } else if (type.includes('commission') || type.includes('fee')) {
          changeInNAV.commissions += amount;
        } else if (type.includes('withholding') || type.includes('tax')) {
          changeInNAV.withholdingTax += amount;
        }
        
        if (type.includes('deposit') || type.includes('withdrawal')) {
          changeInNAV.depositsWithdrawals += tx.amount; // Keep sign
        }
      }
    }
    
    const processedAccount: ProcessedAccount = {
      accountId: account.id,
      accountAlias: account.alias,
      currency: account.currency,
      changeInNAV,
      openPositions: await (async () => {
        // Load holdings from database
        const holdingRecords = await holdingQueries.getLatestByAccount(account.id) as Array<{
          symbol: string;
          description: string;
          position: number;
          mark_price: number;
          position_value: number;
          cost_basis_money: number;
          fifo_pnl_unrealized: number;
          percent_of_nav: number;
          currency: string;
          fx_rate_to_base: number;
          conid: string | null;
        }>;
        
        if (holdingRecords.length > 0) {
          console.log(`[DB-AGGREGATOR] Loaded ${holdingRecords.length} holdings for account ${account.id}`);
        } else {
          console.log(`[DB-AGGREGATOR] No holdings found in database for account ${account.id}`);
        }
        
        return holdingRecords.map(h => ({
          symbol: normalizeSymbol(h.symbol),
          description: h.description || '',
          position: h.position,
          markPrice: h.mark_price,
          positionValue: h.position_value,
          costBasisMoney: h.cost_basis_money,
          fifoPnlUnrealized: h.fifo_pnl_unrealized,
          percentOfNAV: h.percent_of_nav,
          currency: h.currency || 'USD',
          fxRateToBase: h.fx_rate_to_base || 1.0,
          conid: h.conid || undefined,
        }));
      })(),
      trades: [],
      cashTransactions: transactions.map(tx => ({
        date: parseISO(tx.date),
        amount: tx.amount,
        type: tx.type,
        description: tx.description || '',
        symbol: tx.symbol || '',
        currency: account.currency,
        fxRateToBase: 1,
      })),
      transfers: await (async () => {
        // Load transfers from database
        const transferRecords = await transferQueries.getByAccount(account.id) as Array<{
          type: string;
          direction: string;
          amount: number;
          date: string;
          description: string;
          currency: string;
          fx_rate_to_base: number;
          from_account: string | null;
          to_account: string | null;
          transaction_id: string | null;
        }>;
        
        // DEDUPLICATION: Remove duplicate transfers
        // Priority: If transaction_id exists, use it for deduplication; otherwise use type + direction + amount + date
        const seenTransfers = new Map<string, typeof transferRecords[0]>();
        
        for (const tr of transferRecords) {
          const dedupKey = tr.transaction_id 
            ? `${account.id}_${tr.transaction_id}`
            : `${account.id}_${tr.type.toLowerCase()}_${tr.direction.toUpperCase()}_${tr.amount.toFixed(2)}_${tr.date}`;
          
          // Keep the first occurrence (or the one with transaction_id if available)
          if (!seenTransfers.has(dedupKey) || (!seenTransfers.get(dedupKey)?.transaction_id && tr.transaction_id)) {
            seenTransfers.set(dedupKey, tr);
          }
        }
        
        const uniqueTransfers = Array.from(seenTransfers.values());
        if (uniqueTransfers.length < transferRecords.length) {
          console.log(`[DB-AGGREGATOR] [GET ACCOUNTS] Deduplicated ${transferRecords.length} transfers to ${uniqueTransfers.length} for account ${account.id} (removed ${transferRecords.length - uniqueTransfers.length} duplicates)`);
        }
        
        return uniqueTransfers.map(tr => ({
          date: parseISO(tr.date),
          amount: tr.amount,
          type: tr.type,
          direction: tr.direction,
          description: tr.description || '',
          currency: tr.currency || 'USD',
          fxRateToBase: tr.fx_rate_to_base || 1.0,
          fromAccount: tr.from_account || undefined,
          toAccount: tr.to_account || undefined,
          transactionID: tr.transaction_id || undefined,
        }));
      })(),
    };
    
    processedAccounts.push(processedAccount);
  }
  
  return processedAccounts;
}

/**
 * Calculate TWR using Daily Geometric Linking
 * Formula: Return = (EndingNAV) / (PreviousNAV + TodayCashFlow) - 1
 * Treat all Deposits and Withdrawals as 'Beginning of Day' flows
 * Multiply all (1 + Return) factors together and subtract 1 at the very end
 */
function calculateTWRMetrics(
  equityCurve: EquityCurvePoint[], 
  cashFlows: Map<string, number>, 
  internalTransferDates: Set<string>,
  internalTransferInfo?: Map<string, { direction: string; amount: number; accountId: string }>
): EquityCurvePoint[] {
  // Create a map for internal transfer amounts (for chart visualization)
  const internalTransferAmounts = new Map<string, number>();
  if (internalTransferInfo) {
    for (const [dateKey, info] of internalTransferInfo.entries()) {
      // Amount is positive for IN, negative for OUT
      const amount = info.direction === 'IN' ? info.amount : -info.amount;
      internalTransferAmounts.set(dateKey, amount);
    }
  }
  if (equityCurve.length === 0) return equityCurve;
  
  // Find first non-zero NAV (must be > 1 to avoid floating point issues)
  const firstNonZeroIndex = equityCurve.findIndex(p => p.nav > 1);
  
  // If no non-zero NAV found, return with 0% returns
  if (firstNonZeroIndex < 0) {
    equityCurve.forEach(p => p.cumulativeReturn = 0);
    return equityCurve;
  }
  
  const effectiveStartIndex = firstNonZeroIndex;
  const startNAV = equityCurve[effectiveStartIndex].nav;
  
  // If starting NAV is invalid, return with 0% returns
  if (!startNAV || startNAV <= 0 || !isFinite(startNAV)) {
    equityCurve.forEach(p => p.cumulativeReturn = 0);
    return equityCurve;
  }
  
  let cumulativeMultiplier = 1.0;
  
  console.log(`[TWR] Starting TWR calculation for ${equityCurve.length - effectiveStartIndex} data points`);
  const twrStartTime = Date.now();
  
  // Track shifted cash flows with their origin date and shift count
  // Format: Map<currentDate, { amount: number, originDate: string, shiftCount: number }>
  const shiftedCashFlows = new Map<string, { amount: number; originDate: string; shiftCount: number }>();
  
  // Track retroactive flow applications - stores { dateIndex, cashFlow } for days that need recalculation
  const retroactiveApplications = new Map<number, number>();
  
  for (let i = effectiveStartIndex; i < equityCurve.length; i++) {
    const point = equityCurve[i];
    const dateKey = format(point.date, 'yyyy-MM-dd');
    
    // Get cash flow information for this date (for all points, including first)
    let todayCashFlow = cashFlows.get(dateKey) || 0;
    
    // Track if today's cash flow came from a shifted flow (to prevent re-shifting)
    let todayCashFlowShiftCount = 0;
    let todayCashFlowOriginDate = dateKey;
    
    // Check if there's a shifted cash flow for this date
    const shiftedFlow = shiftedCashFlows.get(dateKey);
    if (shiftedFlow) {
      // Apply shifted cash flow (it was shifted from a previous day)
      todayCashFlow += shiftedFlow.amount;
      todayCashFlowShiftCount = shiftedFlow.shiftCount;
      todayCashFlowOriginDate = shiftedFlow.originDate;
      // Shifted cash flow applied
      // Keep in shifted flows map for now - will be cleared after validation/application
    }
    
    const todayInternalTransfer = internalTransferAmounts.get(dateKey) || 0;
    const isInternalTransfer = internalTransferDates.has(dateKey);
    
    if (i === effectiveStartIndex) {
      // First point: 0% return (starting point)
      point.cumulativeReturn = 0;
      cumulativeMultiplier = 1.0;
      // Add cash flow information to first point
      if (isInternalTransfer && todayInternalTransfer !== 0) {
        point.cashFlow = todayInternalTransfer;
        point.isInternalTransfer = true;
      } else if (todayCashFlow !== 0) {
        point.cashFlow = todayCashFlow;
        point.isInternalTransfer = false;
      } else {
        point.cashFlow = 0;
        point.isInternalTransfer = false;
      }
    } else {
      const prevPoint = equityCurve[i - 1];
      let prevNAV = prevPoint.nav;
      let currNAV = point.nav;
      
      // Initialize dailyReturn variable early so it can be used in all code paths
      let dailyReturn = 0;
      
      // Skip points with invalid NAV
      if (!prevNAV || prevNAV <= 0 || !isFinite(prevNAV)) {
        // Use previous valid NAV or skip this point
        prevNAV = startNAV;
      }
      if (!currNAV || currNAV <= 0 || !isFinite(currNAV)) {
        // Carry forward previous return
        point.cumulativeReturn = prevPoint.cumulativeReturn || 0;
        continue;
      }
      
      // [CRITICAL-DEBUG-V3] CHECK FOR LAG: Before calculating, check if cash flow should be shifted to next day
      // This prevents -62% cliffs when deposits are recorded before NAV reflects them (e.g., $130k deposit on Jan 30, NAV reflects on Jan 31)
      // LIMIT THE SHIFT: A cash flow can only be shifted maximum 2 days
      if (Math.abs(todayCashFlow) > 1000 && prevNAV > 0 && currNAV > 0) {
        // Only attempt to shift if shift count is less than 2
        // If this flow was already shifted (shiftCount > 0), don't shift again if at limit
        if (todayCashFlowShiftCount < 2) {
          const hasLag = detectCashFlowLag(prevNAV, currNAV, todayCashFlow);
          
          if (hasLag) {
            // LIMIT THE SHIFT: Maximum 2 days
            if (todayCashFlowShiftCount >= 2) {
              console.log(`[CRITICAL-DEBUG-V3] [SHIFT-LIMIT] [${dateKey}] Cash flow ${formatCurrency(todayCashFlow)} has been shifted ${todayCashFlowShiftCount} times - processing with BOD formula`);
              // Don't shift - process with standard formula (BOD)
            } else {
              // Shift cash flow to next day - remove from today, add to next day where NAV will actually jump
              const newShiftCount = todayCashFlowShiftCount + 1;
              const originDate = todayCashFlowOriginDate;
              
              // Shifting cash flow to next day due to lag
              
              // Store the shifted cash flow to be applied on the next day
              if (i < equityCurve.length - 1) {
                const nextPoint = equityCurve[i + 1];
                const nextDateKey = format(nextPoint.date, 'yyyy-MM-dd');
                
                // Check if there's already a shifted flow for next day (add to it or replace)
                const existingShiftedFlow = shiftedCashFlows.get(nextDateKey);
                if (existingShiftedFlow) {
                  // Add to existing shifted flow (multiple flows shifted to same day)
                  shiftedCashFlows.set(nextDateKey, {
                    amount: existingShiftedFlow.amount + todayCashFlow,
                    originDate: originDate, // Use the earliest origin
                    shiftCount: Math.max(existingShiftedFlow.shiftCount, newShiftCount) // Use max shift count
                  });
                  // Added to existing shifted flow
                } else {
                  // Create new shifted flow entry
                  shiftedCashFlows.set(nextDateKey, {
                    amount: todayCashFlow,
                    originDate: originDate,
                    shiftCount: newShiftCount
                  });
                  // Queued shifted cash flow
                }
              }
              
              // Clear today's cash flow - treat as no cash flow day (prevents -62% cliff)
              todayCashFlow = 0;
              // Also clear from shifted flows if it was there (since we've re-shifted it)
              if (shiftedFlow) {
                shiftedCashFlows.delete(dateKey);
              }
              // Today's cash flow cleared - will calculate as no-cash-flow day
            }
          }
        } else {
          // Shift limit reached - RETROACTIVE NEUTRALIZATION
          // Instead of forcing on Day 3, check if NAV jump occurred on Day 1 or 2
          // Apply the cash flow to the first day in the 3-day window that showed NAV change > 5%
          console.log(`[CRITICAL-DEBUG-V3] [SHIFT-LIMIT] [${dateKey}] Cash flow ${formatCurrency(todayCashFlow)} has been shifted ${todayCashFlowShiftCount} times (max 2) - checking for retroactive application`);
          
          const originDate = todayCashFlowOriginDate;
          let appliedRetroactively = false;
          
          // Look back 2 days (3-day window: Day 1, Day 2, Day 3 = today)
          const maxLookback = Math.min(2, i - effectiveStartIndex);
          let targetDayIndex = -1;
          
          for (let lookbackDays = maxLookback; lookbackDays >= 1 && !appliedRetroactively; lookbackDays--) {
            const lookbackIndex = i - lookbackDays;
            if (lookbackIndex < effectiveStartIndex) continue;
            
            const lookbackPoint = equityCurve[lookbackIndex];
            const lookbackDateKey = format(lookbackPoint.date, 'yyyy-MM-dd');
            
            // Calculate NAV change for this lookback day
            if (lookbackIndex > effectiveStartIndex) {
              const prevLookbackPoint = equityCurve[lookbackIndex - 1];
              const prevLookbackNAV = prevLookbackPoint.nav;
              const lookbackNAV = lookbackPoint.nav;
              
              if (prevLookbackNAV > 0 && lookbackNAV > 0) {
                const lookbackNavChange = lookbackNAV - prevLookbackNAV;
                const lookbackNavChangePercent = Math.abs((lookbackNavChange / prevLookbackNAV) * 100);
                
                // Check if this day had a NAV jump > 5%
                if (lookbackNavChangePercent > 5) {
                  // Check if NAV change matches the cash flow direction and magnitude (within 20%)
                  const navChangeVsFlowRatio = Math.abs(todayCashFlow) > 1 ? Math.abs(lookbackNavChange / todayCashFlow) : 0;
                  const navChangeMatchesFlow = navChangeVsFlowRatio >= 0.8 && navChangeVsFlowRatio <= 1.2;
                  const directionMatches = (todayCashFlow > 0 && lookbackNavChange > 0) || (todayCashFlow < 0 && lookbackNavChange < 0);
                  
                  if (navChangeMatchesFlow && directionMatches) {
                    // Found the day where NAV jump occurred - apply retroactively
                    targetDayIndex = lookbackIndex;
                    appliedRetroactively = true;
                    // NAV jump matches shifted flow - applying retroactively
                  }
                }
              }
            }
          }
          
          if (appliedRetroactively && targetDayIndex >= 0) {
            // Apply cash flow to the target day retroactively
            const targetPoint = equityCurve[targetDayIndex];
            const targetDateKey = format(targetPoint.date, 'yyyy-MM-dd');
            
            // Get the existing cash flow for that day
            const existingFlow = cashFlows.get(targetDateKey) || 0;
            
            // Add the retroactive flow to that day
            const retroactiveFlow = todayCashFlow;
            cashFlows.set(targetDateKey, existingFlow + retroactiveFlow);
            
            // Store retroactive application for recalculation
            const existingRetroactive = retroactiveApplications.get(targetDayIndex) || 0;
            retroactiveApplications.set(targetDayIndex, existingRetroactive + retroactiveFlow);
            
            // Added retroactive cash flow - will neutralize the NAV jump
            
            // Clear today's cash flow - don't apply it today
            todayCashFlow = 0;
            // Clear from shifted flows
            if (shiftedFlow) {
              shiftedCashFlows.delete(dateKey);
            }
            
            // Trigger recalculation from target day forward
            // Flow applied retroactively - recalculating TWR
            
            // Recalculate from target day to current day (inclusive)
            // Get the cumulative multiplier from the day before target
            let recalcCumulativeMultiplier = 1.0;
            if (targetDayIndex > effectiveStartIndex) {
              const beforeTargetPoint = equityCurve[targetDayIndex - 1];
              const beforeTargetReturn = beforeTargetPoint.cumulativeReturn || 0;
              recalcCumulativeMultiplier = 1 + (beforeTargetReturn / 100);
              recalcCumulativeMultiplier = Math.max(0.001, Math.min(1000, recalcCumulativeMultiplier));
            }
            
            // Recalculate from target day to current day (reusing the same logic as main loop)
            for (let recalcIndex = targetDayIndex; recalcIndex <= i; recalcIndex++) {
              if (recalcIndex === effectiveStartIndex) {
                equityCurve[recalcIndex].cumulativeReturn = 0;
                recalcCumulativeMultiplier = 1.0;
                continue;
              }
              
              const recalcPoint = equityCurve[recalcIndex];
              const recalcPrevPoint = equityCurve[recalcIndex - 1];
              let recalcPrevNAV = recalcPrevPoint.nav;
              let recalcCurrNAV = recalcPoint.nav;
              const recalcDateKey = format(recalcPoint.date, 'yyyy-MM-dd');
              
              // Handle invalid NAV
              if (!recalcPrevNAV || recalcPrevNAV <= 0 || !isFinite(recalcPrevNAV)) {
                recalcPrevNAV = startNAV;
              }
              if (!recalcCurrNAV || recalcCurrNAV <= 0 || !isFinite(recalcCurrNAV)) {
                recalcPoint.cumulativeReturn = recalcPrevPoint.cumulativeReturn || 0;
                continue;
              }
              
              // Get cash flow for this recalculation day (including retroactive if applicable)
              let recalcCashFlow = cashFlows.get(recalcDateKey) || 0;
              const recalcIsInternalTransfer = internalTransferDates.has(recalcDateKey);
              
              // Calculate daily return
              let recalcDailyReturn = 0;
              
              if (recalcIsInternalTransfer) {
                // Internal transfers have 0% return
                recalcDailyReturn = 0;
              } else {
                // Calculate return using Valuation-at-Flow method
                const returnResult = calculateDailyReturn(recalcPrevNAV, recalcCurrNAV, recalcCashFlow);
                recalcDailyReturn = returnResult.return;
                
                // Clamp extreme returns
                recalcDailyReturn = Math.max(-0.99, Math.min(10, recalcDailyReturn));
                if (!isFinite(recalcDailyReturn)) {
                  recalcDailyReturn = 0;
                }
              }
              
              // Multiply cumulative multiplier
              recalcCumulativeMultiplier *= (1 + recalcDailyReturn);
              recalcCumulativeMultiplier = Math.max(0.001, Math.min(1000, recalcCumulativeMultiplier));
              
              // Update cumulative return
              const recalcReturnPercent = (recalcCumulativeMultiplier - 1) * 100;
              recalcPoint.cumulativeReturn = isFinite(recalcReturnPercent) ? recalcReturnPercent : 0;
              
              // Update chart data for this recalculated day
              if (recalcIndex === targetDayIndex) {
                // Update target day's chart data with the retroactive cash flow
                const targetDayCashFlow = cashFlows.get(recalcDateKey) || 0;
                const targetDayIsInternalTransfer = internalTransferDates.has(recalcDateKey);
                const targetDayInternalTransfer = internalTransferAmounts.get(recalcDateKey) || 0;
                
                if (targetDayIsInternalTransfer && targetDayInternalTransfer !== 0) {
                  recalcPoint.cashFlow = targetDayInternalTransfer;
                  recalcPoint.isInternalTransfer = true;
                } else if (targetDayCashFlow !== 0) {
                  recalcPoint.cashFlow = targetDayCashFlow;
                  recalcPoint.isInternalTransfer = false;
                } else {
                  recalcPoint.cashFlow = 0;
                  recalcPoint.isInternalTransfer = false;
                }
                
                // Updated chart data with retroactive cash flow
              }
            }
            
            // Update cumulative multiplier for continuation to next iteration
            cumulativeMultiplier = recalcCumulativeMultiplier;
            // Recalculated TWR retroactively - skipping normal processing
            
            // Skip normal processing for this iteration since we've already handled it
            // Continue to next iteration
            continue;
          } else {
            // No retroactive match found - apply to today with BOD formula
            // No retroactive match found - processing with BOD formula
            // Keep todayCashFlow as is for BOD processing
            // Clear from shifted flows since we're processing it now
            if (shiftedFlow) {
              shiftedCashFlows.delete(dateKey);
            }
          }
        }
      }
      
        // CRITICAL: Check if this day's NAV change matches a PREVIOUS day's cash flow
      // This handles cases where IBKR records deposit on day N, but NAV reflects it on day N+1
      // Example: Deposit $65k on Nov 6, NAV jumps $57k on Nov 7 → Nov 7 should be neutralized
      let isPrevCashFlowAppearing = false;
      if (Math.abs(todayCashFlow) < 1 && i > effectiveStartIndex && prevNAV > 0) {
        const navChange = currNAV - prevNAV;
        const navChangeAbs = Math.abs(navChange);
        
        // Only check if NAV change is large (>$10k and >5% of previous NAV)
        if (navChangeAbs > 10000 && navChangeAbs > prevNAV * 0.05) {
          // Check previous 3 days for cash flows that might be appearing now in NAV
          // OPTIMIZED: Limit lookback and add safety checks
          const maxLookback = Math.min(3, i - effectiveStartIndex);
          for (let lookbackDays = 1; lookbackDays <= maxLookback && !isPrevCashFlowAppearing; lookbackDays++) {
            const lookbackIndex = i - lookbackDays;
            if (lookbackIndex < effectiveStartIndex || !equityCurve[lookbackIndex]) break;
            
            const prevCashFlowPoint = equityCurve[lookbackIndex];
            const prevCashFlowDateKey = format(prevCashFlowPoint.date, 'yyyy-MM-dd');
            const prevCashFlow = cashFlows.get(prevCashFlowDateKey) || 0;
            
            // Only check if previous day had significant cash flow (reduces unnecessary calculations)
            if (Math.abs(prevCashFlow) > 1000) {
              const prevCashFlowAbs = Math.abs(prevCashFlow);
              // Quick check: is the ratio close enough?
              const ratio = navChangeAbs / Math.max(prevCashFlowAbs, 1);
              if (ratio >= 0.85 && ratio <= 1.15) { // Within 15%
                const directionMatches = (prevCashFlow > 0 && navChange > 0) || (prevCashFlow < 0 && navChange < 0);
                
                if (directionMatches) {
                  // Match found - neutralize
                  dailyReturn = 0;
                  isPrevCashFlowAppearing = true;
                  if (navChangeAbs > 50000) {
                    console.log(`[TWR] [${dateKey}] ✓ NAV change matches previous day's cash flow - neutralizing to 0%`);
                  }
                  break; // Exit loop early
                }
              }
            }
          }
        }
      }
      
      // If we detected previous cash flow appearing, skip the rest and update cumulative
      if (isPrevCashFlowAppearing) {
        cumulativeMultiplier *= (1 + dailyReturn);
        cumulativeMultiplier = Math.max(0.001, Math.min(1000, cumulativeMultiplier));
        const returnPercent = (cumulativeMultiplier - 1) * 100;
        point.cumulativeReturn = isFinite(returnPercent) ? returnPercent : 0;
        continue;
      }
      
      // Check if we should use previous day's cash flow (deposits might be recorded day before NAV change)
      if (Math.abs(todayCashFlow) < 1 && i > effectiveStartIndex) {
        const prevDateKey = format(prevPoint.date, 'yyyy-MM-dd');
        const prevCashFlow = cashFlows.get(prevDateKey) || 0;
        
        // Calculate NAV change
        const navChange = currNAV - prevNAV;
        const navChangePercent = prevNAV > 0 ? Math.abs((navChange / prevNAV) * 100) : 0;
        
        // If there's a significant cash flow on previous day AND current day shows a NAV jump (>30%),
        // use the previous day's cash flow (deposit recorded on day N, NAV reflects it on day N+1)
        if (Math.abs(prevCashFlow) > 100 && navChangePercent > 30 && Math.abs(navChange - prevCashFlow) / Math.max(Math.abs(prevCashFlow), 1) < 0.2) {
          // NAV change is close to the cash flow amount (within 20%), so this is likely the deposit
          todayCashFlow = prevCashFlow;
          console.log(`[TWR] [${dateKey}] Using previous day (${prevDateKey}) cash flow: ${formatCurrency(todayCashFlow)} (NAV jump matches: ${formatCurrency(prevNAV)} → ${formatCurrency(currNAV)}, change: ${formatCurrency(navChange)})`);
        }
      }
      
      // Also check next day's cash flow in case deposit is recorded AFTER NAV changes
      // This is less common but can happen
      if (Math.abs(todayCashFlow) < 1 && i < equityCurve.length - 1) {
        const nextPoint = equityCurve[i + 1];
        const nextDateKey = format(nextPoint.date, 'yyyy-MM-dd');
        const nextCashFlow = cashFlows.get(nextDateKey) || 0;
        
        const navChange = currNAV - prevNAV;
        const navChangePercent = prevNAV > 0 ? Math.abs((navChange / prevNAV) * 100) : 0;
        
        // If there's a cash flow on next day and current day has large NAV jump, use it
        if (Math.abs(nextCashFlow) > 100 && navChangePercent > 30 && Math.abs(navChange - nextCashFlow) / Math.max(Math.abs(nextCashFlow), 1) < 0.2) {
          todayCashFlow = nextCashFlow;
          console.log(`[TWR] [${dateKey}] Using next day (${nextDateKey}) cash flow: ${formatCurrency(todayCashFlow)} (NAV jump matches: ${formatCurrency(prevNAV)} → ${formatCurrency(currNAV)}, change: ${formatCurrency(navChange)})`);
        }
      }
      
      // Calculate daily return using Daily Geometric Linking formula with BOD cash flows
      // Note: dailyReturn is already initialized above, only reset if not already set by previous checks
      if (!isPrevCashFlowAppearing) {
        dailyReturn = 0;
      }
      
      // CRITICAL: Neutralize internal transfer dates completely (set return to 0)
      // Internal transfers should NOT affect TWR at all - they're just money moving between accounts
      // STRICT FILTERING: Ensure internal transfers are NEVER passed to calculateDailyReturn
      // Check if this date has an internal transfer (exact match or check with date normalization)
      const isInternalTransferDate = internalTransferDates.has(dateKey);
      
      if (isInternalTransferDate) {
        // STRICT FILTERING: Force cash flow to zero for internal transfer dates
        // This ensures internal transfers are NEVER passed to calculateDailyReturn
        todayCashFlow = 0;
        dailyReturn = 0;
        const navChange = currNAV - prevNAV;
        const transferInfo = internalTransferInfo?.get(dateKey);
        const transferDirection = transferInfo?.direction || 'UNKNOWN';
        console.log(`[TWR] [${dateKey}] Internal Transfer (${transferDirection}) - setting return to 0% and cash flow to 0 (neutralized, excluded from TWR). NAV change: ${formatCurrency(navChange)} (${prevNAV > 0 ? ((navChange / prevNAV) * 100).toFixed(2) : 'N/A'}%)`);
      } else if (prevNAV > 0) {
        // Calculate return using Valuation-at-Flow methodology
        // For flow days (external deposits/withdrawals), uses Modified Dietz method
        // which weights cash flows by time to prevent cliff spikes
        // Internal transfers are already handled above (return = 0%)
        
        // Calculate NAV change for validation and logging
        const navChange = currNAV - prevNAV;
        const navChangePercent = prevNAV > 0 ? (navChange / prevNAV) * 100 : 0;
        const navChangeAbs = Math.abs(navChange);
        
        // CRITICAL: Check if this NAV change matches an internal transfer on an adjacent date
        // Internal transfers might affect NAV on the day before or after the transfer date
        // This prevents internal transfers OUT from being counted as losses on adjacent days
        if (internalTransferInfo && Math.abs(todayCashFlow) < 1 && navChangeAbs > 1000) {
          // Check previous day for internal transfer
          if (i > effectiveStartIndex) {
            const prevDateKey = format(prevPoint.date, 'yyyy-MM-dd');
            const prevTransferInfo = internalTransferInfo.get(prevDateKey);
            if (prevTransferInfo) {
              // If NAV change matches transfer amount (within 5%), neutralize this day
              const transferAmount = prevTransferInfo.amount;
              const amountMatch = Math.abs(navChangeAbs - transferAmount) / Math.max(transferAmount, 1) < 0.05;
              const directionMatch = (prevTransferInfo.direction === 'OUT' && navChange < 0) || 
                                    (prevTransferInfo.direction === 'IN' && navChange > 0);
              
              if (amountMatch && directionMatch) {
                dailyReturn = 0;
                console.log(`[TWR] [${dateKey}] ✓ Neutralizing return (0%) - NAV change (${formatCurrency(navChange)}) matches previous day's internal ${prevTransferInfo.direction} transfer (${formatCurrency(transferAmount)})`);
                cumulativeMultiplier *= (1 + dailyReturn);
                cumulativeMultiplier = Math.max(0.001, Math.min(1000, cumulativeMultiplier));
                const returnPercent = (cumulativeMultiplier - 1) * 100;
                point.cumulativeReturn = isFinite(returnPercent) ? returnPercent : 0;
                continue;
              }
            }
          }
          
          // Check next day for internal transfer
          if (i < equityCurve.length - 1) {
            const nextPoint = equityCurve[i + 1];
            const nextDateKey = format(nextPoint.date, 'yyyy-MM-dd');
            const nextTransferInfo = internalTransferInfo.get(nextDateKey);
            if (nextTransferInfo) {
              // If NAV change matches transfer amount (within 5%), neutralize this day
              const transferAmount = nextTransferInfo.amount;
              const amountMatch = Math.abs(navChangeAbs - transferAmount) / Math.max(transferAmount, 1) < 0.05;
              const directionMatch = (nextTransferInfo.direction === 'OUT' && navChange < 0) || 
                                    (nextTransferInfo.direction === 'IN' && navChange > 0);
              
              if (amountMatch && directionMatch) {
                dailyReturn = 0;
                console.log(`[TWR] [${dateKey}] ✓ Neutralizing return (0%) - NAV change (${formatCurrency(navChange)}) matches next day's internal ${nextTransferInfo.direction} transfer (${formatCurrency(transferAmount)})`);
                cumulativeMultiplier *= (1 + dailyReturn);
                cumulativeMultiplier = Math.max(0.001, Math.min(1000, cumulativeMultiplier));
                const returnPercent = (cumulativeMultiplier - 1) * 100;
                point.cumulativeReturn = isFinite(returnPercent) ? returnPercent : 0;
                continue;
              }
            }
          }
        }
        
        // [CRITICAL-DEBUG-V3] BIG JUMP RULE: If NAV jumps by more than 50% on a day with no recorded flow,
        // check if there's a shifted flow queued for today that matches the NAV jump
        // Shifted flows are stored with the target date (the date they were shifted TO)
        if (Math.abs(todayCashFlow) < 1 && Math.abs(navChangePercent) > 50) {
          // Check if there's a shifted flow queued for today (it was shifted TO this date)
          const shiftedFlowForToday = shiftedCashFlows.get(dateKey);
          
          if (shiftedFlowForToday) {
            // Check if NAV jump matches the shifted cash flow (within 20%)
            const navChangeVsFlowRatio = Math.abs(shiftedFlowForToday.amount) > 1 ? Math.abs(navChange / shiftedFlowForToday.amount) : 0;
            const navChangeMatchesFlow = navChangeVsFlowRatio >= 0.8 && navChangeVsFlowRatio <= 1.2;
            const directionMatches = (shiftedFlowForToday.amount > 0 && navChange > 0) || (shiftedFlowForToday.amount < 0 && navChange < 0);
            
            if (navChangeMatchesFlow && directionMatches) {
              // BIG JUMP matches shifted flow - apply it today
              todayCashFlow = shiftedFlowForToday.amount;
              // Clear the shifted flow (clear the queue once applied)
              shiftedCashFlows.delete(dateKey);
              // NAV jump matches shifted flow - applying today
            } else {
              // NAV jump doesn't match shifted flow - might be a different event
              // NAV jump doesn't match shifted flow
            }
          }
          
          // If no shifted flow matched, check if this looks like a deposit/withdrawal
          if (Math.abs(todayCashFlow) < 1) {
            const isRoundNumber = Math.abs(navChange) >= 1000 && Math.abs(navChange % 1000) < 10;
            const isVeryLargeChange = Math.abs(navChangePercent) > 200; // More than 200% change is almost certainly a deposit/withdrawal
            
            if (isRoundNumber || isVeryLargeChange) {
              // Infer cash flow from NAV change
              todayCashFlow = navChange;
              console.warn(`[TWR] [${dateKey}] ⚠️ Large NAV change (${navChangePercent.toFixed(1)}%: ${formatCurrency(prevNAV)} → ${formatCurrency(currNAV)}) with no recorded cash flow. Inferring cash flow: ${formatCurrency(todayCashFlow)}`);
              // Now recalculate using the inferred cash flow (will fall through to cash flow handling below)
            } else {
              // This might be legitimate market movement (unlikely but possible)
              console.warn(`[TWR] [${dateKey}] ⚠️ Large NAV change (${navChangePercent.toFixed(1)}%: ${formatCurrency(prevNAV)} → ${formatCurrency(currNAV)}) but no cash flow recorded! Treating as market movement (may be incorrect)`);
              dailyReturn = (currNAV / prevNAV) - 1;
            }
          }
        }
        
        // [CRITICAL-DEBUG-V3] VALIDATION: Ensure a deposit is only 'neutralized' against the NAV jump it actually caused
        // If we have a cash flow (including shifted flows), verify it matches the NAV change (within reasonable tolerance)
        // This prevents neutralizing cash flows that were shifted from previous days but don't match this day's NAV jump
        // Once validated and applied, clear it from shifted flows queue
        if (Math.abs(todayCashFlow) > 1000) {
          const navChangeVsCashFlowRatio = Math.abs(todayCashFlow) > 1 ? Math.abs(navChange / todayCashFlow) : 0;
          const cashFlowMatchesNavChange = Math.abs(navChange - todayCashFlow) / Math.max(Math.abs(todayCashFlow), Math.abs(navChange), 1) < 0.2; // Within 20%
          
          // If cash flow was shifted from previous day but doesn't match this day's NAV jump, clear it
          // This ensures deposits are only neutralized against the NAV jump they actually caused
          if (!cashFlowMatchesNavChange && navChangeVsCashFlowRatio < 0.5) {
            // Cash flow doesn't match NAV change - might be incorrectly shifted or wrong day
            // Cash flow doesn't match NAV change - clearing
            todayCashFlow = 0; // Clear - treat as no cash flow day
            // Also clear from shifted flows if it was there
            shiftedCashFlows.delete(dateKey);
          } else if (cashFlowMatchesNavChange) {
            // Cash flow matches NAV change - will neutralize correctly
            // Clear from shifted flows once validated and applied
            if (shiftedCashFlows.has(dateKey)) {
              shiftedCashFlows.delete(dateKey);
              // Cleared shifted cash flow from queue after successful validation
            }
          }
        }
        
        // [CRITICAL-DEBUG-V3] VALUATION-AT-FLOW: Use sub-period methodology with Artificial Pre-Flow
        // NO FALLBACK - Uses direct formula: (TodayEndingNAV - TodayCashFlow) / YesterdayNAV - 1
        // This prevents the "cliff spike" issue by treating deposits as arriving at end of day
        const returnResult = calculateDailyReturn(prevNAV, currNAV, todayCashFlow);
        dailyReturn = returnResult.return; // Extract return value from result object
        
        // Flow day processed using Valuation-at-Flow method
        
        // Clamp daily return to prevent extreme values (max 1000% gain, 99% loss per day)
        dailyReturn = Math.max(-0.99, Math.min(10, dailyReturn));
        
        // Check for NaN or Infinity
        if (!isFinite(dailyReturn)) {
          dailyReturn = 0;
        }
      }
      
      // Multiply (1 + Return) factors together
      cumulativeMultiplier *= (1 + dailyReturn);
      
      // Ensure cumulative multiplier doesn't go negative or invalid
      cumulativeMultiplier = Math.max(0.001, Math.min(1000, cumulativeMultiplier));
      
      // Calculate cumulative TWR: (cumulative multiplier - 1) * 100
      const returnPercent = (cumulativeMultiplier - 1) * 100;
      point.cumulativeReturn = isFinite(returnPercent) ? returnPercent : 0;
      
      // Add cash flow information to point for chart visualization
      // Internal transfers are stored separately for filtering in multi-portfolio mode
      if (isInternalTransfer && todayInternalTransfer !== 0) {
        point.cashFlow = todayInternalTransfer;
        point.isInternalTransfer = true;
      } else if (todayCashFlow !== 0) {
        point.cashFlow = todayCashFlow;
        point.isInternalTransfer = false;
      } else {
        point.cashFlow = 0;
        point.isInternalTransfer = false;
      }
    }
  }
  
  const twrElapsed = Date.now() - twrStartTime;
  console.log(`[TWR] ✓ Completed TWR calculation in ${twrElapsed}ms (${((twrElapsed) / Math.max(equityCurve.length - effectiveStartIndex, 1)).toFixed(2)}ms per point)`);
  
  return equityCurve;
}

/**
 * Aggregate data from database (replaces XML-based aggregation)
 */
export async function aggregateIBKRDataFromDB(
  selectedAccountIds: Set<string> | null = null
): Promise<AggregatedData> {
  console.log('[DB-AGGREGATOR] Starting database-based aggregation');
  
  // Get accounts from database
  const accounts = await getAccountsFromDB(selectedAccountIds);
  console.log(`[DB-AGGREGATOR] Loaded ${accounts.length} accounts from database`);
  
  if (accounts.length === 0) {
    // Return empty structure
    return {
      accounts: [],
      totalNAV: 0,
      combinedPositions: [],
      equityCurve: [],
      totalProfitLoss: 0,
      netDeposits: 0,
      dailyChange: 0,
      dailyChangePercent: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      feesAndIncome: {
        totalDividends: 0,
        totalInterest: 0,
        totalCommissions: 0,
        totalWithholdingTax: 0,
        totalOtherFees: 0,
        totalCredits: 0,
        grossProfit: 0,
        netProfit: 0,
      },
      annualizedYield: 0,
    };
  }
  
  // Build equity curve from database (this already handles aggregation correctly)
  const equityCurve = await buildEquityCurveFromDB(selectedAccountIds);
  
  // Calculate total NAV from the latest point in the equity curve (not sum of accounts)
  // The equity curve already handles CSV/XML exclusion correctly
  const totalNAV = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : 0;
  
  // GLOBAL NEUTRALIZATION: When calculating TotalGroupCashFlow, sum ALL cash flows (external + internal) first
  // Then apply Zero-Sum Rule to neutralize internal transfers in multi-portfolio mode
  let cashFlows = new Map<string, number>();
  const internalTransferDates = new Set<string>();
  const isMultiplePortfolios = selectedAccountIds && selectedAccountIds.size > 1;
  
  // FIRST PASS: Aggregate ALL cash flows (external deposits/withdrawals + internal transfers) across all accounts
  // This includes internal transfers which will be neutralized in the next pass
  const allCashFlowsIncludingInternal = new Map<string, number>();
  
  // Process transfers from database to identify INTERNAL transfers
  // INTERNAL transfers should neutralize TWR (set daily return to 0%) in single portfolio mode
  // In multi-portfolio mode, they should be neutralized at group level (zero-sum rule)
  const internalTransferInfo = new Map<string, { direction: string; amount: number; accountId: string }>();
  
  // DEDUPLICATION: Track processed transfers across all accounts to avoid counting duplicates
  const processedTransfersGlobal = new Set<string>();
  
  for (const account of accounts) {
    for (const transfer of account.transfers || []) {
      const transferType = (transfer.type || "").toLowerCase().trim();
      const transferDirection = (transfer.direction || "").toUpperCase().trim();
      
      // Check for INTERNAL transfers (case-insensitive, handle variations)
      // INTERNAL transfers (both IN and OUT) should be excluded from TWR calculation
      const isInternalTransfer = transferType === "internal" || 
                                 transferType.includes("internal") ||
                                 (transfer.description || "").toLowerCase().includes("internal transfer");
      
      if (isInternalTransfer) {
        // Ensure date is a Date object (it should be from parseISO in getAccountsFromDB)
        let transferDate: Date;
        if (transfer.date instanceof Date) {
          transferDate = transfer.date;
        } else if (typeof transfer.date === 'string') {
          // Fallback: parse string date
          transferDate = parseISO(transfer.date);
        } else {
          console.warn(`[DB-AGGREGATOR] ⚠️ Invalid transfer date format for account ${account.accountId}:`, transfer.date);
          continue; // Skip this transfer
        }
        
        const transferDateKey = format(transferDate, 'yyyy-MM-dd');
        // Calculate absolute amount for deduplication key
        const absAmountUSD = Math.abs(transfer.amount * transfer.fxRateToBase);
        
        // Create a unique key for deduplication: account_id + transaction_id (if available) or account_id + type + direction + amount + date
        const transferKey = transfer.transactionID 
          ? `${account.accountId}_${transfer.transactionID}`
          : `${account.accountId}_${transferType}_${transferDirection}_${absAmountUSD.toFixed(2)}_${transferDateKey}`;
        
        // Skip if we've already processed this transfer
        if (processedTransfersGlobal.has(transferKey)) {
          console.log(`[DB-AGGREGATOR] [CASH FLOW] Skipping duplicate INTERNAL ${transferDirection} Transfer: ${transferDateKey} - ${formatCurrency(absAmountUSD)} (account: ${account.accountId}, transaction_id: ${transfer.transactionID || 'N/A'})`);
          continue;
        }
        
        processedTransfersGlobal.add(transferKey);
        
        const dateKey = transferDateKey;
        // Amount: positive for IN, negative for OUT (for zero-sum calculation)
        const amountUSD = (transferDirection === 'IN' ? 1 : -1) * absAmountUSD;
        
        // Add to ALL cash flows first (will be neutralized later)
        const existing = allCashFlowsIncludingInternal.get(dateKey) || 0;
        allCashFlowsIncludingInternal.set(dateKey, existing + amountUSD);
        
        // Add date to internal transfer dates for tracking
        internalTransferDates.add(dateKey);
        
        // Store transfer info for adjacent-day detection
        internalTransferInfo.set(dateKey, {
          direction: transferDirection,
          amount: Math.abs(amountUSD),
          accountId: account.accountId
        });
        
        console.log(`[DB-AGGREGATOR] [CASH FLOW] INTERNAL ${transferDirection} Transfer: ${dateKey} - ${formatCurrency(amountUSD)} (account: ${account.accountId})`);
      }
    }
  }
  
  // Get deposits and withdrawals from dedicated tables (EXTERNAL only - already categorized during ingestion)
  
  /**
   * Deduplicate deposits by transaction_id (if available) or by account_id + amount + date
   */
  function deduplicateDeposits(deposits: Array<{
    amount: number;
    date: string;
    description: string;
    currency: string;
    fx_rate_to_base: number;
    transaction_id: string | null;
  }>, accountId: string): typeof deposits {
    const seenDeposits = new Map<string, typeof deposits[0]>();
    
    for (const deposit of deposits) {
      const dedupKey = deposit.transaction_id 
        ? `${accountId}_${deposit.transaction_id}`
        : `${accountId}_${deposit.amount.toFixed(2)}_${deposit.date}`;
      
      // Keep the first occurrence (or the one with transaction_id if available)
      if (!seenDeposits.has(dedupKey) || (!seenDeposits.get(dedupKey)?.transaction_id && deposit.transaction_id)) {
        seenDeposits.set(dedupKey, deposit);
      }
    }
    
    const uniqueDeposits = Array.from(seenDeposits.values());
    if (uniqueDeposits.length < deposits.length) {
      console.log(`[DB-AGGREGATOR] [CASH FLOW] Deduplicated ${deposits.length} deposits to ${uniqueDeposits.length} for account ${accountId} (removed ${deposits.length - uniqueDeposits.length} duplicates)`);
    }
    
    return uniqueDeposits;
  }
  
  for (const account of accounts) {
    // Get deposits for this account
    const allDeposits = await depositQueries.getByAccount(account.accountId) as Array<{
      amount: number;
      date: string;
      description: string;
      currency: string;
      fx_rate_to_base: number;
      transaction_id: string | null;
    }>;
    
    // Deduplicate deposits
    const deposits = deduplicateDeposits(allDeposits, account.accountId);
    
    for (const deposit of deposits) {
      const dateKey = deposit.date;
      const amountUSD = deposit.amount * deposit.fx_rate_to_base;
      
      // Add to ALL cash flows (including internal)
      const existing = allCashFlowsIncludingInternal.get(dateKey) || 0;
      allCashFlowsIncludingInternal.set(dateKey, existing + amountUSD);
      
      if (Math.abs(amountUSD) > 10000) {
        console.log(`[DB-AGGREGATOR] [CASH FLOW] [${account.accountId}] ${dateKey}: ${formatCurrency(amountUSD)} (Deposit)`);
      }
    }
    
    // Get withdrawals for this account
    const withdrawals = await withdrawalQueries.getByAccount(account.accountId) as Array<{
      amount: number;
      date: string;
      description: string;
      currency: string;
      fx_rate_to_base: number;
      transaction_id: string | null;
    }>;
    
    for (const withdrawal of withdrawals) {
      const dateKey = withdrawal.date;
      const amountUSD = withdrawal.amount * withdrawal.fx_rate_to_base;
      
      // Add to ALL cash flows (negative for withdrawals)
      const existing = allCashFlowsIncludingInternal.get(dateKey) || 0;
      allCashFlowsIncludingInternal.set(dateKey, existing - amountUSD);
      
      if (Math.abs(amountUSD) > 10000) {
        console.log(`[DB-AGGREGATOR] [CASH FLOW] [${account.accountId}] ${dateKey}: ${formatCurrency(-amountUSD)} (Withdrawal)`);
      }
    }
  }
  
  // SECOND PASS: GLOBAL TRANSFER SUPPRESSION for multi-portfolio mode
  // STRICT RULE: In Multi-Portfolio mode, IF a transaction is categorized as 'Internal Transfer',
  // THEN it must contribute exactly $0.00 to totalGroupCashFlow for that day
  // 
  // Reasoning: In a merged view, internal transfers are strictly neutral.
  // They move money within the system but never change the 'Net Contribution' of the ecosystem.
  //
  // Method: In multi-portfolio mode, calculate ONLY external cash flows (deposits/withdrawals)
  // and completely ignore internal transfers. This ensures internal transfers never appear in cash flows.
  
  if (isMultiplePortfolios) {
    // MULTI-PORTFOLIO MODE: STRICT CATEGORY FILTER
    // ONLY include transactions where category is explicitly 'Deposit' or 'Withdrawal'
    // IGNORE ALL TRANSFERS: If transaction is 'Internal Transfer', 'Transfer', or 'Position Transfer',
    // it must be treated as $0.00 for group-level TWR math, regardless of which accounts are selected
    //
    // Rationale: Moving money between internal accounts (even to accounts not currently selected)
    // does not represent a change in the 'Net Contribution' of the investment ecosystem.
    // It should never cause a performance spike or drop in the merged chart.
    
    console.log(`[DB-AGGREGATOR] [STRICT-CATEGORY-FILTER] Multi-portfolio mode: ONLY including explicit 'Deposit' and 'Withdrawal' transactions`);
    console.log(`[DB-AGGREGATOR] [STRICT-CATEGORY-FILTER] All transfers (Internal, Transfer, Position Transfer) will contribute $0.00 to group cash flows`);
    
    // Build cash flows map using ONLY Deposits and Withdrawals tables
    // These tables already contain ONLY external transactions (categorized during ingestion)
    // Completely ignore Transfers table - all transfers contribute $0.00
    const groupCashFlows = new Map<string, number>();
    
    for (const account of accounts) {
      // Get deposits for this account (category = 'deposit' only)
      // Deposits table already contains ONLY external deposits (no transfers)
      const deposits = await depositQueries.getByAccount(account.accountId) as Array<{
        amount: number;
        date: string;
        description: string;
        currency: string;
        fx_rate_to_base: number;
        transaction_id: string | null;
      }>;
      
      for (const deposit of deposits) {
        const dateKey = deposit.date;
        const amountUSD = deposit.amount * deposit.fx_rate_to_base;
        
        // Deposits table = explicit 'deposit' category only (no transfers)
        const existing = groupCashFlows.get(dateKey) || 0;
        groupCashFlows.set(dateKey, existing + amountUSD);
        
        if (Math.abs(amountUSD) > 10000) {
          console.log(`[DB-AGGREGATOR] [STRICT-CATEGORY-FILTER] [${account.accountId}] ${dateKey}: ${formatCurrency(amountUSD)} (Deposit)`);
        }
      }
      
      // Get withdrawals for this account (category = 'withdrawal' only)
      // Withdrawals table already contains ONLY external withdrawals (no transfers)
      const withdrawals = await withdrawalQueries.getByAccount(account.accountId) as Array<{
        amount: number;
        date: string;
        description: string;
        currency: string;
        fx_rate_to_base: number;
        transaction_id: string | null;
      }>;
      
      for (const withdrawal of withdrawals) {
        const dateKey = withdrawal.date;
        const amountUSD = withdrawal.amount * withdrawal.fx_rate_to_base;
        
        // Withdrawals table = explicit 'withdrawal' category only (no transfers)
        const existing = groupCashFlows.get(dateKey) || 0;
        groupCashFlows.set(dateKey, existing - amountUSD); // Negative for withdrawals
        
        if (Math.abs(amountUSD) > 10000) {
          console.log(`[DB-AGGREGATOR] [STRICT-CATEGORY-FILTER] [${account.accountId}] ${dateKey}: ${formatCurrency(-amountUSD)} (Withdrawal)`);
        }
      }
      
      // EXPLICITLY IGNORE ALL TRANSFERS
      // Check Transfers table to identify dates that should have $0.00 cash flow
      // (in case there are transfers on dates with no deposits/withdrawals)
      for (const transfer of account.transfers || []) {
        const transferType = (transfer.type || "").toLowerCase();
        
        // Ignore ALL transfer types: 'internal', 'transfer', 'position transfer'
        if (transferType === "internal" || transferType === "transfer" || transferType === "position transfer") {
          let transferDate: Date;
          if (transfer.date instanceof Date) {
            transferDate = transfer.date;
          } else if (typeof transfer.date === 'string') {
            transferDate = parseISO(transfer.date);
          } else {
            continue;
          }
          
          const dateKey = format(transferDate, 'yyyy-MM-dd');
          
          // If this date has NO deposits/withdrawals, ensure it's set to $0.00
          // (transfers contribute $0.00 to group cash flows)
          if (!groupCashFlows.has(dateKey)) {
            groupCashFlows.set(dateKey, 0);
            console.log(`[DB-AGGREGATOR] [STRICT-CATEGORY-FILTER] [${dateKey}] Transfer date (${transferType}) - forced to $0.00 (no deposits/withdrawals)`);
          } else {
            // Date has deposits/withdrawals - transfers still contribute $0.00 (already ignored)
            console.log(`[DB-AGGREGATOR] [STRICT-CATEGORY-FILTER] [${dateKey}] Transfer (${transferType}) ignored - using only deposits/withdrawals: ${formatCurrency(groupCashFlows.get(dateKey)!)}`);
          }
        }
      }
    }
    
    // Use group cash flows (only deposits/withdrawals, all transfers = $0.00)
    cashFlows = groupCashFlows;
    
    console.log(`[DB-AGGREGATOR] [STRICT-CATEGORY-FILTER] Multi-portfolio cash flows built: ${cashFlows.size} dates`);
    console.log(`[DB-AGGREGATOR] [STRICT-CATEGORY-FILTER] All transfers (Internal, Transfer, Position Transfer) contribute $0.00 to group-level TWR`);
  } else {
    // SINGLE PORTFOLIO MODE: Keep all flows as-is (internal transfers will be neutralized in TWR calculation)
    for (const [dateKey, totalFlow] of allCashFlowsIncludingInternal.entries()) {
      cashFlows.set(dateKey, totalFlow);
    }
  }
  
  // STRICT FILTERING: Ensure internal transfers are NEVER passed to calculateDailyReturn in multi-portfolio mode
  // In multi-portfolio mode, internal transfers should already be neutralized (zero-sum rule above)
  // In single portfolio mode, internal transfer dates will have 0% return (handled in calculateTWRMetrics)
  
  // Log summary of internal transfer dates for debugging
  console.log(`[DB-AGGREGATOR] [CASH FLOW] Total internal transfer dates identified: ${internalTransferDates.size}`);
  console.log(`[DB-AGGREGATOR] [CASH FLOW] Multi-portfolio mode: ${isMultiplePortfolios ? 'YES (internal transfers neutralized at group level)' : 'NO (internal transfers neutralized per portfolio)'}`);
  if (internalTransferDates.size > 0) {
    const sortedDates = Array.from(internalTransferDates).sort();
    console.log(`[DB-AGGREGATOR] [CASH FLOW] Internal transfer dates: ${sortedDates.slice(0, 10).join(', ')}${sortedDates.length > 10 ? ` ... and ${sortedDates.length - 10} more` : ''}`);
  }
  
  // Calculate TWR using Daily Geometric Linking
  // Formula: Return = (EndingNAV) / (PreviousNAV + TodayCashFlow) - 1
  // Treat all Deposits and Withdrawals as 'Beginning of Day' flows
  let twr = 0;
  let equityCurveWithTWR: EquityCurvePoint[] = [];
  
  if (equityCurve.length > 0) {
    // STRICT FILTERING: In multi-portfolio mode, ensure internal transfers are never passed to calculateDailyReturn
    // Filter cash flows to exclude internal transfer dates in multi-portfolio mode
    let filteredCashFlows: Map<string, number>;
    if (isMultiplePortfolios) {
      // Multi-portfolio mode: Only include external flows (internal transfers should be zeroed out)
      filteredCashFlows = new Map<string, number>();
      for (const [dateKey, flow] of cashFlows.entries()) {
        // Skip internal transfer dates completely in multi-portfolio mode
        // They should have already been neutralized by zero-sum rule, but double-check
        if (!internalTransferDates.has(dateKey)) {
          filteredCashFlows.set(dateKey, flow);
        } else {
          // Internal transfer date - ensure it's zero in multi-portfolio mode
          filteredCashFlows.set(dateKey, 0);
          console.log(`[DB-AGGREGATOR] [STRICT-FILTER] [${dateKey}] Internal transfer date - setting cash flow to 0 in multi-portfolio mode`);
        }
      }
    } else {
      // Single portfolio mode: Include all flows (internal transfers will be neutralized in TWR calculation)
      filteredCashFlows = cashFlows;
    }
    
    equityCurveWithTWR = calculateTWRMetrics(equityCurve, filteredCashFlows, internalTransferDates, internalTransferInfo);
    
    // Get TWR from the last point with valid data
    const lastPoint = equityCurveWithTWR[equityCurveWithTWR.length - 1];
    if (lastPoint && lastPoint.cumulativeReturn !== null && !isNaN(lastPoint.cumulativeReturn) && isFinite(lastPoint.cumulativeReturn)) {
      twr = lastPoint.cumulativeReturn;
    }
  }
  
  // Calculate net contributions using dedicated tables (prevents double-counting)
  // Formula: Deposits - Withdrawals + Internal Transfer(IN) - Internal Transfer(OUT)
  // Note: Starting capital is the first deposit, so it's already included in deposits
  // IMPORTANT: When multiple accounts are selected, neutralize inter-portfolio transfers
  // Reuse the queries already defined above for cash flows
  console.log(`[DB-AGGREGATOR] ===== NET CONTRIBUTIONS CALCULATION =====`);
  console.log(`[DB-AGGREGATOR] Processing ${accounts.length} account(s): [${accounts.map(a => a.accountId).join(', ')}]`);
  
  // isMultiplePortfolios is already defined above (line 1512)
  
  // Formula: Deposits - Withdrawals + Internal Transfer(IN) - Internal Transfer(OUT)
  // Internal transfers are included in both single and multi-portfolio mode
  
  let totalNetContributions = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let totalInternalOut = 0;
  let totalInternalIn = 0;
  
  // Process each account
  for (const account of accounts) {
    // Get deposits from Deposits table (EXTERNAL only - already categorized)
    const allDeposits = await depositQueries.getByAccount(account.accountId) as Array<{
      amount: number;
      date: string;
      description: string;
      currency: string;
      fx_rate_to_base: number;
      transaction_id: string | null;
    }>;
    
    // Deduplicate deposits
    const deposits = deduplicateDeposits(allDeposits, account.accountId);
    
    // Get withdrawals from Withdrawals table (EXTERNAL only - already categorized)
    const withdrawals = await withdrawalQueries.getByAccount(account.accountId) as Array<{
      amount: number;
      date: string;
      description: string;
      currency: string;
      fx_rate_to_base: number;
      transaction_id: string | null;
    }>;
    
    // CRITICAL: For CSV account, only include the inception deposit (Feb 8, 2024, $116,495)
    // CSV account is for NAV history, but the inception deposit is the starting capital for U16030763
    // IMPORTANT: Include CSV inception deposit whenever U16030763 is selected (single or multiple portfolio mode)
    if (account.accountId === CSV_VIRTUAL_ACCOUNT_ID) {
      // Check if U16030763 is selected (whether alone or with other portfolios)
      // Note: selectedAccountIds is the parameter passed to this function
      // It contains the explicitly selected accounts (e.g., U16030763, U15352922)
      // CSV account is auto-included by getAccountsFromDB, so we need to check the original selection
      const isU16030763Selected = selectedAccountIds && selectedAccountIds.has(XML_ACCOUNT_ID);
      
      console.log(`[DB-AGGREGATOR]   [${account.accountId}] CSV account processing: selectedAccountIds.size=${selectedAccountIds?.size || 0}, isU16030763Selected=${isU16030763Selected}`);
      
      if (!isU16030763Selected) {
        // U16030763 not selected - CSV account is only for NAV history, not net contributions
        console.log(`[DB-AGGREGATOR]   [${account.accountId}] Skipping CSV deposits/withdrawals (U16030763 not selected - CSV only used for NAV history)`);
        continue;
      }
      
      // U16030763 is selected - include the inception deposit from CSV account
      const inceptionDeposit = deposits.find(d => 
        d.date === '2024-02-08' && 
        Math.abs(d.amount - 116495) < 100 &&
        (d.description?.toLowerCase().includes('inception') || d.description?.toLowerCase().includes('initial'))
      );
      
      if (inceptionDeposit) {
        const amountUSD = inceptionDeposit.amount * inceptionDeposit.fx_rate_to_base;
        totalDeposits += amountUSD;
        totalNetContributions += amountUSD;
        const modeText = isMultiplePortfolios ? 'MULTIPLE PORTFOLIO MODE' : 'SINGLE PORTFOLIO MODE';
        console.log(`[DB-AGGREGATOR]   [${account.accountId}] Including inception deposit: ${formatCurrency(amountUSD)} on ${inceptionDeposit.date} (starting capital for U16030763 - ${modeText})`);
      } else {
        console.log(`[DB-AGGREGATOR]   [${account.accountId}] No inception deposit found in CSV account`);
      }
      // Skip other CSV deposits/withdrawals - only inception deposit counts
      continue;
    }
    
    // Process INTERNAL transfers from database
    let accountInternalOutTransfers = 0;
    let accountInternalInTransfers = 0;
    
    // Per-account totals
    let accountDeposits = 0;
    let accountWithdrawals = 0;
    
    // Process transfers from database for this account
    // Internal transfers are ALWAYS counted in Net Contributions (both single and multi-portfolio mode)
    // Formula: Deposits - Withdrawals + Internal Transfer(IN) - Internal Transfer(OUT)
    // DEDUPLICATION: Track processed transfers to avoid counting duplicates
    const processedTransfers = new Set<string>();
    
    for (const transfer of account.transfers || []) {
      const transferType = (transfer.type || "").toLowerCase();
      const transferDirection = (transfer.direction || "").toUpperCase();
      
      if (transferType === "internal") {
        const amountUSD = Math.abs(transfer.amount * transfer.fxRateToBase);
        const transferDateKey = format(transfer.date, 'yyyy-MM-dd');
        
        // Create a unique key for deduplication: account_id + transaction_id (if available) or account_id + type + direction + amount + date
        const transferKey = transfer.transactionID 
          ? `${account.accountId}_${transfer.transactionID}`
          : `${account.accountId}_${transferType}_${transferDirection}_${amountUSD.toFixed(2)}_${transferDateKey}`;
        
        // Skip if we've already processed this transfer
        if (processedTransfers.has(transferKey)) {
          console.log(`[DB-AGGREGATOR]   [${account.accountId}] Skipping duplicate INTERNAL ${transferDirection} Transfer: ${formatCurrency(amountUSD)} on ${transferDateKey} (transaction_id: ${transfer.transactionID || 'N/A'})`);
          continue;
        }
        
        processedTransfers.add(transferKey);
        
        // Count internal transfers in both single and multi-portfolio mode
        // INTERNAL OUT = withdrawal (money leaving), INTERNAL IN = deposit (money entering)
        if (transferDirection === "OUT") {
          accountInternalOutTransfers += amountUSD;
          console.log(`[DB-AGGREGATOR]   [${account.accountId}] INTERNAL OUT Transfer: ${formatCurrency(amountUSD)} on ${transferDateKey} (will subtract from contributions)`);
        } else if (transferDirection === "IN") {
          accountInternalInTransfers += amountUSD;
          console.log(`[DB-AGGREGATOR]   [${account.accountId}] INTERNAL IN Transfer: ${formatCurrency(amountUSD)} on ${transferDateKey} (will add to contributions)`);
        }
      }
    }
    
    // Sum deposits (all are EXTERNAL - already categorized, now deduplicated)
    console.log(`[DB-AGGREGATOR]   [${account.accountId}] Found ${deposits.length} deposit(s) after deduplication (${allDeposits.length} before deduplication)`);
    for (const deposit of deposits) {
      const amountUSD = deposit.amount * deposit.fx_rate_to_base;
      accountDeposits += amountUSD;
      console.log(`[DB-AGGREGATOR]   [${account.accountId}] Deposit: ${formatCurrency(amountUSD)} on ${deposit.date} - ${deposit.description || 'No description'} (from Deposits table)`);
    }
    
    // Deduplicate withdrawals (merge duplicate disbursements)
    const deduplicatedWithdrawals = deduplicateWithdrawals(withdrawals);
    if (deduplicatedWithdrawals.length < withdrawals.length) {
      console.log(`[DB-AGGREGATOR]   [${account.accountId}] Deduplicated ${withdrawals.length} withdrawals to ${deduplicatedWithdrawals.length} (removed ${withdrawals.length - deduplicatedWithdrawals.length} duplicates)`);
    }
    
    // Sum withdrawals (all are EXTERNAL - already categorized, now deduplicated)
    console.log(`[DB-AGGREGATOR]   [${account.accountId}] Found ${deduplicatedWithdrawals.length} withdrawal(s) after deduplication`);
    for (const withdrawal of deduplicatedWithdrawals) {
      const amountUSD = withdrawal.amount * withdrawal.fx_rate_to_base;
      accountWithdrawals += amountUSD;
      console.log(`[DB-AGGREGATOR]   [${account.accountId}] Withdrawal: ${formatCurrency(amountUSD)} on ${withdrawal.date} - ${withdrawal.description || 'No description'} (from Withdrawals table)`);
    }
    
    // Calculate net contributions for this account
    // Formula: Deposits - Withdrawals + Internal Transfer(IN) - Internal Transfer(OUT)
    // This formula applies to both single and multi-portfolio mode
    const accountNet = accountDeposits - accountWithdrawals + accountInternalInTransfers - accountInternalOutTransfers;
    totalNetContributions += accountNet;
    totalDeposits += accountDeposits;
    totalWithdrawals += accountWithdrawals;
    totalInternalOut += accountInternalOutTransfers;
    totalInternalIn += accountInternalInTransfers;
    
    console.log(`[DB-AGGREGATOR]   [${account.accountId}] Net Contributions Breakdown:`);
    console.log(`[DB-AGGREGATOR]     Deposits: ${formatCurrency(accountDeposits)} (${deposits.length} records)`);
    console.log(`[DB-AGGREGATOR]     Withdrawals: ${formatCurrency(accountWithdrawals)} (${withdrawals.length} records)`);
    console.log(`[DB-AGGREGATOR]     INTERNAL IN: ${formatCurrency(accountInternalInTransfers)}`);
    console.log(`[DB-AGGREGATOR]     INTERNAL OUT: ${formatCurrency(accountInternalOutTransfers)}`);
    if (accountInternalOutTransfers > 0 || accountInternalInTransfers > 0) {
      console.log(`[DB-AGGREGATOR]     Account Net: ${formatCurrency(accountNet)} = ${formatCurrency(accountDeposits)} - ${formatCurrency(accountWithdrawals)} + ${formatCurrency(accountInternalInTransfers)} - ${formatCurrency(accountInternalOutTransfers)}`);
    } else {
      console.log(`[DB-AGGREGATOR]     Account Net: ${formatCurrency(accountNet)} = ${formatCurrency(accountDeposits)} - ${formatCurrency(accountWithdrawals)}`);
    }
    
    // Store per-account net contributions in account object for UI display
    (account as any).netContributions = accountNet;
    (account as any).deposits = accountDeposits;
    (account as any).withdrawals = accountWithdrawals;
  }
  
  const totalDepositsIncludingStarting = totalDeposits; // Deposits already include starting capital
  
  // Recalculate totalNetContributions from aggregated totals to ensure formula accuracy
  // Formula: Deposits - Withdrawals + Internal Transfer(IN) - Internal Transfer(OUT)
  // This formula applies to both single and multi-portfolio mode
  totalNetContributions = totalDeposits - totalWithdrawals + totalInternalIn - totalInternalOut;
  
  console.log(`[DB-AGGREGATOR] ===== NET CONTRIBUTIONS SUMMARY =====`);
  console.log(`[DB-AGGREGATOR] Accounts processed: ${accounts.length} [${accounts.map(a => a.accountId).join(', ')}]`);
  console.log(`[DB-AGGREGATOR] Mode: ${isMultiplePortfolios ? 'MULTI-PORTFOLIO' : 'SINGLE-PORTFOLIO'}`);
  console.log(`[DB-AGGREGATOR] Total Deposits: ${formatCurrency(totalDeposits)}`);
  console.log(`[DB-AGGREGATOR] Total Withdrawals: ${formatCurrency(totalWithdrawals)}`);
  if (totalInternalOut > 0 || totalInternalIn > 0) {
    console.log(`[DB-AGGREGATOR] Internal Transfers IN: ${formatCurrency(totalInternalIn)}`);
    console.log(`[DB-AGGREGATOR] Internal Transfers OUT: ${formatCurrency(totalInternalOut)}`);
  }
  console.log(`[DB-AGGREGATOR] Total Net Contributions: ${formatCurrency(totalNetContributions)}`);
  if (totalInternalOut > 0 || totalInternalIn > 0) {
    console.log(`[DB-AGGREGATOR] Formula: Deposits - Withdrawals + Internal Transfer(IN) - Internal Transfer(OUT)`);
    console.log(`[DB-AGGREGATOR] Calculation: ${formatCurrency(totalDeposits)} - ${formatCurrency(totalWithdrawals)} + ${formatCurrency(totalInternalIn)} - ${formatCurrency(totalInternalOut)} = ${formatCurrency(totalNetContributions)}`);
  } else {
    console.log(`[DB-AGGREGATOR] Formula: Deposits - Withdrawals = ${formatCurrency(totalDeposits)} - ${formatCurrency(totalWithdrawals)} = ${formatCurrency(totalNetContributions)}`);
  }
  if (selectedAccountIds && selectedAccountIds.has(XML_ACCOUNT_ID) && selectedAccountIds.size === 1) {
    console.log(`[DB-AGGREGATOR] Expected (single portfolio): $116,495 (inception) - $430 (withdrawal) = $116,065`);
  }
  if (selectedAccountIds && selectedAccountIds.has(XML_ACCOUNT_ID) && isMultiplePortfolios) {
    console.log(`[DB-AGGREGATOR] Expected (multiple portfolios with U16030763): CSV inception deposit ($116,495) should be included in total deposits`);
  }
  
  const netDeposits = totalNetContributions;
  
  // Calculate profit/loss: Current NAV - Total Net Contributions
  // If netDeposits is 0 but we have NAV, that means the account has value but no recorded deposits
  // In that case, use the first NAV as the cost basis
  let totalProfitLoss = 0;
  if (netDeposits > 0) {
    totalProfitLoss = totalNAV - netDeposits;
  } else if (equityCurve.length > 0 && totalNAV > 0) {
    // Fallback: If no deposits recorded, treat first NAV as cost basis
    const firstNav = equityCurve[0].nav;
    if (firstNav > 0) {
      totalProfitLoss = totalNAV - firstNav;
    } else {
      // Find first non-zero NAV
      const firstNonZeroNav = equityCurve.find(p => p.nav > 0)?.nav || 0;
      if (firstNonZeroNav > 0) {
        totalProfitLoss = totalNAV - firstNonZeroNav;
      }
    }
  }
  
  console.log(`[DB-AGGREGATOR] ===== NET CONTRIBUTIONS CALCULATION =====`);
  console.log(`[DB-AGGREGATOR] Processing ${accounts.length} account(s): ${accounts.map(a => a.accountId).join(', ')}`);
  console.log(`[DB-AGGREGATOR] Total Deposits: ${formatCurrency(totalDeposits)}`);
  console.log(`[DB-AGGREGATOR] Total Withdrawals: ${formatCurrency(totalWithdrawals)}`);
  console.log(`[DB-AGGREGATOR] Total Net Contributions: ${formatCurrency(totalNetContributions)}`);
  console.log(`[DB-AGGREGATOR] Current NAV: ${formatCurrency(totalNAV)}`);
  console.log(`[DB-AGGREGATOR] Total Profit/Loss: ${formatCurrency(totalProfitLoss)}`);
  console.log(`[DB-AGGREGATOR] TWR: ${twr.toFixed(2)}%`);
  
  // Calculate daily change
  let dailyChange = 0;
  let dailyChangePercent = 0;
  if (equityCurveWithTWR.length >= 2) {
    const today = equityCurveWithTWR[equityCurveWithTWR.length - 1];
    const yesterday = equityCurveWithTWR[equityCurveWithTWR.length - 2];
    dailyChange = today.nav - yesterday.nav;
    dailyChangePercent = yesterday.nav > 0 ? (dailyChange / yesterday.nav) * 100 : 0;
  }
  
  // Calculate annualized yield using IBKR's formula
  // IBKR Annualized Formula: Annualized Yield = [(1 + Cumulative TWR)^(365 / Days Held) - 1] × 100
  // Where:
  //   - Cumulative TWR: Total performance as a decimal (e.g., 42.39% = 0.4239)
  //   - Days Held: Number of days between first inception date and current date
  //   - 365: Standard number of days in a year
  // 
  // IMPORTANT: For multi-portfolio views (Group Annualized Yield):
  // 1. Use the Aggregated TWR (already calculated by summing NAVs and cash flows across all accounts)
  // 2. Use the earliest inception date of ANY account in the selected group
  // 3. The Group Annualized Yield = [(1 + Group TWR)^(365 / Inception Days Held) - 1] × 100
  //    where Inception Days Held = days from earliest account inception to current date
  // 
  // This treats all accounts as one "virtual" account, so we cannot average individual yields.
  // We must use the aggregated TWR with the group's inception date.
  let annualizedYield = 0;
  let daysHeld = 0;
  
  if (equityCurveWithTWR.length > 0) {
    // Find the actual inception date (first non-zero NAV)
    // For multi-portfolio views: This is the earliest date when ANY portfolio in the group started
    // For single-portfolio views: This is when that specific portfolio started
    const firstNonZeroNavPoint = equityCurveWithTWR.find(p => p.nav > 0);
    const actualInceptionDate = firstNonZeroNavPoint ? firstNonZeroNavPoint.date : equityCurveWithTWR[0].date;
    const lastPointDate = equityCurveWithTWR[equityCurveWithTWR.length - 1].date;
    
    // Calculate days held: difference between earliest inception date and current date
    // For multi-portfolio groups: This is measured from the earliest inception date of any account
    // in the selected group to the current date (even if some accounts started later)
    daysHeld = Math.max(0, Math.floor((lastPointDate.getTime() - actualInceptionDate.getTime()) / (1000 * 60 * 60 * 24)));
    
    // Convert TWR from percentage to decimal (e.g., 42.39% → 0.4239)
    // For multi-portfolio: This is the Aggregated TWR (Group TWR) already calculated
    const totalTWR = twr / 100;
    
    // Check if we're in multi-portfolio mode for logging
    const actualSelectedAccounts = selectedAccountIds 
      ? new Set(Array.from(selectedAccountIds).filter(id => id !== 'HUNGARY_MIGRATION_HISTORY'))
      : null;
    const isMultiplePortfolios = actualSelectedAccounts && actualSelectedAccounts.size > 1;
    
    if (isMultiplePortfolios) {
      console.log(`[DB-AGGREGATOR] [ANNUALIZED YIELD] Group (Multi-Portfolio) calculation:`);
      console.log(`[DB-AGGREGATOR]   Selected Account IDs: [${Array.from(actualSelectedAccounts).join(', ')}]`);
      console.log(`[DB-AGGREGATOR]   Group TWR (Aggregated): ${twr.toFixed(2)}%`);
      console.log(`[DB-AGGREGATOR]   Inception Date (Earliest): ${format(actualInceptionDate, 'yyyy-MM-dd')}`);
      console.log(`[DB-AGGREGATOR]   Current Date: ${format(lastPointDate, 'yyyy-MM-dd')}`);
      console.log(`[DB-AGGREGATOR]   Inception Days Held: ${daysHeld} days (${(daysHeld / 365).toFixed(2)} years)`);
    }
    
    // Apply IBKR formula: Group Annualized Yield = [(1 + Group TWR)^(365 / Inception Days Held) - 1] × 100
    if (daysHeld > 0 && totalTWR !== -1 && isFinite(totalTWR)) {
      annualizedYield = (Math.pow(1 + totalTWR, 365 / daysHeld) - 1) * 100;
      // Ensure result is valid
      if (!isFinite(annualizedYield)) {
        annualizedYield = 0;
      }
      
      if (isMultiplePortfolios) {
        console.log(`[DB-AGGREGATOR]   Group Annualized Yield: ${annualizedYield.toFixed(2)}%`);
      }
    } else {
      if (isMultiplePortfolios) {
        console.warn(`[DB-AGGREGATOR]   ⚠️ Cannot calculate group annualized yield: daysHeld=${daysHeld}, totalTWR=${totalTWR}`);
      }
    }
  }
  
  // Aggregate fees and income from dedicated tables
  
  let totalDividends = 0;
  let totalInterest = 0;
  let totalCommissions = 0;
  let totalWithholdingTax = 0;
  let totalOtherFees = 0;
  
  // Track dividends by symbol for breakdown
  const dividendsBySymbol = new Map<string, number>();
  
  for (const account of accounts) {
    // Get dividends (including symbol for breakdown)
    const allDividends = await dividendQueries.getByAccount(account.accountId) as Array<{
      amount: number;
      date: string;
      description: string | null;
      symbol: string | null;
      currency: string;
      fx_rate_to_base: number;
      transaction_id: string | null;
    }>;
    
    // Deduplicate dividends (handles EQQU/EQQQ as same ticker, same amount + date = duplicate)
    const dividends = deduplicateDividends(allDividends, account.accountId);
    
    for (const div of dividends) {
      const amountUSD = div.amount * div.fx_rate_to_base;
      totalDividends += amountUSD;
      
      // Track by normalized symbol for breakdown (if symbol exists)
      // EQQU and EQQQ will be grouped together
      if (div.symbol && amountUSD > 0) {
        const normalizedSym = normalizeSymbol(div.symbol);
        const current = dividendsBySymbol.get(normalizedSym) || 0;
        dividendsBySymbol.set(normalizedSym, current + amountUSD);
      }
    }
    
    // Get interest
    const allInterest = await interestQueries.getByAccount(account.accountId) as Array<{
      amount: number;
      date: string;
      description: string | null;
      currency: string;
      fx_rate_to_base: number;
      transaction_id: string | null;
    }>;
    
    // Deduplicate interest
    const interest = deduplicateInterest(allInterest, account.accountId);
    
    for (const int of interest) {
      totalInterest += int.amount * int.fx_rate_to_base;
    }
    
    // Get fees (commissions and other fees)
    const allFees = await feeQueries.getByAccount(account.accountId) as Array<{
      amount: number;
      date: string;
      description: string | null;
      fee_type: string | null;
      currency: string;
      fx_rate_to_base: number;
      transaction_id: string | null;
    }>;
    
    // Deduplicate fees
    const fees = deduplicateFees(allFees, account.accountId);
    
    for (const fee of fees) {
      const feeAmount = fee.amount * fee.fx_rate_to_base;
      if (fee.fee_type === 'commission') {
        totalCommissions += feeAmount;
      } else {
        totalOtherFees += feeAmount;
      }
    }
    
    // Get taxes (withholding tax and other taxes)
    const allTaxes = await taxQueries.getByAccount(account.accountId) as Array<{
      amount: number;
      date: string;
      description: string | null;
      tax_type: string | null;
      currency: string;
      fx_rate_to_base: number;
      transaction_id: string | null;
    }>;
    
    // Deduplicate taxes
    const taxes = deduplicateTaxes(allTaxes, account.accountId);
    
    for (const tax of taxes) {
      const taxAmount = tax.amount * tax.fx_rate_to_base;
      if (tax.tax_type === 'withholding') {
        totalWithholdingTax += taxAmount;
      } else {
        totalOtherFees += taxAmount; // Other taxes go to other fees
      }
    }
  }
  
  // Calculate Gross Profit (Total Income: Dividends + Interest)
  const grossProfit = totalDividends + totalInterest;
  
  // Calculate Net Profit (Gross Profit - Expenses: Commissions - Withholding Tax - Other Fees)
  const netProfit = grossProfit - totalCommissions - totalWithholdingTax - totalOtherFees;
  
  const feesAndIncome: FeesAndIncome = {
    totalDividends,
    totalInterest,
    totalCommissions,
    totalWithholdingTax,
    totalOtherFees,
    totalCredits: 0, // Not tracked separately yet
    grossProfit,
    netProfit,
  };
  
  // Convert dividendsBySymbol Map to object for JSON serialization
  const dividendsBySymbolObj: Record<string, number> = {};
  for (const [symbol, amount] of dividendsBySymbol.entries()) {
    dividendsBySymbolObj[symbol] = amount;
  }
  
  console.log(`[DB-AGGREGATOR] Aggregation complete: TWR=${twr.toFixed(2)}%, NAV=${formatCurrency(totalNAV)}`);
  console.log(`[DB-AGGREGATOR] Dividends by symbol: ${Object.keys(dividendsBySymbolObj).length} symbol(s), Total: ${formatCurrency(totalDividends)}`);
  if (Object.keys(dividendsBySymbolObj).length > 0) {
    const topSymbols = Object.entries(dividendsBySymbolObj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([symbol, amount]) => `${symbol}: ${formatCurrency(amount)}`)
      .join(', ');
    console.log(`[DB-AGGREGATOR] Top dividend symbols: ${topSymbols}`);
  }
  
  return {
    accounts,
    totalNAV,
      combinedPositions: await combinePositionsFromDB(accounts),
    equityCurve: equityCurveWithTWR,
    twr,
    totalProfitLoss,
    netDeposits,
    dailyChange,
    dailyChangePercent,
    totalDeposits: totalDepositsIncludingStarting, // Include starting capital in deposits for UI display
    totalWithdrawals,
    totalInternalOut, // Internal transfers OUT (subtracted from contributions)
    totalInternalIn, // Internal transfers IN (added to contributions)
    feesAndIncome,
    dividendsBySymbol: dividendsBySymbolObj, // Dividends grouped by symbol for breakdown
    annualizedYield,
    daysHeld,
  };
}

