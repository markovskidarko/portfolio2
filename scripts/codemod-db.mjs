/**
 * scripts/codemod-db.mjs
 *
 * Automated codemod: transforms old SQLite-style database calls to new async Postgres calls.
 *
 * OLD pattern:
 *   const db = getDatabase();
 *   const fn = queryObj.method(db);
 *   fn.run(a, b, c);
 *   const result = fn.get(a);
 *   const rows = fn.all(a);
 *
 * NEW pattern:
 *   await queryObj.method(a, b, c);
 *   const result = await queryObj.method(a);
 *   const rows = await queryObj.method(a);
 *
 * Usage: node scripts/codemod-db.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = process.cwd();

const DB_QUERY_OBJECTS = [
  'accountQueries', 'navQueries', 'kbFundPriceQueries', 'tradeQueries',
  'transactionQueries', 'cashQueries', 'holdingQueries', 'transferQueries',
  'depositQueries', 'withdrawalQueries', 'dividendQueries', 'interestQueries',
  'feeQueries', 'taxQueries', 'changeInNAVQueries', 'livePriceQueries',
  'settingsQueries',
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'scripts', '.git'].includes(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if ((full.endsWith('.ts') || full.endsWith('.tsx')) && !full.endsWith('.bak')) {
      files.push(full);
    }
  }
  return files;
}

function transformFile(filePath) {
  const original = readFileSync(filePath, 'utf8');
  let src = original;

  // Skip files that don't use the database
  const usesDB = DB_QUERY_OBJECTS.some(q => src.includes(q)) ||
    src.includes('sumContributionsUSD') || src.includes('sumTodayContributionsUSD') ||
    src.includes('initializeDatabase') || src.includes('getDatabase');
  if (!usesDB) return false;

  // ── Step 1: Remove `const db = getDatabase();` lines ──────────────────────
  // But only if db is only used for query helpers (not raw db.prepare calls)
  // We'll handle raw db.prepare separately
  src = src.replace(/^[ \t]*const db = getDatabase\(\);[ \t]*\n/gm, '');

  // ── Step 2: Remove standalone helper variable declarations ────────────────
  // Pattern: const upsertAccount = accountQueries.upsert(db);
  // We collect the mapping: varName -> queryObj.method
  const helperMap = new Map(); // varName -> {obj, method}

  const helperDeclRe = /const (\w+)\s*=\s*([\w]+)\.([\w]+)\(\s*(?:db\s*)?\)\s*;/g;
  let match;
  const toRemove = [];

  while ((match = helperDeclRe.exec(src)) !== null) {
    const [fullMatch, varName, obj, method] = match;
    if (DB_QUERY_OBJECTS.includes(obj)) {
      helperMap.set(varName, { obj, method });
      toRemove.push(fullMatch);
    }
  }

  for (const line of toRemove) {
    // Remove the entire line
    src = src.replace(new RegExp('^[ \\t]*' + escapeRegex(line) + '[ \\t]*\\n', 'm'), '');
  }

  // ── Step 3: Replace varName.run(...) -> await obj.method(...) ─────────────
  for (const [varName, { obj, method }] of helperMap) {
    // varName.run(args) -> await obj.method(args)
    src = src.replace(
      new RegExp(`\\b${varName}\\.run\\(`, 'g'),
      `await ${obj}.${method}(`
    );
    // varName.get(args) -> await obj.method(args) -- returns first row
    src = src.replace(
      new RegExp(`\\b${varName}\\.get\\(`, 'g'),
      `await ${obj}.${method}(`
    );
    // varName.all(args) -> await obj.method(args) -- returns array
    src = src.replace(
      new RegExp(`\\b${varName}\\.all\\(`, 'g'),
      `await ${obj}.${method}(`
    );
    // bare varName(...) call
    src = src.replace(
      new RegExp(`(?<!await\\s)(?<!return await\\s)\\b${varName}\\(`, 'g'),
      `await ${varName}(`
    );
  }

  // ── Step 4: Direct calls with (db) parameter ──────────────────────────────
  // Pattern: queryObj.method(db, ...) or queryObj.method(db)
  for (const obj of DB_QUERY_OBJECTS) {
    // queryObj.method(db, a, b) -> await queryObj.method(a, b)
    src = src.replace(
      new RegExp(`(?<!await\\s)\\b(${obj}\\.[a-zA-Z]+)\\(\\s*db\\s*,\\s*`, 'g'),
      'await $1('
    );
    // queryObj.method(db) -> await queryObj.method()
    src = src.replace(
      new RegExp(`(?<!await\\s)\\b(${obj}\\.[a-zA-Z]+)\\(\\s*db\\s*\\)`, 'g'),
      'await $1()'
    );
    // queryObj.method(getDatabase(), ...) 
    src = src.replace(
      new RegExp(`(?<!await\\s)\\b(${obj}\\.[a-zA-Z]+)\\(\\s*getDatabase\\(\\)\\s*,\\s*`, 'g'),
      'await $1('
    );
    // Direct call without await: queryObj.method(
    src = src.replace(
      new RegExp(`(?<!await\\s)(?<!return await\\s)\\b(${obj}\\.[a-zA-Z]+)\\((?!\\s*(?:db|getDatabase))`, 'g'),
      'await $1('
    );
  }

  // ── Step 5: sumContributionsUSD / sumTodayContributionsUSD ────────────────
  // sumContributionsUSD(db, scope, from) -> await sumContributionsUSD(scope, from)
  // sumContributionsUSD(getDatabase(), scope, from) -> await sumContributionsUSD(scope, from)
  src = src.replace(
    /(?<!await\s)sumContributionsUSD\(\s*(?:db|getDatabase\(\))\s*,\s*/g,
    'await sumContributionsUSD('
  );
  src = src.replace(
    /(?<!await\s)sumTodayContributionsUSD\(\s*(?:db|getDatabase\(\))\s*,\s*/g,
    'await sumTodayContributionsUSD('
  );
  src = src.replace(
    /(?<!await\s)(?<!return await\s)\bsumContributionsUSD\(/g,
    'await sumContributionsUSD('
  );
  src = src.replace(
    /(?<!await\s)(?<!return await\s)\bsumTodayContributionsUSD\(/g,
    'await sumTodayContributionsUSD('
  );

  // ── Step 6: initializeDatabase() without await ────────────────────────────
  src = src.replace(
    /(?<!await\s)(?<!return await\s)\binitializeDatabase\(\)/g,
    'await initializeDatabase()'
  );

  // ── Step 7: Remove leftover .all() .get() .run() on results ──────────────
  // e.g. const accounts = await accountQueries.getAll().all() as ...
  //      -> const accounts = await accountQueries.getAll() as ...
  src = src.replace(/(\bawait\s+\w+Queries\.\w+\([^)]*\))\.(?:all|get|run)\(\)/g, '$1');

  // ── Step 8: Fix double-await ──────────────────────────────────────────────
  src = src.replace(/\bawait await\b/g, 'await');

  // ── Step 9: Remove leftover `const db = getDatabase();` that remain ───────
  src = src.replace(/^[ \t]*const db = getDatabase\(\);[ \t]*\n/gm, '');

  // ── Step 10: Remove unused getDatabase import if no longer used directly ──
  // (leave it — startup.ts etc may still call it)

  if (src === original) return false;

  if (!DRY_RUN) {
    writeFileSync(filePath, src, 'utf8');
  }
  return true;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const files = walk(ROOT);
let changed = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  // Skip lib/database.ts itself and backup
  if (rel.endsWith('database.ts') && rel.includes('lib')) {
    if (!rel.endsWith('.bak')) {
      console.log(`  SKIP (database.ts itself): ${rel}`);
      continue;
    }
  }
  try {
    const modified = transformFile(file);
    if (modified) {
      console.log(`  ${DRY_RUN ? '[DRY]' : 'MODIFIED'}: ${rel}`);
      changed++;
    }
  } catch (e) {
    console.error(`  ERROR in ${rel}: ${e.message}`);
  }
}

console.log(`\n${DRY_RUN ? 'Dry run' : 'Done'}: ${changed} file(s) ${DRY_RUN ? 'would be' : 'were'} modified.`);
