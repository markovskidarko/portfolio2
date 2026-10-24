export const dynamic = 'force-dynamic'
/**
 * API endpoint to trigger permanent data ingestion
 * This scans XML files and CSV and ingests into SQLite database
 */
import { NextResponse } from 'next/server';
import { ingestAllData } from '@/lib/ingestion-service';

export const maxDuration = 300; // 5 minutes for ingestion

export async function POST(request: Request) {
  try {
    console.log(`[${new Date().toISOString()}] Manual ingestion requested`);
    
    // Check for clearExisting parameter
    const body = await request.json().catch(() => ({}));
    const clearExisting = body.clearExisting === true || body.clearExisting === 'true';
    
    if (clearExisting) {
      console.log(`[INGEST] Clearing existing U16030763 data before ingestion`);
    }
    
    const results = await ingestAllData(undefined, clearExisting);
    
    return NextResponse.json({
      success: true,
      message: `Ingestion completed successfully`,
      results: {
        accountsIngested: results.accountsIngested,
        navRecordsIngested: results.navRecordsIngested,
        transactionsIngested: results.transactionsIngested,
        cleared: results.cleared,
      },
    });
  } catch (error) {
    console.error('Ingestion error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to ingest data',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}


