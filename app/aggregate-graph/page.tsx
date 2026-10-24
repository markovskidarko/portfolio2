"use client";

import React, { useEffect, useState, useMemo } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, subDays, subMonths, subYears, startOfYear, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import SharedHeader from "@/components/SharedHeader";

interface ChartDataPoint {
  date: Date;
  cumulativeReturn: number;
}

interface AggregateGraphResponse {
  success: boolean;
  stockMarket: Array<{ date: string | Date; cumulativeReturn: number }>;
  kbFunds: Array<{ date: string | Date; cumulativeReturn: number }>;
  aggregate: Array<{ date: string | Date; cumulativeReturn: number }>;
}

export default function AggregateGraphPage() {
  const [data, setData] = useState<AggregateGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<"1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "MTD" | "YTD" | "All">("All");

  useEffect(() => {
    setLoading(true);
    fetch("/api/aggregate-graph")
      .then((res) => res.json())
      .then((data: AggregateGraphResponse) => {
        setData(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error loading aggregate graph data:", error);
        setLoading(false);
      });
  }, []);

  // Process and combine data for chart
  const chartData = useMemo(() => {
    if (!data || !data.success) return [];

    // Convert all dates to Date objects and combine by date
    const stockMarketMap = new Map<string, number>();
    const kbFundsMap = new Map<string, number>();
    const aggregateMap = new Map<string, number>();

    data.stockMarket.forEach((point) => {
      const dateObj = point.date instanceof Date ? point.date : new Date(point.date);
      const dateStr = format(dateObj, 'yyyy-MM-dd');
      stockMarketMap.set(dateStr, point.cumulativeReturn);
    });

    data.kbFunds.forEach((point) => {
      const dateObj = point.date instanceof Date ? point.date : new Date(point.date);
      const dateStr = format(dateObj, 'yyyy-MM-dd');
      kbFundsMap.set(dateStr, point.cumulativeReturn);
    });

    data.aggregate.forEach((point) => {
      const dateObj = point.date instanceof Date ? point.date : new Date(point.date);
      const dateStr = format(dateObj, 'yyyy-MM-dd');
      aggregateMap.set(dateStr, point.cumulativeReturn);
    });

    // Get all unique dates
    const allDates = new Set<string>();
    stockMarketMap.forEach((_, date) => allDates.add(date));
    kbFundsMap.forEach((_, date) => allDates.add(date));
    aggregateMap.forEach((_, date) => allDates.add(date));

    // Build combined chart data
    const sortedDates = Array.from(allDates).sort();
    const combined: Array<{
      date: Date;
      dateTimestamp: number;
      aggregateReturn: number | null;
      stockMarketReturn: number | null;
      kbFundsReturn: number | null;
    }> = [];

    sortedDates.forEach((dateStr) => {
      const date = new Date(dateStr);
      combined.push({
        date,
        dateTimestamp: date.getTime(),
        aggregateReturn: aggregateMap.get(dateStr) ?? null,
        stockMarketReturn: stockMarketMap.get(dateStr) ?? null,
        kbFundsReturn: kbFundsMap.get(dateStr) ?? null,
      });
    });

    return combined;
  }, [data]);

  // Filter chart data based on timeframe
  const filteredChartData = useMemo(() => {
    if (chartData.length === 0) return [];

    if (timeframe === "All") {
      // Normalize returns to start from 0% at the beginning
      if (chartData.length > 0) {
        const firstAggregate = chartData[0].aggregateReturn ?? 0;
        const firstStockMarket = chartData[0].stockMarketReturn ?? 0;
        const firstKBFunds = chartData[0].kbFundsReturn ?? 0;

        return chartData.map((point) => ({
          ...point,
          aggregateReturn: point.aggregateReturn !== null ? point.aggregateReturn - firstAggregate : null,
          stockMarketReturn: point.stockMarketReturn !== null ? point.stockMarketReturn - firstStockMarket : null,
          kbFundsReturn: point.kbFundsReturn !== null ? point.kbFundsReturn - firstKBFunds : null,
        }));
      }
      return chartData;
    }

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
        return chartData;
    }

    const startOfDay = (date: Date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const normalizedStartDate = startOfDay(startDate);
    const normalizedEndDate = startOfDay(endDate);

    const filtered = chartData.filter((point) => {
      const pointDate = startOfDay(point.date);
      return pointDate >= normalizedStartDate && pointDate <= normalizedEndDate;
    });

    // Normalize returns to start from 0% at the beginning of the timeframe
    if (filtered.length > 0) {
      const firstAggregate = filtered[0].aggregateReturn ?? 0;
      const firstStockMarket = filtered[0].stockMarketReturn ?? 0;
      const firstKBFunds = filtered[0].kbFundsReturn ?? 0;

      return filtered.map((point) => ({
        ...point,
        aggregateReturn: point.aggregateReturn !== null ? point.aggregateReturn - firstAggregate : null,
        stockMarketReturn: point.stockMarketReturn !== null ? point.stockMarketReturn - firstStockMarket : null,
        kbFundsReturn: point.kbFundsReturn !== null ? point.kbFundsReturn - firstKBFunds : null,
      }));
    }

    return filtered;
  }, [chartData, timeframe]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading aggregate graph data...</div>
      </div>
    );
  }

  if (!data || !data.success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-red-500">Failed to load aggregate graph data</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SharedHeader />

      <main className="container mx-auto px-6 py-8 flex-1">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">Aggregate Graph</h1>
          <p className="text-muted-foreground">Combined Stock Market and KB Funds Return%</p>
        </div>

        {/* Chart */}
        {filteredChartData.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-6 mb-8">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
              <h2 className="text-xl font-semibold text-foreground">TWR Return %</h2>
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
              </div>
            </div>

            <ResponsiveContainer width="100%" height={500}>
              <ComposedChart data={filteredChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorAggregate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d946ef" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#d946ef" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#d946ef" opacity={0.3} />
                <XAxis
                  dataKey="dateTimestamp"
                  type="number"
                  scale="time"
                  domain={filteredChartData.length > 0 ? [
                    filteredChartData[0].dateTimestamp,
                    filteredChartData[filteredChartData.length - 1].dateTimestamp
                  ] : ["dataMin", "dataMax"]}
                  tickFormatter={(value) => format(new Date(value), "MMM yy")}
                  stroke="#d946ef"
                  minTickGap={30}
                />
                <YAxis
                  tickFormatter={(value) => `${value.toFixed(1)}%`}
                  stroke="#d946ef"
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length > 0) {
                      const aggregateEntry = payload.find(p => p.dataKey === 'aggregateReturn');
                      const stockMarketEntry = payload.find(p => p.dataKey === 'stockMarketReturn');
                      const kbFundsEntry = payload.find(p => p.dataKey === 'kbFundsReturn');
                      
                      const dateLabel = typeof label === 'number' ? new Date(label) : new Date(label);
                      
                      return (
                        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
                          <p className="font-medium mb-2">{format(dateLabel, "MMM d, yyyy")}</p>
                          {aggregateEntry && aggregateEntry.value !== null && (
                            <p style={{ color: '#d946ef' }} className="text-sm font-medium">
                              Aggregate: {typeof aggregateEntry.value === 'number' ? (aggregateEntry.value >= 0 ? '+' : '') + aggregateEntry.value.toFixed(2) + '%' : 'N/A'}
                            </p>
                          )}
                          {stockMarketEntry && stockMarketEntry.value !== null && (
                            <p style={{ color: '#3b82f6' }} className="text-sm">
                              Stock Market: {typeof stockMarketEntry.value === 'number' ? (stockMarketEntry.value >= 0 ? '+' : '') + stockMarketEntry.value.toFixed(2) + '%' : 'N/A'}
                            </p>
                          )}
                          {kbFundsEntry && kbFundsEntry.value !== null && (
                            <p style={{ color: '#eab308' }} className="text-sm">
                              KB Funds: {typeof kbFundsEntry.value === 'number' ? (kbFundsEntry.value >= 0 ? '+' : '') + kbFundsEntry.value.toFixed(2) + '%' : 'N/A'}
                            </p>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  formatter={(value) => {
                    if (value === 'aggregateReturn') return 'Aggregate';
                    if (value === 'stockMarketReturn') return 'Stock Market';
                    if (value === 'kbFundsReturn') return 'KB Funds';
                    return value;
                  }}
                />
                {/* Aggregate area - Magenta (filled) */}
                <Area
                  type="monotone"
                  dataKey="aggregateReturn"
                  stroke="#d946ef"
                  strokeWidth={3}
                  fill="url(#colorAggregate)"
                  fillOpacity={1}
                  dot={false}
                  connectNulls={true}
                  name="aggregateReturn"
                />
                {/* KB Funds line - Yellow (line only) */}
                <Line
                  type="monotone"
                  dataKey="kbFundsReturn"
                  stroke="#eab308"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={true}
                  name="kbFundsReturn"
                />
                {/* Stock Market line - Blue (line only) */}
                <Line
                  type="monotone"
                  dataKey="stockMarketReturn"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={true}
                  name="stockMarketReturn"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {filteredChartData.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground">
            No data available for the selected timeframe
          </div>
        )}
      </main>
    </div>
  );
}
