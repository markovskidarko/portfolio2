export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { getExchangeRate } from '@/lib/exchange-rate';

export const maxDuration = 30;

/**
 * GET /api/exchange-rate - Get current USD/MKD exchange rate
 * This endpoint fetches the exchange rate server-side to avoid CORS issues
 */
export async function GET() {
  try {
    const result = await getExchangeRate();
    
    return NextResponse.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('[Exchange Rate API] ❌ Failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        rate: null,
        date: null,
        source: null
      },
      { status: 500 }
    );
  }
}



