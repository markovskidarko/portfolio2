// Update cash for U15352922 to 66.14
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db");

const before = db.prepare(`SELECT * FROM Cash WHERE account_id='U15352922' ORDER BY report_date DESC LIMIT 1`).get();
console.log(`Before: $${before.amount} (${before.report_date})`);

db.prepare(`
  UPDATE Cash SET amount = 66.14
  WHERE account_id = 'U15352922' AND id = ?
`).run(before.id);

const after = db.prepare(`SELECT * FROM Cash WHERE account_id='U15352922' ORDER BY report_date DESC LIMIT 1`).get();
console.log(`After:  $${after.amount} (${after.report_date})`);

db.close();
console.log("Done. Refresh the app.");
