# Mobile API - FastAPI Backend

FastAPI backend for Android app that provides portfolio summary from existing SQLite database.

## Installation

```bash
pip install -r requirements-mobile-api.txt
```

## Running the Server

```bash
python mobile_api.py
```

Or with uvicorn directly:
```bash
uvicorn mobile_api:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at `http://localhost:8000`

## API Endpoints

### WebSocket `/ws/all-metrics`

Real-time streaming endpoint that pushes portfolio metrics every 2 seconds to all connected clients.

**Connection:**
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/all-metrics');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data contains: header, stock_portfolios, kb_funds, timestamp
};
```

**Message Format:**
Same JSON structure as `/api/portfolio-summary` endpoint, pushed automatically every 2 seconds.

**Features:**
- Automatic reconnection handling
- Background task runs only when clients are connected
- Broadcasts to all connected clients simultaneously
- Handles ping/pong for connection keepalive

### GET `/api/portfolio-summary`

Returns portfolio summary with:
- **header**: Global summary (Stocks + KB Funds combined)
- **stock_portfolios**: List of stock portfolios grouped by account
- **kb_funds**: KB Funds summary
- **timestamp**: Response timestamp

**Response Format:**
```json
{
  "header": {
    "current_value": 1234567.89,
    "today_change": 1234.56,
    "today_change_percent": 0.1,
    "ytd_change": 56789.01,
    "ytd_change_percent": 4.8
  },
  "stock_portfolios": [
    {
      "account_id": "U16030763",
      "account_alias": "Main Account",
      "current_value": 500000.00,
      "today_change": 500.00,
      "today_change_percent": 0.1,
      "ytd_change": 25000.00,
      "ytd_change_percent": 5.0
    }
  ],
  "kb_funds": {
    "current_value": 364727.64,
    "today_change": 1234.56,
    "today_change_percent": 0.34,
    "ytd_change": 15000.00,
    "ytd_change_percent": 4.3
  },
  "timestamp": "2026-01-21T12:00:00"
}
```

### GET `/health`

Health check endpoint.

## Caching

The `/api/portfolio-summary` endpoint is cached for 5 minutes to reduce database load. Subsequent requests within 5 minutes will return cached data.

## Database

The API uses the existing SQLite database at `data/portfolio.db`.

**Stock Portfolios:**
- Uses `Accounts` table for account list
- Uses `DailyNAV` table for current value (latest date) or falls back to `Holdings` + `Cash`
- Calculates Today's change from latest vs previous day NAV
- Calculates YTD from latest vs Jan 1, 2026 (or first available date in 2026)

**KB Funds:**
- Uses `KBFundPrices` table
- Calculates value as: `Price Per Unit (MKD) × Units ÷ USD/MKD Rate`
- Units are fixed constants per fund
- Fetches USD/MKD exchange rate from API dynamically

## Exchange Rate

The API fetches the current USD/MKD exchange rate from `https://api.exchangerate-api.com/v4/latest/USD`. Falls back to 52.98 if the API is unavailable.

