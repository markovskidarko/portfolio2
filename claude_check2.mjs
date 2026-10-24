// Claude diagnostic script for U15352922 - uses built-in Node sqlite (no dependencies)
// Run: node claude_check2.mjs
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const db = new DatabaseSync("./data/portfolio.db", { readOnly: true });
const result = {};

// Tables
result.tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);

// All unique symbols ever in U15352922
result.allSymbols = db.prepare(`
  SELECT DISTINCT symbol, description FROM Holdings
  WHERE account_id='U15352922'
  ORDER BY symbol
`).all();

// Latest holdings date
const latestDate = db.prepare("SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'").get();
result.latestHoldingsDate = latestDate?.d;

// Holdings on latest date
result.holdings = db.prepare(`
  SELECT symbol, description, position, mark_price, position_value,
         cost_basis_money, fifo_pnl_unrealized, percent_of_nav, currency, report_date
  FROM Holdings
  WHERE account_id='U15352922' AND report_date=?
  ORDER BY position_value DESC
`).all(latestDate?.d);

// Cash latest 5
try {
  result.cash = db.prepare(`
    SELECT * FROM Cash WHERE account_id='U15352922'
    ORDER BY report_date DESC LIMIT 5
  `).all();
} catch(e) { result.cash_err = e.message; }

// DailyNAV latest 5
try {
  result.nav = db.prepare(`
    SELECT * FROM DailyNAV WHERE account_id='U15352922'
    ORDER BY date DESC LIMIT 5
  `).all();
} catch(e) { result.nav_err = e.message; }

// Live prices
try {
  result.livePrices = db.prepare(`SELECT * FROM LivePrices ORDER BY updated_at DESC`).all();
} catch(e) { result.livePrices_err = e.message; }

db.close();

const output = JSON.stringify(result, null, 2);
writeFileSync("./claude_result.json", output);
console.log(output);
