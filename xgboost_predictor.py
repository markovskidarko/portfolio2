"""
XGBoost Portfolio-Level Predictor
Reads daily NAV history from your existing SQLite database,
engineers features, trains XGBoost models per account,
and exposes prediction endpoints via FastAPI.

Install dependencies:
  pip install xgboost scikit-learn pandas numpy fastapi uvicorn

Run standalone:
  python xgboost_predictor.py

Or integrate into mobile_api.py by importing the router.
"""

import sqlite3
import json
import warnings
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

warnings.filterwarnings("ignore")

try:
    import xgboost as xgb
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import TimeSeriesSplit
    from sklearn.metrics import mean_absolute_error, mean_squared_error
    XGBOOST_AVAILABLE = True
except ImportError:
    XGBOOST_AVAILABLE = False
    print("XGBoost not installed. Run: pip install xgboost scikit-learn pandas numpy")

# ─── Config ───────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).parent / "data" / "portfolio.db"
EXCLUDE_ACCOUNTS = {"HUNGARY_MIGRATION_HISTORY"}

# Prediction horizons in trading days
HORIZONS = {
    "5d":  5,
    "10d": 10,
    "21d": 21,
    "63d": 63,
}

MIN_HISTORY_DAYS = 100


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class AccountPrediction(BaseModel):
    account_id: str
    account_alias: str
    current_nav: float
    predictions: dict
    feature_importance: dict
    model_metrics: dict
    data_points: int
    last_training_date: str
    status: str
    message: str


class PortfolioPredictionResponse(BaseModel):
    generated_at: str
    accounts: list[AccountPrediction]
    consolidated: dict
    methodology: str


# ─── Database Helpers ─────────────────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def load_nav_series(account_id: str) -> pd.DataFrame:
    conn = get_connection()
    rows = conn.execute(
        "SELECT date, nav_value FROM DailyNAV WHERE account_id = ? ORDER BY date ASC",
        (account_id,)
    ).fetchall()
    conn.close()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["date", "nav"])
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    df = df[df["nav"] > 0]
    return df


def load_cash_flows(account_id: str) -> pd.DataFrame:
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT date, amount FROM Deposits WHERE account_id = ?
        UNION ALL
        SELECT date, -amount FROM Withdrawals WHERE account_id = ?
        ORDER BY date
        """,
        (account_id, account_id)
    ).fetchall()
    conn.close()

    if not rows:
        return pd.DataFrame(columns=["date", "cash_flow"])

    df = pd.DataFrame(rows, columns=["date", "cash_flow"])
    df["date"] = pd.to_datetime(df["date"])
    df = df.groupby("date")["cash_flow"].sum().reset_index()
    return df


def load_all_accounts() -> list[dict]:
    conn = get_connection()
    rows = conn.execute("SELECT id, alias FROM Accounts").fetchall()
    conn.close()
    return [{"id": r["id"], "alias": r["alias"]} for r in rows
            if r["id"] not in EXCLUDE_ACCOUNTS]


# ─── Feature Engineering ──────────────────────────────────────────────────────

def build_features(nav_df: pd.DataFrame, cash_df: pd.DataFrame) -> pd.DataFrame:
    df = nav_df.copy()

    if not cash_df.empty:
        cf = cash_df.set_index("date")["cash_flow"]
        df["cash_flow"] = cf.reindex(df.index, fill_value=0.0)
    else:
        df["cash_flow"] = 0.0

    df["prev_nav"] = df["nav"].shift(1)
    df["return"] = ((df["nav"] - df["cash_flow"]) / df["prev_nav"].replace(0, np.nan)) - 1
    df["return"] = df["return"].clip(-0.5, 0.5)

    for w in [5, 10, 21, 63]:
        df[f"mom_{w}d"] = df["nav"].pct_change(w)
        df[f"ret_mean_{w}d"] = df["return"].rolling(w, min_periods=w // 2).mean()
        df[f"ret_std_{w}d"]  = df["return"].rolling(w, min_periods=w // 2).std()

    for w in [10, 21, 63]:
        df[f"ma_{w}d"] = df["nav"].rolling(w, min_periods=w // 2).mean()
        df[f"nav_vs_ma_{w}d"] = df["nav"] / df[f"ma_{w}d"] - 1

    delta = df["return"]
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=13, min_periods=14).mean()
    avg_loss = loss.ewm(com=13, min_periods=14).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["rsi_14"] = 100 - (100 / (1 + rs))

    ma20  = df["nav"].rolling(20, min_periods=10).mean()
    std20 = df["nav"].rolling(20, min_periods=10).std()
    df["bb_position"] = (df["nav"] - ma20) / (2 * std20 + 1e-10)

    rolling_max = df["nav"].cummax()
    df["drawdown"] = (df["nav"] - rolling_max) / rolling_max

    df["cf_5d_sum"]  = df["cash_flow"].rolling(5,  min_periods=1).sum()
    df["cf_21d_sum"] = df["cash_flow"].rolling(21, min_periods=1).sum()

    for lag in [1, 2, 3, 5, 10]:
        df[f"ret_lag_{lag}"] = df["return"].shift(lag)

    df["day_of_week"] = df.index.dayofweek
    df["month"]       = df.index.month
    df["quarter"]     = df.index.quarter

    df["log_nav"] = np.log(df["nav"].clip(lower=1))

    df = df.drop(columns=["prev_nav", "cash_flow"])
    return df


def make_targets(df: pd.DataFrame) -> dict:
    targets = {}
    for label, h in HORIZONS.items():
        targets[label] = df["nav"].shift(-h) / df["nav"] - 1
    return targets


FEATURE_COLS = [
    "mom_5d", "mom_10d", "mom_21d", "mom_63d",
    "ret_mean_5d", "ret_mean_10d", "ret_mean_21d", "ret_mean_63d",
    "ret_std_5d",  "ret_std_10d",  "ret_std_21d",  "ret_std_63d",
    "nav_vs_ma_10d", "nav_vs_ma_21d", "nav_vs_ma_63d",
    "rsi_14", "bb_position", "drawdown",
    "cf_5d_sum", "cf_21d_sum",
    "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_5", "ret_lag_10",
    "day_of_week", "month", "quarter",
    "log_nav",
]


# ─── Model Training ───────────────────────────────────────────────────────────

def train_xgboost(X_train: np.ndarray, y_train: np.ndarray):
    model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        min_child_weight=3,
        random_state=42,
        n_jobs=-1,
        verbosity=0,
    )
    model.fit(X_train, y_train)
    return model


def evaluate_model(model, X_test: np.ndarray, y_test: np.ndarray) -> dict:
    preds = model.predict(X_test)
    mae   = float(mean_absolute_error(y_test, preds))
    rmse  = float(np.sqrt(mean_squared_error(y_test, preds)))
    ss_res = np.sum((y_test - preds) ** 2)
    ss_tot = np.sum((y_test - np.mean(y_test)) ** 2)
    r2 = float(1 - ss_res / (ss_tot + 1e-10))
    return {"mae_pct": round(mae * 100, 3), "rmse_pct": round(rmse * 100, 3), "r2": round(r2, 3)}


def confidence_from_r2(r2: float) -> str:
    if r2 > 0.15: return "MEDIUM"
    if r2 > 0.05: return "LOW"
    return "VERY LOW"


# ─── Main Prediction Logic ────────────────────────────────────────────────────

def predict_account(account: dict) -> AccountPrediction:
    account_id    = account["id"]
    account_alias = account["alias"] or account_id

    if not XGBOOST_AVAILABLE:
        return AccountPrediction(
            account_id=account_id, account_alias=account_alias,
            current_nav=0, predictions={}, feature_importance={},
            model_metrics={}, data_points=0, last_training_date="",
            status="error",
            message="XGBoost not installed. Run: pip install xgboost scikit-learn pandas numpy"
        )

    try:
        nav_df  = load_nav_series(account_id)
        cash_df = load_cash_flows(account_id)

        if len(nav_df) < MIN_HISTORY_DAYS:
            return AccountPrediction(
                account_id=account_id, account_alias=account_alias,
                current_nav=float(nav_df["nav"].iloc[-1]) if not nav_df.empty else 0,
                predictions={}, feature_importance={}, model_metrics={},
                data_points=len(nav_df),
                last_training_date=str(nav_df.index[-1].date()) if not nav_df.empty else "",
                status="insufficient_data",
                message=f"Only {len(nav_df)} days of history. Need {MIN_HISTORY_DAYS}+ for reliable predictions."
            )

        feat_df  = build_features(nav_df, cash_df)
        targets  = make_targets(feat_df)

        available_features = [c for c in FEATURE_COLS if c in feat_df.columns]
        X_full = feat_df[available_features]

        current_nav = float(nav_df["nav"].iloc[-1])
        predictions: dict = {}
        all_metrics: list = []
        feature_importance: dict = {}

        for horizon_label, horizon_days in HORIZONS.items():
            y = targets[horizon_label]

            mask    = X_full.notna().all(axis=1) & y.notna()
            X_clean = X_full[mask]
            y_clean = y[mask]

            if len(X_clean) < 50:
                continue

            split_idx = int(len(X_clean) * 0.80)
            X_train, X_test = X_clean.iloc[:split_idx], X_clean.iloc[split_idx:]
            y_train, y_test = y_clean.iloc[:split_idx], y_clean.iloc[split_idx:]

            if len(X_train) < 30 or len(X_test) < 5:
                continue

            model   = train_xgboost(X_train.values, y_train.values)
            metrics = evaluate_model(model, X_test.values, y_test.values)
            all_metrics.append(metrics)

            latest_row = X_full.iloc[[-1]]
            if latest_row.notna().all(axis=1).iloc[0]:
                pred_return = float(model.predict(latest_row.values)[0])
                pred_nav    = current_nav * (1 + pred_return)
                confidence  = confidence_from_r2(metrics["r2"])

                predictions[horizon_label] = {
                    "predicted_nav":        round(pred_nav, 2),
                    "predicted_change_pct": round(pred_return * 100, 2),
                    "confidence":           confidence,
                    "model_r2":             metrics["r2"],
                    "model_mae_pct":        metrics["mae_pct"],
                }

            fi = dict(zip(available_features, model.feature_importances_))
            for k, v in fi.items():
                feature_importance[k] = feature_importance.get(k, 0) + float(v)

        n_models = max(len(predictions), 1)
        feature_importance = {k: round(v / n_models, 4) for k, v in feature_importance.items()}
        feature_importance = dict(
            sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)[:10]
        )

        avg_metrics = {
            "avg_mae_pct":  round(np.mean([m["mae_pct"]  for m in all_metrics]), 3) if all_metrics else 0,
            "avg_rmse_pct": round(np.mean([m["rmse_pct"] for m in all_metrics]), 3) if all_metrics else 0,
            "avg_r2":       round(np.mean([m["r2"]       for m in all_metrics]), 3) if all_metrics else 0,
        }

        return AccountPrediction(
            account_id=account_id,
            account_alias=account_alias,
            current_nav=current_nav,
            predictions=predictions,
            feature_importance=feature_importance,
            model_metrics=avg_metrics,
            data_points=len(nav_df),
            last_training_date=str(nav_df.index[-1].date()),
            status="ok",
            message=f"Trained on {len(nav_df)} trading days."
        )

    except Exception as e:
        return AccountPrediction(
            account_id=account_id, account_alias=account_alias,
            current_nav=0, predictions={}, feature_importance={},
            model_metrics={}, data_points=0, last_training_date="",
            status="error", message=str(e)
        )


# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(title="XGBoost Portfolio Predictor", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "xgboost_available": XGBOOST_AVAILABLE,
        "db_exists": DB_PATH.exists(),
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/predict/all", response_model=PortfolioPredictionResponse)
def predict_all_portfolios():
    accounts = load_all_accounts()
    results  = [predict_account(acc) for acc in accounts]

    consolidated: dict = {}
    for horizon in HORIZONS:
        total_pred    = 0.0
        total_current = 0.0
        count = 0
        for r in results:
            if r.status == "ok" and horizon in r.predictions:
                total_pred    += r.predictions[horizon]["predicted_nav"]
                total_current += r.current_nav
                count += 1
        if count > 0 and total_current > 0:
            change_pct = (total_pred - total_current) / total_current * 100
            consolidated[horizon] = {
                "predicted_total_nav":  round(total_pred, 2),
                "current_total_nav":    round(total_current, 2),
                "predicted_change_pct": round(change_pct, 2),
                "accounts_included":    count,
            }

    return PortfolioPredictionResponse(
        generated_at=datetime.now().isoformat(),
        accounts=results,
        consolidated=consolidated,
        methodology=(
            "XGBoost gradient boosting trained per-account on daily NAV history. "
            "Features: momentum (5/10/21/63d), RSI-14, Bollinger Band position, "
            "drawdown from HWM, cash-flow adjustments, lagged returns, calendar effects. "
            "Train/test: 80/20 time-series split. NOT financial advice."
        )
    )


@app.get("/predict/{account_id}")
def predict_single_account(account_id: str):
    accounts = load_all_accounts()
    account  = next((a for a in accounts if a["id"] == account_id), None)
    if not account:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found")
    return predict_account(account)


@app.get("/features/{account_id}")
def get_features(account_id: str, tail: int = 30):
    nav_df  = load_nav_series(account_id)
    cash_df = load_cash_flows(account_id)
    if nav_df.empty:
        raise HTTPException(status_code=404, detail="No NAV data found")
    feat_df = build_features(nav_df, cash_df)
    available = [c for c in FEATURE_COLS if c in feat_df.columns]
    result = feat_df[["nav", "return"] + available].tail(tail)
    result.index = result.index.astype(str)
    return result.round(6).to_dict(orient="index")


if __name__ == "__main__":
    import uvicorn
    print("Starting XGBoost Portfolio Predictor on http://localhost:8001")
    print("  GET /predict/all           All accounts")
    print("  GET /predict/{account_id}  Single account")
    print("  GET /features/{account_id} Feature inspection")
    print("  GET /health                Status check")
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="warning")
