// Fix Holdings for U15352922 - use correct live prices for position_value
// Run: node claude_fix_holdings.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

// New quantities
// Live prices from live_prices table (as app uses them)
const newPositions = {
  SMH:  { qty: 3689,   price: 106.60  },
  IUIT: { qty: 498,    price: 51.83   },
  EQQQ: { qty: 31,     price: 720.60  },
  VUSD: { qty: 143,    price: 144.485 },
  DRAM: { qty: 775,    price: 58.665  },
};

const latestDate = db.prepare(
  "SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'"
).get().d;

console.log(`Fixing Holdings for U15352922 on report_date: ${latestDate}`);
console.log("─".repeat(70));

const update = db.prepare(`
  UPDATE Holdings
  SET position = ?,
      mark_price = ?,
      position_value = ?
  WHERE account_id = 'U15352922'
    AND symbol = ?
    AND report_date = ?
`);

let grandTotal = 0;
for (const [symbol, { qty, price }] of Object.entries(newPositions)) {
  const before = db.prepare(
    "SELECT position, mark_price, position_value FROM Holdings WHERE account_id='U15352922' AND symbol=? AND report_date=?"
  ).get(symbol, latestDate);

  if (!before) {
    console.log(`  ⚠️  ${symbol} — not found, skipping`);
    continue;
  }

  const newValue = qty * price;
  grandTotal += newValue;

  update.run(qty, price, newValue, symbol, latestDate);

  console.log(`  ✅ ${symbol.padEnd(5)} qty: ${String(before.position).padStart(7)} → ${String(qty).padStart(7)} | price: $${before.mark_price.toFixed(3)} → $${price.toFixed(3)} | value: $${before.position_value.toFixed(2)} → $${newValue.toFixed(2)}`);
}

const cash = 315;
console.log("\n" + "─".repeat(70));
console.log("New portfolio state:");
const holdings = db.prepare(
  "SELECT symbol, position, mark_price, position_value FROM Holdings WHERE account_id='U15352922' AND report_date=? ORDER BY position_value DESC"
).all(latestDate);

for (const h of holdings) {
  const pct = (h.position_value / grandTotal) * 100;
  console.log(`  ${h.symbol.padEnd(6)} qty: ${String(h.position).padStart(7)}  @ $${h.mark_price.toFixed(3).padStart(8)}  = $${h.position_value.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).padStart(12)}  (${pct.toFixed(1)}%)`);
}
console.log(`  ${"Cash".padEnd(6)}                                  $${cash.toFixed(2).padStart(12)}`);
console.log(`  ${"TOTAL".padEnd(6)}                                  $${(grandTotal + cash).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).padStart(12)}`);
console.log(`\n  Expected: ~$508,301.00`);
console.log(`  Calculated: $${(grandTotal + cash).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);

db.close();
console.log("\nDone. Hit Sync Portfolio in the app to refresh.");
