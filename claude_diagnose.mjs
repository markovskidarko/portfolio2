// Verify fx_rate_to_base and diagnose live NAV calculation
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db", { readOnly: true });

const latestDate = db.prepare(
  "SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'"
).get().d;

console.log(`=== Holdings fx_rate_to_base (${latestDate}) ===`);
const holdings = db.prepare(`
  SELECT symbol, position, mark_price, position_value, fx_rate_to_base, currency
  FROM Holdings WHERE account_id='U15352922' AND report_date=?
  ORDER BY position_value DESC
`).all(latestDate);

const symbolMap = { SMH: 'SMH.L', IUIT: 'IUIT.L', EQQQ: 'EQQQ.SW', VUSD: 'VUSD.L' };
const liveRows = db.prepare(`SELECT symbol, price FROM live_prices`).all();
const live = {};
for (const r of liveRows) live[r.symbol] = r.price;

let total = 0;
for (const h of holdings) {
  const yahoo = symbolMap[h.symbol] || h.symbol;
  const lp = live[yahoo] ?? h.mark_price;
  const appVal = h.position * lp * h.fx_rate_to_base;
  total += appVal;
  console.log(`  ${h.symbol.padEnd(6)} qty:${h.position} mark:${h.mark_price} fx:${h.fx_rate_to_base} live(${yahoo}):${lp} => $${appVal.toFixed(2)}`);
}
const cash = db.prepare(`SELECT amount FROM Cash WHERE account_id='U15352922' ORDER BY report_date DESC LIMIT 1`).get().amount;
console.log(`  Cash: $${cash}`);
console.log(`  TOTAL: $${(total + cash).toFixed(2)}`);
console.log(`  App shows: $582,714`);
console.log(`  Target:    $508,301`);

db.close();
