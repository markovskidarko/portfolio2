import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/portfolio.db");
db.prepare("UPDATE Cash SET amount=47.33 WHERE id=12").run();
const after = db.prepare("SELECT * FROM Cash WHERE id=12").get();
console.log("Updated:", JSON.stringify(after));
db.close();
