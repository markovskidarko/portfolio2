"use client";

import React, { useEffect, useState, useMemo } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell, Legend } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, PieChart as PieChartIcon, Receipt, RefreshCw } from "lucide-react";
import type { AggregatedData, CombinedPosition } from "@/lib/types";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import { format, subMonths, subYears, startOfYear } from "date-fns";
import Sidebar, { type AccountInfo } from "@/components/Sidebar";
import { calculateYTDMetrics, calculateMTDMetrics, calculateTodayMetrics } from "@/lib/calculations";
import SharedHeader from "@/components/SharedHeader";

export default function Dashboard() {
  const [data, setData] = useState<AggregatedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(new Set());
  const [showAccountBreakdown, setShowAccountBreakdown] = useState(false);
  const [showFullTimeline, setShowFullTimeline] = useState(true); // Zoom toggle: false = Aug 19 start, true = Feb 9 start (default to full timeline to show CSV data)
  const [chartYAxis, setChartYAxis] = useState<"value" | "return">("return"); // Y-axis toggle: "value" = $, "return" = % (default to TWR)
  type ChartTimeframe = "1M" | "3M" | "6M" | "1Y" | "YTD" | "All";
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("All");
  const [monthlyTimeframe, setMonthlyTimeframe] = useState<ChartTimeframe>("All");
  const [holdingsTab, setHoldingsTab] = useState<"holdings" | "distribution" | "performance">("holdings"); // Tab toggle: "holdings", "distribution", or "performance"
  const [performanceSubTab, setPerformanceSubTab] = useState<"all" | "dividends">("all"); // Sub-tab for performance: "all" or "dividends"
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [livePricesConnected, setLivePricesConnected] = useState(false);
  const [liveNAV, setLiveNAV] = useState<number | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  type HoldingsSortKey = 'symbol' | 'position' | 'currentPrice' | 'value' | 'costBasis' | 'unrealizedPnl' | 'unrealizedPct';
  const [holdingsSortKey, setHoldingsSortKey] = useState<HoldingsSortKey>('value');
  const [holdingsSortDir, setHoldingsSortDir] = useState<'asc' | 'desc'>('desc');

  const handleHoldingsSort = (key: HoldingsSortKey) => {
    if (holdingsSortKey === key) {
      setHoldingsSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setHoldingsSortKey(key);
      setHoldingsSortDir('desc');
    }
  };

  // Load accounts list on mount
  useEffect(() => {
    fetch("/api/accounts")
      .then((res) => res.json())
      .then((accountsData: AccountInfo[]) => {
        // Filter out HUNGARY_MIGRATION_HISTORY account
        const validAccounts = accountsData.filter(acc => acc.accountId !== 'HUNGARY_MIGRATION_HISTORY');
        setAccounts(validAccounts);
        // Select all valid accounts by default
        const allAccountIds = new Set(validAccounts.map(acc => acc.accountId));
        setSelectedAccounts(allAccountIds);
      })
      .catch((error) => {
        console.error("Error loading accounts:", error);
      });
  }, []);

  // Fetch portfolio data when selected accounts change
  useEffect(() => {
    if (accounts.length === 0) return; // Wait for accounts to load first
    if (selectedAccounts.size === 0) {
      // No accounts selected - set data to null and stop loading
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const accountIdsParam = Array.from(selectedAccounts).join(",");
    const needsDetails = holdingsTab === "performance" && performanceSubTab === "dividends";
    const url = `/api/portfolio?accountIds=${encodeURIComponent(accountIdsParam)}&details=${needsDetails ? "1" : "0"}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          return res.json().then((err) => {
            throw new Error(err.error || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((data) => {
        if (data.error) {
          console.error("API Error:", data.error, data.details);
          setLoading(false);
          return;
        }
        console.log("Loaded portfolio data:", data);
        console.log("📊 Portfolio Data Summary:");
        console.log(`  Total NAV: $${data.totalNAV?.toLocaleString() || 0}`);
        console.log(`  Net Deposits: $${data.netDeposits?.toLocaleString() || 0}`);
        console.log(`  Total Profit/Loss: $${data.totalProfitLoss?.toLocaleString() || 'N/A'}`);
        console.log(`  Simple Return (from API): ${data.simpleReturn?.toFixed(2) || 'N/A'}%`);
        if (data.netDeposits !== undefined && data.netDeposits !== 0) {
          const calculatedSimpleReturn = ((data.totalNAV - data.netDeposits) / Math.abs(data.netDeposits)) * 100;
          console.log(`  Simple Return (calculated): ${calculatedSimpleReturn.toFixed(2)}%`);
        }
        if (data.equityCurve && data.equityCurve.length > 0) {
          const lastPoint = data.equityCurve[data.equityCurve.length - 1];
          console.log(`  Last equity curve point:`);
          console.log(`    Date: ${new Date(lastPoint.date).toISOString().split("T")[0]}`);
          console.log(`    NAV: $${lastPoint.nav.toLocaleString()}`);
          console.log(`    TWR: ${lastPoint.cumulativeReturn.toFixed(2)}%`);
          console.log(`    Simple Return: ${(lastPoint as any).simpleReturn?.toFixed(2) || 'NOT SET'}%`);
          console.log(`    Contributions: $${((lastPoint as any).cumulativeContributions || 0).toLocaleString()}`);
        }
        // Update equity curve with live NAV for today if available
        if (data && data.equityCurve && data.equityCurve.length > 0 && liveNAV !== null && livePricesConnected) {
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];
          const lastPoint = data.equityCurve[data.equityCurve.length - 1];
          const lastPointDate = lastPoint.date instanceof Date 
            ? lastPoint.date.toISOString().split('T')[0]
            : new Date(lastPoint.date).toISOString().split('T')[0];
          
          if (lastPointDate === todayStr) {
            // Update last point with live NAV
            data.equityCurve[data.equityCurve.length - 1] = {
              ...lastPoint,
              nav: liveNAV,
            };
            data.totalNAV = liveNAV;
          } else if (lastPointDate < todayStr) {
            // Add new point for today with live NAV
            data.equityCurve.push({
              date: today,
              nav: liveNAV,
              cumulativeReturn: lastPoint.cumulativeReturn || 0,
              simpleReturn: 0,
              cumulativeContributions: lastPoint.cumulativeContributions || 0,
            });
            data.totalNAV = liveNAV;
          }
        }
        
        setData(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error loading portfolio:", error);
        setLoading(false);
      });
  }, [selectedAccounts, accounts.length, holdingsTab, performanceSubTab]);

  // Fetch live prices from Yahoo Finance periodically
  useEffect(() => {
    if (selectedAccounts.size === 0) {
      setLiveNAV(null);
      setLivePricesConnected(false);
      return;
    }

    const updateLivePrices = async () => {
      try {
        setUpdatingPrices(true);
        const response = await fetch('/api/live-prices/update', { method: 'POST' });
        const result = await response.json();
        
        if (result.success && result.updated > 0) {
          setLivePricesConnected(true);
          setLastPriceUpdate(new Date());
          
          // Trigger portfolio data refresh to get updated NAV with live prices
          // The portfolio API will automatically use live prices if available
          const accountIdsParam = Array.from(selectedAccounts).join(",");
          const needsDetails = holdingsTab === "performance" && performanceSubTab === "dividends";
          const url = `/api/portfolio?accountIds=${encodeURIComponent(accountIdsParam)}&details=${needsDetails ? "1" : "0"}`;
          
          const portfolioResponse = await fetch(url);
          const portfolioData = await portfolioResponse.json();
          
          if (portfolioData && !portfolioData.error) {
            // Update both live NAV and portfolio data state
            if (portfolioData.totalNAV) {
              setLiveNAV(portfolioData.totalNAV);
            }
            // Update the main data state so UI reflects live prices
            setData(portfolioData);
          }
        } else {
          setLivePricesConnected(false);
        }
      } catch (error) {
        console.error('Error updating live prices:', error);
        setLivePricesConnected(false);
      } finally {
        setUpdatingPrices(false);
      }
    };

    // Update immediately on mount/account change
    updateLivePrices();

    // Update every 20 seconds
    const interval = setInterval(updateLivePrices, 20000);

    return () => clearInterval(interval);
  }, [selectedAccounts]);

  const togglePosition = (symbol: string) => {
    const newExpanded = new Set(expandedPositions);
    if (newExpanded.has(symbol)) {
      newExpanded.delete(symbol);
    } else {
      newExpanded.add(symbol);
    }
    setExpandedPositions(newExpanded);
  };

  const sortedPositions = useMemo(() => {
    const positions = data?.combinedPositions ?? [];
    return [...positions].sort((a, b) => {
      const aPrice = !a.isCash && a.totalPosition > 0 ? a.totalValue / a.totalPosition : 0;
      const bPrice = !b.isCash && b.totalPosition > 0 ? b.totalValue / b.totalPosition : 0;
      const aPnl  = a.totalValue - a.totalCostBasis;
      const bPnl  = b.totalValue - b.totalCostBasis;
      const aPct  = a.totalCostBasis > 0 ? aPnl / a.totalCostBasis : 0;
      const bPct  = b.totalCostBasis > 0 ? bPnl / b.totalCostBasis : 0;
      let av: number | string, bv: number | string;
      switch (holdingsSortKey) {
        case 'symbol':       av = a.symbol;          bv = b.symbol;          break;
        case 'position':     av = a.totalPosition;   bv = b.totalPosition;   break;
        case 'currentPrice': av = aPrice;             bv = bPrice;            break;
        case 'value':        av = a.totalValue;       bv = b.totalValue;      break;
        case 'costBasis':    av = a.totalCostBasis;   bv = b.totalCostBasis;  break;
        case 'unrealizedPnl':av = aPnl;               bv = bPnl;              break;
        case 'unrealizedPct':av = aPct;               bv = bPct;              break;
        default:             av = a.totalValue;       bv = b.totalValue;
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return holdingsSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return holdingsSortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [data?.combinedPositions, holdingsSortKey, holdingsSortDir]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading portfolio data...</div>
      </div>
    );
  }

  // Show empty state if no accounts are selected
  if (selectedAccounts.size === 0) {
    return (
      <div className="min-h-screen bg-background flex">
        {/* Sidebar */}
        <Sidebar
          accounts={accounts}
          selectedAccounts={selectedAccounts}
          onAccountsChange={setSelectedAccounts}
        />
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          <SharedHeader />

          <main className="container mx-auto px-6 py-8 flex-1">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-muted-foreground text-lg mb-2">
                  No portfolios selected
                </div>
                <div className="text-muted-foreground text-sm">
                  Select one or more portfolios from the sidebar to view data
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex">
        {/* Sidebar */}
        <Sidebar
          accounts={accounts}
          selectedAccounts={selectedAccounts}
          onAccountsChange={setSelectedAccounts}
        />
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          <SharedHeader />

          <main className="container mx-auto px-6 py-8 flex-1">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-destructive text-lg font-semibold mb-2">
                  Failed to load portfolio data
                </div>
                <div className="text-muted-foreground text-sm">
                  Check the browser console and server logs for details
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // Update equity curve with live NAV for today if available (for accurate YTD/MTD/Today calculations)
  let equityCurveForMetrics = data?.equityCurve || [];
  const currentNAV = livePricesConnected && liveNAV !== null ? liveNAV : (data?.totalNAV || 0);
  
  // Get last recorded NAV from database BEFORE updating with live NAV (for Today calculation)
  let lastRecordedNav: number | null = null;
  if (equityCurveForMetrics.length > 0) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Find the last point that is NOT today
    for (let i = equityCurveForMetrics.length - 1; i >= 0; i--) {
      const point = equityCurveForMetrics[i];
      const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
      const pointDateStr = pointDate.toISOString().split('T')[0];
      
      if (pointDateStr !== todayStr && point.nav > 0) {
        lastRecordedNav = point.nav;
        break;
      }
    }
    
    // If no non-today point found, use the last point
    if (lastRecordedNav === null) {
      lastRecordedNav = equityCurveForMetrics[equityCurveForMetrics.length - 1].nav || null;
    }
  }
  
  if (equityCurveForMetrics.length > 0 && livePricesConnected && liveNAV !== null) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const lastPoint = equityCurveForMetrics[equityCurveForMetrics.length - 1];
    const lastPointDate = lastPoint.date instanceof Date
      ? lastPoint.date.toISOString().split('T')[0]
      : new Date(lastPoint.date).toISOString().split('T')[0];

    // Build live per-account NAVs from data.accounts[].changeInNAV (the API
    // route writes the live USD NAV into endingValue with fxRateToBase=1, so
    // multiplying yields USD). Without this the per-account monthly bars use
    // yesterday's accountBreakdown values, which is why their current-month
    // bar doesn't match the per-account MTD score card.
    const liveBreakdown: Record<string, number> = {};
    if (data?.accounts) {
      for (const acc of data.accounts as any[]) {
        const usd = (acc.changeInNAV?.endingValue ?? 0) * (acc.changeInNAV?.fxRateToBase ?? 1);
        if (usd > 0) liveBreakdown[acc.accountId] = usd;
      }
    }

    if (lastPointDate === todayStr) {
      // Update last point with live NAV + live per-account breakdown
      equityCurveForMetrics = [...equityCurveForMetrics];
      equityCurveForMetrics[equityCurveForMetrics.length - 1] = {
        ...lastPoint,
        nav: liveNAV,
        accountBreakdown: {
          ...((lastPoint as any).accountBreakdown || {}),
          ...liveBreakdown,
        },
      } as any;
    } else if (lastPointDate < todayStr) {
      // Add new point for today with live NAV + live per-account breakdown
      equityCurveForMetrics = [...equityCurveForMetrics, {
        date: today,
        nav: liveNAV,
        cumulativeReturn: lastPoint.cumulativeReturn || 0,
        simpleReturn: lastPoint.simpleReturn || 0,
        cumulativeContributions: lastPoint.cumulativeContributions || 0,
        accountBreakdown: {
          ...((lastPoint as any).accountBreakdown || {}),
          ...liveBreakdown,
        },
      } as any];
    }
  }

  // Prepare chart data - convert dates to timestamps for Recharts time scale
  // Also extract account breakdown data for individual account lines
  // Use equityCurveForMetrics which includes live NAV if available
  const allChartData = equityCurveForMetrics.length > 0
    ? equityCurveForMetrics.map((point) => {
        const dateObj = point.date instanceof Date ? point.date : new Date(point.date);
        // Calculate Simple Return if not already calculated: (NAV - Contributions) / Contributions
        const simpleReturn = point.simpleReturn !== undefined
          ? point.simpleReturn
          : (point.cumulativeContributions && point.cumulativeContributions > 0)
            ? ((point.nav - point.cumulativeContributions) / point.cumulativeContributions) * 100
            : 0;

        return {
          date: dateObj, // Keep Date object for reference
          dateTimestamp: dateObj.getTime(), // Use timestamp for X-axis with time scale
          nav: point.nav,
          cumulativeReturn: point.cumulativeReturn, // This is the TWR percentage
          simpleReturn: simpleReturn, // Simple Return percentage
          cumulativeContributions: point.cumulativeContributions || 0,
          // Carry these through so the tooltip's contribution-aware P/L%
          // calculation can run a per-point cumulative-flow sum.
          cashFlow: (point as any).cashFlow || 0,
          isInternalTransfer: !!(point as any).isInternalTransfer,
          ...(point.accountBreakdown || {}), // Spread account breakdown data
        };
      })
    : [];
  
  // Find first non-zero NAV date for zoom to content
  const firstNonZeroNavIndex = allChartData.findIndex(p => p.nav > 0);
  const firstNonZeroNavDate = firstNonZeroNavIndex >= 0 ? allChartData[firstNonZeroNavIndex].date : null;
  
  // Filter chart data based on zoom toggle
  // Default: Show full timeline (from earliest account start date)
  // Toggle: Start from first non-zero NAV to avoid flat line at the beginning
  let filteredChartData = showFullTimeline
    ? allChartData
    : (firstNonZeroNavIndex >= 0 ? allChartData.slice(firstNonZeroNavIndex) : allChartData);

  // Apply timeframe filter (1M / 3M / 6M / 1Y / YTD / All). Done BEFORE return
  // normalization so the % chart re-baselines to 0% at the window's start.
  if (chartTimeframe !== "All" && filteredChartData.length > 0) {
    const now = new Date();
    let cutoff: Date;
    switch (chartTimeframe) {
      case "1M":  cutoff = subMonths(now, 1); break;
      case "3M":  cutoff = subMonths(now, 3); break;
      case "6M":  cutoff = subMonths(now, 6); break;
      case "1Y":  cutoff = subYears(now, 1);  break;
      case "YTD": cutoff = startOfYear(now);  break;
      default:    cutoff = filteredChartData[0].date;
    }
    cutoff.setHours(0, 0, 0, 0);
    filteredChartData = filteredChartData.filter(p => {
      const d = p.date instanceof Date ? p.date : new Date(p.date);
      return d >= cutoff;
    });
  }

  // Normalize returns to start from 0% at the beginning of the visible timeframe (for return view)
  // and attach plPct — the contribution-adjusted P/L% measured from the first
  // VISIBLE point with real capital. This matches the YTD/MTD card formula:
  //   plPct = (nav − firstNav − contribsInWindow) / (firstNav + contribsInWindow) × 100
  // so hovering the rightmost YTD point shows the same number as the YTD card.
  //
  // Two bugs this addresses:
  //   1. "All" view starts with nav=$0 inception-padding points → use the
  //      first NON-ZERO NAV as the baseline, not blindly index 0.
  //   2. Raw price-only return double-counts deposits as gain → walk
  //      cashFlow point-by-point (skipping internal transfers, matching the
  //      Net Contributions definition) and net them out.
  const _firstValidIdx   = filteredChartData.findIndex(p => (p.nav || 0) > 0);
  const _baselineIdx     = _firstValidIdx >= 0 ? _firstValidIdx : 0;
  const _firstReturnBase = filteredChartData.length > 0 ? (filteredChartData[_baselineIdx].cumulativeReturn || 0) : 0;
  const _firstNavBase    = filteredChartData.length > 0 ? (filteredChartData[_baselineIdx].nav || 0)              : 0;

  let _runningContribs = 0;
  const chartData = filteredChartData.length > 0
    ? filteredChartData.map((point, idx) => {
        // Accumulate external cash flows for points strictly AFTER the baseline.
        // The baseline point's own flow is considered pre-existing capital.
        if (idx > _baselineIdx
            && !(point as any).isInternalTransfer
            && (point as any).cashFlow) {
          _runningContribs += (point as any).cashFlow;
        }
        const adjustedBase = _firstNavBase + _runningContribs;
        const plPct = _firstNavBase > 0 && adjustedBase > 0
          ? ((point.nav - _firstNavBase - _runningContribs) / adjustedBase) * 100
          : 0;
        const baseFields = { ...point, plPct };
        return chartYAxis === "return"
          ? { ...baseFields, cumulativeReturn: (point.cumulativeReturn || 0) - _firstReturnBase }
          : baseFields;
      })
    : filteredChartData;

  // Collect account ids and aliases here (moved up from below) so the monthly
  // bar aggregation can fan out per-account series.
  const accountIds = new Set<string>();
  if (equityCurveForMetrics.length > 0) {
    for (const point of equityCurveForMetrics) {
      if (point.accountBreakdown) {
        Object.keys(point.accountBreakdown).forEach((id) => accountIds.add(id));
      }
    }
  }
  const accountInfo = new Map<string, string>();
  if (data.accounts) {
    for (const account of data.accounts) {
      accountInfo.set(account.accountId, account.accountAlias);
    }
  }

  // ── Monthly performance bars (per-account + aggregate) ─────────────────
  // For each month and each scope (the aggregate plus every selected account):
  //   return = (lastNavOfMonth − priorMonthEndNav − externalFlowsInMonth)
  //            / (priorMonthEndNav + externalFlowsInMonth)
  // The aggregate's current-month bar therefore equals the MTD score card.
  // Per-account contributions come from the server (data.monthlyContribsByAccount).
  // Per-account NAV at each curve point comes from accountBreakdown.
  type MonthBucket = { baseNav: number; lastNav: number; contribs: number; startDate: Date };
  const _activeAccountIds = Array.from(accountIds)
    .filter(id => id !== "HUNGARY_MIGRATION_HISTORY"); // legacy migration bucket carries nav=0 — exclude from bars
  const _monthlyContribs: Record<string, Record<string, number>> = (data as any)?.monthlyContribsByAccount ?? {};

  // We only need the aggregate bucket client-side now — per-account monthly
  // returns are precomputed server-side from DailyNAV (sourced identically to
  // the per-account MTD card) so we drop the per-account scopes here.
  const SCOPE_AGG = "__agg";
  const allScopes = [SCOPE_AGG];
  const bucketByScope = new Map<string, Map<string, MonthBucket>>();
  for (const s of allScopes) bucketByScope.set(s, new Map());
  const prevValidNavByScope: Record<string, number | null> = {};
  for (const s of allScopes) prevValidNavByScope[s] = null;

  for (const point of equityCurveForMetrics) {
    const d = point.date instanceof Date ? point.date : new Date(point.date as any);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const flow = (point as any).cashFlow || 0;
    const isInternal = !!(point as any).isInternalTransfer;
    const accBreakdown: Record<string, number> = (point as any).accountBreakdown || {};

    for (const scope of allScopes) {
      // Per-scope NAV at this point. Aggregate uses point.nav (already net of
      // any internal-transfer churn); per-account uses accountBreakdown[id].
      const nav = scope === SCOPE_AGG
        ? (point.nav || 0)
        : (accBreakdown[scope] || 0);
      if (nav <= 0) continue;

      const bucketMap = bucketByScope.get(scope)!;
      const entry = bucketMap.get(key);

      // For the aggregate, the day's external flow comes straight from the
      // equity curve. For an individual account we fall back to the server's
      // per-account-per-month total — applied once when the month is first
      // observed so we don't double-count.
      if (!entry) {
        const isInceptionMonth = prevValidNavByScope[scope] === null;
        let baseNav: number;
        let initialContribs = 0;
        if (scope === SCOPE_AGG) {
          // Aggregate: treat first NAV as starting capital (it represents the
          // sum of pre-existing wealth at data-start, e.g. CSV migration).
          baseNav = isInceptionMonth ? nav : prevValidNavByScope[scope]!;
          if (!isInceptionMonth && flow && !isInternal) initialContribs = flow;
        } else if (isInceptionMonth) {
          // Per-account inception. The first day's NAV may be a mix of:
          //   (a) deposits we recorded that month (true inception), or
          //   (b) a pre-existing balance imported as a snapshot with no
          //       corresponding deposit row (data-migration start).
          // Unify both with: baseNav = max(0, firstNav − monthContribs).
          //   • If contribs ≥ firstNav (case a), baseNav clamps to 0 and the
          //     month's return reads against the deposits as the denominator.
          //   • If contribs ≪ firstNav (case b), baseNav ≈ firstNav and the
          //     return becomes (endNav − firstNav) / firstNav — same shape as
          //     the aggregate's snapshot-start handling.
          const monthContribs = _monthlyContribs[scope]?.[key] ?? 0;
          baseNav = Math.max(0, nav - monthContribs);
          initialContribs = monthContribs;
        } else {
          baseNav = prevValidNavByScope[scope]!;
          initialContribs = _monthlyContribs[scope]?.[key] ?? 0;
        }
        bucketMap.set(key, {
          baseNav,
          lastNav: nav,
          contribs: initialContribs,
          startDate: new Date(d.getFullYear(), d.getMonth(), 1),
        });
      } else {
        entry.lastNav = nav;
        // Only the aggregate accumulates flow point-by-point (its cashFlow
        // is on the curve). Per-account contribs were already loaded at
        // month-start from the server's monthly aggregate.
        if (scope === SCOPE_AGG && flow && !isInternal) entry.contribs += flow;
      }
      prevValidNavByScope[scope] = nav;
    }
  }

  // Per-account monthly returns come from the server's monthlyReturnsByAccount
  // (computed from the same DailyNAV table the per-account MTD card uses, so
  // the current-month bar equals the MTD card exactly). The aggregate scope
  // stays client-computed from the combined equity curve since it already
  // matches the aggregate MTD reading.
  const _monthlyReturnsByAccount: Record<string, Array<{ monthKey: string; monthTs: number; returnPct: number }>>
    = (data as any)?.monthlyReturnsByAccount ?? {};
  const _perAccountReturnByMonth: Record<string, Map<string, number>> = {};
  for (const accId of _activeAccountIds) {
    const arr = _monthlyReturnsByAccount[accId] || [];
    const map = new Map<string, number>();
    for (const r of arr) map.set(r.monthKey, r.returnPct);
    _perAccountReturnByMonth[accId] = map;
  }

  // Stitch into one row per month: { monthLabel, monthTs, __agg: pct, U15352922: pct, ... }
  const _allMonthKeys = new Set<string>();
  for (const k of bucketByScope.get(SCOPE_AGG)!.keys()) _allMonthKeys.add(k);
  for (const accId of _activeAccountIds) {
    for (const k of (_perAccountReturnByMonth[accId]?.keys() ?? [])) _allMonthKeys.add(k);
  }
  const showAggregateBar = _activeAccountIds.length >= 2; // suppress when only 1 account selected — bar would duplicate

  const allMonthlyReturns = Array.from(_allMonthKeys)
    .sort()
    .map((key) => {
      const aggBucket = bucketByScope.get(SCOPE_AGG)!.get(key);
      const startDate = aggBucket?.startDate ?? new Date(`${key}-01T00:00:00`);
      const row: Record<string, any> = {
        monthKey: key,
        monthLabel: format(startDate, "MMM yyyy"),
        monthTs: startDate.getTime(),
      };
      // Aggregate from client-side bucket (already MTD-card-matching).
      if (aggBucket) {
        const adjBase = aggBucket.baseNav + aggBucket.contribs;
        const gain = aggBucket.lastNav - aggBucket.baseNav - aggBucket.contribs;
        row[SCOPE_AGG] = adjBase > 0 ? (gain / adjBase) * 100 : 0;
      } else {
        row[SCOPE_AGG] = null;
      }
      // Per-account from server-precomputed series.
      for (const accId of _activeAccountIds) {
        const v = _perAccountReturnByMonth[accId]?.get(key);
        row[accId] = v == null ? null : v;
      }
      return row;
    });

  // Apply timeframe filter — same set of windows as the line chart above
  const monthlyReturns = (() => {
    if (monthlyTimeframe === "All" || allMonthlyReturns.length === 0) return allMonthlyReturns;
    const now = new Date();
    let cutoff: Date;
    switch (monthlyTimeframe) {
      case "1M":  cutoff = subMonths(now, 1); break;
      case "3M":  cutoff = subMonths(now, 3); break;
      case "6M":  cutoff = subMonths(now, 6); break;
      case "1Y":  cutoff = subYears(now, 1);  break;
      case "YTD": cutoff = startOfYear(now);  break;
      default:    return allMonthlyReturns;
    }
    cutoff.setHours(0, 0, 0, 0);
    return allMonthlyReturns.filter(m => m.monthTs >= cutoff.getTime());
  })();

  // (accountIds and accountInfo are declared above so the monthly bars block can use them.)

  // Verify last point matches header (sync check)
  if (chartData.length > 0 && equityCurveForMetrics.length > 0) {
    const chartLastReturn = chartData[chartData.length - 1].cumulativeReturn;
    const headerReturn = equityCurveForMetrics[equityCurveForMetrics.length - 1].cumulativeReturn;
    if (Math.abs(chartLastReturn - headerReturn) > 0.01) {
      console.warn(`Chart/Header mismatch: Chart=${chartLastReturn.toFixed(2)}%, Header=${headerReturn.toFixed(2)}%`);
    } else {
      console.log(`✅ Chart/Header synced: ${chartLastReturn.toFixed(2)}%`);
    }
  }

  const chartStartDate = chartData.length > 0 ? format(chartData[0].date, "MMM dd, yyyy") : "N/A";
  console.log("Chart data prepared:", chartData.length, "points", showFullTimeline ? `(full timeline from ${chartStartDate})` : `(zoomed from ${firstNonZeroNavDate ? format(firstNonZeroNavDate, "MMM dd, yyyy") : "first non-zero NAV"})`);
  console.log("Account breakdown available for", accountIds.size, "accounts");

  // Calculate YTD, MTD, and Today metrics using equity curve with live NAV.
  // YTD uses true TWR (sub-period chaining at each external cash flow) so
  // deposits are correctly stripped without needing a separate contributions scalar.
  // MTD and Today still use the contributions approach (simpler, intra-month flows are rare).
  const mtdContrib   = (data as any)?.mtdContributions   ?? 0;
  const todayContrib = (data as any)?.todayContributions ?? 0;
  const ytdMetrics = equityCurveForMetrics.length > 0 ? calculateYTDMetrics(equityCurveForMetrics, currentNAV) : { ytdReturn: null, ytdValue: null };
  const mtdMetrics = equityCurveForMetrics.length > 0 ? calculateMTDMetrics(equityCurveForMetrics, currentNAV, mtdContrib) : { mtdReturn: null, mtdValue: null };
  // For Today metrics, use lastRecordedNav (before live update) vs currentNAV (live)
  const todayMetrics = lastRecordedNav !== null && lastRecordedNav > 0
    ? calculateTodayMetrics(equityCurveForMetrics, currentNAV, lastRecordedNav, todayContrib)
    : { todayGainLoss: null, todayGainLossPercent: null };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <Sidebar
        accounts={accounts}
        selectedAccounts={selectedAccounts}
        onAccountsChange={setSelectedAccounts}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <SharedHeader />

        {/* Sync Button Section */}
        <div className="bg-card/30 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-3 flex items-center justify-end gap-4">
            {syncMessage && (
              <p className={cn(
                "text-sm",
                syncMessage.includes("Error") || syncMessage.includes("Failed")
                  ? "text-red-500"
                  : "text-green-500"
              )}>
                {syncMessage}
              </p>
            )}
            <button
              onClick={async () => {
                setSyncing(true);
                setSyncMessage(null);
                try {
                  // Pass clearExisting: true to ensure fresh ingestion
                  const response = await fetch('/api/sync', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clearExisting: true })
                  });
                  const result = await response.json();
                  if (result.success) {
                    const ingestionMsg = result.ingestion 
                      ? `Ingested: ${result.ingestion.navRecordsIngested} NAV records, ${result.ingestion.transactionsIngested} transactions. ` 
                      : '';
                    const syncMsg = result.flexSync
                      ? `Flex Sync: ${result.flexSync.successCount} succeeded, ${result.flexSync.failureCount} failed.`
                      : '';
                    setSyncMessage(ingestionMsg + syncMsg || result.message);
                    
                    // Refresh data after sync (with delay to ensure DB commit)
                    if (selectedAccounts.size > 0) {
                      setTimeout(() => {
                        const accountIdsParam = Array.from(selectedAccounts).join(",");
                        const needsDetails = holdingsTab === "performance" && performanceSubTab === "dividends";
                        const url = `/api/portfolio?accountIds=${encodeURIComponent(accountIdsParam)}&details=${needsDetails ? "1" : "0"}`;
                        fetch(url)
                          .then(res => res.json())
                          .then(data => {
                            setData(data);
                          })
                          .catch(err => console.error('Error refreshing data:', err));
                      }, 500);
                    }
                  } else {
                    setSyncMessage(`Error: ${result.error || result.message}`);
                  }
                } catch (error) {
                  setSyncMessage(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
                } finally {
                  setSyncing(false);
                  setTimeout(() => setSyncMessage(null), 5000);
                }
              }}
              disabled={syncing}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors",
                syncing
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? "Syncing..." : "Sync Portfolio"}
            </button>
          </div>
        </div>

        <main className="container mx-auto px-6 py-8 flex-1">
        {/* Hero Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Wealth */}
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <DollarSign className="h-4 w-4" />
                <span className="text-xs font-medium">Total Wealth</span>
                {livePricesConnected && (
                  <span className="relative flex h-2 w-2 ml-1" title="Yahoo Finance - Live Prices">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                )}
                {updatingPrices && (
                  <span className="text-xs text-muted-foreground ml-2">Updating prices...</span>
                )}
              </div>
            </div>
            <div className="text-3xl font-bold text-foreground">
              {formatCurrency(currentNAV)}
            </div>
            {!livePricesConnected && lastPriceUpdate && (
              <div className="mt-1 text-xs text-muted-foreground">
                Last updated: {format(lastPriceUpdate, "MMM dd, yyyy HH:mm")}
              </div>
            )}
            {!livePricesConnected && !lastPriceUpdate && (
              <div className="mt-1 text-xs text-muted-foreground">
                Using database data - prices will update automatically
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

          {/* Performance Metrics - TWR, Simple Return, Annualized Return */}
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <PieChartIcon className="h-4 w-4" />
                <span className="text-xs font-medium">Performance</span>
              </div>
            </div>
            
            {/* TWR */}
            <div className="mb-3">
              <div className="text-xs text-muted-foreground mb-1">TWR</div>
              <div className="text-xl font-bold text-foreground">
                {data?.equityCurve && data.equityCurve.length > 0 && data.equityCurve[data.equityCurve.length - 1]?.cumulativeReturn !== undefined
                  ? formatPercent(
                      data.equityCurve[data.equityCurve.length - 1].cumulativeReturn
                    )
                  : "0.00%"}
              </div>
            </div>

            {/* Simple Return */}
            <div className="pt-3 border-t border-border mb-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted-foreground">Simple Return</span>
                <span className="text-xs text-muted-foreground">Total Profit</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="text-xl font-bold text-foreground">
                  {data.totalNAV !== undefined && data.netDeposits !== undefined && data.netDeposits !== 0
                    ? formatPercent(
                        ((data.totalNAV - data.netDeposits) / Math.abs(data.netDeposits)) * 100
                      )
                    : "0.00%"}
                </div>
                <div className={cn(
                  "text-xl font-bold",
                  (data.totalNAV - (data.netDeposits || 0)) >= 0 ? "text-green-500" : "text-red-500"
                )}>
                  {formatCurrency(data.totalNAV - (data.netDeposits || 0))}
                </div>
              </div>
            </div>

            {/* Annualized Return */}
            {data.annualizedYield !== undefined && data.annualizedYield !== null && (
              <div className="pt-3 border-t border-border">
                <div className="text-xs text-muted-foreground mb-1">Annualized Return (CAGR)</div>
                <div className="text-xl font-bold text-foreground">
                  {formatPercent(data.annualizedYield)}
                </div>
              </div>
            )}
          </div>

          {/* Net Contributions with Breakdown */}
          <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Receipt className="h-4 w-4" />
                <span className="text-xs font-medium">Net Contributions</span>
              </div>
            </div>
            <div className="text-3xl font-bold text-foreground mb-3">
              {formatCurrency(data.netDeposits || 0)}
            </div>
            
            {/* Breakdown */}
            <div className="pt-3 border-t border-border space-y-2">
              <div className="text-xs font-semibold text-muted-foreground mb-1">Breakdown:</div>
              
              {data.totalDeposits !== undefined && data.totalDeposits > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Deposits:</span>
                  <span className="text-xs font-medium text-green-500">
                    +{formatCurrency(data.totalDeposits)}
                  </span>
                </div>
              )}
              
              {data.totalWithdrawals !== undefined && data.totalWithdrawals > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Withdrawals:</span>
                  <span className="text-xs font-medium text-red-500">
                    -{formatCurrency(data.totalWithdrawals)}
                  </span>
                </div>
              )}

              {data.totalInternalIn !== undefined && data.totalInternalIn > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Total Internal Transfer (IN):</span>
                  <span className="text-xs font-medium text-green-500">
                    +{formatCurrency(data.totalInternalIn)}
                  </span>
                </div>
              )}

              {data.totalInternalOut !== undefined && data.totalInternalOut > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Total Internal Transfer (OUT):</span>
                  <span className="text-xs font-medium text-red-500">
                    -{formatCurrency(data.totalInternalOut)}
                  </span>
                </div>
              )}
              
              {data.netDeposits !== undefined && (
                <div className="pt-2 border-t border-border">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-foreground">Net:</span>
                    <span className="text-xs font-bold text-foreground">
                      {formatCurrency(data.netDeposits)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Chart */}
          <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-foreground">
                Performance Over Time
              </h2>
              <div className="flex items-center gap-4">
                {/* Timeframe Selector */}
                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                  {(["1M", "3M", "6M", "1Y", "YTD", "All"] as const).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setChartTimeframe(tf)}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                        chartTimeframe === tf
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                {/* Y-Axis Toggle */}
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1">
                  <button
                    onClick={() => setChartYAxis("value")}
                    className={cn(
                      "px-3 py-1 text-xs font-medium rounded transition-colors",
                      chartYAxis === "value"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Value ($)
                  </button>
                  <button
                    onClick={() => setChartYAxis("return")}
                    className={cn(
                      "px-3 py-1 text-xs font-medium rounded transition-colors",
                      chartYAxis === "return"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Return (%)
                  </button>
                </div>
                {/* Zoom Toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showFullTimeline}
                    onChange={(e) => setShowFullTimeline(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span className="text-sm text-muted-foreground">
                    {showFullTimeline ? "Show Full" : "Zoom to Content"}
                  </span>
                </label>
                {/* Account Breakdown Toggle */}
                {accountIds.size > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showAccountBreakdown}
                      onChange={(e) => setShowAccountBreakdown(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-muted-foreground">Account Breakdown</span>
                  </label>
                )}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              {chartData.length > 0 ? (
              <AreaChart data={chartData}>
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
                    // Convert timestamp back to date
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
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const date = typeof label === "number" ? new Date(label as number) : new Date(label as any);
                    const plPct = (payload[0]?.payload as any)?.plPct;
                    return (
                      <div
                        style={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "0.5rem",
                          padding: "0.5rem 0.75rem",
                          color: "hsl(var(--foreground))",
                          fontSize: "0.875rem",
                          minWidth: 180,
                        }}
                      >
                        <div style={{ marginBottom: 4, fontWeight: 500 }}>
                          {format(date, "MMM dd, yyyy")}
                        </div>
                        {payload.map((p, i) => {
                          const v = p.value as number;
                          let labelName: string = p.name as string;
                          let formatted: string;
                          if (chartYAxis === "value") {
                            formatted = formatCurrency(v);
                            if (p.name === "cumulativeReturn" || p.name === "simpleReturn") labelName = "Return";
                          } else if (p.name === "nav") {
                            formatted = formatCurrency(v);
                            labelName = "Value";
                          } else if (p.name === "simpleReturn") {
                            formatted = `${v.toFixed(2)}%`;
                            labelName = "Simple Return";
                          } else {
                            formatted = `${v.toFixed(2)}%`;
                            labelName = "Return";
                          }
                          return (
                            <div
                              key={i}
                              style={{
                                color: p.color as string,
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 12,
                              }}
                            >
                              <span>{labelName}:</span>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatted}</span>
                            </div>
                          );
                        })}
                        {/* P/L% from the start of the visible timeframe — only meaningful in Value mode */}
                        {chartYAxis === "value" && typeof plPct === "number" && (
                          <div
                            style={{
                              marginTop: 4,
                              paddingTop: 4,
                              borderTop: "1px solid hsl(var(--border))",
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              color: plPct >= 0 ? "#22c55e" : "#ef4444",
                            }}
                          >
                            <span>P/L:</span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>
                              {plPct >= 0 ? "+" : ""}
                              {plPct.toFixed(2)}%
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {/* Main aggregated line - switch between nav (value) and cumulativeReturn (TWR %) */}
                <Area
                  type="monotone"
                  dataKey={chartYAxis === "value" ? "nav" : "cumulativeReturn"}
                  stroke={chartYAxis === "value" ? "#60a5fa" : "#84cc16"}
                  strokeWidth={2}
                  fillOpacity={showAccountBreakdown && chartYAxis === "value" ? 0.1 : 1}
                  fill={chartYAxis === "value" ? "url(#colorNav)" : "url(#colorReturn)"}
                  name={chartYAxis === "value" ? "Portfolio Value" : "TWR Return"}
                  dot={false}
                />
                {/* Individual account lines (shown when breakdown is enabled - only for value view) */}
                {showAccountBreakdown && chartYAxis === "value" && Array.from(accountIds).map((accountId, index) => {
                  const colors = [
                    "hsl(var(--chart-1))",
                    "hsl(var(--chart-2))",
                    "hsl(var(--chart-3))",
                    "hsl(var(--chart-4))",
                    "hsl(var(--chart-5))",
                  ];
                  const color = colors[index % colors.length];
                  const alias = accountInfo.get(accountId) || accountId;
                  
                  return (
                    <Area
                      key={accountId}
                      type="monotone"
                      dataKey={accountId}
                      stroke={color}
                      strokeWidth={1.5}
                      fillOpacity={0}
                      strokeDasharray="3 3"
                      name={alias}
                    />
                  );
                })}
              </AreaChart>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No historical data available. Please ensure XML files contain data within the last 2 years.
                </div>
              )}
            </ResponsiveContainer>
          </div>

          {/* Fees/Income Sidebar */}
          <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Receipt className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold text-foreground">
                Fees & Income
              </h2>
            </div>

            <div className="space-y-4">
              {/* Dividends */}
              <div className="border-b border-border pb-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-muted-foreground">Dividends</span>
                  <span className="text-sm font-semibold text-green-500">
                    {formatCurrency(data.feesAndIncome.totalDividends)}
                  </span>
                </div>
              </div>

              {/* Interest */}
              <div className="border-b border-border pb-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-muted-foreground">Interest</span>
                  <span className="text-sm font-semibold text-green-500">
                    {formatCurrency(data.feesAndIncome.totalInterest)}
                  </span>
                </div>
              </div>

              {/* Credits */}
              {data.feesAndIncome.totalCredits > 0 && (
                <div className="border-b border-border pb-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-muted-foreground">Credits</span>
                    <span className="text-sm font-semibold text-green-500">
                      {formatCurrency(data.feesAndIncome.totalCredits)}
                    </span>
                  </div>
                </div>
              )}

              {/* Commissions */}
              <div className="border-b border-border pb-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-muted-foreground">Commissions</span>
                  <span className="text-sm font-semibold text-red-500">
                    -{formatCurrency(data.feesAndIncome.totalCommissions)}
                  </span>
                </div>
              </div>

              {/* Withholding Tax */}
              <div className="border-b border-border pb-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-muted-foreground">Withholding Tax</span>
                  <span className="text-sm font-semibold text-red-500">
                    -{formatCurrency(data.feesAndIncome.totalWithholdingTax)}
                  </span>
                </div>
              </div>

              {/* Other Fees */}
              {data.feesAndIncome.totalOtherFees > 0 && (
                <div className="border-b border-border pb-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-muted-foreground">Other Fees</span>
                    <span className="text-sm font-semibold text-red-500">
                      -{formatCurrency(data.feesAndIncome.totalOtherFees)}
                    </span>
                  </div>
                </div>
              )}

              {/* Gross Profit */}
              <div className="pt-3 border-t-2 border-border">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-foreground">Gross Profit</span>
                  <span className="text-sm font-semibold text-green-500">
                    {formatCurrency(data.feesAndIncome.grossProfit)}
                  </span>
                </div>
              </div>

              {/* Net Profit */}
              <div className="pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-base font-semibold text-foreground">Net Profit</span>
                  <span
                    className={cn(
                      "text-base font-bold",
                      data.feesAndIncome.netProfit >= 0
                        ? "text-green-500"
                        : "text-red-500"
                    )}
                  >
                    {formatCurrency(data.feesAndIncome.netProfit)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Time Period Performance — monthly bars */}
        <div className="mt-8 bg-card border border-border rounded-lg p-6 shadow-sm">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Time Period Performance</h2>
              {monthlyReturns.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(monthlyReturns[0].monthTs), "yyyy-MM-dd")} to{" "}
                  {format(new Date(monthlyReturns[monthlyReturns.length - 1].monthTs), "yyyy-MM-dd")}
                  <span className="ml-2 opacity-70">({monthlyReturns.length} months)</span>
                </p>
              )}
            </div>
            {/* Timeframe selector — same set as the main chart, independent state */}
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {(["1M", "3M", "6M", "1Y", "YTD", "All"] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setMonthlyTimeframe(tf)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                    monthlyTimeframe === tf
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            {monthlyReturns.length > 0 ? (
              <BarChart data={monthlyReturns} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
                <XAxis
                  dataKey="monthLabel"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                  width={60}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0].payload as any;
                    return (
                      <div
                        style={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "0.5rem",
                          padding: "0.5rem 0.75rem",
                          color: "hsl(var(--foreground))",
                          fontSize: "0.875rem",
                          minWidth: 200,
                        }}
                      >
                        <div style={{ marginBottom: 6, fontWeight: 500 }}>{row.monthLabel}</div>
                        {payload.map((p, i) => {
                          const v = p.value as number;
                          if (v == null || Number.isNaN(v)) return null;
                          return (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 12,
                                color: v >= 0 ? "#22c55e" : "#ef4444",
                              }}
                            >
                              <span style={{ color: p.color as string }}>■</span>
                              <span style={{ flex: 1, color: "hsl(var(--foreground))" }}>{p.name}:</span>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                                {v >= 0 ? "+" : ""}
                                {v.toFixed(2)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  iconType="square"
                  iconSize={10}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                {/* Per-account series first, aggregate last (rendered rightmost in each group). */}
                {_activeAccountIds.map((accId, i) => {
                  const ACCOUNT_PALETTE = ["#3b82f6", "#22c55e", "#f97316", "#ec4899", "#06b6d4", "#eab308"];
                  const color = ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length];
                  return (
                    <Bar
                      key={accId}
                      dataKey={accId}
                      name={accountInfo.get(accId) || accId}
                      fill={color}
                      radius={[3, 3, 0, 0]}
                    />
                  );
                })}
                {showAggregateBar && (
                  <Bar
                    dataKey={SCOPE_AGG}
                    name="Aggregate"
                    fill="#8b5cf6"
                    radius={[3, 3, 0, 0]}
                  />
                )}
              </BarChart>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No monthly data available for this timeframe.
              </div>
            )}
          </ResponsiveContainer>
        </div>

        {/* Holdings / Portfolio Distribution Tabs */}
        <div className="mt-8 bg-card border border-border rounded-lg p-6 shadow-sm">
          {/* Tab Navigation */}
          <div className="flex items-center gap-4 mb-6 border-b border-border">
            <button
              onClick={() => setHoldingsTab("holdings")}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                holdingsTab === "holdings"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Holdings
            </button>
            <button
              onClick={() => setHoldingsTab("distribution")}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                holdingsTab === "distribution"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Portfolio Distribution
            </button>
            <button
              onClick={() => setHoldingsTab("performance")}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                holdingsTab === "performance"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Holdings Performance
            </button>
          </div>

          {/* Holdings Tab Content */}
          {holdingsTab === "holdings" && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {(
                    [
                      { label: 'Symbol',         key: 'symbol',       align: 'left'   },
                      { label: 'Description',    key: null,           align: 'left'   },
                      { label: 'Position',       key: 'position',     align: 'right'  },
                      { label: 'Current Price',  key: 'currentPrice', align: 'right'  },
                      { label: 'Value',          key: 'value',        align: 'right'  },
                      { label: 'Cost Basis',     key: 'costBasis',    align: 'right'  },
                      { label: 'Unrealized P&L', key: 'unrealizedPnl',align: 'right'  },
                      { label: 'P&L %',          key: 'unrealizedPct',align: 'right'  },
                      { label: 'Accounts',       key: null,           align: 'center' },
                    ] as Array<{ label: string; key: HoldingsSortKey | null; align: string }>
                  ).map(({ label, key, align }) => (
                    <th
                      key={label}
                      className={cn(
                        `text-${align} py-3 px-4 text-sm font-semibold text-muted-foreground`,
                        key && "cursor-pointer select-none hover:text-foreground transition-colors"
                      )}
                      onClick={() => key && handleHoldingsSort(key)}
                    >
                      <span className="inline-flex items-center gap-1 justify-end w-full">
                        {align !== 'right' && label}
                        {key && holdingsSortKey === key && (
                          <span className="text-xs">{holdingsSortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                        {align === 'right' && label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPositions.map((position) => {
                  const isExpanded = expandedPositions.has(position.symbol);
                  const isCash = position.isCash;
                  const currentPrice = !isCash && position.totalPosition > 0
                    ? position.totalValue / position.totalPosition
                    : null;
                  const livePnl = position.totalValue - position.totalCostBasis;
                  const livePnlPct = position.totalCostBasis > 0
                    ? (livePnl / position.totalCostBasis) * 100
                    : null;
                  return (
                    <React.Fragment key={position.symbol}>
                      <tr
                        className={cn(
                          "border-b border-border hover:bg-muted/50",
                          !isCash && "cursor-pointer"
                        )}
                        onClick={() => !isCash && togglePosition(position.symbol)}
                      >
                        <td className={cn(
                          "py-3 px-4 font-medium",
                          isCash ? "text-blue-400" : "text-foreground"
                        )}>
                          {position.symbol}
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">
                          {position.description}
                        </td>
                        <td className="py-3 px-4 text-right text-sm text-foreground">
                          {isCash
                            ? formatCurrency(position.totalPosition)
                            : position.totalPosition.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right text-sm text-foreground">
                          {isCash ? "—" : currentPrice != null ? formatCurrency(currentPrice) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right text-sm font-medium text-foreground">
                          {formatCurrency(position.totalValue)}
                        </td>
                        <td className="py-3 px-4 text-right text-sm text-muted-foreground">
                          {formatCurrency(position.totalCostBasis)}
                        </td>
                        <td className={cn(
                          "py-3 px-4 text-right text-sm font-medium",
                          isCash ? "text-muted-foreground" : livePnl >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {isCash ? "—" : formatCurrency(livePnl)}
                        </td>
                        <td className={cn(
                          "py-3 px-4 text-right text-sm font-medium",
                          isCash || livePnlPct == null ? "text-muted-foreground"
                            : livePnlPct >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {isCash || livePnlPct == null ? "—" : `${livePnlPct >= 0 ? '+' : ''}${livePnlPct.toFixed(2)}%`}
                        </td>
                        <td className="py-3 px-4 text-center text-sm text-muted-foreground">
                          {!isCash && (
                            <>
                              {position.accounts.length} account
                              {position.accounts.length !== 1 ? "s" : ""}
                              {isExpanded ? " ▼" : " ▶"}
                            </>
                          )}
                          {isCash && `${position.accounts.length} account${position.accounts.length !== 1 ? "s" : ""}`}
                        </td>
                      </tr>
                      {isExpanded &&
                        position.accounts.map((account, idx) => {
                          const accPrice = !isCash && account.position > 0 ? account.value / account.position : null;
                          const accPnl = account.value - account.costBasis;
                          const accPnlPct = account.costBasis > 0 ? (accPnl / account.costBasis) * 100 : null;
                          return (
                          <tr
                            key={`${position.symbol}-${account.accountId}-${idx}`}
                            className="bg-muted/30 border-b border-border hover:bg-muted/50"
                          >
                            <td className="py-2 px-4 text-xs text-muted-foreground pl-8">
                              <span className="inline-block w-4">└─</span> {account.accountAlias}
                            </td>
                            <td className="py-2 px-4"></td>
                            <td className="py-2 px-4 text-right text-xs text-muted-foreground">
                              {isCash ? formatCurrency(account.position) : account.position.toFixed(2)}
                            </td>
                            <td className="py-2 px-4 text-right text-xs text-muted-foreground">
                              {isCash ? "—" : accPrice != null ? formatCurrency(accPrice) : "—"}
                            </td>
                            <td className="py-2 px-4 text-right text-xs text-muted-foreground">
                              {formatCurrency(account.value)}
                            </td>
                            <td className="py-2 px-4 text-right text-xs text-muted-foreground">
                              {formatCurrency(account.costBasis)}
                            </td>
                            <td className={cn(
                              "py-2 px-4 text-right text-xs font-medium",
                              isCash ? "text-muted-foreground" : accPnl >= 0 ? "text-green-500" : "text-red-500"
                            )}>
                              {isCash ? "—" : formatCurrency(accPnl)}
                            </td>
                            <td className={cn(
                              "py-2 px-4 text-right text-xs font-medium",
                              isCash || accPnlPct == null ? "text-muted-foreground"
                                : accPnlPct >= 0 ? "text-green-500" : "text-red-500"
                            )}>
                              {isCash || accPnlPct == null ? "—" : `${accPnlPct >= 0 ? '+' : ''}${accPnlPct.toFixed(2)}%`}
                            </td>
                            <td className="py-2 px-4"></td>
                          </tr>
                          );
                        })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          {/* Portfolio Distribution Tab Content */}
          {holdingsTab === "distribution" && data.combinedPositions && data.combinedPositions.length > 0 && (
            <div className="w-full">
              {/* Donut Chart */}
              <div className="relative flex justify-center items-center mb-8" style={{ minHeight: "400px" }}>
                <ResponsiveContainer width="100%" height={400}>
                  <PieChart>
                    <Pie
                      data={data.combinedPositions
                        .filter((p) => !p.isCash && p.totalValue > 0)
                        .map((p) => ({
                          name: p.symbol,
                          value: p.totalValue,
                          percent: p.totalPercentOfNAV,
                        }))
                        .sort((a, b) => b.value - a.value)}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => {
                        // Only show labels for larger segments (>5%)
                        if (percent * 100 > 5) {
                          return `${name} ${(percent * 100).toFixed(0)}%`;
                        }
                        return "";
                      }}
                      outerRadius={140}
                      innerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {data.combinedPositions
                        .filter((p) => !p.isCash && p.totalValue > 0)
                        .map((entry, index) => {
                          // Generate a color palette similar to TradingView
                          const colors = [
                            "#3b82f6", // blue
                            "#60a5fa", // light blue
                            "#f59e0b", // orange
                            "#a855f7", // purple
                            "#fbbf24", // yellow
                            "#ec4899", // pink
                            "#10b981", // green
                            "#ef4444", // red
                            "#06b6d4", // cyan
                            "#8b5cf6", // violet
                            "#14b8a6", // teal
                            "#f97316", // orange-red
                            "#6366f1", // indigo
                            "#84cc16", // lime
                            "#22c55e", // emerald
                            "#eab308", // amber
                            "#0ea5e9", // sky
                            "#6366f1", // indigo
                            "#a855f7", // purple
                            "#ec4899", // pink
                            "#f43f5e", // rose
                            "#06b6d4", // cyan
                            "#14b8a6", // teal
                          ];
                          return (
                            <Cell
                              key={`cell-${index}`}
                              fill={colors[index % colors.length]}
                            />
                          );
                        })}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string, props: any) => [
                        formatCurrency(value),
                        `${props.payload.name} (${(props.payload.percent * 100).toFixed(2)}%)`,
                      ]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center Text - Overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-foreground">
                      {data.combinedPositions.filter((p) => !p.isCash && p.totalValue > 0).length}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Total assets</div>
                  </div>
                </div>
              </div>

              {/* Asset List */}
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.combinedPositions
                  .filter((p) => !p.isCash && p.totalValue > 0)
                  .sort((a, b) => b.totalValue - a.totalValue)
                  .map((position, index) => {
                    const colors = [
                      "#3b82f6", "#60a5fa", "#f59e0b", "#a855f7", "#fbbf24",
                      "#ec4899", "#10b981", "#ef4444", "#06b6d4", "#8b5cf6",
                      "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#22c55e",
                      "#eab308", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899",
                      "#f43f5e", "#06b6d4", "#14b8a6",
                    ];
                    return (
                      <div
                        key={position.symbol}
                        className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                      >
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: colors[index % colors.length] }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground truncate">
                            {position.symbol}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {position.description}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-semibold text-foreground">
                            {position.totalPercentOfNAV.toFixed(1)}%
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatCurrency(position.totalValue)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Holdings Performance Tab Content */}
          {holdingsTab === "performance" && data.combinedPositions && data.combinedPositions.length > 0 && (
            <div className="w-full">
              {/* Sub-tabs for Performance */}
              <div className="flex items-center gap-4 mb-6 border-b border-border">
                <button
                  onClick={() => setPerformanceSubTab("all")}
                  className={cn(
                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                    performanceSubTab === "all"
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  All
                </button>
                <button
                  onClick={() => setPerformanceSubTab("dividends")}
                  className={cn(
                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                    performanceSubTab === "dividends"
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  Dividends
                </button>
              </div>

              {/* All Performance Tab */}
              {performanceSubTab === "all" && (
                <div className="w-full">
                  {/* Calculate performance data */}
                  {(() => {
                    const performanceData = data.combinedPositions
                      .filter((p) => !p.isCash && p.totalCostBasis > 0)
                      .map((p) => {
                        const performancePercent = (p.totalUnrealizedPnl / p.totalCostBasis) * 100;
                        return {
                          symbol: p.symbol,
                          description: p.description,
                          performancePercent,
                          unrealizedPnl: p.totalUnrealizedPnl,
                          value: p.totalValue,
                        };
                      })
                      .sort((a, b) => b.performancePercent - a.performancePercent);

                    const maxAbsPercent = Math.max(
                      ...performanceData.map((p) => Math.abs(p.performancePercent))
                    );

                    return (
                      <div className="space-y-2">
                        {performanceData.map((item, index) => {
                          const isPositive = item.performancePercent >= 0;
                          const barWidth = Math.abs(item.performancePercent) / maxAbsPercent * 100;
                          
                          return (
                            <div key={item.symbol} className="relative py-3 border-b border-border">
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 flex-shrink-0 min-w-[120px]">
                                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">
                                    {item.symbol.charAt(0)}
                                  </div>
                                  <div>
                                    <div className="font-medium text-foreground">{item.symbol}</div>
                                  </div>
                                </div>
                                <div className="flex-1 relative h-8 flex items-center">
                                  {/* Background bar */}
                                  <div className="absolute inset-0 flex items-center">
                                    <div
                                      className={cn(
                                        "h-6 rounded transition-all",
                                        isPositive ? "bg-green-500/20" : "bg-red-500/20"
                                      )}
                                      style={{
                                        width: `${barWidth}%`,
                                        marginLeft: isPositive ? "0" : `${100 - barWidth}%`,
                                      }}
                                    />
                                  </div>
                                  {/* Performance bar */}
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div
                                      className={cn(
                                        "h-6 rounded transition-all",
                                        isPositive ? "bg-green-500" : "bg-red-500"
                                      )}
                                      style={{
                                        width: `${barWidth}%`,
                                        marginLeft: isPositive ? "0" : `${100 - barWidth}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                                <div className={cn(
                                  "text-right font-semibold flex-shrink-0 min-w-[80px]",
                                  isPositive ? "text-green-500" : "text-red-500"
                                )}>
                                  {isPositive ? "+" : ""}{item.performancePercent.toFixed(2)}%
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Dividends Tab */}
              {performanceSubTab === "dividends" && (
                <div className="w-full">
                  {(() => {
                    // Aggregate dividends per symbol from cash transactions
                    const dividendMap = new Map<string, number>();
                    
                    for (const account of data.accounts) {
                      for (const ct of account.cashTransactions) {
                        const type = (ct.type || "").toLowerCase();
                        if (type.includes("dividend") && ct.symbol) {
                          const amountUSD = ct.amount * ct.fxRateToBase;
                          if (amountUSD > 0) {
                            const current = dividendMap.get(ct.symbol) || 0;
                            dividendMap.set(ct.symbol, current + amountUSD);
                          }
                        }
                      }
                    }

                    const dividendData = Array.from(dividendMap.entries())
                      .map(([symbol, amount]) => {
                        const position = data.combinedPositions.find((p) => p.symbol === symbol);
                        return {
                          symbol,
                          description: position?.description || symbol,
                          dividend: amount,
                        };
                      })
                      .filter((item) => item.dividend > 0)
                      .sort((a, b) => b.dividend - a.dividend);

                    const maxDividend = Math.max(...dividendData.map((d) => d.dividend), 1);

                    return (
                      <div className="space-y-2">
                        {dividendData.length > 0 ? (
                          dividendData.map((item, index) => {
                            const barWidth = (item.dividend / maxDividend) * 100;
                            
                            return (
                              <div key={item.symbol} className="relative py-3 border-b border-border">
                                <div className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-3 flex-shrink-0 min-w-[120px]">
                                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">
                                      {item.symbol.charAt(0)}
                                    </div>
                                    <div>
                                      <div className="font-medium text-foreground">{item.symbol}</div>
                                    </div>
                                  </div>
                                  <div className="flex-1 relative h-8 flex items-center">
                                    {/* Background bar */}
                                    <div className="absolute inset-0 flex items-center">
                                      <div
                                        className="h-6 rounded bg-teal-500/20 transition-all"
                                        style={{ width: `${barWidth}%` }}
                                      />
                                    </div>
                                    {/* Dividend bar */}
                                    <div className="absolute inset-0 flex items-center">
                                      <div
                                        className="h-6 rounded bg-teal-500 transition-all"
                                        style={{ width: `${barWidth}%` }}
                                      />
                                    </div>
                                  </div>
                                  <div className="text-right font-semibold text-green-500 flex-shrink-0 min-w-[100px]">
                                    +{formatCurrency(item.dividend)}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-center text-muted-foreground py-8">
                            No dividend data available
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
        </main>
      </div>
    </div>
  );
}

