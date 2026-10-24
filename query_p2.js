const Database = require("better-sqlite3");
const db = new Database("./data/portfolio.db", { readonly: true });

const rows = db.prepare(`
  SELECT symbol, description, position, mark_price, position_value, cost_basis_money, fifo_pnl_unrealized, percent_of_nav, currency
  FROM Holdings
  WHERE account_id = 'U15352922'
  AND report_date = '2026-06-04'
  ORDER BY position_value DESC
`).all();

console.log("P2 Holdings as of 2026-06-04:");
console.log(JSON.stringify(rows, null, 2));
db.close();
