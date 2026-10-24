import sqlite3
import sys


def map_symbol(symbol: str) -> str:
    s = (symbol or "").upper()
    return {
        "SMH": "SMH.L",
        "EQQU": "EQQQ.SW",
        "EQQQ": "EQQQ.SW",
        "IUIT": "IUIT.L",
        "VUSD": "VUSD.L",
    }.get(s, symbol)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python scripts/nav_breakdown_account.py <ACCOUNT_ID>")

    account_id = sys.argv[1]
    conn = sqlite3.connect("data/portfolio.db")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    latest_report_date = cur.execute(
        "SELECT MAX(report_date) AS md FROM Holdings WHERE account_id = ?",
        (account_id,),
    ).fetchone()["md"]

    print(f"Account: {account_id}")
    print(f"Latest holdings report_date: {latest_report_date}")

    rows = cur.execute(
        """
        SELECT symbol, position, fx_rate_to_base, mark_price, position_value
        FROM Holdings
        WHERE account_id = ? AND report_date = ?
        ORDER BY symbol
        """,
        (account_id, latest_report_date),
    ).fetchall()

    total_positions = 0.0
    print("\nPositions:")
    for row in rows:
        symbol = row["symbol"]
        qty = float(row["position"] or 0)
        fx = float(row["fx_rate_to_base"] or 1)
        mark_price = float(row["mark_price"] or 0)
        position_value = float(row["position_value"] or 0)

        mapped = map_symbol(symbol)
        lp = cur.execute(
            "SELECT price, updated_at FROM live_prices WHERE symbol = ?",
            (mapped,),
        ).fetchone()

        if lp is not None:
            used_price = float(lp["price"] or 0)
            value_usd = qty * used_price * fx
            source = f"live_prices[{mapped}]"
            updated = lp["updated_at"]
        else:
            used_price = mark_price
            value_usd = position_value
            source = "fallback(mark/position_value)"
            updated = "-"

        total_positions += value_usd
        print(
            f"- {symbol}: qty={qty:.4f}, fx={fx:.4f}, "
            f"used_price={used_price:.6f}, value={value_usd:.2f} USD, "
            f"source={source}, price_updated={updated}"
        )

    cash_row = cur.execute(
        """
        SELECT amount, fx_rate_to_base, report_date
        FROM Cash
        WHERE account_id = ?
        ORDER BY report_date DESC
        LIMIT 1
        """,
        (account_id,),
    ).fetchone()

    if cash_row:
        cash_amount = float(cash_row["amount"] or 0)
        cash_fx = float(cash_row["fx_rate_to_base"] or 1)
        cash_value = cash_amount * cash_fx
        print(
            f"\nCash: amount={cash_amount:.2f}, fx={cash_fx:.4f}, "
            f"value={cash_value:.2f} USD, report_date={cash_row['report_date']}"
        )
    else:
        cash_value = 0.0
        print("\nCash: none (0.00 USD)")

    print(f"\nTotal NAV (positions + cash): {total_positions + cash_value:.2f} USD")
    conn.close()


if __name__ == "__main__":
    main()

