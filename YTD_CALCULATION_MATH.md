# YTD Calculation Math for Multiple Portfolios

## Overview
When selecting all 4 portfolios on the Dashboard, the YTD (Year-to-Date) calculation uses **aggregated NAV values** from all selected portfolios.

## Formula

### YTD Return (Percentage)
```
YTD % = (Aggregated Latest DB NAV - Aggregated Jan 1 2026 NAV) / Aggregated Jan 1 2026 NAV × 100
```

### YTD Value (Dollar Amount)
```
YTD Value = Aggregated Latest DB NAV - Aggregated Jan 1 2026 NAV
```

## Step-by-Step Calculation

### Step 1: Aggregate Jan 1, 2026 NAV
For each selected portfolio, find the NAV on or closest to January 1, 2026:

```
Total Jan 1 NAV = Σ(Jan 1 NAV_i) for all portfolios i
```

**Example with 4 portfolios:**
- Portfolio 1 (U15352922): Jan 1 NAV = $100,000
- Portfolio 2 (U16030763): Jan 1 NAV = $200,000
- Portfolio 3 (U16030764): Jan 1 NAV = $150,000
- Portfolio 4 (U16030765): Jan 1 NAV = $50,000

```
Total Jan 1 NAV = $100,000 + $200,000 + $150,000 + $50,000 = $500,000
```

### Step 2: Aggregate Latest DB NAV
For each selected portfolio, get the most recent NAV from the database:

```
Total Latest DB NAV = Σ(Latest DB NAV_i) for all portfolios i
```

**Example with 4 portfolios:**
- Portfolio 1: Latest DB NAV = $110,000
- Portfolio 2: Latest DB NAV = $220,000
- Portfolio 3: Latest DB NAV = $165,000
- Portfolio 4: Latest DB NAV = $55,000

```
Total Latest DB NAV = $110,000 + $220,000 + $165,000 + $55,000 = $550,000
```

### Step 3: Calculate YTD Value
```
YTD Value = Total Latest DB NAV - Total Jan 1 NAV
YTD Value = $550,000 - $500,000 = $50,000
```

### Step 4: Calculate YTD Return Percentage
```
YTD % = (YTD Value / Total Jan 1 NAV) × 100
YTD % = ($50,000 / $500,000) × 100 = 10.00%
```

## Complete Example

### Input Data (4 Portfolios)
| Portfolio | Jan 1, 2026 NAV | Latest DB NAV | Individual YTD % |
|-----------|----------------|---------------|-------------------|
| U15352922 | $100,000       | $110,000      | 10.00%            |
| U16030763 | $200,000       | $220,000      | 10.00%            |
| U16030764 | $150,000       | $165,000      | 10.00%            |
| U16030765 | $50,000        | $55,000       | 10.00%            |

### Aggregated Values
```
Total Jan 1 NAV = $100,000 + $200,000 + $150,000 + $50,000 = $500,000
Total Latest DB NAV = $110,000 + $220,000 + $165,000 + $55,000 = $550,000
```

### YTD Calculation
```
YTD Value = $550,000 - $500,000 = $50,000
YTD % = ($50,000 / $500,000) × 100 = 10.00%
```

## Important Notes

1. **Aggregation Method**: The system **sums** the NAV values from all selected portfolios. This is a simple aggregation, not a weighted average.

2. **Jan 1 NAV Lookup**:
   - First tries to find NAV on exactly January 1, 2026
   - If not found, uses the NAV from the closest date before Jan 1
   - If still not found, uses the first NAV record from January 2026 (within first 10 days)

3. **Latest DB NAV**: Uses the most recent NAV value from the database for each portfolio, then sums them.

4. **Consistency**: The formula matches the sidebar card calculation for individual portfolios:
   ```
   Individual Portfolio YTD % = (Latest DB NAV - Jan 1 2026 NAV) / Jan 1 2026 NAV × 100
   ```

5. **When Portfolios Have Different YTD %**: If portfolios have different individual YTD percentages, the aggregated YTD % will be a **weighted average** based on the Jan 1 NAV values:
   ```
   Aggregated YTD % = Σ(YTD Value_i) / Σ(Jan 1 NAV_i) × 100
   ```
   
   This is mathematically equivalent to:
   ```
   Aggregated YTD % = Σ(Jan 1 NAV_i × Individual YTD %_i) / Σ(Jan 1 NAV_i) × 100
   ```

## Code Location

The calculation is performed in:
- **File**: `app/api/live-prices/route.ts`
- **Lines**: 558-675
- **Function**: Dashboard YTD Performance Calculation section

## Mathematical Proof

For portfolios with different YTD percentages:

Let:
- `NAV_0_i` = Jan 1 NAV for portfolio i
- `NAV_t_i` = Latest DB NAV for portfolio i
- `YTD_i` = Individual YTD % for portfolio i

Then:
```
YTD_i = (NAV_t_i - NAV_0_i) / NAV_0_i × 100
```

Aggregated calculation:
```
Aggregated YTD % = (Σ(NAV_t_i) - Σ(NAV_0_i)) / Σ(NAV_0_i) × 100
                 = Σ(NAV_t_i - NAV_0_i) / Σ(NAV_0_i) × 100
                 = Σ(YTD Value_i) / Σ(NAV_0_i) × 100
```

This is a **weighted average** where each portfolio's contribution is weighted by its Jan 1 NAV:
```
Aggregated YTD % = Σ(NAV_0_i × YTD_i) / Σ(NAV_0_i) × 100
```

Where the weights are: `w_i = NAV_0_i / Σ(NAV_0_i)`











