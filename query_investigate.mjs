import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

// P2 Cash
console.log("=== P2 CASH ===");
const cash = db.prepare("SELECT * FROM Cash WHERE account_id='U15352922' ORDER BY report_date DESC").all();
console.log(JSON.stringify(cash, null, 2));

// P2 Holdings (all, including manual)
console.log("\n=== P2 HOLDINGS ===");
const holdings = db.prepare("SELECT * FROM Holdings WHERE account_id='U15352922' ORDER BY report_date DESC, position_value DESC").all();
console.log(JSON.stringify(holdings, null, 2));

// P2 DailyNAV latest 5
console.log("\n=== P2 DailyNAV (latest 5) ===");
const nav = db.prepare("SELECT * FROM DailyNAV WHERE account_id='U15352922' ORDER BY date DESC LIMIT 5").all();
console.log(JSON.stringify(nav, null, 2));

// Accounts
console.log("\n=== ACCOUNTS ===");
const accounts = db.prepare("SELECT * FROM Accounts").all();
console.log(JSON.stringify(accounts, null, 2));

db.close();
