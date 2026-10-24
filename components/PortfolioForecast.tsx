"use client";

import React, { useState } from "react";
import { cn, formatCurrency } from "@/lib/utils";
import type { AggregatedData } from "@/lib/types";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Zap, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface ForecastScenario {
  probability: number;
  trigger: string;
  navImpact: string;
  keyDriver: string;
}

interface ForecastData {
  headline: string;
  overallOutlook: "BULLISH" | "NEUTRAL" | "BEARISH";
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  scenarios: {
    bull: ForecastScenario;
    base: ForecastScenario;
    bear: ForecastScenario;
  };
  keyRisks: Array<{ risk: string; severity: "HIGH" | "MEDIUM" | "LOW"; affectedHoldings: string[] }>;
  catalysts: Array<{ catalyst: string; timeframe: string; affectedHoldings: string[] }>;
  concentrationWarnings: string[];
  rebalancingSuggestion: string;
  monteCarloInterpretation: string;
  forecastHorizon: string;
  disclaimer: string;
}

interface PortfolioForecastProps {
  data: AggregatedData | null;
  portfolioLabel?: string;
  monteCarloSummary?: {
    p5: number; p25: number; p50: number; p75: number; p95: number;
  } | null;
  riskMetrics?: {
    sharpeRatio?: number; sortinoRatio?: number;
    annualizedVolatility?: number; maxDrawdown?: number;
    beta?: number | null; var95?: number; var99?: number;
  } | null;
}

const HORIZON_OPTIONS = [
  { value: "1M", label: "1 Month" },
  { value: "3M", label: "3 Months" },
  { value: "6M", label: "6 Months" },
  { value: "12M", label: "1 Year" },
];

export default function PortfolioForecast({
  data,
  portfolioLabel = "Portfolio",
  monteCarloSummary,
  riskMetrics,
}: PortfolioForecastProps) {
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState("3M");
  const [expanded, setExpanded] = useState(true);

  const generateForecast = async () => {
    if (!data) return;
    setLoading(true);
    setError(null);

    const equityCurve = data.equityCurve || [];
    const lastPoint = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : null;
    const twr = lastPoint?.cumulativeReturn ?? 0;
    const simpleReturn = data.netDeposits > 0
      ? ((data.totalNAV - data.netDeposits) / Math.abs(data.netDeposits)) * 100
      : 0;

    try {
      const res = await fetch("/api/claude-forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioLabel,
          holdings: data.combinedPositions,
          totalNAV: data.totalNAV,
          netDeposits: data.netDeposits,
          twr,
          simpleReturn,
          annualizedReturn: data.annualizedYield,
          feesAndIncome: data.feesAndIncome,
          riskMetrics,
          monteCarloSummary,
          horizon,
        }),
      });

      const result = await res.json();
      if (result.error) {
        setError(result.error);
      } else {
        setForecast(result.forecast);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const outlookConfig = {
    BULLISH: { color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/30", icon: TrendingUp },
    NEUTRAL: { color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30", icon: Minus },
    BEARISH: { color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30", icon: TrendingDown },
  };

  const severityColor = { HIGH: "text-red-500", MEDIUM: "text-amber-500", LOW: "text-green-500" };
  const severityBg = { HIGH: "bg-red-500/10", MEDIUM: "bg-amber-500/10", LOW: "bg-green-500/10" };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">AI Portfolio Forecast</h3>
            <p className="text-xs text-muted-foreground">Claude-powered scenario analysis</p>
          </div>
          {forecast && (
            <span className={cn(
              "ml-2 text-xs font-medium px-2 py-0.5 rounded-full border",
              outlookConfig[forecast.overallOutlook].color,
              outlookConfig[forecast.overallOutlook].bg,
              outlookConfig[forecast.overallOutlook].border
            )}>
              {forecast.overallOutlook}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </div>

      {expanded && (
        <div className="px-6 pb-6">
          {/* Controls */}
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <span className="text-sm text-muted-foreground">Forecast horizon:</span>
            <div className="flex gap-1">
              {HORIZON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setHorizon(opt.value)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                    horizon === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={generateForecast}
              disabled={loading || !data}
              className={cn(
                "ml-auto flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              )}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              {loading ? "Analyzing..." : forecast ? "Refresh Forecast" : "Generate Forecast"}
            </button>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          {!forecast && !loading && (
            <div className="text-center py-10 text-muted-foreground">
              <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Click "Generate Forecast" to get an AI-powered scenario analysis for this portfolio</p>
              <p className="text-xs mt-1 opacity-60">Uses your actual holdings, risk metrics, and Monte Carlo data</p>
            </div>
          )}

          {forecast && (
            <div className="space-y-5">
              {/* Headline + Outlook */}
              <div className={cn(
                "rounded-lg p-4 border",
                outlookConfig[forecast.overallOutlook].bg,
                outlookConfig[forecast.overallOutlook].border
              )}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className={cn("font-semibold text-base", outlookConfig[forecast.overallOutlook].color)}>
                      {forecast.headline}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Confidence: {forecast.confidenceLevel} · Horizon: {forecast.forecastHorizon}
                    </p>
                  </div>
                  {(() => {
                    const Icon = outlookConfig[forecast.overallOutlook].icon;
                    return <Icon className={cn("h-6 w-6 flex-shrink-0", outlookConfig[forecast.overallOutlook].color)} />;
                  })()}
                </div>
              </div>

              {/* Scenarios */}
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Scenario analysis</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Bull */}
                  <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold text-green-500 uppercase tracking-wide">Bull case</span>
                      <span className="text-xs font-bold text-green-500">{forecast.scenarios.bull.probability}%</span>
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">{forecast.scenarios.bull.navImpact}</p>
                    <p className="text-xs text-muted-foreground mb-1">{forecast.scenarios.bull.trigger}</p>
                    <p className="text-xs text-green-600 font-medium">Driver: {forecast.scenarios.bull.keyDriver}</p>
                  </div>
                  {/* Base */}
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Base case</span>
                      <span className="text-xs font-bold text-blue-500">{forecast.scenarios.base.probability}%</span>
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">{forecast.scenarios.base.navImpact}</p>
                    <p className="text-xs text-muted-foreground mb-1">{forecast.scenarios.base.trigger}</p>
                    <p className="text-xs text-blue-600 font-medium">Driver: {forecast.scenarios.base.keyDriver}</p>
                  </div>
                  {/* Bear */}
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Bear case</span>
                      <span className="text-xs font-bold text-red-500">{forecast.scenarios.bear.probability}%</span>
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">{forecast.scenarios.bear.navImpact}</p>
                    <p className="text-xs text-muted-foreground mb-1">{forecast.scenarios.bear.trigger}</p>
                    <p className="text-xs text-red-600 font-medium">Driver: {forecast.scenarios.bear.keyDriver}</p>
                  </div>
                </div>
              </div>

              {/* Monte Carlo Interpretation */}
              {forecast.monteCarloInterpretation && (
                <div className="rounded-lg bg-muted/40 border border-border px-4 py-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Monte Carlo interpretation</p>
                  <p className="text-sm text-foreground leading-relaxed">{forecast.monteCarloInterpretation}</p>
                </div>
              )}

              {/* Risks + Catalysts side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Key Risks */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-amber-500" /> Key risks
                  </h4>
                  <div className="space-y-2">
                    {forecast.keyRisks.map((r, i) => (
                      <div key={i} className={cn("rounded-lg px-3 py-2 border", severityBg[r.severity], "border-border")}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={cn("text-xs font-semibold uppercase", severityColor[r.severity])}>{r.severity}</span>
                          <span className="text-xs text-muted-foreground">{r.affectedHoldings.join(", ")}</span>
                        </div>
                        <p className="text-xs text-foreground">{r.risk}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Catalysts */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 text-green-500" /> Catalysts
                  </h4>
                  <div className="space-y-2">
                    {forecast.catalysts.map((c, i) => (
                      <div key={i} className="rounded-lg px-3 py-2 border border-green-500/20 bg-green-500/5">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-semibold text-green-500">{c.timeframe}</span>
                          <span className="text-xs text-muted-foreground">{c.affectedHoldings.join(", ")}</span>
                        </div>
                        <p className="text-xs text-foreground">{c.catalyst}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Concentration warnings */}
              {forecast.concentrationWarnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-600 mb-1">Concentration warnings</p>
                  {forecast.concentrationWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-foreground">{w}</p>
                  ))}
                </div>
              )}

              {/* Rebalancing suggestion */}
              {forecast.rebalancingSuggestion && (
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
                  <p className="text-xs font-semibold text-blue-500 mb-1">Rebalancing suggestion</p>
                  <p className="text-xs text-foreground">{forecast.rebalancingSuggestion}</p>
                </div>
              )}

              {/* Disclaimer */}
              <p className="text-xs text-muted-foreground opacity-60">{forecast.disclaimer}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
