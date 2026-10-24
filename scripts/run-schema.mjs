/**
 * scripts/run-schema.mjs
 * Runs schema-postgres.sql against Neon as one atomic block.
 * Usage: node scripts/run-schema.mjs
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_AHXPU2gzcJb4@ep-wandering-tooth-baa4pykp.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const sql = postgres(DATABASE_URL, { ssl: 'require' });

const schemaSQL = readFileSync(join(__dirname, 'schema-postgres.sql'), 'utf8');

console.log('Running schema against Neon…\n');

try {
  await sql.unsafe(schemaSQL);
  console.log('Schema created successfully! ✓');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  await sql.end();
}
