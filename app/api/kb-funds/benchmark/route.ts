export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { fetchYahooHistoricalData } from '@/lib/price-services/yahoo-finance';

export const maxDuration = 60;

/**
 * GET /api/kb-funds/benchmark - Get benchmark historical data
 * Query params:
 *   - benchmark: 'SP500' | 'Gold'
 *   - startDate: ISO date string
 *   - endDate: ISO date string
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const benchmark = searchParams.get('benchmark');
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');

    if (!benchmark || !startDateStr || !endDateStr) {
      return NextResponse.json(
        { error: 'Missing required parameters: benchmark, startDate, endDate' },
        { status: 400 }
      );
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    // Map benchmark to Yahoo Finance symbol
    let symbol: string;
    if (benchmark === 'SP500') {
      symbol = '^GSPC'; // S&P 500
    } else if (benchmark === 'Gold') {
      symbol = 'GC=F'; // Gold Futures
    } else {
      return NextResponse.json(
        { error: 'Invalid benchmark. Must be SP500 or Gold' },
        { status: 400 }
      );
    }

    // Fetch historical data
    const historicalData = await fetchYahooHistoricalData(symbol, startDate, endDate);

    if (historicalData.length === 0) {
      return NextResponse.json(
        { error: 'No historical data available for the specified date range' },
        { status: 404 }
      );
    }

    // Calculate cumulative return (TWR) from the data
    const firstPrice = historicalData[0].close;
    const benchmarkData = historicalData.map((point, index) => {
      const returnPercent = firstPrice > 0 
        ? ((point.close / firstPrice) - 1) * 100 
        : 0;
      
      return {
        date: point.date.toISOString().split('T')[0],
        price: point.close,
        cumulativeReturn: returnPercent,
      };
    });

    return NextResponse.json({
      success: true,
      benchmark,
      symbol,
      data: benchmarkData,
    });
  } catch (error) {
    console.error('[KB Funds Benchmark API] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      },
      { status: 500 }
    );
  }
}

