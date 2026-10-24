# TWS Live Data Service Setup

This application includes a TWS (Trader Workstation) live data service that connects to Interactive Brokers' API for real-time portfolio updates.

## Features

1. **Dynamic Account Discovery**: Automatically discovers accounts from TWS without hardcoding
2. **Live NAV Updates**: Real-time Net Liquidation values from TWS
3. **Live P&L Display**: Shows unrealized P&L that updates every few seconds
4. **Connection Indicator**: Green pulsing dot shows when TWS is connected
5. **Offline Mode Fallback**: Automatically falls back to database data if TWS is unavailable

## Prerequisites

1. **Install TWS or IB Gateway**:
   - Download TWS or IB Gateway from Interactive Brokers
   - Configure API settings (see below)

2. **TWS Configuration**:
   - Open TWS/IB Gateway
   - Go to `File > Global Configuration > API > Settings`
   - Enable "Enable ActiveX and Socket Clients"
   - Set Socket Port: `7497` (paper trading) or `7496` (live trading)
   - Enable "Allow connections from localhost only"
   - Click OK

## Environment Variables

Add to your `.env.local` file:

```env
# TWS Connection
TWS_HOST=127.0.0.1
TWS_PORT=7497
TWS_CLIENT_ID=1

# Portfolio Configuration (for account filtering)
PORTFOLIO_COUNT=4
P1_ACCOUNT_ID=U16030763
# ... etc
```

## How It Works

1. **Connection**: The service connects to TWS on startup
2. **Account Discovery**: Requests managed accounts via `reqManagedAccounts()`
3. **Subscription**: For each account in your portfolio list:
   - Subscribes to `reqAccountSummary('All')` for NetLiquidation, UnrealizedPnL, TotalCashValue
   - Subscribes to `reqPositions()` for live position data
4. **Updates**: Data refreshes every 5 seconds
5. **UI Integration**: Dashboard shows:
   - Live NAV (when connected) or database NAV (offline)
   - Live P&L with green pulsing indicator
   - "Last Updated" timestamp when offline

## API Protocol Notes

The current implementation uses a native socket approach compatible with Windows. The IBKR API protocol is complex, and you may need to:

1. Use a Node.js wrapper library (if available for Windows)
2. Use the Python `ib_insync` library with a bridge service
3. Extend the native socket implementation with full protocol support

The service structure is ready, but the protocol implementation may need refinement based on your specific IBKR API setup.

## Error Handling

- If TWS is not running, the service automatically switches to offline mode
- Database data is always available as fallback
- Connection attempts retry every 10 seconds
- UI shows "Offline mode" when disconnected

