// Fix VRAX properly - only update the manual entry (9999-12-31), restore historical rows
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

// Restore historical IBKR rows to their correct original values
db.prepare(`
  UPDATE Holdings SET mark_price=0.384, position_value=2140.8, fifo_pnl_unrealized=2140.8-26935.155
  WHERE symbol='VRAX' AND account_id='U15405459' AND report_date='2026-01-02'
`).run();

db.prepare(`
  UPDATE Holdings SET mark_price=0.765, position_value=4264.875, fifo_pnl_unrealized=4264.875-26935.155
  WHERE symbol='VRAX' AND account_id='U15405459' AND report_date='2025-08-22'
`).run();

// Manual entry: 223 shares (post reverse-split) @ $2.54 = $566.42
db.prepare(`
  UPDATE Holdings SET mark_price=2.54, position_value=566.42, fifo_pnl_unrealized=566.42-26936.17,
  cost_basis_money=26936.17
  WHERE symbol='VRAX' AND account_id='U15405459' AND report_date='9999-12-31'
`).run();

// Also insert into live_prices so the app uses $2.54 going forward
const existing = db.prepare(`SELECT * FROM live_prices WHERE symbol='VRAX'`).get();
if (!existing) {
  db.prepare(`
    INSERT INTO live_prices (symbol, price, updated_at, source, previous_close, previous_close_date)
    VALUES ('VRAX', 2.54, datetime('now'), 'manual', 2.54, date('now'))
  `).run();
  console.log("Inserted VRAX into live_prices at $2.54");
} else {
  db.prepare(`UPDATE live_prices SET price=2.54, previous_close=2.54 WHERE symbol='VRAX'`).run();
  console.log("Updated VRAX live_prices to $2.54");
}

// Verify all rows
console.log("\n=== VRAX Holdings (all rows) ===");
const all = db.prepare(`
  SELECT report_date, position, mark_price, position_value, cost_basis_money, fifo_pnl_unrealized
  FROM Holdings WHERE symbol='VRAX' ORDER BY report_date DESC
`).all();
for (const h of all) console.log(h);

console.log("\n=== VRAX live_prices ===");
console.log(db.prepare(`SELECT * FROM live_prices WHERE symbol='VRAX'`).get());

db.close();
console.log("\nDone. Refresh the app.");
