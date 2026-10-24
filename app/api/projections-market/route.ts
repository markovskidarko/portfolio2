export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server";
import { aggregateIBKRDataFromDB, combinePositionsFromDB, getAccountsFromDB } from "@/lib/db-aggregator";
import { 
  fetchMultipleAssetData, 
  calculateAssetStatistics, 
  calculateCorrelationMatrix 
} from "@/lib/marketData";
import { calculatePortfolioStatistics } from "@/lib/portfolioStats";
import { runMultivariateMonteCarloSimulation } from "@/lib/simulations";
import type { PortfolioStatistics } from "@/lib/simulations";
import { optimizePortfolioForObjective, type OptimizationObjective } from "@/lib/optimizer";

// Increase timeout for this route (fetching 10 years of data can take time)
export const maxDuration = 120;

/**
 * GET /api/projections-market?accountIds=U15352922&years=3
 * Calculate Monte Carlo projections based on 10-year historical market data for current holdings
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountIdsParam = searchParams.get("accountIds");
    const projectionYearsParam = searchParams.get("years");
    const objectiveParam = searchParams.get("objective");
    
    const selectedAccountIds = accountIdsParam 
      ? new Set(accountIdsParam.split(",").filter(id => id.trim().length > 0))
      : null;

    const projectionYears = projectionYearsParam 
      ? Math.min(5, Math.max(1, parseInt(projectionYearsParam, 10))) as 1 | 3 | 5
      : 3; // Default to 3 years

    const objective = objectiveParam && ["max-sharpe", "max-sortino", "min-volatility", "max-return"].includes(objectiveParam)
      ? objectiveParam as OptimizationObjective
      : null; // null means use current portfolio

    console.log(`[Market Projections API] Starting market-based Monte Carlo simulation`);
    console.log(`[Market Projections API] Selected accounts: ${selectedAccountIds ? Array.from(selectedAccountIds).join(", ") : "all"}`);
    console.log(`[Market Projections API] Projection years: ${projectionYears}`);
    console.log(`[Market Projections API] Objective: ${objective || "current"}`);

    // Get aggregated portfolio data to get current holdings
    const accounts = await getAccountsFromDB(selectedAccountIds);
    
    if (accounts.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No accounts found",
      }, { status: 400 });
    }

    // Get current positions (holdings)
    const positions = await combinePositionsFromDB(accounts);
    
    // Filter out cash positions and get unique symbols
    const symbols = positions
      .filter(pos => !pos.isCash && pos.totalValue > 0)
      .map(pos => pos.symbol);
    
    if (symbols.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No holdings found for market-based projection",
      }, { status: 400 });
    }

    console.log(`[Market Projections API] Fetching 10-year historical data for ${symbols.length} assets: ${symbols.join(", ")}`);

    // Fetch 10 years of historical data for all assets
    const assetsData = await fetchMultipleAssetData(symbols, 10);
    
    if (assetsData.size === 0) {
      return NextResponse.json({
        success: false,
        error: "Failed to fetch historical market data for any assets",
      }, { status: 400 });
    }

    console.log(`[Market Projections API] Fetched data for ${assetsData.size} assets`);

    // Calculate statistics for each asset
    const assetStatsMap = new Map<string, import("@/lib/marketData").AssetStatistics>();
    
    for (const [symbol, prices] of assetsData.entries()) {
      const stats = calculateAssetStatistics(symbol, prices);
      if (stats) {
        assetStatsMap.set(symbol, stats);
        console.log(`[Market Projections API] ${symbol}: Return=${(stats.annualizedReturn * 100).toFixed(2)}%, Volatility=${(stats.annualizedVolatility * 100).toFixed(2)}%`);
      }
    }

    if (assetStatsMap.size === 0) {
      return NextResponse.json({
        success: false,
        error: "Failed to calculate statistics for any assets",
      }, { status: 400 });
    }

    // Calculate correlation matrix
    console.log(`[Market Projections API] Calculating correlation matrix...`);
    const correlationMatrix = calculateCorrelationMatrix(assetsData);

    // Determine which positions to use based on objective
    let positionsToUse = positions.filter(pos => !pos.isCash && pos.totalValue > 0);
    
    // Store optimizer result if available
    let optimizerResult: import("@/lib/optimizer").OptimizationResult | null = null;
    
    // If an optimization objective is specified, get optimized weights
    if (objective) {
      optimizerResult = optimizePortfolioForObjective(
        positionsToUse,
        assetsData,
        assetStatsMap,
        objective
      );
      
      if (optimizerResult) {
        // Create positions with optimized weights
        const totalValue = positionsToUse.reduce((sum, pos) => sum + pos.totalValue, 0);
        const optimizedPositions = positionsToUse.map(pos => {
          const optimizedWeight = optimizerResult!.weights.get(pos.symbol) || 0;
          return {
            ...pos,
            totalValue: optimizedWeight * totalValue, // Scale position value by optimized weight
          };
        }).filter(pos => pos.totalValue > 0); // Only include positions with weight > 0
        
        positionsToUse = optimizedPositions;
        console.log(`[Market Projections API] Using optimized weights for ${objective}`);
        console.log(`[Market Projections API] Optimizer Expected Return: ${(optimizerResult.expectedReturn * 100).toFixed(2)}%`);
        console.log(`[Market Projections API] Optimizer Volatility: ${(optimizerResult.volatility * 100).toFixed(2)}%`);
      } else {
        console.warn(`[Market Projections API] Failed to optimize for ${objective}, using current portfolio`);
      }
    }

    // Calculate portfolio statistics
    const portfolioStats = calculatePortfolioStatistics(
      positionsToUse,
      assetStatsMap,
      correlationMatrix
    );

    if (!portfolioStats) {
      return NextResponse.json({
        success: false,
        error: "Failed to calculate portfolio statistics",
      }, { status: 400 });
    }

    // CRITICAL: If optimizer result is available, use optimizer's expectedReturn and volatility
    // This ensures Monte Carlo drift matches the Optimizer's arithmetic mean exactly
    // The optimizer uses the same 10-year data, so these values are consistent
    const driftToUse = optimizerResult ? optimizerResult.expectedReturn : portfolioStats.weightedReturn;
    const volatilityToUse = optimizerResult ? optimizerResult.volatility : portfolioStats.portfolioVolatility;
    
    if (optimizerResult) {
      console.log(`[Market Projections API] Using Optimizer values for Monte Carlo drift:`);
      console.log(`[Market Projections API]   Drift (Arithmetic Mean): ${(driftToUse * 100).toFixed(2)}%`);
      console.log(`[Market Projections API]   Volatility: ${(volatilityToUse * 100).toFixed(2)}%`);
      console.log(`[Market Projections API]   Note: Portfolio Stats calculated weightedReturn=${(portfolioStats.weightedReturn * 100).toFixed(2)}% for comparison`);
    }

    // Get current NAV
    const aggregatedData = await aggregateIBKRDataFromDB(selectedAccountIds);
    const currentNAV = aggregatedData.totalNAV;

    // Run multivariate Monte Carlo simulation
    // Convert Map objects to plain objects for JSON serialization
    const assetWeightsObj: Record<string, number> = {};
    for (const [symbol, weight] of portfolioStats.assetWeights.entries()) {
      assetWeightsObj[symbol] = weight;
    }
    
    const assetStatsObj: Record<string, { return: number; volatility: number }> = {};
    for (const [symbol, stats] of portfolioStats.assetStatistics.entries()) {
      assetStatsObj[symbol] = stats;
    }
    
    // Use optimizer's values if available, otherwise use portfolio stats
    const portfolioStatsForSim: PortfolioStatistics = {
      weightedReturn: driftToUse, // Use optimizer's expectedReturn if available
      portfolioVolatility: volatilityToUse, // Use optimizer's volatility if available
      assetWeights: assetWeightsObj,
      assetStatistics: assetStatsObj,
      correlationMatrix: portfolioStats.correlationMatrix,
      symbols: portfolioStats.symbols,
    };

    const simulationResult = runMultivariateMonteCarloSimulation(
      currentNAV,
      portfolioStatsForSim,
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
      portfolioStats: {
        weightedReturn: portfolioStats.weightedReturn,
        portfolioVolatility: portfolioStats.portfolioVolatility,
        assetCount: portfolioStats.symbols.length,
      },
    });
  } catch (error) {
    console.error(`[Market Projections API] Error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}


