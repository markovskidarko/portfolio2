-- Postgres schema for Portfolio2
-- Run this ONCE against Neon to create all tables

-- Accounts table
CREATE TABLE IF NOT EXISTS "Accounts" (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- DailyNAV table
CREATE TABLE IF NOT EXISTS "DailyNAV" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  nav_value DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, date),
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_dailynav_account_date ON "DailyNAV"(account_id, date);

-- Trades table
CREATE TABLE IF NOT EXISTS "Trades" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  commission DOUBLE PRECISION DEFAULT 0,
  date TEXT NOT NULL,
  realized_pnl DOUBLE PRECISION DEFAULT 0,
  trade_id TEXT,
  proceeds DOUBLE PRECISION DEFAULT 0,
  buy_sell TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_trades_account_date ON "Trades"(account_id, date);

-- Transactions table
CREATE TABLE IF NOT EXISTS "Transactions" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  symbol TEXT,
  transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON "Transactions"(account_id, date);

-- Cash table
CREATE TABLE IF NOT EXISTS "Cash" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
  report_date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, report_date),
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_cash_account_date ON "Cash"(account_id, report_date);

-- Holdings table
CREATE TABLE IF NOT EXISTS "Holdings" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
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
  UNIQUE(account_id, symbol, report_date),
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_holdings_account_symbol ON "Holdings"(account_id, symbol, report_date);

-- Transfers table
CREATE TABLE IF NOT EXISTS "Transfers" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
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
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_account_transaction_id
  ON "Transfers"(account_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transfers_account_date ON "Transfers"(account_id, date);

-- Deposits table
CREATE TABLE IF NOT EXISTS "Deposits" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
  transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_deposits_account_date ON "Deposits"(account_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_account_transaction_id
  ON "Deposits"(account_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Withdrawals table
CREATE TABLE IF NOT EXISTS "Withdrawals" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
  transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_account_date ON "Withdrawals"(account_id, date);

-- Dividends table
CREATE TABLE IF NOT EXISTS "Dividends" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  symbol TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
  transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_dividends_account_date ON "Dividends"(account_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dividends_account_transaction_id
  ON "Dividends"(account_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Interest table
CREATE TABLE IF NOT EXISTS "Interest" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
  transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_interest_account_date ON "Interest"(account_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_account_transaction_id
  ON "Interest"(account_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Fees table
CREATE TABLE IF NOT EXISTS "Fees" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  fee_type TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
  transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_fees_account_date ON "Fees"(account_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_account_transaction_id
  ON "Fees"(account_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Taxes table
CREATE TABLE IF NOT EXISTS "Taxes" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  tax_type TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_base DOUBLE PRECISION DEFAULT 1.0,
  transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_taxes_account_date ON "Taxes"(account_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_taxes_account_transaction_id
  ON "Taxes"(account_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ChangeInNAV table
CREATE TABLE IF NOT EXISTS "ChangeInNAV" (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
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
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, from_date, to_date),
  FOREIGN KEY (account_id) REFERENCES "Accounts"(id)
);

CREATE INDEX IF NOT EXISTS idx_changeinnav_account_date ON "ChangeInNAV"(account_id, to_date);

-- KBFundPrices table
CREATE TABLE IF NOT EXISTS "KBFundPrices" (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  fund_name TEXT NOT NULL,
  price_per_unit_mkd DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, fund_name)
);

CREATE INDEX IF NOT EXISTS idx_kb_fund_prices_date ON "KBFundPrices"(date, fund_name);
CREATE INDEX IF NOT EXISTS idx_kb_fund_prices_fund ON "KBFundPrices"(fund_name, date);

-- live_prices table
CREATE TABLE IF NOT EXISTS live_prices (
  symbol TEXT PRIMARY KEY,
  price DOUBLE PRECISION NOT NULL,
  previous_close DOUBLE PRECISION,
  previous_close_date TEXT,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_live_prices_updated_at ON live_prices(updated_at);

-- Settings table
CREATE TABLE IF NOT EXISTS "Settings" (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
