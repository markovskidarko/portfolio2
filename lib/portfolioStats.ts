/**
 * Portfolio Statistics Calculation
 * Calculates portfolio-level statistics from asset holdings and market data
 */

import type { CombinedPosition } from "./types";
import type { AssetStatistics, CorrelationMatrix } from "./marketData";

export interface PortfolioStatistics {
  weightedReturn: number; // Portfolio-weighted annualized return
  portfolioVolatility: number; // Portfolio volatility (considering correlations)
  assetWeights: Map<string, number>; // Symbol -> weight (0-1)
  assetStatistics: Map<string, { return: number; volatility: number }>; // Per-asset stats
  correlationMatrix: CorrelationMatrix; // Asset correlation matrix
  symbols: string[]; // Ordered list of symbols (matches correlation matrix)
}

/**
 * Calculate portfolio statistics from holdings and asset statistics
 * Portfolio Return = Σ(w_i * r_i) where w_i is weight, r_i is asset return
 * Portfolio Volatility = sqrt(Σ_i Σ_j w_i * w_j * σ_i * σ_j * ρ_ij)
 */
export function calculatePortfolioStatistics(
  positions: CombinedPosition[],
  assetStatsMap: Map<string, AssetStatistics>,
  correlationMatrix: CorrelationMatrix
): PortfolioStatistics | null {
  if (positions.length === 0 || assetStatsMap.size === 0) {
    return null;
  }

  // Calculate total portfolio value
  const totalValue = positions.reduce((sum, pos) => sum + pos.totalValue, 0);
  
  if (totalValue <= 0) {
    return null;
  }

  // Calculate asset weights and filter to assets we have statistics for
  const assetWeights = new Map<string, number>();
  const assetStatistics = new Map<string, { return: number; volatility: number }>();
  const symbolsWithData: string[] = [];

  for (const position of positions) {
    // Skip cash positions
    if (position.isCash) {
      continue;
    }

    const symbol = position.symbol;
    const stats = assetStatsMap.get(symbol);
    
    if (!stats) {
      console.warn(`[Portfolio Stats] No statistics available for ${symbol}`);
      continue;
    }

    const weight = position.totalValue / totalValue;
    assetWeights.set(symbol, weight);
    assetStatistics.set(symbol, {
      return: stats.annualizedReturn,
      volatility: stats.annualizedVolatility,
    });
    symbolsWithData.push(symbol);
  }

  if (symbolsWithData.length === 0) {
    return null;
  }

  // Calculate weighted return
  let weightedReturn = 0;
  for (const symbol of symbolsWithData) {
    const weight = assetWeights.get(symbol) || 0;
    const stats = assetStatistics.get(symbol);
    if (stats) {
      weightedReturn += weight * stats.return;
    }
  }

  // Calculate portfolio volatility using correlation matrix
  // Portfolio Volatility = sqrt(Σ_i Σ_j w_i * w_j * σ_i * σ_j * ρ_ij)
  let portfolioVariance = 0;
  
  // Get symbol indices in correlation matrix
  const symbolIndices = new Map<string, number>();
  for (let i = 0; i < correlationMatrix.symbols.length; i++) {
    symbolIndices.set(correlationMatrix.symbols[i], i);
  }

  for (let i = 0; i < symbolsWithData.length; i++) {
    const symbolI = symbolsWithData[i];
    const weightI = assetWeights.get(symbolI) || 0;
    const statsI = assetStatistics.get(symbolI);
    
    if (!statsI) continue;
    
    const volI = statsI.volatility;
    const indexI = symbolIndices.get(symbolI);
    
    for (let j = 0; j < symbolsWithData.length; j++) {
      const symbolJ = symbolsWithData[j];
      const weightJ = assetWeights.get(symbolJ) || 0;
      const statsJ = assetStatistics.get(symbolJ);
      
      if (!statsJ) continue;
      
      const volJ = statsJ.volatility;
      const indexJ = symbolIndices.get(symbolJ);
      
      // Get correlation coefficient
      let correlation = 0;
      if (indexI !== undefined && indexJ !== undefined) {
        correlation = correlationMatrix.matrix[indexI]?.[indexJ] || 0;
      }
      
      // If same asset, correlation is 1
      if (i === j) {
        correlation = 1;
      }
      
      portfolioVariance += weightI * weightJ * volI * volJ * correlation;
    }
  }

  const portfolioVolatility = Math.sqrt(portfolioVariance);

  console.log(`[Portfolio Stats] Calculated portfolio statistics:`);
  console.log(`[Portfolio Stats]   Weighted Return: ${(weightedReturn * 100).toFixed(2)}%`);
  console.log(`[Portfolio Stats]   Portfolio Volatility: ${(portfolioVolatility * 100).toFixed(2)}%`);
  console.log(`[Portfolio Stats]   Number of Assets: ${symbolsWithData.length}`);

  return {
    weightedReturn,
    portfolioVolatility,
    assetWeights,
    assetStatistics,
    correlationMatrix,
    symbols: symbolsWithData,
  };
}











