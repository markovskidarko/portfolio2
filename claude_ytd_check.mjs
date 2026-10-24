// Investigate YTD% calculation for U15352922
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db", { readOnly: true });

// Last NAV of 2025 (YTD start baseline)
console.log("=== Last NAV of 2025 (YTD baseline) ===");
const baseline = db.prepare(`
  SELECT date, nav_value FROM DailyNAV
  WHERE account_id='U15352922' AND date <= '2025-12-31'
  ORDER BY date DESC LIMIT 3
`).all();
for (const n of baseline) console.log(`  ${n.date}  $${n.nav_value.toFixed(2)}`);

// All DailyNAV for 2026
console.log("\n=== DailyNAV 2026 (all) ===");
const nav = db.prepare(`
  SELECT date, nav_value FROM DailyNAV
  WHERE account_id='U15352922' AND date >= '2026-01-01'
  ORDER BY date ASC
`).all();
for (const n of nav) console.log(`  ${n.date}  $${n.nav_value.toFixed(2)}`);

const first2026 = nav[0];
const last2026 = nav[nav.length - 1];

// Deposits/Transfers in 2026
console.log("\n=== Deposits 2026 ===");
try {
  const deps = db.prepare(`SELECT * FROM Deposits WHERE account_id='U15352922' AND date >= '2026-01-01' ORDER BY date`).all();
  for (const d of deps) console.log(d);
} catch(e) { console.log("Error:", e.message); }

console.log("\n=== Transfers 2026 ===");
try {
  const trans = db.prepare(`SELECT * FROM Transfers WHERE account_id='U15352922' AND date >= '2026-01-01' ORDER BY date`).all();
  for (const t of trans) console.log(t);
} catch(e) { console.log("Error:", e.message); }

console.log("\n=== ChangeInNAV 2026 ===");
try {
  const changes = db.prepare(`SELECT * FROM ChangeInNAV WHERE account_id='U15352922' AND report_date >= '2026-01-01' ORDER BY report_date`).all();
  for (const c of changes) console.log(c);
} catch(e) { console.log("Error:", e.message); }

// NAV around June 4 deposit
console.log("\n=== NAV around June 4 deposit ===");
const jun4 = db.prepare(`
  SELECT date, nav_value FROM DailyNAV
  WHERE account_id='U15352922' AND date BETWEEN '2026-05-25' AND '2026-06-10'
  ORDER BY date ASC
`).all();
for (const n of jun4) console.log(`  ${n.date}  $${n.nav_value.toFixed(2)}`);

// Manual TWR calculation
console.log("\n=== Manual TWR vs Simple Return ===");
const startNAV = baseline[0]?.nav_value;
const endNAV = last2026?.nav_value;
const simpleReturn = ((endNAV - startNAV) / startNAV) * 100;
console.log(`Start NAV (end of 2025): $${startNAV?.toFixed(2)}`);
console.log(`End NAV (latest):        $${endNAV?.toFixed(2)}`);
console.log(`Simple return:           ${simpleReturn?.toFixed(2)}%`);
console.log(`App shows YTD:           +35.54%`);
console.log(`\nIf $50k deposited Jun 4, TWR removes that cash flow effect.`);

// Find NAV just before and just after the deposit
if (jun4.length >= 2) {
  const beforeDep = jun4[0];
  // NAV after deposit = previous NAV + 50000 deposit + market move
  // TWR sub-period 1: Jan 1 to just before deposit
  // TWR sub-period 2: just after deposit to today
  const deposit = 50000;
  console.log(`\nNAV before deposit period: ${beforeDep.date} = $${beforeDep.nav_value.toFixed(2)}`);
  // NAV just after deposit (first day after = pre-deposit NAV + 50k)
  const navAfterDeposit = beforeDep.nav_value + deposit;
  console.log(`NAV just after $50k deposit (estimated): $${navAfterDeposit.toFixed(2)}`);
  const twr1 = (beforeDep.nav_value - startNAV) / startNAV;
  const twr2 = (endNAV - navAfterDeposit) / navAfterDeposit;
  const twr = ((1 + twr1) * (1 + twr2) - 1) * 100;
  console.log(`\nTWR Sub-period 1 (Jan1→Jun3): ${(twr1*100).toFixed(2)}%`);
  console.log(`TWR Sub-period 2 (Jun4→now):  ${(twr2*100).toFixed(2)}%`);
  console.log(`TWR Combined:                  ${twr.toFixed(2)}%`);
}

db.close();
