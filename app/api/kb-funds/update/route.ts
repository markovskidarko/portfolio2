export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import '@/lib/env';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { kbFundPriceQueries } from '@/lib/database';

export const maxDuration = 300; // 5 minutes for scraping all funds (same as scrape-historical)

/**
 * POST /api/kb-funds/update - Sync KB Funds prices (same logic as "Sync Prices" button)
 * This should be called every hour by a cron job or background worker
 * 
 * This endpoint replicates the exact logic from the "Sync Prices" button in the KB Funds dashboard:
 * 1. Runs the Python scraper script (scripts/fetch_kb_funds.py)
 * 2. Processes the results and stores them in the database
 */
export async function POST(request: Request) {
  try {
    const scriptPath = join(process.cwd(), 'scripts', 'fetch_kb_funds.py');
    
    if (!existsSync(scriptPath)) {
      return NextResponse.json(
        { success: false, error: 'Scraper script not found. Please ensure scripts/fetch_kb_funds.py exists.' },
        { status: 404 }
      );
    }
    
    console.log('[KB Funds Update] Starting KB Funds price sync (same as "Sync Prices" button)...');
    
    // Run the Python script (same logic as /api/kb-funds/scrape-historical)
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
        console.log('[KB Funds Update]', data.toString());
      });
      
      pythonProcess.on('close', async (code) => {
        if (code !== 0) {
          console.error('[KB Funds Update] Python script failed:', stderr);
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
                console.error(`[KB Funds Update] Error storing price:`, price, err);
              }
            }
          }
          
          // Verification: Log success message only when all 3 funds are processed
          const totalRecords = inserted + updated;
          if (fundsProcessed.size === 3) {
            console.log(`[KB Funds Update] ✅ Success: 3 funds processed, total records updated: ${totalRecords}`);
          } else {
            console.warn(`[KB Funds Update] ⚠️ WARNING: Only ${fundsProcessed.size} fund(s) processed: ${Array.from(fundsProcessed).join(', ')}`);
          }
          
          resolve(NextResponse.json({
            success: true,
            scraped: result.data.length,
            inserted,
            updated,
            fundsProcessed: Array.from(fundsProcessed),
            allFundsProcessed: fundsProcessed.size === 3,
            timestamp: result.timestamp || new Date().toISOString(),
          }));
        } catch (error) {
          console.error('[KB Funds Update] Error parsing output:', error);
          console.error('[KB Funds Update] Raw output:', stdout);
          resolve(NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Parse error', details: { stdout, stderr } },
            { status: 500 }
          ));
        }
      });
    });
  } catch (error) {
    console.error('[KB Funds Update] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


