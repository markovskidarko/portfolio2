import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "csv-parse/sync";
import { startOfDay, eachDayOfInterval, format } from "date-fns";
import type { EquityCurvePoint } from "./types";
import { formatCurrency } from "./utils";

export interface CSVPortfolioEntry {
  date: Date;
  account: string;
  type: string; // 'Deposit', 'Value', or empty
  portfolioValue: number;
  rawRow: any;
}

/**
 * Parse portfolio_history_feb_aug.csv
 * This CSV contains historical data from February to August 2024 for account U16030763
 */
export function parsePortfolioHistoryCSV(
  csvPath: string = "portfolio_history_feb_aug.csv"
): CSVPortfolioEntry[] {
  // Handle both absolute paths and relative paths
  // If csvPath is already absolute (starts with / or C:), use it directly
  // Otherwise, join with process.cwd()
  const fullPath = csvPath.startsWith('/') || csvPath.match(/^[A-Z]:/) 
    ? csvPath 
    : join(process.cwd(), csvPath);
  
  if (!existsSync(fullPath)) {
    console.warn(`⚠️ CSV file not found: ${fullPath}`);
    console.warn(`⚠️ Attempted path: ${csvPath}`);
    console.warn(`⚠️ Resolved to: ${fullPath}`);
    return [];
  }

  console.log(`=== PARSING CSV PORTFOLIO HISTORY ===`);
  console.log(`Reading CSV from: ${fullPath}`);

  try {
    const fileContent = readFileSync(fullPath, "utf-8");
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`Found ${records.length} rows in CSV`);

    const entries: CSVPortfolioEntry[] = [];

    for (const row of records) {
      // Parse date - handle various formats (MM/DD/YYYY, YYYY-MM-DD, etc.)
      // Handle various column name formats (case-insensitive)
      let date: Date;
      const dateStr = (row.Date || row.date || row["Date"] || row["date"] || "").trim();
      
      if (!dateStr) {
        console.warn(`⚠️ Skipping row with missing date:`, row);
        continue;
      }

      // Try different date formats
      if (dateStr.includes("/")) {
        // MM/DD/YYYY format
        const [month, day, year] = dateStr.split("/");
        date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
      } else if (dateStr.includes("-")) {
        // YYYY-MM-DD format
        const [year, month, day] = dateStr.split("-");
        date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
      } else {
        console.warn(`⚠️ Unknown date format: ${dateStr}, skipping row`);
        continue;
      }

      if (isNaN(date.getTime())) {
        console.warn(`⚠️ Invalid date: ${dateStr}, skipping row`);
        continue;
      }

      // Normalize date to start of day UTC
      date = startOfDay(date);

      // Handle various column name formats (case-insensitive, with/without spaces)
      const account = (row.Account || row.account || row["Account"] || "").trim();
      const type = (row.Type || row.type || row["Type"] || "").trim().toLowerCase();
      const portfolioValueStr = (
        row["Portfolio Value"] || 
        row["PortfolioValue"] || 
        row["portfolio value"] ||
        row["portfoliovalue"] ||
        row.portfolioValue || 
        row.Value || 
        row.value ||
        ""
      ).trim();
      
      // Remove $ and commas, parse as number
      const portfolioValue = parseFloat(String(portfolioValueStr).replace(/[$,\s]/g, "")) || 0;

      if (portfolioValue === 0 && type !== "deposit") {
        console.warn(`⚠️ Row with zero portfolio value (non-deposit): Date=${dateStr}, Account=${account}`);
      }

      entries.push({
        date,
        account,
        type,
        portfolioValue,
        rawRow: row,
      });
    }

    // Sort by date
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  console.log(`Parsed ${entries.length} valid entries from CSV`);
  if (entries.length > 0) {
    console.log(`Date range: ${format(entries[0]?.date || new Date(), "MMM dd, yyyy")} to ${format(entries[entries.length - 1]?.date || new Date(), "MMM dd, yyyy")}`);
    
    // Log unique accounts found
    const uniqueAccounts = new Set(entries.map(e => e.account));
    console.log(`Unique accounts found in CSV: ${Array.from(uniqueAccounts).join(", ")}`);
    
    // Log sample entries for debugging
    if (entries.length > 0) {
      console.log(`Sample entries (first 5):`);
      for (let i = 0; i < Math.min(5, entries.length); i++) {
        const e = entries[i];
        console.log(`  ${format(e.date, "MMM dd, yyyy")}: Account=${e.account}, Type=${e.type}, Value=${formatCurrency(e.portfolioValue)}`);
      }
    }
  } else {
    console.warn(`⚠️ WARNING: No valid entries parsed from CSV file!`);
    console.warn(`   Check CSV file format: Expected columns: Date, Account, Type, Portfolio Value`);
  }

  return entries;
  } catch (error) {
    console.error(`❌ Error parsing CSV file ${fullPath}:`, error);
    return [];
  }
}

/**
 * Process CSV entries to create equity curve points
 * Handles:
 * - Interpolation of missing weekend dates
 * - Outlier cleaning (May 6, 2024)
 * - Deposit vs Value type handling
 */
export function processCSVEntries(
  entries: CSVPortfolioEntry[],
  targetAccount: string = "U16030763"
): {
  equityCurve: EquityCurvePoint[];
  deposits: Map<string, number>; // date -> amount
  inceptionValue: number; // Feb 8, 2024 value
  migrationEndValue: number; // Aug 20, 2024 value (ending NAV for CSV)
} {
  console.log(`=== PROCESSING CSV ENTRIES ===`);
  console.log(`Filtering for account: ${targetAccount}`);

  // Filter for target account (case-insensitive matching)
  const accountEntries = entries.filter(e => e.account && e.account.trim().toUpperCase() === targetAccount.toUpperCase());
  
  // Log all unique accounts found for debugging
  const allAccounts = new Set(entries.map(e => e.account?.trim() || "").filter(a => a));
  console.log(`  All accounts in CSV: ${Array.from(allAccounts).join(", ")}`);
  console.log(`  Looking for account: ${targetAccount}`);
  console.log(`  Total entries in CSV: ${entries.length}`);
  console.log(`  Entries for ${targetAccount}: ${accountEntries.length}`);

  // If very few entries for target account (< 10), process ALL entries in the CSV
  // This handles cases where the CSV has all the data but the account column might be incorrect
  // or where each row represents the same account on different dates
  let entriesToProcess: CSVPortfolioEntry[];
  
  if (accountEntries.length === 0) {
    console.warn(`⚠️ No entries found for account ${targetAccount}`);
    console.warn(`   Available accounts: ${Array.from(allAccounts).join(", ")}`);
    console.warn(`   Processing ALL entries as fallback (assuming CSV data is for ${targetAccount})`);
    entriesToProcess = entries;
  } else if (accountEntries.length < 10) {
    console.warn(`⚠️ Very few entries (${accountEntries.length}) found for account ${targetAccount}`);
    console.warn(`   Processing ALL entries as fallback (assuming CSV data is for ${targetAccount})`);
    entriesToProcess = entries;
  } else {
    entriesToProcess = accountEntries;
    console.log(`  ✅ Using ${entriesToProcess.length} entries for account ${targetAccount}`);
  }

  // Separate deposits and value entries
  const depositEntries: CSVPortfolioEntry[] = [];
  const valueEntries: CSVPortfolioEntry[] = [];

  for (const entry of entriesToProcess) {
    if (entry.type === "deposit") {
      depositEntries.push(entry);
    } else {
      // 'Value' or empty type - treat as NAV
      valueEntries.push(entry);
    }
  }

  console.log(`  Deposits: ${depositEntries.length}`);
  console.log(`  NAV entries: ${valueEntries.length}`);

  // Find inception value (Feb 8, 2024)
  // Check both value entries AND deposit entries (since the CSV might have it as a Deposit type)
  const inceptionDate = new Date(Date.UTC(2024, 1, 8)); // Feb 8, 2024 (month is 0-indexed, so 1 = February)
  const inceptionDateKey = inceptionDate.toISOString().split("T")[0]; // Should be "2024-02-08"
  
  console.log(`  Looking for inception entry on ${inceptionDateKey} (Feb 8, 2024)`);
  
  // Use date keys (YYYY-MM-DD strings) for comparison to avoid timezone issues
  // First check value entries
  let inceptionEntry = valueEntries.find(e => {
    const entryDate = startOfDay(e.date);
    const entryDateKey = entryDate.toISOString().split("T")[0];
    return entryDateKey === inceptionDateKey;
  });
  
  // If not found, check deposit entries (Feb 8 might be marked as Deposit)
  if (!inceptionEntry) {
    console.log(`    Not found in value entries, checking deposit entries...`);
    inceptionEntry = depositEntries.find(e => {
      const entryDate = startOfDay(e.date);
      const entryDateKey = entryDate.toISOString().split("T")[0];
      return entryDateKey === inceptionDateKey;
    });
    if (inceptionEntry) {
      const foundDateKey = startOfDay(inceptionEntry.date).toISOString().split("T")[0];
      console.log(`    ✅ Found inception entry in deposit entries: ${foundDateKey} - ${formatCurrency(inceptionEntry.portfolioValue)}`);
    }
  } else {
    const foundDateKey = startOfDay(inceptionEntry.date).toISOString().split("T")[0];
    console.log(`    ✅ Found inception entry in value entries: ${foundDateKey} - ${formatCurrency(inceptionEntry.portfolioValue)}`);
  }

  let inceptionValue = inceptionEntry?.portfolioValue || 0;
  
  // If Feb 8 not found, try Feb 9 as fallback (but log a warning)
  if (inceptionValue === 0 && entriesToProcess.length > 0) {
    const feb9Date = new Date(Date.UTC(2024, 1, 9)); // Feb 9, 2024
    const feb9DateKey = feb9Date.toISOString().split("T")[0];
    const feb9Entry = valueEntries.find(e => {
      const entryDate = startOfDay(e.date);
      const entryDateKey = entryDate.toISOString().split("T")[0];
      return entryDateKey === feb9DateKey;
    }) || depositEntries.find(e => {
      const entryDate = startOfDay(e.date);
      const entryDateKey = entryDate.toISOString().split("T")[0];
      return entryDateKey === feb9DateKey;
    });
    
    if (feb9Entry) {
      console.warn(`  ⚠️ WARNING: Feb 8 entry not found, using Feb 9 value as inception: ${formatCurrency(feb9Entry.portfolioValue)}`);
      inceptionValue = feb9Entry.portfolioValue;
    }
  }
  
  console.log(`  Inception value (Feb 8, 2024): ${formatCurrency(inceptionValue)}`);
  
  if (inceptionValue === 0) {
    console.warn(`  ⚠️ WARNING: Inception value is $0! Check if Feb 8, 2024 entry exists in CSV.`);
    console.warn(`     Looking for date key: ${inceptionDateKey}`);
    if (valueEntries.length > 0) {
      console.warn(`     First few value entry dates: ${valueEntries.slice(0, 5).map(e => startOfDay(e.date).toISOString().split("T")[0]).join(", ")}`);
    }
    if (depositEntries.length > 0) {
      console.warn(`     First few deposit entry dates: ${depositEntries.slice(0, 5).map(e => startOfDay(e.date).toISOString().split("T")[0]).join(", ")}`);
    }
  } else if (inceptionValue === 117023) {
    console.warn(`  ⚠️ WARNING: Inception value is $117,023 which is Feb 9, not Feb 8!`);
    console.warn(`     This suggests the CSV might have Feb 9 as the first entry.`);
    console.warn(`     Expected Feb 8 value should be $116,495.`);
  }

  // Find migration end value (Aug 20, 2024 or closest)
  const migrationDate = new Date(Date.UTC(2024, 7, 20)); // Aug 20, 2024
  const migrationEntry = valueEntries.find(e => {
    const entryDate = startOfDay(e.date);
    return entryDate.getTime() >= startOfDay(migrationDate).getTime();
  });

  const migrationEndValue = migrationEntry?.portfolioValue || 0;
  console.log(`  Migration end value (Aug 20, 2024): ${formatCurrency(migrationEndValue)}`);

  // Clean outlier on May 6, 2024
  const may6Date = new Date(Date.UTC(2024, 4, 6)); // May 6, 2024
  const may6Index = valueEntries.findIndex(e => {
    const entryDate = startOfDay(e.date);
    return entryDate.getTime() === startOfDay(may6Date).getTime();
  });

  if (may6Index >= 0) {
    // Find May 5 and May 7 entries
    const may5Date = new Date(Date.UTC(2024, 4, 5));
    const may7Date = new Date(Date.UTC(2024, 4, 7));
    const may5Entry = valueEntries.find(e => startOfDay(e.date).getTime() === startOfDay(may5Date).getTime());
    const may7Entry = valueEntries.find(e => startOfDay(e.date).getTime() === startOfDay(may7Date).getTime());

    if (may5Entry && may7Entry) {
      const avgValue = (may5Entry.portfolioValue + may7Entry.portfolioValue) / 2;
      console.log(`  🔧 Cleaning May 6 outlier: ${formatCurrency(valueEntries[may6Index].portfolioValue)} → ${formatCurrency(avgValue)} (average of May 5 and May 7)`);
      valueEntries[may6Index].portfolioValue = avgValue;
    }
  }

  // Create deposits map
  // IMPORTANT: The Feb 8, 2024 entry with $116,495 is the inception seed, NOT a deposit
  // It should be excluded from deposits map and only used as inceptionValue
  const deposits = new Map<string, number>();
  // inceptionDateKey is already defined above, reuse it
  
  for (const deposit of depositEntries) {
    const dateKey = deposit.date.toISOString().split("T")[0];
    // CRITICAL: Always exclude Feb 8 from deposits map, regardless of value
    // This prevents double-counting the inception seed
    const isFeb8 = dateKey === inceptionDateKey;
    
    if (!isFeb8) {
      deposits.set(dateKey, deposit.portfolioValue);
    } else {
      console.log(`  ⚠️ Excluding Feb 8 inception seed from deposits map: ${dateKey} - ${formatCurrency(deposit.portfolioValue)} (using as inception value instead)`);
    }
  }
  
  console.log(`  Deposits map (excluding inception): ${deposits.size} entries, total: ${formatCurrency(Array.from(deposits.values()).reduce((sum, v) => sum + v, 0))}`);

  // Create equity curve with interpolation for missing dates
  const equityCurve: EquityCurvePoint[] = [];

  if (valueEntries.length === 0) {
    return {
      equityCurve: [],
      deposits,
      inceptionValue,
      migrationEndValue,
    };
  }

  // Sort value entries by date
  valueEntries.sort((a, b) => a.date.getTime() - b.date.getTime());

  const startDate = startOfDay(valueEntries[0].date);
  const endDate = startOfDay(valueEntries[valueEntries.length - 1].date);

  // Create all dates in range
  const allDates = eachDayOfInterval({ start: startDate, end: endDate });

  // Build equity curve with interpolation
  // IMPORTANT: Always include entries from the start date, even if NAV is 0
  // This ensures the full timeline is shown from Feb 8 onwards
  let lastKnownValue = 0;
  let valueEntryIndex = 0;

  for (const date of allDates) {
    // Check if we have a value entry for this date or before it
    while (
      valueEntryIndex < valueEntries.length &&
      startOfDay(valueEntries[valueEntryIndex].date).getTime() <= date.getTime()
    ) {
      lastKnownValue = valueEntries[valueEntryIndex].portfolioValue;
      valueEntryIndex++;
    }

    // If we have an exact match, use it; otherwise interpolate (carry forward last value)
    const exactMatch = valueEntries.find(e => startOfDay(e.date).getTime() === date.getTime());
    const navValue = exactMatch ? exactMatch.portfolioValue : lastKnownValue;

    // ALWAYS add entry if we have a value (including 0 at the start) or if it's an exact match
    // This ensures we include all dates in the CSV range, even if NAV starts at 0
    if (navValue !== undefined && navValue !== null) {
      equityCurve.push({
        date: startOfDay(date),
        nav: navValue,
        cumulativeReturn: 0, // Will be calculated later in TWR calculation
        accountBreakdown: undefined,
      });
    }
  }

  // Add any remaining entries after the interval
  while (valueEntryIndex < valueEntries.length) {
    const entry = valueEntries[valueEntryIndex];
    equityCurve.push({
      date: startOfDay(entry.date),
      nav: entry.portfolioValue,
      cumulativeReturn: 0,
      accountBreakdown: undefined,
    });
    valueEntryIndex++;
  }

  // Sort by date
  equityCurve.sort((a, b) => a.date.getTime() - b.date.getTime());

  console.log(`  Created ${equityCurve.length} equity curve points from CSV (with interpolation)`);
  console.log(`  Date range: ${format(equityCurve[0]?.date || new Date(), "MMM dd, yyyy")} to ${format(equityCurve[equityCurve.length - 1]?.date || new Date(), "MMM dd, yyyy")}`);

  return {
    equityCurve,
    deposits,
    inceptionValue,
    migrationEndValue,
  };
}

