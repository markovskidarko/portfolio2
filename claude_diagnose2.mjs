// Deep diagnose - replicate exactly what calculateAccountLiveNAV does
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./data/portfolio.db", { readOnly: true });

// Replicate holdingQueries.getLatestByAccount
const holdings = db.prepare(`
  SELECT h.symbol, h.position, h.fx_rate_to_base, h.mark_price, h.position_value
  FROM Holdings h
  INNER JOIN (
    SELECT account_id, symbol, MAX(report_date) as max_date
    FROM Holdings
    GROUP BY account_id, symbol
  ) latest ON h.account_id = latest.account_id 
    AND h.symbol = latest.symbol 
    AND h.report_date = latest.max_date
  WHERE h.account_id = 'U15352922'
`).all();

console.log("=== Raw holdings from getLatestByAccount ===");
for (const h of holdings) {
  console.log(`  ${h.symbol.padEnd(8)} pos:${h.position} fx:${h.fx_rate_to_base} mark:${h.mark_price} pos_val:${h.position_value}`);
}

// Replicate normalizeSymbol
function normalizeSymbol(symbol) {
  if (!symbol) return '';
  const n = symbol.toUpperCase().trim();
  if (n === 'EQQU') return 'EQQQ';
  if (n === 'SMH' || n === 'SMH.L') return 'SMH.L';
  return n;
}

// Replicate mapSymbolForYahoo
const symbolMap = { SMH: 'SMH.L', EQQQ: 'EQQQ.SW', EQQU: 'EQQQ.SW', IUIT: 'IUIT.L', VUSD: 'VUSD.L' };
function mapSymbolForYahoo(symbol) {
  return symbolMap[symbol.toUpperCase()] || symbol;
}

// Deduplicate as the app does
console.log("\n=== After deduplication (normalizeSymbol) ===");
const dedup = new Map();
for (const h of holdings) {
  const normalized = normalizeSymbol(h.symbol);
  if (!dedup.has(normalized) || Math.abs(h.position) > Math.abs(dedup.get(normalized).position)) {
    dedup.set(normalized, h);
  }
}
for (const [norm, h] of dedup.entries()) {
  console.log(`  norm:${norm.padEnd(8)} orig:${h.symbol.padEnd(8)} pos:${h.position} fx:${h.fx_rate_to_base}`);
}

// Get live prices
const liveRows = db.prepare(`SELECT symbol, price FROM live_prices`).all();
const live = {};
for (const r of liveRows) live[r.symbol] = r.price;

// Calculate as app does
console.log("\n=== Live NAV calculation (replicating app) ===");
const cashRec = db.prepare(`SELECT amount, fx_rate_to_base FROM Cash WHERE account_id='U15352922' ORDER BY report_date DESC LIMIT 1`).get();
let total = cashRec.amount * (cashRec.fx_rate_to_base || 1);
console.log(`  Cash: $${total.toFixed(2)}`);

for (const [norm, h] of dedup.entries()) {
  if (h.symbol === 'CASH') { total += h.position_value; continue; }
  const mappedSymbol = mapSymbolForYahoo(h.symbol);
  const livePrice = live[mappedSymbol];
  let posVal;
  if (livePrice !== undefined) {
    posVal = h.position * livePrice * h.fx_rate_to_base;
    console.log(`  ${h.symbol.padEnd(6)} → ${mappedSymbol.padEnd(8)} pos:${h.position} × live:${livePrice} × fx:${h.fx_rate_to_base} = $${posVal.toFixed(2)}`);
  } else {
    posVal = h.position_value;
    console.log(`  ${h.symbol.padEnd(6)} → ${mappedSymbol.padEnd(8)} NO LIVE PRICE → using pos_value: $${posVal.toFixed(2)}`);
  }
  total += posVal;
}
console.log(`\n  TOTAL: $${total.toFixed(2)}`);
console.log(`  App shows: $582,723`);
console.log(`  DB calc:   $508,493`);
console.log(`  Difference: $${(total - 508493).toFixed(2)}`);

// Check all Holdings rows for U15352922 across ALL dates to see if there's a stale row
console.log("\n=== ALL Holdings rows for U15352922 (all dates) ===");
const all = db.prepare(`
  SELECT symbol, position, mark_price, position_value, fx_rate_to_base, report_date
  FROM Holdings WHERE account_id='U15352922'
  ORDER BY symbol, report_date DESC
`).all();
for (const h of all) {
  console.log(`  ${h.symbol.padEnd(8)} date:${h.report_date} pos:${h.position} mark:${h.mark_price} val:${h.position_value} fx:${h.fx_rate_to_base}`);
}

db.close();
