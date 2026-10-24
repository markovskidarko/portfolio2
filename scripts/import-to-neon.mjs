/**
 * scripts/import-to-neon.mjs
 *
 * Reads scripts/export/<Table>.json files and imports into Neon Postgres.
 * Usage: node scripts/import-to-neon.mjs
 */
import postgres from 'postgres';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_AHXPU2gzcJb4@ep-wandering-tooth-baa4pykp.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const EXPORT_DIR = join(process.cwd(), 'scripts', 'export');
const sql = postgres(DATABASE_URL, { ssl: 'require', max: 5 });

const TEXT_PK_TABLES = new Set(['Accounts', 'live_prices', 'Settings']);

const TABLES = [
  'Accounts', 'DailyNAV', 'Trades', 'Transactions', 'Cash', 'Holdings',
  'Transfers', 'Deposits', 'Withdrawals', 'Dividends', 'Interest',
  'Fees', 'Taxes', 'ChangeInNAV', 'KBFundPrices', 'live_prices', 'Settings',
];

async function importTable(tableName) {
  const filePath = join(EXPORT_DIR, `${tableName}.json`);
  if (!existsSync(filePath)) {
    console.log(`  ${tableName}: no export file (skipping)`);
    return;
  }

  const rows = JSON.parse(readFileSync(filePath, 'utf8'));
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows (skipping)`);
    return;
  }

  const isSerialTable = !TEXT_PK_TABLES.has(tableName);
  const BATCH = 200;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(row => {
      const r = { ...row };
      if (isSerialTable) delete r.id;
      for (const key of Object.keys(r)) {
        if (r[key] === undefined) r[key] = null;
      }
      return r;
    });

    // sql(tableName) quotes identifiers correctly — don't pre-wrap in quotes
    await sql`INSERT INTO ${sql(tableName)} ${sql(batch)}`;
    inserted += batch.length;
    if (inserted % 10000 === 0) process.stdout.write(`    ${inserted}/${rows.length}...\r`);
  }

  // Reset SERIAL sequence
  if (isSerialTable) {
    await sql.unsafe(
      `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 1))`
    );
  }

  console.log(`  ${tableName}: ${inserted} rows ✓                    `);
}

console.log('Importing data into Neon…\n');

for (const table of TABLES) {
  try {
    await importTable(table);
  } catch (err) {
    console.error(`  ${table}: FAILED — ${err.message}`);
  }
}

await sql.end();
console.log('\nAll done! ✓');
