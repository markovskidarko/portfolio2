# Environment Configuration Template

Create a `.env.local` file in the root directory with the following structure:

```env
# TWS Connection Configuration
TWS_HOST=127.0.0.1
TWS_PORT=7497
# Use port 7497 for paper trading, 7496 for live trading

# Portfolio Configuration
PORTFOLIO_COUNT=4

# Portfolio 1
P1_NAME=Portfolio 1
P1_ACCOUNT_ID=U16030763
P1_TOKEN=your_token_here
P1_QUERY_ID=your_query_id_here

# Portfolio 2
P2_NAME=Portfolio 2
P2_ACCOUNT_ID=U15352922
P2_TOKEN=your_token_here
P2_QUERY_ID=your_query_id_here

# Portfolio 3
P3_NAME=Portfolio 3
P3_ACCOUNT_ID=U15405459
P3_TOKEN=your_token_here
P3_QUERY_ID=your_query_id_here

# Portfolio 4
P4_NAME=Portfolio 4
P4_ACCOUNT_ID=U22758796
P4_TOKEN=your_token_here
P4_QUERY_ID=your_query_id_here

# Yahoo Finance Symbol Mapping (for ETFs)
# Maps IBKR symbols to Yahoo Finance symbols
# Format: JSON object with IBKR symbol as key and Yahoo Finance symbol as value
# Default mappings are included, but you can override or add more here
YAHOO_SYMBOL_MAP={"SMH":"SMH.L","EQQQ":"EQQQ.SW","EQQU":"EQQQ.SW","IUIT":"IUIT.L","VUSD":"VUSD.L"}
```

## How to Get IBKR Flex Query Token and Query ID

1. Log into Interactive Brokers Client Portal
2. Go to Performance & Reports > Flex Queries
3. Create a Flex Query with the following sections:
   - ChangeInNAV
   - EquitySummaryByReportDateInBase
   - CashTransactions
   - Trades
   - Transfers
4. After creating the query, you'll get:
   - **Token**: Found in the query URL or settings
   - **Query ID**: The query identifier

