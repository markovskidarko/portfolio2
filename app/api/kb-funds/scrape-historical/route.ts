export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { kbFundPriceQueries } from '@/lib/database';

export const maxDuration = 300; // 5 minutes for scraping all funds

/**
 * GET /api/kb-funds/scrape-historical - Run Python scraper to fetch historical prices
 * This endpoint triggers the Python scraper and stores the results in the database
 */
export async function GET() {
  try {
    const scriptPath = join(process.cwd(), 'scripts', 'fetch_kb_funds.py');
    
    if (!existsSync(scriptPath)) {
      return NextResponse.json(
        { success: false, error: 'Scraper script not found. Please ensure scripts/fetch_kb_funds.py exists.' },
        { status: 404 }
      );
    }
    
    console.log('[KB Funds Scraper] Starting historical price scraper...');
    
    // Run the Python script
    return new Promise<Response>((resolve) => {
      const pythonProcess = spawn('python', [scriptPath], {
        env: {
          ...process.env,
        },
      });
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log to console but don't treat as fatal
        console.log('[KB Funds Scraper]', data.toString());
      });
      
      pythonProcess.on('close', async (code) => {
        if (code !== 0) {
          console.error('[KB Funds Scraper] Python script failed:', stderr);
          resolve(NextResponse.json(
            { success: false, error: `Scraper failed: ${stderr || 'Unknown error'}` },
            { status: 500 }
          ));
          return;
        }
        
        try {
          // Parse JSON output
          const result = JSON.parse(stdout);
          
          if (!result.success) {
            throw new Error(result.error || 'Scraper returned unsuccessful');
          }
          
          // Store data directly in database
          
          let inserted = 0;
          let updated = 0;
          const fundsProcessed = new Set<string>();
          
          for (const price of result.data) {
            try {
              // Check if exists
              const existing = (await kbFundPriceQueries.getByFund(price.fund_name) as Array<{ date: string }>)
                .find(p => p.date === price.date);
              
              await kbFundPriceQueries.upsert(price.date, price.fund_name, price.price_per_unit_mkd);
              fundsProcessed.add(price.fund_name);
              
              if (existing) {
                updated++;
              } else {
                inserted++;
              }
            } catch (err: any) {
              if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
                console.error(`[KB Funds Scraper] Error storing price:`, price, err);
              }
            }
          }
          
          // Verification: Log success message only when all 3 funds are processed
          const totalRecords = inserted + updated;
          if (fundsProcessed.size === 3) {
            console.log(`[Final Success] 3 funds processed, total records updated: ${totalRecords}`);
          } else {
            console.warn(`[WARNING] Only ${fundsProcessed.size} fund(s) processed: ${Array.from(fundsProcessed).join(', ')}`);
          }
          
          resolve(NextResponse.json({
            success: true,
            scraped: result.data.length,
            inserted,
            updated,
            fundsProcessed: Array.from(fundsProcessed),
            allFundsProcessed: fundsProcessed.size === 3,
            timestamp: result.timestamp,
          }));
        } catch (error) {
          console.error('[KB Funds Scraper] Error parsing output:', error);
          console.error('[KB Funds Scraper] Raw output:', stdout);
          resolve(NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Parse error' },
            { status: 500 }
          ));
        }
      });
    });
  } catch (error) {
    console.error('[KB Funds Scraper] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


