export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { getConnectionLogger } from '@/lib/connection-logger';
import { getLightweightPortfolioData } from '@/lib/streaming-aggregator';
import { getDatabase, kbFundPriceQueries, accountQueries, sumTodayContributionsUSD, sumContributionsUSD } from '@/lib/database';
import { KB_FUND_UNITS } from '@/lib/kb-funds';
import { getExchangeRate } from '@/lib/exchange-rate';
import { calculateYTDMetrics, calculateMTDMetrics, calculateTodayMetrics } from '@/lib/calculations';
import { calculateAccountLiveNAV, updateLivePricesFromYahoo } from '@/lib/live-price-service';
import type { EquityCurvePoint } from '@/lib/types';

// Track active SSE connections
const connections = new Set<ReadableStreamDefaultController>();

// Log at module level to catch any import/initialization issues
console.log('[SSE Metrics] Module loaded - route.ts initialized');

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  console.log('[SSE Metrics] OPTIONS request received (CORS preflight)');
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

interface AllMetrics {
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
  timestamp: string;
}

/**
 * Calculate all metrics for streaming (Total Wealth, Stock Market, KB Funds)
 * Uses live prices from Yahoo Finance and calculates YTD, MTD, Today metrics
 */
async function calculateAllMetrics(): Promise<AllMetrics> {
  try {
    // Update live prices from Yahoo Finance (non-blocking, will use cached if fails)
    updateLivePricesFromYahoo().catch(err => {
      console.warn('[SSE Metrics] Live price update failed, using cached prices:', err);
    });

    // Fetch USD rate
    const exchangeRateResult = await getExchangeRate();
    const usdRate = exchangeRateResult.rate;

    if (!usdRate || usdRate <= 0) {
      throw new Error("Failed to fetch USD exchange rate");
    }

    // Get Stock Market data (all accounts) with live prices.
    // getLightweightPortfolioData now annotates each point with cashFlow /
    // isInternalTransfer so calculateYTDMetrics can use true TWR sub-periods.
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
          console.warn(`[SSE Metrics] Failed to get live NAV for ${account.id}:`, err);
        }
      }
      if (liveNAV > 0) {
        stockMarketNAV = liveNAV;
        // Update today's equity curve point with live NAV
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        // Find or create today's point — preserve cashFlow annotation if it exists
        const todayIndex = stockMarketEquityCurve.findIndex(p => {
          const pDate = p.date instanceof Date ? p.date : new Date(p.date);
          return pDate.toISOString().split('T')[0] === todayStr;
        });

        if (todayIndex >= 0) {
          // Update NAV but keep cashFlow annotation from the DB-sourced point
          stockMarketEquityCurve[todayIndex] = {
            ...stockMarketEquityCurve[todayIndex],
            nav: liveNAV,
          };
        } else {
          // No DB record for today yet — add a synthetic point with no external flow
          stockMarketEquityCurve.push({
            date: today,
            nav: liveNAV,
            cumulativeReturn: 0,
            simpleReturn: 0,
            cumulativeContributions: 0,
            cashFlow: 0,
            isInternalTransfer: false,
          });
        }
      }
    } catch (err) {
      console.warn('[SSE Metrics] Failed to get live NAV, using database NAV:', err);
    }

    // MTD and Today still use the contributions approach for denominator adjustment.
    // YTD uses cashFlow-annotated equity curve for true TWR (no contributions arg).
    const _now = new Date();
    const _mtdStart = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-01`;
    const stockMarketMtdContrib   = await sumContributionsUSD(null, _mtdStart);
    const stockMarketTodayContrib = await sumTodayContributionsUSD(null);

    // Calculate Stock Market metrics.
    // YTD: true TWR via cashFlow-annotated equity curve — no contributions arg.
    const stockMarketYtdMetrics = stockMarketEquityCurve.length > 0
      ? calculateYTDMetrics(stockMarketEquityCurve, stockMarketNAV)
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

    // Build KB Funds equity curve (no external deposits — unit×price driven)
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
        cashFlow: 0,
        isInternalTransfer: false,
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

    // Calculate KB Funds metrics (no external deposits — cashFlow=0 on all points)
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
      console.log('[SSE Metrics] KB Funds Today calculation:', {
        lastRecordedKBFundsNav,
        kbFundsTotalUSD,
        kbFundsTodayMetrics,
        equityCurveLength: kbFundsEquityCurve.length,
      });
    } else {
      console.log('[SSE Metrics] KB Funds Today calculation skipped:', {
        lastRecordedKBFundsNav,
        kbFundsTotalUSD,
        equityCurveLength: kbFundsEquityCurve.length,
      });
    }

    // Combine totals
    const totalWealth = stockMarketNAV + kbFundsTotalUSD;

    // Build index of stock-market cashFlow by date string so we can carry
    // external deposit/withdrawal annotations through to the combined curve.
    const stockMarketFlowByDate = new Map<string, number>();
    for (const pt of stockMarketEquityCurve) {
      const ds = (pt.date instanceof Date ? pt.date : new Date(pt.date)).toISOString().split('T')[0];
      if (pt.cashFlow) {
        stockMarketFlowByDate.set(ds, (stockMarketFlowByDate.get(ds) ?? 0) + pt.cashFlow);
      }
    }

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
    const combinedNavPoints: Array<{ date: Date; nav: number; cashFlow: number }> = [];

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

      // Carry stock-market external cash flow into the combined curve.
      // KB Funds have no external deposits so their contribution is 0.
      const flow = stockMarketFlowByDate.get(dateStr) ?? 0;
      combinedNavPoints.push({ date, nav: stockMarketNav + kbFundsNav, cashFlow: flow });
    }

    // Build combined equity curve with cashFlow annotations for true TWR
    let previousCombinedNAV = 0;
    let combinedCumulativeReturn = 0;
    const combinedEquityCurve: EquityCurvePoint[] = combinedNavPoints.map((point, index) => {
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
        cashFlow: point.cashFlow,
        isInternalTransfer: false,
      };
    });

    // Calculate Total Wealth YTD using true TWR via cashFlow-annotated combined
    // equity curve. No contributions arg needed — deposit boundaries come from
    // cashFlow fields.
    const totalWealthYtdMetrics = combinedEquityCurve.length > 0
      ? calculateYTDMetrics(combinedEquityCurve, totalWealth)
      : { ytdReturn: null, ytdValue: null };

    // MTD still uses the Modified-Dietz / contributions approach
    const totalWealthMtdMetrics = combinedEquityCurve.length > 0
      ? calculateMTDMetrics(combinedEquityCurve, totalWealth, stockMarketMtdContrib)
      : { mtdReturn: null, mtdValue: null };

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

    // Calculate Total Wealth Today by summing Stock Market Today and KB Funds Today
    let totalWealthTodayMetrics: { todayGainLoss: number | null; todayGainLossPercent: number | null } = {
      todayGainLoss: null,
      todayGainLossPercent: null
    };

    // Sum the Today values from Stock Market and KB Funds
    const stockMarketToday = stockMarketTodayMetrics.todayGainLoss;
    const kbFundsToday = kbFundsTodayMetrics.todayGainLoss;

    // Debug: Log the individual Today metrics before summing
    console.log('[SSE Metrics] Before Total Wealth Today calculation:', {
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
    console.log('[SSE Metrics] Total Wealth Today calculation result:', {
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
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[SSE Metrics] Error calculating all metrics:', error);
    throw error;
  }
}

/**
 * GET /api/ws/all-metrics - Server-Sent Events stream for real-time portfolio metrics
 * Streams portfolio metrics every 2 seconds
 */
export async function GET(request: NextRequest) {
  // Log immediately - even before logger initialization
  const requestStartTime = Date.now();
  const clientIP = request.headers.get('x-forwarded-for') ||
                   request.headers.get('x-real-ip') ||
                   request.ip ||
                   'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  const referer = request.headers.get('referer') || 'direct';

  console.log('[SSE Metrics] ===== GET /api/ws/all-metrics CALLED =====');
  console.log('[SSE Metrics] Request URL:', request.url);
  console.log('[SSE Metrics] Request method:', request.method);
  console.log('[SSE Metrics] Client IP:', clientIP);
  console.log('[SSE Metrics] User-Agent:', userAgent);
  console.log('[SSE Metrics] Referer:', referer);
  console.log('[SSE Metrics] Request headers:', Object.fromEntries(request.headers.entries()));
  console.log('[SSE Metrics] Request IP:', request.ip);
  console.log('[SSE Metrics] Request x-forwarded-for:', request.headers.get('x-forwarded-for'));
  console.log('[SSE Metrics] Request x-real-ip:', request.headers.get('x-real-ip'));

  // Detect if request is from mobile network vs local network
  const isMobileNetwork = !request.headers.get('host')?.includes('localhost') &&
                          !request.headers.get('host')?.includes('127.0.0.1') &&
                          clientIP.startsWith('100.'); // Tailscale IPs start with 100.
  console.log('[SSE Metrics] Network type:', isMobileNetwork ? 'Mobile/Tailscale' : 'Local');

  // Initialize logger first - before anything else
  let logger: ReturnType<typeof getConnectionLogger> | null = null;
  try {
    logger = getConnectionLogger();
    logger.logServer('=== GET /api/ws/all-metrics called ===', {
      timestamp: new Date().toISOString(),
      url: request.url,
      method: request.method,
    });
    console.log('[SSE Metrics] Logger initialized successfully');
  } catch (loggerError) {
    console.error('[SSE] Failed to initialize logger:', loggerError);
    // Continue without logger if it fails
  }

  const encoder = new TextEncoder();

  // Extract client information for logging (clientIP and userAgent already extracted above)
  const headers: Record<string, string> = {};

  try {
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    if (logger) {
      logger.logServer('Request headers extracted', {
        clientIP,
        userAgent,
        url: request.url,
        method: request.method,
        headerCount: Object.keys(headers).length,
      }, { ip: clientIP, userAgent, headers });
    }
  } catch (headerError) {
    console.error('[SSE] Error extracting headers:', headerError);
    if (logger) {
      logger.logServer('Error extracting headers', {
        error: headerError instanceof Error ? headerError.message : String(headerError),
      });
    }
  }

  const connectionStartTime = Date.now();
  const connectionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  if (logger) {
    logger.logServer('Connection attempt started', {
      connectionId,
      clientIP,
      userAgent,
      url: request.url,
      method: request.method,
    }, { ip: clientIP, userAgent, headers });
  }

  console.log(`[SSE Metrics] New connection request from ${clientIP} (${userAgent})`);

  let streamCreated = false;

  const stream = new ReadableStream({
    async start(controller) {
      streamCreated = true;
      const connectionEstablishTime = Date.now() - connectionStartTime;

      if (logger) {
        logger.logServer('Stream controller created - start() called', {
          connectionId,
          timeToEstablish: `${connectionEstablishTime}ms`,
          activeConnections: connections.size,
        }, { ip: clientIP, userAgent });
      }

      console.log(`[SSE Metrics] Stream controller created for ${connectionId} (${connectionEstablishTime}ms)`);

      try {
        connections.add(controller);

        if (logger) {
          logger.logServer('Controller added to connections set', {
            connectionId,
            totalConnections: connections.size,
          }, { ip: clientIP, userAgent });
        }
      } catch (addError) {
        if (logger) {
          logger.logServer('Error adding controller to connections', {
            connectionId,
            error: addError instanceof Error ? addError.message : String(addError),
          }, { ip: clientIP, userAgent });
        }
        throw addError;
      }

      if (logger) {
        logger.logServer('Connection added to active set', {
          connectionId,
          totalActiveConnections: connections.size,
        }, { ip: clientIP, userAgent });
      }

      // Send initial connection message
      try {
        const connectedMessage = encoder.encode(`event: connected\ndata: ${JSON.stringify({ type: 'connected', message: 'Stream started' })}\n\n`);
        controller.enqueue(connectedMessage);

        if (logger) {
          logger.logServer('Initial connection message sent', {
            connectionId,
            messageSize: connectedMessage.length,
          }, { ip: clientIP, userAgent });
        }
        console.log(`[SSE Metrics] Initial connection message sent for ${connectionId}`);
      } catch (error) {
        if (logger) {
          logger.logServer('Error sending initial connection message', {
            connectionId,
            error: error instanceof Error ? error.message : String(error),
          }, { ip: clientIP, userAgent });
        }
        console.error(`[SSE Metrics] Error sending initial message for ${connectionId}:`, error);
      }

      let lastMetricsTime = Date.now();
      let heartbeatInterval: NodeJS.Timeout | null = null;

      // Send initial metrics immediately
      const initialMetricsStartTime = Date.now();
      (async () => {
        try {
          if (logger) {
            logger.logServer('Starting initial metrics calculation', {
              connectionId,
            }, { ip: clientIP, userAgent });
          }
          console.log(`[SSE Metrics] Starting initial metrics calculation for ${connectionId}`);

          const initialMetrics = await calculateAllMetrics();
          const calculationTime = Date.now() - initialMetricsStartTime;

          if (logger) {
            logger.logServer('Initial metrics calculated', {
              connectionId,
              calculationTime: `${calculationTime}ms`,
              totalWealth: initialMetrics.totalWealth,
              stockMarketTotal: initialMetrics.stockMarketTotal,
              kbFundsTotal: initialMetrics.kbFundsTotal,
            }, { ip: clientIP, userAgent });
          }
          console.log(`[SSE Metrics] Initial metrics calculated for ${connectionId} in ${calculationTime}ms`);

          const data = JSON.stringify({ type: 'metrics', data: initialMetrics });
          const metricsMessage = encoder.encode(`event: metrics\ndata: ${data}\n\n`);

          controller.enqueue(metricsMessage);
          lastMetricsTime = Date.now();

          const totalTime = Date.now() - connectionStartTime;
          if (logger) {
            logger.logServer('Initial metrics sent successfully', {
              connectionId,
              messageSize: metricsMessage.length,
              totalConnectionTime: `${totalTime}ms`,
              calculationTime: `${calculationTime}ms`,
            }, { ip: clientIP, userAgent });
          }
          console.log(`[SSE Metrics] Initial metrics sent for ${connectionId} (${totalTime}ms total)`);
        } catch (error) {
          const errorTime = Date.now() - initialMetricsStartTime;
          if (logger) {
            logger.logServer('Error sending initial metrics', {
              connectionId,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : undefined,
              timeToError: `${errorTime}ms`,
            }, { ip: clientIP, userAgent });
          }
          console.error(`[SSE Metrics] Error sending initial metrics for ${connectionId}:`, error);
        }
      })();

      // Heartbeat to keep connection alive (every 10 seconds)
      heartbeatInterval = setInterval(() => {
        try {
          if (!connections.has(controller)) {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            if (logger) {
              logger.logServer('Heartbeat stopped - connection removed', {
                connectionId,
              }, { ip: clientIP, userAgent });
            }
            return;
          }

          // Send heartbeat/ping to keep connection alive
          const pingMessage = encoder.encode(`event: ping\ndata: ${JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })}\n\n`);
          controller.enqueue(pingMessage);
        } catch (error) {
          // Connection might be closed
          if (logger) {
            logger.logServer('Heartbeat error - connection may be closed', {
              connectionId,
              error: error instanceof Error ? error.message : String(error),
            }, { ip: clientIP, userAgent });
          }
          if (heartbeatInterval) clearInterval(heartbeatInterval);
        }
      }, 10000); // Every 10 seconds

      // Background loop: calculate and send metrics every 2 seconds
      const interval = setInterval(async () => {
        try {
          // Check if connection is still active
          if (!connections.has(controller)) {
            clearInterval(interval);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            return;
          }

          const metrics = await calculateAllMetrics();
          const data = JSON.stringify({ type: 'metrics', data: metrics });
          controller.enqueue(encoder.encode(`event: metrics\ndata: ${data}\n\n`));
          lastMetricsTime = Date.now();
        } catch (error) {
          console.error('[SSE Metrics] Error calculating metrics:', error);
          const errorData = JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : String(error)
          });
          try {
            controller.enqueue(encoder.encode(`event: error\ndata: ${errorData}\n\n`));
          } catch (enqueueError) {
            // Connection might be closed
            clearInterval(interval);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
          }
        }
      }, 2000); // Every 2 seconds

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        const connectionDuration = Date.now() - connectionStartTime;

        if (logger) {
          logger.logServer('Connection aborted by client', {
            connectionId,
            connectionDuration: `${connectionDuration}ms`,
            totalActiveConnections: connections.size - 1,
          }, { ip: clientIP, userAgent });
        }
        console.log(`[SSE Metrics] Connection aborted for ${connectionId} after ${connectionDuration}ms`);

        clearInterval(interval);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        connections.delete(controller);
        try {
          controller.close();
          if (logger) {
            logger.logServer('Connection closed successfully', {
              connectionId,
            }, { ip: clientIP, userAgent });
          }
        } catch (e) {
          if (logger) {
            logger.logServer('Error closing connection', {
              connectionId,
              error: e instanceof Error ? e.message : String(e),
            }, { ip: clientIP, userAgent });
          }
        }
      });
    },
    cancel() {
      if (logger) {
        logger.logServer('Stream cancelled by client', {
          connectionId,
        }, { ip: clientIP, userAgent });
      }
      console.log(`[SSE Metrics] Stream cancelled for ${connectionId}`);
    }
  });

  if (!streamCreated) {
    if (logger) {
      logger.logServer('WARNING: Stream ReadableStream created but start() not called', {
        connectionId,
      }, { ip: clientIP, userAgent });
    }
    console.warn(`[SSE Metrics] WARNING: Stream created but start() not called for ${connectionId}`);
  }

  const response = new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Keep-Alive': 'timeout=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Type',
    },
  });

  console.log('[SSE Metrics] Response headers set, returning response');

  if (logger) {
    logger.logServer('Response created and returning', {
      connectionId,
      timeToResponse: `${Date.now() - connectionStartTime}ms`,
    }, { ip: clientIP, userAgent });
  }
  console.log(`[SSE Metrics] Response created for ${connectionId}`);

  return response;
}

