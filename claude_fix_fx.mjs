// Diagnose and fix fx_rate_to_base for U15352922
// The app calculates: position * live_price * fx_rate_to_base
// For Yahoo .L prices (already in USD-equivalent), fx_rate_to_base should be 1.0
// Run: node claude_fix_fx.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

const latestDate = db.prepare(
  "SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'"
).get().d;

console.log("=== BEFORE: Holdings fx_rate_to_base ===");
const holdings = db.prepare(`
  SELECT symbol, position, mark_price, position_value, fx_rate_to_base, currency
  FROM Holdings WHERE account_id='U15352922' AND report_date=?
  ORDER BY position_value DESC
`).all(latestDate);

// Also get live prices
const livePrices = {};
const lp = db.prepare(`SELECT symbol, price FROM live_prices`).all();
for (const p of lp) livePrices[p.symbol] = p.price;

// Symbol map (from symbol-mapper.ts)
const symbolMap = { SMH: 'SMH.L', IUIT: 'IUIT.L', EQQQ: 'EQQQ.SW', VUSD: 'VUSD.L' };

let currentTotal = 0;
for (const h of holdings) {
  const yahooSym = symbolMap[h.symbol] || h.symbol;
  const livePrice = livePrices[yahooSym] || h.mark_price;
  const appCalc = h.position * livePrice * h.fx_rate_to_base;
  currentTotal += appCalc;
  console.log(`${h.symbol.padEnd(6)} | qty: ${h.position} | live: $${livePrice.toFixed(3)} | fx: ${h.fx_rate_to_base} | app_value: $${appCalc.toFixed(2)}`);
}
console.log(`Current app total (stocks): $${currentTotal.toFixed(2)}`);

// Yahoo Finance prices for these ETFs are in the local currency of the exchange
// SMH.L, IUIT.L, VUSD.L are in GBP (pence? or pounds?)
// EQQQ.SW is in CHF
// The Holdings.fx_rate_to_base converts from that currency to USD
// So the app's calculation IS correct: position * GBP_price * GBP_USD_rate = USD value
// The issue is: Yahoo Finance returns the CORRECT local currency price
// and fx_rate_to_base converts it to USD — this is working as designed!

// So the question is: what Yahoo Finance returns for SMH.L
// From live_prices: SMH.L = 106.60
// If 106.60 is in GBP, then 1571 * 106.60 * fx = USD value
// If fx = 1.19 GBP/USD → 1571 * 106.60 * 1.19 = $199,367 (too high for old qty)
// But old total was $505,270 which matched app... so fx must have been ~0.97 before

// NOW with qty 3689: 3689 * 106.60 * fx = ?
// App shows $582,693 stocks
// Let's find fx: 582693 - 315(cash) = stocks
// DRAM: 775 * 58.665 * 1.0 = 45,465
// GBP stocks: 3689*106.60*fx + 498*51.83*fx + 143*144.485*fx = 582693 - 315 - 45465
const target_stocks = 582693.27 - 315 - (775 * livePrices['DRAM']);
const gbp_exposure = 3689*106.60 + 498*51.83 + 143*144.485;
const chf_exposure = 31 * 720.60;
// Assume CHF fx ~ same as GBP fx (both stored per-holding)
// Actually each holding has its OWN fx_rate_to_base

console.log("\n=== fx_rate_to_base per symbol ===");
for (const h of holdings) {
  console.log(`  ${h.symbol.padEnd(6)}: currency=${h.currency}, fx_rate_to_base=${h.fx_rate_to_base}`);
}

// The fix: for Yahoo .L and .SW prices, the fx_rate_to_base from IBKR is the 
// exchange rate at time of the flex report (Jan/Jun 2026)
// We need to either:
// 1. Update fx_rate_to_base to current GBP/USD and CHF/USD rates
// 2. OR store USD-equivalent prices in mark_price and set fx=1

// Option 2 is cleaner - store today's USD value directly
// USD values from Yahoo: use the price * fx as the stored mark_price, set fx=1
// But we need the actual current GBP/USD and CHF/USD rates

// From the app's own NAV before our changes: $505,270 with old quantities
// Old: SMH=1571, IUIT=2063, EQQQ=134, VUSD=612.79, DRAM=775
// We know DRAM=45,465, Cash=315
// Old stocks = 505270 - 315 - 45465 = 459490
// GBP old: 1571*106.60 + 2063*51.83 + 612.79*144.485 = 167,469 + 106,925 + 88,539 = 362,933 GBP
// CHF old: 134 * 720.60 = 96,560 CHF
// 362,933*G + 96,560*C = 459,490
// If CHF/USD = C, GBP/USD = G
// From exchange rates Sep 2026: GBP/USD ~1.33, CHF/USD ~1.115
// 362,933*1.33 + 96,560*1.115 = 482,701 + 107,665 = 590,366 (too high)
// Try G=1.19: 362,933*1.19 + 96,560*1.115 = 431,890 + 107,665 = 539,555 (still high)
// Try G=0.97: 362,933*0.97 + 96,560*1.115 = 352,045 + 107,665 = 459,710 ✓ close!

const old_gbp = 1571*106.60 + 2063*51.83 + 612.7923*144.485;
const old_chf = 134*720.60;
const old_stocks_needed = 459490;
// Solve: old_gbp*G + old_chf*C = 459490
// With C=1.115: G = (459490 - 96560*1.115) / 362933 = (459490-107665)/362933 = 351825/362933 = 0.9694
const G = (old_stocks_needed - old_chf*1.115) / old_gbp;
const C = 1.115;
console.log(`\nSolved FX rates (from old NAV): GBP/USD=${G.toFixed(4)}, CHF/USD=${C.toFixed(4)}`);
console.log(`These are stored in fx_rate_to_base per holding`);

// Now with new quantities at same FX:
const new_total_with_fx = 
  3689*106.60*G + 498*51.83*G + 31*720.60*C + 143*144.485*G + 775*58.665*1.0 + 315;
console.log(`\nNew total with old FX rates: $${new_total_with_fx.toFixed(2)}`);
console.log(`App shows: $582,693`);

// Yahoo $508,301 must use USD prices directly (no FX conversion)
// SMH on Yahoo US = different price than SMH.L
// Let's check: if Yahoo portfolio uses SMH (US) at USD price
// SMH US price today? The live_prices doesn't have SMH (only SMH.L)
// User's Yahoo portfolio must use the US-listed versions: SMH, IUIT(US?), etc.

console.log("\n=== SOLUTION ===");
console.log("Yahoo portfolio $508,301 uses USD prices directly (US-listed ETFs or USD prices)");
console.log("This app uses .L/.SW Yahoo prices × GBP/CHF fx_rate_to_base");
console.log("To match Yahoo $508,301, we need to know the USD price per share the user used.");
console.log("\nTarget: $508,301");
console.log(`Cash: $315`);
console.log(`DRAM (775 @ $58.665 USD): $${(775*58.665).toFixed(2)}`);
const remaining = 508301 - 315 - 775*58.665;
console.log(`Remaining for 4 ETFs: $${remaining.toFixed(2)}`);
console.log(`IUIT(498) + EQQQ(31) + VUSD(143) = ?`);
console.log(`If we know those 3 values, SMH = remaining - those 3`);

db.close();
