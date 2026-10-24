// Check live prices and latest NAV
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const db = new DatabaseSync("./data/portfolio.db", { readOnly: true });
const result = {};

// live_prices table (lowercase)
try {
  result.live_prices = db.prepare(`SELECT * FROM live_prices ORDER BY updated_at DESC`).all();
} catch(e) { result.live_prices_err = e.message; }

// Latest NAV for U15352922
result.nav_latest = db.prepare(`
  SELECT * FROM DailyNAV WHERE account_id='U15352922'
  ORDER BY date DESC LIMIT 1
`).all();

// Holdings with latest report_date
const latest = db.prepare(`SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'`).get();
result.holdings_latest_date = latest?.d;

// Get all holdings on latest date with live price overlay attempt
result.holdings = db.prepare(`
  SELECT h.symbol, h.description, h.position, h.mark_price, h.position_value,
         h.cost_basis_money, h.fifo_pnl_unrealized, h.percent_of_nav, h.currency,
         lp.price as live_price, lp.updated_at as price_updated
  FROM Holdings h
  LEFT JOIN live_prices lp ON lp.symbol = h.symbol
  WHERE h.account_id='U15352922' AND h.report_date=?
  ORDER BY h.position_value DESC
`).all(latest?.d);

// Cash latest
result.cash_latest = db.prepare(`
  SELECT * FROM Cash WHERE account_id='U15352922' ORDER BY report_date DESC LIMIT 1
`).all();

// Today's NAV
const today = new Date().toISOString().split('T')[0];
result.today = today;
result.nav_today = db.prepare(`
  SELECT * FROM DailyNAV WHERE account_id='U15352922' AND date=?
`).all(today);

db.close();

const output = JSON.stringify(result, null, 2);
writeFileSync("./claude_result2.json", output);
console.log(output);
