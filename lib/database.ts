/**
 * lib/database.postgres.ts  —  Postgres edition (replaces the better-sqlite3 version)
 *
 * All queries are now async and use the `postgres` npm package.
 * The public API is kept as close as possible to the original so callers
 * need minimal changes (see migration notes below each export).
 *
 * Migration notes for callers:
 *  - Every query now returns a Promise. Add `await` at every call site.
 *  - Prepared-statement helpers (e.g. navQueries.upsert(db)) are removed;
 *    each helper is now a standalone async function.
 *  - The `database` parameter is no longer passed around — the module owns
 *    a single shared sql client (singleton, same as before).
 *
 * TO ACTIVATE: rename this file to database.ts (replacing the current one)
 * after running the migration steps.
 */

import postgres from 'postgres';

// ─── Connection ──────────────────────────────────────────────────────────────

let _sql: ReturnType<typeof postgres> | null = null;

export function getDatabase(): ReturnType<typeof postgres> {
  if (!_sql) {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    _sql = postgres(DATABASE_URL, {
      ssl: 'require',
      max: 10,             // connection pool size
      idle_timeout: 30,    // seconds before idle connection is closed
    });
  }
  return _sql;
}

export async function closeDatabase(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

// ─── Schema initialisation ────────────────────────────────────────────────────
// Idempotent — safe to call on every startup.

export async function initializeDatabase(): Promise<void> {
  const db = getDatabase();

  await db`
    CREATE TABLE IF NOT EXISTS "Accounts" (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS "DailyNAV" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      date TEXT NOT NULL,
      nav_value DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, date)
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_dailynav_account_date ON "DailyNAV"(account_id, date)`;

  await db`
    CREATE TABLE IF NOT EXISTS "Trades" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      symbol TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      commission DOUBLE PRECISION DEFAULT 0,
      date TEXT NOT NULL,
      realized_pnl DOUBLE PRECISION DEFAULT 0,
      trade_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_trades_account_date ON "Trades"(account_id, date)`;

  await db`
    CREATE TABLE IF NOT EXISTS "Transactions" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      type TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      symbol TEXT,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON "Transactions"(account_id, date)`;

  await db`
    CREATE TABLE IF NOT EXISTS "Cash" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      amount DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      report_date TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, report_date)
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_cash_account_date ON "Cash"(account_id, report_date)`;

  await db`
    CREATE TABLE IF NOT EXISTS "Holdings" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      symbol TEXT NOT NULL,
      description TEXT,
      position DOUBLE PRECISION NOT NULL,
      mark_price DOUBLE PRECISION NOT NULL,
      position_value DOUBLE PRECISION NOT NULL,
      cost_basis_money DOUBLE PRECISION DEFAULT 0,
      fifo_pnl_unrealized DOUBLE PRECISION DEFAULT 0,
      percent_of_nav DOUBLE PRECISION DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      conid TEXT,
      report_date TEXT NOT NULL,
      is_manual INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, symbol, report_date)
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_holdings_account_symbol ON "Holdings"(account_id, symbol, report_date)`;

  await db`
    CREATE TABLE IF NOT EXISTS "Transfers" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      type TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      from_account TEXT,
      to_account TEXT,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_account_transaction_id
      ON "Transfers"(account_id, transaction_id) WHERE transaction_id IS NOT NULL`;
  await db`CREATE INDEX IF NOT EXISTS idx_transfers_account_date ON "Transfers"(account_id, date)`;

  await db`
    CREATE TABLE IF NOT EXISTS "Deposits" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_deposits_account_date ON "Deposits"(account_id, date)`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_account_transaction_id
      ON "Deposits"(account_id, transaction_id) WHERE transaction_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS "Withdrawals" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_withdrawals_account_date ON "Withdrawals"(account_id, date)`;

  await db`
    CREATE TABLE IF NOT EXISTS "Dividends" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      symbol TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_dividends_account_date ON "Dividends"(account_id, date)`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dividends_account_transaction_id
      ON "Dividends"(account_id, transaction_id) WHERE transaction_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS "Interest" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_interest_account_date ON "Interest"(account_id, date)`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_account_transaction_id
      ON "Interest"(account_id, transaction_id) WHERE transaction_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS "Fees" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      fee_type TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_fees_account_date ON "Fees"(account_id, date)`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_account_transaction_id
      ON "Fees"(account_id, transaction_id) WHERE transaction_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS "Taxes" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      tax_type TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      transaction_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_taxes_account_date ON "Taxes"(account_id, date)`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_taxes_account_transaction_id
      ON "Taxes"(account_id, transaction_id) WHERE transaction_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS "ChangeInNAV" (
      id SERIAL PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES "Accounts"(id),
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      starting_value DOUBLE PRECISION NOT NULL,
      ending_value DOUBLE PRECISION NOT NULL,
      deposits_withdrawals DOUBLE PRECISION DEFAULT 0,
      dividends DOUBLE PRECISION DEFAULT 0,
      interest DOUBLE PRECISION DEFAULT 0,
      commissions DOUBLE PRECISION DEFAULT 0,
      withholding_tax DOUBLE PRECISION DEFAULT 0,
      other_fees DOUBLE PRECISION DEFAULT 0,
      twr DOUBLE PRECISION DEFAULT 0,
      fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, from_date, to_date)
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_changeinnav_account_date ON "ChangeInNAV"(account_id, to_date)`;

  await db`
    CREATE TABLE IF NOT EXISTS "KBFundPrices" (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      fund_name TEXT NOT NULL,
      price_per_unit_mkd DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, fund_name)
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_kb_fund_prices_date ON "KBFundPrices"(date, fund_name)`;
  await db`CREATE INDEX IF NOT EXISTS idx_kb_fund_prices_fund ON "KBFundPrices"(fund_name, date)`;

  await db`
    CREATE TABLE IF NOT EXISTS live_prices (
      symbol TEXT PRIMARY KEY,
      price DOUBLE PRECISION NOT NULL,
      previous_close DOUBLE PRECISION,
      previous_close_date TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      source TEXT
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_live_prices_updated_at ON live_prices(updated_at)`;

  await db`
    CREATE TABLE IF NOT EXISTS "Settings" (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`;

  console.log('[DB] Database schema verified');
}

// ─── Account queries ──────────────────────────────────────────────────────────

export const accountQueries = {
  async upsert(id: string, alias: string, currency: string): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Accounts" (id, alias, currency, updated_at)
      VALUES (${id}, ${alias}, ${currency}, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        alias = EXCLUDED.alias,
        currency = EXCLUDED.currency,
        updated_at = CURRENT_TIMESTAMP`;
  },

  async getAll(): Promise<Array<{ id: string; alias: string; currency: string }>> {
    const db = getDatabase();
    return db`SELECT id, alias, currency FROM "Accounts" ORDER BY alias` as unknown as Array<{ id: string; alias: string; currency: string }>;
  },

  async getById(id: string): Promise<{ id: string; alias: string; currency: string } | null> {
    const db = getDatabase();
    const rows = await db`SELECT id, alias, currency FROM "Accounts" WHERE id = ${id}`;
    return (rows as unknown as Array<{ id: string; alias: string; currency: string }>)[0] ?? null;
  },
};

// ─── DailyNAV queries ─────────────────────────────────────────────────────────

export const navQueries = {
  async upsert(accountId: string, date: string, navValue: number): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "DailyNAV" (account_id, date, nav_value)
      VALUES (${accountId}, ${date}, ${navValue})
      ON CONFLICT(account_id, date) DO UPDATE SET
        nav_value = EXCLUDED.nav_value,
        created_at = CURRENT_TIMESTAMP`;
  },

  async getLatest(): Promise<Array<{ account_id: string; max_date: string }>> {
    const db = getDatabase();
    return db`SELECT account_id, MAX(date) as max_date FROM "DailyNAV" GROUP BY account_id` as unknown as Array<{ account_id: string; max_date: string }>;
  },

  async getByAccount(accountId: string): Promise<Array<{ date: string; nav_value: number }>> {
    const db = getDatabase();
    return db`SELECT date, nav_value FROM "DailyNAV" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ date: string; nav_value: number }>;
  },

  async getLatestByAccount(accountId: string): Promise<{ date: string; nav_value: number } | null> {
    const db = getDatabase();
    const rows = await db`
      SELECT date, nav_value FROM "DailyNAV"
      WHERE account_id = ${accountId}
      ORDER BY date DESC LIMIT 1`;
    return (rows as unknown as Array<{ date: string; nav_value: number }>)[0] ?? null;
  },

  async getByDateRange(fromDate: string, toDate: string): Promise<Array<{ account_id: string; date: string; nav_value: number }>> {
    const db = getDatabase();
    return db`
      SELECT account_id, date, nav_value FROM "DailyNAV"
      WHERE date >= ${fromDate} AND date <= ${toDate}
      ORDER BY account_id, date ASC` as unknown as Array<{ account_id: string; date: string; nav_value: number }>;
  },

  async getEarliestDate(): Promise<string | null> {
    const db = getDatabase();
    const rows = await db`SELECT MIN(date) as earliest_date FROM "DailyNAV"`;
    return rows[0]?.earliest_date ?? null;
  },
};

// ─── KBFundPrices queries ─────────────────────────────────────────────────────

export const kbFundPriceQueries = {
  async upsert(date: string, fundName: string, pricePerUnitMkd: number): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "KBFundPrices" (date, fund_name, price_per_unit_mkd)
      VALUES (${date}, ${fundName}, ${pricePerUnitMkd})
      ON CONFLICT(date, fund_name) DO UPDATE SET
        price_per_unit_mkd = EXCLUDED.price_per_unit_mkd,
        created_at = CURRENT_TIMESTAMP`;
  },

  async getAll(): Promise<Array<{ date: string; fund_name: string; price_per_unit_mkd: number }>> {
    const db = getDatabase();
    return db`SELECT date, fund_name, price_per_unit_mkd FROM "KBFundPrices" ORDER BY date DESC, fund_name ASC` as unknown as Array<{ date: string; fund_name: string; price_per_unit_mkd: number }>;
  },

  async getByFund(fundName: string): Promise<Array<{ date: string; price_per_unit_mkd: number }>> {
    const db = getDatabase();
    return db`SELECT date, price_per_unit_mkd FROM "KBFundPrices" WHERE fund_name = ${fundName} ORDER BY date ASC` as unknown as Array<{ date: string; price_per_unit_mkd: number }>;
  },

  async getByDateRange(fromDate: string, toDate: string): Promise<Array<{ date: string; fund_name: string; price_per_unit_mkd: number }>> {
    const db = getDatabase();
    return db`
      SELECT date, fund_name, price_per_unit_mkd FROM "KBFundPrices"
      WHERE date >= ${fromDate} AND date <= ${toDate}
      ORDER BY date ASC, fund_name ASC` as unknown as Array<{ date: string; fund_name: string; price_per_unit_mkd: number }>;
  },

  async getLatestByFund(fundName: string): Promise<{ date: string; price_per_unit_mkd: number } | null> {
    const db = getDatabase();
    const rows = await db`
      SELECT date, price_per_unit_mkd FROM "KBFundPrices"
      WHERE fund_name = ${fundName} ORDER BY date DESC LIMIT 1`;
    return (rows as unknown as Array<{ date: string; price_per_unit_mkd: number }>)[0] ?? null;
  },

  async getLatest(): Promise<Array<{ fund_name: string; max_date: string; price_per_unit_mkd: number }>> {
    const db = getDatabase();
    return db`SELECT fund_name, MAX(date) as max_date, price_per_unit_mkd FROM "KBFundPrices" GROUP BY fund_name, price_per_unit_mkd` as unknown as Array<{ fund_name: string; max_date: string; price_per_unit_mkd: number }>;
  },
};

// ─── Trade queries ────────────────────────────────────────────────────────────

export const tradeQueries = {
  async insert(accountId: string, symbol: string, quantity: number, price: number, commission: number, date: string, realizedPnl: number, tradeId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Trades" (account_id, symbol, quantity, price, commission, date, realized_pnl, trade_id)
      VALUES (${accountId}, ${symbol}, ${quantity}, ${price}, ${commission}, ${date}, ${realizedPnl}, ${tradeId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ symbol: string; quantity: number; price: number; commission: number; date: string; realized_pnl: number }>> {
    const db = getDatabase();
    return db`SELECT symbol, quantity, price, commission, date, realized_pnl FROM "Trades" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ symbol: string; quantity: number; price: number; commission: number; date: string; realized_pnl: number }>;
  },
};

// ─── Transaction queries ──────────────────────────────────────────────────────

export const transactionQueries = {
  async insert(accountId: string, type: string, amount: number, date: string, description: string | null, symbol: string | null, transactionId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Transactions" (account_id, type, amount, date, description, symbol, transaction_id)
      VALUES (${accountId}, ${type}, ${amount}, ${date}, ${description}, ${symbol}, ${transactionId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ type: string; amount: number; date: string; description: string | null; symbol: string | null }>> {
    const db = getDatabase();
    return db`SELECT type, amount, date, description, symbol FROM "Transactions" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ type: string; amount: number; date: string; description: string | null; symbol: string | null }>;
  },
};

// ─── Cash queries ─────────────────────────────────────────────────────────────

export const cashQueries = {
  async upsert(accountId: string, amount: number, currency: string, fxRateToBase: number, reportDate: string): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Cash" (account_id, amount, currency, fx_rate_to_base, report_date)
      VALUES (${accountId}, ${amount}, ${currency}, ${fxRateToBase}, ${reportDate})
      ON CONFLICT(account_id, report_date) DO UPDATE SET
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        fx_rate_to_base = EXCLUDED.fx_rate_to_base,
        created_at = CURRENT_TIMESTAMP`;
  },

  async getLatestByAccount(accountId: string): Promise<{ amount: number; currency: string; fx_rate_to_base: number; report_date: string } | null> {
    const db = getDatabase();
    const rows = await db`
      SELECT amount, currency, fx_rate_to_base, report_date FROM "Cash"
      WHERE account_id = ${accountId} ORDER BY report_date DESC LIMIT 1`;
    return (rows as unknown as Array<{ amount: number; currency: string; fx_rate_to_base: number; report_date: string }>)[0] ?? null;
  },
};

// ─── Holdings queries ─────────────────────────────────────────────────────────

export const holdingQueries = {
  async upsert(
    accountId: string, symbol: string, description: string | null,
    position: number, markPrice: number, positionValue: number,
    costBasisMoney: number, fifoPnlUnrealized: number, percentOfNav: number,
    currency: string, fxRateToBase: number, conid: string | null, reportDate: string
  ): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Holdings" (account_id, symbol, description, position, mark_price, position_value, cost_basis_money, fifo_pnl_unrealized, percent_of_nav, currency, fx_rate_to_base, conid, report_date)
      VALUES (${accountId}, ${symbol}, ${description}, ${position}, ${markPrice}, ${positionValue}, ${costBasisMoney}, ${fifoPnlUnrealized}, ${percentOfNav}, ${currency}, ${fxRateToBase}, ${conid}, ${reportDate})
      ON CONFLICT(account_id, symbol, report_date) DO UPDATE SET
        description = EXCLUDED.description,
        position = EXCLUDED.position,
        mark_price = EXCLUDED.mark_price,
        position_value = EXCLUDED.position_value,
        cost_basis_money = EXCLUDED.cost_basis_money,
        fifo_pnl_unrealized = EXCLUDED.fifo_pnl_unrealized,
        percent_of_nav = EXCLUDED.percent_of_nav,
        currency = EXCLUDED.currency,
        fx_rate_to_base = EXCLUDED.fx_rate_to_base,
        conid = EXCLUDED.conid,
        created_at = CURRENT_TIMESTAMP`;
  },

  async getLatestByAccount(accountId: string): Promise<Array<{
    symbol: string; description: string | null; position: number; mark_price: number;
    position_value: number; cost_basis_money: number; fifo_pnl_unrealized: number;
    percent_of_nav: number; currency: string; fx_rate_to_base: number; conid: string | null;
  }>> {
    const db = getDatabase();
    return (await db`
      SELECT h.symbol, h.description, h.position, h.mark_price, h.position_value,
             h.cost_basis_money, h.fifo_pnl_unrealized, h.percent_of_nav,
             h.currency, h.fx_rate_to_base, h.conid
      FROM "Holdings" h
      WHERE h.account_id = ${accountId}
        AND (
          COALESCE(h.is_manual, 0) = 1
          OR (
            COALESCE(h.is_manual, 0) = 0
            AND NOT EXISTS (
              SELECT 1 FROM "Holdings" m
              WHERE m.account_id = h.account_id
                AND m.symbol = h.symbol
                AND COALESCE(m.is_manual, 0) = 1
            )
            AND h.report_date = (
              SELECT MAX(h2.report_date) FROM "Holdings" h2
              WHERE h2.account_id = h.account_id
                AND h2.symbol = h.symbol
                AND COALESCE(h2.is_manual, 0) = 0
            )
          )
        )
        AND h.position != 0
      ORDER BY h.symbol`) as unknown as Array<{symbol: string; description: string | null; position: number; mark_price: number; position_value: number; cost_basis_money: number; fifo_pnl_unrealized: number; percent_of_nav: number; currency: string; fx_rate_to_base: number; conid: string | null;}>;
  },

  async deleteByAccount(accountId: string): Promise<void> {
    const db = getDatabase();
    await db`DELETE FROM "Holdings" WHERE account_id = ${accountId}`;
  },
};

// ─── Transfer queries ─────────────────────────────────────────────────────────

export const transferQueries = {
  async insert(accountId: string, type: string, direction: string, amount: number, date: string, description: string | null, currency: string, fxRateToBase: number, fromAccount: string | null, toAccount: string | null, transactionId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Transfers" (account_id, type, direction, amount, date, description, currency, fx_rate_to_base, from_account, to_account, transaction_id)
      VALUES (${accountId}, ${type}, ${direction}, ${amount}, ${date}, ${description}, ${currency}, ${fxRateToBase}, ${fromAccount}, ${toAccount}, ${transactionId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ type: string; direction: string; amount: number; date: string; description: string | null; currency: string; fx_rate_to_base: number; from_account: string | null; to_account: string | null; transaction_id: string | null }>> {
    const db = getDatabase();
    return db`SELECT type, direction, amount, date, description, currency, fx_rate_to_base, from_account, to_account, transaction_id FROM "Transfers" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ type: string; direction: string; amount: number; date: string; description: string | null; currency: string; fx_rate_to_base: number; from_account: string | null; to_account: string | null; transaction_id: string | null }>;
  },
};

// ─── Deposit queries ──────────────────────────────────────────────────────────

export const depositQueries = {
  async insert(accountId: string, amount: number, date: string, description: string | null, currency: string, fxRateToBase: number, transactionId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Deposits" (account_id, amount, date, description, currency, fx_rate_to_base, transaction_id)
      VALUES (${accountId}, ${amount}, ${date}, ${description}, ${currency}, ${fxRateToBase}, ${transactionId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ amount: number; date: string; description: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>> {
    const db = getDatabase();
    return db`SELECT amount, date, description, currency, fx_rate_to_base, transaction_id FROM "Deposits" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ amount: number; date: string; description: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>;
  },
};

// ─── Withdrawal queries ───────────────────────────────────────────────────────

export const withdrawalQueries = {
  async insert(accountId: string, amount: number, date: string, description: string | null, currency: string, fxRateToBase: number, transactionId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Withdrawals" (account_id, amount, date, description, currency, fx_rate_to_base, transaction_id)
      VALUES (${accountId}, ${amount}, ${date}, ${description}, ${currency}, ${fxRateToBase}, ${transactionId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ amount: number; date: string; description: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>> {
    const db = getDatabase();
    return db`SELECT amount, date, description, currency, fx_rate_to_base, transaction_id FROM "Withdrawals" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ amount: number; date: string; description: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>;
  },
};

// ─── Dividend queries ─────────────────────────────────────────────────────────

export const dividendQueries = {
  async insert(accountId: string, amount: number, date: string, description: string | null, symbol: string | null, currency: string, fxRateToBase: number, transactionId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Dividends" (account_id, amount, date, description, symbol, currency, fx_rate_to_base, transaction_id)
      VALUES (${accountId}, ${amount}, ${date}, ${description}, ${symbol}, ${currency}, ${fxRateToBase}, ${transactionId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ amount: number; date: string; description: string | null; symbol: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>> {
    const db = getDatabase();
    return db`SELECT amount, date, description, symbol, currency, fx_rate_to_base, transaction_id FROM "Dividends" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ amount: number; date: string; description: string | null; symbol: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>;
  },
};

// ─── Interest queries ─────────────────────────────────────────────────────────

export const interestQueries = {
  async insert(accountId: string, amount: number, date: string, description: string | null, currency: string, fxRateToBase: number, transactionId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Interest" (account_id, amount, date, description, currency, fx_rate_to_base, transaction_id)
      VALUES (${accountId}, ${amount}, ${date}, ${description}, ${currency}, ${fxRateToBase}, ${transactionId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ amount: number; date: string; description: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>> {
    const db = getDatabase();
    return db`SELECT amount, date, description, currency, fx_rate_to_base, transaction_id FROM "Interest" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ amount: number; date: string; description: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>;
  },
};

// ─── Fee queries ──────────────────────────────────────────────────────────────

export const feeQueries = {
  async insert(accountId: string, amount: number, date: string, description: string | null, feeType: string | null, currency: string, fxRateToBase: number, transactionId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Fees" (account_id, amount, date, description, fee_type, currency, fx_rate_to_base, transaction_id)
      VALUES (${accountId}, ${amount}, ${date}, ${description}, ${feeType}, ${currency}, ${fxRateToBase}, ${transactionId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ amount: number; date: string; description: string | null; fee_type: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>> {
    const db = getDatabase();
    return db`SELECT amount, date, description, fee_type, currency, fx_rate_to_base, transaction_id FROM "Fees" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ amount: number; date: string; description: string | null; fee_type: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>;
  },
};

// ─── Tax queries ──────────────────────────────────────────────────────────────

export const taxQueries = {
  async insert(accountId: string, amount: number, date: string, description: string | null, taxType: string | null, currency: string, fxRateToBase: number, transactionId: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Taxes" (account_id, amount, date, description, tax_type, currency, fx_rate_to_base, transaction_id)
      VALUES (${accountId}, ${amount}, ${date}, ${description}, ${taxType}, ${currency}, ${fxRateToBase}, ${transactionId})`;
  },

  async getByAccount(accountId: string): Promise<Array<{ amount: number; date: string; description: string | null; tax_type: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>> {
    const db = getDatabase();
    return db`SELECT amount, date, description, tax_type, currency, fx_rate_to_base, transaction_id FROM "Taxes" WHERE account_id = ${accountId} ORDER BY date ASC` as unknown as Array<{ amount: number; date: string; description: string | null; tax_type: string | null; currency: string; fx_rate_to_base: number; transaction_id: string | null }>;
  },
};

// ─── ChangeInNAV queries ──────────────────────────────────────────────────────

export const changeInNAVQueries = {
  async upsert(
    accountId: string, fromDate: string, toDate: string,
    startingValue: number, endingValue: number, depositsWithdrawals: number,
    dividends: number, interest: number, commissions: number,
    withholdingTax: number, otherFees: number, twr: number, fxRateToBase: number
  ): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "ChangeInNAV" (account_id, from_date, to_date, starting_value, ending_value, deposits_withdrawals, dividends, interest, commissions, withholding_tax, other_fees, twr, fx_rate_to_base)
      VALUES (${accountId}, ${fromDate}, ${toDate}, ${startingValue}, ${endingValue}, ${depositsWithdrawals}, ${dividends}, ${interest}, ${commissions}, ${withholdingTax}, ${otherFees}, ${twr}, ${fxRateToBase})
      ON CONFLICT(account_id, from_date, to_date) DO UPDATE SET
        starting_value = EXCLUDED.starting_value,
        ending_value = EXCLUDED.ending_value,
        deposits_withdrawals = EXCLUDED.deposits_withdrawals,
        dividends = EXCLUDED.dividends,
        interest = EXCLUDED.interest,
        commissions = EXCLUDED.commissions,
        withholding_tax = EXCLUDED.withholding_tax,
        other_fees = EXCLUDED.other_fees,
        twr = EXCLUDED.twr,
        fx_rate_to_base = EXCLUDED.fx_rate_to_base,
        created_at = CURRENT_TIMESTAMP`;
  },

  async getByAccount(accountId: string): Promise<{
    from_date: string; to_date: string; starting_value: number; ending_value: number;
    deposits_withdrawals: number; dividends: number; interest: number;
    commissions: number; withholding_tax: number; other_fees: number;
    twr: number; fx_rate_to_base: number;
  } | null> {
    const db = getDatabase();
    const rows = await db`
      SELECT from_date, to_date, starting_value, ending_value, deposits_withdrawals,
             dividends, interest, commissions, withholding_tax, other_fees, twr, fx_rate_to_base
      FROM "ChangeInNAV"
      WHERE account_id = ${accountId}
      ORDER BY to_date DESC LIMIT 1`;
    return (rows as unknown as Array<{ from_date: string; to_date: string; starting_value: number; ending_value: number; deposits_withdrawals: number; dividends: number; interest: number; commissions: number; withholding_tax: number; other_fees: number; twr: number; fx_rate_to_base: number; }>)[0] ?? null;
  },
};

// ─── Live Prices queries ──────────────────────────────────────────────────────

export const livePriceQueries = {
  async upsert(symbol: string, price: number, previousClose: number | null, previousCloseDate: string | null, source: string | null): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO live_prices (symbol, price, previous_close, previous_close_date, updated_at, source)
      VALUES (${symbol}, ${price}, ${previousClose}, ${previousCloseDate}, CURRENT_TIMESTAMP, ${source})
      ON CONFLICT(symbol) DO UPDATE SET
        price = EXCLUDED.price,
        previous_close = EXCLUDED.previous_close,
        previous_close_date = EXCLUDED.previous_close_date,
        updated_at = CURRENT_TIMESTAMP,
        source = EXCLUDED.source`;
  },

  async invalidate(symbol: string): Promise<void> {
    const db = getDatabase();
    await db`DELETE FROM live_prices WHERE symbol = ${symbol}`;
  },

  async get(symbol: string): Promise<{ price: number; previous_close: number | null; previous_close_date: string | null; updated_at: string; source: string | null } | null> {
    const db = getDatabase();
    const rows = await db`
      SELECT price, previous_close, previous_close_date, updated_at, source
      FROM live_prices WHERE symbol = ${symbol}`;
    return (rows as unknown as Array<{ price: number; previous_close: number | null; previous_close_date: string | null; updated_at: string; source: string | null }>)[0] ?? null;
  },

  async getAll(): Promise<Array<{ symbol: string; price: number; previous_close: number | null; previous_close_date: string | null; updated_at: string; source: string | null }>> {
    const db = getDatabase();
    return db`SELECT symbol, price, previous_close, previous_close_date, updated_at, source FROM live_prices ORDER BY symbol` as unknown as Array<{ symbol: string; price: number; previous_close: number | null; previous_close_date: string | null; updated_at: string; source: string | null }>;
  },
};

// ─── Settings queries ─────────────────────────────────────────────────────────

export const settingsQueries = {
  async get(key: string): Promise<{ value: string; updated_at: string } | null> {
    const db = getDatabase();
    const rows = await db`SELECT value, updated_at FROM "Settings" WHERE key = ${key}`;
    return (rows as unknown as Array<{ value: string; updated_at: string }>)[0] ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    const db = getDatabase();
    await db`
      INSERT INTO "Settings" (key, value, updated_at)
      VALUES (${key}, ${value}, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = CURRENT_TIMESTAMP`;
  },

  async getAll(): Promise<Array<{ key: string; value: string; updated_at: string }>> {
    const db = getDatabase();
    return db`SELECT key, value, updated_at FROM "Settings" ORDER BY key` as unknown as Array<{ key: string; value: string; updated_at: string }>;
  },
};

// ─── Utility: sum contributions ───────────────────────────────────────────────

export async function sumContributionsUSD(
  accountIds: Set<string> | string[] | null,
  fromDate: string,
  toDate: string = new Date().toISOString().split('T')[0]
): Promise<number> {
  const db = getDatabase();

  let idList: string[];
  if (accountIds == null) {
    const rows = await db`SELECT id FROM "Accounts" WHERE id != 'HUNGARY_MIGRATION_HISTORY'`;
    idList = (rows as unknown as Array<{ id: string }>).map(r => r.id);
  } else {
    idList = Array.from(accountIds);
  }
  if (idList.length === 0) return 0;

  const depRows = await db`
    SELECT amount, fx_rate_to_base FROM "Deposits"
    WHERE account_id = ANY(${idList}) AND date >= ${fromDate} AND date <= ${toDate}`;

  const wdRows = await db`
    SELECT amount, fx_rate_to_base FROM "Withdrawals"
    WHERE account_id = ANY(${idList}) AND date >= ${fromDate} AND date <= ${toDate}`;

  let net = 0;
  for (const d of depRows) net += (d.amount as number) * ((d.fx_rate_to_base as number) ?? 1);
  for (const w of wdRows) net -= (w.amount as number) * ((w.fx_rate_to_base as number) ?? 1);
  return net;
}

export async function sumTodayContributionsUSD(
  accountIds: Set<string> | string[] | null
): Promise<number> {
  const todayStr = new Date().toISOString().split('T')[0];
  return sumContributionsUSD(accountIds, todayStr, todayStr);
}
