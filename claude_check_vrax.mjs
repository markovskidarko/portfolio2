import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db", { readOnly: true });

console.log("=== VRAX in live_prices ===");
const lp = db.prepare(`SELECT * FROM live_prices WHERE symbol='VRAX'`).get();
console.log(lp);

console.log("\n=== VRAX in Holdings (all dates) ===");
const holdings = db.prepare(`
  SELECT symbol, position, mark_price, position_value, fx_rate_to_base, currency, report_date, account_id
  FROM Holdings WHERE symbol='VRAX'
  ORDER BY report_date DESC
`).all();
for (const h of holdings) console.log(h);

console.log("\n=== VRAX in Trades ===");
const trades = db.prepare(`
  SELECT * FROM Trades WHERE symbol='VRAX' ORDER BY trade_date DESC LIMIT 10
`).all();
for (const t of trades) console.log(t);

db.close();
