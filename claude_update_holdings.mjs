// Update Holdings for U15352922 with new quantities
// Run: node claude_update_holdings.mjs
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

const newQty = {
  SMH:  3689,
  IUIT: 498,
  EQQQ: 31,
  VUSD: 143,
  DRAM: 775,
};

const latestDate = db.prepare(
  "SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'"
).get().d;

console.log(`Updating Holdings for U15352922 on report_date: ${latestDate}`);
console.log("─".repeat(60));

const update = db.prepare(`
  UPDATE Holdings
  SET position = ?,
      position_value = ? * mark_price
  WHERE account_id = 'U15352922'
    AND symbol = ?
    AND report_date = ?
`);

for (const [symbol, qty] of Object.entries(newQty)) {
  const before = db.prepare(
    "SELECT position, mark_price, position_value FROM Holdings WHERE account_id='U15352922' AND symbol=? AND report_date=?"
  ).get(symbol, latestDate);

  if (!before) {
    console.log(`  ⚠️  ${symbol} — not found on ${latestDate}, skipping`);
    continue;
  }

  update.run(qty, qty, symbol, latestDate);

  const after = db.prepare(
    "SELECT position, mark_price, position_value FROM Holdings WHERE account_id='U15352922' AND symbol=? AND report_date=?"
  ).get(symbol, latestDate);

  const chg = qty - before.position;
  console.log(`  ✅ ${symbol}: ${before.position} → ${after.position} (${chg >= 0 ? '+' : ''}${chg}) | $${before.position_value.toFixed(2)} → $${after.position_value.toFixed(2)}`);
}

// Verify total
const holdings = db.prepare(
  "SELECT symbol, position, mark_price, position_value FROM Holdings WHERE account_id='U15352922' AND report_date=? ORDER BY position_value DESC"
).all(latestDate);

const total = holdings.reduce((s, h) => s + h.position_value, 0);
console.log("\n" + "─".repeat(60));
console.log("New portfolio state:");
for (const h of holdings) {
  console.log(`  ${h.symbol.padEnd(6)} qty: ${String(h.position).padStart(7)}  @ $${h.mark_price.toFixed(3)}  = $${h.position_value.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
}
console.log(`  TOTAL                              $${total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);

db.close();
console.log("\nDone. Refresh the app to see updated positions.");
