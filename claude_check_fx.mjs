// Check fx_rate_to_base and symbol mapping for U15352922
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db", { readOnly: true });

const latestDate = db.prepare(
  "SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'"
).get().d;

console.log("=== Holdings with fx_rate_to_base ===");
const holdings = db.prepare(`
  SELECT symbol, description, position, mark_price, position_value, 
         fx_rate_to_base, currency, report_date
  FROM Holdings WHERE account_id='U15352922' AND report_date=?
  ORDER BY position_value DESC
`).all(latestDate);

for (const h of holdings) {
  const liveCalc = h.position * h.mark_price * h.fx_rate_to_base;
  console.log(`${h.symbol.padEnd(6)} | currency: ${h.currency} | fx_rate_to_base: ${h.fx_rate_to_base} | position: ${h.position} | mark_price: ${h.mark_price} | pos_value: ${h.position_value.toFixed(2)} | live_calc: ${liveCalc.toFixed(2)}`);
}

// Also check symbol mapper - what does SMH map to?
console.log("\n=== live_prices table ===");
const prices = db.prepare(`SELECT * FROM live_prices WHERE symbol IN ('SMH','SMH.L','IUIT','IUIT.L','EQQQ','EQQQ.SW','VUSD','VUSD.L','DRAM')`).all();
for (const p of prices) {
  console.log(`${p.symbol.padEnd(10)} | price: ${p.price} | source: ${p.source}`);
}

db.close();
