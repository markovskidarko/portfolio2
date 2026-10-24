// Claude diagnostic script for U15352922
// Run: node claude_check.mjs
import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';

const db = new Database('./data/portfolio.db', { readonly: true });
const result = {};

// Tables
result.tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);

// Holdings - latest date
const latestDate = db.prepare("SELECT MAX(report_date) as d FROM Holdings WHERE account_id='U15352922'").get();
result.latestHoldingsDate = latestDate?.d;

result.holdings = db.prepare(`
  SELECT symbol, description, position, mark_price, position_value,
         cost_basis_money, fifo_pnl_unrealized, percent_of_nav, currency, report_date
  FROM Holdings
  WHERE account_id='U15352922' AND report_date=?
  ORDER BY position_value DESC
`).all(latestDate?.d);

// Cash - latest
result.cash = db.prepare(`
  SELECT * FROM Cash WHERE account_id='U15352922'
  ORDER BY report_date DESC LIMIT 5
`).all();

// DailyNAV - latest 5
result.nav = db.prepare(`
  SELECT * FROM DailyNAV WHERE account_id='U15352922'
  ORDER BY date DESC LIMIT 5
`).all();

// Live prices for all symbols
result.livePrices = db.prepare(`
  SELECT * FROM LivePrices ORDER BY updated_at DESC
`).all();

// All unique symbols ever in U15352922
result.allSymbols = db.prepare(`
  SELECT DISTINCT symbol, description FROM Holdings
  WHERE account_id='U15352922'
  ORDER BY symbol
`).all();

db.close();

const output = JSON.stringify(result, null, 2);
writeFileSync('./claude_result.json', output);
console.log(output);
