import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/portfolio.db");
const rows = db.prepare("SELECT * FROM Cash WHERE account_id='U22758796' ORDER BY report_date DESC").all();
console.log(JSON.stringify(rows, null, 2));
db.close();
