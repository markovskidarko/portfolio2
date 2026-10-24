export const dynamic = 'force-dynamic'
/**
 * Debug endpoint to inspect database contents
 */
import { NextResponse } from 'next/server';
import { navQueries } from '@/lib/database';

export async function GET() {
  try {
    const csvRecords = await navQueries.getByAccount("HUNGARY_MIGRATION_HISTORY") as Array<{ date: string; nav_value: number }>;
    const xmlRecords = await navQueries.getByAccount("U16030763") as Array<{ date: string; nav_value: number }>;
    
    // Filter for Aug 20-26
    const aug20_26 = csvRecords.filter(r => {
      const date = r.date;
      return date >= "2024-08-20" && date <= "2024-08-26";
    });
    
    const xmlAug20_26 = xmlRecords.filter(r => {
      const date = r.date;
      return date >= "2024-08-20" && date <= "2024-08-26";
    });
    
    return NextResponse.json({
      csv: {
        totalRecords: csvRecords.length,
        firstDate: csvRecords[0]?.date,
        lastDate: csvRecords[csvRecords.length - 1]?.date,
        aug20_26: aug20_26.map(r => ({ date: r.date, nav: r.nav_value })),
      },
      xml: {
        totalRecords: xmlRecords.length,
        firstDate: xmlRecords[0]?.date,
        lastDate: xmlRecords[xmlRecords.length - 1]?.date,
        aug20_26: xmlAug20_26.map(r => ({ date: r.date, nav: r.nav_value })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}


