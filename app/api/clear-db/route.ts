export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';

export async function POST() {
  try {
    const db = getDatabase();
    
    console.log('[CLEAR-DB] Starting database clear...');
    
    // Count before deleting so we can report meaningful numbers
    const countRow = async (table: string): Promise<number> => {
      const rows = await db`SELECT COUNT(*)::int AS n FROM ${db(table)}` as unknown as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    };

    const deletions = {
      deposits:     await countRow('Deposits'),
      withdrawals:  await countRow('Withdrawals'),
      dividends:    await countRow('Dividends'),
      interest:     await countRow('Interest'),
      fees:         await countRow('Fees'),
      taxes:        await countRow('Taxes'),
      transfers:    await countRow('Transfers'),
      transactions: await countRow('Transactions'),
      trades:       await countRow('Trades'),
      holdings:     await countRow('Holdings'),
      changeInNAV:  await countRow('ChangeInNAV'),
    };

    // Delete all transaction-related data but keep accounts and NAV
    await db`DELETE FROM "Deposits"`;
    await db`DELETE FROM "Withdrawals"`;
    await db`DELETE FROM "Dividends"`;
    await db`DELETE FROM "Interest"`;
    await db`DELETE FROM "Fees"`;
    await db`DELETE FROM "Taxes"`;
    await db`DELETE FROM "Transfers"`;
    await db`DELETE FROM "Transactions"`;
    await db`DELETE FROM "Trades"`;
    await db`DELETE FROM "Holdings"`;
    await db`DELETE FROM "ChangeInNAV"`;
    
    const totalDeleted = Object.values(deletions).reduce((sum, count) => sum + count, 0);
    
    console.log('[CLEAR-DB] Clear complete:', deletions);
    console.log(`[CLEAR-DB] Total records deleted: ${totalDeleted}`);
    
    return NextResponse.json({
      success: true,
      message: `Database cleared: ${totalDeleted} transaction records deleted`,
      deletions,
    });
  } catch (error) {
    console.error('[CLEAR-DB] Error clearing database:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
