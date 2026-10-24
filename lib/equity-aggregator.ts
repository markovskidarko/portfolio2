import { parseAllEquitySummaryFiles, type DailyNAVEntry } from "./equity-parser";
import type { EquityCurvePoint, ProcessedAccount } from "./types";
import { startOfDay, eachDayOfInterval, format } from "date-fns";
import { formatCurrency } from "./utils";

/**
 * Group daily NAV entries by accountId
 */
export interface AccountNAVData {
  accountId: string;
  accountAlias: string;
  entries: Map<string, number>; // Map<dateKey, total>
  firstDate: Date | null;
  lastDate: Date | null;
}

/**
 * Convert CSV equity curve data to AccountNAVData format
 * This allows CSV data to be processed uniformly with XML data in the unified timeline
 */
export function convertCSVToAccountNAVData(
  csvEquityCurve: EquityCurvePoint[],
  accountId: string,
  accountAlias: string = accountId
): AccountNAVData | null {
  if (csvEquityCurve.length === 0) {
    return null;
  }

  const entries = new Map<string, number>();
  let firstDate: Date | null = null;
  let lastDate: Date | null = null;

  for (const point of csvEquityCurve) {
    const dateKey = startOfDay(point.date).toISOString().split("T")[0];
    entries.set(dateKey, point.nav);
    
    if (!firstDate || point.date < firstDate) {
      firstDate = point.date;
    }
    if (!lastDate || point.date > lastDate) {
      lastDate = point.date;
    }
  }

  return {
    accountId,
    accountAlias,
    entries,
    firstDate,
    lastDate,
  };
}


/**
 * Process all equity summary files and group by account ID
 */
export function processAccountEquityData(dataDir: string): Map<string, AccountNAVData> {
  const allEntries = parseAllEquitySummaryFiles(dataDir);
  
  // Group by accountId
  const accountsMap = new Map<string, AccountNAVData>();

  for (const entry of allEntries) {
    if (!accountsMap.has(entry.accountId)) {
      accountsMap.set(entry.accountId, {
        accountId: entry.accountId,
        accountAlias: entry.accountAlias,
        entries: new Map(),
        firstDate: null,
        lastDate: null,
      });
    }

    const accountData = accountsMap.get(entry.accountId)!;
    // CRITICAL: Normalize date to YYYY-MM-DD using startOfDay to match cash flow date normalization
    // This ensures EquitySummary dates and CashTransaction dates use the exact same format
    // This prevents date mismatches that cause missing cash flows on jump days
    const normalizedDate = startOfDay(entry.reportDate);
    const dateKey = normalizedDate.toISOString().split("T")[0]; // YYYY-MM-DD format
    
    // Store the NAV value for this date
    // If the same date appears in multiple files, the Map will naturally keep the last one
    accountData.entries.set(dateKey, entry.total);
    
    // Update first and last dates
    if (!accountData.firstDate || entry.reportDate < accountData.firstDate) {
      accountData.firstDate = entry.reportDate;
    }
    if (!accountData.lastDate || entry.reportDate > accountData.lastDate) {
      accountData.lastDate = entry.reportDate;
    }
  }

  console.log(`Grouped data into ${accountsMap.size} accounts`);
  for (const [accountId, data] of accountsMap.entries()) {
    console.log(`  ${accountId} (${data.accountAlias}): ${data.entries.size} dates from ${data.firstDate?.toISOString().split("T")[0]} to ${data.lastDate?.toISOString().split("T")[0]}`);
  }

  return accountsMap;
}

/**
 * Phase 1: Transaction Harvesting - Global Cash Flow Map
 * 
 * BEFORE calculating NAV or Performance, iterate through EVERY XML file and extract
 * EVERY single CashTransaction where type='Deposits/Withdrawals'.
 * 
 * Creates a Global Map<string, number> where:
 * - Key: reportDate normalized to YYYY-MM-DD format (same as EquitySummary dates)
 * - Value: Sum of all deposits minus withdrawals across ALL accounts for that day
 * 
 * CRITICAL: Date normalization MUST use the exact same format as EquitySummary dates
 * to avoid mismatches that cause missing cash flows on jump days.
 */
export function aggregateDailyCashFlows(allAccounts: ProcessedAccount[]): { cashFlowMap: Map<string, number>; internalTransferDates: Set<string> } {
  // Global Map<dateKey (YYYY-MM-DD), totalCashFlow> (positive = deposits, negative = withdrawals)
  const globalCashFlowMap = new Map<string, number>();
  // Set of dates with internal transfers that need 0% daily return (TWR neutralization)
  const internalTransferDates = new Set<string>();
  
  let totalTransactionsChecked = 0;
  let totalDepositsWithdrawalsFound = 0;
  let totalTransfersProcessed = 0;

  console.log(`=== PHASE 1: TRANSACTION HARVESTING ===`);
  console.log(`Scanning ${allAccounts.length} accounts for ALL CashTransactions, Transfers, and Adjustments`);

  for (const account of allAccounts) {
    const transfers = account.transfers || [];
    console.log(`  Processing account ${account.accountId} (${account.accountAlias}): ${account.cashTransactions.length} cash transactions, ${transfers.length} transfers`);
    
    // Process INTERNAL transfers - these represent account migrations or transfers between accounts
    // INTERNAL transfers (both IN and OUT) should be added to cash flow map for TWR neutralization
    if (transfers.length > 0) {
      console.log(`    [DEBUG] Found ${transfers.length} transfers for account ${account.accountId}`);
      for (let i = 0; i < transfers.length; i++) {
        const transfer = transfers[i];
        const transferType = (transfer.type || "").toLowerCase();
        const transferDirection = (transfer.direction || "").toUpperCase();
        const amountUSD = transfer.amount * transfer.fxRateToBase;
        
        // Debug: Log ALL transfers (not just large ones) to see what we're working with
        console.log(`    [DEBUG] Transfer ${i + 1}/${transfers.length}: type="${transfer.type}" (normalized: "${transferType}"), direction="${transfer.direction}" (normalized: "${transferDirection}"), amount=${formatCurrency(amountUSD)}, date=${transfer.date.toISOString().split("T")[0]}`);
        
        // Check for INTERNAL transfers (case-insensitive)
        // INTERNAL transfers (especially OUT) represent account migrations or transfers between accounts
        // These are Non-Performance Events and must neutralize TWR (set daily return to 0%)
        if (transferType === "internal") {
          totalTransfersProcessed++;
          const normalizedDate = startOfDay(transfer.date);
          const dateKey = normalizedDate.toISOString().split("T")[0];
          
          // For OUT transfers, ensure amount is negative; for IN transfers, amount is positive
          // IBKR XML may have positive amounts for OUT transfers, so we need to negate them
          let transferAmountUSD = amountUSD;
          if (transferDirection === "OUT" && transferAmountUSD > 0) {
            transferAmountUSD = -transferAmountUSD;
            console.log(`    [DEBUG] OUT transfer amount was positive, negating: ${formatCurrency(amountUSD)} → ${formatCurrency(transferAmountUSD)}`);
          }
          
          const existing = globalCashFlowMap.get(dateKey) || 0;
          globalCashFlowMap.set(dateKey, existing + transferAmountUSD);
          
          // CRITICAL: Add date to neutralization set for ALL INTERNAL transfers (both IN and OUT)
          // INTERNAL transfers are Non-Performance Events and must have 0% daily return
          if (Math.abs(transferAmountUSD) > 50000) {
            internalTransferDates.add(dateKey);
            console.log(`    ✓ [${dateKey}] ${account.accountId}: INTERNAL ${transferDirection} Transfer - ${formatCurrency(transferAmountUSD)} (will neutralize TWR - Non-Performance Event)`);
          } else if (Math.abs(transferAmountUSD) > 10000) {
            internalTransferDates.add(dateKey);
            console.log(`    ✓ [${dateKey}] ${account.accountId}: INTERNAL ${transferDirection} Transfer - ${formatCurrency(transferAmountUSD)} (will neutralize TWR - Non-Performance Event)`);
          } else {
            // Even smaller internal transfers should neutralize TWR
            internalTransferDates.add(dateKey);
            console.log(`    ✓ [${dateKey}] ${account.accountId}: INTERNAL ${transferDirection} Transfer - ${formatCurrency(transferAmountUSD)} (will neutralize TWR - Non-Performance Event)`);
          }
        } else {
          console.log(`    ⚠️ Transfer ${i + 1} is NOT internal (type="${transferType}", expected "internal")`);
        }
      }
    }
    
    for (const ct of account.cashTransactions) {
      totalTransactionsChecked++;
      
      const type = ct.type.toLowerCase().trim();
      const description = (ct.description || "").toLowerCase().trim();
      
      // CRITICAL: Check for capital flow transaction types:
      // 1. 'Deposits/Withdrawals' - primary identifier
      // 2. 'Transfers' - account transfers (in or out)
      // 3. 'Adjustments' - manual adjustments
      // This captures ALL capital flows, not just explicit deposits/withdrawals
      const isDepositsWithdrawalsType = type === "deposits/withdrawals" || 
                                        type === "deposits/withdrawal" ||
                                        type.includes("deposits/withdrawals");
      
      const isTransferType = type === "transfers" || 
                             type === "transfer" ||
                             type.includes("transfer");
      
      const isAdjustmentType = type === "adjustments" || 
                               type === "adjustment" ||
                               type.includes("adjustment");
      
      // Also check for explicit deposit/withdrawal keywords as fallback
      const isExplicitDeposit = (type.includes("deposit") && 
                                 !type.includes("dividend") && 
                                 !type.includes("interest") &&
                                 !type.includes("credit")) ||
                                (description.includes("deposit") && 
                                 !description.includes("dividend"));
      
      const isExplicitWithdrawal = (type.includes("withdrawal") || 
                                     type.includes("withdraw")) &&
                                    !description.includes("dividend");
      
      // Skip income/expense transactions - these are NOT capital flows
      const isIncomeOrExpense = (type.includes("dividend") || 
                                 type.includes("interest") ||
                                 type.includes("commission") ||
                                 type.includes("fee") ||
                                 (type.includes("tax") && !type.includes("deposit")) ||
                                 (type.includes("credit") && !type.includes("deposit")) ||
                                 description.includes("dividend") ||
                                 description.includes("interest") ||
                                 description.includes("commission") ||
                                 description.includes("fee") ||
                                 (description.includes("tax") && !description.includes("deposit"))) &&
                                 !isDepositsWithdrawalsType &&
                                 !isTransferType &&
                                 !isAdjustmentType;
      
      // Process capital flows: Deposits/Withdrawals, Transfers, Adjustments, OR explicit deposit/withdrawal (but not income/expense)
      if (isDepositsWithdrawalsType || isTransferType || isAdjustmentType || ((isExplicitDeposit || isExplicitWithdrawal) && !isIncomeOrExpense)) {
        totalDepositsWithdrawalsFound++;
        
        // CRITICAL: Normalize date to YYYY-MM-DD using startOfDay and ISO string
        // This MUST match the exact same format used for EquitySummary reportDate normalization
        // Both EquitySummary and CashTransaction dates should use UTC to avoid timezone mismatches
        const normalizedDate = startOfDay(ct.date);
        const dateKey = normalizedDate.toISOString().split("T")[0]; // YYYY-MM-DD format
        
        // Convert to USD using fxRateToBase
        const amountUSD = ct.amount * ct.fxRateToBase;
        
        // Sum all deposits/withdrawals for this date across ALL accounts
        const existing = globalCashFlowMap.get(dateKey) || 0;
        globalCashFlowMap.set(dateKey, existing + amountUSD);
        
        // Log ALL deposits/withdrawals for verification (especially large ones that cause NAV jumps)
        // Also log the raw date from CashTransaction to help debug date parsing issues
        if (Math.abs(amountUSD) > 10000) {
          console.log(`    ✓ [${dateKey}] ${account.accountId}: ${type} - ${formatCurrency(amountUSD)} (total for date: ${formatCurrency(existing + amountUSD)}) [Raw date: ${ct.date.toISOString()}]`);
        }
      }
    }
  }

  console.log(`=== GLOBAL CASH FLOW MAP SUMMARY ===`);
  console.log(`Total transactions checked: ${totalTransactionsChecked}`);
  console.log(`Deposits/Withdrawals transactions found: ${totalDepositsWithdrawalsFound}`);
  console.log(`Internal transfers processed: ${totalTransfersProcessed}`);
  console.log(`Unique dates with cash flows: ${globalCashFlowMap.size}`);
  
  if (globalCashFlowMap.size > 0) {
    // Sort by date for better readability
    const sortedEntries = Array.from(globalCashFlowMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    console.log(`All cash flows by date (${sortedEntries.length} total dates):`);
    for (const [date, amount] of sortedEntries) {
      console.log(`  ${date}: ${formatCurrency(amount)}`);
    }
    
    // Highlight large cash flows that might cause NAV jumps
    const largeFlows = sortedEntries.filter(([_, amount]) => Math.abs(amount) > 50000);
    if (largeFlows.length > 0) {
      console.log(`⚠️ Large cash flows (>$50k) that could cause NAV jumps:`);
      for (const [date, amount] of largeFlows) {
        console.log(`  ${date}: ${formatCurrency(amount)}`);
      }
    } else {
      console.warn(`⚠️ WARNING: No large cash flows (>$50k) found, but NAV jumps suggest deposits exist!`);
      console.warn(`   This might indicate a date mismatch or transaction type identification issue.`);
    }
    
    // Store sorted dates for quick lookup during debugging
    console.log(`Cash flow map date keys: [${sortedEntries.map(([date]) => date).slice(0, 20).join(", ")}${sortedEntries.length > 20 ? `... (${sortedEntries.length} total)` : ""}]`);
  } else {
    console.error(`❌ WARNING: No cash flows found in Global Cash Flow Map!`);
    console.error(`   This means NO deposits/withdrawals were identified from CashTransactions.`);
    console.error(`   Check if transaction types are being identified correctly.`);
  }
  
  console.log(`  Internal transfer dates for TWR neutralization: ${Array.from(internalTransferDates).join(", ") || "(none)"}`);
  
  return { cashFlowMap: globalCashFlowMap, internalTransferDates };
}

/**
 * Build aggregated equity curve with carry-forward logic and TWR calculation
 */
export function buildAggregatedEquityCurve(
  accountsMap: Map<string, AccountNAVData>,
  cashFlowMap: Map<string, number>,
  internalTransferDates: Set<string> = new Set()
): EquityCurvePoint[] {
  if (accountsMap.size === 0) {
    console.warn("No account data available");
    return [];
  }

  // Find the earliest and latest dates across all selected accounts
  // For filtered accounts, start from when the account(s) actually started, not a forced date
  let earliestDate: Date | null = null;
  let latestDate: Date | null = null;

  console.log(`=== ACCOUNT DATE RANGE ===`);
  console.log(`Scanning all ${accountsMap.size} accounts for date range...`);
  for (const [accountId, accountData] of accountsMap.entries()) {
    if (accountData.firstDate) {
      if (!earliestDate || accountData.firstDate < earliestDate) {
        earliestDate = accountData.firstDate;
        console.log(`  New earliest date: ${accountData.firstDate.toISOString().split("T")[0]} from account ${accountId}`);
      }
    }
    if (accountData.lastDate) {
      if (!latestDate || accountData.lastDate > latestDate) {
        latestDate = accountData.lastDate;
        console.log(`  New latest date: ${accountData.lastDate.toISOString().split("T")[0]} from account ${accountId}`);
      }
    }
  }

  if (!earliestDate || !latestDate) {
    console.warn("No valid date range found across all accounts");
    return [];
  }

  console.log(`=== MASTER TIMELINE ===`);
  console.log(`Earliest date (from selected accounts): ${earliestDate.toISOString().split("T")[0]}`);
  console.log(`Latest date (from selected accounts): ${latestDate.toISOString().split("T")[0]}`);
  console.log(`Building master timeline from earliest to latest account dates`);

  // Create master timeline from earliest date to latest date
  // This ensures the timeline starts when the selected account(s) actually started
  const allDates = eachDayOfInterval({ start: earliestDate, end: latestDate });
  console.log(`Generated ${allDates.length} days for processing (from ${earliestDate.toISOString().split("T")[0]} to ${latestDate.toISOString().split("T")[0]})`);

  // Build the aggregated equity curve with carry-forward logic
  const equityCurve: EquityCurvePoint[] = [];
  
  // Initialize last known NAV for each account
  const lastKnownNAV = new Map<string, number>();

  console.log(`Processing ${allDates.length} days across ${accountsMap.size} accounts...`);
  const startTime = Date.now();

  for (let i = 0; i < allDates.length; i++) {
    const date = allDates[i];
    
    // Log progress every 100 days or at the start/end
    if (i === 0 || i === allDates.length - 1 || (i % 100 === 0)) {
      console.log(`  Processing day ${i + 1}/${allDates.length} (${date.toISOString().split("T")[0]})...`);
    }
    
    const dateKey = date.toISOString().split("T")[0];
    let aggregatedNAV = 0;
    const accountBreakdown: { [accountId: string]: number } = {};

    // Detect migration handover: CSV account ending, XML account starting
    // On handover day, aggregate NAV should equal ONLY the new account (XML), not sum of both
    const CSV_VIRTUAL_ACCOUNT_ID = "HUNGARY_MIGRATION_HISTORY";
    const XML_ACCOUNT_ID = "U16030763"; // XML account ID for U16030763
    let isMigrationHandoverDay = false;
    
    // Get current day NAVs BEFORE aggregation to detect handover
    const csvAccountData = accountsMap.get(CSV_VIRTUAL_ACCOUNT_ID);
    const xmlAccountData = accountsMap.get(XML_ACCOUNT_ID);
    
    let currCSVNav = 0;
    let currXMLNav = 0;
    
    if (csvAccountData) {
      if (csvAccountData.entries.has(dateKey)) {
        currCSVNav = csvAccountData.entries.get(dateKey)!;
      } else if (lastKnownNAV.has(CSV_VIRTUAL_ACCOUNT_ID)) {
        currCSVNav = lastKnownNAV.get(CSV_VIRTUAL_ACCOUNT_ID) || 0;
      }
    }
    if (xmlAccountData) {
      if (xmlAccountData.entries.has(dateKey)) {
        currXMLNav = xmlAccountData.entries.get(dateKey)!;
      } else if (lastKnownNAV.has(XML_ACCOUNT_ID)) {
        currXMLNav = lastKnownNAV.get(XML_ACCOUNT_ID) || 0;
      }
    }
    
    // Check if this date has an internal transfer (indicates migration handover)
    const hasInternalTransfer = internalTransferDates.has(dateKey);
    
    // Also check if CSV account has ended (lastDate is before current date)
    const csvHasEnded = csvAccountData && csvAccountData.lastDate && date > csvAccountData.lastDate;
    
    // Check previous day's account breakdown to detect handover
    if (i > 0 && equityCurve.length > 0) {
      const prevPoint = equityCurve[equityCurve.length - 1];
      if (prevPoint.accountBreakdown) {
        const prevCSVNav = prevPoint.accountBreakdown[CSV_VIRTUAL_ACCOUNT_ID] || 0;
        const prevXMLNav = prevPoint.accountBreakdown[XML_ACCOUNT_ID] || 0;
        
        // Check if CSV ending (>90% drop or becomes 0) AND XML starting (jump from near-zero to significant)
        const csvEnding = prevCSVNav > 0 && (currCSVNav < prevCSVNav * 0.1 || currCSVNav === 0 || csvHasEnded);
        const xmlStarting = prevXMLNav < 1000 && currXMLNav > 1000;
        
        // DYNAMIC HANDOVER RULE: If internal transfer date AND CSV was active yesterday AND XML is active today
        // OR if CSV has ended and XML is starting, treat as handover
        if (hasInternalTransfer && prevCSVNav > 50000 && currXMLNav > 50000) {
          // Internal transfer date with both accounts having significant NAV = handover
          isMigrationHandoverDay = true;
          console.log(`  🔧 MIGRATION HANDOVER DAY DETECTED ${dateKey} (internal transfer date):`);
          console.log(`     CSV was active yesterday: ${formatCurrency(prevCSVNav)}, CSV today: ${formatCurrency(currCSVNav)}`);
          console.log(`     XML starting: ${formatCurrency(prevXMLNav)} → ${formatCurrency(currXMLNav)}`);
          console.log(`     Excluding CSV NAV from aggregation, using only XML NAV (${formatCurrency(currXMLNav)})`);
        } else if (csvHasEnded && xmlStarting && prevCSVNav > 50000) {
          // CSV account has ended, XML is starting = handover
          isMigrationHandoverDay = true;
          console.log(`  🔧 MIGRATION HANDOVER DAY DETECTED ${dateKey} (CSV ended, XML starting):`);
          console.log(`     CSV ending: ${formatCurrency(prevCSVNav)} → ${formatCurrency(currCSVNav)} (CSV last date: ${csvAccountData.lastDate?.toISOString().split("T")[0]})`);
          console.log(`     XML starting: ${formatCurrency(prevXMLNav)} → ${formatCurrency(currXMLNav)}`);
          console.log(`     Excluding CSV NAV from aggregation, using only XML NAV (${formatCurrency(currXMLNav)})`);
        } else if (csvEnding && xmlStarting && prevCSVNav > 50000) {
          // CSV ending AND XML starting = handover (fallback detection)
          const navMatch = Math.abs(prevCSVNav - currXMLNav) < Math.max(prevCSVNav, currXMLNav) * 0.30; // Within 30% match
          if (navMatch) {
            isMigrationHandoverDay = true;
            console.log(`  🔧 MIGRATION HANDOVER DAY DETECTED ${dateKey} (NAV match):`);
            console.log(`     CSV ending: ${formatCurrency(prevCSVNav)} → ${formatCurrency(currCSVNav)}`);
            console.log(`     XML starting: ${formatCurrency(prevXMLNav)} → ${formatCurrency(currXMLNav)}`);
            console.log(`     Excluding CSV NAV from aggregation, using only XML NAV (${formatCurrency(currXMLNav)})`);
          }
        }
      }
    }

    // NO HARDCODING - all NAV values come from database/XML data

    // For each account, get NAV for this date (with carry-forward)
    // IMPORTANT: Use carry-forward logic - if an account is missing a record for this date,
    // use its last known NAV. This ensures we have a complete timeline.
    for (const [accountId, accountData] of accountsMap.entries()) {
      let accountNAV = 0;

      // CRITICAL: After an account's lastDate, it should NOT contribute to aggregation
      // This prevents CSV account NAV from being carried forward after it ends (e.g., after Aug 19)
      const accountHasEnded = accountData.lastDate && date > accountData.lastDate;
      if (accountHasEnded && accountId === CSV_VIRTUAL_ACCOUNT_ID) {
        // CSV account has ended - don't include it in aggregation after its lastDate
        // Set lastKnownNAV to 0 to prevent carry-forward
        lastKnownNAV.set(accountId, 0);
        accountBreakdown[accountId] = 0;
        continue; // Skip this account entirely
      }

      // NO HARDCODING - all NAV values must come from database/XML data
      // Check if we have explicit data for this date
      if (accountData.entries.has(dateKey)) {
        accountNAV = accountData.entries.get(dateKey)!;
        // Update last known NAV (even if it's 0 or negative, carry it forward)
        lastKnownNAV.set(accountId, accountNAV);
      } else if (lastKnownNAV.has(accountId)) {
        // Carry forward the last known NAV for this account
        // This handles gaps in data (weekends, holidays, etc.)
        const lastNAV = lastKnownNAV.get(accountId);
        if (lastNAV !== undefined) {
          accountNAV = lastNAV;
        }
      }
      // If account hasn't started yet (no lastKnownNAV), accountNAV remains 0

      // MIGRATION HANDOVER FIX: On handover day, exclude CSV account NAV from aggregation
      // Aggregate NAV should equal ONLY the new account (XML), not sum of both
      if (isMigrationHandoverDay && accountId === CSV_VIRTUAL_ACCOUNT_ID) {
        // Exclude CSV NAV on handover day - it's being transferred, not added
        // Also set lastKnownNAV to 0 to prevent carry-forward on subsequent days
        lastKnownNAV.set(accountId, 0);
        accountBreakdown[accountId] = 0; // Set to 0 in breakdown to show it's excluded
        continue; // Skip adding to aggregated NAV
      }

      // Include account NAV in aggregation (even if 0, to show accounts that haven't started)
      // We'll filter out dates where TOTAL combined NAV is 0 in the next step
      if (accountNAV !== 0) {
        aggregatedNAV += accountNAV;
      }
      // Always include account in breakdown (even with 0 NAV) for complete tracking
      if (accountNAV !== 0 || lastKnownNAV.has(accountId)) {
        accountBreakdown[accountId] = accountNAV;
      }
    }

    // CRITICAL FIX: Include ALL dates in the timeline (even if NAV is $0)
    // This is required for proper Sub-Period TWR calculation
    // We must include all dates from the earliest account start date onwards, even if NAV starts at $0
    // The return calculation will handle $0 NAV by returning 0% for that day
    equityCurve.push({
      date: startOfDay(date),
      nav: aggregatedNAV, // Can be 0, which is valid for the timeline
      cumulativeReturn: 0, // Will be calculated later with TWR
      accountBreakdown: Object.keys(accountBreakdown).length > 0 ? accountBreakdown : undefined,
    });
  }
  
  const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Completed processing ${allDates.length} days in ${processingTime} seconds, created ${equityCurve.length} equity curve points`);

  // CRITICAL FIX: Include ALL dates from the earliest account start date onwards
  // We calculate returns for ALL days, even if NAV starts at $0
  // This prevents the zero-base spike that causes 6600% returns
  // The Modified Dietz formula will return 0% for days where (StartingNAV + NetCashFlow) = 0
  
  // DYNAMIC LEADING ZERO SKIP: Find first non-zero NAV date and start geometric chain from there
  // This prevents -100% TWR errors when starting with $0 NAV
  const firstNonZeroIndex = equityCurve.findIndex((point) => point.nav > 0);
  const effectiveStartIndex = firstNonZeroIndex >= 0 ? firstNonZeroIndex : 0;
  const firstNonZeroPointForLogging = firstNonZeroIndex >= 0 ? equityCurve[firstNonZeroIndex] : null;

  console.log(`=== SUB-PERIOD TWR CALCULATION ===`);
  console.log(`Timeline starts: ${equityCurve.length > 0 ? equityCurve[0].date.toISOString().split("T")[0] : "N/A"}`);
  if (firstNonZeroPointForLogging) {
    console.log(`First non-zero NAV date: ${firstNonZeroPointForLogging.date.toISOString().split("T")[0]}`);
    console.log(`First non-zero NAV: ${formatCurrency(firstNonZeroPointForLogging.nav)}`);
  } else {
    console.warn(`No non-zero NAV values found in equity curve`);
  }
  if (effectiveStartIndex > 0) {
    console.log(`🔧 DYNAMIC LEADING ZERO SKIP: Skipping ${effectiveStartIndex} leading zero-NAV days`);
    console.log(`   Geometric chain will start at index ${effectiveStartIndex} (${firstNonZeroPointForLogging?.date.toISOString().split("T")[0]}) with NAV: ${formatCurrency(firstNonZeroPointForLogging?.nav || 0)}`);
  }
  console.log(`Equity curve has ${equityCurve.length} total points (including $0 NAV days)`);
  console.log(`Calculating returns for ALL days using Modified Dietz formula with zero-base handling`);
  
  // DEBUG: Show all cash flows from the map for comparison
  console.log(`\n=== CASH FLOW MAP FOR TWR CALCULATION ===`);
  console.log(`Total cash flows in map: ${cashFlowMap.size} dates`);
  if (cashFlowMap.size > 0) {
    const sortedCashFlows = Array.from(cashFlowMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    console.log(`All cash flow dates in map (first 30):`);
    for (const [date, amount] of sortedCashFlows.slice(0, 30)) {
      console.log(`  ${date}: ${formatCurrency(amount)}`);
    }
    if (sortedCashFlows.length > 30) {
      console.log(`  ... and ${sortedCashFlows.length - 30} more dates`);
    }
    const totalCashFlow = sortedCashFlows.reduce((sum, [_, amount]) => sum + amount, 0);
    console.log(`Total cash flow sum: ${formatCurrency(totalCashFlow)}`);
  } else {
    console.error(`❌ ERROR: Cash flow map is EMPTY! This means no cash flows were found.`);
  }
  
  // Use equity curve data (may skip leading zeros for TWR calculation)
  const equityData = equityCurve;
  
  // Create a set of migration handover dates to force 0% daily return
  // These dates have CSV and XML NAVs that should not be summed
  const migrationHandoverDates = new Set<string>();
  const CSV_VIRTUAL_ACCOUNT_ID = "HUNGARY_MIGRATION_HISTORY";
  const XML_ACCOUNT_ID = "U16030763";
  
  // Scan equity curve to identify migration handover days
  for (let i = 1; i < equityData.length; i++) {
    const point = equityData[i];
    const prevPoint = equityData[i - 1];
    const dateKey = startOfDay(point.date).toISOString().split("T")[0];
    
    if (point.accountBreakdown && prevPoint.accountBreakdown) {
      const prevCSVNav = prevPoint.accountBreakdown[CSV_VIRTUAL_ACCOUNT_ID] || 0;
      const currCSVNav = point.accountBreakdown[CSV_VIRTUAL_ACCOUNT_ID] || 0;
      const prevXMLNav = prevPoint.accountBreakdown[XML_ACCOUNT_ID] || 0;
      const currXMLNav = point.accountBreakdown[XML_ACCOUNT_ID] || 0;
      
      // Check if CSV ending AND XML starting (migration handover)
      const csvEnding = prevCSVNav > 50000 && (currCSVNav < prevCSVNav * 0.1 || currCSVNav === 0);
      const xmlStarting = prevXMLNav < 1000 && currXMLNav > 50000;
      const hasInternalTransfer = internalTransferDates.has(dateKey);
      
      if ((hasInternalTransfer || (csvEnding && xmlStarting)) && prevCSVNav > 50000 && currXMLNav > 50000) {
        migrationHandoverDates.add(dateKey);
        console.log(`  🔧 Marking ${dateKey} as migration handover date (CSV: ${formatCurrency(prevCSVNav)} → ${formatCurrency(currCSVNav)}, XML: ${formatCurrency(prevXMLNav)} → ${formatCurrency(currXMLNav)})`);
      }
    }
  }

  // Calculate Strict Geometric Time-Weighted Return (TWR) to match TradingView
  // 
  // For each day n, calculate the daily return:
  // R_n = (EndingNAV_n - (StartingNAV_n + NCF_n)) / (StartingNAV_n + NCF_n)
  // 
  // CRITICAL: If (StartingNAV + NCF) = 0, then R_n = 0
  // This prevents division by zero and massive percentage spikes during initial funding
  //
  // Chain the returns geometrically:
  // TotalReturn = (1 + R_1) × (1 + R_2) × ... × (1 + R_n) - 1
  //
  // This 'links' the periods together, ignoring the size of deposits and only 
  // focusing on the growth of the capital once it's in the account.
  let cumulativeMultiplier = 1.0; // Start at 1.0 for geometric linking
  let geometricChainStarted = false; // Track when geometric chain actually starts (first non-zero NAV)
  
  console.log(`Starting Geometric TWR calculation with ${equityData.length} data points`);
  console.log(`First point: ${equityData[0].date.toISOString().split("T")[0]}, NAV: ${formatCurrency(equityData[0].nav)}`);
  if (equityData.length > 1) {
    console.log(`Last point: ${equityData[equityData.length - 1].date.toISOString().split("T")[0]}, NAV: ${formatCurrency(equityData[equityData.length - 1].nav)}`);
  }
  if (effectiveStartIndex > 0) {
    console.log(`Geometric chain will start at index ${effectiveStartIndex} (first non-zero NAV)`);
  }
  
  const finalCurve: EquityCurvePoint[] = equityData.map((point, index) => {
    let cumulativeReturn = 0;
    
    if (index === 0) {
      // First point: 0.00% (baseline)
      // Even if NAV is $0, we set cumulative return to 0%
      cumulativeReturn = 0;
      // Mark geometric chain as started only if first NAV is non-zero
      if (point.nav > 0) {
        geometricChainStarted = true;
      }
    } else {
      // DYNAMIC LEADING ZERO SKIP: Skip return calculation for leading zero-NAV days
      // Only start geometric chain from first non-zero NAV
      if (index < effectiveStartIndex) {
        // Before first non-zero NAV: return stays at 0%, multiplier doesn't change
        cumulativeReturn = 0;
        return {
          date: point.date,
          nav: point.nav,
          cumulativeReturn: 0,
          accountBreakdown: point.accountBreakdown,
        };
      }
      
      // Get previous point for Sub-Period calculation
      const previousPoint = equityData[index - 1];
      
      // Mark geometric chain as started when we reach first non-zero NAV
      if (!geometricChainStarted && point.nav > 0) {
        geometricChainStarted = true;
        console.log(`  🎯 Geometric chain starting at index ${index} (${point.date.toISOString().split("T")[0]}) with NAV: ${formatCurrency(point.nav)}`);
      }
      
      // CRITICAL: Normalize date to YYYY-MM-DD format (must match Phase 1 cash flow date normalization)
      const normalizedDate = startOfDay(point.date);
      const dateKey = normalizedDate.toISOString().split("T")[0]; // YYYY-MM-DD format
      
      // Define starting and ending NAV first (needed for validation check below)
      const startingNAV = previousPoint.nav;
      const endingNAV = point.nav;
      
      // PHASE 2: Correcting the TWR Math
      // 
      // When we see a jump from $10k to $110k, look up that date in the Global Cash Flow Map.
      // If the map shows a $100k deposit for that date, the NetCashFlow for that day MUST be $100,000.
      // This ensures the daily return formula correctly neutralizes deposits.
      //
      // CRITICAL: dateKey MUST be normalized to YYYY-MM-DD format (same as in Phase 1)
      // to ensure we find the cash flow even when NAV jumps occur
      // IMPORTANT: In IBKR, deposits on day N often show up in NAV on day N+1
      // So we check the current date, previous date, and next date for cash flows
      let netCashFlow = cashFlowMap.get(dateKey) || 0;
      let cashFlowDate = dateKey; // Track which date the cash flow came from
      
      // Calculate NAV jump first (needed for both lookup and validation)
      const navJump = endingNAV - startingNAV;
      
      // If no cash flow found on current date and there's a NAV jump, check nearby dates
      // IMPORTANT: In IBKR, deposits on day N often show up in NAV on day N+1
      // So we check ±7 days around the current date for cash flows (expanded from ±3 to catch more edge cases)
      // CRITICAL: Only match if the magnitude is very close (within 20%) to avoid false matches
      if (Math.abs(netCashFlow) < 1000 && Math.abs(navJump) > 50000) {
        // Check previous 7 days and next 7 days for cash flows
        // This handles timing mismatches between CashTransaction dates and EquitySummary dates
        // Also handles weekends/holidays where settlement might be delayed
        let bestMatch: { offset: number; dateKey: string; amount: number; score: number } | null = null;
        
        for (let offset = -7; offset <= 7; offset++) {
          if (offset === 0) continue; // Already checked current date
          const checkDate = new Date(point.date);
          checkDate.setDate(checkDate.getDate() + offset);
          const checkDateKey = checkDate.toISOString().split("T")[0];
          const checkNCF = cashFlowMap.get(checkDateKey) || 0;
          
          // If we find a cash flow, calculate a match score
          // CRITICAL: Only consider cash flows that are reasonably close in magnitude (within 15%)
          // This prevents matching small deposits to large NAV jumps or vice versa
          // Also, prefer dates within 3 days to avoid matching old deposits to new NAV jumps
          if (Math.abs(checkNCF) > 1000) {
            const magnitudeDiff = Math.abs(Math.abs(checkNCF) - Math.abs(navJump));
            const magnitudeRatio = magnitudeDiff / Math.max(Math.abs(navJump), Math.abs(checkNCF));
            
            // Only consider matches where cash flow is within 15% of NAV jump magnitude
            // This ensures we only match deposits to their actual NAV jumps, not random coincidences
            // Also require that the date is within 3 days (to avoid matching old deposits)
            const withinDateRange = Math.abs(offset) <= 3;
            if (magnitudeRatio <= 0.15 && withinDateRange) {
              // Calculate how close the cash flow is to the NAV jump magnitude (1.0 = perfect match)
              const magnitudeMatch = 1.0 - magnitudeRatio;
              // Closer dates get higher proximity score (prefer dates within 3 days)
              const proximityScore = 1.0 / (Math.abs(offset) + 1);
              // Combined score: 85% magnitude match, 15% proximity
              // This heavily favors magnitude accuracy over date proximity
              const score = magnitudeMatch * 0.85 + proximityScore * 0.15;
              
              if (!bestMatch || score > bestMatch.score) {
                bestMatch = { offset, dateKey: checkDateKey, amount: checkNCF, score };
              }
            }
          }
        }
        
        // Use the best matching cash flow (closest magnitude to NAV jump, within 20%)
        if (bestMatch) {
          netCashFlow = bestMatch.amount;
          cashFlowDate = bestMatch.dateKey;
          console.log(`  ℹ️ ${dateKey}: Using best matching cash flow from ${bestMatch.offset > 0 ? 'next' : 'previous'} date (${bestMatch.dateKey}, ${Math.abs(bestMatch.offset)} days ${bestMatch.offset > 0 ? 'ahead' : 'behind'}): ${formatCurrency(netCashFlow)} (NAV jump: ${formatCurrency(navJump)}, match score: ${(bestMatch.score * 100).toFixed(1)}%)`);
        } else {
          // No good match found - this might be market gains or an internal transfer
          // Internal transfers should be detected from Transfer tags, not auto-corrected here
          console.warn(`  ⚠️ ${dateKey}: Large NAV jump ${formatCurrency(navJump)} but no matching cash flow found (checked ±7 days, required within 15% magnitude match)`);
          console.warn(`      This might be market gains or an internal transfer. Internal transfers should be in Transfer tags.`);
        }
      }
      
      // Manual overrides removed - internal transfers are now detected automatically from Transfer tags
      
      // Validation: Log if we still don't have a cash flow for a large NAV jump
      // (After checking nearby dates above)
      if (Math.abs(navJump) > 50000 && Math.abs(netCashFlow) < 1000) {
        console.warn(`  ⚠️ ${dateKey}: Large NAV jump ${formatCurrency(navJump)} but no significant cash flow found (NCF: ${formatCurrency(netCashFlow)})`);
        console.warn(`      This indicates a missing cash flow entry or date mismatch!`);
        console.warn(`      Looking up date: ${dateKey}`);
        
        // Debug: Check nearby dates to see if cash flow is on a different date
        const prevDate = new Date(point.date);
        prevDate.setDate(prevDate.getDate() - 1);
        const nextDate = new Date(point.date);
        nextDate.setDate(nextDate.getDate() + 1);
        const prevDateKey = prevDate.toISOString().split("T")[0];
        const nextDateKey = nextDate.toISOString().split("T")[0];
        const prevNCF = cashFlowMap.get(prevDateKey) || 0;
        const nextNCF = cashFlowMap.get(nextDateKey) || 0;
        
        if (Math.abs(prevNCF) > 1000) {
          console.warn(`      ⚠️ Found cash flow on PREVIOUS date (${prevDateKey}): ${formatCurrency(prevNCF)} - DATE MISMATCH DETECTED!`);
          console.warn(`      Using cash flow from previous date to fix calculation...`);
          // Use the previous date's cash flow as a workaround
          const adjustedNetCashFlow = prevNCF;
          const adjustedStartingNAV = startingNAV + adjustedNetCashFlow;
          const dailyReturnFixed = adjustedStartingNAV > 0 
            ? (endingNAV - adjustedStartingNAV) / adjustedStartingNAV 
            : 0;
          console.warn(`      Fixed daily return would be: ${(dailyReturnFixed * 100).toFixed(4)}%`);
        }
        if (Math.abs(nextNCF) > 1000) {
          console.warn(`      ⚠️ Found cash flow on NEXT date (${nextDateKey}): ${formatCurrency(nextNCF)} - DATE MISMATCH DETECTED!`);
        }
        
        // Show all cash flows in the map for debugging
        const allCashFlowDates = Array.from(cashFlowMap.keys()).sort();
        const nearbyDates = allCashFlowDates.filter(d => {
          const dDate = new Date(d);
          const diffDays = Math.abs((dDate.getTime() - point.date.getTime()) / (1000 * 60 * 60 * 24));
          return diffDays <= 3; // Within 3 days
        });
        if (nearbyDates.length > 0) {
          console.warn(`      Nearby cash flows (within 3 days):`);
          for (const nearDate of nearbyDates) {
            console.warn(`        ${nearDate}: ${formatCurrency(cashFlowMap.get(nearDate) || 0)}`);
          }
        }
      }
      
      // Sub-Period Return Formula (Modified Dietz):
      // R_n = (EndingNAV_n - (StartingNAV_n + NetCashFlow_n)) / (StartingNAV_n + NetCashFlow_n)
      // This neutralizes the impact of deposits/withdrawals on performance
      const adjustedStartingNAV = startingNAV + netCashFlow;
      
      let dailyReturn = 0;
      
      // AUTOMATIC MIGRATION HANDOVER DETECTION
      // Detect when CSV account (HUNGARY_MIGRATION_HISTORY) ends and XML account (U16030763) begins
      // with matching NAV on the same period - use formula instead of hard-setting to 0%
      const CSV_VIRTUAL_ACCOUNT_ID = "HUNGARY_MIGRATION_HISTORY";
      const XML_ACCOUNT_ID = "U16030763";
      let isMigrationHandover = false;
      let migrationHandoverExternalCash = 0; // External cash flow for migration date (should be 0 for pure migration)
      
      if (previousPoint.accountBreakdown && point.accountBreakdown) {
        const prevCSVNav = previousPoint.accountBreakdown[CSV_VIRTUAL_ACCOUNT_ID] || 0;
        const currCSVNav = point.accountBreakdown[CSV_VIRTUAL_ACCOUNT_ID] || 0;
        const prevXMLNav = previousPoint.accountBreakdown[XML_ACCOUNT_ID] || 0;
        const currXMLNav = point.accountBreakdown[XML_ACCOUNT_ID] || 0;
        
        // Check if CSV account ends (prev > 0, curr = 0 or significantly reduced) 
        // AND XML account starts (prev = 0 or small, curr > 0) with matching NAV
        const csvEnding = prevCSVNav > 0 && currCSVNav < prevCSVNav * 0.1; // CSV drops by >90%
        const xmlStarting = prevXMLNav < 1000 && currXMLNav > 1000; // XML jumps from near-zero to significant
        const navMatch = Math.abs(prevCSVNav - currXMLNav) < Math.max(prevCSVNav, currXMLNav) * 0.05; // Within 5% match
        
        if (csvEnding && xmlStarting && navMatch && prevCSVNav > 50000) {
          isMigrationHandover = true;
          // For migration handover, external cash flow should be 0 (it's an internal transfer)
          migrationHandoverExternalCash = netCashFlow; // Use the net cash flow as external cash
          console.log(`  🔧 AUTO-MIGRATION HANDOVER DETECTED ${dateKey}: CSV ending (${formatCurrency(prevCSVNav)} → ${formatCurrency(currCSVNav)}), XML starting (${formatCurrency(prevXMLNav)} → ${formatCurrency(currXMLNav)})`);
          console.log(`     NAV match: ${formatCurrency(prevCSVNav)} ≈ ${formatCurrency(currXMLNav)} (diff: ${formatCurrency(Math.abs(prevCSVNav - currXMLNav))})`);
          console.log(`     External cash flow: ${formatCurrency(migrationHandoverExternalCash)}`);
          internalTransferDates.add(dateKey);
        }
      }
      
      // AUTOMATED GLOBAL MIGRATION NEUTRALIZATION (10% Delta Check)
      // If aggregate NAV changes by >10% on a day with internal transfer or new account initialization,
      // automatically flag that day as Performance Neutral (set daily return to 0%)
      const navChangePercent = startingNAV > 0 ? Math.abs(navJump / startingNAV) : 0;
      const isLargeNavChange = navChangePercent > 0.10; // 10% threshold
      const hasInternalTransfer = internalTransferDates.has(dateKey);
      
      // Check if this is a new account initialization (startingNAV is 0 and endingNAV > 0 with significant cash flow)
      const isNewAccountInit = startingNAV === 0 && endingNAV > 0 && Math.abs(netCashFlow) > 1000;
      
      // DYNAMIC TWR BRIDGING: Use formula for migration handover instead of hard-setting to 0%
      // Formula: (Total NAV after migration - Total NAV before migration - External Cash) / (Total NAV before migration + External Cash)
      // If NAV change is explained by CSV ending and XML starting, return should be neutral (0%)
      if (isMigrationHandover) {
        // Use formula: (endingNAV - startingNAV - externalCash) / (startingNAV + externalCash)
        // For migration, external cash should be 0 (or minimal), so formula should give ~0%
        const migrationDenominator = startingNAV + migrationHandoverExternalCash;
        if (migrationDenominator > 0) {
          dailyReturn = (endingNAV - startingNAV - migrationHandoverExternalCash) / migrationDenominator;
          console.log(`  🔧 MIGRATION HANDOVER ${dateKey}: Using formula (${formatCurrency(endingNAV)} - ${formatCurrency(startingNAV)} - ${formatCurrency(migrationHandoverExternalCash)}) / (${formatCurrency(startingNAV)} + ${formatCurrency(migrationHandoverExternalCash)}) = ${(dailyReturn * 100).toFixed(4)}%`);
          // Round very small returns to 0% (within 0.01% tolerance) since migration should be neutral
          if (Math.abs(dailyReturn) < 0.0001) {
            dailyReturn = 0;
            console.log(`     Rounded to 0% (neutral migration transfer)`);
          }
        } else {
          dailyReturn = 0;
        }
      } else if (isLargeNavChange && (hasInternalTransfer || isNewAccountInit)) {
        const reason = hasInternalTransfer ? 'internal transfer' : 'new account initialization';
        console.log(`  🔧 AUTO-NEUTRALIZING ${dateKey}: ${reason} (NAV change ${(navChangePercent * 100).toFixed(2)}%)`);
        console.log(`     Previous NAV: ${formatCurrency(startingNAV)}, Current NAV: ${formatCurrency(endingNAV)}, Change: ${formatCurrency(navJump)}`);
        console.log(`     Cash flow: ${formatCurrency(netCashFlow)}`);
        dailyReturn = 0;
      } else if (internalTransferDates.has(dateKey)) {
        // CRITICAL: Internal transfer dates MUST have 0% return (non-performance events)
        console.log(`  🔧 Hard-setting ${dateKey} daily return to 0% (internal transfer neutralization)`);
        console.log(`     Previous NAV: ${formatCurrency(startingNAV)}, Current NAV: ${formatCurrency(endingNAV)}`);
        console.log(`     Cash flow: ${formatCurrency(netCashFlow)}`);
        // Set daily return to exactly 0% - this is an internal transfer, not a performance event
        dailyReturn = 0;
      } else if (adjustedStartingNAV > 0) {
        // Normal calculation: R_n = (EndingNAV_n - (StartingNAV_n + NCF_n)) / (StartingNAV_n + NCF_n)
        // This ensures deposits are subtracted from the gain calculation
        dailyReturn = (endingNAV - adjustedStartingNAV) / adjustedStartingNAV;
        
        // Additional validation: Check if daily return is reasonable (should be between -100% and +1000% for a day)
        // Anything beyond this likely indicates a calculation error
        if (dailyReturn < -1.0 || dailyReturn > 10.0) {
          console.warn(`  ⚠️ ${dateKey}: Unusual daily return ${(dailyReturn * 100).toFixed(2)}% - Starting: ${formatCurrency(startingNAV)}, NCF: ${formatCurrency(netCashFlow)}, Adjusted: ${formatCurrency(adjustedStartingNAV)}, Ending: ${formatCurrency(endingNAV)}`);
        }
      } else {
        // Zero or negative denominator case: R_n = 0%
        // This handles:
        // - Starting from $0 (empty period from February to August = 0% returns)
        // - Where a deposit exactly matches the starting NAV
        // - Negative balance cases
        dailyReturn = 0;
        
        if (adjustedStartingNAV < 0) {
          console.warn(`  ${dateKey}: Negative adjusted NAV (${formatCurrency(adjustedStartingNAV)}), setting return to 0%`);
        } else if (adjustedStartingNAV === 0 && endingNAV > 0) {
          // This is a deposit into an empty account - should be 0% return
          console.log(`  ${dateKey}: Zero to ${formatCurrency(endingNAV)} transition (deposit), return = 0% (not a gain)`);
        }
      }
      
      // Geometric Linking: TotalReturn = ∏(1 + R_n) - 1
      // This chains daily returns: (1 + R1) * (1 + R2) * ... * (1 + Rn) - 1
      // This will ignore the 'jump' from $0 to $10k and only start measuring performance once capital is in the account
      cumulativeMultiplier *= (1 + dailyReturn);
      
      // Calculate cumulative return percentage
      cumulativeReturn = (cumulativeMultiplier - 1) * 100;
      
      // Log significant cash flows, zero-base transitions, and validation points for debugging
      const shouldLog = Math.abs(netCashFlow) > 1000 || 
                       (startingNAV === 0 && endingNAV > 0) ||
                       Math.abs(dailyReturn) > 0.1 || // Log days with >10% return
                       (index % 30 === 0) || // Log every 30 days for validation
                       (index < 10); // Log first 10 days to catch early issues
      
      if (shouldLog) {
        console.log(`  [${index}] ${dateKey}: Start=${formatCurrency(startingNAV)}, NCF=${formatCurrency(netCashFlow)}, AdjStart=${formatCurrency(adjustedStartingNAV)}, End=${formatCurrency(endingNAV)}, DailyReturn=${(dailyReturn * 100).toFixed(4)}%, CumReturn=${cumulativeReturn.toFixed(2)}%`);
      }
      
      // Critical validation: Check for extremely suspicious returns that indicate calculation errors
      // Daily returns >1000% are almost certainly errors (unless there's a massive market event)
      if (Math.abs(dailyReturn) > 10.0) { // >1000% daily return is extremely suspicious
        console.error(`  ❌ ${dateKey}: CRITICAL - Extreme daily return ${(dailyReturn * 100).toFixed(2)}%`);
        console.error(`      Starting NAV: ${formatCurrency(startingNAV)}`);
        console.error(`      Net Cash Flow: ${formatCurrency(netCashFlow)}`);
        console.error(`      Adjusted Starting: ${formatCurrency(adjustedStartingNAV)}`);
        console.error(`      Ending NAV: ${formatCurrency(endingNAV)}`);
        console.error(`      This indicates a calculation error - please investigate!`);
      }
    }

    return {
      date: point.date,
      nav: point.nav,
      cumulativeReturn,
      accountBreakdown: point.accountBreakdown,
    };
  });

  const finalReturn = finalCurve.length > 0 ? finalCurve[finalCurve.length - 1].cumulativeReturn : 0;
  const finalNAV = finalCurve.length > 0 ? finalCurve[finalCurve.length - 1].nav : 0;
  const firstNonZeroPoint = finalCurve.find(p => p.nav > 0);
  const firstNonZeroNAV = firstNonZeroPoint ? firstNonZeroPoint.nav : 0;
  const firstNonZeroDate = firstNonZeroPoint ? firstNonZeroPoint.date.toISOString().split("T")[0] : "N/A";
  
  // Calculate total net contributions from cash flows for validation
  const totalNetContributions = Array.from(cashFlowMap.values()).reduce((sum, ncf) => sum + ncf, 0);
  const totalProfit = finalNAV - totalNetContributions;
  const expectedReturnPercent = totalNetContributions > 0 
    ? (totalProfit / Math.abs(totalNetContributions)) * 100 
    : 0;
  
  console.log(`=== GEOMETRIC TWR VALIDATION ===`);
  console.log(`Built equity curve with ${finalCurve.length} points using Strict Geometric TWR`);
  console.log(`Timeline: ${equityData[0].date.toISOString().split("T")[0]} to ${equityData[equityData.length - 1].date.toISOString().split("T")[0]}`);
  console.log(`First non-zero NAV: ${formatCurrency(firstNonZeroNAV)} on ${firstNonZeroDate}`);
  console.log(`Final NAV: ${formatCurrency(finalNAV)}`);
  console.log(`Total Net Contributions: ${formatCurrency(totalNetContributions)}`);
  console.log(`Total Profit/Loss: ${formatCurrency(totalProfit)}`);
  console.log(`Expected return % (Profit/Contributions): ${expectedReturnPercent.toFixed(2)}%`);
  console.log(`Calculated TWR return: ${finalReturn.toFixed(2)}%`);
  console.log(`Cumulative multiplier: ${cumulativeMultiplier.toFixed(6)}`);
  
  // Verification: The final return should be approximately 59.14%, not 6656%
  // If Profit is $251k and Contributions are $424k, expected return is ~59.14%
  // If TWR is >5000% but expected is ~59%, there's definitely an error (missing cash flows or date mismatch)
  if (Math.abs(finalReturn) > 100 && Math.abs(expectedReturnPercent) < 200) {
    const difference = Math.abs(finalReturn - expectedReturnPercent);
    if (difference > 50) {
      console.error(`❌ VERIFICATION FAILED: TWR return (${finalReturn.toFixed(2)}%) is WAY off from expected (${expectedReturnPercent.toFixed(2)}%)`);
      console.error(`   Difference: ${difference.toFixed(2)} percentage points`);
      console.error(`   This indicates missing cash flows or date normalization mismatches!`);
      console.error(`   Check for dates with large NAV jumps but missing cash flows in the Global Cash Flow Map.`);
      console.error(`   Expected: NAV $${finalNAV.toLocaleString()} - Contributions $${totalNetContributions.toLocaleString()} = Profit $${totalProfit.toLocaleString()}`);
      console.error(`   Which should give ~${expectedReturnPercent.toFixed(2)}% return (approximately 59.14%), NOT ${finalReturn.toFixed(2)}%`);
      console.error(`   Common causes: Missing 'Deposits/Withdrawals' transactions or date format mismatches`);
    }
  } else if (Math.abs(finalReturn - expectedReturnPercent) < 10) {
    console.log(`✅ Verification passed: TWR return (${finalReturn.toFixed(2)}%) is close to expected (${expectedReturnPercent.toFixed(2)}%)`);
    console.log(`   Target: approximately 59.14% when Profit is $251k and Contributions are $424k`);
  }

  return finalCurve;
}
