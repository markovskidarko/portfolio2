export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server";
import { aggregateIBKRDataFromDB } from "@/lib/db-aggregator";
import { getRiskAnalytics, convertCumulativeToDailyReturns, calculateDailyReturns } from "@/lib/risk";
import { runMonteCarloSimulation } from "@/lib/simulations";
import { format } from "date-fns";

// Increase timeout for this route (Monte Carlo simulations can take time)
export const maxDuration = 60;

/**
 * GET /api/projections?accountIds=U15352922&years=3
 * Calculate Monte Carlo projections for selected portfolios
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountIdsParam = searchParams.get("accountIds");
    const projectionYearsParam = searchParams.get("years");
    
    const selectedAccountIds = accountIdsParam 
      ? new Set(accountIdsParam.split(",").filter(id => id.trim().length > 0))
      : null;

    const projectionYears = projectionYearsParam 
      ? Math.min(5, Math.max(1, parseInt(projectionYearsParam, 10))) as 1 | 3 | 5
      : 3; // Default to 3 years

    console.log(`[Projections API] Starting Monte Carlo simulation`);
    console.log(`[Projections API] Selected accounts: ${selectedAccountIds ? Array.from(selectedAccountIds).join(", ") : "all"}`);
    console.log(`[Projections API] Projection years: ${projectionYears}`);

    // Get aggregated portfolio data (includes equity curve and cash flows)
    const aggregatedData = aggregateIBKRDataFromDB(selectedAccountIds);
    
    if (!aggregatedData.equityCurve || aggregatedData.equityCurve.length < 2) {
      return NextResponse.json({
        success: false,
        error: "Insufficient historical data for projections. Need at least 2 NAV points.",
      }, { status: 400 });
    }

    // Extract NAV history and cash flows from equity curve
    const dailyNavHistory = aggregatedData.equityCurve.map(point => ({
      date: point.date instanceof Date ? point.date : new Date(point.date),
      nav: point.nav,
    }));

    // Extract cash flows from equity curve
    const cashFlows = new Map<string, number>();
    for (const point of aggregatedData.equityCurve) {
      if (point.cashFlow !== undefined && point.cashFlow !== 0) {
        const dateKey = format(point.date instanceof Date ? point.date : new Date(point.date), 'yyyy-MM-dd');
        cashFlows.set(dateKey, point.cashFlow);
      }
    }

    // Calculate daily returns (neutralizing cash flows)
    const dailyReturns = calculateDailyReturns(dailyNavHistory, cashFlows);
    
    if (dailyReturns.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Insufficient return data for projections.",
      }, { status: 400 });
    }

    // Calculate historical statistics
    const meanReturn = dailyReturns.reduce((sum, r) => sum + r.return, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r.return - meanReturn, 2), 0) / dailyReturns.length;
    const volatility = Math.sqrt(variance);
    
    // Annualize metrics (using 252 trading days)
    const TRADING_DAYS_PER_YEAR = 252;
    const annualizedReturn = meanReturn * TRADING_DAYS_PER_YEAR;
    const annualizedVolatility = volatility * Math.sqrt(TRADING_DAYS_PER_YEAR);

    console.log(`[Projections API] Historical Statistics:`);
    console.log(`[Projections API]   Annualized Return: ${(annualizedReturn * 100).toFixed(2)}%`);
    console.log(`[Projections API]   Annualized Volatility: ${(annualizedVolatility * 100).toFixed(2)}%`);

    // Run Monte Carlo simulation
    const currentNAV = aggregatedData.totalNAV;
    const simulationResult = runMonteCarloSimulation(
      currentNAV,
      annualizedReturn,
      annualizedVolatility,
      projectionYears
    );

    return NextResponse.json({
      success: true,
      projections: simulationResult.projections.map(proj => ({
        date: proj.date.toISOString(),
        percentile5: proj.percentile5,
        percentile25: proj.percentile25,
        percentile50: proj.percentile50,
        percentile75: proj.percentile75,
        percentile95: proj.percentile95,
      })),
      iterations: simulationResult.iterations,
      projectionYears: simulationResult.projectionYears,
      driftUsed: simulationResult.driftUsed,
      volatilityUsed: simulationResult.volatilityUsed,
    });
  } catch (error) {
    console.error(`[Projections API] Error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}


