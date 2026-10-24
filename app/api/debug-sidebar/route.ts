export const dynamic = 'force-dynamic'
/**
 * Debug endpoint to show sidebar card calculations (YTD and Today) per account in a readable HTML table
 * GET /api/debug-sidebar?accountIds=U15352922,U16030763,U16030764,U16030765
 */
import { NextResponse } from 'next/server';
import { getDatabase, navQueries, accountQueries, holdingQueries, cashQueries, livePriceQueries } from '@/lib/database';
import { mapSymbolForYahoo } from '@/lib/symbol-mapper';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountIdsParam = searchParams.get('accountIds');
    
    const selectedAccountIds = accountIdsParam 
      ? accountIdsParam.split(',').filter(id => id.trim().length > 0)
      : [];
    
    const accounts = await accountQueries.getAll() as Array<{ id: string; alias: string; currency: string }>;
    
    // If no account IDs provided, use all accounts (excluding CSV virtual account)
    const accountsToProcess = selectedAccountIds.length > 0
      ? accounts.filter(acc => selectedAccountIds.includes(acc.id))
      : accounts.filter(acc => acc.id !== 'HUNGARY_MIGRATION_HISTORY');
    
    if (accountsToProcess.length === 0) {
      return new NextResponse(
        `<html><body><h1>Error</h1><p>No accounts found</p></body></html>`,
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }
    
    const dbClient = getDatabase();
    
    // Helper: get Jan 1 2026 NAV for a given account
    const getJan1Nav = async (accountId: string) => {
      const rows = await dbClient`
        SELECT date, nav_value
        FROM "DailyNAV"
        WHERE account_id = ${accountId}
          AND date <= '2026-01-01'
        ORDER BY date DESC
        LIMIT 1
      ` as unknown as Array<{ date: string; nav_value: number }>;
      return rows[0];
    };
    
    const getFirst2026Nav = async (accountId: string) => {
      const rows = await dbClient`
        SELECT date, nav_value
        FROM "DailyNAV"
        WHERE account_id = ${accountId}
          AND date >= '2026-01-01'
          AND date < '2026-01-10'
        ORDER BY date ASC
        LIMIT 1
      ` as unknown as Array<{ date: string; nav_value: number }>;
      return rows[0];
    };
    
    // Get latest NAV from database for each account
    
    // Get holdings and cash for each account to calculate Live Data NAV
    
    const breakdown: Array<{
      accountId: string;
      accountAlias: string;
      jan1Nav: number;
      jan1Date: string;
      latestDbNav: number;
      latestDbNavDate: string;
      liveDataNav: number;
      ytdValue: number;
      ytdReturn: number;
      todayValue: number;
      todayReturn: number;
    }> = [];
    
    for (const account of accountsToProcess) {
      let jan1Nav = 0;
      let jan1Date = '';
      let latestDbNav = 0;
      let latestDbNavDate = '';
      let liveDataNav = 0;
      
      // Get Jan 1 NAV
      try {
        const jan1NavRecord = await getJan1Nav(account.id);
        
        if (jan1NavRecord && jan1NavRecord.nav_value > 0) {
          jan1Nav = jan1NavRecord.nav_value;
          jan1Date = jan1NavRecord.date;
        } else {
          // Try first NAV of 2026
          const first2026NavRecord = await getFirst2026Nav(account.id);
          if (first2026NavRecord && first2026NavRecord.nav_value > 0) {
            jan1Nav = first2026NavRecord.nav_value;
            jan1Date = first2026NavRecord.date;
          }
        }
      } catch (error) {
        console.warn(`Error getting Jan 1 NAV for ${account.id}:`, error);
      }
      
      // Get Latest DB NAV
      try {
        const latestNavRecord = await navQueries.getLatestByAccount(account.id) as {
          date: string;
          nav_value: number;
        } | undefined;
        
        if (latestNavRecord && latestNavRecord.nav_value > 0) {
          latestDbNav = latestNavRecord.nav_value;
          latestDbNavDate = latestNavRecord.date;
        }
      } catch (error) {
        console.warn(`Error getting latest DB NAV for ${account.id}:`, error);
      }
      
      // Calculate Live Data NAV: positions (using live prices) + cash
      try {
        let accountCash = 0;
        let accountPositionValue = 0;
        
        // Get cash
        try {
          const cashRecord = await cashQueries.getLatestByAccount(account.id) as {
            amount: number;
            currency: string;
            fx_rate_to_base: number;
          } | undefined;
          
          if (cashRecord) {
            accountCash = cashRecord.amount * cashRecord.fx_rate_to_base;
          }
        } catch (error) {
          // Ignore if cash not found
        }
        
        // Get holdings and calculate position value using live prices
        const holdings = await holdingQueries.getLatestByAccount(account.id) as Array<{
          symbol: string;
          position: number;
          description: string;
          cost_basis_money?: number;
          position_value?: number;
        }>;
        
        // First pass: Group holdings by mapped symbol (EQQQ/EQQU -> EQQQ.SW)
        const holdingsByMappedSymbol = new Map<string, Array<{
          originalSymbol: string;
          mappedSymbol: string;
          description: string;
          quantity: number;
          cost_basis_money: number;
        }>>();
        
        for (const holding of holdings) {
          const originalSymbol = holding.symbol?.toUpperCase();
          
          // Handle cash separately
          if (originalSymbol === 'CASH' || originalSymbol === 'USD') {
            accountCash += holding.position_value || holding.position || 0;
            continue;
          }
          
          if (!originalSymbol || !holding.position) {
            continue;
          }
          
          // Map symbol to Yahoo Finance format (EQQQ and EQQU both map to EQQQ.SW)
          const mappedSymbol = mapSymbolForYahoo(originalSymbol);
          
          if (!holdingsByMappedSymbol.has(mappedSymbol)) {
            holdingsByMappedSymbol.set(mappedSymbol, []);
          }
          
          holdingsByMappedSymbol.get(mappedSymbol)!.push({
            originalSymbol: originalSymbol,
            mappedSymbol: mappedSymbol,
            description: holding.description || originalSymbol,
            quantity: holding.position,
            cost_basis_money: holding.cost_basis_money || 0,
          });
        }
        
        // Second pass: Deduplicate and calculate values
        // If multiple holdings map to same symbol AND have same quantity -> they're duplicates
        // Use quantity once (don't sum), use max position_value
        for (const [mappedSymbol, duplicateHoldings] of holdingsByMappedSymbol.entries()) {
          // Handle cash separately (shouldn't happen after filtering, but keep as safety)
          if (mappedSymbol === 'CASH' || mappedSymbol === 'USD') {
            // Sum cash quantities
            const totalCashQty = duplicateHoldings.reduce((sum, h) => sum + h.quantity, 0);
            accountCash += totalCashQty;
            continue;
          }
          
          let finalQuantity = 0;
          let originalSymbols: string[] = [];
          
          if (duplicateHoldings.length > 1) {
            // Multiple holdings map to same symbol - check if they're duplicates
            // Check if they have the same quantity (definitely duplicates like EQQQ/EQQU)
            const allSameQuantity = duplicateHoldings.every((h, i, arr) => 
              i === 0 || Math.abs(h.quantity - arr[0].quantity) < 0.1
            );
            
            if (allSameQuantity) {
              // They're duplicates - use quantity once (don't sum)
              finalQuantity = duplicateHoldings[0].quantity;
              originalSymbols = duplicateHoldings.map(h => h.originalSymbol);
            } else {
              // Different quantities - sum them (legitimate multiple positions)
              finalQuantity = duplicateHoldings.reduce((sum, h) => sum + h.quantity, 0);
              originalSymbols = duplicateHoldings.map(h => h.originalSymbol);
            }
          } else {
            // Single holding - no deduplication needed
            finalQuantity = duplicateHoldings[0].quantity;
            originalSymbols = [duplicateHoldings[0].originalSymbol];
          }
          
          // Calculate position value using live prices
          try {
            const priceRecord = await livePriceQueries.get(mappedSymbol) as {
              price: number;
              updated_at: string;
            } | undefined;
            
            if (priceRecord && priceRecord.price > 0) {
              // Current value using live price and final (deduplicated) quantity
              const currentPositionValue = priceRecord.price * finalQuantity;
              accountPositionValue += currentPositionValue;
            } else {
              // Fallback to cost basis if no price
              const totalCostBasis = duplicateHoldings.reduce((sum, h) => sum + h.cost_basis_money, 0);
              accountPositionValue += totalCostBasis;
            }
          } catch (error) {
            // Skip if price not found
          }
        }
        
        // Live Data NAV = positions + cash
        liveDataNav = accountPositionValue + accountCash;
        
        // Debug logging to help diagnose mismatches
        console.log(`[Debug Sidebar] Account ${account.id}: Live Data NAV = $${liveDataNav.toFixed(2)} (positions: $${accountPositionValue.toFixed(2)} + cash: $${accountCash.toFixed(2)})`);
      } catch (error) {
        console.warn(`Error calculating Live Data NAV for ${account.id}:`, error);
      }
      
      // Calculate YTD using Live Data NAV (matching sidebar card logic)
      // SIDEBAR CARD YTD: Use Live Data NAV (not Latest DB NAV)
      // Formula: YTD % = (Live Data NAV - Jan 1 2026 NAV) / Jan 1 2026 NAV × 100
      let ytdValue = 0;
      let ytdReturn = 0;
      
      if (jan1Nav > 0 && liveDataNav > 0) {
        ytdValue = liveDataNav - jan1Nav;
        ytdReturn = (ytdValue / jan1Nav) * 100;
      }
      
      // Calculate Today performance: (Live Data NAV - Latest DB NAV) / Latest DB NAV × 100
      // SIDEBAR CARD Today: Use Live Data NAV vs Latest DB NAV
      let todayValue = 0;
      let todayReturn = 0;
      
      if (latestDbNav > 0 && liveDataNav > 0) {
        todayValue = liveDataNav - latestDbNav;
        todayReturn = (todayValue / latestDbNav) * 100;
      }
      
      breakdown.push({
        accountId: account.id,
        accountAlias: account.alias,
        jan1Nav,
        jan1Date,
        latestDbNav,
        latestDbNavDate,
        liveDataNav,
        ytdValue,
        ytdReturn,
        todayValue,
        todayReturn,
      });
    }
    
    // Build HTML table
    const tableRows = breakdown.map(portfolio => `
      <tr>
        <td><strong>${portfolio.accountId}</strong><br><small>${portfolio.accountAlias}</small></td>
        <td>${formatCurrency(portfolio.jan1Nav)}<br><small>${portfolio.jan1Date}</small></td>
        <td>${formatCurrency(portfolio.latestDbNav)}<br><small>${portfolio.latestDbNavDate}</small></td>
        <td>${formatCurrency(portfolio.liveDataNav)}<br><small>Live Data NAV</small></td>
        <td>${formatCurrency(portfolio.ytdValue)}</td>
        <td style="color: ${portfolio.ytdReturn >= 0 ? '#10b981' : '#ef4444'}; font-weight: bold;">
          ${formatPercent(portfolio.ytdReturn)}
        </td>
        <td>${formatCurrency(portfolio.todayValue)}</td>
        <td style="color: ${portfolio.todayReturn >= 0 ? '#10b981' : '#ef4444'}; font-weight: bold;">
          ${formatPercent(portfolio.todayReturn)}
        </td>
      </tr>
    `).join('');
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sidebar Card Calculations</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      margin-bottom: 10px;
    }
    .header p {
      opacity: 0.9;
      font-size: 14px;
    }
    .content {
      padding: 30px;
      overflow-x: auto;
    }
    .formula-box {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin-bottom: 30px;
      border-radius: 4px;
    }
    .formula-box h2 {
      color: #333;
      font-size: 18px;
      margin-bottom: 15px;
    }
    .formula-item {
      margin-bottom: 10px;
    }
    .formula-item code {
      background: white;
      padding: 10px 15px;
      border-radius: 4px;
      display: block;
      font-size: 14px;
      color: #667eea;
      font-weight: 600;
      margin-top: 5px;
    }
    .formula-item label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
      background: white;
      min-width: 1000px;
    }
    thead {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    th {
      padding: 15px;
      text-align: left;
      font-weight: 600;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    td {
      padding: 15px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 14px;
    }
    tbody tr:hover {
      background: #f8f9fa;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .footer {
      text-align: center;
      padding: 20px;
      color: #6b7280;
      font-size: 12px;
    }
    small {
      color: #6b7280;
      font-size: 11px;
    }
    .section-divider {
      height: 2px;
      background: linear-gradient(90deg, transparent, #e5e7eb, transparent);
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Sidebar Card Calculations</h1>
      <p>YTD and Today Performance per Account</p>
    </div>
    <div class="content">
      <div class="formula-box">
        <h2>📐 Calculation Formulas</h2>
        <div class="formula-item">
          <label>YTD Calculation (Sidebar Card):</label>
          <code>YTD % = (Live Data NAV - Jan 1 2026 NAV) / Jan 1 2026 NAV × 100</code>
        </div>
        <div class="formula-item">
          <label>Today Calculation:</label>
          <code>Today % = (Live Data NAV - Latest DB NAV) / Latest DB NAV × 100</code>
        </div>
        <p style="margin-top: 15px; font-size: 12px; color: #6b7280;">
          <strong>Note:</strong> Live Data NAV = Current Position Values (using live prices) + Cash
        </p>
      </div>
      
      <table>
        <thead>
          <tr>
            <th>Portfolio</th>
            <th>Jan 1, 2026 NAV</th>
            <th>Latest DB NAV</th>
            <th>Live Data NAV</th>
            <th>YTD Value</th>
            <th>YTD Return</th>
            <th>Today Value</th>
            <th>Today Return</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
    <div class="footer">
      <p>Generated on ${new Date().toLocaleString()}</p>
    </div>
  </div>
</body>
</html>
    `;
    
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('[Debug Sidebar] Error:', error);
    return new NextResponse(
      `<html><body><h1>Error</h1><p>${error instanceof Error ? error.message : 'Unknown error'}</p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
}


