/**
 * scripts/find-missing-awaits.mjs
 *
 * Scans all .ts/.tsx files that import from lib/database and reports
 * lines that call database query functions without await.
 *
 * Usage: node scripts/find-missing-awaits.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();

// All exported async function/object names from database.ts
const DB_EXPORTS = [
  'accountQueries', 'navQueries', 'kbFundPriceQueries', 'tradeQueries',
  'transactionQueries', 'cashQueries', 'holdingQueries', 'transferQueries',
  'depositQueries', 'withdrawalQueries', 'dividendQueries', 'interestQueries',
  'feeQueries', 'taxQueries', 'changeInNAVQueries', 'livePriceQueries',
  'settingsQueries', 'initializeDatabase', 'closeDatabase',
  'sumContributionsUSD', 'sumTodayContributionsUSD', 'getDatabase',
];

// Pattern: a db query call not preceded by await/return await/yield
// We look for lines that call .method( or directly invoke the function
// without await on the same line (and line doesn't start with await)
const CALL_RE = new RegExp(
  `(?<!await\\s)(?<!return await\\s)\\b(${DB_EXPORTS.join('|')})\\s*[.(]`,
  'g'
);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'scripts') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) files.push(full);
  }
  return files;
}

const allFiles = walk(ROOT);
const results = [];

for (const file of allFiles) {
  const content = readFileSync(file, 'utf8');
  // Only care about files that import from database
  if (!content.includes("from '../lib/database'") &&
      !content.includes("from '../../lib/database'") &&
      !content.includes("from './database'") &&
      !content.includes('lib/database')) continue;

  const lines = content.split('\n');
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip import lines, comments, and lines already with await
    if (line.trim().startsWith('import ')) continue;
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    if (/\bawait\b/.test(line)) continue;

    for (const name of DB_EXPORTS) {
      if (line.includes(name + '.') || line.includes(name + '(')) {
        // Check it's actually a call (has parentheses somewhere)
        if (/\(/.test(line)) {
          hits.push({ lineNum: i + 1, line: line.trim() });
          break;
        }
      }
    }
  }

  if (hits.length > 0) {
    results.push({ file: relative(ROOT, file), hits });
  }
}

if (results.length === 0) {
  console.log('No missing awaits found ✓');
} else {
  console.log(`Found potential missing awaits in ${results.length} file(s):\n`);
  for (const { file, hits } of results) {
    console.log(`\n📄 ${file}`);
    for (const { lineNum, line } of hits) {
      console.log(`  L${lineNum}: ${line.slice(0, 120)}`);
    }
  }
}
