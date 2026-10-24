/**
 * Server-side calculations utility
 * All heavy calculations (TWR, currency conversions, net worth summations, chart data processing)
 * should be performed here on the server, not in client-side useEffect hooks.
 */

import type { EquityCurvePoint, AggregatedData } from './types';
import { format, startOfYear, subDays, subMonths, subYears } from 'date-fns';

/**
 * Process chart data for client display
 * This performs all the filtering, timeframe processing, and normalization server-side
 */
export function processChartData(
  equityCurve: EquityCurvePoint[],
  options: {
    showFullTimeline: boolean;
    timeframe: "1D" | "3D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "All";
    chartYAxis: "value" | "return";
    liveNAV?: number | null;
    liveTWR?: number | null;
    liveSimpleReturn?: number | null;
  }
): Array<{
  date: Date;
  dateTimestamp: number;
  nav: number;
  cumulativeReturn: number;
  positiveReturn: number | null;
  negativeReturn: number | null;
  simpleReturn: number;
  cumulativeContributions: number;
  [key: string]: any;
}> {
  if (!equityCurve || equityCurve.length === 0) return [];

  // Convert equity curve to chart data format
  const allChartData = equityCurve.map((point) => {
    const dateObj = point.date instanceof Date ? point.date : new Date(point.date);
    const simpleReturn = point.simpleReturn !== undefined 
      ? point.simpleReturn 
      : (point.cumulativeContributions && point.cumulativeContributions > 0)
        ? ((point.nav - point.cumulativeContributions) / point.cumulativeContributions) * 100
        : 0;
    
    const cumulativeReturn = point.cumulativeReturn || 0;
    return {
      date: dateObj,
      dateTimestamp: dateObj.getTime(),
      nav: point.nav,
      cumulativeReturn: cumulativeReturn,
      positiveReturn: cumulativeReturn >= 0 ? cumulativeReturn : null,
      negativeReturn: cumulativeReturn < 0 ? cumulativeReturn : null,
      simpleReturn: simpleReturn,
      cumulativeContributions: point.cumulativeContributions || 0,
      cashFlow: point.cashFlow || 0, // Cash flow amount (positive = deposit, negative = withdrawal)
      isInternalTransfer: point.isInternalTransfer || false, // True if this is an internal transfer
      ...(point.accountBreakdown || {}),
    };
  });

  // Find first non-zero NAV date for zoom to content
  const firstNonZeroNavIndex = allChartData.findIndex(p => p.nav > 0);
  const firstNonZeroNavDate = firstNonZeroNavIndex >= 0 ? allChartData[firstNonZeroNavIndex].date : null;
  
  // Filter chart data based on zoom toggle
  let chartData = options.showFullTimeline 
    ? allChartData 
    : (firstNonZeroNavIndex >= 0 ? allChartData.slice(firstNonZeroNavIndex) : allChartData);

  // Filter chart data based on timeframe selection
  if (options.timeframe !== "All" && chartData.length > 0) {
    const now = new Date();
    let startDate: Date;
    let endDate: Date | null = null;
    
    switch (options.timeframe) {
      case "1D":
        startDate = subDays(now, 1);
        endDate = now;
        break;
      case "3D":
        startDate = subDays(now, 3);
        endDate = now;
        break;
      case "1W":
        startDate = subDays(now, 7);
        endDate = now;
        break;
      case "1M":
        startDate = subMonths(now, 1);
        endDate = now;
        break;
      case "3M":
        startDate = subMonths(now, 3);
        endDate = now;
        break;
      case "6M":
        startDate = subMonths(now, 6);
        endDate = now;
        break;
      case "YTD":
        startDate = startOfYear(now);
        endDate = now;
        break;
      case "1Y":
        startDate = subYears(now, 1);
        endDate = now;
        break;
      default:
        startDate = chartData[0].date instanceof Date ? chartData[0].date : new Date(chartData[0].date);
    }
    
    const startOfDay = (date: Date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    };
    
    const normalizedStartDate = startOfDay(startDate);
    const normalizedEndDate = endDate ? startOfDay(endDate) : null;
    
    chartData = chartData.filter(point => {
      const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
      const normalizedPointDate = startOfDay(pointDate);
      const afterStart = normalizedPointDate >= normalizedStartDate;
      const beforeEnd = normalizedEndDate === null ? true : normalizedPointDate <= normalizedEndDate;
      return afterStart && beforeEnd;
    });
    
    // For non-"All" timeframes, update the last point with live data if available
    if (chartData.length > 0 && options.liveTWR !== null && options.chartYAxis === "return") {
      const lastPoint = chartData[chartData.length - 1];
      const now = new Date();
      const lastPointDate = lastPoint.date instanceof Date ? lastPoint.date : new Date(lastPoint.date);
      
      const daysDiff = Math.abs(now.getTime() - lastPointDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff <= 1) {
        chartData[chartData.length - 1] = {
          ...lastPoint,
          cumulativeReturn: options.liveTWR ?? lastPoint.cumulativeReturn,
          positiveReturn: options.liveTWR !== undefined && options.liveTWR >= 0 ? options.liveTWR : null,
          negativeReturn: options.liveTWR !== undefined && options.liveTWR < 0 ? options.liveTWR : null,
        };
      }
    }
    
    // Normalize returns to start from 0% at the beginning of the timeframe
    if (chartData.length > 0 && options.chartYAxis === "return") {
      const firstReturn = chartData[0].cumulativeReturn || 0;
      const firstPositiveReturn = chartData[0].positiveReturn ?? 0;
      const firstNegativeReturn = chartData[0].negativeReturn ?? 0;
      const firstSimpleReturn = chartData[0].simpleReturn || 0;
      
      chartData = chartData.map(point => ({
        ...point,
        cumulativeReturn: (point.cumulativeReturn || 0) - firstReturn,
        positiveReturn: point.positiveReturn !== null ? (point.positiveReturn - firstPositiveReturn) : null,
        negativeReturn: point.negativeReturn !== null ? (point.negativeReturn - firstNegativeReturn) : null,
        simpleReturn: (point.simpleReturn || 0) - firstSimpleReturn,
      }));
    }
  }
  
  // Add live data point overlay if available (for "All" timeframe)
  if (options.timeframe === "All" && options.liveNAV !== null && options.liveNAV !== undefined) {
    const now = new Date();
    const liveTWRReturn = options.liveTWR !== null ? options.liveTWR : (equityCurve.length > 0 
      ? (equityCurve[equityCurve.length - 1].cumulativeReturn || 0)
      : 0);
    const livePoint: any = {
      date: now,
      dateTimestamp: now.getTime(),
      nav: options.liveNAV,
      liveNav: options.liveNAV,
      cumulativeReturn: liveTWRReturn,
      positiveReturn: liveTWRReturn !== undefined && liveTWRReturn >= 0 ? liveTWRReturn : null,
      negativeReturn: liveTWRReturn !== undefined && liveTWRReturn < 0 ? liveTWRReturn : null,
      liveReturn: options.liveSimpleReturn !== null ? options.liveSimpleReturn : 0,
      simpleReturn: options.liveSimpleReturn !== null ? options.liveSimpleReturn : 0,
      benchmarkReturn: null,
    };
    chartData = [...chartData, livePoint];
  }

  return chartData;
}

/**
 * Calculate YTD metrics using true Time-Weighted Return (TWR).
 *
 * The equity curve is split into sub-periods at every external cash flow
 * (deposit or withdrawal, identified by cashFlow !== 0 && !isInternalTransfer).
 * Internal transfers between accounts are intentionally excluded — they are
 * performance, not external capital injections.
 *
 * For N external cash-flow events the calculation produces N+1 sub-periods:
 *   Period 1:  Jan 1 NAV  →  NAV on day before first deposit
 *   Period 2:  (NAV before deposit + deposit) → NAV before next deposit
 *   …
 *   Period N+1: last deposit adjusted NAV → currentNAV (live)
 *
 * TWR = (1 + r1) × (1 + r2) × … × (1 + rN+1) − 1
 *
 * ytdValue (dollar gain) is back-calculated from TWR% × starting capital so
 * it reflects pure market performance on Jan-1 capital.
 *
 * Works identically for a single account or an aggregated multi-account
 * equity curve — the cashFlow field already reflects the scoped total.
 */
export function calculateYTDMetrics(
  equityCurve: EquityCurvePoint[],
  currentNAV: number,
  /** @deprecated – no longer used; kept for call-site compatibility */
  _periodNetContributions: number = 0
): {
  ytdReturn: number | null;
  ytdValue: number | null;
} {
  if (!equityCurve || equityCurve.length === 0) {
    return { ytdReturn: null, ytdValue: null };
  }

  const currentYear = new Date().getFullYear();
  const jan1st = new Date(currentYear, 0, 1);

  // ── 1. Slice the equity curve to YTD points only ──────────────────────────
  // Find the index of the first point on or after Jan 1 of the current year.
  let startIndex = equityCurve.findIndex(p => {
    const d = p.date instanceof Date ? p.date : new Date(p.date);
    return d >= jan1st;
  });
  if (startIndex === -1) {
    // All points are before this year – nothing to compute.
    return { ytdReturn: null, ytdValue: null };
  }

  // The Jan-1 NAV is the NAV of the last point before the current year,
  // i.e. the Dec-31 closing value.
  const jan1Nav = startIndex > 0
    ? (equityCurve[startIndex - 1].nav || 0)
    : (equityCurve[startIndex].nav || 0);

  if (jan1Nav <= 0) return { ytdReturn: null, ytdValue: null };

  // YTD slice: from startIndex to end, plus append a synthetic endpoint with
  // currentNAV so the final sub-period uses the live price.
  const ytdPoints = equityCurve.slice(startIndex);

  // ── 2. Collect external cash-flow events within the YTD window ───────────
  // A cash-flow event is any point where cashFlow != 0 AND !isInternalTransfer.
  // We record the NAV just BEFORE the flow (prev point's NAV) and the flow amount.
  interface FlowEvent {
    dateStr: string;
    navBefore: number; // NAV of the point immediately before this one (end of prior sub-period)
    navAfter: number;  // NAV on the day the flow is recorded (start of next sub-period)
    cashFlow: number;
  }

  const flowEvents: FlowEvent[] = [];

  for (let i = 0; i < ytdPoints.length; i++) {
    const pt = ytdPoints[i];
    const flow = pt.cashFlow ?? 0;
    const isExternal = !pt.isInternalTransfer;
    if (Math.abs(flow) >= 1 && isExternal) {
      const navBefore = i > 0 ? ytdPoints[i - 1].nav : jan1Nav;
      flowEvents.push({
        dateStr: (pt.date instanceof Date ? pt.date : new Date(pt.date)).toISOString().split('T')[0],
        navBefore,
        navAfter: pt.nav,
        cashFlow: flow,
      });
    }
  }

  // ── 3. Chain sub-period returns ───────────────────────────────────────────
  // Sub-periods:
  //   [Jan1, first flow day)  → r0 = navBefore_flow1 / jan1Nav − 1
  //   [flow1, flow2)          → r1 = navBefore_flow2 / (navAfter_flow1 + flow1) − 1 ...
  //   wait – the equity curve's NAV on the flow day already INCLUDES the deposit.
  //   So navAfter = nav on the deposit day (includes deposit).
  //   Sub-period end = navBefore of next flow (or currentNAV if last period).
  //   Sub-period start basis = navBefore of this flow + cashFlow  (= navAfter, since
  //     navAfter ≈ navBefore + cashFlow when market was flat that day, but we use
  //     the explicit formula to be exact).

  let cumulativeMultiplier = 1.0;

  if (flowEvents.length === 0) {
    // No external cash flows this year – simple return
    const r = (currentNAV / jan1Nav) - 1;
    cumulativeMultiplier = 1 + r;
  } else {
    // Sub-period 0: Jan 1 → day before first flow
    const r0 = flowEvents[0].navBefore / jan1Nav - 1;
    cumulativeMultiplier *= (1 + r0);

    // Sub-periods between consecutive flows
    for (let i = 0; i < flowEvents.length; i++) {
      const ev = flowEvents[i];
      // Basis at the start of this sub-period = NAV before + cash flow injected
      const basisAfterFlow = ev.navBefore + ev.cashFlow;

      // End NAV for this sub-period = navBefore of next flow, or currentNAV
      const endNav = i + 1 < flowEvents.length
        ? flowEvents[i + 1].navBefore
        : currentNAV;

      if (basisAfterFlow > 0) {
        const r = endNav / basisAfterFlow - 1;
        cumulativeMultiplier *= (1 + r);
      }
    }
  }

  const ytdReturnPercent = (cumulativeMultiplier - 1) * 100;
  // Dollar gain expressed as: what jan1Nav capital grew to through market return alone
  const ytdValueDollar = jan1Nav * (cumulativeMultiplier - 1);

  return {
    ytdReturn: ytdReturnPercent,
    ytdValue: ytdValueDollar,
  };
}

/**
 * Calculate MTD (Month to Date) metrics from equity curve
 */
export function calculateMTDMetrics(
  equityCurve: EquityCurvePoint[],
  currentNAV: number,
  /**
   * Net external cash flows recorded this MTD (deposits − withdrawals) in USD.
   * Subtracted so a same-month deposit doesn't masquerade as MTD performance.
   * Defaults to 0.
   */
  periodNetContributions: number = 0
): {
  mtdReturn: number | null;
  mtdValue: number | null;
} {
  if (!equityCurve || equityCurve.length === 0) {
    return { mtdReturn: null, mtdValue: null };
  }

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  // Find the NAV on or closest to the first of the current month
  let firstOfMonthNav: number | null = null;
  for (const point of equityCurve) {
    const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
    if (pointDate >= firstOfMonth) {
      const prevIndex = equityCurve.indexOf(point) - 1;
      if (prevIndex >= 0) {
        firstOfMonthNav = equityCurve[prevIndex].nav || 0;
      } else {
        firstOfMonthNav = point.nav || 0;
      }
      break;
    }
  }
  
  // If we didn't find first of month data, use the first available point of the month
  if (firstOfMonthNav === null) {
    const firstPointOfMonth = equityCurve.find(p => {
      const pointDate = p.date instanceof Date ? p.date : new Date(p.date);
      return pointDate.getFullYear() === now.getFullYear() && 
             pointDate.getMonth() === now.getMonth();
    });
    firstOfMonthNav = firstPointOfMonth?.nav || equityCurve[0]?.nav || 0;
  }
  
  if (firstOfMonthNav > 0) {
    // Strip out MTD contributions so deposits/withdrawals don't get reported
    // as monthly performance.
    const mtdValueDollar = currentNAV - firstOfMonthNav - periodNetContributions;
    const baseline = firstOfMonthNav + periodNetContributions;
    const mtdReturnPercent = baseline > 0 ? (mtdValueDollar / baseline) * 100 : 0;
    return {
      mtdReturn: mtdReturnPercent,
      mtdValue: mtdValueDollar,
    };
  }

  return { mtdReturn: null, mtdValue: null };
}

/**
 * Calculate today's gain/loss metrics
 * Compares current (live) NAV vs last recorded NAV in database
 * 
 * @param equityCurve - Equity curve (may already have today's live NAV added)
 * @param currentNAV - Current live NAV value
 * @param lastRecordedNav - Optional: Last recorded NAV from database (before live update). 
 *                          If not provided, will try to find the last non-today point in equity curve.
 */
export function calculateTodayMetrics(
  equityCurve: EquityCurvePoint[],
  currentNAV: number,
  lastRecordedNav?: number | null,
  /**
   * Net external cash flows recorded today (deposits − withdrawals) in USD.
   * Subtracted from (currentNAV − lastDbNav) so a same-day $50k deposit
   * doesn't get reported as $50k of "Today" P&L. Defaults to 0.
   */
  todayNetContributions: number = 0
): {
  todayGainLoss: number | null;
  todayGainLossPercent: number | null;
} {
  if (!equityCurve || equityCurve.length === 0) {
    return { todayGainLoss: null, todayGainLossPercent: null };
  }

  // If lastRecordedNav is provided, use it directly
  let lastDbNav: number | null = null;
  
  if (lastRecordedNav !== undefined && lastRecordedNav !== null && lastRecordedNav > 0) {
    lastDbNav = lastRecordedNav;
  } else {
    // Try to find the last recorded NAV from database (not today's live NAV)
    // Look for the last point that is NOT today
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Go backwards through the equity curve to find the last non-today point
    for (let i = equityCurve.length - 1; i >= 0; i--) {
      const point = equityCurve[i];
      const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
      const pointDateStr = pointDate.toISOString().split('T')[0];
      
      if (pointDateStr !== todayStr && point.nav > 0) {
        lastDbNav = point.nav;
        break;
      }
    }
    
    // If we still didn't find a non-today point, use the second-to-last point
    // (assuming the last point is today's live NAV)
    if (lastDbNav === null && equityCurve.length > 1) {
      const secondToLast = equityCurve[equityCurve.length - 2];
      if (secondToLast && secondToLast.nav > 0) {
        lastDbNav = secondToLast.nav;
      }
    }
    
    // Last resort: use the last point if it's the only one
    if (lastDbNav === null && equityCurve.length > 0) {
      const lastPoint = equityCurve[equityCurve.length - 1];
      const lastPointDate = lastPoint.date instanceof Date ? lastPoint.date : new Date(lastPoint.date);
      const lastPointDateStr = lastPointDate.toISOString().split('T')[0];
      
      // Only use it if it's NOT today (to avoid comparing live NAV to itself)
      if (lastPointDateStr !== todayStr && lastPoint.nav > 0) {
        lastDbNav = lastPoint.nav;
      }
    }
  }

  if (lastDbNav !== null && lastDbNav > 0) {
    // Strip out same-day deposits/withdrawals so contributions aren't reported
    // as profit. Day return % is measured against (lastDbNav + contributions)
    // — the size of the portfolio that was actually at risk today.
    const todayChange = currentNAV - lastDbNav - todayNetContributions;
    const baseline = lastDbNav + todayNetContributions;
    const todayChangePercent = baseline > 0 ? (todayChange / baseline) * 100 : 0;
    return {
      todayGainLoss: todayChange,
      todayGainLossPercent: todayChangePercent,
    };
  }

  return { todayGainLoss: null, todayGainLossPercent: null };
}

/**
 * Merge benchmark data with chart data
 */
export function mergeBenchmarkData(
  chartData: Array<any>,
  benchmarkData: Array<{ date: number; value: number }>,
  timeframe: "1D" | "3D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "All"
): Array<any> {
  if (benchmarkData.length === 0) {
    return chartData.map(point => ({
      ...point,
      benchmarkReturn: null,
    }));
  }

  // Create a map of benchmark data by date (rounded to day)
  const benchmarkMap = new Map<number, number>();
  benchmarkData.forEach(point => {
    const date = new Date(point.date);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    benchmarkMap.set(dayStart, point.value);
  });
  
  // Normalize benchmark to start from 0% if timeframe is selected
  let firstBenchmarkValue = 0;
  if (timeframe !== "All" && chartData.length > 0) {
    const firstPointDate = chartData[0].date instanceof Date ? chartData[0].date : new Date(chartData[0].date);
    const firstDayStart = new Date(firstPointDate.getFullYear(), firstPointDate.getMonth(), firstPointDate.getDate()).getTime();
    firstBenchmarkValue = benchmarkMap.get(firstDayStart) ?? 0;
  }
  
  // Add benchmark return to each chart data point, normalized to start from 0%
  return chartData.map(point => {
    const date = point.date instanceof Date ? point.date : new Date(point.date);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const benchmarkReturn = benchmarkMap.get(dayStart) ?? null;
    
    return {
      ...point,
      benchmarkReturn: benchmarkReturn !== null ? benchmarkReturn - firstBenchmarkValue : null,
    };
  });
}

/**
 * Calculate daily return using Modified Dietz method for flow days
 * NOTE: This function is currently DISABLED in favor of Valuation-at-Flow method
 * Kept for reference but not used in the main calculation
 */
export function calculateDailyReturnModifiedDietz(
  prevNAV: number,
  currNAV: number,
  cashFlow: number
): number {
  // Modified Dietz formula: R = (Ending - Starting - CashFlow) / (Starting + Weight * CashFlow)
  // Weight = 0.5 assumes cash flow occurs mid-day (average time-weighted)
  const weight = 0.5;
  const denominator = prevNAV + (weight * cashFlow);
  
  if (denominator > 0) {
    const numerator = currNAV - prevNAV - cashFlow;
    const dailyReturn = numerator / denominator;
    
    if (!isFinite(dailyReturn)) {
      return prevNAV > 0 ? (currNAV / prevNAV) - 1 : 0;
    }
    
    return dailyReturn;
  }
  
  return prevNAV > 0 ? (currNAV / prevNAV) - 1 : 0;
}

/**
 * Check if cash flow appears to have a timing lag (deposit recorded but NAV hasn't reflected it yet)
 * 
 * @param prevNAV - Previous day's closing NAV
 * @param currNAV - Current day's closing NAV
 * @param cashFlow - Cash flow amount (positive for deposits, negative for withdrawals)
 * @returns true if cash flow appears to lag (NAV doesn't reflect it yet), false otherwise
 */
export function detectCashFlowLag(
  prevNAV: number,
  currNAV: number,
  cashFlow: number
): boolean {
  if (Math.abs(cashFlow) < 1) {
    return false; // No cash flow to check
  }
  
  const navChange = currNAV - prevNAV;
  const expectedNAVWithFlow = prevNAV + cashFlow;
  
  // SENSITIVITY CHECK: Only trigger if TodayEndingNAV is closer to YesterdayNAV than to (YesterdayNAV + CashFlow)
  // This ensures we only shift when the NAV clearly hasn't reflected the deposit yet
  // Distance to YesterdayNAV
  const distanceToPrevNAV = Math.abs(currNAV - prevNAV);
  // Distance to expected NAV with flow
  const distanceToExpectedNAV = Math.abs(currNAV - expectedNAVWithFlow);
  
  // Only detect lag if NAV is closer to yesterday's NAV than to the expected NAV with the flow
  // This means the deposit clearly hasn't been reflected yet
  const isCloserToPrevNAV = distanceToPrevNAV < distanceToExpectedNAV;
  
  // Additional check: NAV change should be much smaller than the cash flow
  // For a deposit to be lagged, the NAV shouldn't have jumped significantly
  const navChangeVsCashFlowRatio = Math.abs(cashFlow) > 1 ? Math.abs(navChange / cashFlow) : 1;
  const navChangeIsMuchSmaller = navChangeVsCashFlowRatio < 0.3; // NAV change is <30% of cash flow
  
  // Only detect lag if both conditions are met
  const hasLag = isCloserToPrevNAV && navChangeIsMuchSmaller && Math.abs(cashFlow) > 1000;
  
  if (hasLag && Math.abs(cashFlow) > 10000) {
    console.log(`[CRITICAL-DEBUG-V3] [LAG-DETECTION] Cash flow lag detected:`);
    console.log(`[CRITICAL-DEBUG-V3] [LAG-DETECTION]   Cash Flow: ${cashFlow}, NAV Change: ${navChange}`);
    console.log(`[CRITICAL-DEBUG-V3] [LAG-DETECTION]   Distance to PrevNAV: ${distanceToPrevNAV.toFixed(2)}, Distance to ExpectedNAV: ${distanceToExpectedNAV.toFixed(2)}`);
    console.log(`[CRITICAL-DEBUG-V3] [LAG-DETECTION]   NAV is closer to PrevNAV: ${isCloserToPrevNAV}, NAV change is much smaller: ${navChangeIsMuchSmaller} (ratio: ${navChangeVsCashFlowRatio.toFixed(3)})`);
  }
  
  return hasLag;
}

/**
 * Calculate daily return using Valuation-at-Flow methodology
 * SPLIT THE FLOW DAY: For any day with an external deposit/withdrawal, split into two sub-periods
 * 
 * [CRITICAL-DEBUG-V3] VALUATION-AT-FLOW METHOD - NO FALLBACK
 * Includes lag detection to prevent -62% cliffs when deposits are recorded before NAV reflects them
 * 
 * Sub-Period 1 (Pre-Flow): Calculate return from Yesterday's NAV to Today's Pre-Flow Value
 *   Formula: ReturnA = (TodayPreFlowValue / YesterdayNAV) - 1
 * 
 * Sub-Period 2 (Post-Flow): Calculate return from (Pre-Flow Value + Cash Flow) to Today's Ending NAV
 *   Formula: ReturnB = (TodayEndingNAV / (TodayPreFlowValue + TodayCashFlow)) - 1
 * 
 * Chain the Day: Daily Return = ((1 + ReturnA) * (1 + ReturnB)) - 1
 * 
 * ARTIFICIAL PRE-FLOW: Since we don't have intraday data, explicitly set:
 *   TodayPreFlowValue = YesterdayNAV
 * 
 * This forces the calculation to assume all market movement happened BEFORE the deposit,
 * which mathematically kills the cliff spike.
 * 
 * With PreFlowValue = YesterdayNAV:
 *   ReturnA = (YesterdayNAV / YesterdayNAV) - 1 = 0
 *   ReturnB = (TodayEndingNAV / (YesterdayNAV + CashFlow)) - 1
 *   Daily Return = (1 + 0) * (1 + ReturnB) - 1 = ReturnB
 * 
 * Equivalent formula: Return = (TodayEndingNAV - TodayCashFlow) / YesterdayNAV - 1
 * This treats the deposit as if it arrived at the very end of the day, making it impossible
 * for the deposit to dilute daily performance and cause a cliff.
 * 
 * @param prevNAV - Previous day's closing NAV (Yesterday's NAV)
 * @param currNAV - Current day's closing NAV (Today's Ending NAV)
 * @param cashFlow - External cash flow amount (positive for deposits, negative for withdrawals)
 *                   NOTE: Internal transfers should be excluded and handled separately in TWR calculation
 * @returns Object with { return: number, hasLag: boolean } where return is daily return as a decimal (e.g., 0.05 for 5%)
 */
export function calculateDailyReturn(
  prevNAV: number,
  currNAV: number,
  cashFlow: number
): { return: number; hasLag: boolean } {
  // If no cash flow, use simple return calculation (market movement only)
  if (Math.abs(cashFlow) < 1) {
    const simpleReturn = prevNAV > 0 ? (currNAV / prevNAV) - 1 : 0;
    return { return: simpleReturn, hasLag: false };
  }
  
  // CHECK FOR LAG: Before calculating, check if TodayEndingNAV appears to NOT yet include the deposit
  // If TodayEndingNAV is significantly lower than (YesterdayNAV + TodayCashFlow), the deposit hasn't arrived in the balance yet
  // NOTE: Lag detection should be done in the calling code BEFORE calling this function to handle shifting
  // This function will still detect lag as a safety check, but the calling code handles the shifting
  const hasLag = detectCashFlowLag(prevNAV, currNAV, cashFlow);
  
  if (hasLag) {
    // Cash flow lag detected - treat this day as if there's no cash flow (lag already handled by caller)
    const simpleReturn = prevNAV > 0 ? (currNAV / prevNAV) - 1 : 0;
    return { return: simpleReturn, hasLag: true };
  }
  
  // IDENTIFY FLOW DAYS: TodayCashFlow != 0 (external deposit/withdrawal)
  // Use Valuation-at-Flow method with Artificial Pre-Flow assumption
  
  // Calculate NAV change for the day
  const navChange = currNAV - prevNAV;
  
  // Check if NAV change closely matches cash flow (indicates flat market)
  const cashFlowMatchesNavChange = Math.abs(navChange - cashFlow) / Math.max(Math.abs(cashFlow), Math.abs(navChange), 1) < 0.05;
  
  if (cashFlowMatchesNavChange && Math.abs(cashFlow) > 100) {
    // NAV change equals cash flow (flat market) - return should be 0%
    return { return: 0, hasLag: false };
  }
  
  // ARTIFICIAL PRE-FLOW: Set TodayPreFlowValue = YesterdayNAV
  // This assumes all market movement happened BEFORE the deposit
  // By setting PreFlowValue = YesterdayNAV, the daily return formula becomes:
  // Return = (TodayEndingNAV - TodayCashFlow) / YesterdayNAV - 1
  // This formula treats the deposit as if it arrived at the very end of the day,
  // making it impossible for the deposit to dilute your daily performance and cause a cliff.
  const todayPreFlowValue = prevNAV;
  
  // Sub-Period 1 (Pre-Flow): Calculate return from Yesterday's NAV to Today's Pre-Flow Value
  // ReturnA = (TodayPreFlowValue / YesterdayNAV) - 1
  // Since TodayPreFlowValue = YesterdayNAV, ReturnA = (YesterdayNAV / YesterdayNAV) - 1 = 0
  const returnA = 0;
  
  // Sub-Period 2 (Post-Flow): With PreFlowValue = YesterdayNAV, all market movement is in post-flow period
  // Since we're assuming market movement happened BEFORE the deposit, we use the direct formula:
  // Return = (TodayEndingNAV - TodayCashFlow) / YesterdayNAV - 1
  // This is equivalent to treating the deposit as arriving at the end of the day
  let dailyReturn = 0;
  if (prevNAV > 0) {
    // Direct formula: Return = (TodayEndingNAV - TodayCashFlow) / YesterdayNAV - 1
    dailyReturn = ((currNAV - cashFlow) / prevNAV) - 1;
  } else {
    const fallbackReturn = prevNAV > 0 ? (currNAV / prevNAV) - 1 : 0;
    return { return: fallbackReturn, hasLag: false };
  }
  
  // Validate return is finite
  if (!isFinite(dailyReturn)) {
    return { return: 0, hasLag: false };
  }
  
  // Clamp extreme returns (safety check)
  const clampedReturn = Math.max(-0.99, Math.min(10, dailyReturn));
  return { return: clampedReturn, hasLag: false };
}


