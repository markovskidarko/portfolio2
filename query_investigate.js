const Database = require("better-sqlite3");
const db = new Database("./data/portfolio.db", { readonly: true });

const tables = ["Accounts", "DailyNAV", "Trades", "Transactions", "Transfers", "Deposits", "Withdrawals", "Dividends", "Interest", "Fees", "Taxes", "ChangeInNAV", "Cash", "Holdings"];

for (const table of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    const count = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get().n;
    const hasDate = cols.find(c => c.includes("date") || c.includes("Date"));
    let latest = null;
    if (hasDate) {
      const r = db.prepare(`SELECT MAX(${hasDate}) as d FROM ${table}`).get();
      latest = r && r.d;
    }
    // P2 count
    const hasAccount = cols.includes("account_id");
    let p2count = null;
    if (hasAccount) {
      p2count = db.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE account_id='U15352922'`).get().n;
    }
    console.log(`${table}: total=${count}, latest_${hasDate}=${latest}, p2_rows=${p2count}, cols=[${cols.join(", ")}]`);
  } catch(e) {
    console.log(`${table}: ERROR - ${e.message}`);
  }
}

db.close();
