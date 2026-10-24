export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an institutional portfolio analyst. You receive structured data about a real portfolio including holdings, risk metrics, Monte Carlo projections, and performance history. Your job is to generate a professional, quantitative forecast narrative.

Your response must be a valid JSON object with this exact structure (no markdown, no preamble):
{
  "headline": "One-line summary of the portfolio outlook (max 15 words)",
  "overallOutlook": "BULLISH" | "NEUTRAL" | "BEARISH",
  "confidenceLevel": "LOW" | "MEDIUM" | "HIGH",
  "scenarios": {
    "bull": {
      "probability": number (0-100),
      "trigger": "What would cause this (1 sentence)",
      "navImpact": "e.g. +18% to +25%",
      "keyDriver": "Primary holding or factor"
    },
    "base": {
      "probability": number (0-100),
      "trigger": "What would cause this (1 sentence)",
      "navImpact": "e.g. +8% to +14%",
      "keyDriver": "Primary holding or factor"
    },
    "bear": {
      "probability": number (0-100),
      "trigger": "What would cause this (1 sentence)",
      "navImpact": "e.g. -12% to -20%",
      "keyDriver": "Primary holding or factor"
    }
  },
  "keyRisks": [
    { "risk": "Risk description (1 sentence)", "severity": "HIGH" | "MEDIUM" | "LOW", "affectedHoldings": ["TICKER1"] },
    { "risk": "...", "severity": "...", "affectedHoldings": ["..."] },
    { "risk": "...", "severity": "...", "affectedHoldings": ["..."] }
  ],
  "catalysts": [
    { "catalyst": "Positive catalyst (1 sentence)", "timeframe": "1M" | "3M" | "6M" | "12M", "affectedHoldings": ["TICKER1"] },
    { "catalyst": "...", "timeframe": "...", "affectedHoldings": ["..."] }
  ],
  "concentrationWarnings": ["Warning if any position >25% of NAV", "..."],
  "rebalancingSuggestion": "One concrete rebalancing suggestion based on current weights",
  "monteCarloInterpretation": "2-3 sentence plain-English interpretation of what the Monte Carlo cone means for this specific portfolio",
  "forecastHorizon": "1M" | "3M" | "6M" | "12M",
  "disclaimer": "Short disclaimer"
}`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      portfolioLabel,
      holdings,
      totalNAV,
      netDeposits,
      twr,
      simpleReturn,
      annualizedReturn,
      riskMetrics,
      monteCarloSummary,
      feesAndIncome,
      horizon = "3M",
    } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    // Build a compact but rich context for Claude
    const holdingsList = (holdings || [])
      .filter((h: { isCash?: boolean }) => !h.isCash)
      .sort((a: { totalValue: number }, b: { totalValue: number }) => b.totalValue - a.totalValue)
      .slice(0, 15)
      .map((h: { symbol: string; description: string; totalValue: number; totalPercentOfNAV: number; totalUnrealizedPnl: number; totalCostBasis: number }) => {
        const pnlPct = h.totalCostBasis > 0
          ? ((h.totalUnrealizedPnl / h.totalCostBasis) * 100).toFixed(1)
          : "0.0";
        return `  ${h.symbol} (${h.description}): $${h.totalValue.toLocaleString()} | ${h.totalPercentOfNAV.toFixed(1)}% NAV | P&L: ${pnlPct}%`;
      })
      .join("\n");

    const riskSummary = riskMetrics ? `
Risk Metrics:
  Sharpe Ratio: ${riskMetrics.sharpeRatio?.toFixed(2) ?? "N/A"}
  Sortino Ratio: ${riskMetrics.sortinoRatio?.toFixed(2) ?? "N/A"}
  Annualized Volatility: ${riskMetrics.annualizedVolatility ? (riskMetrics.annualizedVolatility * 100).toFixed(1) + "%" : "N/A"}
  Max Drawdown: ${riskMetrics.maxDrawdown ? (riskMetrics.maxDrawdown * 100).toFixed(1) + "%" : "N/A"}
  Beta (vs S&P500): ${riskMetrics.beta?.toFixed(2) ?? "N/A"}
  VaR 95%: ${riskMetrics.var95 ? (riskMetrics.var95 * 100).toFixed(2) + "%" : "N/A"}
  VaR 99%: ${riskMetrics.var99 ? (riskMetrics.var99 * 100).toFixed(2) + "%" : "N/A"}` : "";

    const mcSummary = monteCarloSummary ? `
Monte Carlo Projections (${horizon} horizon):
  Bear Case (5th pct): ${monteCarloSummary.p5 ? "$" + monteCarloSummary.p5.toLocaleString() : "N/A"}
  Lower Quartile (25th): ${monteCarloSummary.p25 ? "$" + monteCarloSummary.p25.toLocaleString() : "N/A"}
  Median (50th): ${monteCarloSummary.p50 ? "$" + monteCarloSummary.p50.toLocaleString() : "N/A"}
  Upper Quartile (75th): ${monteCarloSummary.p75 ? "$" + monteCarloSummary.p75.toLocaleString() : "N/A"}
  Bull Case (95th pct): ${monteCarloSummary.p95 ? "$" + monteCarloSummary.p95.toLocaleString() : "N/A"}` : "";

    const userPrompt = `Analyze this portfolio and generate a forecast:

Portfolio: ${portfolioLabel || "Portfolio"}
Current NAV: $${totalNAV?.toLocaleString() ?? "N/A"}
Net Contributions: $${netDeposits?.toLocaleString() ?? "N/A"}
Total Return (TWR): ${twr?.toFixed(2) ?? "N/A"}%
Simple Return: ${simpleReturn?.toFixed(2) ?? "N/A"}%
Annualized Return (CAGR): ${annualizedReturn?.toFixed(2) ?? "N/A"}%
Forecast Horizon: ${horizon}

Holdings (by value):
${holdingsList || "  No positions data"}

Income & Fees:
  Dividends: $${feesAndIncome?.totalDividends?.toLocaleString() ?? "0"}
  Interest: $${feesAndIncome?.totalInterest?.toLocaleString() ?? "0"}
  Commissions: -$${feesAndIncome?.totalCommissions?.toLocaleString() ?? "0"}
  Net Profit: $${feesAndIncome?.netProfit?.toLocaleString() ?? "0"}
${riskSummary}
${mcSummary}

Today's date: ${new Date().toISOString().split("T")[0]}

Return ONLY the JSON object. No markdown. No preamble.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return NextResponse.json({ error: err.error?.message || "Claude API error" }, { status: response.status });
    }

    const data = await response.json();
    const raw = data.content?.map((b: { text?: string }) => b.text || "").join("") || "";

    try {
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      return NextResponse.json({ forecast: parsed });
    } catch {
      return NextResponse.json({ error: "Failed to parse forecast JSON", raw: raw.slice(0, 500) }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

