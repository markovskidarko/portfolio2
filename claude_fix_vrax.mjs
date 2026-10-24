// Fix VRAX price in Holdings for U15405459
// Current: $120.79 (wrong) → Correct: $2.54
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

// Check before
const before = db.prepare(`
  SELECT symbol, position, mark_price, position_value, cost_basis_money, fx_rate_to_base, report_date, account_id
  FROM Holdings WHERE symbol='VRAX'
  ORDER BY report_date DESC
`).all();
console.log("=== BEFORE ===");
for (const h of before) console.log(h);

// Also check live_prices
const lp = db.prepare(`SELECT * FROM live_prices WHERE symbol='VRAX'`).get();
console.log("\n=== live_prices VRAX ===");
console.log(lp);

// Fix: update mark_price and position_value in Holdings
// 223 shares × $2.54 = $566.42
const correctPrice = 2.54;
const qty = 223;
const newValue = qty * correctPrice;

const updateHolding = db.prepare(`
  UPDATE Holdings
  SET mark_price = ?,
      position_value = ?,
      fifo_pnl_unrealized = ? - cost_basis_money
  WHERE symbol = 'VRAX'
`);
const r1 = updateHolding.run(correctPrice, newValue, newValue);
console.log(`\nUpdated ${r1.changes} Holdings row(s)`);

// Fix live_prices too
const updateLive = db.prepare(`
  UPDATE live_prices SET price = ?, previous_close = ? WHERE symbol = 'VRAX'
`);
const r2 = updateLive.run(correctPrice, correctPrice);
console.log(`Updated ${r2.changes} live_prices row(s)`);

// Verify
const after = db.prepare(`
  SELECT symbol, position, mark_price, position_value, cost_basis_money, fifo_pnl_unrealized
  FROM Holdings WHERE symbol='VRAX'
`).all();
console.log("\n=== AFTER ===");
for (const h of after) console.log(h);
console.log(`\nVRAX: 223 × $${correctPrice} = $${newValue.toFixed(2)}`);

db.close();
console.log("\nDone. Refresh the app.");
