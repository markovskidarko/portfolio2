/**
 * Database cleanup utilities for re-ingestion
 */
import { getDatabase } from './database';

const U16030763_ACCOUNT_ID = "U16030763";
const CSV_VIRTUAL_ACCOUNT_ID = "HUNGARY_MIGRATION_HISTORY";

/**
 * Clear DailyNAV and Transactions for specific accounts
 */
export async function clearAccountData(accountIds: string[]): Promise<{
  navRecordsDeleted: number;
  transactionsDeleted: number;
}> {
  const sql = getDatabase();

  // Delete NAV records
  const navResult = await sql`
    DELETE FROM "DailyNAV"
    WHERE account_id = ANY(${accountIds})
  `;

  // Delete transactions
  const transResult = await sql`
    DELETE FROM "Transactions"
    WHERE account_id = ANY(${accountIds})
  `;

  const navDeleted = navResult.count ?? 0;
  const transDeleted = transResult.count ?? 0;

  console.log(`[CLEANUP] Deleted ${navDeleted} NAV records and ${transDeleted} transactions for accounts: ${accountIds.join(', ')}`);

  return {
    navRecordsDeleted: navDeleted,
    transactionsDeleted: transDeleted,
  };
}

/**
 * Clear data for U16030763 and its CSV virtual account
 */
export async function clearU16030763Data(): Promise<{
  navRecordsDeleted: number;
  transactionsDeleted: number;
}> {
  return clearAccountData([U16030763_ACCOUNT_ID, CSV_VIRTUAL_ACCOUNT_ID]);
}
