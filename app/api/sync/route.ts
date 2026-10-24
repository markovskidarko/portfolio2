export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import '@/lib/env'; // Load environment variables
import { syncAllPortfolios } from '@/lib/sync-service';
import { ingestAllData } from '@/lib/ingestion-service';
import { loadEnv } from '@/lib/env';

// Force reload env on each request
loadEnv();

export const maxDuration = 300; // 5 minutes for sync operation

export async function POST(request: Request) {
  try {
    console.log(`[${new Date().toISOString()}] Manual sync requested`);
    
    // Check for clearExisting parameter
    let clearExisting = false;
    try {
      const body = await request.json().catch(() => ({}));
      clearExisting = body.clearExisting === true || body.clearExisting === 'true';
    } catch (e) {
      // Ignore JSON parse errors
    }
    
    // Step 1: Ingest all historical data from XML and CSV files (permanent ingestion)
    console.log(`[SYNC] ===== Step 1: Running Permanent Data Ingestion =====`);
    if (clearExisting) {
      console.log(`[SYNC] Clearing existing U16030763 data before ingestion...`);
    }
    const ingestionResults = await ingestAllData(undefined, clearExisting);
    console.log(`[SYNC] Ingestion complete: ${ingestionResults.navRecordsIngested} NAV records, ${ingestionResults.transactionsIngested} transactions`);
    if (ingestionResults.cleared) {
      console.log(`[SYNC] Cleared: ${ingestionResults.cleared.navRecordsDeleted} NAV records, ${ingestionResults.cleared.transactionsDeleted} transactions`);
    }
    
    // Step 2: Sync latest data from Flex Query API (incremental updates)
    console.log(`[SYNC] ===== Step 2: Running Flex Query Sync =====`);
    const results = await syncAllPortfolios();
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    return NextResponse.json({
      success: true,
      message: `Sync completed: ${successCount} succeeded, ${failureCount} failed`,
      ingestion: {
        accountsIngested: ingestionResults.accountsIngested,
        navRecordsIngested: ingestionResults.navRecordsIngested,
        transactionsIngested: ingestionResults.transactionsIngested,
      },
      flexSync: {
        successCount,
        failureCount,
        results,
      },
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to sync portfolios',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}


