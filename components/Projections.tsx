"use client";

import React, { useState, useMemo } from "react";
import { formatCurrency, cn } from "@/lib/utils";
import { format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart, ComposedChart } from 'recharts';

export interface DrawdownPeriod {
  peakDate: string | Date;
  peakValue: number;
  troughDate: string | Date;
  troughValue: number;
  recoveryDate: string | Date | null;
  duration: number;
  drawdownPercent: number;
}

export interface MonteCarloProjection {
  date: string | Date;
  percentile5: number;
  percentile25: number;
  percentile50: number;
  percentile75: number;
  percentile95: number;
}

export type PortfolioObjective = "current" | "max-sharpe" | "max-sortino" | "min-volatility" | "max-return";

interface ProjectionsProps {
  recoveryAnalytics: {
    drawdownPeriods: DrawdownPeriod[];
    averageRecoveryTime: number | null;
    currentRecoveryStatus: {
      isInDrawdown: boolean;
      currentDrawdown: DrawdownPeriod | null;
      daysSincePeak: number | null;
    };
  } | null;
  monteCarloProjections: MonteCarloProjection[] | null;
  marketBasedProjections: MonteCarloProjection[] | null; // Market-based projections (10-year asset data)
  projectionYears: 1 | 3 | 5;
  onProjectionYearsChange: (years: 1 | 3 | 5) => void;
  projectionType: "account" | "market"; // Toggle between account history vs market data
  onProjectionTypeChange: (type: "account" | "market") => void;
  selectedPortfolioObjective?: PortfolioObjective;
  onPortfolioChange?: (portfolio: PortfolioObjective) => void;
  loading?: boolean;
  marketLoading?: boolean;
  isMobile?: boolean;
}

const Projections: React.FC<ProjectionsProps> = ({
  recoveryAnalytics,
  monteCarloProjections,
  marketBasedProjections,
  projectionYears,
  onProjectionYearsChange,
  projectionType,
  onProjectionTypeChange,
  selectedPortfolioObjective = "current",
  onPortfolioChange,
  loading = false,
  marketLoading = false,
  isMobile = false,
}) => {
  // Use the appropriate projection data based on type
  const activeProjections = projectionType === "market" ? marketBasedProjections : monteCarloProjections;
  const isLoading = projectionType === "market" ? marketLoading : loading;
  
  // Portfolio selection is always available when onPortfolioChange is provided
  const showPortfolioSelection = !!onPortfolioChange;

  // Prepare Monte Carlo chart data
  // Include a "range" field for the probability cone visualization
  const mcChartData = activeProjections
    ? activeProjections.map(proj => {
        const date = proj.date instanceof Date ? proj.date : new Date(proj.date);
        return {
          date: date.getTime(),
          dateLabel: format(date, 'MMM dd, yyyy'),
          percentile5: proj.percentile5,
          percentile25: proj.percentile25,
          percentile50: proj.percentile50,
          percentile75: proj.percentile75,
          percentile95: proj.percentile95,
          range: proj.percentile95 - proj.percentile5, // Range for shaded area
        };
      })
    : [];

  // Calculate CAGR (Compound Annual Growth Rate) for each percentile at the final projection point
  const cagrData = useMemo(() => {
    if (!activeProjections || activeProjections.length === 0) return null;
    
    const firstPoint = activeProjections[0];
    const lastPoint = activeProjections[activeProjections.length - 1];
    
    // Starting NAV (from first point - all percentiles start at the same value)
    const startingNAV = firstPoint.percentile50; // Use median as starting point (all are the same at start)
    
    if (!startingNAV || startingNAV <= 0 || projectionYears <= 0) return null;
    
    // CAGR formula: ((Ending Value / Beginning Value)^(1/Years)) - 1
    const calculateCAGR = (endingValue: number): number => {
      if (endingValue <= 0) return 0;
      const ratio = endingValue / startingNAV;
      return (Math.pow(ratio, 1 / projectionYears) - 1) * 100; // Convert to percentage
    };
    
    return {
      percentile5: calculateCAGR(lastPoint.percentile5),
      percentile25: calculateCAGR(lastPoint.percentile25),
      percentile50: calculateCAGR(lastPoint.percentile50),
      percentile75: calculateCAGR(lastPoint.percentile75),
      percentile95: calculateCAGR(lastPoint.percentile95),
    };
  }, [activeProjections, projectionYears]);

  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground mb-6">Future Projections (Monte Carlo)</h2>

      {/* Monte Carlo Projections */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
          <h3 className="text-lg font-semibold text-foreground">
            {projectionType === "market" 
              ? "10-Year Asset-Based Projection (Not Account History)" 
              : "Future Projections (Monte Carlo)"}
          </h3>
          <div className="flex gap-2 flex-wrap">
            {/* Projection Type Toggle */}
            <div className="flex gap-2 border border-border rounded-lg p-1 mr-2">
              <button
                onClick={() => onProjectionTypeChange("account")}
                className={cn(
                  "px-3 py-1 text-sm font-medium rounded transition-colors",
                  projectionType === "account"
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Account History
              </button>
              <button
                onClick={() => onProjectionTypeChange("market")}
                className={cn(
                  "px-3 py-1 text-sm font-medium rounded transition-colors",
                  projectionType === "market"
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Market Data
              </button>
            </div>
            {/* Years Toggle */}
            <div className="flex gap-2">
            <button
              onClick={() => onProjectionYearsChange(1)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                projectionYears === 1
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              1 Year
            </button>
            <button
              onClick={() => onProjectionYearsChange(3)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                projectionYears === 3
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              3 Years
            </button>
            <button
              onClick={() => onProjectionYearsChange(5)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                projectionYears === 5
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              5 Years
            </button>
          </div>
          </div>
        </div>

        {/* Portfolio Selection Buttons */}
        {showPortfolioSelection && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onPortfolioChange?.("current")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selectedPortfolioObjective === "current"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
                )}
              >
                Current Portfolio
              </button>
              <button
                onClick={() => onPortfolioChange?.("max-sharpe")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selectedPortfolioObjective === "max-sharpe"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
                )}
              >
                Max Sharpe
              </button>
              <button
                onClick={() => onPortfolioChange?.("max-sortino")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selectedPortfolioObjective === "max-sortino"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
                )}
              >
                Max Sortino
              </button>
              <button
                onClick={() => onPortfolioChange?.("min-volatility")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selectedPortfolioObjective === "min-volatility"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
                )}
              >
                Min Volatility
              </button>
              <button
                onClick={() => onPortfolioChange?.("max-return")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                  selectedPortfolioObjective === "max-return"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
                )}
              >
                Max Return
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">
            {projectionType === "market" 
              ? "Fetching 10-year market data and calculating projections..." 
              : "Calculating projections..."}
          </div>
        ) : mcChartData.length > 0 ? (
          <div className="bg-muted/30 border border-border rounded-lg p-4">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={mcChartData}>
                <defs>
                  <linearGradient id="colorProjectionArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(timestamp) => format(new Date(timestamp), 'MMM yyyy')}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={(value) => formatCurrency(value, "USD", 0)}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  label={{ value: "Portfolio Value", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "hsl(var(--muted-foreground))" } }}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
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
                {/* Probability Cone (shaded area between 5th and 95th percentile) */}
                {/* Using two areas: one from 0 to 95th, one from 0 to 5th with white fill to create the shaded region */}
                <Area
                  type="monotone"
                  dataKey="percentile95"
                  stroke="none"
                  fill="url(#colorProjectionArea)"
                  stackId="cone"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="percentile5"
                  stroke="none"
                  fill="hsl(var(--background))"
                  stackId="cone"
                  isAnimationActive={false}
                />
                {/* Median line (50th percentile) */}
                <Line
                  type="monotone"
                  dataKey="percentile50"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="Median (50th percentile)"
                />
                {/* 25th percentile line (Lower quartile) */}
                <Line
                  type="monotone"
                  dataKey="percentile25"
                  stroke="#f59e0b"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  dot={false}
                  name="Lower Quartile (25th percentile)"
                />
                {/* 75th percentile line (Upper quartile) */}
                <Line
                  type="monotone"
                  dataKey="percentile75"
                  stroke="#10b981"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  dot={false}
                  name="Upper Quartile (75th percentile)"
                />
                {/* 5th percentile line (Bear case) */}
                <Line
                  type="monotone"
                  dataKey="percentile5"
                  stroke="#ef4444"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  name="Bear Case (5th percentile)"
                />
                {/* 95th percentile line (Bull case) */}
                <Line
                  type="monotone"
                  dataKey="percentile95"
                  stroke="#22c55e"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  name="Bull Case (95th percentile)"
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-blue-500"></div>
                <span>Median (50th percentile)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-amber-500"></div>
                <span>Lower Quartile (25th percentile)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-emerald-500"></div>
                <span>Upper Quartile (75th percentile)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-red-500"></div>
                <span>Bear Case (5th percentile)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-green-500"></div>
                <span>Bull Case (95th percentile)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-2 bg-blue-200"></div>
                <span>Probability Cone (5th-95th percentile)</span>
              </div>
            </div>
            
            {/* CAGR Display */}
            {cagrData && (
              <div className="mt-6 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground mb-3">
                  Compound Annual Growth Rate (CAGR) - {projectionYears} Year{projectionYears > 1 ? 's' : ''} Projection
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground mb-1">Bear Case (5th)</span>
                    <span className={cn(
                      "font-semibold text-sm",
                      cagrData.percentile5 >= 0 ? "text-red-500" : "text-red-600"
                    )}>
                      {cagrData.percentile5 >= 0 ? '+' : ''}{cagrData.percentile5.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground mb-1">Lower Quartile (25th)</span>
                    <span className={cn(
                      "font-semibold text-sm",
                      cagrData.percentile25 >= 0 ? "text-amber-500" : "text-amber-600"
                    )}>
                      {cagrData.percentile25 >= 0 ? '+' : ''}{cagrData.percentile25.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground mb-1">Median (50th)</span>
                    <span className={cn(
                      "font-semibold text-sm",
                      cagrData.percentile50 >= 0 ? "text-blue-500" : "text-blue-600"
                    )}>
                      {cagrData.percentile50 >= 0 ? '+' : ''}{cagrData.percentile50.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground mb-1">Upper Quartile (75th)</span>
                    <span className={cn(
                      "font-semibold text-sm",
                      cagrData.percentile75 >= 0 ? "text-emerald-500" : "text-emerald-600"
                    )}>
                      {cagrData.percentile75 >= 0 ? '+' : ''}{cagrData.percentile75.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground mb-1">Bull Case (95th)</span>
                    <span className={cn(
                      "font-semibold text-sm",
                      cagrData.percentile95 >= 0 ? "text-green-500" : "text-green-600"
                    )}>
                      {cagrData.percentile95 >= 0 ? '+' : ''}{cagrData.percentile95.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            No projection data available.
          </div>
        )}
      </div>
    </div>
  );
};

export default Projections;

