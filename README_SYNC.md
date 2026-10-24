# Portfolio Sync Backend - Setup Guide

This application now includes a professional persistent backend with automated sync and database support.

## Features

1. **SQLite Database**: All historical data is stored in `data/portfolio.db`
2. **Automated Sync**: Checks for gaps in data on startup and syncs automatically
3. **Manual Sync**: Use the "Sync Portfolio" button in the dashboard
4. **Multi-Portfolio Support**: Configure up to 4 portfolios via environment variables

## Database Schema

The SQLite database includes:

- **Accounts**: Portfolio account information
- **DailyNAV**: Historical NAV values (with UNIQUE constraint on account_id + date)
- **Trades**: Trade execution history
- **Transactions**: Cash transactions (deposits, withdrawals, transfers, dividends, etc.)

## Setup

1. **Install Dependencies** (already done):
   ```bash
   npm install better-sqlite3 dotenv
   ```

2. **Configure Environment Variables**:
   - Create a `.env.local` file in the root directory
   - Use the template in `ENV_TEMPLATE.md`
   - Add your IBKR Flex Query tokens and query IDs

3. **Database Initialization**:
   - The database is automatically created on first run
   - Location: `data/portfolio.db`

4. **Startup Sync**:
   - On server startup, the system automatically checks for data gaps
   - If gaps > 1 day are found, portfolios are synced from IBKR API

## Manual Sync

Click the "Sync Portfolio" button in the dashboard header to manually trigger a sync for all configured portfolios.

## IBKR Flex Query Setup

To get your Token and Query ID:

1. Log into Interactive Brokers Client Portal
2. Navigate to Performance & Reports > Flex Queries
3. Create a Flex Query including:
   - ChangeInNAV
   - EquitySummaryByReportDateInBase (for daily NAV)
   - CashTransactions
   - Trades
   - Transfers

4. Copy the Token and Query ID from the query settings

## API Endpoints

- **POST /api/sync**: Manually trigger sync for all portfolios
- **GET /api/portfolio**: Get aggregated portfolio data (now reads from database)

## Data Persistence

All data is stored locally in SQLite. The database:
- Prevents duplicate entries (UNIQUE constraints)
- Maintains full historical data
- Supports fast queries with indexes

## Performance Features

- **Transfer Neutralization**: Internal transfers are automatically detected and neutralize daily returns (0% return on transfer days)
- **Annualized Yield (CAGR)**: Calculated dynamically based on inception date and total TWR
- **Cost Basis**: Initial deposits are counted once, preventing double-counting

## Inception Date

The inception date is dynamically determined from the earliest record in the DailyNAV table, ensuring accurate annualized yield calculations.

