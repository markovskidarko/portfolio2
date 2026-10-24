export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { kbFundPriceQueries } from '@/lib/database';

export const maxDuration = 60;

/**
 * POST /api/kb-funds/historical/insert/batch - Batch insert KB Funds price data
 * Body: { data: Array<{ date: string, fund_name: string, price_mkd: number }> }
 * 
 * Note: The field name in the request body is `price_mkd`, but it's stored as `price_per_unit_mkd` in the database.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data } = body;
    
    if (!data || !Array.isArray(data)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request body. Expected { data: Array<{ date: string, fund_name: string, price_mkd: number }> }' 
        },
        { status: 400 }
      );
    }
    

    
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    const errorDetails: string[] = [];
    
    for (const price of data) {
      try {
        // Handle both 'price_mkd' and 'price_per_unit_mkd' field names for compatibility
        const priceValue = price.price_mkd ?? price.price_per_unit_mkd;
        
        if (!price.date || !price.fund_name || typeof priceValue !== 'number') {
          const errorMsg = `Invalid price data: ${JSON.stringify(price)}`;
          console.warn(`[KB Funds Batch API] ${errorMsg}`);
          errorDetails.push(errorMsg);
          errors++;
          continue;
        }
        
        // Perform upsert (update if exists, insert if not)
        // The database query uses ON CONFLICT DO UPDATE, so this handles both cases
        const existing = (await kbFundPriceQueries.getByFund(price.fund_name) as Array<{ date: string }>)
          .find(p => p.date === price.date);
        
        await kbFundPriceQueries.upsert(price.date, price.fund_name, priceValue);
        
        if (existing) {
          updated++;
        } else {
          inserted++;
        }
      } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          // Already exists, count as updated
          updated++;
          continue;
        }
        const errorMsg = `Error inserting price ${JSON.stringify(price)}: ${error.message}`;
        console.error(`[KB Funds Batch API] ${errorMsg}`);
        errorDetails.push(errorMsg);
        errors++;
      }
    }
    
    return NextResponse.json({
      success: true,
      inserted,
      updated,
      errors,
      total: data.length,
      errorDetails: errors > 0 ? errorDetails : undefined,
    });
  } catch (error) {
    console.error('[KB Funds Batch API] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}





