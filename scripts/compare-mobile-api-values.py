"""Compare mobile API calculated values with database values to debug discrepancies"""
import sqlite3
from pathlib import Path

db_path = Path(__file__).parent.parent / "data" / "portfolio.db"
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

print("=" * 80)
print("COMPARING MOBILE API CALCULATION WITH DATABASE")
print("=" * 80)

account_id = "U16030763"

# Get holdings
cursor.execute("""
    SELECT h.symbol, h.position, h.fx_rate_to_base, h.mark_price, h.position_value, h.report_date
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
    ORDER BY h.symbol
""", (account_id, account_id))
holdings = cursor.fetchall()

print(f"\nHoldings for {account_id}:")
print("-" * 80)

symbol_map = {
    'SMH': 'SMH.L',
    'EQQQ': 'EQQQ.SW',
    'EQQU': 'EQQQ.SW',
    'IUIT': 'IUIT.L',
    'VUSD': 'VUSD.L',
}

# Test deduplication logic (same as mobile API)
deduplicated_holdings = {}
for symbol, position, fx_rate, mark_price, position_value, report_date in holdings:
    normalized = symbol.upper()
    if normalized == 'EQQU':
        normalized = 'EQQQ'
    
    if normalized not in deduplicated_holdings:
        deduplicated_holdings[normalized] = (symbol, position, fx_rate, mark_price, position_value)
    else:
        existing = deduplicated_holdings[normalized]
        existing_value = existing[4]
        if position_value > existing_value:
            deduplicated_holdings[normalized] = (symbol, position, fx_rate, mark_price, position_value)

print(f"\nAfter deduplication: {len(deduplicated_holdings)} unique holdings")
print("-" * 80)

total_from_mark_price = 0
total_from_live_prices = 0

for normalized, (symbol, position, fx_rate, mark_price, position_value) in deduplicated_holdings.items():
    yahoo_symbol = symbol_map.get(normalized, normalized)
    
    # Get live price
    cursor.execute("SELECT price FROM live_prices WHERE symbol = ?", (yahoo_symbol,))
    live_price_result = cursor.fetchone()
    live_price = live_price_result[0] if live_price_result else None
    
    value_from_mark = position * mark_price * fx_rate
    value_from_live = position * live_price * fx_rate if live_price else None
    
    total_from_mark_price += value_from_mark
    if value_from_live:
        total_from_live_prices += value_from_live
    
    print(f"\n{normalized} (original: {symbol}, yahoo: {yahoo_symbol}):")
    print(f"  Position: {position} shares")
    print(f"  FX Rate: {fx_rate}")
    print(f"  Mark Price (DB): ${mark_price:.2f}")
    print(f"  Live Price (cache): ${live_price:.2f}" if live_price else "  Live Price (cache): NOT FOUND")
    print(f"  Value from Mark Price: ${value_from_mark:.2f}")
    print(f"  Value from Live Price: ${value_from_live:.2f}" if value_from_live else "  Value from Live Price: N/A")
    print(f"  Difference: ${(value_from_live - value_from_mark):.2f}" if value_from_live else "  Difference: N/A")

# Get cash
cursor.execute("""
    SELECT amount * fx_rate_to_base
    FROM Cash
    WHERE account_id = ?
    ORDER BY report_date DESC
    LIMIT 1
""", (account_id,))
cash_result = cursor.fetchone()
cash_value = cash_result[0] if cash_result and cash_result[0] else 0.0

print("\n" + "=" * 80)
print("TOTALS:")
print("=" * 80)
print(f"Cash: ${cash_value:.2f}")
print(f"Total from Mark Prices: ${total_from_mark_price:.2f}")
print(f"Total from Live Prices: ${total_from_live_prices:.2f}")
print(f"Grand Total (Mark): ${cash_value + total_from_mark_price:.2f}")
print(f"Grand Total (Live): ${cash_value + total_from_live_prices:.2f}")

# Get latest NAV
cursor.execute("""
    SELECT nav_value FROM DailyNAV 
    WHERE account_id = ? 
    ORDER BY date DESC 
    LIMIT 1
""", (account_id,))
nav_result = cursor.fetchone()
latest_nav = nav_result[0] if nav_result and nav_result[0] else 0.0

print(f"\nLatest DailyNAV: ${latest_nav:.2f}")
print(f"Expected (from dashboard): $171,482.87")

conn.close()

