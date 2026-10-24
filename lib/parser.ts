import { XMLParser } from "fast-xml-parser";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type {
  FlexQueryResponse,
  FlexStatement,
  ProcessedAccount,
  ProcessedChangeInNAV,
  ProcessedOpenPosition,
  ProcessedTrade,
  ProcessedCashTransaction,
  ProcessedTransfer,
  Transfer,
} from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: true,
  trimValues: true,
  parseTrueNumberOnly: false,
  ignoreNameSpace: true,
  removeNSPrefix: true,
  parseTagValue: true,
  parseNodeValue: true,
  textNodeName: "_text",
  arrayMode: false,
} as any);

/**
 * Parse IBKR date string (YYYYMMDD) to Date object
 */
/**
 * Parse IBKR date string (YYYYMMDD) to Date object
 * CRITICAL: Uses UTC to match EquitySummary date parsing
 * This ensures CashTransaction dates and EquitySummary dates normalize to the same YYYY-MM-DD format
 */
export function parseIBKRDate(dateStr: string): Date {
  // Trim whitespace and convert to string
  const trimmed = String(dateStr || '').trim();
  
  if (!trimmed || trimmed.length !== 8) {
    console.error(`[parseIBKRDate] Invalid date string: "${dateStr}" (length: ${trimmed.length})`);
    throw new Error(`Invalid IBKR date format: "${dateStr}". Expected YYYYMMDD format (8 characters).`);
  }
  
  const year = parseInt(trimmed.substring(0, 4), 10);
  const month = parseInt(trimmed.substring(4, 6), 10) - 1; // Month is 0-indexed
  const day = parseInt(trimmed.substring(6, 8), 10);
  
  // Validate parsed values
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    console.error(`[parseIBKRDate] Failed to parse date components: year=${year}, month=${month}, day=${day} from "${dateStr}"`);
    throw new Error(`Failed to parse IBKR date: "${dateStr}"`);
  }
  
  // Validate month range (0-11)
  if (month < 0 || month > 11) {
    console.error(`[parseIBKRDate] Invalid month: ${month + 1} (from "${dateStr}")`);
    throw new Error(`Invalid month in IBKR date: "${dateStr}"`);
  }
  
  // CRITICAL: Use UTC to match EquitySummary date parsing (parseIBKRDate in equity-parser.ts)
  // This ensures dates normalize consistently when using startOfDay() and toISOString()
  const parsedDate = new Date(Date.UTC(year, month, day));
  
  // Validate the parsed date
  if (isNaN(parsedDate.getTime())) {
    console.error(`[parseIBKRDate] Invalid date object created from: "${dateStr}" (year=${year}, month=${month}, day=${day})`);
    throw new Error(`Invalid date created from IBKR date: "${dateStr}"`);
  }
  
  return parsedDate;
}

/**
 * Parse IBKR datetime string (YYYYMMDD;HHMMSS) to Date object
 */
function parseIBKRDateTime(dateTimeStr: string | undefined | null): Date {
  if (!dateTimeStr || typeof dateTimeStr !== "string" || dateTimeStr.trim() === "") {
    return new Date();
  }
  
  // Handle date-only format (YYYYMMDD)
  if (dateTimeStr.length === 8 && !dateTimeStr.includes(";")) {
    return parseIBKRDate(dateTimeStr);
  }
  
  // Handle datetime format (YYYYMMDD;HHMMSS)
  const parts = dateTimeStr.split(";");
  if (parts.length === 0) {
    return new Date();
  }
  
  const dateStr = parts[0];
  const timeStr = parts[1];
  
  if (!dateStr || dateStr.length !== 8) {
    return new Date();
  }
  
  const date = parseIBKRDate(dateStr);
  
  // If time component exists, set it using UTC methods to maintain UTC consistency
  // This ensures dates normalize consistently with EquitySummary dates
  if (timeStr && timeStr.length === 6) {
    const hours = parseInt(timeStr.substring(0, 2));
    const minutes = parseInt(timeStr.substring(2, 4));
    const seconds = parseInt(timeStr.substring(4, 6));
    if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
      // Use UTC methods to maintain consistency with parseIBKRDate (which uses UTC)
      date.setUTCHours(hours, minutes, seconds);
    }
  }
  
  return date;
}

/**
 * Convert string to number, handling empty strings and defaults
 */
function toNumber(value: string | undefined, defaultValue: number = 0): number {
  if (!value || value === "") return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Normalize array - ensures we always get an array even if there's only one item
 */
function normalizeArray<T>(item: T | T[] | undefined): T[] {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/**
 * Parse a single XML file
 */
export function parseIBKRXML(filePath: string): ProcessedAccount[] {
  const fileContent = readFileSync(filePath, "utf-8");
  
  if (!fileContent || fileContent.trim().length === 0) {
    throw new Error(`File ${filePath} is empty`);
  }
  
  let parsed: any;
  try {
    parsed = parser.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse XML from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Debug: log the structure
  console.log(`Parsed structure keys:`, Object.keys(parsed));
  
  if (!parsed.FlexQueryResponse && !parsed.FlexStatements) {
    console.error(`Unexpected structure:`, JSON.stringify(parsed, null, 2).substring(0, 500));
    throw new Error(`Invalid XML structure in ${filePath}: Expected FlexQueryResponse or FlexStatements`);
  }
  
  // Handle the parsed structure - fast-xml-parser might wrap it differently
  let flexStatements: any;
  
  if (parsed.FlexQueryResponse) {
    flexStatements = parsed.FlexQueryResponse.FlexStatements;
  } else if (parsed.FlexStatements) {
    flexStatements = parsed.FlexStatements;
  } else {
    // Try to find it in the root
    const keys = Object.keys(parsed);
    console.log(`Available keys in parsed object:`, keys);
    if (keys.length > 0) {
      flexStatements = parsed[keys[0]];
    }
  }
  
  if (!flexStatements) {
    console.error(`Could not find FlexStatements. Parsed structure:`, JSON.stringify(parsed, null, 2).substring(0, 1000));
    throw new Error(`Invalid XML structure in ${filePath}: Could not find FlexStatements`);
  }
  
  if (!flexStatements.FlexStatement) {
    console.error(`Missing FlexStatement. FlexStatements structure:`, JSON.stringify(flexStatements, null, 2).substring(0, 500));
    throw new Error(`Invalid XML structure in ${filePath}: Missing FlexStatements.FlexStatement`);
  }

  const statements = normalizeArray(
    flexStatements.FlexStatement || []
  );
  
  console.log(`Found ${statements.length} FlexStatement(s)`);

  return statements.map((statement: FlexStatement, index: number) => {
    // Get account identifier for error messages
    const accountId = statement.accountId || `Statement-${index + 1}`;
    const accountAlias = statement.AccountInformation?.acctAlias || 
                        statement.ChangeInNAV?.acctAlias || 
                        accountId;
    
    // Log account being processed
    console.log(`[PARSER] Processing account ${accountId} (${accountAlias})`);
    
    // 1. AccountInformation: Primary source for currency, accountId, accountAlias
    const accountInfo = statement.AccountInformation;
    if (!accountInfo) {
      console.warn(`[PARSER] ⚠️ Account ${accountId}: Missing AccountInformation tag`);
      console.warn(`[PARSER]    This may indicate the Flex Query needs 'AccountInformation' section enabled at IBKR`);
      console.warn(`[PARSER]    Available statement keys:`, Object.keys(statement));
    } else {
      console.log(`[PARSER] ✓ Account ${accountId}: Found AccountInformation (currency: ${accountInfo.currency || 'NOT SET'})`);
    }
    
    // Get currency from AccountInformation (primary), ChangeInNAV (fallback), or default
    const currency = accountInfo?.currency || 
                     statement.ChangeInNAV?.currency || 
                     (Array.isArray(statement.EquitySummaryInBase?.EquitySummaryByReportDateInBase) 
                       ? statement.EquitySummaryInBase.EquitySummaryByReportDateInBase[0]?.currency
                       : statement.EquitySummaryInBase?.EquitySummaryByReportDateInBase?.currency) ||
                     "USD";
    
    if (!accountInfo?.currency && !statement.ChangeInNAV?.currency) {
      console.warn(`[PARSER] ⚠️ Account ${accountId}: No currency found in AccountInformation or ChangeInNAV, defaulting to USD`);
    }
    
    // 2. ChangeInNAV: For performance metrics
    const changeInNAV = statement.ChangeInNAV;
    if (!changeInNAV) {
      console.warn(`[PARSER] ⚠️ Account ${accountId}: Missing ChangeInNAV tag`);
      console.warn(`[PARSER]    This may indicate the Flex Query needs 'ChangeInNAV' section enabled at IBKR`);
      // Don't throw - try to continue with other data
    } else {
      console.log(`[PARSER] ✓ Account ${accountId}: Found ChangeInNAV`);
    }
    
    // 3. OpenPositions: For current positions
    const openPositions = normalizeArray(
      statement.OpenPositions?.OpenPosition || []
    );
    if (!statement.OpenPositions && openPositions.length === 0) {
      console.warn(`[PARSER] ⚠️ Account ${accountId}: Missing or empty OpenPositions tag`);
    } else {
      console.log(`[PARSER] ✓ Account ${accountId}: Found ${openPositions.length} OpenPositions`);
    }
    
    // 4. Trades: For execution details
    const trades = normalizeArray(statement.Trades?.Trade || []);
    if (!statement.Trades && trades.length === 0) {
      console.warn(`[PARSER] ⚠️ Account ${accountId}: Missing or empty Trades tag`);
    } else {
      console.log(`[PARSER] ✓ Account ${accountId}: Found ${trades.length} Trades`);
    }
    
    // 5. CashTransactions: For deposits and withdrawals
    const cashTransactions = normalizeArray(
      statement.CashTransactions?.CashTransaction || []
    );
    if (!statement.CashTransactions && cashTransactions.length === 0) {
      console.warn(`[PARSER] ⚠️ Account ${accountId}: Missing or empty CashTransactions tag`);
      console.warn(`[PARSER]    This may indicate the Flex Query needs 'CashTransactions' section enabled at IBKR`);
    } else {
      console.log(`[PARSER] ✓ Account ${accountId}: Found ${cashTransactions.length} CashTransactions`);
    }
    
    // 6. Transfers: For internal movements
    const transfers = normalizeArray(
      statement.Transfers?.Transfer || []
    );
    if (!statement.Transfers && transfers.length === 0) {
      console.warn(`[PARSER] ⚠️ Account ${accountId}: Missing or empty Transfers tag`);
      console.warn(`[PARSER]    This may indicate the Flex Query needs 'Transfers' section enabled at IBKR`);
    } else {
      console.log(`[PARSER] ✓ Account ${accountId}: Found ${transfers.length} Transfers`);
    }
    
    // 7. NetAssetValueSummary or EquitySummaryInBase: For daily NAV
    const equitySummary = statement.EquitySummaryInBase?.EquitySummaryByReportDateInBase;
    const netAssetValueSummary = statement.NetAssetValueSummary;
    if (!equitySummary && !netAssetValueSummary) {
      console.warn(`[PARSER] ⚠️ Account ${accountId}: Missing EquitySummaryInBase and NetAssetValueSummary tags`);
      console.warn(`[PARSER]    This may indicate the Flex Query needs 'EquitySummaryByReportDateInBase' section enabled at IBKR`);
    } else {
      const equityCount = Array.isArray(equitySummary) ? equitySummary.length : (equitySummary ? 1 : 0);
      const navCount = Array.isArray(netAssetValueSummary) ? netAssetValueSummary.length : (netAssetValueSummary ? 1 : 0);
      console.log(`[PARSER] ✓ Account ${accountId}: Found ${equityCount} EquitySummary entries, ${navCount} NetAssetValueSummary entries`);
    }

    // Process ChangeInNAV (if available)
    let processedChangeInNAV: ProcessedChangeInNAV;
    
    if (changeInNAV) {
      // Note: ChangeInNAV doesn't have fxRateToBase, so we use 1 for USD or need to get it from positions
      let fxRate = 1;
      const changeInNAVCurrency = changeInNAV.currency || currency;
      if (changeInNAVCurrency !== "USD" && openPositions.length > 0) {
        // Try to get fxRate from first position
        const firstPos = openPositions[0];
        fxRate = toNumber(firstPos.fxRateToBase || "1", 1);
      }

      processedChangeInNAV = {
        fromDate: parseIBKRDate(changeInNAV.fromDate || statement.fromDate),
        toDate: parseIBKRDate(changeInNAV.toDate || statement.toDate),
        startingValue: toNumber(changeInNAV.startingValue),
        endingValue: toNumber(changeInNAV.endingValue),
        depositsWithdrawals: toNumber(changeInNAV.depositsWithdrawals),
        dividends: toNumber(changeInNAV.dividends),
        interest: toNumber(changeInNAV.interest),
        commissions: toNumber(changeInNAV.commissions),
        withholdingTax: toNumber(changeInNAV.withholdingTax),
        otherFees: toNumber(changeInNAV.otherFees),
        twr: toNumber(changeInNAV.twr),
        fxRateToBase: fxRate,
      };
    } else {
      // Create a minimal ChangeInNAV if missing
      console.warn(`[PARSER] ⚠️ Account ${accountId}: Creating minimal ChangeInNAV structure (missing in XML)`);
      processedChangeInNAV = {
        fromDate: parseIBKRDate(statement.fromDate),
        toDate: parseIBKRDate(statement.toDate),
        startingValue: 0,
        endingValue: 0,
        depositsWithdrawals: 0,
        dividends: 0,
        interest: 0,
        commissions: 0,
        withholdingTax: 0,
        otherFees: 0,
        twr: 0,
        fxRateToBase: 1,
      };
    }

    // Process OpenPositions
    const processedOpenPositions: ProcessedOpenPosition[] = openPositions.map(
      (pos) => ({
        symbol: pos.symbol || "",
        description: pos.description || "",
        position: toNumber(pos.position),
        markPrice: toNumber(pos.markPrice),
        positionValue: toNumber(pos.positionValue),
        costBasisMoney: toNumber(pos.costBasisMoney),
        fifoPnlUnrealized: toNumber(pos.fifoPnlUnrealized),
        percentOfNAV: toNumber(pos.percentOfNAV),
        currency: pos.currency || "USD",
        fxRateToBase: toNumber(
          pos.currency === "USD" ? "1" : pos.fxRateToBase || "1",
          1
        ),
        conid: pos.conid || undefined,
      })
    );

    // Process Trades
    const processedTrades: ProcessedTrade[] = trades.map((trade) => ({
      symbol: trade.symbol || "",
      tradeDate: parseIBKRDate(trade.tradeDate || trade.reportDate),
      quantity: toNumber(trade.quantity),
      tradePrice: toNumber(trade.tradePrice),
      proceeds: toNumber(trade.proceeds),
      commissions: Math.abs(toNumber(trade.ibCommission)),
      buySell: trade.buySell || "",
      currency: trade.currency || "USD",
      fxRateToBase: toNumber(
        trade.currency === "USD" ? "1" : trade.fxRateToBase || "1",
        1
      ),
      tradeID: trade.tradeID || undefined,
    }));

    // Process CashTransactions
    // CRITICAL: Use settleDate or dateTime (actual transaction date), NOT reportDate (report generation date)
    // reportDate is when the XML report was generated, not when the transaction occurred
    // For deposits/withdrawals, we need the actual transaction date to match with EquitySummary dates
    const processedCashTransactions: ProcessedCashTransaction[] =
      cashTransactions.map((ct) => {
        // IMPORTANT: reportDate is the XML report generation date, NOT the transaction date
        // For deposits/withdrawals, we must use settleDate or dateTime which is the actual transaction date
        // Priority: settleDate > dateTime > reportDate (fallback only)
        let transactionDate: Date;
        let dateSource = "";
        
        if (ct.settleDate && String(ct.settleDate).length === 8) {
          // Use settleDate (YYYYMMDD format) - this is the actual transaction settlement date
          transactionDate = parseIBKRDate(String(ct.settleDate));
          dateSource = "settleDate";
        } else if (ct.dateTime && String(ct.dateTime).trim().length > 0) {
          // Use dateTime (YYYYMMDD;HHMMSS or YYYYMMDD format) - this is when the transaction occurred
          transactionDate = parseIBKRDateTime(ct.dateTime);
          dateSource = "dateTime";
        } else if (ct.reportDate && String(ct.reportDate).length === 8) {
          // Fallback to reportDate only if settleDate and dateTime are not available
          // This is not ideal but better than having no date
          transactionDate = parseIBKRDate(String(ct.reportDate));
          dateSource = "reportDate (fallback)";
        } else {
          // Last resort: use current date (shouldn't happen with valid IBKR data)
          console.warn(`Warning: CashTransaction missing date fields. Using current date. Transaction: ${ct.type}, Amount: ${ct.amount}`);
          console.warn(`  settleDate: ${ct.settleDate}, dateTime: ${ct.dateTime}, reportDate: ${ct.reportDate}`);
          transactionDate = new Date();
          dateSource = "current date (error)";
        }
        
        // Debug: Log date field values for deposits/withdrawals to identify date parsing issues
        const isDepositWithdrawal = (ct.type || "").toLowerCase().includes("deposit") || 
                                   (ct.type || "").toLowerCase().includes("withdrawal") ||
                                   (ct.type || "").toLowerCase() === "deposits/withdrawals";
        if (isDepositWithdrawal && Math.abs(toNumber(ct.amount)) > 10000) {
          console.log(`  CashTransaction Date Debug: type=${ct.type}, amount=${ct.amount}`);
          console.log(`    settleDate: "${ct.settleDate}" (length: ${String(ct.settleDate || "").length})`);
          console.log(`    dateTime: "${ct.dateTime}" (length: ${String(ct.dateTime || "").length})`);
          console.log(`    reportDate: "${ct.reportDate}" (length: ${String(ct.reportDate || "").length})`);
          console.log(`    Using: ${dateSource} -> ${transactionDate.toISOString().split("T")[0]}`);
        }
        
        return {
          date: transactionDate,
          amount: toNumber(ct.amount),
          type: ct.type || "",
          description: ct.description || "",
          symbol: ct.symbol || "",
          currency: ct.currency || "USD",
          fxRateToBase: toNumber(
            ct.currency === "USD" ? "1" : ct.fxRateToBase || "1",
            1
          ),
          transactionID: ct.transactionID || undefined,
        };
      });

    // Process Transfers - capture internal transfers for migration handling
    const processedTransfers: ProcessedTransfer[] = transfers.map((transfer: Transfer) => {
      // Prefer settleDate (actual transfer date), fallback to dateTime or reportDate
      let transferDate: Date;
      if (transfer.settleDate && String(transfer.settleDate).length === 8) {
        transferDate = parseIBKRDate(String(transfer.settleDate));
      } else if (transfer.dateTime) {
        transferDate = parseIBKRDateTime(transfer.dateTime);
      } else if (transfer.reportDate && String(transfer.reportDate).length === 8) {
        transferDate = parseIBKRDate(String(transfer.reportDate));
      } else {
        transferDate = new Date();
      }
      
      // For INTERNAL transfers, use cashTransfer attribute; otherwise use amount
      const transferType = (transfer.type || "").toLowerCase();
      const cashTransferAmount = transfer.cashTransfer !== undefined ? toNumber(transfer.cashTransfer) : 0;
      const amountValue = transfer.amount !== undefined ? toNumber(transfer.amount) : 0;
      
      // Prefer cashTransfer for INTERNAL transfers, fallback to amount
      const transferAmount = (transferType === "internal" && cashTransferAmount !== 0) 
        ? cashTransferAmount 
        : (amountValue !== 0 ? amountValue : cashTransferAmount);
      
      return {
        date: transferDate,
        amount: transferAmount,
        type: transfer.type || "",
        direction: transfer.direction || "",
        description: transfer.description || "",
        currency: transfer.currency || "USD",
        fxRateToBase: toNumber(
          transfer.currency === "USD" ? "1" : transfer.fxRateToBase || "1",
          1
        ),
        fromAccount: transfer.fromAccount || undefined,
        toAccount: transfer.toAccount || undefined,
        transactionID: transfer.transactionID || undefined,
      };
    });

    // Ensure currency is always set
    const accountCurrency = changeInNAV?.currency || 
                            (statement as any).currency || 
                            "USD";
    
    // Final account info - prioritize AccountInformation
    const finalAccountId = accountInfo?.accountId || 
                          changeInNAV?.accountId || 
                          statement.accountId || 
                          accountId;
    const finalAccountAlias = accountInfo?.acctAlias || 
                             changeInNAV?.acctAlias || 
                             accountAlias;
    
    console.log(`[PARSER] ✓ Account ${finalAccountId}: Processing complete (currency: ${currency})`);
    
    return {
      accountId: finalAccountId,
      accountAlias: finalAccountAlias,
      currency: currency,
      changeInNAV: processedChangeInNAV,
      openPositions: processedOpenPositions,
      trades: processedTrades,
      cashTransactions: processedCashTransactions,
      transfers: processedTransfers,
    };
  });
}

/**
 * Parse all XML files in the data directory
 */
export function parseAllIBKRFiles(dataDir: string = "data/ibkr_uploads"): ProcessedAccount[] {
  console.log(`parseAllIBKRFiles called with: ${dataDir}`);
  
  let files: string[];
  try {
    files = readdirSync(dataDir).filter((file) => file.endsWith(".xml"));
  } catch (error) {
    console.error(`Error reading directory ${dataDir}:`, error);
    throw new Error(`Cannot read directory ${dataDir}: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  const allAccounts: ProcessedAccount[] = [];

  console.log(`Found ${files.length} XML files in ${dataDir}:`, files);
  if (files.length !== 7) {
    console.warn(`⚠️ Expected 7 XML files but found ${files.length}. Please verify all files are present.`);
  }

  for (const file of files) {
    try {
      const filePath = join(dataDir, file);
      console.log(`Parsing ${file}...`);
      const accounts = parseIBKRXML(filePath);
      console.log(`  Parsed ${accounts.length} account(s) from ${file}`);
      allAccounts.push(...accounts);
    } catch (error) {
      console.error(`Error parsing ${file}:`, error);
      if (error instanceof Error) {
        console.error(`  Error message: ${error.message}`);
        console.error(`  Stack: ${error.stack}`);
      }
    }
  }

  console.log(`Total accounts parsed: ${allAccounts.length}`);
  return allAccounts;
}

