/**
 * scripts/fix-schema.mjs
 * Adds missing columns and re-imports failed tables.
 * Usage: node scripts/fix-schema.mjs
 */
import postgres from 'postgres';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_AHXPU2gzcJb4@ep-wandering-tooth-baa4pykp.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const EXPORT_DIR = join(process.cwd(), 'scripts', 'export');
const sql = postgres(DATABASE_URL, { ssl: 'require', max: 5 });

// ── 1. Add missing columns ───────────────────────────────────────────────────
console.log('Adding missing columns…');

const alterStatements = [
  `ALTER TABLE "Trades" ADD COLUMN IF NOT EXISTS proceeds DOUBLE PRECISION DEFAULT 0`,
  `ALTER TABLE "Trades" ADD COLUMN IF NOT EXISTS buy_sell TEXT`,
  `ALTER TABLE "Trades" ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`,
  `ALTER TABLE "Trades" ADD COLUMN IF NOT EXISTS fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0`,
  `ALTER TABLE "ChangeInNAV" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
];

for (const stmt of alterStatements) {
  await sql.unsafe(stmt);
  console.log(' ✓', stmt.slice(0, 60));
}

// ── 2. Re-import failed tables ───────────────────────────────────────────────
const TEXT_PK_TABLES = new Set(['Accounts', 'live_prices', 'Settings']);

// Tables to re-import and whether to use ON CONFLICT DO NOTHING
const RETRY = [
  { name: 'Trades',      conflict: false },  // no unique constraint, just missing cols
  { name: 'Transfers',   conflict: true  },
  { name: 'Dividends',   conflict: true  },
  { name: 'Interest',    conflict: true  },
  { name: 'Fees',        conflict: true  },
  { name: 'Taxes',       conflict: true  },
  { name: 'ChangeInNAV', conflict: false },  // UNIQUE(account_id, from_date, to_date)
  { name: 'live_prices', conflict: true  },  // already has rows from run 1
];

console.log('\nRe-importing failed tables…\n');

for (const { name: tableName, conflict } of RETRY) {
  const filePath = join(EXPORT_DIR, `${tableName}.json`);
  if (!existsSync(filePath)) { console.log(`  ${tableName}: no file (skip)`); continue; }

  const rows = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!rows.length) { console.log(`  ${tableName}: 0 rows (skip)`); continue; }

  const isSerialTable = !TEXT_PK_TABLES.has(tableName);
  const BATCH = 200;
  let inserted = 0;

  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map(row => {
        const r = { ...row };
        if (isSerialTable) delete r.id;
        for (const k of Object.keys(r)) if (r[k] === undefined) r[k] = null;
        return r;
      });

      if (conflict) {
        // ON CONFLICT DO NOTHING — use unsafe with dynamic table name
        const cols = Object.keys(batch[0]);
        const colList = cols.map(c => `"${c}"`).join(', ');
        const placeholders = batch.map((_, bi) =>
          '(' + cols.map((_, ci) => `$${bi * cols.length + ci + 1}`).join(', ') + ')'
        ).join(', ');
        const values = batch.flatMap(r => cols.map(c => r[c]));
        const tbl = tableName === 'live_prices' ? 'live_prices' : `"${tableName}"`;
        await sql.unsafe(
          `INSERT INTO ${tbl} (${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
          values
        );
      } else {
        await sql`INSERT INTO ${sql(tableName)} ${sql(batch)}`;
      }

      inserted += batch.length;
      if (inserted % 50000 === 0) process.stdout.write(`    ${inserted}/${rows.length}...\r`);
    }

    if (isSerialTable && tableName !== 'live_prices') {
      await sql.unsafe(
        `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 1))`
      );
    }

    console.log(`  ${tableName}: ${inserted} rows ✓                    `);
  } catch (err) {
    console.error(`  ${tableName}: FAILED — ${err.message}`);
  }
}

await sql.end();
console.log('\nDone ✓');
