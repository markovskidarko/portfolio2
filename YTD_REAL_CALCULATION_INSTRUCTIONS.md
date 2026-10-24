# How to Get Real YTD Calculation Breakdown

## Method 1: Using the Debug API Endpoint

I've created a debug endpoint that will show you the exact YTD calculation with full breakdown.

### Access the Endpoint

1. **Start your Next.js dev server** (if not already running):
   ```bash
   npm run dev
   ```

2. **Open your browser** and navigate to:
   ```
   http://localhost:3000/api/debug-ytd?accountIds=U15352922,U16030763,U16030764,U16030765
   ```

   Or if you want to see all accounts:
   ```
   http://localhost:3000/api/debug-ytd
   ```

3. **The response will show**:
   - Full breakdown for each portfolio (Jan 1 NAV, Latest NAV, Individual YTD)
   - Aggregated values (Total Jan 1 NAV, Total Latest NAV)
   - Final YTD calculation with the exact formula used

### Example Response Format

```json
{
  "calculation": {
    "formula": "YTD % = (Aggregated Latest DB NAV - Aggregated Jan 1 2026 NAV) / Aggregated Jan 1 2026 NAV × 100",
    "aggregatedJan1Nav": 500000.00,
    "aggregatedLatestNav": 550000.00,
    "aggregatedYtdValue": 50000.00,
    "aggregatedYtdReturn": 10.00
  },
  "breakdown": [
    {
      "accountId": "U15352922",
      "accountAlias": "Portfolio 1",
      "jan1Nav": 100000.00,
      "jan1Date": "2026-01-01",
      "latestNav": 110000.00,
      "latestDate": "2026-01-15",
      "ytdValue": 10000.00,
      "ytdReturn": 10.00
    },
    // ... more portfolios
  ],
  "summary": {
    "numberOfPortfolios": 4,
    "totalJan1Nav": "500000.00",
    "totalLatestNav": "550000.00",
    "totalYtdValue": "50000.00",
    "totalYtdReturn": "10.00%"
  }
}
```

## Method 2: Check Browser Console Logs

When you load the dashboard with all 4 portfolios selected, the browser console will show detailed YTD calculation logs from the `/api/live-prices` endpoint.

Look for logs like:
```
[Live Prices API] ===== DASHBOARD YTD PERFORMANCE CALCULATION =====
[Live Prices API] MULTIPLE PORTFOLIOS: Jan 1 2026 NAV for U15352922: $XXX.XX (date: YYYY-MM-DD)
[Live Prices API] MULTIPLE PORTFOLIOS: Aggregated Jan 1 2026 NAV: $XXX.XX
[Live Prices API] DASHBOARD YTD Calculation:
[Live Prices API]   Aggregated Latest DB NAV: $XXX.XX
[Live Prices API]   Aggregated Jan 1 2026 NAV: $XXX.XX
[Live Prices API]   YTD Value: $XXX.XX
[Live Prices API]   YTD %: +X.XX%
```

## Method 3: Check Server Logs

The same detailed logs are also printed to your terminal/console where the Next.js server is running.

## Understanding the Calculation

The endpoint shows:

1. **Individual Portfolio Breakdown**: Each portfolio's Jan 1 NAV, Latest NAV, and individual YTD
2. **Aggregated Values**: Sum of all Jan 1 NAVs and Latest NAVs
3. **Final YTD**: Calculated using the formula:
   ```
   YTD % = (Total Latest NAV - Total Jan 1 NAV) / Total Jan 1 NAV × 100
   ```

This matches exactly what the dashboard displays when all 4 portfolios are selected.











