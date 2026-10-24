import { XMLParser } from "fast-xml-parser";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { FlexStatement, EquitySummaryByReportDateInBase } from "./types";

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
 * Uses UTC to avoid timezone issues when converting to ISO string
 */
function parseIBKRDate(dateStr: string | number): Date {
  // Handle both string and number (XML parser may convert to number)
  const dateValue = String(dateStr);
  if (!dateValue || dateValue.length !== 8) {
    return new Date();
  }
  const year = parseInt(dateValue.substring(0, 4));
  const month = parseInt(dateValue.substring(4, 6)) - 1; // Month is 0-indexed
  const day = parseInt(dateValue.substring(6, 8));
  return new Date(Date.UTC(year, month, day));
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
 * Extract daily NAV data from EquitySummaryByReportDateInBase section
 */
export interface DailyNAVEntry {
  reportDate: Date;
  accountId: string;
  accountAlias: string;
  total: number;
  currency: string;
}

/**
 * Parse a single XML file and extract EquitySummaryByReportDateInBase entries
 */
export function parseEquitySummaryXML(filePath: string): DailyNAVEntry[] {
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

  // Handle the parsed structure
  let flexStatements: any;

  if (parsed.FlexQueryResponse) {
    flexStatements = parsed.FlexQueryResponse.FlexStatements;
  } else if (parsed.FlexStatements) {
    flexStatements = parsed.FlexStatements;
  } else {
    const keys = Object.keys(parsed);
    if (keys.length > 0) {
      flexStatements = parsed[keys[0]];
    }
  }

  if (!flexStatements) {
    throw new Error(`Invalid XML structure in ${filePath}: Could not find FlexStatements`);
  }

  if (!flexStatements.FlexStatement) {
    throw new Error(`Invalid XML structure in ${filePath}: Missing FlexStatements.FlexStatement`);
  }

  const statements = normalizeArray(flexStatements.FlexStatement || []);

  const dailyNAVEntries: DailyNAVEntry[] = [];

  for (const statement of statements) {
    const stmt = statement as FlexStatement;
    const equitySummary = stmt.EquitySummaryInBase;
    
    if (!equitySummary) {
      // This file doesn't have EquitySummaryInBase, skip it
      continue;
    }

    const equityEntries = normalizeArray(
      equitySummary.EquitySummaryByReportDateInBase || []
    );

    for (const entry of equityEntries) {
      const eqEntry = entry as EquitySummaryByReportDateInBase;
      const total = toNumber(eqEntry.total);
      
      // IMPORTANT: Do NOT filter out zeros - we need all dates for proper timeline
      // Zero NAVs are valid for accounts that haven't started yet
      // The aggregation logic will handle zeros properly with carry-forward logic
      
      // Parse reportDate (YYYYMMDD format) to Date object
      // Ensure it's a valid date string before parsing
      let reportDate: Date;
      if (eqEntry.reportDate) {
        try {
          reportDate = parseIBKRDate(eqEntry.reportDate);
          // Validate the parsed date
          if (isNaN(reportDate.getTime())) {
            console.warn(`Invalid reportDate: ${eqEntry.reportDate}, skipping entry`);
            continue;
          }
        } catch (error) {
          console.warn(`Error parsing reportDate ${eqEntry.reportDate}:`, error);
          continue;
        }
      } else {
        console.warn(`Missing reportDate in entry, skipping`);
        continue;
      }

      dailyNAVEntries.push({
        reportDate: reportDate,
        accountId: eqEntry.accountId || stmt.accountId,
        accountAlias: eqEntry.acctAlias || stmt.accountId,
        total: total,
        currency: eqEntry.currency || "USD",
      });
    }
  }

  return dailyNAVEntries;
}

/**
 * Parse all XML files in the data directory and extract EquitySummaryByReportDateInBase
 */
export function parseAllEquitySummaryFiles(dataDir: string = "data/ibkr_uploads"): DailyNAVEntry[] {
  console.log(`Loading equity summary data from: ${dataDir}`);
  const files = readdirSync(dataDir).filter((file) => file.endsWith(".xml"));
  console.log(`Found ${files.length} XML files in ${dataDir}`);

  const allEntries: DailyNAVEntry[] = [];

  for (const file of files) {
    const filePath = join(dataDir, file);
    try {
      console.log(`Parsing equity summary from ${file}...`);
      const entries = parseEquitySummaryXML(filePath);
      allEntries.push(...entries);
      console.log(`  Extracted ${entries.length} daily NAV entries from ${file}`);
    } catch (error) {
      console.error(`Error parsing ${file}:`, error);
    }
  }

  console.log(`Total daily NAV entries extracted: ${allEntries.length}`);
  return allEntries;
}

