export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { kbFundPriceQueries } from '@/lib/database';
import { KB_FUND_UNITS } from '@/lib/kb-funds';
import { getExchangeRate } from '@/lib/exchange-rate';
import { calculateYTDMetrics, calculateMTDMetrics, calculateTodayMetrics } from '@/lib/calculations';
import type { EquityCurvePoint } from '@/lib/types';

export const maxDuration = 60; // This can be a long-running operation

export async function GET() {
  try {
    const fundNames: Array<keyof typeof KB_FUND_UNITS> = ["Stocks", "Balanced", "Gold"];
    const fundData = [];

    // Fetch USD rate directly (server-side)
    const exchangeRateResult = await getExchangeRate();
    const usdRate = exchangeRateResult.rate;

    if (!usdRate) {
      throw new Error("Failed to fetch USD exchange rate");
    }

    for (const fundName of fundNames) {
      const prices = await kbFundPriceQueries.getByFund(fundName) as Array<{
        date: string;
        price_per_unit_mkd: number;
      }>;

      if (prices.length > 0) {
        // Get latest price
        const sortedPrices = prices.sort((a, b) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        const latestPrice = sortedPrices[0].price_per_unit_mkd;

        const units = KB_FUND_UNITS[fundName];
        const totalValueMKD = latestPrice * units;
        const totalValueUSD = totalValueMKD / usdRate;

        // Build equity curve for this fund
        const equityCurve: EquityCurvePoint[] = [];
        let previousNAV = 0;
        let cumulativeReturn = 0;

        for (const price of sortedPrices.reverse()) {
          const navUSD = (price.price_per_unit_mkd * units) / usdRate;
          
          let dailyReturn = 0;
          if (previousNAV > 0) {
            dailyReturn = (navUSD / previousNAV) - 1;
            cumulativeReturn = (1 + cumulativeReturn) * (1 + dailyReturn) - 1;
          }

          equityCurve.push({
            date: new Date(price.date),
            nav: navUSD,
            cumulativeReturn: cumulativeReturn * 100,
            simpleReturn: 0,
            cumulativeContributions: 0,
          });

          previousNAV = navUSD;
        }

        // Calculate metrics
        const currentNAV = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : 0;
        const ytdMetrics = equityCurve.length > 0 ? calculateYTDMetrics(equityCurve, currentNAV) : { ytdReturn: null, ytdValue: null };
        const mtdMetrics = equityCurve.length > 0 ? calculateMTDMetrics(equityCurve, currentNAV) : { mtdReturn: null, mtdValue: null };
        
        // For Today calculation: use latest recorded NAV date vs date-1 NAV from database
        let lastRecordedNav: number | null = null;
        if (equityCurve.length >= 2) {
          // Get the second-to-last NAV (date-1) for Today calculation
          lastRecordedNav = equityCurve[equityCurve.length - 2].nav || null;
        } else if (equityCurve.length === 1) {
          // If only one point, use it as baseline (Today will be 0)
          lastRecordedNav = equityCurve[0].nav || null;
        }
        
        const todayMetrics = lastRecordedNav !== null && lastRecordedNav > 0 && equityCurve.length > 0
          ? calculateTodayMetrics(equityCurve, currentNAV, lastRecordedNav)
          : { todayGainLoss: null, todayGainLossPercent: null };

        fundData.push({
          fundName,
          latestPrice,
          totalValueMKD,
          totalValueUSD,
          ytdMetrics,
          mtdMetrics,
          todayMetrics,
        });
      } else {
        fundData.push({
          fundName,
          latestPrice: 0,
          totalValueMKD: 0,
          totalValueUSD: 0,
          ytdMetrics: { ytdReturn: null, ytdValue: null },
          mtdMetrics: { mtdReturn: null, mtdValue: null },
          todayMetrics: { todayGainLoss: null, todayGainLossPercent: null },
        });
      }
    }

    return NextResponse.json({ success: true, funds: fundData });
  } catch (error) {
    console.error("API Error fetching KB Funds sidebar data:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "An unknown error occurred" },
      { status: 500 }
    );
  }
}

