export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { kbFundPriceQueries } from '@/lib/database';
import { KB_FUND_UNITS, calculateValuation, calculateTWR, getAvailableDates, getAvailableFunds, getKBFundPricesWithValuation } from '@/lib/kb-funds';
import { format } from 'date-fns';

export const maxDuration = 60;

/**
 * GET /api/kb-funds - Get KB Funds data
 * Query params:
 *   - fund: 'Stocks' | 'Balanced' | 'Gold' | 'All'
 *   - startDate: ISO date string (optional)
 *   - endDate: ISO date string (optional)
 *   - includeValuation: boolean (optional, requires usdRate)
 *   - usdRate: number (optional, for USD conversion)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fundName = searchParams.get('fund') || 'All';
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const includeValuation = searchParams.get('includeValuation') === 'true';
    const includeTotalValue = searchParams.get('includeTotalValue') === 'true';
    const usdRate = searchParams.get('usdRate') ? parseFloat(searchParams.get('usdRate')!) : null;

    // Use helper function to get prices with total value calculation
    let pricesWithUnits: any[];
    if (includeTotalValue) {
      pricesWithUnits = await getKBFundPricesWithValuation(fundName === 'All' ? undefined : fundName, startDate, endDate);
    } else {
      let prices: Array<{ date: string; fund_name: string; price_per_unit_mkd: number }>;
      
      if (startDate && endDate) {
        prices = await kbFundPriceQueries.getByDateRange(startDate, endDate) as Array<{
          date: string;
          fund_name: string;
          price_per_unit_mkd: number;
        }>;
      } else {
        prices = await kbFundPriceQueries.getAll() as Array<{
          date: string;
          fund_name: string;
          price_per_unit_mkd: number;
        }>;
      }
      
      // Filter by fund if specified
      if (fundName !== 'All') {
        prices = prices.filter(p => p.fund_name === fundName);
      }
      
      // Add unit quantities
      pricesWithUnits = prices.map(price => ({
        ...price,
        units: KB_FUND_UNITS[price.fund_name as keyof typeof KB_FUND_UNITS] || 0,
      }));
    }
    
    // Add valuations if requested
    let valuations: any[] | null = null;
    if (includeValuation && usdRate) {
      // Get unique dates
      const dates = [...new Set(pricesWithUnits.map(p => p.date))].sort();
      
      if (fundName === 'All') {
        // For "Total Portfolio", return all funds plus aggregated total for each date
        const allValuationsByDate: { [date: string]: any[] } = {};
        
        for (const date of dates) {
          const fundVals = await Promise.resolve(calculateValuation(date, 'All', usdRate)) as unknown as any[];
          // Store all fund valuations for this date
          allValuationsByDate[date] = fundVals;
        }
        
        // Flatten to array with all funds and total portfolio for each date
        valuations = [];
        for (const date of dates) {
          valuations.push(...allValuationsByDate[date]);
        }
      } else {
        valuations = await Promise.all(dates.map(async date => {
          return calculateValuation(date, fundName, usdRate);
        }));
      }
    }
    
    return NextResponse.json({
      success: true,
      fund: fundName,
      count: pricesWithUnits.length,
      prices: pricesWithUnits,
      valuations,
      availableFunds: getAvailableFunds(),
      availableDates: startDate && endDate ? null : getAvailableDates(),
    });
  } catch (error) {
    console.error('[KB Funds API] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/kb-funds - Store KB Funds price data
 * Body: { data: Array<{ date: string, fund_name: string, price_per_unit_mkd: number }> }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data } = body;
    
    if (!data || !Array.isArray(data)) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body. Expected { data: [...] }' },
        { status: 400 }
      );
    }
    
    
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    
    for (const price of data) {
      try {
        if (!price.date || !price.fund_name || typeof price.price_per_unit_mkd !== 'number') {
          console.warn(`[KB Funds API] Invalid price data:`, price);
          errors++;
          continue;
        }
        
        // Check if record exists
        const existing = (await kbFundPriceQueries.getByFund(price.fund_name) as Array<{ date: string }>)
          .find(p => p.date === price.date);
        
        await kbFundPriceQueries.upsert(price.date, price.fund_name, price.price_per_unit_mkd);
        
        if (existing) {
          updated++;
        } else {
          inserted++;
        }
      } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          // Already exists, skip
          continue;
        }
        console.error(`[KB Funds API] Error inserting price:`, price, error);
        errors++;
      }
    }
    
    return NextResponse.json({
      success: true,
      inserted,
      updated,
      errors,
      total: data.length,
    });
  } catch (error) {
    console.error('[KB Funds API] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

