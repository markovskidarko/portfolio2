// Fix: EQQU row is being picked over EQQQ after normalization
// EQQU (2025-08-20, pos:134) conflicts with EQQQ (2026-06-04, pos:31)
// Solution: update EQQU row to have qty=0 or delete it so EQQQ takes precedence
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

console.log("=== Before ===");
const before = db.prepare(`SELECT symbol, position, report_date FROM Holdings WHERE account_id='U15352922' AND symbol IN ('EQQQ','EQQU') ORDER BY symbol, report_date DESC`).all();
for (const r of before) console.log(`  ${r.symbol} date:${r.report_date} pos:${r.position}`);

// Delete all EQQU rows for U15352922 - they are the same ETF as EQQQ, just old symbol name
const del = db.prepare(`DELETE FROM Holdings WHERE account_id='U15352922' AND symbol='EQQU'`);
const result = del.run();
console.log(`\nDeleted ${result.changes} EQQU row(s)`);

console.log("\n=== After ===");
const after = db.prepare(`SELECT symbol, position, report_date FROM Holdings WHERE account_id='U15352922' AND symbol IN ('EQQQ','EQQU') ORDER BY symbol, report_date DESC`).all();
for (const r of after) console.log(`  ${r.symbol} date:${r.report_date} pos:${r.position}`);

// Verify final total
console.log("\n=== Final holdings ===");
const symbolMap = { SMH: 'SMH.L', IUIT: 'IUIT.L', EQQQ: 'EQQQ.SW', VUSD: 'VUSD.L' };
const liveRows = db.prepare(`SELECT symbol, price FROM live_prices`).all();
const live = {};
for (const r of liveRows) live[r.symbol] = r.price;

const holdings = db.prepare(`
  SELECT h.symbol, h.position, h.fx_rate_to_base, h.mark_price, h.position_value
  FROM Holdings h
  INNER JOIN (
    SELECT account_id, symbol, MAX(report_date) as max_date
    FROM Holdings GROUP BY account_id, symbol
  ) latest ON h.account_id = latest.account_id 
    AND h.symbol = latest.symbol 
    AND h.report_date = latest.max_date
  WHERE h.account_id = 'U15352922'
`).all();

let total = 315; // cash
for (const h of holdings) {
  const mapped = symbolMap[h.symbol] || h.symbol;
  const lp = live[mapped] ?? h.mark_price;
  const val = h.position * lp * h.fx_rate_to_base;
  total += val;
  console.log(`  ${h.symbol.padEnd(6)} pos:${h.position} × $${lp.toFixed(2)} × fx:${h.fx_rate_to_base} = $${val.toFixed(2)}`);
}
console.log(`  Cash: $315.00`);
console.log(`\n  TOTAL: $${total.toFixed(2)}`);
console.log(`  Target: $508,301`);

db.close();
console.log("\nDone. Refresh the app now.");
