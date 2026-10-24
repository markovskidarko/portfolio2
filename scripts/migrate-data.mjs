/**
 * migrate-data.mjs
 *
 * Exports all data from the local SQLite database and imports it into Neon Postgres.
 *
 * Usage (run from C:\Users\marko\Portfolio2):
 *   node scripts/migrate-data.mjs
 *
 * Prerequisites:
 *   npm install postgres
 *   (better-sqlite3 is already in package.json)
 */

import Database from 'better-sqlite3';
import postgres from 'postgres';
import { join } from 'path';
import { existsSync } from 'fs';

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const SQLITE_PATH = join(process.cwd(), 'data', 'portfolio.db');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_AHXPU2gzcJb4@ep-wandering-tooth-baa4pykp.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require';
// ─────────────────────────────────────────────────────────────────────────────

if (!existsSync(SQLITE_PATH)) {
  console.error(`SQLite file not found at: ${SQLITE_PATH}`);
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const sql = postgres(DATABASE_URL, { ssl: 'require' });

// Tables in dependency order (Accounts must come first)
const TABLES = [
  'Accounts',
  'DailyNAV',
  'Trades',
  'Transactions',
  'Cash',
  'Holdings',
  'Transfers',
  'Deposits',
  'Withdrawals',
  'Dividends',
  'Interest',
  'Fees',
  'Taxes',
  'ChangeInNAV',
  'KBFundPrices',
  'live_prices',
  'Settings',
];

async function migrateTable(tableName) {
  const quoted = tableName === 'live_prices' ? 'live_prices' : `"${tableName}"`;
  let rows;
  try {
    rows = sqlite.prepare(`SELECT * FROM ${quoted}`).all();
  } catch (err) {
    console.log(`  ${tableName}: table not found in SQLite (skipping) — ${err.message}`);
    return;
  }

  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows (skipping)`);
    return;
  }

  // Tables with TEXT primary key (no SERIAL) — keep id as-is
  const textPkTables = new Set(['Accounts', 'live_prices', 'Settings']);
  const isSerialTable = !textPkTables.has(tableName);

  // Insert in batches of 500
  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const cleaned = batch.map(row => {
      const r = { ...row };
      if (isSerialTable) delete r.id;
      return r;
    });

    await sql`INSERT INTO ${sql(quoted)} ${sql(cleaned)}`;
    inserted += batch.length;
  }

  // For SERIAL tables, reset the sequence so future inserts don't collide with migrated ids
  // (We deleted `id` above so Postgres assigned new ones — reset to max to be safe)
  if (isSerialTable) {
    await sql.unsafe(`SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 1))`);
  }

  console.log(`  ${tableName}: ${inserted} rows ✓`);
}

async function run() {
  console.log('Starting SQLite → Postgres migration…\n');

  for (const table of TABLES) {
    try {
      await migrateTable(table);
    } catch (err) {
      console.error(`  ${table}: FAILED — ${err.message}`);
    }
  }

  console.log('\nMigration complete.');
  sqlite.close();
  await sql.end();
  console.log('Done.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
