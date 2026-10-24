/**
 * scripts/activate-postgres.mjs
 *
 * Renames database files to activate the Postgres version.
 * Run ONCE from C:\Users\marko\Portfolio2:
 *   node scripts/activate-postgres.mjs
 */
import { renameSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';

const LIB = join(process.cwd(), 'lib');

const sqlite   = join(LIB, 'database.ts');
const backup   = join(LIB, 'database.sqlite.ts.bak');
const postgres = join(LIB, 'database.postgres.ts');

if (!existsSync(postgres)) {
  console.error('ERROR: lib/database.postgres.ts not found');
  process.exit(1);
}

if (existsSync(sqlite)) {
  renameSync(sqlite, backup);
  console.log('✓ Renamed database.ts → database.sqlite.ts.bak');
} else {
  console.log('  database.ts not found (already moved?)');
}

renameSync(postgres, sqlite);
console.log('✓ Renamed database.postgres.ts → database.ts');
console.log('\nPostgres database layer is now active.');
console.log('Remember to add DATABASE_URL to your .env file:');
console.log('  DATABASE_URL=postgresql://neondb_owner:npg_AHXPU2gzcJb4@ep-wandering-tooth-baa4pykp.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require');
