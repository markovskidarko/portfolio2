/**
 * Risk Analytics Module (v4.0)
 * Institutional risk metrics, Maximum Drawdown, and Value at Risk calculations
 */

import { formatCurrency } from './utils';

// Standardized Risk-Free Rate: 4.0% annual
const ANNUAL_RISK_FREE_RATE = 0.04;
const TRADING_DAYS_PER_YEAR = 252;
const DAILY_RISK_FREE_RATE = ANNUAL_RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;

export interface DailyReturn {
  date: Date;
  nav: number;
  return: number; // Daily return percentage (e.g., 0.01 = 1%)
}

export interface DrawdownPoint {
  date: Date;
  drawdown: number; // Drawdown percentage (negative value, e.g., -0.15 = -15%)
  peakDate: Date;
  peakNav: number;
}

export interface DrawdownPeriod {
  peakDate: Date;
  peakValue: number;
  troughDate: Date;
  troughValue: number;
  recoveryDate: Date | null; // null if not yet recovered
  duration: number; // Days from peak to recovery (or to end if not recovered)
  drawdownPercent: number; // Negative percentage (e.g., -0.15 = -15%)
}

export interface RecoveryAnalytics {
  drawdownPeriods: DrawdownPeriod[];
  averageRecoveryTime: number | null; // Average days to recover (only for recovered periods)
  currentRecoveryStatus: {
    isInDrawdown: boolean;
    currentDrawdown: DrawdownPeriod | null;
    daysSincePeak: number | null;
  };
}

export interface RiskAnalytics {
  // Annualized metrics
  annualizedReturn: number; // Annualized mean return
  annualizedVolatility: number; // Annualized standard deviation
  annualizedDownsideVolatility: number; // Annualized downside deviation
  
  // Risk-adjusted returns
  sharpeRatio: number; // Annualized Sharpe Ratio
  sortinoRatio: number; // Annualized Sortino Ratio
  treynorRatio: number; // Treynor Ratio (requires beta)
  
  // Beta (portfolio sensitivity to benchmark)
  beta: number | null; // Beta relative to S&P 500
  
  // Maximum Drawdown
  maxDrawdown: number; // Maximum drawdown percentage (negative value)
  maxDrawdownStartDate: Date | null;
  maxDrawdownEndDate: Date | null;
  maxDrawdownPeakNav: number | null;
  maxDrawdownTroughNav: number | null;
  
  // Drawdown series (for underwater chart)
  drawdownSeries: DrawdownPoint[];
  
  // Value at Risk
  var95: number; // 95% VaR as percentage (negative value)
  var99: number; // 99% VaR as percentage (negative value)
  var95Dollar: number; // 95% VaR in dollar terms (based on current wealth)
  var99Dollar: number; // 99% VaR in dollar terms (based on current wealth)
  
  // Recovery Analytics
  recoveryAnalytics?: RecoveryAnalytics;
}

/**
 * Calculate daily returns from NAV history, neutralizing cash flows
 * Cash flows are treated as occurring at the beginning of day (BOD)
 */
export function calculateDailyReturns(
  dailyNavHistory: Array<{ date: Date; nav: number }>,
  cashFlows: Map<string, number> // date string -> cash flow amount
): DailyReturn[] {
  const returns: DailyReturn[] = [];
  
  if (dailyNavHistory.length < 2) {
    return returns;
  }
  
  for (let i = 1; i < dailyNavHistory.length; i++) {
    const prev = dailyNavHistory[i - 1];
    const curr = dailyNavHistory[i];
    
    const dateKey = curr.date.toISOString().split('T')[0];
    const cashFlow = cashFlows.get(dateKey) || 0;
    
    // Neutralize cash flow: if there's a cash flow, adjust the denominator
    // Formula: Return = (Ending NAV - Cash Flow) / Starting NAV - 1
    // This treats cash flows as BOD (Beginning of Day)
    const adjustedStartingNav = prev.nav;
    const adjustedEndingNav = curr.nav - cashFlow;
    
    let dailyReturn = 0;
    if (adjustedStartingNav > 0 && adjustedEndingNav > 0) {
      dailyReturn = (adjustedEndingNav / adjustedStartingNav) - 1;
    }
    
    returns.push({
      date: curr.date,
      nav: curr.nav,
      return: dailyReturn,
    });
  }
  
  return returns;
}

/**
 * Get Recovery Analytics - identify all drawdown periods and their recovery times
 */
export function getRecoveryAnalytics(
  dailyNavHistory: Array<{ date: Date; nav: number }>
): RecoveryAnalytics {
  if (dailyNavHistory.length === 0) {
    return {
      drawdownPeriods: [],
      averageRecoveryTime: null,
      currentRecoveryStatus: {
        isInDrawdown: false,
        currentDrawdown: null,
        daysSincePeak: null,
      },
    };
  }

  const drawdownPeriods: DrawdownPeriod[] = [];
  let runningPeak = dailyNavHistory[0].nav;
  let runningPeakDate = dailyNavHistory[0].date;
  let currentDrawdown: DrawdownPeriod | null = null;
  
  for (let i = 1; i < dailyNavHistory.length; i++) {
    const point = dailyNavHistory[i];
    
    if (point.nav > runningPeak) {
      // New peak reached
      // If we were in a drawdown, we've now recovered
      if (currentDrawdown) {
        currentDrawdown.recoveryDate = point.date;
        const daysToRecovery = Math.floor((point.date.getTime() - currentDrawdown.peakDate.getTime()) / (1000 * 60 * 60 * 24));
        currentDrawdown.duration = daysToRecovery;
        drawdownPeriods.push(currentDrawdown);
        currentDrawdown = null;
      }
      
      // Update running peak
      runningPeak = point.nav;
      runningPeakDate = point.date;
    } else if (point.nav < runningPeak) {
      // We're in a drawdown (below the running peak)
      const drawdownPercent = (point.nav - runningPeak) / runningPeak;
      
      if (!currentDrawdown) {
        // Start a new drawdown period
        currentDrawdown = {
          peakDate: runningPeakDate,
          peakValue: runningPeak,
          troughDate: point.date,
          troughValue: point.nav,
          recoveryDate: null,
          duration: 0,
          drawdownPercent: drawdownPercent,
        };
      } else {
        // Update existing drawdown (track the trough)
        if (point.nav < currentDrawdown.troughValue) {
          currentDrawdown.troughDate = point.date;
          currentDrawdown.troughValue = point.nav;
          currentDrawdown.drawdownPercent = (point.nav - runningPeak) / runningPeak;
        }
      }
    }
  }
  
  // If we're still in a drawdown at the end, add it (without recovery date)
  if (currentDrawdown) {
    const lastPoint = dailyNavHistory[dailyNavHistory.length - 1];
    const daysSincePeak = Math.floor((lastPoint.date.getTime() - currentDrawdown.peakDate.getTime()) / (1000 * 60 * 60 * 24));
    currentDrawdown.duration = daysSincePeak;
    drawdownPeriods.push(currentDrawdown);
  }
  
  // Calculate average recovery time (only for recovered periods)
  const recoveredPeriods = drawdownPeriods.filter(p => p.recoveryDate !== null);
  const averageRecoveryTime = recoveredPeriods.length > 0
    ? recoveredPeriods.reduce((sum, p) => sum + (p.duration || 0), 0) / recoveredPeriods.length
    : null;
  
  // Current recovery status
  const lastPoint = dailyNavHistory[dailyNavHistory.length - 1];
  const isInDrawdown = lastPoint.nav < runningPeak;
  const currentDrawdownPeriod = isInDrawdown && currentDrawdown ? currentDrawdown : null;
  const daysSincePeak = isInDrawdown && currentDrawdownPeriod
    ? currentDrawdownPeriod.duration
    : null;
  
  return {
    drawdownPeriods,
    averageRecoveryTime,
    currentRecoveryStatus: {
      isInDrawdown,
      currentDrawdown: currentDrawdownPeriod,
      daysSincePeak,
    },
  };
}

/**
 * Calculate Maximum Drawdown and underwater series
 */
export function calculateMaximumDrawdown(
  dailyNavHistory: Array<{ date: Date; nav: number }>
): {
  maxDrawdown: number;
  maxDrawdownStartDate: Date | null;
  maxDrawdownEndDate: Date | null;
  maxDrawdownPeakNav: number | null;
  maxDrawdownTroughNav: number | null;
  drawdownSeries: DrawdownPoint[];
} {
  if (dailyNavHistory.length === 0) {
    return {
      maxDrawdown: 0,
      maxDrawdownStartDate: null,
      maxDrawdownEndDate: null,
      maxDrawdownPeakNav: null,
      maxDrawdownTroughNav: null,
      drawdownSeries: [],
    };
  }
  
  let peakNav = dailyNavHistory[0].nav;
  let peakDate = dailyNavHistory[0].date;
  let maxDrawdown = 0;
  let maxDrawdownStartDate: Date | null = null;
  let maxDrawdownEndDate: Date | null = null;
  let maxDrawdownPeakNav: number | null = null;
  let maxDrawdownTroughNav: number | null = null;
  
  const drawdownSeries: DrawdownPoint[] = [];
  
  for (const point of dailyNavHistory) {
    // Update high water mark (peak)
    if (point.nav > peakNav) {
      peakNav = point.nav;
      peakDate = point.date;
    }
    
    // Calculate drawdown from peak
    const drawdown = peakNav > 0 ? (point.nav - peakNav) / peakNav : 0;
    
    drawdownSeries.push({
      date: point.date,
      drawdown: drawdown, // Negative value (e.g., -0.15 = -15%)
      peakDate: peakDate,
      peakNav: peakNav,
    });
    
    // Track maximum drawdown
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownEndDate = point.date;
      maxDrawdownTroughNav = point.nav;
      
      // Find the start date (the peak that led to this drawdown)
      // Look back through drawdown series to find when this peak was established
      for (let i = drawdownSeries.length - 1; i >= 0; i--) {
        if (drawdownSeries[i].peakNav === peakNav && drawdownSeries[i].peakDate.getTime() === peakDate.getTime()) {
          maxDrawdownStartDate = drawdownSeries[i].peakDate;
          maxDrawdownPeakNav = peakNav;
          break;
        }
      }
    }
  }
  
  return {
    maxDrawdown: maxDrawdown,
    maxDrawdownStartDate: maxDrawdownStartDate,
    maxDrawdownEndDate: maxDrawdownEndDate,
    maxDrawdownPeakNav: maxDrawdownPeakNav,
    maxDrawdownTroughNav: maxDrawdownTroughNav,
    drawdownSeries: drawdownSeries,
  };
}

/**
 * Calculate Value at Risk (Historical VaR)
 */
export function calculateVaR(
  dailyReturns: DailyReturn[],
  currentWealth: number
): {
  var95: number;
  var99: number;
  var95Dollar: number;
  var99Dollar: number;
} {
  if (dailyReturns.length === 0) {
    return {
      var95: 0,
      var99: 0,
      var95Dollar: 0,
      var99Dollar: 0,
    };
  }
  
  // Sort returns in ascending order (worst to best)
  const sortedReturns = [...dailyReturns]
    .map(r => r.return)
    .sort((a, b) => a - b);
  
  // Calculate percentiles
  const index95 = Math.floor(sortedReturns.length * 0.05); // 5th percentile (95% VaR)
  const index99 = Math.floor(sortedReturns.length * 0.01); // 1st percentile (99% VaR)
  
  const var95 = sortedReturns[index95] || 0;
  const var99 = sortedReturns[index99] || 0;
  
  // Convert to dollar terms (negative values represent losses)
  const var95Dollar = currentWealth * Math.abs(var95);
  const var99Dollar = currentWealth * Math.abs(var99);
  
  return {
    var95: var95, // Already negative (loss)
    var99: var99, // Already negative (loss)
    var95Dollar: var95Dollar,
    var99Dollar: var99Dollar,
  };
}

/**
 * Convert benchmark cumulative returns to daily returns
 * Benchmark API returns cumulative returns (starting from 0%), need to convert to daily
 */
export function convertCumulativeToDailyReturns(
  benchmarkData: Array<{ date: number; value: number }> // date is timestamp, value is cumulative return %
): Array<{ date: Date; return: number }> {
  const dailyReturns: Array<{ date: Date; return: number }> = [];
  
  if (benchmarkData.length < 2) {
    return dailyReturns;
  }
  
  // Sort by date to ensure chronological order
  const sorted = [...benchmarkData].sort((a, b) => a.date - b.date);
  
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    
    // Convert cumulative return % to decimal (e.g., 5% -> 0.05)
    const prevCumulative = prev.value / 100;
    const currCumulative = curr.value / 100;
    
    // Calculate daily return: (1 + currCumulative) / (1 + prevCumulative) - 1
    // This gives us the daily return between these two cumulative points
    let dailyReturn = 0;
    if (prevCumulative !== -1) {
      dailyReturn = ((1 + currCumulative) / (1 + prevCumulative)) - 1;
    }
    
    dailyReturns.push({
      date: new Date(curr.date),
      return: dailyReturn, // As decimal (e.g., 0.01 = 1%)
    });
  }
  
  return dailyReturns;
}

/**
 * Calculate Beta (portfolio sensitivity to benchmark)
 */
export function calculateBeta(
  portfolioReturns: DailyReturn[],
  benchmarkDailyReturns: Array<{ date: Date; return: number }>
): number | null {
  if (portfolioReturns.length === 0 || benchmarkDailyReturns.length === 0) {
    return null;
  }
  
  // Create a map of benchmark returns by date for easier lookup
  const benchmarkMap = new Map<string, number>();
  for (const br of benchmarkDailyReturns) {
    const dateKey = br.date.toISOString().split('T')[0];
    benchmarkMap.set(dateKey, br.return);
  }
  
  // Align portfolio and benchmark returns by date
  const alignedReturns: Array<{ portfolio: number; benchmark: number }> = [];
  for (const pr of portfolioReturns) {
    const dateKey = pr.date.toISOString().split('T')[0];
    const benchmarkReturn = benchmarkMap.get(dateKey);
    if (benchmarkReturn !== undefined) {
      alignedReturns.push({
        portfolio: pr.return,
        benchmark: benchmarkReturn,
      });
    }
  }
  
  if (alignedReturns.length < 2) {
    return null;
  }
  
  // Calculate Beta = Cov(Portfolio, Benchmark) / Var(Benchmark)
  const portfolioMean = alignedReturns.reduce((sum, r) => sum + r.portfolio, 0) / alignedReturns.length;
  const benchmarkMean = alignedReturns.reduce((sum, r) => sum + r.benchmark, 0) / alignedReturns.length;
  
  let covariance = 0;
  let benchmarkVariance = 0;
  
  for (const r of alignedReturns) {
    const portfolioDev = r.portfolio - portfolioMean;
    const benchmarkDev = r.benchmark - benchmarkMean;
    covariance += portfolioDev * benchmarkDev;
    benchmarkVariance += benchmarkDev * benchmarkDev;
  }
  
  covariance /= alignedReturns.length;
  benchmarkVariance /= alignedReturns.length;
  
  if (benchmarkVariance === 0) {
    return null;
  }
  
  const beta = covariance / benchmarkVariance;
  return beta;
}

/**
 * Main function: Get comprehensive risk analytics
 * @param dailyNavHistory - Array of daily NAV points with dates
 * @param cashFlows - Map of date strings to cash flow amounts (for neutralizing flows)
 * @param benchmarkReturns - Array of benchmark daily returns (already converted from cumulative)
 * @param currentWealth - Current total portfolio value (for VaR dollar calculations)
 */
export function getRiskAnalytics(
  dailyNavHistory: Array<{ date: Date; nav: number }>,
  cashFlows: Map<string, number>,
  benchmarkDailyReturns: Array<{ date: Date; return: number }>,
  currentWealth: number
): RiskAnalytics {
  console.log(`[RISK-REPORT-V4] ===== RISK ANALYTICS CALCULATION =====`);
  console.log(`[RISK-REPORT-V4] Annual Risk-Free Rate: ${(ANNUAL_RISK_FREE_RATE * 100).toFixed(2)}%`);
  console.log(`[RISK-REPORT-V4] Daily Risk-Free Rate: ${(DAILY_RISK_FREE_RATE * 100).toFixed(4)}%`);
  console.log(`[RISK-REPORT-V4] NAV History Points: ${dailyNavHistory.length}`);
  console.log(`[RISK-REPORT-V4] Cash Flow Dates: ${cashFlows.size}`);
  console.log(`[RISK-REPORT-V4] Benchmark Daily Returns: ${benchmarkDailyReturns.length}`);
  console.log(`[RISK-REPORT-V4] Current Wealth: ${formatCurrency(currentWealth)}`);
  
  // Calculate daily returns (neutralizing cash flows)
  const dailyReturns = calculateDailyReturns(dailyNavHistory, cashFlows);
  console.log(`[RISK-REPORT-V4] Calculated Daily Returns: ${dailyReturns.length}`);
  
  if (dailyReturns.length === 0) {
    console.warn(`[RISK-REPORT-V4] ⚠️ No daily returns calculated - returning default values`);
    return {
      annualizedReturn: 0,
      annualizedVolatility: 0,
      annualizedDownsideVolatility: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      treynorRatio: 0,
      beta: null,
      maxDrawdown: 0,
      maxDrawdownStartDate: null,
      maxDrawdownEndDate: null,
      maxDrawdownPeakNav: null,
      maxDrawdownTroughNav: null,
      drawdownSeries: [],
      var95: 0,
      var99: 0,
      var95Dollar: 0,
      var99Dollar: 0,
    };
  }
  
  // Calculate mean and standard deviation
  const meanReturn = dailyReturns.reduce((sum, r) => sum + r.return, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r.return - meanReturn, 2), 0) / dailyReturns.length;
  const volatility = Math.sqrt(variance);
  
  // Calculate downside volatility (only negative returns)
  const negativeReturns = dailyReturns.filter(r => r.return < 0).map(r => r.return);
  const downsideMean = negativeReturns.length > 0 
    ? negativeReturns.reduce((sum, r) => sum + r, 0) / negativeReturns.length 
    : 0;
  const downsideVariance = negativeReturns.length > 0
    ? negativeReturns.reduce((sum, r) => sum + Math.pow(r - downsideMean, 2), 0) / negativeReturns.length
    : 0;
  const downsideVolatility = Math.sqrt(downsideVariance);
  
  // Annualize metrics (using 252 trading days)
  const annualizedReturn = meanReturn * TRADING_DAYS_PER_YEAR;
  const annualizedVolatility = volatility * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const annualizedDownsideVolatility = downsideVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);
  
  console.log(`[RISK-REPORT-V4] Daily Mean Return: ${(meanReturn * 100).toFixed(4)}%`);
  console.log(`[RISK-REPORT-V4] Annualized Return: ${(annualizedReturn * 100).toFixed(2)}%`);
  console.log(`[RISK-REPORT-V4] Daily Volatility: ${(volatility * 100).toFixed(4)}%`);
  console.log(`[RISK-REPORT-V4] Annualized Volatility: ${(annualizedVolatility * 100).toFixed(2)}%`);
  console.log(`[RISK-REPORT-V4] Annualized Downside Volatility: ${(annualizedDownsideVolatility * 100).toFixed(2)}%`);
  
  // Calculate Sharpe Ratio: (Rp - Rf) / σp
  const sharpeRatio = annualizedVolatility > 0 
    ? (annualizedReturn - ANNUAL_RISK_FREE_RATE) / annualizedVolatility 
    : 0;
  
  // Calculate Sortino Ratio: (Rp - Rf) / σ_downside
  const sortinoRatio = annualizedDownsideVolatility > 0
    ? (annualizedReturn - ANNUAL_RISK_FREE_RATE) / annualizedDownsideVolatility
    : 0;
  
  console.log(`[RISK-REPORT-V4] Sharpe Ratio: ${sharpeRatio.toFixed(4)} = (${(annualizedReturn * 100).toFixed(2)}% - ${(ANNUAL_RISK_FREE_RATE * 100).toFixed(2)}%) / ${(annualizedVolatility * 100).toFixed(2)}%`);
  console.log(`[RISK-REPORT-V4] Sortino Ratio: ${sortinoRatio.toFixed(4)} = (${(annualizedReturn * 100).toFixed(2)}% - ${(ANNUAL_RISK_FREE_RATE * 100).toFixed(2)}%) / ${(annualizedDownsideVolatility * 100).toFixed(2)}%`);
  
  // Calculate Beta (using daily returns, not cumulative)
  const beta = calculateBeta(dailyReturns, benchmarkDailyReturns);
  console.log(`[RISK-REPORT-V4] Beta: ${beta !== null ? beta.toFixed(4) : 'N/A'}`);
  
  // Calculate Treynor Ratio: (Rp - Rf) / β
  const treynorRatio = beta !== null && beta !== 0 && Math.abs(beta) > 0.001
    ? (annualizedReturn - ANNUAL_RISK_FREE_RATE) / beta
    : 0;
  
  console.log(`[RISK-REPORT-V4] Treynor Ratio: ${treynorRatio.toFixed(4)} = (${(annualizedReturn * 100).toFixed(2)}% - ${(ANNUAL_RISK_FREE_RATE * 100).toFixed(2)}%) / ${beta !== null ? beta.toFixed(4) : 'N/A'}`);
  
  // Calculate Maximum Drawdown
  const mddResult = calculateMaximumDrawdown(dailyNavHistory);
  console.log(`[RISK-REPORT-V4] Maximum Drawdown: ${(mddResult.maxDrawdown * 100).toFixed(2)}%`);
  if (mddResult.maxDrawdownStartDate && mddResult.maxDrawdownEndDate) {
    console.log(`[RISK-REPORT-V4] MDD Period: ${mddResult.maxDrawdownStartDate.toISOString().split('T')[0]} to ${mddResult.maxDrawdownEndDate.toISOString().split('T')[0]}`);
    console.log(`[RISK-REPORT-V4] MDD Peak NAV: ${mddResult.maxDrawdownPeakNav ? formatCurrency(mddResult.maxDrawdownPeakNav) : 'N/A'}`);
    console.log(`[RISK-REPORT-V4] MDD Trough NAV: ${mddResult.maxDrawdownTroughNav ? formatCurrency(mddResult.maxDrawdownTroughNav) : 'N/A'}`);
  }
  
  // Calculate Recovery Analytics
  const recoveryAnalytics = getRecoveryAnalytics(dailyNavHistory);
  console.log(`[RISK-REPORT-V4] Recovery Analytics: ${recoveryAnalytics.drawdownPeriods.length} drawdown period(s) identified`);
  if (recoveryAnalytics.averageRecoveryTime !== null) {
    console.log(`[RISK-REPORT-V4] Average Recovery Time: ${recoveryAnalytics.averageRecoveryTime.toFixed(1)} days`);
  }
  console.log(`[RISK-REPORT-V4] Currently in Drawdown: ${recoveryAnalytics.currentRecoveryStatus.isInDrawdown ? 'YES' : 'NO'}`);
  
  // Calculate VaR
  const varResult = calculateVaR(dailyReturns, currentWealth);
  console.log(`[RISK-REPORT-V4] VaR (95%): ${(varResult.var95 * 100).toFixed(2)}% = ${formatCurrency(varResult.var95Dollar)}`);
  console.log(`[RISK-REPORT-V4] VaR (99%): ${(varResult.var99 * 100).toFixed(2)}% = ${formatCurrency(varResult.var99Dollar)}`);
  
  console.log(`[RISK-REPORT-V4] ===== RISK ANALYTICS COMPLETE =====`);
  
  return {
    annualizedReturn,
    annualizedVolatility,
    annualizedDownsideVolatility,
    sharpeRatio,
    sortinoRatio,
    treynorRatio,
    beta,
    maxDrawdown: mddResult.maxDrawdown,
    maxDrawdownStartDate: mddResult.maxDrawdownStartDate,
    maxDrawdownEndDate: mddResult.maxDrawdownEndDate,
    maxDrawdownPeakNav: mddResult.maxDrawdownPeakNav,
    maxDrawdownTroughNav: mddResult.maxDrawdownTroughNav,
    drawdownSeries: mddResult.drawdownSeries,
    var95: varResult.var95,
    var99: varResult.var99,
    var95Dollar: varResult.var95Dollar,
    var99Dollar: varResult.var99Dollar,
    recoveryAnalytics: recoveryAnalytics,
  };
}

