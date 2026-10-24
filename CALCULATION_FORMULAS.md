# Portfolio Calculation Formulas

This document explains the mathematical formulas used for all portfolio calculations.

---

## 1. Side Menu Card Value (Per Portfolio)

**Location:** `app/api/live-prices/route.ts` (lines 852-920)

**Formula:**
```
Side Menu Card Value = Account Position Value + Account Cash

Where:
- Account Position Value = Σ (Live Price × Quantity) for each holding in the portfolio
- Account Cash = Cash amount from Cash table (converted to base currency)
```

**Step-by-step:**
1. For each holding in the portfolio:
   ```
   Position Value = Live Price × Quantity
   ```

2. Sum all position values:
   ```
   Total Position Value = Σ (Position Value for each holding)
   ```

3. Add cash:
   ```
   Side Menu Card Value = Total Position Value + Cash
   ```

**Example:**
```
Portfolio U16030763:
- AAPL: 15 shares × $259.37 = $3,890.55
- AMZN: 16 shares × $247.38 = $3,958.08
- Cash: $417.33
Total = $3,890.55 + $3,958.08 + $417.33 = $8,265.96
```

**Note:** This is **static per portfolio** - it doesn't change based on selection. Calculated for ALL portfolios separately.

---

## 2. Side Menu Card Today Percentage (Per Portfolio)

**Location:** `app/api/live-prices/route.ts` (lines 922-954)

**Formula:**
```
Today % = (Live Data NAV - Latest NAV from Database) / Latest NAV from Database × 100

Where:
- Live Data NAV = Side Menu Card Value (from formula #1)
- Latest NAV from Database = Most recent NAV record from DailyNAV table for this specific portfolio
```

**Step-by-step:**
1. Get Live Data NAV (from formula #1):
   ```
   Live Data NAV = Account Position Value + Account Cash
   ```

2. Get latest NAV from database:
   ```
   Latest NAV from DB = SELECT nav_value FROM DailyNAV 
                        WHERE account_id = [Account ID] 
                        ORDER BY date DESC LIMIT 1
   ```

3. Calculate percentage change:
   ```
   Today $ = Live Data NAV - Latest NAV from DB
   Today % = (Today $ / Latest NAV from DB) × 100
   ```

**Example:**
```
Portfolio U16030763:
- Live Data NAV: $171,486.73
- Latest NAV from DB (2026-01-08): $171,486.73
- Today $ = $171,486.73 - $171,486.73 = $0.00
- Today % = ($0.00 / $171,486.73) × 100 = 0.00%
```

**Note:** This is **static per portfolio** - calculated individually for each portfolio card, regardless of selection.

---

## 3. Side Menu Card YTD Percentage (Per Portfolio)

**Location:** `app/api/accounts/route.ts` (lines 10-58)

**Formula:**
```
YTD % = (Current NAV - Jan 1 NAV) / Jan 1 NAV × 100

Where:
- Current NAV = Latest NAV from database for this portfolio
- Jan 1 NAV = NAV on or closest to January 1st of current year for this portfolio
```

**Step-by-step:**
1. Find January 1st NAV:
   ```
   Jan 1 NAV = NAV record on or before January 1, [Current Year]
              If no exact match, use closest previous record
   ```

2. Get current NAV:
   ```
   Current NAV = Latest NAV from DailyNAV table for this portfolio
   ```

3. Calculate YTD:
   ```
   YTD $ = Current NAV - Jan 1 NAV
   YTD % = (YTD $ / Jan 1 NAV) × 100
   ```

**Example:**
```
Portfolio U15352922:
- Jan 1 NAV (2026-01-01): $300,000.00
- Current NAV (2026-01-09): $351,113.08
- YTD $ = $351,113.08 - $300,000.00 = $51,113.08
- YTD % = ($51,113.08 / $300,000.00) × 100 = 17.04%
```

**Note:** This is **static per portfolio** - calculated individually for each portfolio using its own NAV records.

---

## 4. Dashboard Total Wealth (All 4 Portfolios)

**Location:** `app/page.tsx` (lines 415-429) and `app/api/live-prices/route.ts` (lines 458-463)

**Formula:**
```
Dashboard Total Wealth = Σ (Side Menu Card Value for each selected portfolio)

Where:
- Only portfolios that are currently selected are included
- Each Side Menu Card Value is calculated using formula #1
```

**Step-by-step:**
1. For each selected portfolio, get its Live Data NAV:
   ```
   Portfolio Live Data NAV = Account Position Value + Account Cash
   ```

2. Sum all selected portfolios:
   ```
   Dashboard Total Wealth = Σ (Portfolio Live Data NAV for selected portfolios)
   ```

**Example:**
```
Selected Portfolios: U15352922, U15405459, U16030763, U22758796

- U15352922 Live Data NAV: $351,113.08
- U15405459 Live Data NAV: $87,424.31
- U16030763 Live Data NAV: $171,486.73
- U22758796 Live Data NAV: $66,752.87

Dashboard Total Wealth = $351,113.08 + $87,424.31 + $171,486.73 + $66,752.87
                       = $676,776.99
```

**Note:** This is **dynamic** - changes based on which portfolios are selected.

---

## 5. Dashboard Today Percentage

**Location:** `app/api/live-prices/route.ts` (lines 465-535)

**Formula:**
```
Dashboard Today % = (Dashboard Live Data NAV - Aggregated Latest NAV from DB) / Aggregated Latest NAV from DB × 100

Where:
- Dashboard Live Data NAV = Dashboard Total Wealth (from formula #4)
- Aggregated Latest NAV from DB = Σ (Latest NAV from database for each selected portfolio)
```

**Step-by-step:**

**For Single Portfolio:**
```
1. Get Live Data NAV for the single selected portfolio
2. Get Latest NAV from DB for that portfolio
3. Today % = (Live Data NAV - Latest NAV from DB) / Latest NAV from DB × 100
```

**For Multiple Portfolios:**
```
1. Calculate Dashboard Live Data NAV (formula #4)
2. For each selected portfolio:
   - Get Latest NAV from DB = SELECT nav_value FROM DailyNAV 
                              WHERE account_id = [Account ID] 
                              ORDER BY date DESC LIMIT 1
3. Sum all Latest NAVs:
   Aggregated Latest NAV from DB = Σ (Latest NAV for each selected portfolio)

4. Calculate percentage:
   Today $ = Dashboard Live Data NAV - Aggregated Latest NAV from DB
   Today % = (Today $ / Aggregated Latest NAV from DB) × 100
```

**Example (Multiple Portfolios):**
```
Selected: U15352922, U15405459, U16030763, U22758796

Dashboard Live Data NAV: $685,912.27

Latest NAV from DB (per portfolio):
- U15352922: $351,113.08 (2026-01-09)
- U15405459: $87,424.31 (2026-01-09)
- U16030763: $171,486.73 (2026-01-08)
- U22758796: $66,752.87 (2026-01-09)

Aggregated Latest NAV from DB = $351,113.08 + $87,424.31 + $171,486.73 + $66,752.87
                               = $676,776.99

Today $ = $685,912.27 - $676,776.99 = $9,135.28
Today % = ($9,135.28 / $676,776.99) × 100 = +1.35%
```

**Note:** This is **dynamic** - changes based on which portfolios are selected and updates in real-time with live prices.

---

## 6. Dashboard YTD Percentage

**Location:** `lib/calculations.ts` (lines 190-238) and `app/page.tsx` (lines 468-507)

**Formula:**
```
Dashboard YTD % = (Current Aggregated NAV - Jan 1 Aggregated NAV) / Jan 1 Aggregated NAV × 100

Where:
- Current Aggregated NAV = Dashboard Total Wealth (from formula #4)
- Jan 1 Aggregated NAV = Sum of NAVs for all selected portfolios on January 1st
```

**Step-by-step:**

**For Single Portfolio:**
```
If only one portfolio is selected:
  - Use that portfolio's YTD from sidebar card (formula #3)
  - Ensures dashboard matches sidebar card
```

**For Multiple Portfolios:**
```
1. Get equity curve (aggregated NAV history for all selected portfolios)
2. Find January 1st aggregated NAV:
   Jan 1 Aggregated NAV = Equity curve point on or before January 1, [Current Year]
                          (from aggregated equity curve)

3. Get current aggregated NAV:
   Current Aggregated NAV = Dashboard Total Wealth (formula #4)

4. Calculate YTD:
   YTD $ = Current Aggregated NAV - Jan 1 Aggregated NAV
   YTD % = (YTD $ / Jan 1 Aggregated NAV) × 100
```

**Example (Multiple Portfolios):**
```
Selected: U15352922, U15405459, U16030763, U22758796

Current Aggregated NAV (2026-01-09): $685,912.27

Jan 1 Aggregated NAV (from equity curve):
- On 2026-01-01, aggregated NAV = $650,000.00
  (This is the sum of NAVs for all 4 portfolios on Jan 1)

YTD $ = $685,912.27 - $650,000.00 = $35,912.27
YTD % = ($35,912.27 / $650,000.00) × 100 = +5.52%
```

**Note:** This is **dynamic** - changes based on which portfolios are selected. For single portfolio, it matches the sidebar card YTD.

---

## Summary Table

| Metric | Location | Formula | Static/Dynamic |
|--------|----------|---------|----------------|
| **Side Menu Card Value** | `app/api/live-prices/route.ts:852-920` | `Σ(Live Price × Quantity) + Cash` | **Static** (per portfolio) |
| **Side Menu Card Today %** | `app/api/live-prices/route.ts:922-954` | `(Live NAV - Latest DB NAV) / Latest DB NAV × 100` | **Static** (per portfolio) |
| **Side Menu Card YTD %** | `app/api/accounts/route.ts:10-58` | `(Current NAV - Jan 1 NAV) / Jan 1 NAV × 100` | **Static** (per portfolio) |
| **Dashboard Total Wealth** | `app/page.tsx:415-429` | `Σ(Side Menu Card Value for selected)` | **Dynamic** (based on selection) |
| **Dashboard Today %** | `app/api/live-prices/route.ts:465-535` | `(Aggregated Live NAV - Aggregated Latest DB NAV) / Aggregated Latest DB NAV × 100` | **Dynamic** (based on selection) |
| **Dashboard YTD %** | `lib/calculations.ts:190-238` | `(Current Aggregated NAV - Jan 1 Aggregated NAV) / Jan 1 Aggregated NAV × 100` | **Dynamic** (based on selection) |

---

## Key Points

1. **Side Menu Cards are Static**: Each portfolio card always shows its own individual performance, regardless of which portfolios are selected on the dashboard.

2. **Dashboard is Dynamic**: Dashboard metrics change based on which portfolios are selected. When all 4 portfolios are selected, it shows aggregated metrics.

3. **Single Portfolio Mode**: When only one portfolio is selected, the dashboard Today and YTD values should match the sidebar card values for that portfolio.

4. **Live Data NAV**: Always calculated from live prices (Yahoo Finance/TradingView) and current holdings, plus cash.

5. **Database NAV**: Historical NAV values stored in the `DailyNAV` table from IBKR sync.

6. **Today Calculation**: Uses latest database NAV as "previous close" and compares against live data NAV.

7. **YTD Calculation**: Uses January 1st NAV as baseline and compares against current NAV.













