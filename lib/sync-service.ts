import { loadEnv } from './env';
loadEnv(); // Load environment variables

import { getDatabase, accountQueries, navQueries, tradeQueries, transactionQueries, changeInNAVQueries, cashQueries } from './database';
import { parseIBKRXML } from './parser';
import { startOfDay } from 'date-fns';
import { parseIBKRDate } from './parser';
import { differenceInDays } from 'date-fns';
import { XMLParser } from 'fast-xml-parser';
import { formatCurrency } from './utils';

interface PortfolioConfig {
  name: string;
  accountId: string;
  token: string;
  queryId: string;
}

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
 * Load portfolio configurations from environment variables
 */
export function loadPortfolioConfigs(): PortfolioConfig[] {
  // Force reload env before loading configs
  loadEnv();
  
  const count = parseInt(process.env.PORTFOLIO_COUNT || '0', 10);
  const portfolios: PortfolioConfig[] = [];

  console.log(`[SYNC] loadPortfolioConfigs: PORTFOLIO_COUNT = ${process.env.PORTFOLIO_COUNT || 'undefined'}`);
  console.log(`[SYNC] loadPortfolioConfigs: typeof PORTFOLIO_COUNT = ${typeof process.env.PORTFOLIO_COUNT}`);
  
  // Debug: List all env vars that start with "P" to see what's available
  const portfolioEnvVars = Object.keys(process.env).filter(key => key.startsWith('P') && /^P\d+/.test(key));
  if (portfolioEnvVars.length > 0) {
    console.log(`[SYNC] Found portfolio env vars: ${portfolioEnvVars.join(', ')}`);
  } else {
    console.warn(`[SYNC] ⚠️ No portfolio env vars found (P1_*, P2_*, etc.)`);
  }

  for (let i = 1; i <= count; i++) {
    const name = process.env[`P${i}_NAME`];
    const accountId = process.env[`P${i}_ACCOUNT_ID`];
    const token = process.env[`P${i}_TOKEN`];
    const queryId = process.env[`P${i}_QUERY_ID`];

    console.log(`[SYNC] Portfolio ${i}:`);
    console.log(`[SYNC]   P${i}_NAME: ${name ? 'SET' : 'NOT SET'}`);
    console.log(`[SYNC]   P${i}_ACCOUNT_ID: ${accountId ? 'SET' : 'NOT SET'}`);
    console.log(`[SYNC]   P${i}_TOKEN: ${token ? 'SET (***masked***)' : 'NOT SET'}`);
    console.log(`[SYNC]   P${i}_QUERY_ID: ${queryId ? 'SET' : 'NOT SET'}`);

    if (name && accountId && token && queryId) {
      portfolios.push({ name, accountId, token, queryId });
      console.log(`[SYNC] ✓ Added portfolio ${i}: ${name} (${accountId})`);
    } else {
      console.warn(`[SYNC] ⚠️ Portfolio ${i} is missing required fields (name, accountId, token, or queryId)`);
    }
  }

  return portfolios;
}

/**
 * Extract Reference Code from SendRequest XML response
 */
function extractReferenceCode(xmlText: string): string | null {
  // Look for <ReferenceCode> tag
  const refCodeMatch = xmlText.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/i);
  if (refCodeMatch && refCodeMatch[1]) {
    return refCodeMatch[1].trim();
  }
  
  // Also check for alternative format (attributes, etc.)
  const refCodeMatch2 = xmlText.match(/ReferenceCode[=\s]*(["\']?)([^"'\s<>]+)\1/i);
  if (refCodeMatch2 && refCodeMatch2[2]) {
    return refCodeMatch2[2].trim();
  }
  
  return null;
}

/**
 * Check if XML response indicates statement is not ready
 */
function isStatementNotReady(xmlText: string): boolean {
  const lowerXml = xmlText.toLowerCase();
  // Check for various "not ready" indicators
  return lowerXml.includes('statement not ready') ||
         lowerXml.includes('not ready') ||
         lowerXml.includes('processing') ||
         lowerXml.includes('pending') ||
         lowerXml.includes('statement generation in progress') ||
         lowerXml.includes('errorcode') && (lowerXml.includes('1019') || lowerXml.includes('1020')) ||
         lowerXml.includes('"status": "warn"') ||
         lowerXml.includes('<status>warn</status>');
}

/**
 * Fetch Flex Query XML from IBKR API (Two-Step Process)
 * Step 1: SendRequest to get ReferenceCode
 * Step 2: GetStatement with ReferenceCode to get actual XML
 * 
 * IMPORTANT: IBKR Flex Query API does NOT support date parameters in the URL.
 * The date range must be configured in the Flex Query definition in IBKR portal.
 * 
 * @param token - IBKR Flex Query token
 * @param queryId - IBKR Flex Query ID
 * @param fromDate - Optional start date (for logging only - Flex Query date range must be configured in IBKR portal)
 * @param toDate - Optional end date (for logging only - Flex Query date range must be configured in IBKR portal)
 */
async function fetchFlexQueryXML(token: string, queryId: string, fromDate?: Date, toDate?: Date): Promise<string> {
  console.log(`[FlexQuery] Step 1: Sending request for query ${queryId}...`);
  
  // Format dates as YYYYMMDD for logging
  const formatIBKRDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };
  
  // Log expected date range (user should configure Flex Query in IBKR portal to match)
  if (fromDate || toDate) {
    console.log(`[FlexQuery] ⚠️  IMPORTANT: Flex Query date range must be configured in IBKR portal`);
    if (fromDate) {
      console.log(`[FlexQuery]    Expected from date: ${formatIBKRDate(fromDate)} (${fromDate.toISOString().split('T')[0]})`);
    }
    if (toDate) {
      console.log(`[FlexQuery]    Expected to date: ${formatIBKRDate(toDate)} (${toDate.toISOString().split('T')[0]})`);
    }
    console.log(`[FlexQuery]    Ensure your Flex Query in IBKR portal covers this date range`);
  } else {
    console.log(`[FlexQuery] Using Flex Query's configured date range from IBKR portal`);
  }
  
  // IBKR Flex Query API does NOT support date parameters in URL
  // The date range is configured in the Flex Query definition in IBKR portal
  const sendRequestUrl = `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=${token}&q=${queryId}&v=3`;
  
  const sendResponse = await fetch(sendRequestUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/xml',
    },
  });

  if (!sendResponse.ok) {
    throw new Error(`IBKR SendRequest error: ${sendResponse.status} ${sendResponse.statusText}`);
  }

  const sendResponseText = await sendResponse.text();
  
  if (!sendResponseText || sendResponseText.trim().length === 0) {
    throw new Error('Empty response from IBKR SendRequest');
  }

  // Check for errors in SendRequest response
  if (sendResponseText.includes('<Error>') || sendResponseText.toLowerCase().includes('error')) {
    const errorMatch = sendResponseText.match(/<Error>([^<]+)<\/Error>/i);
    if (errorMatch) {
      throw new Error(`IBKR SendRequest error: ${errorMatch[1]}`);
    }
    throw new Error('IBKR SendRequest returned an error response');
  }

  // Extract ReferenceCode
  const referenceCode = extractReferenceCode(sendResponseText);
  
  if (!referenceCode) {
    console.error('[FlexQuery] SendRequest response:', sendResponseText.substring(0, 500));
    throw new Error('Could not extract ReferenceCode from SendRequest response');
  }

  console.log(`[FlexQuery] Step 1 complete. ReferenceCode: ${referenceCode}`);
  console.log(`[FlexQuery] Step 2: Fetching statement with ReferenceCode...`);

  // Step 2: GetStatement with ReferenceCode
  const getStatementUrl = `https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?t=${token}&q=${referenceCode}&v=3`;
  
  // Retry logic: Sometimes IBKR takes a few seconds to prepare the statement
  const maxRetries = 3;
  const retryDelay = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[FlexQuery] Retry attempt ${attempt}/${maxRetries} after ${retryDelay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }

      const getResponse = await fetch(getStatementUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml',
        },
      });

      if (!getResponse.ok) {
        throw new Error(`IBKR GetStatement error: ${getResponse.status} ${getResponse.statusText}`);
      }

      const xmlText = await getResponse.text();
      
      if (!xmlText || xmlText.trim().length === 0) {
        throw new Error('Empty response from IBKR GetStatement');
      }

      // Check for FlexStatementResponse error structure (ErrorCode 1019 = Statement generation in progress)
      // This happens when IBKR hasn't finished generating the statement yet
      if (xmlText.includes('<FlexStatementResponse>') || xmlText.includes('FlexStatementResponse')) {
        const xmlParser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '',
          parseAttributeValue: true,
          trimValues: true,
        });
        
        try {
          const parsed = xmlParser.parse(xmlText);
          if (parsed.FlexStatementResponse) {
            const status = parsed.FlexStatementResponse.Status;
            const errorCode = parsed.FlexStatementResponse.ErrorCode;
            const errorMsg = parsed.FlexStatementResponse.ErrorMessage || '';
            
            // ErrorCode 1019 = Statement generation in progress
            if (errorCode === 1019 || errorCode === '1019' || 
                (status && status.toLowerCase() === 'warn') ||
                errorMsg.toLowerCase().includes('statement generation in progress')) {
              if (attempt < maxRetries) {
                console.log(`[FlexQuery] Statement generation in progress (ErrorCode ${errorCode}), will retry in ${retryDelay}ms...`);
                continue; // Retry
              } else {
                throw new Error(`Statement generation still in progress after ${maxRetries} attempts: ${errorMsg}`);
              }
            }
            
            // Other errors - throw immediately
            if (status && status.toLowerCase() === 'error') {
              throw new Error(`IBKR GetStatement error (Code ${errorCode}): ${errorMsg}`);
            }
          }
        } catch (parseError) {
          // If parsing fails, continue to normal flow (might be valid XML)
          console.log('[FlexQuery] Could not parse as FlexStatementResponse, continuing...');
        }
      }

      // Check if statement is not ready yet (other formats)
      if (isStatementNotReady(xmlText)) {
        if (attempt < maxRetries) {
          console.log(`[FlexQuery] Statement not ready, will retry in ${retryDelay}ms...`);
          continue; // Retry
        } else {
          throw new Error('Statement not ready after maximum retries');
        }
      }

      // Check for errors in GetStatement response
      if (xmlText.includes('<Error>') || xmlText.toLowerCase().includes('<error>')) {
        const errorMatch = xmlText.match(/<Error>([^<]+)<\/Error>/i) || 
                          xmlText.match(/<error>([^<]+)<\/error>/i);
        if (errorMatch) {
          const errorMsg = errorMatch[1].trim();
          if (errorMsg.toLowerCase().includes('not ready') && attempt < maxRetries) {
            console.log(`[FlexQuery] Statement not ready: ${errorMsg}, will retry...`);
            continue; // Retry
          }
          throw new Error(`IBKR GetStatement error: ${errorMsg}`);
        }
      }

      // Success! We have the final XML
      console.log(`[FlexQuery] Step 2 complete. Received XML (${xmlText.length} bytes)`);
      return xmlText;

    } catch (error) {
      // If it's the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }
      
      // For other errors, check if it's a "not ready" type error
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.toLowerCase().includes('not ready') || 
          errorMsg.toLowerCase().includes('processing') ||
          errorMsg.toLowerCase().includes('pending')) {
        console.log(`[FlexQuery] Statement not ready: ${errorMsg}, will retry...`);
        continue; // Retry
      }
      
      // For unexpected errors, throw immediately (don't retry)
      throw error;
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new Error('Failed to fetch Flex Query XML after all retries');
}

/**
 * Check for gaps in DailyNAV data and determine sync date range
 * 
 * This function checks:
 * 1. If account has any data
 * 2. If there's a gap between latest date and today (> 1 day)
 * 3. If there are missing dates within the existing date range (e.g., Jan 7-8 missing)
 */
export async function checkDataGaps(accountId: string): Promise<{ needsSync: boolean; fromDate: Date | null; toDate: Date }> {
  const result = await navQueries.getLatest() as Array<{ account_id: string; max_date: string | null }>;
  
  const accountLatest = result.find(r => r.account_id === accountId);
  const latestDate = accountLatest?.max_date;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (!latestDate) {
    // No data exists - sync from 1 year ago
    console.log(`[checkDataGaps] Account ${accountId}: No data found, syncing from 1 year ago`);
    const fromDate = new Date(today);
    fromDate.setFullYear(fromDate.getFullYear() - 1);
    return { needsSync: true, fromDate, toDate: today };
  }
  
  const latestDateObj = new Date(latestDate);
  latestDateObj.setHours(0, 0, 0, 0);
  
  const daysSinceLatest = differenceInDays(today, latestDateObj);
  
  console.log(`[checkDataGaps] Account ${accountId}: Latest date: ${latestDate}, Today: ${today.toISOString().split('T')[0]}, Days since latest: ${daysSinceLatest}`);
  
  // Get all NAV dates for this account to check for gaps
  const navRecords = await navQueries.getByAccount(accountId) as Array<{ date: string; nav_value: number }>;
  
  console.log(`[checkDataGaps] Account ${accountId}: Found ${navRecords.length} NAV record(s) in database`);
  
  // Check for gaps: if latest date is more than 1 day ago, we need to sync
  // Note: We use > 1 instead of > 0 to account for:
  // - Today: latest is yesterday (1 day ago) = up to date
  // - Today: latest is today (0 days ago) = up to date  
  // - Today: latest is 2+ days ago (2+ days gap) = needs sync
  if (daysSinceLatest > 1) {
    // Gap exists between latest date and today - sync from day after latest date
    const fromDate = new Date(latestDateObj);
    fromDate.setDate(fromDate.getDate() + 1);
    console.log(`[checkDataGaps] ✓ Account ${accountId}: Gap detected! Latest date is ${daysSinceLatest} days ago.`);
    console.log(`[checkDataGaps]    Latest date: ${latestDate}`);
    console.log(`[checkDataGaps]    Today: ${today.toISOString().split('T')[0]}`);
    console.log(`[checkDataGaps]    Syncing from ${fromDate.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);
    return { needsSync: true, fromDate, toDate: today };
  }
  
  // Also check for missing dates within the existing data range
  // This catches cases where we have Jan 6 and Jan 9, but are missing Jan 7-8
  // This check runs even if daysSinceLatest <= 1, because there might be internal gaps
  if (navRecords.length > 0) {
    // Sort by date
    navRecords.sort((a, b) => a.date.localeCompare(b.date));
    
    const sortedDates = navRecords.map(r => r.date);
    if (sortedDates.length > 0) {
      console.log(`[checkDataGaps] Account ${accountId}: Date range in database: ${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`);
    }
    
    // Check for gaps between consecutive dates (more than 1 day apart, excluding weekends)
    const missingDates: string[] = [];
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 30); // Only check for gaps in last 30 days
    recentDate.setHours(0, 0, 0, 0);
    
    console.log(`[checkDataGaps] Account ${accountId}: Checking for internal gaps in last 30 days (from ${recentDate.toISOString().split('T')[0]})...`);
    
    for (let i = 0; i < navRecords.length - 1; i++) {
      const currentDate = new Date(navRecords[i].date);
      currentDate.setHours(0, 0, 0, 0);
      const nextDate = new Date(navRecords[i + 1].date);
      nextDate.setHours(0, 0, 0, 0);
      const gapDays = differenceInDays(nextDate, currentDate);
      
      // If there's a gap of more than 1 day between consecutive records
      const currentDay = currentDate.getDay(); // 0=Sunday, 5=Friday, 6=Saturday
      const nextDay = nextDate.getDay();
      
      // Improved weekend gap detection:
      // - Fri (5) to Mon (1) = 3 days gap (weekend, skip)
      // - Thu (4) to Mon (1) = 4 days gap (weekend + holiday, skip if nextDate is Mon)
      // - Sat (6) to Mon (1) = 2 days gap (weekend, skip)
      // - Sun (0) to Tue (2) = 2 days gap (weekend, skip)
      const isWeekendGap = 
        (currentDay === 5 && gapDays === 3 && nextDay === 1) || // Fri to Mon (3 days)
        (currentDay === 6 && gapDays === 2 && nextDay === 1) || // Sat to Mon (2 days)
        (currentDay === 0 && gapDays === 2 && nextDay === 2) || // Sun to Tue (2 days)
        (currentDay === 5 && gapDays === 4 && nextDay === 1) || // Fri to Mon after holiday (4 days)
        (currentDay === 4 && gapDays === 4 && nextDay === 1);   // Thu to Mon after holiday (4 days)
      
      // Check if this gap is recent (within last 30 days)
      const isRecentGap = currentDate >= recentDate || nextDate >= recentDate;
      
      if (gapDays > 1 && !isWeekendGap && isRecentGap) {
        // Not a weekend gap and it's recent - might be missing data
        console.log(`[checkDataGaps] ⚠️ Account ${accountId}: Internal gap detected between ${navRecords[i].date} and ${navRecords[i + 1].date} (${gapDays} days)`);
        console.log(`[checkDataGaps]    Current day: ${currentDay} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDay]}), Next day: ${nextDay} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][nextDay]})`);
        console.log(`[checkDataGaps]    Is weekend gap: ${isWeekendGap}, Is recent: ${isRecentGap}`);
        
        // Find all missing dates in this gap
        const tempDate = new Date(currentDate);
        tempDate.setDate(tempDate.getDate() + 1);
        while (tempDate < nextDate) {
          const dateKey = tempDate.toISOString().split('T')[0];
          const dayOfWeek = tempDate.getDay();
          const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
          // Only add weekdays (Mon-Fri) to missing dates, as weekends are expected gaps
          if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            missingDates.push(dateKey);
            console.log(`[checkDataGaps]    Missing weekday: ${dateKey} (${dayName})`);
          } else {
            console.log(`[checkDataGaps]    Skipping weekend: ${dateKey} (${dayName})`);
          }
          tempDate.setDate(tempDate.getDate() + 1);
        }
      } else if (gapDays > 1 && isRecentGap) {
        console.log(`[checkDataGaps] Account ${accountId}: Gap between ${navRecords[i].date} and ${navRecords[i + 1].date} (${gapDays} days) is a weekend gap, skipping`);
      }
    }
    
    // If we found missing dates, we should sync to fill them
    if (missingDates.length > 0) {
      // Find the earliest missing date
      const sortedMissingDates = missingDates.sort();
      const earliestMissingDate = new Date(sortedMissingDates[0]);
      earliestMissingDate.setHours(0, 0, 0, 0);
      const fromDate = new Date(earliestMissingDate);
      fromDate.setDate(fromDate.getDate() - 1); // Start from day before first missing date to ensure we capture it
      fromDate.setHours(0, 0, 0, 0);
      
      console.log(`[checkDataGaps] ✓ Account ${accountId}: Found ${missingDates.length} missing weekday(s) in data range`);
      console.log(`[checkDataGaps]    Missing dates: ${sortedMissingDates.slice(0, 10).join(', ')}${sortedMissingDates.length > 10 ? ` ... (+${sortedMissingDates.length - 10} more)` : ''}`);
      console.log(`[checkDataGaps]    Syncing from ${fromDate.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);
      return { needsSync: true, fromDate, toDate: today };
    } else if (navRecords.length > 1) {
      console.log(`[checkDataGaps] Account ${accountId}: No internal gaps detected in recent dates`);
    }
  }
  
  console.log(`[checkDataGaps] ✓ Account ${accountId}: No sync needed (up to date, no gaps detected)`);
  console.log(`[checkDataGaps]    Latest date: ${latestDate}, Today: ${today.toISOString().split('T')[0]}, Days since latest: ${daysSinceLatest}`);
  return { needsSync: false, fromDate: null, toDate: today };
}

/**
 * Parse and store XML data into database
 */
async function storeXMLData(xmlText: string, portfolioConfig: PortfolioConfig): Promise<void> {
  
  // Write XML to temp file for parsing
  const fs = await import('fs/promises');
  const path = await import('path');
  const tempFile = path.join(process.cwd(), 'data', 'temp_sync.xml');
  
  await fs.writeFile(tempFile, xmlText, 'utf-8');
  
  try {
    console.log(`[SYNC] Parsing XML for ${portfolioConfig.name} (${portfolioConfig.accountId})...`);
    
    // Parse XML using existing parser
    const accounts = parseIBKRXML(tempFile);
    
    console.log(`[SYNC] Found ${accounts.length} account(s) in XML`);
    
    const account = accounts.find(acc => acc.accountId === portfolioConfig.accountId);
    if (!account) {
      console.error(`[SYNC] ❌ ${portfolioConfig.name} (${portfolioConfig.accountId}): Account not found in XML response`);
      console.error(`[SYNC]    Available account IDs: ${accounts.map(a => a.accountId).join(', ')}`);
      console.error(`[SYNC]    This may indicate the Flex Query doesn't include this account ID`);
      return;
    }
    
    console.log(`[SYNC] ✓ ${portfolioConfig.name}: Found account data (currency: ${account.currency})`);
    
    // Upsert account with safe currency fallback
    // Use currency from account, ChangeInNAV, or default to USD with optional chaining
    const currency = account.currency || 'USD';
    
    console.log(`[SYNC] Upserting account ${account.accountId} with currency: ${currency}`);
    
    if (!account.changeInNAV) {
      console.error(`[SYNC] ERROR: Account ${account.accountId} has no ChangeInNAV data!`);
      console.error(`[SYNC] Account structure:`, {
        accountId: account.accountId,
        accountAlias: account.accountAlias,
        currency: account.currency,
        hasChangeInNAV: !!account.changeInNAV,
        hasOpenPositions: account.openPositions?.length > 0,
        hasTrades: account.trades?.length > 0,
        hasCashTransactions: account.cashTransactions?.length > 0,
      });
      throw new Error(`Account ${account.accountId} has no ChangeInNAV data. Cannot proceed with sync.`);
    }
    
    await accountQueries.upsert(
      account.accountId,
      account.accountAlias || account.accountId,
      currency
    );
    
    // Store DailyNAV from EquitySummaryByReportDateInBase
    // Parse EquitySummary from XML directly
    const xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseAttributeValue: true,
      trimValues: true,
      removeNSPrefix: true,
      parseTagValue: true,
    });
    
    const parsed = xmlParser.parse(xmlText);
    const flexStatements = parsed.FlexQueryResponse?.FlexStatements?.FlexStatement;
    const statements = Array.isArray(flexStatements) ? flexStatements : [flexStatements].filter(Boolean);
    
    let navEntriesCount = 0;
    
    for (const statement of statements) {
      // Get account ID from multiple possible sources
      const stmtAccountId = statement.accountId || 
                           statement.AccountInformation?.accountId || 
                           (statement.ChangeInNAV as any)?.accountId;
      
      if (stmtAccountId !== portfolioConfig.accountId) continue;
      
      // Try EquitySummaryByReportDateInBase first
      const equitySummary = statement.EquitySummaryInBase?.EquitySummaryByReportDateInBase;
      if (equitySummary) {
        const entries = Array.isArray(equitySummary) ? equitySummary : [equitySummary];
        console.log(`[SYNC] Found ${entries.length} EquitySummaryByReportDateInBase entries for ${portfolioConfig.name}`);
        
        // Track dates to detect duplicates
        const dateNavMap = new Map<string, number>();
        
        for (const entry of entries) {
          if (entry.reportDate && entry.total !== undefined) {
            // Handle date - XML parser might return it as number or string
            let rawDate: string;
            if (typeof entry.reportDate === 'number') {
              // If it's a number, pad to 8 digits (e.g., 20250108)
              rawDate = String(entry.reportDate).padStart(8, '0');
            } else {
              rawDate = String(entry.reportDate).trim();
            }
            
            // Debug: Check raw date value and type
            console.log(`[SYNC]   DEBUG: entry.reportDate type=${typeof entry.reportDate}, rawDate="${rawDate}", length=${rawDate.length}`);
            console.log(`[SYNC]   DEBUG: Full entry keys: ${Object.keys(entry).join(', ')}`);
            
            // Validate date format before parsing
            if (rawDate.length !== 8 || !/^\d{8}$/.test(rawDate)) {
              console.error(`[SYNC]   ❌ Invalid date format: "${rawDate}" (from entry.reportDate: ${entry.reportDate})`);
              console.error(`[SYNC]   Entry structure:`, JSON.stringify(entry, null, 2));
              continue; // Skip this entry
            }
            
            let parsedDate: Date;
            try {
              parsedDate = parseIBKRDate(rawDate);
            } catch (error) {
              console.error(`[SYNC]   ❌ Failed to parse date "${rawDate}":`, error);
              continue; // Skip this entry
            }
            
            const dateStr = parsedDate.toISOString().split('T')[0];
            const navValue = parseFloat(String(entry.total)) || 0;
            
            // Log each entry being processed
            console.log(`[SYNC]   Entry: rawDate=${rawDate}, parsedDate=${dateStr}, nav=${navValue.toFixed(2)}`);
            
            // Check for duplicate dates
            if (dateNavMap.has(dateStr)) {
              const existingNav = dateNavMap.get(dateStr)!;
              if (Math.abs(existingNav - navValue) > 0.01) {
                console.warn(`[SYNC]   ⚠️ Duplicate date ${dateStr} with different NAV values: ${existingNav.toFixed(2)} vs ${navValue.toFixed(2)}`);
                console.warn(`[SYNC]   Using the latest value: ${navValue.toFixed(2)}`);
              } else {
                console.log(`[SYNC]   ℹ️ Duplicate date ${dateStr} with same NAV (${navValue.toFixed(2)}), skipping`);
                continue; // Skip duplicate with same NAV
              }
            }
            
            dateNavMap.set(dateStr, navValue);
            
            // Include zeros for completeness
            await navQueries.upsert(account.accountId, dateStr, navValue);
            navEntriesCount++;
          } else {
            console.warn(`[SYNC]   ⚠️ Skipping entry: reportDate=${entry.reportDate}, total=${entry.total}`);
          }
        }
        
        // Log summary of dates being stored
        const sortedDates = Array.from(dateNavMap.keys()).sort();
        if (sortedDates.length > 0) {
          console.log(`[SYNC] Storing NAV for ${sortedDates.length} unique dates: ${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`);
          // Log first few and last few dates
          const firstFew = sortedDates.slice(0, 5);
          const lastFew = sortedDates.slice(-5);
          console.log(`[SYNC]   First dates: ${firstFew.join(', ')}`);
          console.log(`[SYNC]   Last dates: ${lastFew.join(', ')}`);
        }
      }
      
      // Also try NetAssetValueSummary if available
      const netAssetValueSummary = statement.NetAssetValueSummary;
      if (netAssetValueSummary) {
        const entries = Array.isArray(netAssetValueSummary) ? netAssetValueSummary : [netAssetValueSummary];
        console.log(`[SYNC] Found ${entries.length} NetAssetValueSummary entries for ${portfolioConfig.name}`);
        
        for (const entry of entries) {
          if (entry.reportDate && entry.total !== undefined) {
            const rawDate = entry.reportDate;
            const parsedDate = parseIBKRDate(rawDate);
            const dateStr = parsedDate.toISOString().split('T')[0];
            const navValue = parseFloat(entry.total) || 0;
            
            console.log(`[SYNC]   NetAssetValueSummary entry: rawDate=${rawDate}, parsedDate=${dateStr}, nav=${navValue.toFixed(2)}`);
            
            await navQueries.upsert(account.accountId, dateStr, navValue);
            navEntriesCount++;
          }
        }
      }
    }
    
    if (navEntriesCount === 0) {
      console.warn(`[SYNC] ⚠️ ${portfolioConfig.name}: No NAV entries found in Flex Query response!`);
      console.warn(`[SYNC]    Check if 'EquitySummaryByReportDateInBase' or 'NetAssetValueSummary' is enabled in Flex Query.`);
      console.warn(`[SYNC]    Verify the Flex Query date range includes the expected date range in IBKR portal.`);
      console.warn(`[SYNC]    IMPORTANT: IBKR Flex Query API does NOT support date parameters in URL.`);
      console.warn(`[SYNC]    The date range MUST be configured in the Flex Query definition in IBKR portal.`);
    } else {
      // Log the actual date range we received and check for gaps
      const allNavRecords = await navQueries.getByAccount(account.accountId) as Array<{ date: string; nav_value: number }>;
      
      if (allNavRecords.length > 0) {
        const sortedDates = allNavRecords.map(r => r.date).sort();
        const earliestDate = sortedDates[0];
        const latestDate = sortedDates[sortedDates.length - 1];
        console.log(`[SYNC] ✓ ${portfolioConfig.name}: Stored ${navEntriesCount} NAV entries (total: ${allNavRecords.length} dates in database)`);
        console.log(`[SYNC]    Date range in database: ${earliestDate} to ${latestDate}`);
        
        // Check for duplicate NAV values on consecutive dates (potential issue)
        const sortedRecords = allNavRecords.sort((a, b) => a.date.localeCompare(b.date));
        const duplicateNavDates: string[] = [];
        
        for (let i = 0; i < sortedRecords.length - 1; i++) {
          const current = sortedRecords[i];
          const next = sortedRecords[i + 1];
          const currentDate = new Date(current.date);
          const nextDate = new Date(next.date);
          const daysBetween = differenceInDays(nextDate, currentDate);
          
          // Check if consecutive dates (1 day apart) have the same NAV
          if (daysBetween === 1 && Math.abs(current.nav_value - next.nav_value) < 0.01) {
            duplicateNavDates.push(`${current.date} and ${next.date} (both ${current.nav_value.toFixed(2)})`);
          }
        }
        
        if (duplicateNavDates.length > 0) {
          console.warn(`[SYNC] ⚠️ ${portfolioConfig.name}: Found ${duplicateNavDates.length} consecutive date pairs with identical NAV values:`);
          duplicateNavDates.slice(0, 10).forEach(pair => {
            console.warn(`[SYNC]    ${pair}`);
          });
          if (duplicateNavDates.length > 10) {
            console.warn(`[SYNC]    ... and ${duplicateNavDates.length - 10} more`);
          }
          console.warn(`[SYNC]    This may indicate IBKR returned the same NAV for multiple dates.`);
          console.warn(`[SYNC]    Check the Flex Query response or IBKR portal to verify the data.`);
        }
        
        // Check for gaps in the received data
        if (allNavRecords.length > 1) {
          const missingDates: string[] = [];
          
          for (let i = 0; i < sortedRecords.length - 1; i++) {
            const currentDate = new Date(sortedRecords[i].date);
            const nextDate = new Date(sortedRecords[i + 1].date);
            const daysBetween = differenceInDays(nextDate, currentDate);
            
            // Check for missing business days (excluding weekends)
            if (daysBetween > 1) {
              // Check if it's a weekend gap (Fri to Mon = 3 days)
              const currentDay = currentDate.getDay(); // 0=Sunday, 5=Friday, 6=Saturday
              const isWeekendGap = currentDay === 5 && daysBetween === 3; // Fri to Mon
              
              if (!isWeekendGap) {
                // Not a normal weekend gap - might be missing dates
                const tempDate = new Date(currentDate);
                tempDate.setDate(tempDate.getDate() + 1);
                while (tempDate < nextDate) {
                  const dateKey = tempDate.toISOString().split('T')[0];
                  missingDates.push(dateKey);
                  tempDate.setDate(tempDate.getDate() + 1);
                }
              }
            }
          }
          
          if (missingDates.length > 0) {
            console.warn(`[SYNC] ⚠️ ${portfolioConfig.name}: Detected ${missingDates.length} potentially missing dates in database:`);
            console.warn(`[SYNC]    Missing dates: ${missingDates.slice(0, 10).join(', ')}${missingDates.length > 10 ? ` ... (+${missingDates.length - 10} more)` : ''}`);
            console.warn(`[SYNC]    These dates might be weekends/holidays, or IBKR Flex Query didn't return data for them.`);
            console.warn(`[SYNC]    Verify your Flex Query in IBKR portal is configured to return data for all business days.`);
          } else {
            console.log(`[SYNC] ✓ ${portfolioConfig.name}: No missing dates detected in data range`);
          }
        }
      }
    }
    
    // Store Transfers first (with deduplication)
    const { transferQueries, depositQueries, withdrawalQueries, dividendQueries, interestQueries, feeQueries, taxQueries, holdingQueries, tradeQueries, changeInNAVQueries } = await import('./database');
    const { categorizeTransaction } = await import('./transaction-categorizer');
    let transfersCount = 0;
    const processedTransferIds = new Set<string>();
    
    for (const transfer of account.transfers || []) {
      const dateStr = startOfDay(transfer.date).toISOString().split('T')[0];
      
      // DEDUPLICATION: Check if we've already processed this transfer in this batch
      if (transfer.transactionID) {
        const txKey = `${account.accountId}_${transfer.transactionID}`;
        if (processedTransferIds.has(txKey)) {
          console.log(`[SYNC] Skipping duplicate transfer: transaction_id=${transfer.transactionID}, date=${dateStr}, amount=${transfer.amount} (already processed in this batch)`);
          continue;
        }
        processedTransferIds.add(txKey);
      }
      
      // Check if a transfer with this transaction_id already exists in database
      if (transfer.transactionID) {
        const db = getDatabase();
        const existingRows = await db`
          SELECT id FROM "Transfers"
          WHERE account_id = ${account.accountId} AND transaction_id = ${transfer.transactionID}
        ` as Array<{ id: number }>;
        const existing = existingRows[0];

        if (existing) {
          console.log(`[SYNC] Skipping duplicate transfer: transaction_id=${transfer.transactionID} already exists in database (ID: ${existing.id})`);
          continue;
        }
      }
      
      try {
        await transferQueries.insert(
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
        transfersCount++;
      } catch (error: any) {
        // Handle unique constraint errors gracefully
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          console.log(`[SYNC] Skipping duplicate transfer: date=${dateStr}, amount=${transfer.amount}`);
          continue;
        }
        throw error;
      }
    }
    console.log(`[SYNC] ✓ ${portfolioConfig.name}: Stored ${transfersCount} transfers`);
    
    // Categorize and store transactions in appropriate tables
    const { deduplicateWithdrawals } = await import('./transaction-categorizer');
    
    // Collect all categorized transactions first
    const categorizedTransactions = {
      deposits: [] as Array<{ amount: number; date: string; description: string; currency: string; fxRateToBase: number; transactionId: string | null }>,
      withdrawals: [] as Array<{ amount: number; date: string; description: string; currency: string; fxRateToBase: number; transactionId: string | null }>,
      dividends: [] as Array<any>,
      interest: [] as Array<any>,
      fees: [] as Array<any>,
      taxes: [] as Array<any>,
    };
    
    for (const transaction of account.cashTransactions) {
      const categorized = categorizeTransaction(transaction, account.accountId, account.transfers || []);
      
      if (!categorized) {
        continue; // Skip if already in transfers or doesn't fit any category
      }
      
      const dateStr = startOfDay(transaction.date).toISOString().split('T')[0];
      const amountUSD = Math.abs(transaction.amount) * (transaction.fxRateToBase || 1.0);
      
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
      
      // Also keep in Transactions table for backward compatibility
      await transactionQueries.insert(
        account.accountId,
        transaction.type,
        transaction.amount,
        dateStr,
        transaction.description || null,
        transaction.symbol || null,
        transaction.transactionID || null
      );
    }
    
    // Deduplicate withdrawals (merge duplicate disbursements on consecutive days with same amount)
    const deduplicatedWithdrawals = deduplicateWithdrawals(categorizedTransactions.withdrawals);
    if (deduplicatedWithdrawals.length < categorizedTransactions.withdrawals.length) {
      console.log(`[SYNC] Deduplicated ${categorizedTransactions.withdrawals.length} withdrawals to ${deduplicatedWithdrawals.length} (removed ${categorizedTransactions.withdrawals.length - deduplicatedWithdrawals.length} duplicates)`);
    }
    
    // Now store all transactions
    let transactionsCount = 0;
    
    // Store deposits (skip duplicates by transaction_id)
    for (const deposit of categorizedTransactions.deposits) {
      try {
        await depositQueries.insert(
          account.accountId,
          deposit.amount,
          deposit.date,
          deposit.description,
          deposit.currency,
          deposit.fxRateToBase,
          deposit.transactionId
        );
        transactionsCount++;
      } catch (error: any) {
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          // Unique index on (account_id, transaction_id) prevents duplicates
          continue;
        }
        throw error;
      }
    }
    
    // Store withdrawals (deduplicated)
    for (const withdrawal of deduplicatedWithdrawals) {
      await withdrawalQueries.insert(
        account.accountId,
        withdrawal.amount,
        withdrawal.date,
        withdrawal.description,
        withdrawal.currency,
        withdrawal.fxRateToBase,
        withdrawal.transactionId
      );
      transactionsCount++;
    }
    
    // Store dividends
    for (const dividend of categorizedTransactions.dividends) {
      await dividendQueries.insert(
        account.accountId,
        dividend.amount,
        dividend.date,
        dividend.description,
        dividend.symbol,
        dividend.currency,
        dividend.fxRateToBase,
        dividend.transactionId
      );
      transactionsCount++;
    }
    
    // Store interest
    for (const interest of categorizedTransactions.interest) {
      await interestQueries.insert(
        account.accountId,
        interest.amount,
        interest.date,
        interest.description,
        interest.currency,
        interest.fxRateToBase,
        interest.transactionId
      );
      transactionsCount++;
    }
    
    // Store fees
    for (const fee of categorizedTransactions.fees) {
      await feeQueries.insert(
        account.accountId,
        fee.amount,
        fee.date,
        fee.description,
        fee.feeType,
        fee.currency,
        fee.fxRateToBase,
        fee.transactionId
      );
      transactionsCount++;
    }
    
    // Store taxes
    for (const tax of categorizedTransactions.taxes) {
      await taxQueries.insert(
        account.accountId,
        tax.amount,
        tax.date,
        tax.description,
        tax.taxType,
        tax.currency,
        tax.fxRateToBase,
        tax.transactionId
      );
      transactionsCount++;
    }
    
    console.log(`[SYNC] ✓ ${portfolioConfig.name}: Stored ${transactionsCount} categorized transactions`);
    
    // Store Trades
    let tradesCount = 0;
    for (const trade of account.trades) {
      const dateStr = startOfDay(trade.tradeDate).toISOString().split('T')[0];
      await tradeQueries.insert(
        account.accountId,
        trade.symbol,
        trade.quantity || 0,
        trade.tradePrice || 0,
        trade.commissions || 0,
        dateStr,
        0, // realized_pnl - calculated separately
        trade.tradeID || null
      );
      tradesCount++;
    }
    console.log(`[SYNC] ✓ ${portfolioConfig.name}: Stored ${tradesCount} trades`);
    
    // Store Holdings (open positions)
    const protectedAccounts = getProtectedHoldingsAccounts();
    const shouldProtectHoldings = protectedAccounts.has(account.accountId);
    
    if (shouldProtectHoldings) {
      console.log(`[SYNC] 🛡️ Holdings overwrite skipped for protected account ${account.accountId}`);
    } else if (account.openPositions && account.openPositions.length > 0) {
      console.log(`[SYNC] Storing ${account.openPositions.length} holdings for account ${account.accountId}`);
      
      // Delete existing holdings for this account (to replace with latest)
      await holdingQueries.deleteByAccount(account.accountId);
      
      let holdingsCount = 0;
      for (const position of account.openPositions) {
        // Use report date from ChangeInNAV if available, otherwise use today
        const reportDate = account.changeInNAV?.toDate 
          ? startOfDay(account.changeInNAV.toDate).toISOString().split('T')[0]
          : startOfDay(new Date()).toISOString().split('T')[0];
        
        console.log(`[SYNC]   - ${position.symbol}: ${position.position} @ ${position.positionValue} ${position.currency || 'USD'}`);
        
        await holdingQueries.upsert(
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
        holdingsCount++;
      }
      console.log(`[SYNC] ✓ ${portfolioConfig.name}: Stored ${holdingsCount} holdings`);
    } else {
      console.log(`[SYNC] ⚠️ ${portfolioConfig.name}: No holdings found in XML (openPositions: ${account.openPositions?.length || 0})`);
      console.log(`[SYNC]    This may indicate the Flex Query doesn't include 'OpenPositions' section. Check IBKR Flex Query configuration.`);
    }
    
    // Store cash balance
    if (account.changeInNAV) {
      const protectedCashAccounts = getProtectedCashAccounts();
      const shouldProtectCash = protectedCashAccounts.has(account.accountId);
      if (shouldProtectCash) {
        console.log(`[SYNC] 🛡️ Cash overwrite skipped for protected account ${account.accountId}`);
      } else {
      const reportDate = account.changeInNAV.toDate 
        ? startOfDay(account.changeInNAV.toDate).toISOString().split('T')[0]
        : startOfDay(new Date()).toISOString().split('T')[0];
      
      const navUSD = account.changeInNAV.endingValue * account.changeInNAV.fxRateToBase;
      const totalPositionValue = (account.openPositions || []).reduce(
        (sum, pos) => sum + (pos.positionValue * pos.fxRateToBase),
        0
      );
      const cashUSD = navUSD - totalPositionValue;
      
      // Check if there's an explicit cash position
      const cashPosition = (account.openPositions || []).find(
        pos => pos.symbol.toUpperCase() === 'USD' || 
               pos.symbol.toUpperCase() === 'CASH' ||
               pos.currency.toUpperCase() === 'USD' && pos.symbol === ''
      );
      
      const finalCashAmount = cashPosition ? (cashPosition.positionValue * cashPosition.fxRateToBase) : cashUSD;
      const cashCurrency = account.currency || 'USD';
      const cashFxRate = account.changeInNAV.fxRateToBase || 1.0;
      
      if (Math.abs(finalCashAmount) > 0.01 || cashPosition) {
        await cashQueries.upsert(
          account.accountId,
          finalCashAmount,
          cashCurrency,
          cashFxRate,
          reportDate
        );
        console.log(`[SYNC] ✓ Stored cash balance: ${formatCurrency(finalCashAmount)} (as of ${reportDate})`);
      }
      }
    }
    
    console.log(`[SYNC] ✅ ${portfolioConfig.name}: Sync complete for account ${account.accountId}`);
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tempFile);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Sync single portfolio
 */
export async function syncPortfolio(portfolioConfig: PortfolioConfig): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`[SYNC] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[SYNC] Checking portfolio: ${portfolioConfig.name} (${portfolioConfig.accountId})`);
    const { needsSync, fromDate, toDate } = await checkDataGaps(portfolioConfig.accountId);

    console.log(`[SYNC] checkDataGaps result for ${portfolioConfig.name}:`);
    console.log(`[SYNC]   needsSync: ${needsSync}`);
    console.log(`[SYNC]   fromDate: ${fromDate ? fromDate.toISOString().split('T')[0] : 'null'}`);
    console.log(`[SYNC]   toDate: ${toDate.toISOString().split('T')[0]}`);
    
    if (!needsSync) {
      console.log(`[SYNC] ${portfolioConfig.name}: No sync needed (data is up to date)`);
      return {
        success: true,
        message: `Portfolio ${portfolioConfig.name} is up to date`,
      };
    }
    
    console.log(`[SYNC] Syncing portfolio ${portfolioConfig.name} (${portfolioConfig.accountId})...`);
    if (fromDate) {
      console.log(`[SYNC]   Expected date range: ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`);
      console.log(`[SYNC]   ⚠️  IMPORTANT: Ensure your Flex Query in IBKR portal is configured to return data for this date range!`);
      console.log(`[SYNC]   The Flex Query date range must be set in IBKR portal (not in the API call)`);
      console.log(`[SYNC]   To fix missing dates: Go to IBKR Client Portal > Reports > Flex Queries`);
      console.log(`[SYNC]   Edit your Flex Query and set the date range to include: ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`);
    } else {
      console.log(`[SYNC]   Using Flex Query's configured date range from IBKR portal`);
    }
    
    // Fetch XML from IBKR API
    // NOTE: IBKR Flex Query API does NOT support date parameters in URL
    // The date range MUST be configured in the Flex Query definition in IBKR portal
    // We pass fromDate/toDate only for logging purposes
    const xmlText = await fetchFlexQueryXML(portfolioConfig.token, portfolioConfig.queryId, fromDate || undefined, toDate);
    
    // Parse and store data
    await storeXMLData(xmlText, portfolioConfig);
    
    return {
      success: true,
      message: `Portfolio ${portfolioConfig.name} synced successfully`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SYNC] ❌ Error syncing portfolio ${portfolioConfig.name}:`, message);
    return {
      success: false,
      message: `Failed to sync ${portfolioConfig.name}: ${message}`,
    };
  }
}

/**
 * Sync all portfolios
 */
export async function syncAllPortfolios(): Promise<Array<{ portfolio: string; success: boolean; message: string }>> {
  // Ensure env is loaded before loading configs
  loadEnv();
  
  // Debug: Check if .env.local exists
  const fs = require('fs');
  const path = require('path');
  const envLocalPath = path.join(process.cwd(), '.env.local');
  const envLocalExists = fs.existsSync(envLocalPath);
  console.log(`[SYNC] ===== SYNC ALL PORTFOLIOS =====`);
  console.log(`[SYNC] Checking environment configuration...`);
  console.log(`[SYNC] .env.local exists: ${envLocalExists}`);
  console.log(`[SYNC] .env.local path: ${envLocalPath}`);
  console.log(`[SYNC] process.cwd(): ${process.cwd()}`);
  
  // Debug: Show raw PORTFOLIO_COUNT before parsing
  console.log(`[SYNC] Raw process.env.PORTFOLIO_COUNT: "${process.env.PORTFOLIO_COUNT}"`);
  console.log(`[SYNC] Type: ${typeof process.env.PORTFOLIO_COUNT}`);
  
  const portfolios = loadPortfolioConfigs();
  console.log(`[SYNC] Loaded ${portfolios.length} portfolio configuration(s)`);
  
  if (portfolios.length === 0) {
    console.warn('[SYNC] ⚠️ No portfolios configured! Check PORTFOLIO_COUNT and P*_* env variables');
    console.log('[SYNC] PORTFOLIO_COUNT:', process.env.PORTFOLIO_COUNT || 'undefined');
    console.log('[SYNC] PORTFOLIO_COUNT type:', typeof process.env.PORTFOLIO_COUNT);
    console.log('[SYNC] P1_ACCOUNT_ID:', process.env.P1_ACCOUNT_ID ? 'SET' : 'NOT SET');
    console.log('[SYNC] P1_TOKEN:', process.env.P1_TOKEN ? 'SET' : 'NOT SET');
    console.log('[SYNC] P1_QUERY_ID:', process.env.P1_QUERY_ID ? 'SET' : 'NOT SET');
    console.log('[SYNC] P1_NAME:', process.env.P1_NAME ? 'SET' : 'NOT SET');
    
    // Additional diagnostic: Check if .env.local exists and has content
    if (envLocalExists) {
      try {
        const envContent = fs.readFileSync(envLocalPath, 'utf-8');
        const hasPortfolioCount = envContent.includes('PORTFOLIO_COUNT');
        const hasP1AccountId = envContent.includes('P1_ACCOUNT_ID');
        console.log(`[SYNC] .env.local file size: ${envContent.length} bytes`);
        console.log(`[SYNC] .env.local contains PORTFOLIO_COUNT: ${hasPortfolioCount}`);
        console.log(`[SYNC] .env.local contains P1_ACCOUNT_ID: ${hasP1AccountId}`);
        
        if (hasPortfolioCount) {
          const match = envContent.match(/PORTFOLIO_COUNT\s*=\s*(\d+)/);
          if (match) {
            console.log(`[SYNC] Found PORTFOLIO_COUNT in .env.local: ${match[1]}`);
          }
        }
      } catch (error) {
        console.error('[SYNC] Error reading .env.local:', error);
      }
    } else {
      console.warn('[SYNC] ⚠️ .env.local file not found!');
      console.warn('[SYNC] Please create .env.local file in the project root with PORTFOLIO_COUNT and P*_* variables.');
      console.warn('[SYNC] See ENV_TEMPLATE.md for the required format.');
    }
    
    return [];
  }
  
  const results = [];
  let syncAttemptedCount = 0;
  
  console.log(`[SYNC] Checking gaps and syncing ${portfolios.length} portfolio(s)...`);
  
  for (const portfolio of portfolios) {
    console.log(`[SYNC] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[SYNC] Checking portfolio: ${portfolio.name} (${portfolio.accountId})`);
    
    // Check for gaps first
    const { needsSync, fromDate, toDate } = await checkDataGaps(portfolio.accountId);
    
    if (needsSync) {
      syncAttemptedCount++;
      console.log(`[SYNC] Portfolio ${portfolio.name} needs sync - proceeding...`);
      const result = await syncPortfolio(portfolio);
      results.push({
        portfolio: portfolio.name,
        ...result,
      });
    } else {
      console.log(`[SYNC] Portfolio ${portfolio.name} does NOT need sync (up to date)`);
      results.push({
        portfolio: portfolio.name,
        success: true,
        message: `Portfolio ${portfolio.name} is up to date`,
      });
    }
  }
  
  console.log(`[SYNC] ===== SYNC COMPLETE =====`);
  console.log(`[SYNC] Total portfolios configured: ${portfolios.length}`);
  console.log(`[SYNC] Syncs attempted: ${syncAttemptedCount}`);
  const successfulSyncs = results.filter(r => r.success && r.message.includes('synced successfully')).length;
  const failedSyncs = results.filter(r => !r.success).length;
  const upToDateCount = results.filter(r => r.success && r.message.includes('up to date')).length;
  console.log(`[SYNC] Results breakdown:`);
  console.log(`[SYNC]   - Successfully synced: ${successfulSyncs}`);
  console.log(`[SYNC]   - Failed syncs: ${failedSyncs}`);
  console.log(`[SYNC]   - Already up to date (no sync needed): ${upToDateCount}`);
  console.log(`[SYNC]   - Total: ${results.length} portfolio(s)`);
  
  return results;
}

/**
 * Startup sync - check all portfolios and sync if needed
 */
export async function startupSync(): Promise<void> {
  console.log('🔍 Running startup sync check...');
  
  const portfolios = loadPortfolioConfigs();
  let syncedCount = 0;
  
  for (const portfolio of portfolios) {
    const { needsSync } = await checkDataGaps(portfolio.accountId);
    
    if (needsSync) {
      console.log(`🔄 Syncing ${portfolio.name}...`);
      const result = await syncPortfolio(portfolio);
      if (result.success) {
        syncedCount++;
      }
    } else {
      console.log(`✅ ${portfolio.name} is up to date`);
    }
  }
  
  console.log(`✅ Startup sync complete. ${syncedCount}/${portfolios.length} portfolios synced.`);
}

