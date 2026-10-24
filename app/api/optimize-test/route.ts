import { NextResponse } from "next/server";
import { 
  fetchMultipleAssetData, 
  calculateAssetStatistics 
} from "@/lib/marketData";
import { 
  optimizePortfolioForObjective, 
  type OptimizationObjective,
  type OptimizationConstraints
} from "@/lib/optimizer";

// Increase timeout for this route (fetching 10 years of data can take time)
export const maxDuration = 120;

// Force dynamic rendering to prevent caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/optimize-test?tickers=AAPL,MSFT,GOOGL&objective=max-sharpe
 * Optimize a test portfolio using manually entered tickers
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tickersParam = searchParams.get("tickers");
    const objectiveParam = searchParams.get("objective") || "max-sharpe";
    const targetReturnParam = searchParams.get("targetReturn");
    const maxDrawdownParam = searchParams.get("maxDrawdown");
    
    if (!tickersParam) {
      return NextResponse.json({
        success: false,
        error: "Tickers parameter is required",
      }, { status: 400 });
    }

    const objective = objectiveParam as OptimizationObjective;
    if (!["max-sharpe", "max-sortino", "min-volatility", "max-return", "custom-balanced"].includes(objective)) {
      return NextResponse.json({
        success: false,
        error: "Invalid objective. Use: max-sharpe, max-sortino, min-volatility, max-return, or custom-balanced",
      }, { status: 400 });
    }
    
    // Parse constraints
    const constraints: OptimizationConstraints = {};
    if (targetReturnParam) {
      const targetReturn = parseFloat(targetReturnParam);
      if (!isNaN(targetReturn) && targetReturn > 0) {
        constraints.targetReturn = targetReturn / 100; // Convert percentage to decimal
      }
    }
    if (maxDrawdownParam) {
      const maxDrawdown = parseFloat(maxDrawdownParam);
      if (!isNaN(maxDrawdown) && maxDrawdown < 0) {
        constraints.maxDrawdown = maxDrawdown / 100; // Convert percentage to decimal
      }
    }
    
    // Validate constraints for custom-balanced objective
    if (objective === "custom-balanced") {
      if (!constraints.targetReturn || !constraints.maxDrawdown) {
        return NextResponse.json({
          success: false,
          error: "custom-balanced objective requires both targetReturn and maxDrawdown constraints",
        }, { status: 400 });
      }
    }

    // Parse tickers
    const tickers = tickersParam
      .split(",")
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0);
    
    if (tickers.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No valid tickers provided",
      }, { status: 400 });
    }

    // Fetch 10 years of historical data for all tickers
    const assetsData = await fetchMultipleAssetData(tickers, 10);
    
    if (assetsData.size === 0) {
      return NextResponse.json({
        success: false,
        error: "Failed to fetch historical market data for any tickers",
      }, { status: 400 });
    }

    // Calculate statistics for each asset
    const assetStatsMap = new Map<string, import("@/lib/marketData").AssetStatistics>();
    
    for (const [symbol, prices] of assetsData.entries()) {
      const stats = calculateAssetStatistics(symbol, prices);
      if (stats) {
        assetStatsMap.set(symbol, stats);
      }
    }

    if (assetStatsMap.size === 0) {
      return NextResponse.json({
        success: false,
        error: "Failed to calculate statistics for any tickers",
      }, { status: 400 });
    }

    // Create mock positions (equal weight for test portfolio)
    const mockPositions = Array.from(assetStatsMap.keys()).map(symbol => ({
      symbol,
      description: symbol,
      totalValue: 1.0 / assetStatsMap.size, // Equal weight
      totalPosition: 1.0 / assetStatsMap.size,
      totalCostBasis: 1.0 / assetStatsMap.size,
      totalUnrealizedPnl: 0,
      totalPercentOfNAV: 100 / assetStatsMap.size,
      isCash: false,
      accounts: [],
    }));

    // Optimize portfolio
    const optimizationResult = optimizePortfolioForObjective(
      mockPositions,
      assetsData,
      assetStatsMap,
      objective,
      Object.keys(constraints).length > 0 ? constraints : undefined
    );

    if (!optimizationResult) {
      return NextResponse.json({
        success: false,
        error: "Failed to optimize portfolio",
      }, { status: 400 });
    }

    // Convert weights Map to Record
    const weightsRecord: Record<string, number> = {};
    optimizationResult.weights.forEach((weight, symbol) => {
      weightsRecord[symbol] = weight;
    });

    return NextResponse.json({
      success: true,
      objective,
      optimal: {
        weights: weightsRecord,
        expectedReturn: optimizationResult.expectedReturn,
        volatility: optimizationResult.volatility,
        sharpeRatio: optimizationResult.sharpeRatio,
        sortinoRatio: optimizationResult.sortinoRatio,
        maxDrawdown: optimizationResult.maxDrawdown,
        feasibilityWarning: optimizationResult.feasibilityWarning,
        constraintsSatisfied: optimizationResult.constraintsSatisfied,
      },
    });
  } catch (error) {
    console.error("[Optimize Test API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}











