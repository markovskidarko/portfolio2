import type { AggregatedData } from "./types";

export function buildPortfolioContext(data: AggregatedData, accountLabel: string = "All Portfolios"): string {
  const today = new Date().toISOString().split("T")[0];
  const curve = data.equityCurve;
  const lastPoint = curve.length > 0 ? curve[curve.length - 1] : null;
  const twr = lastPoint?.cumulativeReturn ?? 0;
  const simpleReturn = data.netDeposits > 0
    ? ((data.totalNAV - data.netDeposits) / Math.abs(data.netDeposits)) * 100
    : 0;

  const topHoldings = data.combinedPositions
    .filter((p) => !p.isCash && p.totalValue > 0)
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 20)
    .map((p) => {
      const pnlPct = p.totalCostBasis > 0
        ? ((p.totalUnrealizedPnl / p.totalCostBasis) * 100).toFixed(1)
        : "0.0";
      return `  - ${p.symbol} (${p.description}): $${p.totalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} | ${p.totalPercentOfNAV.toFixed(1)}% of NAV | Unrealized P&L: $${p.totalUnrealizedPnl.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${pnlPct}%)`;
    })
    .join("\n");

  const cashPositions = data.combinedPositions
    .filter((p) => p.isCash && p.totalValue > 0)
    .map((p) => `  - ${p.symbol}: $${p.totalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`)
    .join("\n");

  const accountBreakdown = data.accounts
    .map((acc) => {
      const nav = acc.openPositions.reduce((s, p) => s + p.positionValue, 0);
      return `  - ${acc.accountAlias} (${acc.accountId}): ~$${nav.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    })
    .join("\n");

  const recentCurve = curve
    .slice(-30)
    .map((p) => {
      const d = p.date instanceof Date ? p.date : new Date(p.date);
      return `  ${d.toISOString().split("T")[0]}: NAV=$${p.nav.toLocaleString("en-US", { maximumFractionDigits: 0 })} | TWR=${p.cumulativeReturn.toFixed(2)}%`;
    })
    .join("\n");

  return `PORTFOLIO SNAPSHOT — ${accountLabel}
Date: ${today}

=== OVERVIEW ===
Total NAV: $${data.totalNAV.toLocaleString("en-US", { maximumFractionDigits: 0 })}
Net Contributions: $${data.netDeposits.toLocaleString("en-US", { maximumFractionDigits: 0 })}
Total Profit/Loss: $${(data.totalNAV - data.netDeposits).toLocaleString("en-US", { maximumFractionDigits: 0 })}
Time-Weighted Return (TWR): ${twr.toFixed(2)}%
Simple Return: ${simpleReturn.toFixed(2)}%
Annualized Return (CAGR): ${data.annualizedYield?.toFixed(2) ?? "N/A"}%
Number of Accounts: ${data.accounts.length}

=== INCOME & FEES ===
Dividends: $${data.feesAndIncome.totalDividends.toLocaleString("en-US", { maximumFractionDigits: 0 })}
Interest: $${data.feesAndIncome.totalInterest.toLocaleString("en-US", { maximumFractionDigits: 0 })}
Commissions: -$${data.feesAndIncome.totalCommissions.toLocaleString("en-US", { maximumFractionDigits: 0 })}
Withholding Tax: -$${data.feesAndIncome.totalWithholdingTax.toLocaleString("en-US", { maximumFractionDigits: 0 })}
Net Profit: $${data.feesAndIncome.netProfit.toLocaleString("en-US", { maximumFractionDigits: 0 })}

=== ACCOUNT BREAKDOWN ===
${accountBreakdown || "  No accounts loaded"}

=== TOP HOLDINGS ===
${topHoldings || "  No positions"}

=== CASH POSITIONS ===
${cashPositions || "  No cash positions"}

=== RECENT EQUITY CURVE (last 30 days) ===
${recentCurve || "  No history available"}
`;
}
