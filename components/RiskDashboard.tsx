"use client";

import React from "react";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import { format } from "date-fns";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export interface RiskMetrics {
  annualizedReturn: number;
  annualizedVolatility: number;
  annualizedDownsideVolatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  treynorRatio: number;
  beta: number | null;
  maxDrawdown: number;
  maxDrawdownStartDate: string | Date | null; // ISO string from API
  maxDrawdownEndDate: string | Date | null; // ISO string from API
  maxDrawdownPeakNav: number | null;
  maxDrawdownTroughNav: number | null;
  drawdownSeries: Array<{
    date: string | Date; // ISO string from API
    drawdown: number; // Negative value (e.g., -0.15 = -15%)
    peakDate: string | Date; // ISO string from API
    peakNav: number;
  }>;
  var95: number;
  var99: number;
  var95Dollar: number;
  var99Dollar: number;
  recoveryAnalytics?: {
    drawdownPeriods: Array<{
      peakDate: string | Date;
      peakValue: number;
      troughDate: string | Date;
      troughValue: number;
      recoveryDate: string | Date | null;
      duration: number;
      drawdownPercent: number;
    }>;
    averageRecoveryTime: number | null;
    currentRecoveryStatus: {
      isInDrawdown: boolean;
      currentDrawdown: any | null;
      daysSincePeak: number | null;
    };
  };
}

interface RiskDashboardProps {
  riskMetrics: RiskMetrics | null;
  loading?: boolean;
  isMobile?: boolean;
}

const RiskDashboard: React.FC<RiskDashboardProps> = ({ riskMetrics, loading = false, isMobile = false }) => {
  if (loading) {
    return (
      <div>
        <div className="text-center text-muted-foreground py-8">
          Calculating risk metrics...
        </div>
      </div>
    );
  }

  if (!riskMetrics) {
    return (
      <div>
        <div className="text-center text-muted-foreground py-8">
          No risk data available. Please ensure you have sufficient historical data.
        </div>
      </div>
    );
  }

  // Prepare drawdown chart data (convert to positive percentages for visualization)
  // Handle dates as either Date objects or ISO strings (from API)
  const drawdownChartData = riskMetrics.drawdownSeries.map(point => {
    const date = point.date instanceof Date ? point.date : new Date(point.date);
    return {
      date: date.getTime(),
      dateLabel: format(date, 'MMM dd, yyyy'),
      drawdown: point.drawdown * 100, // Convert to percentage (negative value)
      drawdownAbs: Math.abs(point.drawdown * 100), // Absolute value for chart height
    };
  });

  const maxDrawdownAbs = Math.abs(riskMetrics.maxDrawdown * 100);

  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground mb-6">Risk Analytics (v4.0)</h2>

      {/* Risk Metrics Grid */}
      <div className={cn(
        "grid gap-4 mb-8",
        isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-4"
      )}>
        {/* Sharpe Ratio */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Annualized Sharpe</div>
          <div className="text-2xl font-bold text-foreground">
            {riskMetrics.sharpeRatio.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Risk-free: 4.0%
          </div>
        </div>

        {/* Sortino Ratio */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Annualized Sortino</div>
          <div className="text-2xl font-bold text-foreground">
            {riskMetrics.sortinoRatio.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Downside only
          </div>
        </div>

        {/* Max Drawdown */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Max Drawdown</div>
          <div className="text-2xl font-bold text-red-500">
            {(riskMetrics.maxDrawdown * 100).toFixed(2)}%
          </div>
          {riskMetrics.maxDrawdownStartDate && riskMetrics.maxDrawdownEndDate && (
            <div className="text-xs text-muted-foreground mt-1">
              {format(
                riskMetrics.maxDrawdownStartDate instanceof Date 
                  ? riskMetrics.maxDrawdownStartDate 
                  : new Date(riskMetrics.maxDrawdownStartDate), 
                'MMM dd'
              )} - {
                format(
                  riskMetrics.maxDrawdownEndDate instanceof Date 
                    ? riskMetrics.maxDrawdownEndDate 
                    : new Date(riskMetrics.maxDrawdownEndDate), 
                  'MMM dd'
                )
              }
            </div>
          )}
        </div>

        {/* 1-Day VaR (95%) */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">1-Day VaR (95%)</div>
          <div className="text-2xl font-bold text-red-500">
            {(riskMetrics.var95 * 100).toFixed(2)}%
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatCurrency(riskMetrics.var95Dollar)}
          </div>
        </div>
      </div>

      {/* Additional Metrics Row */}
      <div className={cn(
        "grid gap-4 mb-8",
        isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-4"
      )}>
        {/* Annualized Return */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Annualized Return</div>
          <div className={cn(
            "text-xl font-semibold",
            riskMetrics.annualizedReturn >= 0 ? "text-green-500" : "text-red-500"
          )}>
            {riskMetrics.annualizedReturn >= 0 ? "+" : ""}{(riskMetrics.annualizedReturn * 100).toFixed(2)}%
          </div>
        </div>

        {/* Annualized Volatility */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Annualized Volatility</div>
          <div className="text-xl font-semibold text-foreground">
            {(riskMetrics.annualizedVolatility * 100).toFixed(2)}%
          </div>
        </div>

        {/* Beta */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Beta (vs S&P 500)</div>
          <div className="text-xl font-semibold text-foreground">
            {riskMetrics.beta !== null ? riskMetrics.beta.toFixed(2) : "N/A"}
          </div>
          {riskMetrics.beta !== null && (
            <div className="text-xs text-muted-foreground mt-1">
              {riskMetrics.beta > 1 ? "Aggressive" : riskMetrics.beta < 1 ? "Defensive" : "Market"}
            </div>
          )}
        </div>

        {/* Treynor Ratio */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Treynor Ratio</div>
          <div className="text-xl font-semibold text-foreground">
            {riskMetrics.treynorRatio.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {riskMetrics.beta !== null ? `Beta: ${riskMetrics.beta.toFixed(2)}` : "N/A"}
          </div>
        </div>
      </div>

      {/* VaR Details */}
      <div className={cn(
        "grid gap-4 mb-8",
        isMobile ? "grid-cols-1" : "grid-cols-2"
      )}>
        {/* 95% VaR */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-2">Value at Risk (95%)</div>
          <div className="text-lg font-semibold text-red-500 mb-1">
            {(riskMetrics.var95 * 100).toFixed(2)}%
          </div>
          <div className="text-sm text-muted-foreground">
            Expected max daily loss: {formatCurrency(riskMetrics.var95Dollar)}
          </div>
        </div>

        {/* 99% VaR */}
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-2">Value at Risk (99%)</div>
          <div className="text-lg font-semibold text-red-500 mb-1">
            {(riskMetrics.var99 * 100).toFixed(2)}%
          </div>
          <div className="text-sm text-muted-foreground">
            Expected max daily loss: {formatCurrency(riskMetrics.var99Dollar)}
          </div>
        </div>
      </div>

      {/* Underwater Chart (Drawdown) */}
      {drawdownChartData.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-foreground mb-4">Drawdown Analysis (Underwater Chart)</h3>
          <div className="bg-muted/30 border border-border rounded-lg p-4">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={drawdownChartData}>
                <defs>
                  <linearGradient id="colorDrawdown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(timestamp) => format(new Date(timestamp), 'MMM dd')}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  domain={[Math.min(0, -maxDrawdownAbs * 1.1), 0]}
                  tickFormatter={(value) => `${value.toFixed(1)}%`}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  label={{ value: "Drawdown %", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "hsl(var(--muted-foreground))" } }}
                />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(2)}%`, "Drawdown"]}
                  labelFormatter={(timestamp) => format(new Date(timestamp), 'MMM dd, yyyy')}
                  contentStyle={{
                    backgroundColor: "#2563eb",
                    border: "1px solid #1e40af",
                    borderRadius: "6px",
                    color: "#ffffff",
                    fontSize: "0.875rem",
                    padding: "8px 12px",
                  }}
                  labelStyle={{
                    color: "#ffffff",
                    fontWeight: 600,
                    marginBottom: "4px",
                  }}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="drawdown"
                  stroke="#ef4444"
                  fill="url(#colorDrawdown)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {riskMetrics.maxDrawdownStartDate && riskMetrics.maxDrawdownEndDate && (
            <div className="mt-4 text-sm text-muted-foreground">
              <strong>Maximum Drawdown Period:</strong> {
                format(
                  riskMetrics.maxDrawdownStartDate instanceof Date 
                    ? riskMetrics.maxDrawdownStartDate 
                    : new Date(riskMetrics.maxDrawdownStartDate), 
                  'MMM dd, yyyy'
                )
              } to {
                format(
                  riskMetrics.maxDrawdownEndDate instanceof Date 
                    ? riskMetrics.maxDrawdownEndDate 
                    : new Date(riskMetrics.maxDrawdownEndDate), 
                  'MMM dd, yyyy'
                )
              }
              {riskMetrics.maxDrawdownPeakNav && riskMetrics.maxDrawdownTroughNav && (
                <> ({formatCurrency(riskMetrics.maxDrawdownPeakNav)} → {formatCurrency(riskMetrics.maxDrawdownTroughNav)})</>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recovery Time Analysis */}
      {riskMetrics.recoveryAnalytics && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-foreground mb-4">Recovery Time Analysis</h3>
          <h4 className="text-md font-semibold text-foreground mb-4">Top 5 Worst Drawdowns</h4>
          
          {riskMetrics.recoveryAnalytics.drawdownPeriods && riskMetrics.recoveryAnalytics.drawdownPeriods.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-4 text-sm font-semibold text-foreground">% Drop</th>
                      <th className="text-left py-2 px-4 text-sm font-semibold text-foreground">Start Date</th>
                      <th className="text-left py-2 px-4 text-sm font-semibold text-foreground">Days to Recover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...riskMetrics.recoveryAnalytics.drawdownPeriods]
                      .sort((a, b) => a.drawdownPercent - b.drawdownPercent) // Sort by most negative first
                      .slice(0, 5)
                      .map((drawdown, index) => {
                        const peakDate = drawdown.peakDate instanceof Date 
                          ? drawdown.peakDate 
                          : new Date(drawdown.peakDate);
                        const recoveryDate = drawdown.recoveryDate 
                          ? (drawdown.recoveryDate instanceof Date 
                              ? drawdown.recoveryDate 
                              : new Date(drawdown.recoveryDate))
                          : null;
                        
                        return (
                          <tr key={index} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="py-2 px-4 text-sm text-red-500 font-semibold">
                              {(drawdown.drawdownPercent * 100).toFixed(2)}%
                            </td>
                            <td className="py-2 px-4 text-sm text-foreground">
                              {format(peakDate, 'MMM dd, yyyy')}
                            </td>
                            <td className="py-2 px-4 text-sm text-foreground">
                              {recoveryDate ? (
                                <span>{drawdown.duration} days</span>
                              ) : (
                                <span className="text-muted-foreground italic">
                                  {drawdown.duration} days (ongoing)
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              
              {riskMetrics.recoveryAnalytics.averageRecoveryTime !== null && (
                <div className="mt-4 text-sm text-muted-foreground">
                  <strong>Average Recovery Time:</strong> {riskMetrics.recoveryAnalytics.averageRecoveryTime.toFixed(1)} days
                </div>
              )}
            </>
          ) : (
            <div className="text-center text-muted-foreground py-4">
              No drawdown periods identified in historical data.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RiskDashboard;

