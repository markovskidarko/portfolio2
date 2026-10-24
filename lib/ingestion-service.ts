/**
 * Permanent Data Ingestion Engine
 * Scans XML files and CSV, ingests into SQLite database with UPSERT logic
 * Includes August 20-26 correction for U16030763 during ingestion only
 */
import { getDatabase, navQueries, accountQueries, transactionQueries, transferQueries, depositQueries, withdrawalQueries, dividendQueries, interestQueries, feeQueries, taxQueries, holdingQueries, tradeQueries, changeInNAVQueries, cashQueries } from './database';
import { categorizeTransaction, deduplicateWithdrawals } from './transaction-categorizer';
import { parseAllIBKRFiles } from './parser';
import { parsePortfolioHistoryCSV, processCSVEntries } from './csv-parser';
import { parseAllEquitySummaryFiles } from './equity-parser';
import { existsSync } from 'fs';
import { join } from 'path';
import { format, parseISO } from 'date-fns';
import { formatCurrency } from './utils';

const U16030763_ACCOUNT_ID = "U16030763";
const CSV_VIRTUAL_ACCOUNT_ID = "HUNGARY_MIGRATION_HISTORY";
const CSV_FILE_NAME = "portfolio_history_feb_aug.csv";

function getProtectedHoldingsAccounts(): Set<string> {
  const raw = process.env.PROTECT_HOLDINGS_ACCOUNTS || '';
  return new Set(
    raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

function getProtectedCashAccounts(): Set<string> {
  const raw = process.env.PROTECT_CASH_ACCOUNTS || '';
  return new Set(
    raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

/**
 * August 20-26, 2024 override values for U16030763 (migration bridge)
 * These are ONLY applied during ingestion - database becomes source of truth
 */
const AUGUST_OVERRIDE_NAVS: { [date: string]: number } = {
  "2024-08-20": 133920.00,
  "2024-08-21": 134181.00,
  "2024-08-22": 133761.00,
  "2024-08-23": 133900.00,
  "2024-08-24": 133900.00,
  "2024-08-25": 133900.00,
  "2024-08-26": 133688.00,
};

/**
 * Check if date is in August 20-26, 2024 range
 */
function isAugustOverrideDate(dateStr: string): boolean {
  return AUGUST_OVERRIDE_NAVS.hasOwnProperty(dateStr);
}

/**
 * Get August override NAV value if applicable
 */
function getAugustOverrideNAV(dateStr: string, accountId: string): number | null {
  if (accountId === U16030763_ACCOUNT_ID && isAugustOverrideDate(dateStr)) {
    return AUGUST_OVERRIDE_NAVS[dateStr];
  }
  return null;
}

/**
 * Ingest XML files from data directory
 */
export async function ingestXMLFiles(dataDir: string): Promise<{
  accountsIngested: number;
  navRecordsIngested: number;
  transactionsIngested: number;
  transfersIngested: number;
}> {
  console.log(`[INGESTION] Starting XML file ingestion from: ${dataDir}`);
  
  if (!existsSync(dataDir)) {
    console.warn(`[INGESTION] Directory does not exist: ${dataDir}`);
    return { accountsIngested: 0, navRecordsIngested: 0, transactionsIngested: 0, transfersIngested: 0 };
  }
  
  const db = getDatabase();
  // Query helpers — all are now async functions from the postgres-based database module
  const upsertAccount = accountQueries.upsert.bind(accountQueries);
  const upsertNav = navQueries.upsert.bind(navQueries);
  const insertTransaction = transactionQueries.insert.bind(transactionQueries);
  const insertTransfer = transferQueries.insert.bind(transferQueries);
  const insertDeposit = depositQueries.insert.bind(depositQueries);
  const insertWithdrawal = withdrawalQueries.insert.bind(withdrawalQueries);
  const insertDividend = dividendQueries.insert.bind(dividendQueries);
  const insertInterest = interestQueries.insert.bind(interestQueries);
  const insertFee = feeQueries.insert.bind(feeQueries);
  const insertTax = taxQueries.insert.bind(taxQueries);
  const upsertHolding = holdingQueries.upsert.bind(holdingQueries);
  const insertTrade = tradeQueries.insert.bind(tradeQueries);
  const upsertChangeInNAV = changeInNAVQueries.upsert.bind(changeInNAVQueries);
  const upsertCash = cashQueries.upsert.bind(cashQueries);
  
  // Parse all XML files
  const accounts = parseAllIBKRFiles(dataDir);
  console.log(`[INGESTION] Parsed ${accounts.length} accounts from XML files`);
  
  // Get all equity summary entries (daily NAV data)
  const allEquityEntries = parseAllEquitySummaryFiles(dataDir);
  console.log(`[INGESTION] Parsed ${allEquityEntries.length} equity summary entries`);
  
  let accountsIngested = 0;
  let navRecordsIngested = 0;
  let transactionsIngested = 0;
  let transfersIngested = 0;
  let holdingsIngested = 0;
  let tradesIngested = 0;
  let changeInNAVIngested = 0;
  
  for (const account of accounts) {
    // Upsert account
    await upsertAccount(
      account.accountId,
      account.accountAlias,
      account.currency
    );
    accountsIngested++;
    
    console.log(`[INGESTION] Processing account ${account.accountId} (${account.accountAlias})`);
    
    // Get NAV data from EquitySummary for this account
    const equityEntries = allEquityEntries.filter(
      e => e.accountId === account.accountId
    );
    
    // Process NAV records with August override logic
    for (const entry of equityEntries) {
      const dateStr = format(entry.reportDate, 'yyyy-MM-dd');
      
      // Apply August override if applicable (ONLY during ingestion)
      const overrideNav = getAugustOverrideNAV(dateStr, account.accountId);
      const navValue = overrideNav !== null ? overrideNav : entry.total;
      
      if (overrideNav !== null) {
        console.log(`[INGESTION] 🔧 Applying August override for ${account.accountId} on ${dateStr}: ${formatCurrency(overrideNav)} (XML had ${formatCurrency(entry.total)})`);
      }
      
      // UPSERT NAV (will replace existing if date+account exists)
      await upsertNav(account.accountId, dateStr, navValue);
      navRecordsIngested++;
    }
    
    // Process transfers first (so we can check for duplicates in transaction categorization)
    // Track transaction IDs we've already processed to prevent duplicates
    const processedTransactionIds = new Set<string>();
    
    for (const transfer of account.transfers || []) {
      const dateStr = format(transfer.date, 'yyyy-MM-dd');
      
      // Check if we've already processed this transaction_id (prevents duplicates from same transfer on different dates)
      if (transfer.transactionID) {
        const txKey = `${account.accountId}_${transfer.transactionID}`;
        if (processedTransactionIds.has(txKey)) {
          console.log(`[INGESTION] Skipping duplicate transfer: transaction_id=${transfer.transactionID}, date=${dateStr}, amount=${transfer.amount} (already processed)`);
          continue;
        }
        processedTransactionIds.add(txKey);
      }
      
      // Check if a transfer with this transaction_id already exists in database
      // This prevents duplicates when the same transfer appears in multiple XML files with different dates
      if (transfer.transactionID) {
        const existingRows = await db`
          SELECT id FROM "Transfers"
          WHERE account_id = ${account.accountId} AND transaction_id = ${transfer.transactionID}
        ` as unknown as Array<{ id: number }>;
        if (existingRows.length > 0) {
          console.log(`[INGESTION] Skipping duplicate transfer: transaction_id=${transfer.transactionID} already exists in database (ID: ${existingRows[0].id})`);
          continue;
        }
      }
      
      // Insert transfer
      try {
        await insertTransfer(
          account.accountId,
          transfer.type || '',
          transfer.direction || '',
          transfer.amount,
          dateStr,
          transfer.description || '',
          transfer.currency || 'USD',
          transfer.fxRateToBase || 1.0,
          transfer.fromAccount || null,
          transfer.toAccount || null,
          transfer.transactionID || null
        );
        transfersIngested++;
      } catch (error: any) {
        // Handle unique constraint errors gracefully
        if (error?.code === '23505') {
          console.log(`[INGESTION] Skipping duplicate transfer: date=${dateStr}, amount=${transfer.amount}`);
          continue;
        }
        throw error;
      }
    }
    
    // Categorize and store transactions in appropriate tables
    // This prevents double-counting and ensures each transaction is in only one table
    const transferIds = new Set((account.transfers || []).map(t => t.transactionID).filter(Boolean));
    
    // Collect all categorized transactions first (for deduplication)
    const categorizedTransactions = {
      deposits: [] as Array<{ amount: number; date: string; description: string; currency: string; fxRateToBase: number; transactionId: string | null }>,
      withdrawals: [] as Array<{ amount: number; date: string; description: string; currency: string; fxRateToBase: number; transactionId: string | null }>,
      dividends: [] as Array<any>,
      interest: [] as Array<any>,
      fees: [] as Array<any>,
      taxes: [] as Array<any>,
    };
    
    for (const tx of account.cashTransactions) {
      // Categorize transaction
      const categorized = categorizeTransaction(tx, account.accountId, account.transfers || []);
      
      if (!categorized) {
        // Transaction doesn't fit any category or is already in transfers - skip
        continue;
      }
      
      const dateStr = format(tx.date, 'yyyy-MM-dd');
      const amountUSD = Math.abs(tx.amount) * (tx.fxRateToBase || 1.0);
      
      // Collect transactions by category (will deduplicate withdrawals later)
      switch (categorized.category) {
        case 'deposit':
          categorizedTransactions.deposits.push({
            amount: amountUSD,
            date: dateStr,
            description: categorized.description,
            currency: categorized.currency,
            fxRateToBase: categorized.fxRateToBase,
            transactionId: categorized.transactionId || null,
          });
          break;
          
        case 'withdrawal':
          categorizedTransactions.withdrawals.push({
            amount: amountUSD,
            date: dateStr,
            description: categorized.description,
            currency: categorized.currency,
            fxRateToBase: categorized.fxRateToBase,
            transactionId: categorized.transactionId || null,
          });
          break;
          
        case 'dividend':
          categorizedTransactions.dividends.push({
            amount: amountUSD,
            date: dateStr,
            description: categorized.description,
            symbol: categorized.symbol || null,
            currency: categorized.currency,
            fxRateToBase: categorized.fxRateToBase,
            transactionId: categorized.transactionId || null,
          });
          break;
          
        case 'interest':
          categorizedTransactions.interest.push({
            amount: amountUSD,
            date: dateStr,
            description: categorized.description,
            currency: categorized.currency,
            fxRateToBase: categorized.fxRateToBase,
            transactionId: categorized.transactionId || null,
          });
          break;
          
        case 'fee':
          categorizedTransactions.fees.push({
            amount: amountUSD,
            date: dateStr,
            description: categorized.description,
            feeType: categorized.feeType || 'fee',
            currency: categorized.currency,
            fxRateToBase: categorized.fxRateToBase,
            transactionId: categorized.transactionId || null,
          });
          break;
          
        case 'tax':
          categorizedTransactions.taxes.push({
            amount: amountUSD,
            date: dateStr,
            description: categorized.description,
            taxType: categorized.taxType || 'tax',
            currency: categorized.currency,
            fxRateToBase: categorized.fxRateToBase,
            transactionId: categorized.transactionId || null,
          });
          break;
      }
      
      // Also keep in Transactions table for backward compatibility (but mark as categorized)
      await insertTransaction(
        account.accountId,
        tx.type,
        tx.amount,
        dateStr,
        tx.description || null,
        tx.symbol || null,
        tx.transactionID || null
      );
    }
    
    // Deduplicate withdrawals (merge duplicate disbursements on consecutive days with same amount)
    const deduplicatedWithdrawals = deduplicateWithdrawals(categorizedTransactions.withdrawals);
    if (deduplicatedWithdrawals.length < categorizedTransactions.withdrawals.length) {
      console.log(`[INGESTION] Deduplicated ${categorizedTransactions.withdrawals.length} withdrawals to ${deduplicatedWithdrawals.length} (removed ${categorizedTransactions.withdrawals.length - deduplicatedWithdrawals.length} duplicates)`);
    }
    
    // Now store all transactions
    // Store deposits (with duplicate checking by transaction_id)
    const processedDepositTxIds = new Set<string>();
    for (const deposit of categorizedTransactions.deposits) {
      // Check if we've already processed this transaction_id in this batch
      if (deposit.transactionId) {
        const txKey = `${account.accountId}_${deposit.transactionId}`;
        if (processedDepositTxIds.has(txKey)) {
          console.log(`[INGESTION] Skipping duplicate deposit: transaction_id=${deposit.transactionId}, date=${deposit.date}, amount=${deposit.amount} (already processed in this batch)`);
          continue;
        }
        processedDepositTxIds.add(txKey);
        
        // Check if a deposit with this transaction_id already exists in database
        const existingDep = await db`
          SELECT id FROM "Deposits"
          WHERE account_id = ${account.accountId} AND transaction_id = ${deposit.transactionId}
        ` as unknown as Array<{ id: number }>;
        if (existingDep.length > 0) {
          console.log(`[INGESTION] Skipping duplicate deposit: transaction_id=${deposit.transactionId} already exists in database (ID: ${existingDep[0].id})`);
          continue;
        }
      }
      
      await insertDeposit(
        account.accountId,
        deposit.amount,
        deposit.date,
        deposit.description,
        deposit.currency,
        deposit.fxRateToBase,
        deposit.transactionId
      );
      transactionsIngested++;
    }
    
    // Store withdrawals (deduplicated)
    for (const withdrawal of deduplicatedWithdrawals) {
      try {
        await insertWithdrawal(
          account.accountId,
          withdrawal.amount,
          withdrawal.date,
          withdrawal.description,
          withdrawal.currency,
          withdrawal.fxRateToBase,
          withdrawal.transactionId
        );
        transactionsIngested++;
      } catch (error: any) {
        if (error?.code === '23505') {
          console.log(`[INGESTION] Skipping duplicate withdrawal: date=${withdrawal.date}, amount=${withdrawal.amount}`);
          continue;
        }
        throw error;
      }
    }
    
    // Store dividends (with duplicate checking by transaction_id)
    const processedDividendTxIds = new Set<string>();
    for (const dividend of categorizedTransactions.dividends) {
      // Check if we've already processed this transaction_id in this batch
      if (dividend.transactionId) {
        const txKey = `${account.accountId}_${dividend.transactionId}`;
        if (processedDividendTxIds.has(txKey)) {
          console.log(`[INGESTION] Skipping duplicate dividend: transaction_id=${dividend.transactionId}, date=${dividend.date}, amount=${dividend.amount} (already processed in this batch)`);
          continue;
        }
        processedDividendTxIds.add(txKey);
        
        // Check if a dividend with this transaction_id already exists in database
        const existingDiv = await db`
          SELECT id FROM "Dividends"
          WHERE account_id = ${account.accountId} AND transaction_id = ${dividend.transactionId}
        ` as unknown as Array<{ id: number }>;
        if (existingDiv.length > 0) {
          console.log(`[INGESTION] Skipping duplicate dividend: transaction_id=${dividend.transactionId} already exists in database (ID: ${existingDiv[0].id})`);
          continue;
        }
      }
      
      try {
        await insertDividend(
          account.accountId,
          dividend.amount,
          dividend.date,
          dividend.description,
          dividend.symbol,
          dividend.currency,
          dividend.fxRateToBase,
          dividend.transactionId
        );
        transactionsIngested++;
      } catch (error: any) {
        if (error?.code === '23505') {
          console.log(`[INGESTION] Skipping duplicate dividend: date=${dividend.date}, symbol=${dividend.symbol}, amount=${dividend.amount}`);
          continue;
        }
        throw error;
      }
    }
    
    // Store interest
    for (const interest of categorizedTransactions.interest) {
      try {
        await insertInterest(
          account.accountId,
          interest.amount,
          interest.date,
          interest.description,
          interest.currency,
          interest.fxRateToBase,
          interest.transactionId
        );
        transactionsIngested++;
      } catch (error: any) {
        if (error?.code === '23505') {
          console.log(`[INGESTION] Skipping duplicate interest: date=${interest.date}, amount=${interest.amount}`);
          continue;
        }
        throw error;
      }
    }
    
    // Store fees
    for (const fee of categorizedTransactions.fees) {
      try {
        await insertFee(
          account.accountId,
          fee.amount,
          fee.date,
          fee.description,
          fee.feeType,
          fee.currency,
          fee.fxRateToBase,
          fee.transactionId
        );
        transactionsIngested++;
      } catch (error: any) {
        if (error?.code === '23505') {
          console.log(`[INGESTION] Skipping duplicate fee: date=${fee.date}, amount=${fee.amount}`);
          continue;
        }
        throw error;
      }
    }
    
    // Store taxes
    for (const tax of categorizedTransactions.taxes) {
      try {
        await insertTax(
          account.accountId,
          tax.amount,
          tax.date,
          tax.description,
          tax.taxType,
          tax.currency,
          tax.fxRateToBase,
          tax.transactionId
        );
        transactionsIngested++;
      } catch (error: any) {
        if (error?.code === '23505') {
          console.log(`[INGESTION] Skipping duplicate tax: date=${tax.date}, amount=${tax.amount}`);
          continue;
        }
        throw error;
      }
    }
    
    // Store holdings (open positions)
    const protectedAccounts = getProtectedHoldingsAccounts();
    const shouldProtectHoldings = protectedAccounts.has(account.accountId);
    if (shouldProtectHoldings) {
      console.log(`[INGESTION] 🛡️ Holdings overwrite skipped for protected account ${account.accountId}`);
    } else if (account.openPositions && account.openPositions.length > 0) {
      console.log(`[INGESTION] Storing ${account.openPositions.length} holdings for account ${account.accountId}`);
      for (const position of account.openPositions) {
        // Use report date from ChangeInNAV if available, otherwise use today
        const reportDate = account.changeInNAV?.toDate 
          ? format(account.changeInNAV.toDate, 'yyyy-MM-dd')
          : format(new Date(), 'yyyy-MM-dd');
        
        console.log(`[INGESTION]   - ${position.symbol}: ${position.position} @ ${formatCurrency(position.positionValue)}`);
        
        await upsertHolding(
          account.accountId,
          position.symbol,
          position.description || null,
          position.position,
          position.markPrice,
          position.positionValue,
          position.costBasisMoney,
          position.fifoPnlUnrealized,
          position.percentOfNAV,
          position.currency || 'USD',
          position.fxRateToBase || 1.0,
          position.conid || null,
          reportDate
        );
        holdingsIngested++;
      }
    } else {
      console.log(`[INGESTION] No holdings found for account ${account.accountId} (openPositions: ${account.openPositions?.length || 0})`);
    }
    
    // Store trades
    for (const trade of account.trades || []) {
      const dateStr = format(trade.tradeDate, 'yyyy-MM-dd');
      try {
        await insertTrade(
          account.accountId,
          trade.symbol,
          trade.quantity,
          trade.tradePrice,
          trade.commissions,
          dateStr,
          0, // realized_pnl - calculated separately
          trade.tradeID || null
        );
        tradesIngested++;
      } catch (error: any) {
        if (error?.code === '23505') {
          console.log(`[INGESTION] Skipping duplicate trade: date=${dateStr}, symbol=${trade.symbol}, trade_id=${trade.tradeID}`);
          continue;
        }
        throw error;
      }
    }
    
    // Store ChangeInNAV (period summary)
    if (account.changeInNAV) {
      const fromDateStr = format(account.changeInNAV.fromDate, 'yyyy-MM-dd');
      const toDateStr = format(account.changeInNAV.toDate, 'yyyy-MM-dd');
      await upsertChangeInNAV(
        account.accountId,
        fromDateStr,
        toDateStr,
        account.changeInNAV.startingValue,
        account.changeInNAV.endingValue,
        account.changeInNAV.depositsWithdrawals,
        account.changeInNAV.dividends,
        account.changeInNAV.interest,
        account.changeInNAV.commissions,
        account.changeInNAV.withholdingTax,
        account.changeInNAV.otherFees,
        account.changeInNAV.twr,
        account.changeInNAV.fxRateToBase
      );
      changeInNAVIngested++;
      
      const protectedCashAccounts = getProtectedCashAccounts();
      const shouldProtectCash = protectedCashAccounts.has(account.accountId);
      if (shouldProtectCash) {
        console.log(`[INGESTION] 🛡️ Cash overwrite skipped for protected account ${account.accountId}`);
      } else {
        // Store cash balance: Cash = NAV - sum of position values
        // Use the toDate (latest date) for the cash record
        const reportDate = toDateStr;
        const navUSD = account.changeInNAV.endingValue * account.changeInNAV.fxRateToBase;
        const totalPositionValue = (account.openPositions || []).reduce(
          (sum, pos) => sum + (pos.positionValue * pos.fxRateToBase),
          0
        );
        const cashUSD = navUSD - totalPositionValue;
        
        // Check if there's an explicit cash position in openPositions (symbol like "USD" or assetCategory="CASH")
        const cashPosition = (account.openPositions || []).find(
          pos => pos.symbol.toUpperCase() === 'USD' || 
                 pos.symbol.toUpperCase() === 'CASH' ||
                 pos.currency.toUpperCase() === 'USD' && pos.symbol === ''
        );
        
        // Use explicit cash position if available, otherwise use calculated cash
        const finalCashAmount = cashPosition ? (cashPosition.positionValue * cashPosition.fxRateToBase) : cashUSD;
        const cashCurrency = account.currency || 'USD';
        const cashFxRate = account.changeInNAV.fxRateToBase || 1.0;
        
        if (Math.abs(finalCashAmount) > 0.01 || cashPosition) {
          await upsertCash(
            account.accountId,
            finalCashAmount,
            cashCurrency,
            cashFxRate,
            reportDate
          );
          console.log(`[INGESTION] ✓ Stored cash balance for ${account.accountId}: ${formatCurrency(finalCashAmount)} (as of ${reportDate})`);
        }
      }
    }
    
    console.log(`[INGESTION] ✓ ${account.accountId}: ${equityEntries.length} NAV records, ${transactionsIngested} categorized transactions, ${transfersIngested} transfers, ${account.openPositions?.length || 0} holdings, ${account.trades?.length || 0} trades, ${account.changeInNAV ? '1' : '0'} ChangeInNAV`);
  }
  
  console.log(`[INGESTION] XML ingestion complete: ${accountsIngested} accounts, ${navRecordsIngested} NAV records, ${transactionsIngested} transactions, ${transfersIngested} transfers, ${holdingsIngested} holdings, ${tradesIngested} trades, ${changeInNAVIngested} ChangeInNAV records`);
  
  return { accountsIngested, navRecordsIngested, transactionsIngested, transfersIngested };
}

/**
 * Ingest CSV file (portfolio_history_feb_aug.csv)
 */
export async function ingestCSVFile(csvFilePath: string): Promise<{
  navRecordsIngested: number;
  transactionsIngested: number;
  transfersIngested: number;
}> {
  console.log(`[INGESTION] Starting CSV file ingestion from: ${csvFilePath}`);
  
  if (!existsSync(csvFilePath)) {
    console.warn(`[INGESTION] CSV file does not exist: ${csvFilePath}`);
    return { navRecordsIngested: 0, transactionsIngested: 0, transfersIngested: 0 };
  }
  
  const db = getDatabase();
  // Query helpers — all are now async functions from the postgres-based database module
  const upsertAccount = accountQueries.upsert.bind(accountQueries);
  const upsertNav = navQueries.upsert.bind(navQueries);
  const insertTransaction = transactionQueries.insert.bind(transactionQueries);
  const insertDeposit = depositQueries.insert.bind(depositQueries);
  const insertWithdrawal = withdrawalQueries.insert.bind(withdrawalQueries);
  
  // Parse CSV - csvFilePath is already fully resolved, but parsePortfolioHistoryCSV
  // does its own join, so we need to pass just the filename or handle it differently
  // For now, pass the full path but the parser will handle it
  console.log(`[INGESTION] Attempting to parse CSV from: ${csvFilePath}`);
  const csvEntries = parsePortfolioHistoryCSV(csvFilePath);
  console.log(`[INGESTION] Parsed ${csvEntries.length} CSV entries`);
  
  if (csvEntries.length === 0) {
    console.warn(`[INGESTION] ⚠️ No CSV entries parsed! Check if file exists and has data.`);
    console.warn(`[INGESTION]    File path: ${csvFilePath}`);
    console.warn(`[INGESTION]    File exists: ${existsSync(csvFilePath)}`);
  }
  
  if (csvEntries.length === 0) {
    return { navRecordsIngested: 0, transactionsIngested: 0, transfersIngested: 0 };
  }
  
  // Process CSV data
  const processed = processCSVEntries(csvEntries, U16030763_ACCOUNT_ID);
  
  // Upsert account (use virtual account ID for CSV history)
  await upsertAccount(
    CSV_VIRTUAL_ACCOUNT_ID,
    "Hungary Migration History",
    "USD"
  );
  
  let navRecordsIngested = 0;
  let transactionsIngested = 0;
  
  // Process NAV records from CSV equity curve
  for (const point of processed.equityCurve) {
    const dateStr = format(point.date, 'yyyy-MM-dd');
    
    // Apply August override if applicable (ONLY during ingestion)
    // For CSV, we still check U16030763 since the CSV is for that account
    const overrideNav = getAugustOverrideNAV(dateStr, U16030763_ACCOUNT_ID);
    const navValue = overrideNav !== null ? overrideNav : point.nav;
    
    if (overrideNav !== null) {
      console.log(`[INGESTION] 🔧 Applying August override for CSV on ${dateStr}: ${formatCurrency(overrideNav)} (CSV had ${formatCurrency(point.nav)})`);
    }
    
    // UPSERT NAV
    await upsertNav(CSV_VIRTUAL_ACCOUNT_ID, dateStr, navValue);
    navRecordsIngested++;
  }
  
  // Process deposits/transactions from CSV
  // CRITICAL: Store the initial deposit ($116,495) in Transactions table
  // This serves as the Portfolio Inception anchor for Simple Return calculation
  const inceptionValue = processed.inceptionValue;
  
  // ALWAYS use Feb 8, 2024 as the official inception date (not Feb 9 or any other date)
  // This prevents date mismatches that cause double-counting
  const feb8Date = new Date(Date.UTC(2024, 1, 8)); // Feb 8, 2024
  const feb8DateStr = format(feb8Date, 'yyyy-MM-dd');
  
  // Find Feb 8 value from equity curve if available, otherwise use inceptionValue
  let trueInceptionValue = inceptionValue;
  const feb8Point = processed.equityCurve.find(p => format(p.date, 'yyyy-MM-dd') === feb8DateStr);
  if (feb8Point && feb8Point.nav > 0) {
    trueInceptionValue = feb8Point.nav;
    console.log(`[INGESTION] ✓ Found Feb 8, 2024 inception point in equity curve: ${formatCurrency(trueInceptionValue)}`);
  }
  
  // Force inception value to $116,495 if close (within $1k)
  if (Math.abs(trueInceptionValue - 116495) < 1000) {
    trueInceptionValue = 116495;
  }
  
  // ALWAYS store inception deposit on Feb 8, 2024 (the official inception date)
  if (trueInceptionValue > 0) {
    // Store initial deposit in Deposits table (using UPSERT to prevent duplicates)
    try {
      await insertDeposit(
        CSV_VIRTUAL_ACCOUNT_ID,
        trueInceptionValue, // $116,495
        feb8DateStr, // ALWAYS Feb 8, 2024
        "Initial capital deposit - Portfolio Inception",
        "USD",
        1.0,
        null
      );
      transactionsIngested++;
      console.log(`[INGESTION] ✓ Stored Portfolio Inception anchor: ${formatCurrency(trueInceptionValue)} on ${feb8DateStr} (Feb 8, 2024)`);
      console.log(`[INGESTION]    This serves as the starting Net Contribution for Simple Return calculation`);
    } catch (error: any) {
      if (error?.code === '23505') {
        console.log(`[INGESTION] Skipping duplicate initial deposit (already exists)`);
      } else {
        throw error;
      }
    }
  } else {
    console.warn(`[INGESTION] ⚠️ WARNING: Could not determine inception value from CSV`);
  }
  
  // Process other deposits from CSV cash flows
  if (processed.deposits) {
    for (const [dateKey, amount] of processed.deposits.entries()) {
      // Skip inception date and nearby dates (Feb 7-9, 2024) if amount matches inception value
      // This prevents double-counting the inception deposit
      const dateObj = new Date(dateKey);
      const feb7DateStr = format(new Date(Date.UTC(2024, 1, 7)), 'yyyy-MM-dd');
      const feb9DateStr = format(new Date(Date.UTC(2024, 1, 9)), 'yyyy-MM-dd');
      
      if (
        (dateKey === feb7DateStr || dateKey === feb8DateStr || dateKey === feb9DateStr) &&
        Math.abs(amount - trueInceptionValue) < 100
      ) {
        // This is the inception deposit (or a duplicate of it), already stored on Feb 8
        console.log(`[INGESTION] ⚠️ Skipping duplicate inception deposit: ${dateKey} - ${formatCurrency(amount)} (already stored on ${feb8DateStr})`);
        continue;
      }
      
      if (Math.abs(amount) > 0.01) {
        try {
          if (amount > 0) {
            await insertDeposit(
              CSV_VIRTUAL_ACCOUNT_ID,
              Math.abs(amount),
              dateKey,
              `Portfolio deposit`,
              "USD",
              1.0,
              null
            );
          } else {
            await insertWithdrawal(
              CSV_VIRTUAL_ACCOUNT_ID,
              Math.abs(amount),
              dateKey,
              `Portfolio withdrawal`,
              "USD",
              1.0,
              null
            );
          }
          transactionsIngested++;
        } catch (error: any) {
          if (error?.code === '23505') {
            console.log(`[INGESTION] Skipping duplicate transaction: date=${dateKey}, amount=${amount}`);
            continue;
          }
          throw error;
        }
      }
    }
  }
  
  console.log(`[INGESTION] CSV ingestion complete: ${navRecordsIngested} NAV records, ${transactionsIngested} transactions`);
  
  return { navRecordsIngested, transactionsIngested, transfersIngested: 0 };
}

/**
 * Main ingestion function - scans and ingests all data sources
 */
export async function ingestAllData(
  dataDir: string = "data/ibkr_uploads",
  clearExisting: boolean = false
): Promise<{
  accountsIngested: number;
  navRecordsIngested: number;
  transactionsIngested: number;
  transfersIngested: number;
  cleared?: { navRecordsDeleted: number; transactionsDeleted: number };
}> {
  console.log(`[INGESTION] ===== Starting Permanent Data Ingestion =====`);
  
  const projectRoot = process.cwd();
  console.log(`[INGESTION] Project root: ${projectRoot}`);
  
  // Fix path resolution - handle both relative and absolute paths
  const fullDataDir = dataDir.startsWith('/') || dataDir.match(/^[A-Z]:/) 
    ? dataDir 
    : join(projectRoot, dataDir);
  
  // CSV file should be in project root (NOT double-nested)
  // Fix path resolution - check if CSV_FILE_NAME is already absolute
  const csvFilePath = CSV_FILE_NAME.startsWith('/') || CSV_FILE_NAME.match(/^[A-Z]:/)
    ? CSV_FILE_NAME
    : join(projectRoot, CSV_FILE_NAME);
  console.log(`[INGESTION] Looking for CSV at: ${csvFilePath}`);
  console.log(`[INGESTION] CSV file exists: ${existsSync(csvFilePath)}`);
  
  // Clear existing data if requested
  let cleared: { navRecordsDeleted: number; transactionsDeleted: number } | undefined = undefined;
  if (clearExisting) {
    const { clearU16030763Data } = await import('./database-cleanup');
    cleared = await clearU16030763Data();
    console.log(`[INGESTION] Cleared existing data: ${cleared?.navRecordsDeleted} NAV records, ${cleared?.transactionsDeleted} transactions`);
  }
  
  // Ingest XML files
  const xmlResults = await ingestXMLFiles(fullDataDir);
  
  // Ingest CSV file
  const csvResults = await ingestCSVFile(csvFilePath);
  
  const total = {
    accountsIngested: xmlResults.accountsIngested,
    navRecordsIngested: xmlResults.navRecordsIngested + csvResults.navRecordsIngested,
    transactionsIngested: xmlResults.transactionsIngested + csvResults.transactionsIngested,
    transfersIngested: xmlResults.transfersIngested,
  };
  
  console.log(`[INGESTION] ===== Ingestion Complete =====`);
  console.log(`[INGESTION] Total: ${total.accountsIngested} accounts, ${total.navRecordsIngested} NAV records, ${total.transactionsIngested} transactions, ${total.transfersIngested} transfers`);
  
  return {
    ...total,
    cleared,
  };
}

/**
 * Check if data needs ingestion (by checking if database is empty)
 */
export async function needsIngestion(): Promise<boolean> {
  const result = await navQueries.getEarliestDate();
  return !result;
}
