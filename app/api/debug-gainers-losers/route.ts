export const dynamic = 'force-dynamic'
/**
 * Debug endpoint to show Daily Gainers/Losers calculation breakdown
 * GET /api/debug-gainers-losers?accountIds=U15352922,U16030763,U16030764,U16030765
 * Fetches fresh data from Yahoo Finance to compare with database values
 */
import { NextResponse } from 'next/server';
import { getDatabase, holdingQueries, livePriceQueries } from '@/lib/database';
import { mapSymbolForYahoo } from '@/lib/symbol-mapper';
import { fetchYahooPrice } from '@/lib/price-services/yahoo-finance';

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
    
    if (selectedAccountIds.length === 0) {
      return new NextResponse(
        `<html><body><h1>Error</h1><p>accountIds parameter required</p></body></html>`,
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }
    
    
    // Collect all positions from selected accounts
    const positionsBySymbol = new Map<string, {
      symbol: string;
      description: string;
      totalQuantity: number;
      totalPositionValue: number;
      accounts: Array<{ accountId: string; quantity: number; positionValue: number }>;
    }>();
    
    for (const accountId of selectedAccountIds) {
      try {
        const holdings = await holdingQueries.getLatestByAccount(accountId) as Array<{
          symbol: string;
          description: string;
          position: number;
          position_value: number;
        }>;
        
        for (const holding of holdings) {
          const symbol = holding.symbol.toUpperCase();
          
          // Skip cash
          if (symbol === 'CASH' || symbol === 'USD') {
            continue;
          }
          
          if (!positionsBySymbol.has(symbol)) {
            positionsBySymbol.set(symbol, {
              symbol: symbol,
              description: holding.description || symbol,
              totalQuantity: 0,
              totalPositionValue: 0,
              accounts: [],
            });
          }
          
          const pos = positionsBySymbol.get(symbol)!;
          pos.totalQuantity += holding.position;
          pos.totalPositionValue += holding.position_value;
          pos.accounts.push({
            accountId: accountId,
            quantity: holding.position,
            positionValue: holding.position_value,
          });
        }
      } catch (error) {
        console.warn(`Error fetching holdings for account ${accountId}:`, error);
      }
    }
    
    // Get prices for all symbols - fetch fresh from Yahoo Finance AND get from database
    const breakdown: Array<{
      symbol: string;
      description: string;
      totalQuantity: number;
      totalPositionValue: number;
      // Database values
      dbCurrentPrice: number;
      dbPreviousClose: number | null;
      dbPreviousCloseDate: string | null;
      dbPriceUpdatedAt: string | null;
      // Yahoo Finance values (fresh fetch)
      yahooCurrentPrice: number | null;
      yahooPreviousClose: number | null;
      yahooFetchError: string | null;
      // Calculated values (using Yahoo Finance data)
      dailyChange: number;
      dailyChangePercent: number;
      currentLiveValue: number;
      mappedSymbol: string;
      accounts: Array<{ accountId: string; quantity: number; positionValue: number }>;
    }> = [];
    
    // Fetch fresh data from Yahoo Finance for all symbols
    console.log(`[Debug Gainers/Losers] Fetching fresh data from Yahoo Finance for ${positionsBySymbol.size} symbols...`);
    
    for (const [symbol, pos] of positionsBySymbol.entries()) {
      const mappedSymbol = mapSymbolForYahoo(symbol);
      
      // Get price from database
      const priceRecord = await livePriceQueries.get(mappedSymbol) as {
        price: number;
        previous_close: number | null;
        previous_close_date: string | null;
        updated_at: string;
      } | undefined;
      
      const dbCurrentPrice = priceRecord?.price || 0;
      const dbPreviousClose = priceRecord?.previous_close || null;
      const dbPreviousCloseDate = priceRecord?.previous_close_date || null;
      const dbPriceUpdatedAt = priceRecord?.updated_at || null;
      
      // Fetch fresh data from Yahoo Finance
      let yahooCurrentPrice: number | null = null;
      let yahooPreviousClose: number | null = null;
      let yahooFetchError: string | null = null;
      
      try {
        console.log(`[Debug Gainers/Losers] Fetching ${symbol} (mapped: ${mappedSymbol}) from Yahoo Finance...`);
        const yahooData = await fetchYahooPrice(mappedSymbol);
        if (yahooData) {
          yahooCurrentPrice = yahooData.price;
          yahooPreviousClose = yahooData.previousClose ?? null;
          console.log(`[Debug Gainers/Losers] ✓ ${symbol}: Yahoo Price=$${yahooCurrentPrice.toFixed(2)}, PreviousClose=${yahooPreviousClose ? `$${yahooPreviousClose.toFixed(2)}` : 'NULL'}`);
        } else {
          yahooFetchError = 'No data returned from Yahoo Finance';
          console.warn(`[Debug Gainers/Losers] ⚠️ ${symbol}: ${yahooFetchError}`);
        }
      } catch (error) {
        yahooFetchError = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Debug Gainers/Losers] ❌ ${symbol}: Error fetching from Yahoo Finance:`, yahooFetchError);
      }
      
      // Calculate daily change using Yahoo Finance data (preferred) or database data (fallback)
      const currentPrice = yahooCurrentPrice ?? dbCurrentPrice;
      const previousClose = yahooPreviousClose ?? dbPreviousClose;
      
      let dailyChange = 0;
      let dailyChangePercent = 0;
      
      if (previousClose && previousClose > 0) {
        dailyChange = currentPrice - previousClose;
        dailyChangePercent = (dailyChange / previousClose) * 100;
      }
      
      // Current Live Value = Current Price × Quantity
      const currentLiveValue = currentPrice * pos.totalQuantity;
      
      breakdown.push({
        symbol: symbol,
        description: pos.description,
        totalQuantity: pos.totalQuantity,
        totalPositionValue: pos.totalPositionValue,
        dbCurrentPrice: dbCurrentPrice,
        dbPreviousClose: dbPreviousClose,
        dbPreviousCloseDate: dbPreviousCloseDate,
        dbPriceUpdatedAt: dbPriceUpdatedAt,
        yahooCurrentPrice: yahooCurrentPrice,
        yahooPreviousClose: yahooPreviousClose,
        yahooFetchError: yahooFetchError,
        dailyChange: dailyChange,
        dailyChangePercent: dailyChangePercent,
        currentLiveValue: currentLiveValue,
        mappedSymbol: mappedSymbol,
        accounts: pos.accounts,
      });
    }
    
    // Sort by daily change percent (descending for gainers, ascending for losers)
    breakdown.sort((a, b) => b.dailyChangePercent - a.dailyChangePercent);
    
    const gainers = breakdown.filter(p => p.dailyChangePercent > 0).slice(0, 10);
    const losers = breakdown.filter(p => p.dailyChangePercent < 0).slice(0, 10).reverse();
    
    // Build HTML table
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Debug: Daily Gainers/Losers Calculation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      padding: 20px;
      line-height: 1.6;
    }
    h1 {
      color: #ffffff;
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    h2 {
      color: #60a5fa;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    .formula-section {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .formula-item {
      margin-bottom: 15px;
    }
    .formula-item label {
      display: block;
      color: #9ca3af;
      font-size: 0.9em;
      margin-bottom: 5px;
    }
    .formula-item code {
      display: block;
      background: #0a0a0a;
      padding: 10px;
      border-radius: 4px;
      color: #60a5fa;
      font-size: 0.95em;
      border: 1px solid #333;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
      background: #1a1a1a;
      border-radius: 8px;
      overflow: hidden;
    }
    th {
      background: #3b82f6;
      color: #ffffff;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid #2563eb;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #333;
    }
    tr:hover {
      background: #252525;
    }
    .positive {
      color: #10b981;
      font-weight: 600;
    }
    .negative {
      color: #ef4444;
      font-weight: 600;
    }
    .neutral {
      color: #9ca3af;
    }
    .account-details {
      font-size: 0.85em;
      color: #9ca3af;
      margin-top: 5px;
    }
    .note {
      background: #1e3a8a;
      border-left: 4px solid #3b82f6;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .note strong {
      color: #60a5fa;
    }
  </style>
</head>
<body>
  <h1>🔍 Debug: Daily Gainers/Losers Calculation</h1>
  
  <div class="formula-section">
    <h2>Calculation Formula</h2>
    <div class="formula-item">
      <label>Daily Change % (matches TradingView):</label>
      <code>Daily Change % = (Current Price - Previous Close) / Previous Close × 100</code>
    </div>
    <div class="formula-item">
      <label>Current Live Value:</label>
      <code>Current Live Value = Current Price × Total Quantity</code>
    </div>
    <div class="formula-item">
      <label>Latest DB Position Value:</label>
      <code>Latest DB Position Value = Sum of position_value from Holdings table (all selected accounts)</code>
    </div>
  </div>
  
  <div class="note">
    <strong>Note:</strong> This debug endpoint fetches FRESH data from Yahoo Finance for each symbol to compare with database values.<br><br>
    <strong>Columns:</strong><br>
    • <strong>DB Current Price / DB Previous Close:</strong> Values stored in database<br>
    • <strong>Yahoo Current Price / Yahoo Previous Close:</strong> Fresh values fetched from Yahoo Finance (highlighted in green if different from DB)<br>
    • <strong>Daily Change %:</strong> Calculated using Yahoo Finance data (if available) or DB data (fallback)<br><br>
    <strong>If values differ:</strong> Trigger <code>/api/update-live-prices</code> to update the database with Yahoo Finance values.
  </div>
  
  <h2>📈 Top 10 Daily Gainers</h2>
  <table>
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Description</th>
        <th>DB Current Price</th>
        <th>DB Previous Close</th>
        <th>Yahoo Current Price</th>
        <th>Yahoo Previous Close</th>
        <th>Yahoo Error</th>
        <th>Daily Change</th>
        <th>Daily Change %</th>
        <th>Total Quantity</th>
        <th>Current Live Value</th>
        <th>Latest DB Position Value</th>
        <th>Mapped Symbol</th>
      </tr>
    </thead>
    <tbody>
      ${gainers.map(pos => `
        <tr>
          <td><strong>${pos.symbol}</strong></td>
          <td>${pos.description}</td>
          <td>${pos.dbCurrentPrice > 0 ? formatCurrency(pos.dbCurrentPrice) : '<span class="neutral">N/A</span>'}</td>
          <td>${pos.dbPreviousClose ? formatCurrency(pos.dbPreviousClose) : '<span class="neutral">N/A</span>'}</td>
          <td class="${pos.yahooCurrentPrice && pos.yahooCurrentPrice !== pos.dbCurrentPrice ? 'positive' : ''}">${pos.yahooCurrentPrice ? formatCurrency(pos.yahooCurrentPrice) : '<span class="neutral">N/A</span>'}</td>
          <td class="${pos.yahooPreviousClose && pos.yahooPreviousClose !== pos.dbPreviousClose ? 'positive' : ''}">${pos.yahooPreviousClose ? formatCurrency(pos.yahooPreviousClose) : '<span class="neutral">N/A</span>'}</td>
          <td><small>${pos.yahooFetchError ? `<span class="negative">${pos.yahooFetchError}</span>` : '<span class="neutral">OK</span>'}</small></td>
          <td class="positive">${pos.yahooPreviousClose || pos.dbPreviousClose ? formatCurrency(pos.dailyChange) : '<span class="neutral">N/A</span>'}</td>
          <td class="positive">${pos.yahooPreviousClose || pos.dbPreviousClose ? formatPercent(pos.dailyChangePercent) : '<span class="neutral">N/A</span>'}</td>
          <td>${pos.totalQuantity.toFixed(4)}</td>
          <td>${(pos.yahooCurrentPrice ?? pos.dbCurrentPrice) > 0 ? formatCurrency(pos.currentLiveValue) : '<span class="neutral">N/A</span>'}</td>
          <td>${formatCurrency(pos.totalPositionValue)}</td>
          <td><small>${pos.mappedSymbol}</small></td>
        </tr>
        ${pos.accounts.length > 1 ? `
        <tr class="account-details">
          <td colspan="13">
            <strong>Account Breakdown:</strong>
            ${pos.accounts.map(acc => `${acc.accountId}: qty=${acc.quantity.toFixed(4)}, value=${formatCurrency(acc.positionValue)}`).join(' | ')}
          </td>
        </tr>
        ` : ''}
      `).join('')}
    </tbody>
  </table>
  
  <h2>📉 Top 10 Daily Losers</h2>
  <table>
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Description</th>
        <th>DB Current Price</th>
        <th>DB Previous Close</th>
        <th>Yahoo Current Price</th>
        <th>Yahoo Previous Close</th>
        <th>Yahoo Error</th>
        <th>Daily Change</th>
        <th>Daily Change %</th>
        <th>Total Quantity</th>
        <th>Current Live Value</th>
        <th>Latest DB Position Value</th>
        <th>Mapped Symbol</th>
      </tr>
    </thead>
    <tbody>
      ${losers.map(pos => `
        <tr>
          <td><strong>${pos.symbol}</strong></td>
          <td>${pos.description}</td>
          <td>${pos.dbCurrentPrice > 0 ? formatCurrency(pos.dbCurrentPrice) : '<span class="neutral">N/A</span>'}</td>
          <td>${pos.dbPreviousClose ? formatCurrency(pos.dbPreviousClose) : '<span class="neutral">N/A</span>'}</td>
          <td class="${pos.yahooCurrentPrice && pos.yahooCurrentPrice !== pos.dbCurrentPrice ? 'positive' : ''}">${pos.yahooCurrentPrice ? formatCurrency(pos.yahooCurrentPrice) : '<span class="neutral">N/A</span>'}</td>
          <td class="${pos.yahooPreviousClose && pos.yahooPreviousClose !== pos.dbPreviousClose ? 'positive' : ''}">${pos.yahooPreviousClose ? formatCurrency(pos.yahooPreviousClose) : '<span class="neutral">N/A</span>'}</td>
          <td><small>${pos.yahooFetchError ? `<span class="negative">${pos.yahooFetchError}</span>` : '<span class="neutral">OK</span>'}</small></td>
          <td class="negative">${pos.yahooPreviousClose || pos.dbPreviousClose ? formatCurrency(pos.dailyChange) : '<span class="neutral">N/A</span>'}</td>
          <td class="negative">${pos.yahooPreviousClose || pos.dbPreviousClose ? formatPercent(pos.dailyChangePercent) : '<span class="neutral">N/A</span>'}</td>
          <td>${pos.totalQuantity.toFixed(4)}</td>
          <td>${(pos.yahooCurrentPrice ?? pos.dbCurrentPrice) > 0 ? formatCurrency(pos.currentLiveValue) : '<span class="neutral">N/A</span>'}</td>
          <td>${formatCurrency(pos.totalPositionValue)}</td>
          <td><small>${pos.mappedSymbol}</small></td>
        </tr>
        ${pos.accounts.length > 1 ? `
        <tr class="account-details">
          <td colspan="13">
            <strong>Account Breakdown:</strong>
            ${pos.accounts.map(acc => `${acc.accountId}: qty=${acc.quantity.toFixed(4)}, value=${formatCurrency(acc.positionValue)}`).join(' | ')}
          </td>
        </tr>
        ` : ''}
      `).join('')}
    </tbody>
  </table>
  
  <div class="note">
    <strong>Data Sources:</strong><br>
    • Current Price: From <code>live_prices</code> table (updated by background worker)<br>
    • Previous Close: From <code>live_prices.previous_close</code> column<br>
    • Latest DB Position Value: From <code>Holdings.position_value</code> (latest record per account)<br>
    • Total Quantity: Sum of <code>Holdings.position</code> across all selected accounts
  </div>
</body>
</html>
    `;
    
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('[Debug Gainers/Losers] Error:', error);
    return new NextResponse(
      `<html><body><h1>Error</h1><p>${error instanceof Error ? error.message : 'Unknown error'}</p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
}


