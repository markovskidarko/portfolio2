"""
Update holdings for IBKR account U16030763 in SQLite DB.

Use-case:
- Sold all: EQQQ, VUSD, IUIT
- New total holding: 2081 shares of SMH.L

This script edits data/portfolio.db directly (via sqlite3) so it works even if
better-sqlite3 native bindings are currently mismatched.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from datetime import datetime


ACCOUNT_ID = "U16030763"
TARGET_SYMBOL = "SMH.L"
TARGET_POSITION = 2081.0

# Bases we want to remove from the *latest* holdings snapshot for the account.
# Includes IBKR variants like EQQU for EQQQ.
REMOVE_LATEST_BASE_PREFIXES = ["EQQQ", "EQQU", "VUSD", "IUIT"]
REMOVE_LATEST_EXACT = ["SMH"]  # remove SMH (but not SMH.L)


def main() -> None:
    db_path = Path(__file__).parent.parent / "data" / "portfolio.db"
    if not db_path.exists():
        raise SystemExit(f"DB not found at {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Choose the most recent report_date we have for this account's holdings.
    row = cur.execute(
        "SELECT MAX(report_date) AS max_report_date FROM Holdings WHERE account_id = ?",
        (ACCOUNT_ID,),
    ).fetchone()

    report_date = row["max_report_date"] if row else None
    if not report_date:
        raise SystemExit(
            f"No holdings found for {ACCOUNT_ID}. Run a sync/ingestion first to create Holdings rows."
        )

    removed = 0

    # Remove sold symbols from their latest snapshot (per-symbol MAX(report_date)),
    # since older rows can still be selected by "latest per symbol" queries.
    for base in REMOVE_LATEST_BASE_PREFIXES:
        # Find latest report_date for any symbol matching this base prefix.
        latest = cur.execute(
            """
            SELECT MAX(report_date) AS max_date
            FROM Holdings
            WHERE account_id = ?
              AND UPPER(symbol) LIKE ?
            """,
            (ACCOUNT_ID, f"{base.upper()}%"),
        ).fetchone()
        max_date = latest["max_date"] if latest else None
        if not max_date:
            continue

        res = cur.execute(
            """
            DELETE FROM Holdings
            WHERE account_id = ?
              AND report_date = ?
              AND UPPER(symbol) LIKE ?
            """,
            (ACCOUNT_ID, max_date, f"{base.upper()}%"),
        )
        removed += res.rowcount or 0

    for sym in REMOVE_LATEST_EXACT:
        latest = cur.execute(
            """
            SELECT MAX(report_date) AS max_date
            FROM Holdings
            WHERE account_id = ?
              AND UPPER(symbol) = UPPER(?)
            """,
            (ACCOUNT_ID, sym),
        ).fetchone()
        max_date = latest["max_date"] if latest else None
        if not max_date:
            continue

        res = cur.execute(
            """
            DELETE FROM Holdings
            WHERE account_id = ?
              AND report_date = ?
              AND UPPER(symbol) = UPPER(?)
            """,
            (ACCOUNT_ID, max_date, sym),
        )
        removed += res.rowcount or 0

    # Upsert SMH.L for that same report_date. Keep pricing fields at 0 so live pricing can take over.
    # Schema: Holdings(account_id, symbol, description, position, mark_price, position_value,
    #                 cost_basis_money, fifo_pnl_unrealized, percent_of_nav, currency, fx_rate_to_base,
    #                 conid, report_date, created_at)
    #
    # Note: There is a UNIQUE(account_id, symbol, report_date) constraint.
    cur.execute(
        """
        INSERT INTO Holdings (
          account_id, symbol, description,
          position, mark_price, position_value,
          cost_basis_money, fifo_pnl_unrealized, percent_of_nav,
          currency, fx_rate_to_base, conid,
          report_date, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(account_id, symbol, report_date) DO UPDATE SET
          description = excluded.description,
          position = excluded.position,
          mark_price = excluded.mark_price,
          position_value = excluded.position_value,
          cost_basis_money = excluded.cost_basis_money,
          fifo_pnl_unrealized = excluded.fifo_pnl_unrealized,
          percent_of_nav = excluded.percent_of_nav,
          currency = excluded.currency,
          fx_rate_to_base = excluded.fx_rate_to_base,
          conid = excluded.conid,
          created_at = CURRENT_TIMESTAMP
        """,
        (
            ACCOUNT_ID,
            TARGET_SYMBOL,
            "Manual override (local)",
            float(TARGET_POSITION),
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            "USD",
            1.0,
            None,
            report_date,
        ),
    )

    # Show resulting holdings for that report_date
    rows = cur.execute(
        """
        SELECT symbol, position, mark_price, position_value, currency, fx_rate_to_base
        FROM Holdings
        WHERE account_id = ? AND report_date = ?
        ORDER BY symbol
        """,
        (ACCOUNT_ID, report_date),
    ).fetchall()

    conn.commit()
    conn.close()

    print(f"[OK] Updated holdings for {ACCOUNT_ID} @ report_date={report_date}")
    print(f"[OK] Removed rows: {removed}")
    print("[OK] Current holdings rows for that report_date:")
    for r in rows:
        print(
            f"  - {r['symbol']}: {r['position']} | mark={r['mark_price']} | value={r['position_value']} {r['currency']} | fx={r['fx_rate_to_base']}"
        )


if __name__ == "__main__":
    main()

