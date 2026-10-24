"""
FastAPI Backend for Android App
Provides portfolio summary endpoint using existing SQLite database
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Set
from datetime import datetime, timedelta
import sqlite3
from pathlib import Path
import os
import asyncio
import json

app = FastAPI(title="Portfolio Tracker Mobile API")

# Enable CORS for mobile app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your app's domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database path
DB_PATH = Path(__file__).parent / "data" / "portfolio.db"

# Cache duration: 5 minutes
CACHE_DURATION = timedelta(minutes=5)
cache_timestamp = None
cached_response = None

# WebSocket connections manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.background_task = None
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"[WebSocket] Client connected. Total connections: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"[WebSocket] Client disconnected. Total connections: {len(self.active_connections)}")
    
    async def send_personal_message(self, message: str, websocket: WebSocket):
        try:
            await websocket.send_text(message)
        except Exception as e:
            print(f"[WebSocket] Error sending message: {e}")
            self.disconnect(websocket)
    
    async def broadcast(self, message: str):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                print(f"[WebSocket] Error broadcasting to client: {e}")
                disconnected.append(connection)
        
        # Remove disconnected clients
        for connection in disconnected:
            self.disconnect(connection)

manager = ConnectionManager()


def get_db_connection():
    """Get SQLite database connection"""
    if not DB_PATH.exists():
        raise HTTPException(status_code=500, detail="Database file not found")
    return sqlite3.connect(str(DB_PATH))


class StockPortfolio(BaseModel):
    account_id: str
    account_alias: str
    current_value: float
    today_change: float
    today_change_percent: float
    ytd_change: float
    ytd_change_percent: float


class KBFundsSummary(BaseModel):
    current_value: float
    today_change: float
    today_change_percent: float
    ytd_change: float
    ytd_change_percent: float


class GlobalSummary(BaseModel):
    current_value: float
    today_change: float
    today_change_percent: float
    ytd_change: float
    ytd_change_percent: float


class PortfolioSummaryResponse(BaseModel):
    header: GlobalSummary
    stock_portfolios: List[StockPortfolio]
    kb_funds: KBFundsSummary
    timestamp: str


def get_latest_nav_date(conn: sqlite3.Connection) -> Optional[str]:
    """Get the latest date from DailyNAV table"""
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(date) FROM DailyNAV")
    result = cursor.fetchone()
    return result[0] if result and result[0] else None


def get_previous_nav_date(conn: sqlite3.Connection, date: str) -> Optional[str]:
    """Get the previous day's date from DailyNAV"""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT MAX(date) FROM DailyNAV WHERE date < ?",
        (date,)
    )
    result = cursor.fetchone()
    return result[0] if result and result[0] else None


def get_ytd_nav_date(conn: sqlite3.Connection, year: int = 2026) -> Optional[str]:
    """Get Jan 1st of the year or first available date in the year"""
    cursor = conn.cursor()
    jan1 = f"{year}-01-01"
    
    # Try to find Jan 1st first
    cursor.execute("SELECT date FROM DailyNAV WHERE date = ? LIMIT 1", (jan1,))
    result = cursor.fetchone()
    if result:
        return result[0]
    
    # If not found, get first available date in the year
    cursor.execute(
        "SELECT MIN(date) FROM DailyNAV WHERE date >= ?",
        (jan1,)
    )
    result = cursor.fetchone()
    if result and result[0]:
        return result[0]
    
    # Fallback: get earliest date overall
    cursor.execute("SELECT MIN(date) FROM DailyNAV")
    result = cursor.fetchone()
    return result[0] if result and result[0] else None


def get_account_nav(conn: sqlite3.Connection, account_id: str, date: str) -> Optional[float]:
    """Get NAV value for a specific account and date"""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT nav_value FROM DailyNAV WHERE account_id = ? AND date = ?",
        (account_id, date)
    )
    result = cursor.fetchone()
    return result[0] if result else None


def get_account_holdings_value(conn: sqlite3.Connection, account_id: str) -> float:
    """Calculate current value from Holdings table (sum of position_value)"""
    cursor = conn.cursor()
    # Get latest holdings for the account
    cursor.execute("""
        SELECT SUM(h.position_value * h.fx_rate_to_base) as total_value
        FROM Holdings h
        INNER JOIN (
            SELECT account_id, symbol, MAX(report_date) as max_date
            FROM Holdings
            WHERE account_id = ?
            GROUP BY account_id, symbol
        ) latest ON h.account_id = latest.account_id 
            AND h.symbol = latest.symbol 
            AND h.report_date = latest.max_date
        WHERE h.account_id = ?
    """, (account_id, account_id))
    result = cursor.fetchone()
    return result[0] if result and result[0] else 0.0


def get_account_cash(conn: sqlite3.Connection, account_id: str) -> float:
    """Get latest cash value for account"""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT amount * fx_rate_to_base
        FROM Cash
        WHERE account_id = ?
        ORDER BY report_date DESC
        LIMIT 1
    """, (account_id,))
    result = cursor.fetchone()
    return result[0] if result and result[0] else 0.0


def normalize_symbol(symbol: str) -> str:
    """Normalize symbol - EQQU and EQQQ are the same"""
    normalized = symbol.upper().strip()
    if normalized == 'EQQU':
        return 'EQQQ'
    return normalized


def map_symbol_for_yahoo(symbol: str) -> str:
    """Map IBKR symbol to Yahoo Finance symbol (for lookup in live_prices table)"""
    symbol_map = {
        'SMH': 'SMH.L',
        'EQQQ': 'EQQQ.SW',
        'EQQU': 'EQQQ.SW',  # EQQU maps to the same as EQQQ
        'IUIT': 'IUIT.L',
        'IIUT': 'IIUT.L',
        'VUSD': 'VUSD.L',
    }
    mapped = symbol_map.get(symbol.upper())
    return mapped if mapped else symbol


def get_account_holdings_value_with_live_prices(conn: sqlite3.Connection, account_id: str) -> float:
    """Calculate current value from Holdings using live_prices cache (same as main program)
    This matches the logic in app/api/portfolio/live-prices/route.ts
    """
    cursor = conn.cursor()
    
    # Get latest holdings for the account (deduplicated)
    cursor.execute("""
        SELECT h.symbol, h.position, h.fx_rate_to_base, h.mark_price, h.position_value
        FROM Holdings h
        INNER JOIN (
            SELECT account_id, symbol, MAX(report_date) as max_date
            FROM Holdings
            WHERE account_id = ?
            GROUP BY account_id, symbol
        ) latest ON h.account_id = latest.account_id 
            AND h.symbol = latest.symbol 
            AND h.report_date = latest.max_date
        WHERE h.account_id = ?
    """, (account_id, account_id))
    holdings = cursor.fetchall()
    
    # Deduplicate holdings (EQQQ and EQQU are the same)
    deduplicated_holdings = {}
    for symbol, position, fx_rate, mark_price, position_value in holdings:
        normalized_symbol = normalize_symbol(symbol)
        if normalized_symbol not in deduplicated_holdings:
            deduplicated_holdings[normalized_symbol] = (symbol, position, fx_rate, mark_price, position_value)
        else:
            # Keep the one with higher position_value
            existing = deduplicated_holdings[normalized_symbol]
            if position_value > existing[4]:
                deduplicated_holdings[normalized_symbol] = (symbol, position, fx_rate, mark_price, position_value)
    
    # Get cash
    cash_value = get_account_cash(conn, account_id)
    
    # Calculate value using live_prices cache
    # IMPORTANT: live_prices table stores symbols in Yahoo Finance format (EQQQ.SW, SMH.L, etc.)
    total_value = cash_value
    
    for normalized_symbol, (original_symbol, position, fx_rate, mark_price, position_value) in deduplicated_holdings.items():
        # Map normalized symbol to Yahoo Finance format for lookup in live_prices table
        yahoo_symbol = map_symbol_for_yahoo(normalized_symbol)
        
        # Try to get live price from cache using Yahoo symbol
        live_price = None
        cursor.execute("""
            SELECT price FROM live_prices WHERE symbol = ?
        """, (yahoo_symbol,))
        price_result = cursor.fetchone()
        
        if price_result:
            live_price = price_result[0]
        else:
            # Fallback: try normalized symbol (in case some prices are stored with normalized symbols)
            cursor.execute("""
                SELECT price FROM live_prices WHERE symbol = ?
            """, (normalized_symbol,))
            price_result = cursor.fetchone()
            if price_result:
                live_price = price_result[0]
        
        if live_price and live_price > 0:
            # Use live price if available
            position_value_usd = position * live_price * fx_rate
            total_value += position_value_usd
        else:
            # Fallback: use mark_price from Holdings (database value)
            # This matches the main program's behavior when price is not available
            # The main program uses mark_price when live price fetch fails
            position_value_usd = position * mark_price * fx_rate
            total_value += position_value_usd
    
    return total_value


def calculate_stock_portfolios(conn: sqlite3.Connection) -> List[StockPortfolio]:
    """Calculate stock portfolio summaries grouped by account
    Uses same logic as main program: DailyNAV for YTD and Today calculations
    """
    cursor = conn.cursor()
    
    # Get all accounts, excluding Hungary Migration History
    cursor.execute("SELECT id, alias FROM Accounts WHERE id != 'HUNGARY_MIGRATION_HISTORY'")
    accounts = cursor.fetchall()
    
    # Get current year start date
    year_start = "2026-01-01"
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    portfolios = []
    
    for account_id, account_alias in accounts:
        # Get all NAV records for this account, ordered by date
        cursor.execute("""
            SELECT date, nav_value 
            FROM DailyNAV 
            WHERE account_id = ? 
            ORDER BY date ASC
        """, (account_id,))
        nav_records = cursor.fetchall()
        
        # Calculate current value using live prices (same as main program)
        # This matches app/api/portfolio/live-prices/route.ts logic
        # The main program always uses live prices, not DailyNAV for current value
        current_value = get_account_holdings_value_with_live_prices(conn, account_id)
        
        if not nav_records:
            # No NAV data - use calculated value from holdings
            portfolios.append(StockPortfolio(
                account_id=account_id,
                account_alias=account_alias or account_id,
                current_value=current_value,
                today_change=0.0,
                today_change_percent=0.0,
                ytd_change=0.0,
                ytd_change_percent=0.0
            ))
            continue
        
        # Get latest NAV (last record) for YTD and Today calculations only
        # Current value always comes from live prices, not DailyNAV
        latest_nav = nav_records[-1]
        latest_nav_date = latest_nav[0]
        latest_nav_value = latest_nav[1]
        
        # Use live prices value (same as main program - it always uses live prices for current value)
        # The main program uses: displayValue = currentValue > 0 ? currentValue : databaseNav
        # So we use live prices if > 0, otherwise fallback to NAV
        display_value = current_value if current_value > 0 else latest_nav_value
        
        # Find YTD NAV: First record >= year_start, or earliest available
        ytd_nav_record = None
        for record in nav_records:
            if record[0] >= year_start:
                ytd_nav_record = record
                break
        
        # If no record >= year_start, use earliest available
        if not ytd_nav_record:
            ytd_nav_record = nav_records[0]
        
        ytd_nav_value = ytd_nav_record[1]
        
        # Find today's NAV or use latest
        today_nav_record = None
        for record in nav_records:
            if record[0] == today_str:
                today_nav_record = record
                break
        
        # If today's NAV not found, use latest
        if not today_nav_record:
            today_nav_record = latest_nav
        
        today_nav_value = today_nav_record[1]
        
        # Calculate YTD change: display_value - ytd_nav_value
        # Same logic as main program: ytdChange = currentValue - ytdNavValue
        ytd_change = display_value - ytd_nav_value
        ytd_change_percent = (ytd_change / ytd_nav_value * 100) if ytd_nav_value > 0 else 0.0
        
        # Calculate Today's change: display_value - today_nav_value
        # Same logic as main program: todayChange = currentValue - todayNavValue
        today_change = display_value - today_nav_value
        today_change_percent = (today_change / today_nav_value * 100) if today_nav_value > 0 else 0.0
        
        portfolios.append(StockPortfolio(
            account_id=account_id,
            account_alias=account_alias or account_id,
            current_value=display_value,
            today_change=today_change,
            today_change_percent=today_change_percent,
            ytd_change=ytd_change,
            ytd_change_percent=ytd_change_percent
        ))
    
    return portfolios


def calculate_kb_funds(conn: sqlite3.Connection, usd_rate: float = 52.98) -> KBFundsSummary:
    """Calculate KB Funds summary"""
    cursor = conn.cursor()
    
    # KB Fund unit constants
    KB_FUND_UNITS = {
        'Stocks': 40345.9594,
        'Balanced': 23886.3365,
        'Gold': 28266.8087,
    }
    
    # Get latest date for KB Funds (use KBFundPrices table)
    cursor.execute("SELECT MAX(date) FROM KBFundPrices")
    latest_date_result = cursor.fetchone()
    latest_date = latest_date_result[0] if latest_date_result and latest_date_result[0] else None
    
    if not latest_date:
        return KBFundsSummary(
            current_value=0.0,
            today_change=0.0,
            today_change_percent=0.0,
            ytd_change=0.0,
            ytd_change_percent=0.0
        )
    
    # Get previous date
    cursor.execute(
        "SELECT MAX(date) FROM KBFundPrices WHERE date < ?",
        (latest_date,)
    )
    previous_date_result = cursor.fetchone()
    previous_date = previous_date_result[0] if previous_date_result and previous_date_result[0] else None
    
    # Get YTD date (Jan 1, 2026 or first available in 2026)
    ytd_date = "2026-01-01"
    cursor.execute(
        "SELECT MIN(date) FROM KBFundPrices WHERE date >= ?",
        (ytd_date,)
    )
    ytd_date_result = cursor.fetchone()
    if ytd_date_result and ytd_date_result[0]:
        ytd_date = ytd_date_result[0]
    else:
        # Fallback to earliest date
        cursor.execute("SELECT MIN(date) FROM KBFundPrices")
        ytd_date_result = cursor.fetchone()
        ytd_date = ytd_date_result[0] if ytd_date_result and ytd_date_result[0] else latest_date
    
    # Calculate current value
    current_value_mkd = 0.0
    cursor.execute(
        "SELECT fund_name, price_per_unit_mkd FROM KBFundPrices WHERE date = ?",
        (latest_date,)
    )
    current_prices = cursor.fetchall()
    
    for fund_name, price_per_unit in current_prices:
        if fund_name in KB_FUND_UNITS:
            units = KB_FUND_UNITS[fund_name]
            current_value_mkd += price_per_unit * units
    
    current_value_usd = current_value_mkd / usd_rate if usd_rate > 0 else 0.0
    
    # Calculate today's change
    today_change = 0.0
    today_change_percent = 0.0
    if previous_date:
        previous_value_mkd = 0.0
        cursor.execute(
            "SELECT fund_name, price_per_unit_mkd FROM KBFundPrices WHERE date = ?",
            (previous_date,)
        )
        previous_prices = cursor.fetchall()
        
        for fund_name, price_per_unit in previous_prices:
            if fund_name in KB_FUND_UNITS:
                units = KB_FUND_UNITS[fund_name]
                previous_value_mkd += price_per_unit * units
        
        previous_value_usd = previous_value_mkd / usd_rate if usd_rate > 0 else 0.0
        
        if previous_value_usd > 0:
            today_change = current_value_usd - previous_value_usd
            today_change_percent = (today_change / previous_value_usd) * 100
    
    # Calculate YTD change
    ytd_change = 0.0
    ytd_change_percent = 0.0
    if ytd_date and ytd_date != latest_date:
        ytd_value_mkd = 0.0
        cursor.execute(
            "SELECT fund_name, price_per_unit_mkd FROM KBFundPrices WHERE date = ?",
            (ytd_date,)
        )
        ytd_prices = cursor.fetchall()
        
        for fund_name, price_per_unit in ytd_prices:
            if fund_name in KB_FUND_UNITS:
                units = KB_FUND_UNITS[fund_name]
                ytd_value_mkd += price_per_unit * units
        
        ytd_value_usd = ytd_value_mkd / usd_rate if usd_rate > 0 else 0.0
        
        if ytd_value_usd > 0:
            ytd_change = current_value_usd - ytd_value_usd
            ytd_change_percent = (ytd_change / ytd_value_usd) * 100
    
    return KBFundsSummary(
        current_value=current_value_usd,
        today_change=today_change,
        today_change_percent=today_change_percent,
        ytd_change=ytd_change,
        ytd_change_percent=ytd_change_percent
    )


def fetch_usd_mkd_rate() -> float:
    """Fetch current USD/MKD exchange rate from API"""
    try:
        import requests
        response = requests.get('https://api.exchangerate-api.com/v4/latest/USD', timeout=5)
        data = response.json()
        mkd_rate = data.get('rates', {}).get('MKD', 52.98)
        # Validate rate is reasonable
        if 1 < mkd_rate < 100:
            return mkd_rate
    except Exception as e:
        print(f"Error fetching exchange rate: {e}")
    # Fallback rate
    return 52.98


@app.get("/api/portfolio-summary", response_model=PortfolioSummaryResponse)
async def get_portfolio_summary():
    """
    Get portfolio summary for mobile app
    Returns stock portfolios, KB funds, and combined global summary
    Cached for 5 minutes
    """
    global cache_timestamp, cached_response
    
    # Check cache
    now = datetime.now()
    if cached_response and cache_timestamp:
        if now - cache_timestamp < CACHE_DURATION:
            return cached_response
    
    try:
        conn = get_db_connection()
        conn.row_factory = sqlite3.Row
        
        # Fetch exchange rate
        usd_rate = fetch_usd_mkd_rate()
        
        # Calculate stock portfolios
        stock_portfolios = calculate_stock_portfolios(conn)
        
        # Calculate KB Funds
        kb_funds = calculate_kb_funds(conn, usd_rate)
        
        # Calculate global summary (combined)
        total_stock_value = sum(p.current_value for p in stock_portfolios)
        total_stock_today = sum(p.today_change for p in stock_portfolios)
        total_stock_ytd = sum(p.ytd_change for p in stock_portfolios)
        
        global_current = total_stock_value + kb_funds.current_value
        global_today = total_stock_today + kb_funds.today_change
        global_ytd = total_stock_ytd + kb_funds.ytd_change
        
        # Calculate percentages for global
        global_today_percent = 0.0
        if global_current - global_today > 0:
            global_today_percent = (global_today / (global_current - global_today)) * 100
        
        global_ytd_percent = 0.0
        if global_current - global_ytd > 0:
            global_ytd_percent = (global_ytd / (global_current - global_ytd)) * 100
        
        header = GlobalSummary(
            current_value=global_current,
            today_change=global_today,
            today_change_percent=global_today_percent,
            ytd_change=global_ytd,
            ytd_change_percent=global_ytd_percent
        )
        
        response = PortfolioSummaryResponse(
            header=header,
            stock_portfolios=stock_portfolios,
            kb_funds=kb_funds,
            timestamp=now.isoformat()
        )
        
        # Update cache
        cache_timestamp = now
        cached_response = response
        
        conn.close()
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating portfolio summary: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


async def calculate_and_broadcast_metrics():
    """Background task that calculates portfolio metrics and broadcasts to WebSocket clients"""
    while True:
        try:
            if len(manager.active_connections) > 0:
                # Run database operations in thread pool to avoid blocking
                loop = asyncio.get_event_loop()
                
                # Calculate portfolio summary (same logic as GET endpoint)
                # Run synchronous DB operations in executor
                def calculate_metrics():
                    conn = get_db_connection()
                    conn.row_factory = sqlite3.Row
                    
                    try:
                        # Fetch exchange rate
                        usd_rate = fetch_usd_mkd_rate()
                        
                        # Calculate stock portfolios
                        stock_portfolios = calculate_stock_portfolios(conn)
                        
                        # Calculate KB Funds
                        kb_funds = calculate_kb_funds(conn, usd_rate)
                        
                        # Calculate global summary (combined)
                        total_stock_value = sum(p.current_value for p in stock_portfolios)
                        total_stock_today = sum(p.today_change for p in stock_portfolios)
                        total_stock_ytd = sum(p.ytd_change for p in stock_portfolios)
                        
                        global_current = total_stock_value + kb_funds.current_value
                        global_today = total_stock_today + kb_funds.today_change
                        global_ytd = total_stock_ytd + kb_funds.ytd_change
                        
                        # Calculate percentages for global
                        global_today_percent = 0.0
                        previous_global_value = global_current - global_today
                        if previous_global_value > 0:
                            global_today_percent = (global_today / previous_global_value) * 100
                        
                        global_ytd_percent = 0.0
                        ytd_global_value = global_current - global_ytd
                        if ytd_global_value > 0:
                            global_ytd_percent = (global_ytd / ytd_global_value) * 100
                        
                        header = GlobalSummary(
                            current_value=global_current,
                            today_change=global_today,
                            today_change_percent=global_today_percent,
                            ytd_change=global_ytd,
                            ytd_change_percent=global_ytd_percent
                        )
                        
                        response = PortfolioSummaryResponse(
                            header=header,
                            stock_portfolios=stock_portfolios,
                            kb_funds=kb_funds,
                            timestamp=datetime.now().isoformat()
                        )
                        
                        return response
                    finally:
                        conn.close()
                
                # Execute in thread pool
                response = await loop.run_in_executor(None, calculate_metrics)
                
                # Convert to JSON and broadcast
                json_data = json.dumps(response.model_dump(), default=str)
                await manager.broadcast(json_data)
            
            # Wait 2 seconds before next update
            await asyncio.sleep(2)
            
        except Exception as e:
            print(f"[WebSocket Background] Error calculating metrics: {e}")
            import traceback
            traceback.print_exc()
            # Wait a bit before retrying
            await asyncio.sleep(2)


@app.websocket("/ws/all-metrics")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time portfolio metrics streaming
    Streams complete portfolio summary every 2 seconds to all connected clients
    """
    await manager.connect(websocket)
    
    # Start background task if not already running
    if manager.background_task is None or manager.background_task.done():
        manager.background_task = asyncio.create_task(calculate_and_broadcast_metrics())
        print("[WebSocket] Started background metrics calculation task")
    
    try:
        # Keep connection alive and handle client messages (ping/pong)
        while True:
            try:
                # Wait for any message from client (ping, etc.)
                data = await websocket.receive_text()
                # Echo back or handle ping
                if data == "ping":
                    await websocket.send_text("pong")
            except WebSocketDisconnect:
                break
            except Exception as e:
                print(f"[WebSocket] Error receiving message: {e}")
                break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WebSocket] Connection error: {e}")
    finally:
        manager.disconnect(websocket)
        # Stop background task if no more connections
        if len(manager.active_connections) == 0 and manager.background_task:
            manager.background_task.cancel()
            try:
                await manager.background_task
            except asyncio.CancelledError:
                pass
            manager.background_task = None
            print("[WebSocket] Stopped background metrics calculation task (no connections)")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

