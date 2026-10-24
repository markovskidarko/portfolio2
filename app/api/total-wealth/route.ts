export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { aggregateIBKRDataFromDB } from '@/lib/db-aggregator';
import { kbFundPriceQueries } from '@/lib/database';
import { KB_FUND_UNITS } from '@/lib/kb-funds';
import { getExchangeRate } from '@/lib/exchange-rate';
import { calculateYTDMetrics, calculateMTDMetrics, calculateTodayMetrics } from '@/lib/calculations';
import type { EquityCurvePoint } from '@/lib/types';

export const maxDuration = 60;

/**
 * GET /api/total-wealth - Get combined total wealth (Stock Market + KB Funds) with metrics
 * Returns total value and YTD, MTD, Today metrics for the combined portfolio
 */
export async function GET() {
  try {
    // Fetch USD rate
    const exchangeRateResult = await getExchangeRate();
    const usdRate = exchangeRateResult.rate;

    if (!usdRate) {
      throw new Error("Failed to fetch USD exchange rate");
    }

    // Get Stock Market total (all accounts)
    const stockMarketData = await aggregateIBKRDataFromDB(null); // null = all accounts
    const stockMarketNAV = stockMarketData.totalNAV || 0;
    const stockMarketEquityCurve = stockMarketData.equityCurve || [];

    // Get KB Funds total (all funds)
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

    // Combine totals
    const totalWealth = stockMarketNAV + kbFundsTotalUSD;

    // Combine equity curves by date
    const combinedEquityCurve: EquityCurvePoint[] = [];
    const allDates = new Set<string>();

    // Collect all dates
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

    // Build combined equity curve with NAV values only
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

      // Combine NAV values
      const combinedNav = stockMarketNav + kbFundsNav;
      combinedNavPoints.push({ date, nav: combinedNav });
    }

    // Calculate cumulative return from combined NAV progression
    let previousCombinedNAV = 0;
    let combinedCumulativeReturn = 0;
    const recalculatedEquityCurve = combinedNavPoints.map((point, index) => {
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

    // Calculate metrics
    const ytdMetrics = recalculatedEquityCurve.length > 0 
      ? calculateYTDMetrics(recalculatedEquityCurve, totalWealth) 
      : { ytdReturn: null, ytdValue: null };
    
    const mtdMetrics = recalculatedEquityCurve.length > 0 
      ? calculateMTDMetrics(recalculatedEquityCurve, totalWealth) 
      : { mtdReturn: null, mtdValue: null };
    
    const todayMetrics = recalculatedEquityCurve.length > 0 
      ? calculateTodayMetrics(recalculatedEquityCurve, totalWealth) 
      : { todayGainLoss: null, todayGainLossPercent: null };

    return NextResponse.json({
      success: true,
      totalWealth,
      stockMarketNAV,
      kbFundsTotalUSD,
      ytdMetrics,
      mtdMetrics,
      todayMetrics,
    });
  } catch (error) {
    console.error('[Total Wealth API] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      },
      { status: 500 }
    );
  }
}

