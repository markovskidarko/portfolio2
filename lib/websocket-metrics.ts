/**
 * Shared metrics calculation for WebSocket server
 * Extracted from app/api/ws/all-metrics/route.ts
 */

import { getLightweightPortfolioData } from './streaming-aggregator';
import { kbFundPriceQueries, accountQueries, navQueries, depositQueries, withdrawalQueries, sumTodayContributionsUSD, sumContributionsUSD } from './database';
import { KB_FUND_UNITS } from './kb-funds';
import { getExchangeRate } from './exchange-rate';
import { calculateYTDMetrics, calculateMTDMetrics, calculateTodayMetrics } from './calculations';
import { calculateAccountLiveNAV, updateLivePricesFromYahoo } from './live-price-service';
import type { EquityCurvePoint } from './types';

export interface AccountSidebarMetrics {
  accountId: string;
  accountAlias: string;
  nav: number;
  ytdValue: number | null;
  ytdReturn: number | null;
  mtdValue: number | null;
  mtdReturn: number | null;
  todayGainLoss: number | null;
  todayGainLossPercent: number | null;
}

export interface AllMetrics {
  // Total Wealth
  totalWealth: number;
  totalWealthYtd: number | null;
  totalWealthYtdPercent: number | null;
  totalWealthMtd: number | null;
  totalWealthMtdPercent: number | null;
  totalWealthToday: number | null;
  totalWealthTodayPercent: number | null;
  // Stock Market
  stockMarketTotal: number;
  stockMarketYtd: number | null;
  stockMarketYtdPercent: number | null;
  stockMarketMtd: number | null;
  stockMarketMtdPercent: number | null;
  stockMarketToday: number | null;
  stockMarketTodayPercent: number | null;
  // KB Funds
  kbFundsTotal: number;
  kbFundsYtd: number | null;
  kbFundsYtdPercent: number | null;
  kbFundsMtd: number | null;
  kbFundsMtdPercent: number | null;
  kbFundsToday: number | null;
  kbFundsTodayPercent: number | null;
  // Per-account sidebar data
  accounts: AccountSidebarMetrics[];
  timestamp: string;
}

/**
 * Build equity curve for a single account with external cash-flow annotations for TWR
 */
async function buildAccountEquityCurveWS(accountId: string): Promise<EquityCurvePoint[]> {
  const navRecords = await navQueries.getByAccount(accountId) as Array<{ date: string; nav_value: number }>;
  if (navRecords.length === 0) return [];

  const depositRows = await depositQueries.getByAccount(accountId) as Array<{ date: string; amount: number; fx_rate_to_base: number }>;
  const withdrawalRows = await withdrawalQueries.getByAccount(accountId) as Array<{ date: string; amount: number; fx_rate_to_base: number }>;

  const externalFlowByDate = new Map<string, number>();
  for (const r of depositRows) {
    const val = (r.amount ?? 0) * (r.fx_rate_to_base ?? 1);
    externalFlowByDate.set(r.date, (externalFlowByDate.get(r.date) ?? 0) + val);
  }
  for (const r of withdrawalRows) {
    const val = (r.amount ?? 0) * (r.fx_rate_to_base ?? 1);
    externalFlowByDate.set(r.date, (externalFlowByDate.get(r.date) ?? 0) - val);
  }

  return navRecords.map(record => ({
    date: new Date(record.date),
    nav: record.nav_value || 0,
    cumulativeReturn: 0,
    simpleReturn: 0,
    cumulativeContributions: 0,
    cashFlow: externalFlowByDate.get(record.date) ?? 0,
    isInternalTransfer: false,
  }));
}

/**
 * Calculate per-account sidebar metrics using live prices
 */
async function calculateAccountsSidebarMetrics(): Promise<AccountSidebarMetrics[]> {
  const accounts = await accountQueries.getAll() as Array<{ id: string; alias: string }>;
  const validAccounts = accounts.filter(acc => acc.id !== 'HUNGARY_MIGRATION_HISTORY');

  const result: AccountSidebarMetrics[] = [];

  for (const account of validAccounts) {
    try {
      const liveNAV = await calculateAccountLiveNAV(account.id);
      let equityCurve = await buildAccountEquityCurveWS(account.id);

      // Find last recorded NAV before today
      let lastRecordedNav: number | null = null;
      const todayStr = new Date().toISOString().split('T')[0];
      for (let i = equityCurve.length - 1; i >= 0; i--) {
        const pt = equityCurve[i];
        const ptDate = (pt.date instanceof Date ? pt.date : new Date(pt.date)).toISOString().split('T')[0];
        if (ptDate !== todayStr && pt.nav > 0) { lastRecordedNav = pt.nav; break; }
      }
      if (lastRecordedNav === null && equityCurve.length > 0) {
        lastRecordedNav = equityCurve[equityCurve.length - 1].nav || null;
      }

      // Update/add today's point
      if (equityCurve.length > 0) {
        const lastPt = equityCurve[equityCurve.length - 1];
        const lastPtDate = (lastPt.date instanceof Date ? lastPt.date : new Date(lastPt.date)).toISOString().split('T')[0];
        if (lastPtDate === todayStr) {
          equityCurve[equityCurve.length - 1] = { ...lastPt, nav: liveNAV };
        } else {
          equityCurve.push({ date: new Date(), nav: liveNAV, cumulativeReturn: 0, simpleReturn: 0, cumulativeContributions: 0, cashFlow: 0, isInternalTransfer: false });
        }
      } else {
        equityCurve.push({ date: new Date(), nav: liveNAV, cumulativeReturn: 0, simpleReturn: 0, cumulativeContributions: 0, cashFlow: 0, isInternalTransfer: false });
      }

      const now = new Date();
      const mtdStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const mtdContrib = await sumContributionsUSD([account.id], mtdStart);
      const todayContrib = await sumTodayContributionsUSD([account.id]);

      const ytdM = equityCurve.length > 0 ? calculateYTDMetrics(equityCurve, liveNAV) : { ytdReturn: null, ytdValue: null };
      const mtdM = equityCurve.length > 0 ? calculateMTDMetrics(equityCurve, liveNAV, mtdContrib) : { mtdReturn: null, mtdValue: null };
      const todayM = lastRecordedNav !== null && lastRecordedNav > 0
        ? calculateTodayMetrics(equityCurve, liveNAV, lastRecordedNav, todayContrib)
        : { todayGainLoss: null, todayGainLossPercent: null };

      result.push({
        accountId: account.id,
        accountAlias: account.alias || account.id,
        nav: liveNAV,
        ytdValue: ytdM.ytdValue,
        ytdReturn: ytdM.ytdReturn,
        mtdValue: mtdM.mtdValue,
        mtdReturn: mtdM.mtdReturn,
        todayGainLoss: todayM.todayGainLoss,
        todayGainLossPercent: todayM.todayGainLossPercent,
      });
    } catch (err) {
      console.warn(`[WebSocket Metrics] Failed sidebar metrics for ${account.id}:`, err);
    }
  }

  return result;
}

/**
 * Calculate all metrics for streaming (Total Wealth, Stock Market, KB Funds)
 * Uses live prices from Yahoo Finance and calculates YTD, MTD, Today metrics
 */
export async function calculateAllMetrics(): Promise<AllMetrics> {
  try {
    // Update live prices from Yahoo Finance (non-blocking, will use cached if fails)
    updateLivePricesFromYahoo().catch(err => {
      console.warn('[WebSocket Metrics] Live price update failed, using cached prices:', err);
    });

    // Fetch USD rate
    const exchangeRateResult = await getExchangeRate();
    const usdRate = exchangeRateResult.rate;

    if (!usdRate || usdRate <= 0) {
      throw new Error("Failed to fetch USD exchange rate");
    }

    // Get Stock Market data (all accounts) with live prices
    const stockMarketData = await getLightweightPortfolioData(null); // null = all accounts
    let stockMarketNAV = stockMarketData.totalNAV || 0;
    let stockMarketEquityCurve = stockMarketData.equityCurve || [];

    // Get last recorded Stock Market NAV BEFORE updating with live NAV (for Today calculation)
    let lastRecordedStockMarketNav: number | null = null;
    if (stockMarketEquityCurve.length > 0) {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      for (let i = stockMarketEquityCurve.length - 1; i >= 0; i--) {
        const point = stockMarketEquityCurve[i];
        const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
        const pointDateStr = pointDate.toISOString().split('T')[0];
        if (pointDateStr !== todayStr && point.nav > 0) {
          lastRecordedStockMarketNav = point.nav;
          break;
        }
      }
      if (lastRecordedStockMarketNav === null) {
        lastRecordedStockMarketNav = stockMarketEquityCurve[stockMarketEquityCurve.length - 1].nav || null;
      }
    }

    // Update with live NAV if available
    try {
      // Calculate total live NAV across all accounts
      const allAccounts = await accountQueries.getAll() as Array<{ id: string }>;
      const validAccounts = allAccounts.filter(acc => acc.id !== 'HUNGARY_MIGRATION_HISTORY');
      
      let liveNAV = 0;
      for (const account of validAccounts) {
        try {
          const accountNAV = await calculateAccountLiveNAV(account.id);
          liveNAV += accountNAV;
        } catch (err) {
          console.warn(`[WebSocket Metrics] Failed to get live NAV for ${account.id}:`, err);
        }
      }
      if (liveNAV > 0) {
        stockMarketNAV = liveNAV;
        // Update today's equity curve point with live NAV
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];
        
        // Find or create today's point
        const todayPoint = stockMarketEquityCurve.find(p => {
          const pDate = p.date instanceof Date ? p.date : new Date(p.date);
          return pDate.toISOString().split('T')[0] === todayStr;
        });
        
        if (todayPoint) {
          todayPoint.nav = liveNAV;
        } else {
          stockMarketEquityCurve.push({
            date: today,
            nav: liveNAV,
            cumulativeReturn: 0,
            simpleReturn: 0,
            cumulativeContributions: 0,
          });
        }
      }
    } catch (err) {
      console.warn('[WebSocket Metrics] Failed to get live NAV, using database NAV:', err);
    }

    // Net external cash flows during YTD / MTD / today across all stock-market
    // accounts. Subtracted from each period's P&L so deposits and withdrawals
    // aren't reported as investment performance.
    const _now = new Date();
    const _ytdStart = `${_now.getFullYear()}-01-01`;
    const _mtdStart = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-01`;
    const stockMarketYtdContrib   = await sumContributionsUSD(null, _ytdStart);
    const stockMarketMtdContrib   = await sumContributionsUSD(null, _mtdStart);
    const stockMarketTodayContrib = await sumTodayContributionsUSD(null);

    // Calculate Stock Market metrics
    const stockMarketYtdMetrics = stockMarketEquityCurve.length > 0
      ? calculateYTDMetrics(stockMarketEquityCurve, stockMarketNAV, stockMarketYtdContrib)
      : { ytdReturn: null, ytdValue: null };

    const stockMarketMtdMetrics = stockMarketEquityCurve.length > 0
      ? calculateMTDMetrics(stockMarketEquityCurve, stockMarketNAV, stockMarketMtdContrib)
      : { mtdReturn: null, mtdValue: null };

    const stockMarketTodayMetrics = lastRecordedStockMarketNav !== null && lastRecordedStockMarketNav > 0
      ? calculateTodayMetrics(stockMarketEquityCurve, stockMarketNAV, lastRecordedStockMarketNav, stockMarketTodayContrib)
      : { todayGainLoss: null, todayGainLossPercent: null };

    // Get KB Funds data (all funds)
    const fundNames: Array<keyof typeof KB_FUND_UNITS> = ["Stocks", "Balanced", "Gold"];
    let kbFundsTotalUSD = 0;
    const kbFundsEquityCurve: EquityCurvePoint[] = [];

    // Group KB Funds prices by date
    const kbFundsByDate = new Map<string, { totalValueMKD: number }>();

    for (const fundName of fundNames) {
      const prices = await kbFundPriceQueries.getByFund(fundName) as Array<{
        date: string;
        price_per_unit_mkd: number;
      }>;

      for (const price of prices) {
        const units = KB_FUND_UNITS[fundName];
        const totalValueMKD = price.price_per_unit_mkd * units;

        const existing = kbFundsByDate.get(price.date);
        if (existing) {
          existing.totalValueMKD += totalValueMKD;
        } else {
          kbFundsByDate.set(price.date, { totalValueMKD });
        }
      }
    }

    // Build KB Funds equity curve
    const sortedKBDates = Array.from(kbFundsByDate.keys()).sort();
    let previousKBNAV = 0;
    let cumulativeReturn = 0;

    for (const date of sortedKBDates) {
      const point = kbFundsByDate.get(date)!;
      const navUSD = point.totalValueMKD / usdRate;

      let dailyReturn = 0;
      if (previousKBNAV > 0) {
        dailyReturn = (navUSD / previousKBNAV) - 1;
        cumulativeReturn = (1 + cumulativeReturn) * (1 + dailyReturn) - 1;
      }

      kbFundsEquityCurve.push({
        date: new Date(date),
        nav: navUSD,
        cumulativeReturn: cumulativeReturn * 100,
        simpleReturn: 0,
        cumulativeContributions: 0,
      });

      previousKBNAV = navUSD;
    }

    // Get latest KB Funds total
    if (kbFundsEquityCurve.length > 0) {
      kbFundsTotalUSD = kbFundsEquityCurve[kbFundsEquityCurve.length - 1].nav;
    }

    // Get last recorded KB Funds NAV (date-1) for Today calculation
    // Use the same logic as KB Funds page: second-to-last point
    let lastRecordedKBFundsNav: number | null = null;
    if (kbFundsEquityCurve.length >= 2) {
      // Get the second-to-last NAV (date-1) for Today calculation
      lastRecordedKBFundsNav = kbFundsEquityCurve[kbFundsEquityCurve.length - 2].nav || null;
    } else if (kbFundsEquityCurve.length === 1) {
      // If only one point, use it as baseline (Today will be 0)
      lastRecordedKBFundsNav = kbFundsEquityCurve[0].nav || null;
    }

    // Calculate KB Funds metrics
    const kbFundsYtdMetrics = kbFundsEquityCurve.length > 0
      ? calculateYTDMetrics(kbFundsEquityCurve, kbFundsTotalUSD)
      : { ytdReturn: null, ytdValue: null };
    
    const kbFundsMtdMetrics = kbFundsEquityCurve.length > 0
      ? calculateMTDMetrics(kbFundsEquityCurve, kbFundsTotalUSD)
      : { mtdReturn: null, mtdValue: null };
    
    // Calculate KB Funds Today metrics
    let kbFundsTodayMetrics: { todayGainLoss: number | null; todayGainLossPercent: number | null } = { todayGainLoss: null, todayGainLossPercent: null };
    if (lastRecordedKBFundsNav !== null && lastRecordedKBFundsNav > 0 && kbFundsEquityCurve.length > 0) {
      kbFundsTodayMetrics = calculateTodayMetrics(kbFundsEquityCurve, kbFundsTotalUSD, lastRecordedKBFundsNav);
      console.log('[WebSocket Metrics] KB Funds Today calculation:', {
        lastRecordedKBFundsNav,
        kbFundsTotalUSD,
        kbFundsTodayMetrics,
        equityCurveLength: kbFundsEquityCurve.length,
      });
    } else {
      console.log('[WebSocket Metrics] KB Funds Today calculation skipped:', {
        lastRecordedKBFundsNav,
        kbFundsTotalUSD,
        equityCurveLength: kbFundsEquityCurve.length,
      });
    }

    // Combine totals
    const totalWealth = stockMarketNAV + kbFundsTotalUSD;

    // Combine equity curves by date for total wealth metrics
    const allDates = new Set<string>();
    stockMarketEquityCurve.forEach(point => {
      const dateStr = point.date instanceof Date 
        ? point.date.toISOString().split('T')[0]
        : new Date(point.date).toISOString().split('T')[0];
      allDates.add(dateStr);
    });
    kbFundsEquityCurve.forEach(point => {
      const dateStr = point.date instanceof Date 
        ? point.date.toISOString().split('T')[0]
        : new Date(point.date).toISOString().split('T')[0];
      allDates.add(dateStr);
    });

    const sortedDates = Array.from(allDates).sort();
    const combinedNavPoints: Array<{ date: Date; nav: number }> = [];
    
    for (const dateStr of sortedDates) {
      const date = new Date(dateStr);

      // Find Stock Market value for this date (or closest previous)
      let stockMarketNav = 0;
      for (let i = stockMarketEquityCurve.length - 1; i >= 0; i--) {
        const point = stockMarketEquityCurve[i];
        const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
        const pointDateStr = pointDate.toISOString().split('T')[0];
        if (pointDateStr <= dateStr) {
          stockMarketNav = point.nav || 0;
          break;
        }
      }

      // Find KB Funds value for this date (or closest previous)
      let kbFundsNav = 0;
      for (let i = kbFundsEquityCurve.length - 1; i >= 0; i--) {
        const point = kbFundsEquityCurve[i];
        const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
        const pointDateStr = pointDate.toISOString().split('T')[0];
        if (pointDateStr <= dateStr) {
          kbFundsNav = point.nav || 0;
          break;
        }
      }

      combinedNavPoints.push({ date, nav: stockMarketNav + kbFundsNav });
    }

    // Calculate cumulative return from combined NAV progression
    let previousCombinedNAV = 0;
    let combinedCumulativeReturn = 0;
    const combinedEquityCurve = combinedNavPoints.map((point, index) => {
      if (index > 0 && previousCombinedNAV > 0) {
        const dailyReturn = (point.nav / previousCombinedNAV) - 1;
        combinedCumulativeReturn = (1 + combinedCumulativeReturn) * (1 + dailyReturn) - 1;
      }
      previousCombinedNAV = point.nav;
      return {
        date: point.date,
        nav: point.nav,
        cumulativeReturn: combinedCumulativeReturn * 100,
        simpleReturn: 0,
        cumulativeContributions: 0,
      };
    });

    // Get last recorded Total Wealth NAV by summing Stock Market and KB Funds last recorded NAVs
    // This is more accurate than searching the combined curve
    let lastRecordedTotalWealthNav: number | null = null;
    if (lastRecordedStockMarketNav !== null && lastRecordedKBFundsNav !== null) {
      lastRecordedTotalWealthNav = lastRecordedStockMarketNav + lastRecordedKBFundsNav;
    } else if (lastRecordedStockMarketNav !== null) {
      lastRecordedTotalWealthNav = lastRecordedStockMarketNav;
    } else if (lastRecordedKBFundsNav !== null) {
      lastRecordedTotalWealthNav = lastRecordedKBFundsNav;
    }

    // Calculate Total Wealth metrics. Subtract Stock Market YTD/MTD
    // contributions so deposits don't masquerade as combined performance.
    // (KB Funds NAV is unit×price-driven, no IBKR-style deposits, so reusing
    // the Stock Market contributions captures everything.)
    const totalWealthYtdMetrics = combinedEquityCurve.length > 0
      ? calculateYTDMetrics(combinedEquityCurve, totalWealth, stockMarketYtdContrib)
      : { ytdReturn: null, ytdValue: null };

    const totalWealthMtdMetrics = combinedEquityCurve.length > 0
      ? calculateMTDMetrics(combinedEquityCurve, totalWealth, stockMarketMtdContrib)
      : { mtdReturn: null, mtdValue: null };
    
    // Calculate Total Wealth Today by summing Stock Market Today and KB Funds Today
    let totalWealthTodayMetrics: { todayGainLoss: number | null; todayGainLossPercent: number | null } = { todayGainLoss: null, todayGainLossPercent: null };
    
    // Sum the Today values from Stock Market and KB Funds
    const stockMarketToday = stockMarketTodayMetrics.todayGainLoss;
    const kbFundsToday = kbFundsTodayMetrics.todayGainLoss;
    
    // Debug: Log the individual Today metrics before summing
    console.log('[WebSocket Metrics] Before Total Wealth Today calculation:', {
      stockMarketTodayMetrics,
      kbFundsTodayMetrics,
      stockMarketToday,
      kbFundsToday,
    });
    
    // Always calculate Total Wealth Today if we have at least one value
    // Use 0 if null, but explicitly handle each value
    const smToday = stockMarketToday !== null ? stockMarketToday : 0;
    const kbToday = kbFundsToday !== null ? kbFundsToday : 0;
    const totalTodayValue = smToday + kbToday;
    
    // Calculate percentage based on last recorded Total Wealth NAV.
    // Add today's contributions to the baseline so a same-day deposit doesn't
    // shrink the denominator vs the (now contribution-stripped) numerator.
    let totalTodayPercent: number | null = null;
    if (lastRecordedTotalWealthNav !== null && lastRecordedTotalWealthNav > 0) {
      const baseline = lastRecordedTotalWealthNav + stockMarketTodayContrib;
      totalTodayPercent = baseline > 0 ? (totalTodayValue / baseline) * 100 : 0;
    }
    
    totalWealthTodayMetrics = {
      todayGainLoss: totalTodayValue,
      todayGainLossPercent: totalTodayPercent,
    };
    
    // Debug logging
    console.log('[WebSocket Metrics] Total Wealth Today calculation result:', {
      stockMarketToday,
      kbFundsToday,
      smToday,
      kbToday,
      totalTodayValue,
      lastRecordedTotalWealthNav,
      totalWealthTodayMetrics,
    });

    return {
      totalWealth,
      totalWealthYtd: totalWealthYtdMetrics.ytdValue,
      totalWealthYtdPercent: totalWealthYtdMetrics.ytdReturn,
      totalWealthMtd: totalWealthMtdMetrics.mtdValue,
      totalWealthMtdPercent: totalWealthMtdMetrics.mtdReturn,
      totalWealthToday: totalWealthTodayMetrics.todayGainLoss,
      totalWealthTodayPercent: totalWealthTodayMetrics.todayGainLossPercent,

      stockMarketTotal: stockMarketNAV,
      stockMarketYtd: stockMarketYtdMetrics.ytdValue,
      stockMarketYtdPercent: stockMarketYtdMetrics.ytdReturn,
      stockMarketMtd: stockMarketMtdMetrics.mtdValue,
      stockMarketMtdPercent: stockMarketMtdMetrics.mtdReturn,
      stockMarketToday: stockMarketTodayMetrics.todayGainLoss,
      stockMarketTodayPercent: stockMarketTodayMetrics.todayGainLossPercent,

      kbFundsTotal: kbFundsTotalUSD,
      kbFundsYtd: kbFundsYtdMetrics.ytdValue,
      kbFundsYtdPercent: kbFundsYtdMetrics.ytdReturn,
      kbFundsMtd: kbFundsMtdMetrics.mtdValue,
      kbFundsMtdPercent: kbFundsMtdMetrics.mtdReturn,
      kbFundsToday: kbFundsTodayMetrics.todayGainLoss,
      kbFundsTodayPercent: kbFundsTodayMetrics.todayGainLossPercent,

      accounts: await calculateAccountsSidebarMetrics(),

      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[WebSocket Metrics] Error calculating metrics:', error);
    throw error;
  }
}
