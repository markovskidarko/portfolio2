import { getDatabase } from '../lib/database';

const sql = getDatabase();

console.log('='.repeat(80));
console.log('POSTGRES DATABASE TABLES');
console.log('='.repeat(80));

async function main() {
  // Get all table names from information_schema
  const tables = await sql`
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  ` as unknown as Array<{ name: string }>;

  console.log(`\nTotal Tables: ${tables.length}\n`);

  for (const table of tables) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Table: ${table.name}`);
    console.log(`${'─'.repeat(80)}`);

    // Get column info from information_schema
    const schema = await sql`
      SELECT
        column_name AS name,
        data_type AS type,
        is_nullable,
        column_default AS dflt_value
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table.name}
      ORDER BY ordinal_position
    ` as unknown as Array<{
      name: string;
      type: string;
      is_nullable: string;
      dflt_value: string | null;
    }>;

    console.log('Columns:');
    for (const col of schema) {
      const notnull = col.is_nullable === 'NO' ? ' NOT NULL' : '';
      const defaultVal = col.dflt_value ? ` DEFAULT ${col.dflt_value}` : '';
      console.log(`  - ${col.name} (${col.type})${notnull}${defaultVal}`);
    }

    // Get row count
    try {
      const countResult = await sql`
        SELECT COUNT(*) AS count FROM ${sql(table.name)}
      ` as unknown as Array<{ count: string }>;
      const count = parseInt(countResult[0]?.count || '0', 10);
      console.log(`\nRow Count: ${count.toLocaleString()}`);
    } catch (error) {
      console.log(`\nRow Count: Unable to query`);
    }
  }
}

main().catch(console.error);
