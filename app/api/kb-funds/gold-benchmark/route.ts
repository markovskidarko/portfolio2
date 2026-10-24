export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { format, parseISO } from 'date-fns';

interface GoldPriceData {
  date: string;
  price: number;
  return: number; // Cumulative return percentage
}

/**
 * Fetch Gold historical prices from Yahoo Finance
 * Gold symbol: GC=F (Gold Futures) or XAUUSD=X (Gold/USD spot)
 */
async function fetchGoldPrices(startDate?: string, endDate?: string): Promise<GoldPriceData[]> {
  try {
    // Use GC=F for Gold Futures (most reliable)
    const symbol = 'GC=F';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error(`[Gold Benchmark] Failed to fetch: HTTP ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      console.error(`[Gold Benchmark] No data for ${symbol}`);
      return [];
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const adjustedCloses = result.indicators?.adjclose?.[0]?.adjclose || [];
    
    if (timestamps.length === 0 || closes.length === 0) {
      console.error(`[Gold Benchmark] No timestamp or price data`);
      return [];
    }
    
    // Build price data array
    const priceData: Array<{ date: Date; price: number }> = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i] * 1000; // Convert to milliseconds
      const close = closes[i];
      const adjustedClose = adjustedCloses && adjustedCloses[i] !== undefined 
        ? adjustedCloses[i] 
        : close;
      
      if (close !== null && close !== undefined && close > 0) {
        const date = new Date(timestamp);
        
        // Filter by date range if provided
        if (startDate) {
          const start = parseISO(startDate);
          if (date < start) continue;
        }
        if (endDate) {
          const end = parseISO(endDate);
          if (date > end) continue;
        }
        
        priceData.push({
          date,
          price: adjustedClose || close,
        });
      }
    }
    
    // Sort by date (oldest first)
    priceData.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    if (priceData.length === 0) {
      return [];
    }
    
    // KB Funds inception date: December 10, 2025
    const inceptionDate = new Date('2025-12-10');
    inceptionDate.setHours(0, 0, 0, 0);
    
    // Find the price on or closest to inception date
    let inceptionPrice: number | null = null;
    let inceptionPriceDate: Date | null = null;
    
    // First, try to find exact date match
    for (const point of priceData) {
      const pointDate = new Date(point.date);
      pointDate.setHours(0, 0, 0, 0);
      
      if (pointDate.getTime() === inceptionDate.getTime()) {
        inceptionPrice = point.price;
        inceptionPriceDate = point.date;
        break;
      }
    }
    
    // If exact match not found, find closest date after inception
    if (inceptionPrice === null) {
      for (const point of priceData) {
        const pointDate = new Date(point.date);
        pointDate.setHours(0, 0, 0, 0);
        
        if (pointDate >= inceptionDate) {
          inceptionPrice = point.price;
          inceptionPriceDate = point.date;
          break;
        }
      }
    }
    
    // If still not found, use first available price (fallback)
    if (inceptionPrice === null) {
      inceptionPrice = priceData[0].price;
      inceptionPriceDate = priceData[0].date;
    }
    
    // Calculate cumulative returns starting from inception date
    // All prices before inception should show 0% (or be filtered out)
    const goldData: GoldPriceData[] = [];
    
    for (const point of priceData) {
      const pointDate = new Date(point.date);
      pointDate.setHours(0, 0, 0, 0);
      
      // Only include data from inception date onwards
      if (pointDate < inceptionDate) {
        continue;
      }
      
      // Calculate return relative to inception price
      const cumulativeReturn = inceptionPrice > 0 
        ? ((point.price / inceptionPrice) - 1) * 100 
        : 0;
      
      goldData.push({
        date: format(point.date, 'yyyy-MM-dd'),
        price: point.price,
        return: cumulativeReturn,
      });
    }
    
    // Ensure we have a data point exactly on inception date with 0% return
    const hasInceptionDate = goldData.some(d => d.date === format(inceptionDate, 'yyyy-MM-dd'));
    if (!hasInceptionDate && inceptionPriceDate) {
      goldData.unshift({
        date: format(inceptionDate, 'yyyy-MM-dd'),
        price: inceptionPrice,
        return: 0, // 0% on inception date
      });
    }
    
    // Sort by date again after adding inception point
    goldData.sort((a, b) => a.date.localeCompare(b.date));
    
    console.log(`[Gold Benchmark] Fetched ${goldData.length} data points (from ${goldData[0]?.date} to ${goldData[goldData.length - 1]?.date})`);
    
    return goldData;
  } catch (error) {
    console.error('[Gold Benchmark] Error fetching Gold prices:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    
    const goldData = await fetchGoldPrices(startDate, endDate);
    
    return NextResponse.json({
      success: true,
      data: goldData,
    });
  } catch (error) {
    console.error('[Gold Benchmark] API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch Gold benchmark data',
      },
      { status: 500 }
    );
  }
}


