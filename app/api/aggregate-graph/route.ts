export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { aggregateIBKRDataFromDB } from '@/lib/db-aggregator';
import { kbFundPriceQueries } from '@/lib/database';
import { KB_FUND_UNITS } from '@/lib/kb-funds';
import { getExchangeRate } from '@/lib/exchange-rate';
import type { EquityCurvePoint } from '@/lib/types';
import { format } from 'date-fns';

export const maxDuration = 60;

/**
 * GET /api/aggregate-graph - Get equity curves for Stock Market, KB Funds, and Aggregate
 * Returns TWR returns for all three for charting
 */
export async function GET() {
  try {
    // Fetch USD rate
    const exchangeRateResult = await getExchangeRate();
    const usdRate = exchangeRateResult.rate;

    if (!usdRate) {
      throw new Error("Failed to fetch USD exchange rate");
    }

    // --- 1. Stock Market Equity Curve ---
    const stockMarketData = await aggregateIBKRDataFromDB(null); // null = all accounts
    const stockMarketEquityCurve = stockMarketData.equityCurve || [];
    
    // Filter Stock Market data from inception date (December 10, 2025)
    const inceptionDate = new Date('2025-12-10');
    const filteredStockMarketCurve = stockMarketEquityCurve.filter(point => {
      const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
      return pointDate >= inceptionDate;
    });
    
    // Recalculate TWR from NAV values starting from inception date
    // This ensures TWR is calculated correctly from the inception point, not from portfolio start
    const recalculatedStockMarketCurve: EquityCurvePoint[] = [];
    let previousStockMarketNAV = 0;
    let stockMarketCumulativeReturn = 0;
    
    for (let i = 0; i < filteredStockMarketCurve.length; i++) {
      const point = filteredStockMarketCurve[i];
      const nav = point.nav || 0;
      
      // Calculate daily return and cumulative TWR using geometric linking
      let dailyReturn = 0;
      if (previousStockMarketNAV > 0 && nav > 0) {
        dailyReturn = (nav / previousStockMarketNAV) - 1;
        stockMarketCumulativeReturn = (1 + stockMarketCumulativeReturn) * (1 + dailyReturn) - 1;
      }
      
      recalculatedStockMarketCurve.push({
        date: point.date instanceof Date ? point.date : new Date(point.date),
        nav: nav,
        cumulativeReturn: stockMarketCumulativeReturn * 100, // Convert to percentage, starts from 0% at inception
        simpleReturn: 0,
        cumulativeContributions: 0,
      });
      
      previousStockMarketNAV = nav;
    }

    // --- 2. KB Funds Equity Curve ---
    const fundNames: Array<keyof typeof KB_FUND_UNITS> = ["Stocks", "Balanced", "Gold"];
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

    // Build KB Funds equity curve with TWR
    const sortedKBDates = Array.from(kbFundsByDate.keys()).sort();
    let previousKBNAV = 0;
    let cumulativeReturn = 0;

    for (const dateStr of sortedKBDates) {
      const point = kbFundsByDate.get(dateStr)!;
      const navUSD = point.totalValueMKD / usdRate;
      const pointDate = new Date(dateStr);
      
      // Filter from inception date (December 10, 2025)
      if (pointDate < inceptionDate) {
        continue;
      }

      let dailyReturn = 0;
      if (previousKBNAV > 0) {
        dailyReturn = (navUSD / previousKBNAV) - 1;
        cumulativeReturn = (1 + cumulativeReturn) * (1 + dailyReturn) - 1;
      }

      kbFundsEquityCurve.push({
        date: pointDate,
        nav: navUSD,
        cumulativeReturn: cumulativeReturn * 100, // Convert to percentage
        simpleReturn: 0,
        cumulativeContributions: 0,
      });

      previousKBNAV = navUSD;
    }

    // --- 3. Aggregate Equity Curve (Combined) ---
    const combinedEquityCurve: EquityCurvePoint[] = [];
    const allDates = new Set<string>();

    // Collect all dates (using recalculated Stock Market curve)
    recalculatedStockMarketCurve.forEach(point => {
      const dateStr = format(point.date instanceof Date ? point.date : new Date(point.date), 'yyyy-MM-dd');
      allDates.add(dateStr);
    });

    kbFundsEquityCurve.forEach(point => {
      const dateStr = format(point.date instanceof Date ? point.date : new Date(point.date), 'yyyy-MM-dd');
      allDates.add(dateStr);
    });

    // Build combined equity curve - we need to combine by date and get TWR returns
    // We'll use a map to store the latest values for each date
    const stockMarketByDate = new Map<string, { nav: number; return: number }>();
    const kbFundsDataByDate = new Map<string, { nav: number; return: number }>();

    recalculatedStockMarketCurve.forEach(point => {
      const dateStr = format(point.date instanceof Date ? point.date : new Date(point.date), 'yyyy-MM-dd');
      stockMarketByDate.set(dateStr, {
        nav: point.nav || 0,
        return: point.cumulativeReturn || 0, // Recalculated TWR return from inception
      });
    });

    kbFundsEquityCurve.forEach(point => {
      const dateStr = format(point.date instanceof Date ? point.date : new Date(point.date), 'yyyy-MM-dd');
      kbFundsDataByDate.set(dateStr, {
        nav: point.nav || 0,
        return: point.cumulativeReturn || 0,
      });
    });

    // Get all unique dates and sort
    const sortedDates = Array.from(allDates).sort();
    const aggregateEquityCurve: EquityCurvePoint[] = [];

    // Find the first date where we have data for both (or at least one)
    let firstDateIndex = 0;
    for (let i = 0; i < sortedDates.length; i++) {
      const dateStr = sortedDates[i];
      if (stockMarketByDate.has(dateStr) || kbFundsDataByDate.has(dateStr)) {
        firstDateIndex = i;
        break;
      }
    }

    // Build aggregate curve by combining NAVs and calculating TWR
    // Calculate Aggregate return as weighted average of Stock Market and KB Funds returns
    // This ensures Aggregate is always between the two components
    let previousCombinedNAV = 0;
    let combinedCumulativeReturn = 0;

    for (let i = firstDateIndex; i < sortedDates.length; i++) {
      const dateStr = sortedDates[i];
      const date = new Date(dateStr);

      // Get Stock Market values (use closest previous if not exact match)
      let stockMarketNav = 0;
      let stockMarketReturn = 0;
      for (let j = i; j >= 0; j--) {
        const checkDate = sortedDates[j];
        if (stockMarketByDate.has(checkDate)) {
          const smData = stockMarketByDate.get(checkDate)!;
          stockMarketNav = smData.nav;
          stockMarketReturn = smData.return; // TWR return in percentage
          break;
        }
      }

      // Get KB Funds values (use closest previous if not exact match)
      let kbFundsNav = 0;
      let kbFundsReturn = 0;
      for (let j = i; j >= 0; j--) {
        const checkDate = sortedDates[j];
        if (kbFundsDataByDate.has(checkDate)) {
          const kbData = kbFundsDataByDate.get(checkDate)!;
          kbFundsNav = kbData.nav;
          kbFundsReturn = kbData.return; // TWR return in percentage
          break;
        }
      }

      // Combine NAV values
      const combinedNav = stockMarketNav + kbFundsNav;

      // Calculate Aggregate return as weighted average of Stock Market and KB Funds returns
      // Weighted by their NAV values to ensure Aggregate is between the two
      let aggregateReturn = 0;
      if (combinedNav > 0) {
        const stockMarketWeight = stockMarketNav / combinedNav;
        const kbFundsWeight = kbFundsNav / combinedNav;
        aggregateReturn = (stockMarketReturn * stockMarketWeight) + (kbFundsReturn * kbFundsWeight);
      }

      aggregateEquityCurve.push({
        date,
        nav: combinedNav,
        cumulativeReturn: aggregateReturn, // Weighted average return (already in percentage)
        simpleReturn: 0,
        cumulativeContributions: 0,
      });
    }

    // Format data for chart (only return percentages)
    // For Stock Market, use the recalculated TWR returns from inception
    const stockMarketChartData = recalculatedStockMarketCurve.map(point => ({
      date: point.date instanceof Date ? point.date : new Date(point.date),
      cumulativeReturn: point.cumulativeReturn || 0, // Recalculated TWR return from inception
    }));

    return NextResponse.json({
      success: true,
      stockMarket: stockMarketChartData,
      kbFunds: kbFundsEquityCurve.map(point => ({
        date: point.date instanceof Date ? point.date : new Date(point.date),
        cumulativeReturn: point.cumulativeReturn || 0,
      })),
      aggregate: aggregateEquityCurve.map(point => ({
        date: point.date instanceof Date ? point.date : new Date(point.date),
        cumulativeReturn: point.cumulativeReturn || 0,
      })),
    });
  } catch (error) {
    console.error('[Aggregate Graph API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}

