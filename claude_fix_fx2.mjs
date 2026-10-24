// Fix fx_rate_to_base to 1.0 for all U15352922 holdings
// Yahoo Finance reports .L and .SW prices already in USD - no FX conversion needed
// Run: node claude_fix_fx2.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

const latestDate = db.prepare(
  "SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'"
).get().d;

// Exact prices from Yahoo Finance screenshot
const yahooData = {
  SMH:  { price: 106.60, qty: 3689 },
  IUIT: { price: 51.83,  qty: 498  },
  EQQQ: { price: 719.90, qty: 31   },
  VUSD: { price: 144.49, qty: 143  },
  DRAM: { price: 59.61,  qty: 775  },
};

console.log(`Fixing Holdings for U15352922 on report_date: ${latestDate}`);
console.log("Setting fx_rate_to_base=1.0 and using exact Yahoo prices");
console.log("─".repeat(75));

const update = db.prepare(`
  UPDATE Holdings
  SET position       = ?,
      mark_price     = ?,
      position_value = ?,
      fx_rate_to_base = 1.0
  WHERE account_id = 'U15352922'
    AND symbol = ?
    AND report_date = ?
`);

let grandTotal = 0;
for (const [symbol, { price, qty }] of Object.entries(yahooData)) {
  const before = db.prepare(
    "SELECT position, mark_price, position_value, fx_rate_to_base FROM Holdings WHERE account_id='U15352922' AND symbol=? AND report_date=?"
  ).get(symbol, latestDate);

  if (!before) {
    console.log(`  ⚠️  ${symbol} — not found, skipping`);
    continue;
  }

  const newValue = qty * price;
  grandTotal += newValue;
  update.run(qty, price, newValue, symbol, latestDate);

  console.log(`  ✅ ${symbol.padEnd(5)} qty: ${qty.toString().padStart(5)} | price: $${price.toFixed(2)} | fx: ${before.fx_rate_to_base} → 1.0 | value: $${before.position_value.toFixed(2)} → $${newValue.toFixed(2)}`);
}

const cash = 315;
const totalNAV = grandTotal + cash;

console.log("\n" + "─".repeat(75));
console.log("New portfolio state:");
const holdings = db.prepare(
  "SELECT symbol, position, mark_price, position_value, fx_rate_to_base FROM Holdings WHERE account_id='U15352922' AND report_date=? ORDER BY position_value DESC"
).all(latestDate);

for (const h of holdings) {
  const pct = (h.position_value / grandTotal) * 100;
  console.log(`  ${h.symbol.padEnd(6)} qty: ${String(h.position).padStart(5)} | @ $${h.mark_price.toFixed(2).padStart(7)} | fx: ${h.fx_rate_to_base} | = $${h.position_value.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).padStart(12)} (${pct.toFixed(1)}%)`);
}
console.log(`  ${"Cash".padEnd(6)}                                   $${cash.toFixed(2).padStart(12)}`);
console.log(`  ${"TOTAL".padEnd(6)}                                   $${totalNAV.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).padStart(12)}`);
console.log(`\n  Yahoo target:  $508,301.16`);
console.log(`  Our total:     $${totalNAV.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
console.log(`  Difference:    $${(totalNAV - 508301.16).toFixed(2)}`);

db.close();
console.log("\nDone. Hit Sync Portfolio in the app to refresh.");
