# KB Funds Current Value Calculation - Exact Math

## Constants (Fixed Units)

```
Stocks:    40,345.9594 units
Balanced:  23,886.3365 units
Gold:      28,266.8087 units
```

## Formula

### Step 1: Calculate Value in MKD for Each Fund

For each fund on a specific date:

```
Value MKD (Fund) = Price Per Unit (MKD) × Number of Units
```

### Step 2: Sum All Funds

```
Total Value MKD = Value MKD (Balanced) + Value MKD (Stocks) + Value MKD (Gold)
```

### Step 3: Convert to USD

```
Total Value USD = Total Value MKD ÷ USD/MKD Exchange Rate
```

Where: USD/MKD Exchange Rate ≈ 58 (1 USD = 58 MKD)

## Example Calculation

### Assumptions:
- Balanced price per unit: 250.50 MKD
- Stocks price per unit: 300.20 MKD
- Gold price per unit: 280.80 MKD
- Exchange rate: 58 (1 USD = 58 MKD)

### Step 1: Calculate Each Fund's Value in MKD

**Balanced:**
```
Value MKD = 250.50 MKD × 23,886.3365 units
Value MKD = 5,983,527.30 MKD
```

**Stocks:**
```
Value MKD = 300.20 MKD × 40,345.9594 units
Value MKD = 12,111,857.21 MKD
```

**Gold:**
```
Value MKD = 280.80 MKD × 28,266.8087 units
Value MKD = 7,937,320.28 MKD
```

### Step 2: Sum All Funds

```
Total Value MKD = 5,983,527.30 + 12,111,857.21 + 7,937,320.28
Total Value MKD = 26,032,704.79 MKD
```

### Step 3: Convert to USD

```
Total Value USD = 26,032,704.79 MKD ÷ 58
Total Value USD = $448,839.74
```

## Code Implementation

```typescript
// For each fund:
const units = KB_FUND_UNITS[fund];  // e.g., 23,886.3365 for Balanced
const valueMKD = price.price_per_unit_mkd * units;
totalValueMKD += valueMKD;

// After summing all funds:
const totalValueUSD = totalValueMKD / usdRate;  // usdRate = 58
```

## If You're Seeing $35,975,319.84

Working backwards:
```
$35,975,319.84 × 58 = 2,086,568,550.72 MKD
```

This means either:
1. **Exchange rate is wrong**: If rate = 0.017 instead of 58, then:
   - 26,032,704.79 ÷ 0.017 = $1,531,335,576 (too high)

2. **Price per unit values are wrong**: If prices are stored as total value instead of per-unit:
   - Instead of 250.50 MKD per unit, maybe 5,983,527.30 MKD is stored
   - Then: 5,983,527.30 × 23,886.3365 = 142,857,142,857 MKD (way too high)

3. **Units are wrong**: If units are 1000x too large:
   - 23,886,336.5 instead of 23,886.3365
   - Then: 250.50 × 23,886,336.5 = 5,983,527,000 MKD (1000x too high)




