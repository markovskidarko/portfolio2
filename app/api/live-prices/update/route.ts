export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { updateLivePricesFromYahoo } from '@/lib/live-price-service';

export const maxDuration = 60;

/**
 * POST /api/live-prices/update - Update live prices from Yahoo Finance
 */
export async function POST() {
  try {
    console.log('[Live Prices API] Updating prices from Yahoo Finance...');
    
    const result = await updateLivePricesFromYahoo();
    
    return NextResponse.json({
      success: result.success,
      updated: result.updated,
      failed: result.failed,
      errors: result.errors,
      message: `Updated ${result.updated} prices, ${result.failed} failed`,
    });
  } catch (error) {
    console.error('[Live Prices API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

