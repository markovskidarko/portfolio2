"""Check what symbols are in live_prices table and how they're stored"""
import sqlite3
from pathlib import Path

db_path = Path(__file__).parent.parent / "data" / "portfolio.db"
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

print("=" * 80)
print("LIVE_PRICES TABLE SYMBOLS")
print("=" * 80)

cursor.execute("SELECT symbol, price, updated_at FROM live_prices ORDER BY symbol")
rows = cursor.fetchall()

print(f"\nTotal symbols in live_prices: {len(rows)}\n")
for symbol, price, updated_at in rows:
    print(f"  {symbol}: ${price:.2f} (updated: {updated_at})")

# Check holdings for U16030763
print("\n" + "=" * 80)
print("HOLDINGS FOR U16030763")
print("=" * 80)

cursor.execute("""
    SELECT symbol, position, mark_price, position_value, fx_rate_to_base
    FROM Holdings
    WHERE account_id = 'U16030763'
    ORDER BY report_date DESC
""")
holdings = cursor.fetchall()

print(f"\nTotal holdings records: {len(holdings)}\n")
for symbol, position, mark_price, position_value, fx_rate in holdings:
    print(f"  {symbol}: {position} shares @ ${mark_price:.2f} = ${position_value:.2f} (fx: {fx_rate})")

conn.close()



