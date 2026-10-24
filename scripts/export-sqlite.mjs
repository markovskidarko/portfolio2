/**
 * scripts/export-sqlite.mjs
 *
 * Exports all SQLite tables to scripts/export/ as separate JSON files.
 * Usage: "C:\Users\marko\AppData\Local\Programs\cursor\resources\app\resources\helpers\node.exe" scripts/export-sqlite.mjs
 */
import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SQLITE_PATH = join(process.cwd(), 'data', 'portfolio.db');
const OUTPUT_DIR = join(process.cwd(), 'scripts', 'export');

mkdirSync(OUTPUT_DIR, { recursive: true });

const sqlite = new Database(SQLITE_PATH, { readonly: true });

const TABLES = [
  'Accounts', 'DailyNAV', 'Trades', 'Transactions', 'Cash', 'Holdings',
  'Transfers', 'Deposits', 'Withdrawals', 'Dividends', 'Interest',
  'Fees', 'Taxes', 'ChangeInNAV', 'KBFundPrices', 'live_prices', 'Settings',
];

for (const table of TABLES) {
  const quoted = table === 'live_prices' ? 'live_prices' : `"${table}"`;
  try {
    const rows = sqlite.prepare(`SELECT * FROM ${quoted}`).all();
    const outPath = join(OUTPUT_DIR, `${table}.json`);

    // Write in chunks to avoid string length limit
    const ws = await import('fs').then(m => m.createWriteStream(outPath));
    ws.write('[\n');
    for (let i = 0; i < rows.length; i++) {
      ws.write(JSON.stringify(rows[i]));
      if (i < rows.length - 1) ws.write(',\n');
    }
    ws.write('\n]\n');
    await new Promise((resolve, reject) => { ws.end(resolve); ws.on('error', reject); });

    console.log(`  ${table}: ${rows.length} rows → export/${table}.json`);
  } catch (e) {
    console.log(`  ${table}: skipped (${e.message})`);
  }
}

sqlite.close();
console.log('\nExport complete ✓');
