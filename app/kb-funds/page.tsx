"use client";

import React, { useEffect, useState, useMemo } from "react";
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts";
import { format, subDays, subMonths, subYears, startOfYear, startOfMonth } from "date-fns";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import SharedHeader from "@/components/SharedHeader";
import KBFundsSidebar from "@/components/KBFundsSidebar";
import { DollarSign, RefreshCw, TrendingUp } from "lucide-react";
import { calculateYTDMetrics, calculateMTDMetrics, calculateTodayMetrics } from "@/lib/calculations";
import type { EquityCurvePoint } from "@/lib/types";

interface KBFundData {
  date: string;
  fund_name: string;
  price_per_unit_mkd: number;
  units?: number;
  total_value_mkd?: number;
}

interface KBFundResponse {
  success: boolean;
  fund: string;
  count: number;
  prices: KBFundData[];
  valuations?: any[];
  availableFunds: string[];
  availableDates?: string[];
}

export default function KBFundsPage() {
  const [data, setData] = useState<KBFundResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFunds, setSelectedFunds] = useState<Set<string>>(new Set());
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [chartYAxis, setChartYAxis] = useState<"value" | "return">("return"); // Default to TWR chart
  const [timeframe, setTimeframe] = useState<"1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "MTD" | "YTD" | "All">("All");
  const [benchmark, setBenchmark] = useState<"SP500" | "Gold" | "None">("None");
  const [benchmarkData, setBenchmarkData] = useState<Array<{ date: string; cumulativeReturn: number }>>([]);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch USD rate
    fetch("/api/exchange-rate")
      .then((res) => res.json())
      .then((data) => {
        if (data.rate) {
          setUsdRate(data.rate);
        }
      })
      .catch(console.error);
  }, []);

  // Select all funds by default when component mounts or when navigating to this page
  useEffect(() => {
    // Select all three funds by default: Stocks, Balanced, Gold
    setSelectedFunds(new Set(["Stocks", "Balanced", "Gold"]));
  }, []);

  const loadKBFundsData = React.useCallback(async () => {
    if (selectedFunds.size === 0) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // If multiple funds selected, use "All", otherwise use the single selected fund
      const fundParam = selectedFunds.size === 1 ? Array.from(selectedFunds)[0] : "All";
      const params = new URLSearchParams({
        fund: fundParam,
        includeTotalValue: "true",
      });

      const response = await fetch(`/api/kb-funds?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to load KB Funds data (${response.status})`);
      }

      const data: KBFundResponse = await response.json();
      setData(data);
    } catch (error) {
      console.error("Error loading KB Funds:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedFunds]);

  useEffect(() => {
    void loadKBFundsData();
  }, [loadKBFundsData]);

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    setSyncError(null);

    try {
      const response = await fetch("/api/kb-funds/update", {
        method: "POST",
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || `Sync failed (${response.status})`);
      }

      const fundsProcessed = Array.isArray(result.fundsProcessed)
        ? result.fundsProcessed.join(", ")
        : "KB funds";
      setSyncMessage(
        `Sync complete for ${fundsProcessed}: ${result.inserted ?? 0} inserted, ${result.updated ?? 0} updated.`
      );
      await loadKBFundsData();
    } catch (error) {
      console.error("Error syncing KB Funds:", error);
      setSyncError(error instanceof Error ? error.message : "Failed to sync KB Funds");
    } finally {
      setSyncing(false);
    }
  };

  // Build equity curve from KB Funds data
  const equityCurve: EquityCurvePoint[] = React.useMemo(() => {
    if (!data || !data.prices || !usdRate || selectedFunds.size === 0) return [];

    // Group prices by date and calculate total value for selected funds
    const pricesByDate = new Map<string, { totalValueMKD: number; date: string }>();
    
    for (const price of data.prices) {
      const isSelected = selectedFunds.has(price.fund_name);
      if (!isSelected) continue;

      // Calculate total value if not already present
      const totalValueMKD = price.total_value_mkd || (price.price_per_unit_mkd * (price.units || 0));
      
      const existing = pricesByDate.get(price.date);
      if (existing) {
        existing.totalValueMKD += totalValueMKD;
      } else {
        pricesByDate.set(price.date, {
          totalValueMKD,
          date: price.date,
        });
      }
    }

    // Convert to equity curve format
    const sortedDates = Array.from(pricesByDate.keys()).sort();
    const curve: EquityCurvePoint[] = [];
    let previousNAV = 0;
    let cumulativeReturn = 0;

    for (const date of sortedDates) {
      const point = pricesByDate.get(date)!;
      const navUSD = point.totalValueMKD / usdRate;
      
      // Calculate daily return and cumulative TWR
      let dailyReturn = 0;
      if (previousNAV > 0) {
        dailyReturn = (navUSD / previousNAV) - 1;
        cumulativeReturn = (1 + cumulativeReturn) * (1 + dailyReturn) - 1;
      }

      curve.push({
        date: new Date(date),
        nav: navUSD,
        cumulativeReturn: cumulativeReturn * 100, // Convert to percentage
        simpleReturn: 0, // Not applicable for KB Funds
        cumulativeContributions: 0, // Not applicable
      });

      previousNAV = navUSD;
    }

    return curve;
  }, [data, selectedFunds, usdRate]);

  // Calculate current NAV (latest value from database)
  const currentNAV = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : 0;
  
  // For Today calculation: use latest recorded NAV date vs date-1 NAV from database
  // Latest NAV is the last point in equity curve, date-1 NAV is the second-to-last point
  let lastRecordedNav: number | null = null;
  if (equityCurve.length >= 2) {
    // Get the second-to-last NAV (date-1) for Today calculation
    lastRecordedNav = equityCurve[equityCurve.length - 2].nav || null;
  } else if (equityCurve.length === 1) {
    // If only one point, use it as baseline (Today will be 0)
    lastRecordedNav = equityCurve[0].nav || null;
  }
  
  // Calculate YTD, MTD, and Today metrics
  const ytdMetrics = equityCurve.length > 0 ? calculateYTDMetrics(equityCurve, currentNAV) : { ytdReturn: null, ytdValue: null };
  const mtdMetrics = equityCurve.length > 0 ? calculateMTDMetrics(equityCurve, currentNAV) : { mtdReturn: null, mtdValue: null };
  // For Today metrics: latest NAV vs date-1 NAV from database
  const todayMetrics = lastRecordedNav !== null && lastRecordedNav > 0 && equityCurve.length > 0
    ? calculateTodayMetrics(equityCurve, currentNAV, lastRecordedNav)
    : { todayGainLoss: null, todayGainLossPercent: null };

  // Filter chart data based on timeframe
  const filteredChartData = useMemo(() => {
    if (equityCurve.length === 0) return [];

    let allChartData = equityCurve.map((point) => {
      const dateObj = point.date instanceof Date ? point.date : new Date(point.date);
      return {
        date: dateObj,
        dateTimestamp: dateObj.getTime(),
        nav: point.nav,
        cumulativeReturn: point.cumulativeReturn,
        positiveReturn: point.cumulativeReturn >= 0 ? point.cumulativeReturn : null,
        negativeReturn: point.cumulativeReturn < 0 ? point.cumulativeReturn : null,
      };
    });

    if (timeframe === "All") return allChartData;

    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    switch (timeframe) {
      case "1D":
        startDate = subDays(now, 1);
        break;
      case "1W":
        startDate = subDays(now, 7);
        break;
      case "1M":
        startDate = subMonths(now, 1);
        break;
      case "3M":
        startDate = subMonths(now, 3);
        break;
      case "6M":
        startDate = subMonths(now, 6);
        break;
      case "1Y":
        startDate = subYears(now, 1);
        break;
      case "MTD":
        startDate = startOfMonth(now);
        break;
      case "YTD":
        startDate = startOfYear(now);
        break;
      default:
        return allChartData;
    }

    const startOfDay = (date: Date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const normalizedStartDate = startOfDay(startDate);
    const normalizedEndDate = startOfDay(endDate);

    const filtered = allChartData.filter((point) => {
      const pointDate = startOfDay(point.date);
      return pointDate >= normalizedStartDate && pointDate <= normalizedEndDate;
    });

    // Normalize returns to start from 0% at the beginning of the timeframe (for return view)
    if (filtered.length > 0 && chartYAxis === "return") {
      const firstReturn = filtered[0].cumulativeReturn || 0;
      return filtered.map((point) => ({
        ...point,
        cumulativeReturn: (point.cumulativeReturn || 0) - firstReturn,
        positiveReturn: point.positiveReturn !== null ? (point.positiveReturn - firstReturn) : null,
        negativeReturn: point.negativeReturn !== null ? (point.negativeReturn - firstReturn) : null,
      }));
    }

    return filtered;
  }, [equityCurve, timeframe, chartYAxis]);

  // Fetch benchmark data when needed
  useEffect(() => {
    if (benchmark === "None" || filteredChartData.length === 0 || chartYAxis !== "return") {
      setBenchmarkData([]);
      return;
    }

    setBenchmarkLoading(true);
    const startDate = filteredChartData[0].date;
    const endDate = filteredChartData[filteredChartData.length - 1].date;

    fetch(
      `/api/kb-funds/benchmark?benchmark=${benchmark}&startDate=${startDate.toISOString().split("T")[0]}&endDate=${endDate.toISOString().split("T")[0]}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
          // Normalize benchmark returns to start from 0% (matching portfolio normalization)
          const firstReturn = data.data[0]?.cumulativeReturn || 0;
          const normalized = data.data.map((point: { date: string; cumulativeReturn: number }) => ({
            date: point.date, // Keep as string for matching
            cumulativeReturn: point.cumulativeReturn - firstReturn,
          }));
          setBenchmarkData(normalized);
        } else {
          console.warn("No benchmark data received:", data);
          setBenchmarkData([]);
        }
        setBenchmarkLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching benchmark data:", error);
        setBenchmarkData([]);
        setBenchmarkLoading(false);
      });
  }, [benchmark, filteredChartData, chartYAxis]);

  // Merge benchmark data with chart data
  const chartData = useMemo(() => {
    const baseData = filteredChartData.map((point) => ({
      ...point,
      benchmarkReturn: null as number | null,
    }));

    if (benchmarkData.length === 0 || chartYAxis !== "return" || benchmark === "None") {
      return baseData;
    }

    // Create a map of benchmark data by date (ensure dates are strings)
    const benchmarkMap = new Map<string, number>();
    benchmarkData.forEach((point) => {
      const dateStr = point.date;
      benchmarkMap.set(dateStr, point.cumulativeReturn);
    });

    // Merge benchmark data into chart data, using closest available date if exact match not found
    const merged = baseData.map((point) => {
      const dateStr = typeof point.date === "string" ? point.date : (point.date as Date).toISOString().split("T")[0];
      let benchmarkReturn = benchmarkMap.get(dateStr);
      
      // If no exact match, find closest previous date
      if (benchmarkReturn === undefined) {
        const sortedBenchmarkDates = Array.from(benchmarkMap.keys()).sort();
        const closestDate = sortedBenchmarkDates
          .filter(d => d <= dateStr)
          .pop();
        if (closestDate) {
          benchmarkReturn = benchmarkMap.get(closestDate);
        }
      }
      
      return {
        ...point,
        benchmarkReturn: benchmarkReturn !== undefined ? benchmarkReturn : null,
      };
    });
    
    // Debug: log how many points have benchmark data and verify values
    const pointsWithBenchmark = merged.filter(p => p.benchmarkReturn !== null && p.benchmarkReturn !== undefined).length;
    const sampleBenchmark = merged.find(p => p.benchmarkReturn !== null && p.benchmarkReturn !== undefined);
    console.log(`Merged chart data: ${pointsWithBenchmark} of ${merged.length} points have benchmark data`);
    if (sampleBenchmark) {
      console.log(`Sample benchmark value:`, sampleBenchmark.benchmarkReturn, `(type: ${typeof sampleBenchmark.benchmarkReturn})`, `at date:`, sampleBenchmark.date);
    }
    
    return merged;
  }, [filteredChartData, benchmarkData, chartYAxis, benchmark]);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <KBFundsSidebar
        selectedFunds={selectedFunds}
        onFundsChange={setSelectedFunds}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <SharedHeader />

        <main className="container mx-auto px-6 py-8 flex-1">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">KB Funds</h1>
            <p className="text-sm text-muted-foreground">
              Manually sync latest KB fund prices when you want fresh data.
            </p>
          </div>
          <button
            type="button"
            onClick={handleManualSync}
            disabled={syncing}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors",
              syncing
                ? "cursor-not-allowed bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            {syncing ? "Syncing..." : "Sync"}
          </button>
        </div>

        {syncMessage && (
          <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-500">
            {syncMessage}
          </div>
        )}
        {syncError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {syncError}
          </div>
        )}

        {loading ? (
          <div className="text-center text-muted-foreground py-12">
            Loading KB Funds data...
          </div>
        ) : !data || data.count === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <p className="text-lg mb-2">No KB Funds data available</p>
            <p className="text-sm">Make sure data has been imported via the API</p>
          </div>
        ) : selectedFunds.size === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-muted-foreground text-lg mb-2">
                No funds selected
              </div>
              <div className="text-muted-foreground text-sm">
                Select one or more funds from the sidebar to view data
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Hero Stats - 2 Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* Total Wealth */}
              <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-xs font-medium">Total Wealth</span>
                  </div>
                </div>
                <div className="text-3xl font-bold text-foreground">
                  {formatCurrency(currentNAV)}
                </div>
                {usdRate && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    USD/MKD Rate: {usdRate.toFixed(2)}
                  </div>
                )}
              </div>

              {/* YTD Performance with MTD and Today */}
              <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-xs font-medium">YTD</span>
                  </div>
                </div>
                {ytdMetrics.ytdValue !== null && ytdMetrics.ytdReturn !== null ? (
                  <div className={cn(
                    "text-2xl font-bold",
                    ytdMetrics.ytdValue >= 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {ytdMetrics.ytdValue >= 0 ? "+" : ""}{formatCurrency(ytdMetrics.ytdValue)} <span className="text-lg">({ytdMetrics.ytdReturn >= 0 ? "+" : ""}{Math.abs(ytdMetrics.ytdReturn).toFixed(2)}%)</span>
                  </div>
                ) : (
                  <div className="text-xl font-bold text-muted-foreground">—</div>
                )}
                
                {/* MTD */}
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">MTD</span>
                  </div>
                  {mtdMetrics.mtdValue !== null && mtdMetrics.mtdReturn !== null ? (
                    <div className={cn(
                      "text-lg font-bold",
                      mtdMetrics.mtdValue >= 0 ? "text-green-500" : "text-red-500"
                    )}>
                      {mtdMetrics.mtdValue >= 0 ? "+" : ""}{formatCurrency(mtdMetrics.mtdValue)} <span className="text-base">({mtdMetrics.mtdReturn >= 0 ? "+" : ""}{Math.abs(mtdMetrics.mtdReturn).toFixed(2)}%)</span>
                    </div>
                  ) : (
                    <div className="text-base font-bold text-muted-foreground">—</div>
                  )}
                </div>

                {/* Today */}
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Today</span>
                  </div>
                  {todayMetrics.todayGainLoss !== null && todayMetrics.todayGainLossPercent !== null ? (
                    <div className={cn(
                      "text-lg font-bold",
                      todayMetrics.todayGainLoss >= 0 ? "text-green-500" : "text-red-500"
                    )}>
                      {todayMetrics.todayGainLoss >= 0 ? "+" : ""}{formatCurrency(todayMetrics.todayGainLoss)} <span className="text-base">({todayMetrics.todayGainLossPercent >= 0 ? "+" : ""}{Math.abs(todayMetrics.todayGainLossPercent).toFixed(2)}%)</span>
                    </div>
                  ) : (
                    <div className="text-base font-bold text-muted-foreground">—</div>
                  )}
                </div>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-6 mb-8">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
                  <h2 className="text-xl font-semibold text-foreground">
                    {chartYAxis === "value" ? "Portfolio Value" : "TWR Return"}
                  </h2>
                  <div className="flex gap-2 flex-wrap">
                    {/* Timeframe Selection */}
                    <div className="flex gap-1 border border-border rounded-lg p-1">
                      {(["1D", "1W", "1M", "3M", "6M", "1Y", "MTD", "YTD", "All"] as const).map((tf) => (
                        <button
                          key={tf}
                          onClick={() => setTimeframe(tf)}
                          className={cn(
                            "px-2 py-1 rounded text-xs font-medium transition-colors",
                            timeframe === tf
                              ? "bg-primary text-primary-foreground"
                              : "bg-transparent text-muted-foreground hover:bg-muted/50"
                          )}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                    {/* Chart Type Selection */}
                    <div className="flex gap-1 border border-border rounded-lg p-1">
                      <button
                        onClick={() => setChartYAxis("value")}
                        className={cn(
                          "px-3 py-1 rounded text-sm font-medium transition-colors",
                          chartYAxis === "value"
                            ? "bg-primary text-primary-foreground"
                            : "bg-transparent text-muted-foreground hover:bg-muted/50"
                        )}
                      >
                        Value ($)
                      </button>
                      <button
                        onClick={() => setChartYAxis("return")}
                        className={cn(
                          "px-3 py-1 rounded text-sm font-medium transition-colors",
                          chartYAxis === "return"
                            ? "bg-primary text-primary-foreground"
                            : "bg-transparent text-muted-foreground hover:bg-muted/50"
                        )}
                      >
                        TWR (%)
                      </button>
                    </div>
                    {/* Benchmark Selection (only for TWR view) */}
                    {chartYAxis === "return" && (
                      <div className="flex gap-1 border border-border rounded-lg p-1">
                        {(["None", "SP500", "Gold"] as const).map((bm) => (
                          <button
                            key={bm}
                            onClick={() => setBenchmark(bm as "SP500" | "Gold" | "None")}
                            className={cn(
                              "px-2 py-1 rounded text-xs font-medium transition-colors",
                              benchmark === bm
                                ? "bg-primary text-primary-foreground"
                                : "bg-transparent text-muted-foreground hover:bg-muted/50"
                            )}
                          >
                            {bm}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={500}>
                  <ComposedChart data={chartData}>
                    <defs>
                      <linearGradient id="colorNav" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="colorReturn" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#84cc16" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#84cc16" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis
                      dataKey="dateTimestamp"
                      type="number"
                      scale="time"
                      domain={chartData.length > 0 ? [
                        chartData[0].dateTimestamp,
                        chartData[chartData.length - 1].dateTimestamp
                      ] : ["dataMin", "dataMax"]}
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return format(date, "MMM yy");
                      }}
                      minTickGap={30}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(value) =>
                        chartYAxis === "value"
                          ? formatCurrency(value)
                          : `${value.toFixed(1)}%`
                      }
                      label={{
                        value: chartYAxis === "value" ? "Portfolio Value ($)" : "TWR Return (%)",
                        angle: -90,
                        position: "insideLeft",
                        style: { textAnchor: "middle", fill: "hsl(var(--muted-foreground))" }
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                        color: "hsl(var(--foreground))",
                      }}
                      formatter={(value: any, name: string) => {
                        if (value === null || value === undefined) return [null, null];
                        
                        // Handle benchmark return - check both dataKey name and display name
                        if (name === "benchmarkReturn" || name === "S&P 500" || name === "Gold") {
                          const benchmarkName = benchmark === "SP500" ? "S&P 500" : "Gold";
                          return [`${Number(value).toFixed(2)}%`, benchmarkName];
                        }
                        
                        // Handle value chart
                        if (chartYAxis === "value") {
                          if (name === "nav" || name === "Portfolio Value") {
                            return [formatCurrency(Number(value)), "Portfolio Value"];
                          }
                          return [null, null];
                        } 
                        // Handle return chart
                        else {
                          if (name === "cumulativeReturn" || name === "TWR Return") {
                            return [`${Number(value).toFixed(2)}%`, "TWR Return"];
                          }
                          return [null, null];
                        }
                      }}
                      labelFormatter={(label) => {
                        const date = typeof label === "number" ? new Date(label) : new Date(label);
                        return format(date, "MMM dd, yyyy");
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Legend 
                      formatter={(value) => {
                        if (value === "TWR Return") return "TWR Return";
                        if (value === "Portfolio Value") return "Portfolio Value";
                        if (value === "S&P 500" || value === "Gold") return value;
                        return value;
                      }}
                    />
                    {chartYAxis === "value" ? (
                      <Area
                        type="monotone"
                        dataKey="nav"
                        stroke="#60a5fa"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorNav)"
                        name="Portfolio Value"
                      />
                    ) : (
                      <>
                        <Area
                          type="monotone"
                          dataKey="cumulativeReturn"
                          stroke="#84cc16"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorReturn)"
                          name="TWR Return"
                        />
                        {benchmark !== "None" && benchmarkData.length > 0 && (
                          <Line
                            type="monotone"
                            dataKey="benchmarkReturn"
                            stroke={benchmark === "SP500" ? "#f59e0b" : "#d97706"}
                            strokeWidth={3}
                            strokeDasharray="5 5"
                            dot={false}
                            name={benchmark === "SP500" ? "S&P 500" : "Gold"}
                            connectNulls={true}
                            isAnimationActive={false}
                            activeDot={{ r: 4 }}
                            strokeOpacity={1}
                          />
                        )}
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
        </main>
      </div>
    </div>
  );
}
