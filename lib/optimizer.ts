/**
 * Markowitz Mean-Variance Optimization (MVO) Engine
 * Implements portfolio optimization with Max Sharpe, Max Sortino, Min Volatility, and Max Return objectives
 */

import type { AssetStatistics, AssetPriceData } from "./marketData";
import type { CombinedPosition } from "./types";

const RISK_FREE_RATE = 0.04; // 4% annual risk-free rate
const TRADING_DAYS_PER_YEAR = 252;
const MAX_WEIGHT_CONSTRAINT_DEFAULT = 0.15; // 15% maximum weight per asset (concentration constraint)
const MAX_WEIGHT_CONSTRAINT_MAX_RETURN = 0.40; // 40% maximum weight per asset for Max Return objective
const MIN_WEIGHT_CONSTRAINT = 0.0001; // 0.01% minimum weight (effectively allows 0 for Min Volatility)

export interface OptimizationResult {
  weights: Map<string, number>; // Symbol -> weight (0-1)
  expectedReturn: number; // Annualized expected return
  volatility: number; // Annualized volatility
  sharpeRatio: number; // Sharpe ratio
  sortinoRatio: number; // Sortino ratio
  downsideDeviation: number; // Downside deviation
  maxDrawdown?: number; // Maximum drawdown (negative value, e.g., -0.15 = -15%)
  feasibilityWarning?: string; // Warning if constraints are not feasible
  constraintsSatisfied?: boolean; // Whether hard constraints were satisfied
}

export interface EfficientFrontierPoint {
  risk: number; // Volatility (σ)
  return: number; // Expected return (μ)
  weights: Map<string, number>; // Portfolio weights
}

export type OptimizationObjective = "max-sharpe" | "max-sortino" | "min-volatility" | "max-return" | "custom-balanced";

export interface OptimizationConstraints {
  targetReturn?: number; // Target annual return (e.g., 0.10 = 10%)
  maxDrawdown?: number; // Maximum allowable drawdown (e.g., -0.20 = -20%, negative value)
}

/**
 * Calculate daily returns from price data
 */
function calculateDailyReturns(prices: AssetPriceData[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1].adjustedClose > 0) {
      const dailyReturn = (prices[i].adjustedClose - prices[i - 1].adjustedClose) / prices[i - 1].adjustedClose;
      returns.push(dailyReturn);
    }
  }
  return returns;
}

/**
 * Calculate Max Drawdown for an optimized portfolio
 * Reconstructs portfolio equity curve from historical returns using optimized weights
 */
export function calculateOptimizedPortfolioMaxDrawdown(
  weights: Map<string, number>,
  assetsData: Map<string, AssetPriceData[]>,
  symbols: string[]
): number {
  // Find minimum length of price data across all assets
  let minLength = Infinity;
  const alignedReturns: Map<string, number[]> = new Map();
  
  for (const symbol of symbols) {
    if (!weights.has(symbol) || !assetsData.has(symbol)) continue;
    const prices = assetsData.get(symbol)!;
    const returns = calculateDailyReturns(prices);
    if (returns.length > 0) {
      alignedReturns.set(symbol, returns);
      minLength = Math.min(minLength, returns.length);
    }
  }
  
  if (minLength === Infinity || minLength === 0) return 0;
  
  // Reconstruct portfolio daily returns using optimized weights
  const portfolioReturns: number[] = [];
  for (let i = 0; i < minLength; i++) {
    let portfolioReturn = 0;
    for (const symbol of symbols) {
      if (!weights.has(symbol) || !alignedReturns.has(symbol)) continue;
      const weight = weights.get(symbol)!;
      const returns = alignedReturns.get(symbol)!;
      // Use most recent returns (align to same time period)
      const returnIdx = returns.length - minLength + i;
      if (returnIdx >= 0 && returnIdx < returns.length) {
        portfolioReturn += weight * returns[returnIdx];
      }
    }
    portfolioReturns.push(portfolioReturn);
  }
  
  // Build equity curve from portfolio returns (starting at 1.0)
  const equityCurve: Array<{ date: Date; nav: number }> = [];
  let cumulativeNav = 1.0;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - portfolioReturns.length);
  
  equityCurve.push({ date: new Date(startDate), nav: cumulativeNav });
  
  for (let i = 0; i < portfolioReturns.length; i++) {
    cumulativeNav *= (1 + portfolioReturns[i]);
    const date = new Date(startDate);
    date.setDate(date.getDate() + i + 1);
    equityCurve.push({ date, nav: cumulativeNav });
  }
  
  // Calculate Max Drawdown using the same method as Risk Analytics
  if (equityCurve.length === 0) return 0;
  
  let peakNav = equityCurve[0].nav;
  let maxDrawdown = 0;
  
  for (const point of equityCurve) {
    if (point.nav > peakNav) {
      peakNav = point.nav;
    }
    const drawdown = peakNav > 0 ? (point.nav - peakNav) / peakNav : 0;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown;
}

/**
 * Calculate annualized covariance matrix from price data
 * Returns a matrix where matrix[i][j] is the covariance between assets i and j
 */
export function calculateCovarianceMatrix(
  assetsData: Map<string, AssetPriceData[]>
): { symbols: string[]; matrix: number[][] } | null {
  const symbols = Array.from(assetsData.keys());
  const n = symbols.length;

  if (n === 0) return null;

  // Calculate daily returns for each asset
  const returnsMap = new Map<string, number[]>();
  let minLength = Infinity;

  for (const [symbol, prices] of assetsData.entries()) {
    const dailyReturns = calculateDailyReturns(prices);
    returnsMap.set(symbol, dailyReturns);
    minLength = Math.min(minLength, dailyReturns.length);
  }

  if (minLength < 2) return null;

  // Align returns to same length (use most recent data)
  const alignedReturns: number[][] = [];
  for (const symbol of symbols) {
    const returns = returnsMap.get(symbol)!;
    alignedReturns.push(returns.slice(-minLength));
  }

  // Calculate mean returns
  const meanReturns = symbols.map((_, i) => {
    const rets = alignedReturns[i];
    return rets.reduce((sum, r) => sum + r, 0) / rets.length;
  });

  // Calculate covariance matrix
  const covarianceMatrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    covarianceMatrix[i] = [];
    for (let j = 0; j < n; j++) {
      const retsI = alignedReturns[i];
      const retsJ = alignedReturns[j];
      const meanI = meanReturns[i];
      const meanJ = meanReturns[j];

      let covariance = 0;
      for (let k = 0; k < minLength; k++) {
        covariance += (retsI[k] - meanI) * (retsJ[k] - meanJ);
      }
      covariance /= (minLength - 1);

      // Annualize: multiply by trading days per year
      covariance *= TRADING_DAYS_PER_YEAR;
      covarianceMatrix[i][j] = covariance;
    }
  }

  return { symbols, matrix: covarianceMatrix };
}

/**
 * Calculate annualized mean returns from price data
 */
function calculateMeanReturns(
  assetsData: Map<string, AssetPriceData[]>
): Map<string, number> {
  const meanReturns = new Map<string, number>();

  for (const [symbol, prices] of assetsData.entries()) {
    if (prices.length < 2) {
      meanReturns.set(symbol, 0);
      continue;
    }

    const dailyReturns = calculateDailyReturns(prices);
    if (dailyReturns.length === 0) {
      meanReturns.set(symbol, 0);
      continue;
    }

    const meanDailyReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
    const annualizedReturn = meanDailyReturn * TRADING_DAYS_PER_YEAR;
    meanReturns.set(symbol, annualizedReturn);
  }

  return meanReturns;
}

/**
 * Calculate downside deviation (standard deviation of negative returns only)
 */
function calculateDownsideDeviation(
  weights: number[],
  meanReturns: number[],
  covarianceMatrix: number[][],
  assetsData: Map<string, AssetPriceData[]>,
  symbols: string[]
): number {
  // For simplicity, we'll approximate downside deviation
  // In practice, we'd need the full return distribution
  // Here we use: DD = sqrt(Σ w_i * w_j * σ_i * σ_j * ρ_ij) where only negative returns contribute
  // Approximation: Use volatility scaled by a factor based on negative return frequency

  // Calculate portfolio volatility first
  let portfolioVariance = 0;
  for (let i = 0; i < symbols.length; i++) {
    for (let j = 0; j < symbols.length; j++) {
      portfolioVariance += weights[i] * weights[j] * covarianceMatrix[i][j];
    }
  }
  const portfolioVolatility = Math.sqrt(portfolioVariance);

  // Calculate average negative return frequency across assets
  let negativeReturnFrequency = 0;
  let count = 0;
  for (const [symbol, prices] of assetsData.entries()) {
    const dailyReturns = calculateDailyReturns(prices);
    const negativeCount = dailyReturns.filter(r => r < 0).length;
    negativeReturnFrequency += negativeCount / dailyReturns.length;
    count++;
  }
  const avgNegativeFreq = count > 0 ? negativeReturnFrequency / count : 0.5;

  // Approximate downside deviation as a fraction of total volatility
  // This is a simplification - true downside deviation requires full distribution
  return portfolioVolatility * Math.sqrt(avgNegativeFreq);
}

/**
 * Calculate portfolio metrics given weights
 */
export function calculatePortfolioMetrics(
  weights: number[],
  meanReturns: number[],
  covarianceMatrix: number[][],
  assetsData: Map<string, AssetPriceData[]>,
  symbols: string[]
): {
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  downsideDeviation: number;
} {
  // Expected return: w^T * μ
  let expectedReturn = 0;
  for (let i = 0; i < symbols.length; i++) {
    expectedReturn += weights[i] * meanReturns[i];
  }

  // Portfolio variance: w^T * Σ * w
  let portfolioVariance = 0;
  for (let i = 0; i < symbols.length; i++) {
    for (let j = 0; j < symbols.length; j++) {
      portfolioVariance += weights[i] * weights[j] * covarianceMatrix[i][j];
    }
  }
  const volatility = Math.sqrt(portfolioVariance);

  // Sharpe ratio: (μ - R_f) / σ
  const sharpeRatio = volatility > 0 ? (expectedReturn - RISK_FREE_RATE) / volatility : 0;

  // Downside deviation
  const downsideDeviation = calculateDownsideDeviation(
    weights,
    meanReturns,
    covarianceMatrix,
    assetsData,
    symbols
  );

  // Sortino ratio: (μ - R_f) / DD
  const sortinoRatio = downsideDeviation > 0 ? (expectedReturn - RISK_FREE_RATE) / downsideDeviation : 0;

  return {
    expectedReturn,
    volatility,
    sharpeRatio,
    sortinoRatio,
    downsideDeviation,
  };
}

/**
 * Optimize portfolio using gradient descent (simplified solver)
 * This is a basic implementation - for production, use a proper QP solver
 */
function optimizePortfolio(
  meanReturns: number[],
  covarianceMatrix: number[][],
  assetsData: Map<string, AssetPriceData[]>,
  symbols: string[],
  objective: OptimizationObjective,
  constraints?: OptimizationConstraints
): number[] {
  const n = symbols.length;
  if (n === 0) return [];

  // Special case: Max Return - pure return maximization, ignore covariance
  if (objective === "max-return") {
    const maxWeight = MAX_WEIGHT_CONSTRAINT_MAX_RETURN; // 40%
    const weights = new Array(n).fill(0);
    
    // Sort assets by return (highest first)
    const sortedIndices = meanReturns
      .map((ret, idx) => ({ ret, idx }))
      .sort((a, b) => b.ret - a.ret);
    
    // Allocate up to maxWeight to highest returning assets
    let remaining = 1.0;
    for (const { idx } of sortedIndices) {
      if (remaining <= 0) break;
      const allocation = Math.min(maxWeight, remaining);
      weights[idx] = allocation;
      remaining -= allocation;
    }
    
    // If there's still remaining, distribute to highest returns (up to maxWeight)
    if (remaining > 0.0001) {
      for (const { idx } of sortedIndices) {
        if (remaining <= 0) break;
        if (weights[idx] < maxWeight) {
          const add = Math.min(maxWeight - weights[idx], remaining);
          weights[idx] += add;
          remaining -= add;
        }
      }
    }
    
    // Final normalization
    const sum = weights.reduce((s, w) => s + w, 0);
    if (sum > 0) {
      return weights.map(w => w / sum);
    }
    return weights;
  }

  // Initialize weights (equal weight) for other objectives
  let weights = new Array(n).fill(1 / n);
  const learningRate = 0.01;
  const maxIterations = 1000;
  const tolerance = 1e-6;

  // Hard constraint penalty constant
  const INFINITE_PENALTY = 1e10;
  
  for (let iter = 0; iter < maxIterations; iter++) {
    const metrics = calculatePortfolioMetrics(weights, meanReturns, covarianceMatrix, assetsData, symbols);
    
    // Calculate gradient based on objective
    const gradient = new Array(n).fill(0);
    
    // HARD CONSTRAINT CHECK: For custom-balanced, check constraints and apply infinite penalty if violated
    let constraintViolated = false;
    if (objective === "custom-balanced" && constraints) {
      // Check Target Return constraint
      if (constraints.targetReturn !== undefined && metrics.expectedReturn < constraints.targetReturn) {
        constraintViolated = true;
      }
      
      // Check Max Drawdown constraint
      if (constraints.maxDrawdown !== undefined && constraints.maxDrawdown < 0) {
        const weightsMap = new Map<string, number>();
        symbols.forEach((sym, idx) => weightsMap.set(sym, weights[idx]));
        const mdd = calculateOptimizedPortfolioMaxDrawdown(weightsMap, assetsData, symbols);
        // mdd < maxDrawdown means mdd is worse (more negative)
        if (mdd < constraints.maxDrawdown) {
          constraintViolated = true;
        }
      }
      
      // If constraints violated, apply infinite penalty to gradient
      if (constraintViolated) {
        // Set gradient to push away from this solution
        for (let i = 0; i < n; i++) {
          gradient[i] = -INFINITE_PENALTY * weights[i]; // Push weights toward zero
        }
        // Skip normal gradient calculation and go straight to constraint handling
      }
    }
    
    if (!constraintViolated) {
      if (objective === "max-sharpe") {
      // Gradient for Sharpe: maximize (μ - R_f) / σ
      const excessReturn = metrics.expectedReturn - RISK_FREE_RATE;
      if (metrics.volatility > 0) {
        for (let i = 0; i < n; i++) {
          // ∂(Sharpe)/∂w_i = (μ_i * σ - (μ - R_f) * ∂σ/∂w_i) / σ²
          let dSigma = 0;
          for (let j = 0; j < n; j++) {
            dSigma += weights[j] * covarianceMatrix[i][j];
          }
          dSigma /= metrics.volatility;

          gradient[i] = (meanReturns[i] * metrics.volatility - excessReturn * dSigma) / (metrics.volatility * metrics.volatility);
        }
      }
    } else if (objective === "max-sortino") {
      // Gradient for Sortino: maximize (μ - R_f) / DD
      const excessReturn = metrics.expectedReturn - RISK_FREE_RATE;
      if (metrics.downsideDeviation > 0) {
        for (let i = 0; i < n; i++) {
          // Simplified gradient (approximation)
          let dSigma = 0;
          for (let j = 0; j < n; j++) {
            dSigma += weights[j] * covarianceMatrix[i][j];
          }
          dSigma /= metrics.volatility;
          const dDD = dSigma * Math.sqrt(0.5); // Approximation

          gradient[i] = (meanReturns[i] * metrics.downsideDeviation - excessReturn * dDD) / (metrics.downsideDeviation * metrics.downsideDeviation);
        }
      }
    } else if (objective === "min-volatility") {
      // Gradient for Min Volatility: minimize σ = sqrt(w^T * Σ * w)
      if (metrics.volatility > 0) {
        for (let i = 0; i < n; i++) {
          let dSigma = 0;
          for (let j = 0; j < n; j++) {
            dSigma += weights[j] * covarianceMatrix[i][j];
          }
          gradient[i] = dSigma / metrics.volatility;
        }
      }
    } else if (objective === "custom-balanced") {
      // Custom Balanced: Maximize Sortino Ratio while respecting Target Return and Max Drawdown
      // Use Sortino gradient as base
      const excessReturn = metrics.expectedReturn - RISK_FREE_RATE;
      if (metrics.downsideDeviation > 0) {
        for (let i = 0; i < n; i++) {
          let dSigma = 0;
          for (let j = 0; j < n; j++) {
            dSigma += weights[j] * covarianceMatrix[i][j];
          }
          dSigma /= metrics.volatility;
          const dDD = dSigma * Math.sqrt(0.5); // Approximation
          gradient[i] = (meanReturns[i] * metrics.downsideDeviation - excessReturn * dDD) / (metrics.downsideDeviation * metrics.downsideDeviation);
        }
      }
    }
    // Note: Max Return is handled separately before this loop, so it shouldn't reach here
    }

    // Update weights (gradient ascent for max objectives, descent for min)
    const direction = objective === "min-volatility" ? -1 : 1;
    let newWeights = weights.map((w, i) => w + direction * learningRate * gradient[i]);

    // Determine max weight constraint based on objective
    // (max-return is handled separately above and returns early)
    const maxWeight = MAX_WEIGHT_CONSTRAINT_DEFAULT;

    // Project onto constraints: sum = 1, w >= MIN_WEIGHT_CONSTRAINT (effectively 0), w <= maxWeight
    // First, enforce min and max weight constraints
    const constrainedWeights = newWeights.map(w => {
      // For Min Volatility, allow weights to go to 0 (or very close to 0)
      // For other objectives, enforce minimum weight
      const minWeight = objective === "min-volatility" ? 0 : MIN_WEIGHT_CONSTRAINT;
      return Math.min(Math.max(minWeight, w), maxWeight);
    });
    
    // Then normalize to sum to exactly 1.0
    let sum = constrainedWeights.reduce((s, w) => s + w, 0);
    if (sum > 0) {
      weights = constrainedWeights.map(w => w / sum);
      
      // Re-apply max constraint after normalization (iterative approach)
      // This ensures we respect max weight while maintaining sum = 1.0
      for (let iter = 0; iter < 20; iter++) {
        let excess = 0;
        const capped = weights.map(w => {
          if (w > maxWeight) {
            excess += w - maxWeight;
            return maxWeight;
          }
          return w;
        });
        
        if (excess < 0.0001) break; // Converged
        
        // Redistribute excess to assets below max
        const belowMax = capped.map((w, i) => w < maxWeight ? i : -1).filter(i => i >= 0);
        if (belowMax.length > 0) {
          const excessPerAsset = excess / belowMax.length;
          belowMax.forEach(idx => {
            capped[idx] = Math.min(maxWeight, capped[idx] + excessPerAsset);
          });
        }
        
        sum = capped.reduce((s, w) => s + w, 0);
        if (sum > 0) {
          weights = capped.map(w => w / sum);
        } else {
          weights = new Array(n).fill(1 / n);
          break;
        }
      }
      
      // Final normalization to ensure exact sum = 1.0
      sum = weights.reduce((s, w) => s + w, 0);
      if (Math.abs(sum - 1.0) > 0.0001) {
        weights = weights.map(w => w / sum);
      }
    } else {
      weights = new Array(n).fill(1 / n);
    }
    
    // For Min Volatility, allow very small weights to be set to 0
    if (objective === "min-volatility") {
      weights = weights.map(w => w < MIN_WEIGHT_CONSTRAINT ? 0 : w);
      // Renormalize after zeroing out small weights
      sum = weights.reduce((s, w) => s + w, 0);
      if (sum > 0) {
        weights = weights.map(w => w / sum);
      } else {
        weights = new Array(n).fill(1 / n);
      }
    }

    // Check convergence
    const weightChange = weights.reduce((max, w, i) => Math.max(max, Math.abs(w - (iter > 0 ? weights[i] : 0))), 0);
    if (weightChange < tolerance) break;

    // Apply target return constraint if specified
    if (constraints?.targetReturn !== undefined) {
      const currentReturn = weights.reduce((sum, w, i) => sum + w * meanReturns[i], 0);
      const targetReturn = constraints.targetReturn;
      
      if (Math.abs(currentReturn - targetReturn) > 0.001) {
        // Adjust weights to meet target return
        const returnDiff = targetReturn - currentReturn;
        const maxReturn = Math.max(...meanReturns);
        const minReturn = Math.min(...meanReturns);
        
        if (returnDiff > 0 && currentReturn < maxReturn) {
          // Need higher return: increase weights of high-return assets
          const sortedByReturn = meanReturns
            .map((ret, idx) => ({ ret, idx }))
            .sort((a, b) => b.ret - a.ret);
          
          let remainingDiff = returnDiff;
          for (const { idx } of sortedByReturn) {
            if (remainingDiff <= 0) break;
            const assetReturn = meanReturns[idx];
            const returnGap = assetReturn - currentReturn;
            if (returnGap > 0) {
              const weightIncrease = Math.min(
                maxWeight - weights[idx],
                (remainingDiff / returnGap) * 0.1
              );
              weights[idx] += weightIncrease;
              remainingDiff -= weightIncrease * returnGap;
            }
          }
          
          // Renormalize
          sum = weights.reduce((s, w) => s + w, 0);
          if (sum > 0) {
            weights = weights.map(w => w / sum);
          }
        } else if (returnDiff < 0 && currentReturn > minReturn) {
          // Need lower return: decrease weights of high-return assets, increase low-return
          const sortedByReturn = meanReturns
            .map((ret, idx) => ({ ret, idx }))
            .sort((a, b) => a.ret - b.ret);
          
          let remainingDiff = -returnDiff;
          for (const { idx } of sortedByReturn) {
            if (remainingDiff <= 0) break;
            const assetReturn = meanReturns[idx];
            const returnGap = currentReturn - assetReturn;
            if (returnGap > 0) {
              const weightIncrease = Math.min(
                maxWeight - weights[idx],
                (remainingDiff / returnGap) * 0.1
              );
              weights[idx] += weightIncrease;
              remainingDiff -= weightIncrease * returnGap;
            }
          }
          
          // Renormalize
          sum = weights.reduce((s, w) => s + w, 0);
          if (sum > 0) {
            weights = weights.map(w => w / sum);
          }
        }
      }
    }
    
    // Final HARD CONSTRAINT ENFORCEMENT: For custom-balanced, actively enforce constraints
    if (objective === "custom-balanced" && constraints) {
      // Try to satisfy constraints by adjusting weights
      let attempts = 0;
      const maxConstraintAttempts = 50;
      
      while (attempts < maxConstraintAttempts) {
        const weightsMap = new Map<string, number>();
        symbols.forEach((sym, idx) => weightsMap.set(sym, weights[idx]));
        
        // Check Target Return
        const currentReturn = weights.reduce((sum, w, i) => sum + w * meanReturns[i], 0);
        const returnViolated = constraints.targetReturn !== undefined && currentReturn < constraints.targetReturn;
        
        // Check Max Drawdown
        let drawdownViolated = false;
        let currentMDD = 0;
        if (constraints.maxDrawdown !== undefined && constraints.maxDrawdown < 0) {
          currentMDD = calculateOptimizedPortfolioMaxDrawdown(weightsMap, assetsData, symbols);
          // mdd < maxDrawdown means mdd is worse (more negative)
          drawdownViolated = currentMDD < constraints.maxDrawdown;
        }
        
        // If both constraints satisfied, break
        if (!returnViolated && !drawdownViolated) {
          break;
        }
        
        // Actively adjust weights to satisfy constraints
        if (returnViolated) {
          // Need higher return: shift weights toward high-return assets
          const returnDiff = constraints.targetReturn! - currentReturn;
          const sortedByReturn = meanReturns
            .map((ret, idx) => ({ ret, idx, weight: weights[idx] }))
            .sort((a, b) => b.ret - a.ret);
          
          // Increase weights of highest return assets
          let remainingToAllocate = returnDiff;
          for (const { idx, ret } of sortedByReturn) {
            if (remainingToAllocate <= 0) break;
            if (ret > currentReturn && weights[idx] < maxWeight) {
              const returnGap = ret - currentReturn;
              const weightIncrease = Math.min(
                maxWeight - weights[idx],
                (remainingToAllocate / returnGap) * 0.2,
                0.05 // Limit per iteration
              );
              weights[idx] += weightIncrease;
              remainingToAllocate -= weightIncrease * returnGap;
            }
          }
          
          // Renormalize
          sum = weights.reduce((s, w) => s + w, 0);
          if (sum > 0) {
            weights = weights.map(w => w / sum);
          }
        }
        
        if (drawdownViolated) {
          // Need lower drawdown: shift weights toward low-volatility assets
          // Calculate asset volatilities
          const assetVols = symbols.map((_, idx) => Math.sqrt(covarianceMatrix[idx][idx]));
          const sortedByVol = assetVols
            .map((vol, idx) => ({ vol, idx, weight: weights[idx] }))
            .sort((a, b) => a.vol - b.vol);
          
          // Increase weights of lowest volatility assets
          const drawdownExcess = Math.abs(currentMDD - constraints.maxDrawdown!);
          let reductionNeeded = drawdownExcess * 0.1; // Reduce drawdown by 10% of excess
          
          for (const { idx } of sortedByVol) {
            if (reductionNeeded <= 0) break;
            if (weights[idx] < maxWeight) {
              const weightIncrease = Math.min(
                maxWeight - weights[idx],
                0.05, // Limit per iteration
                reductionNeeded
              );
              weights[idx] += weightIncrease;
              reductionNeeded -= weightIncrease;
            }
          }
          
          // Reduce weights of highest volatility assets
          const sortedByVolDesc = assetVols
            .map((vol, idx) => ({ vol, idx, weight: weights[idx] }))
            .sort((a, b) => b.vol - a.vol);
          
          for (const { idx } of sortedByVolDesc) {
            if (reductionNeeded <= 0) break;
            if (weights[idx] > MIN_WEIGHT_CONSTRAINT) {
              const weightDecrease = Math.min(
                weights[idx] - MIN_WEIGHT_CONSTRAINT,
                0.05, // Limit per iteration
                reductionNeeded
              );
              weights[idx] -= weightDecrease;
              reductionNeeded -= weightDecrease;
            }
          }
          
          // Renormalize
          sum = weights.reduce((s, w) => s + w, 0);
          if (sum > 0) {
            weights = weights.map(w => w / sum);
          }
        }
        
        attempts++;
      }
    }
  }

  return weights;
}

/**
 * Optimize portfolio for a given objective
 */
export function optimizePortfolioForObjective(
  positions: CombinedPosition[],
  assetsData: Map<string, AssetPriceData[]>,
  assetStats: Map<string, AssetStatistics>,
  objective: OptimizationObjective,
  constraints?: OptimizationConstraints
): OptimizationResult | null {
  
  if (positions.length === 0 || assetsData.size === 0) {
    return null;
  }

  // Filter to assets with data
  const symbolsWithData: string[] = [];
  const filteredPositions: CombinedPosition[] = [];

  for (const position of positions) {
    if (position.isCash) continue;
    if (assetsData.has(position.symbol) && assetStats.has(position.symbol)) {
      symbolsWithData.push(position.symbol);
      filteredPositions.push(position);
    }
  }

  if (symbolsWithData.length === 0) {
    return null;
  }

  // Calculate covariance matrix
  const covResult = calculateCovarianceMatrix(assetsData);
  if (!covResult) return null;

  // Filter covariance matrix to symbols with data
  const symbolIndices = new Map<string, number>();
  symbolsWithData.forEach((sym, idx) => symbolIndices.set(sym, idx));

  const filteredCovMatrix: number[][] = [];
  const filteredMeanReturns: number[] = [];

  for (let i = 0; i < symbolsWithData.length; i++) {
    const symbolI = symbolsWithData[i];
    const origIdxI = covResult.symbols.indexOf(symbolI);
    filteredMeanReturns.push(assetStats.get(symbolI)!.annualizedReturn);

    filteredCovMatrix[i] = [];
    for (let j = 0; j < symbolsWithData.length; j++) {
      const symbolJ = symbolsWithData[j];
      const origIdxJ = covResult.symbols.indexOf(symbolJ);
      filteredCovMatrix[i][j] = covResult.matrix[origIdxI][origIdxJ];
    }
  }

  // FEASIBILITY CHECK: For custom-balanced, check if constraints are achievable
  let feasibilityWarning: string | undefined = undefined;
  let constraintsSatisfied = true;
  
  if (objective === "custom-balanced" && constraints) {
    // Check if target return is achievable
    const maxPossibleReturn = Math.max(...filteredMeanReturns);
    const minPossibleReturn = Math.min(...filteredMeanReturns);
    
    if (constraints.targetReturn !== undefined) {
      if (constraints.targetReturn > maxPossibleReturn) {
        feasibilityWarning = `Target Return (${(constraints.targetReturn * 100).toFixed(1)}%) is not achievable. Maximum possible return with current assets is ${(maxPossibleReturn * 100).toFixed(1)}%.`;
        constraintsSatisfied = false;
      } else if (constraints.targetReturn < minPossibleReturn) {
        // Target is below minimum, which is achievable but might not be optimal
        feasibilityWarning = `Target Return (${(constraints.targetReturn * 100).toFixed(1)}%) is below the minimum asset return (${(minPossibleReturn * 100).toFixed(1)}%). Consider increasing target.`;
      }
    }
    
    // Check if max drawdown constraint is achievable
    // Calculate minimum possible drawdown (best case: all assets in lowest drawdown asset)
    if (constraints.maxDrawdown !== undefined && constraints.maxDrawdown < 0) {
      // Find minimum drawdown by checking individual assets
      let minPossibleDrawdown = 0;
      for (const symbol of symbolsWithData) {
        if (assetsData.has(symbol)) {
          const singleAssetWeights = new Map<string, number>();
          singleAssetWeights.set(symbol, 1.0);
          const singleAssetMDD = calculateOptimizedPortfolioMaxDrawdown(singleAssetWeights, assetsData, [symbol]);
          if (singleAssetMDD < minPossibleDrawdown) {
            minPossibleDrawdown = singleAssetMDD;
          }
        }
      }
      
      // Also check equal-weight portfolio as a baseline
      const equalWeights = new Map<string, number>();
      symbolsWithData.forEach(sym => equalWeights.set(sym, 1.0 / symbolsWithData.length));
      const equalWeightMDD = calculateOptimizedPortfolioMaxDrawdown(equalWeights, assetsData, symbolsWithData);
      if (equalWeightMDD < minPossibleDrawdown) {
        minPossibleDrawdown = equalWeightMDD;
      }
      
      // maxDrawdown is negative, so minPossibleDrawdown < maxDrawdown means constraint is too strict
      if (minPossibleDrawdown < constraints.maxDrawdown) {
        feasibilityWarning = feasibilityWarning 
          ? `${feasibilityWarning} Additionally, Max Drawdown constraint (${(constraints.maxDrawdown * 100).toFixed(1)}%) is not achievable. Lowest possible drawdown with current assets is ${(minPossibleDrawdown * 100).toFixed(1)}%.`
          : `Max Drawdown constraint (${(constraints.maxDrawdown * 100).toFixed(1)}%) is not achievable. Lowest possible drawdown with current assets is ${(minPossibleDrawdown * 100).toFixed(1)}%.`;
        constraintsSatisfied = false;
      }
    }
  }

  // Optimize
  const optimalWeights = optimizePortfolio(
    filteredMeanReturns,
    filteredCovMatrix,
    assetsData,
    symbolsWithData,
    objective,
    constraints
  );

  // Final verification: ensure weights sum to exactly 1.0
  let finalSum = optimalWeights.reduce((s, w) => s + w, 0);
  let normalizedWeights = finalSum > 0 
    ? optimalWeights.map(w => w / finalSum)
    : optimalWeights;

  // Calculate metrics using normalized weights
  let metrics = calculatePortfolioMetrics(
    normalizedWeights,
    filteredMeanReturns,
    filteredCovMatrix,
    assetsData,
    symbolsWithData
  );

  // Convert weights to Map
  let weightsMap = new Map<string, number>();
  symbolsWithData.forEach((symbol, idx) => {
    weightsMap.set(symbol, normalizedWeights[idx]);
  });
  
  // Calculate Max Drawdown for optimized portfolio
  let maxDrawdown = calculateOptimizedPortfolioMaxDrawdown(
    weightsMap,
    assetsData,
    symbolsWithData
  );

  // Final verification: ensure weights sum to exactly 1.0
  const finalCheckSum = Array.from(weightsMap.values()).reduce((s, w) => s + w, 0);
  if (Math.abs(finalCheckSum - 1.0) > 0.0001) {
    console.warn(`[Optimizer] Weights sum to ${finalCheckSum.toFixed(6)}, expected 1.0. Re-normalizing...`);
    // Final safety normalization
    symbolsWithData.forEach((symbol, idx) => {
      weightsMap.set(symbol, normalizedWeights[idx] / finalCheckSum);
    });
  }

  // Final constraint verification and ACTIVE ENFORCEMENT for custom-balanced
  if (objective === "custom-balanced" && constraints) {
    console.log(`[Optimizer] Starting constraint enforcement for Custom Balanced:`);
    console.log(`  Target Return: ${constraints.targetReturn ? (constraints.targetReturn * 100).toFixed(1) + '%' : 'N/A'}`);
    console.log(`  Max Drawdown: ${constraints.maxDrawdown ? (constraints.maxDrawdown * 100).toFixed(1) + '%' : 'N/A'}`);
    console.log(`  Initial Expected Return: ${(metrics.expectedReturn * 100).toFixed(1)}%`);
    console.log(`  Initial Max Drawdown: ${(maxDrawdown * 100).toFixed(1)}%`);
    
    // Try to actively fix constraint violations by adjusting weights
    let adjustedWeights = Array.from(normalizedWeights);
    let maxWeight = MAX_WEIGHT_CONSTRAINT_DEFAULT;
    let attempts = 0;
    const maxPostOptimizationAttempts = 200; // Increased attempts
    
    while (attempts < maxPostOptimizationAttempts) {
      // Recalculate metrics with current weights
      const tempMetrics = calculatePortfolioMetrics(
        adjustedWeights,
        filteredMeanReturns,
        filteredCovMatrix,
        assetsData,
        symbolsWithData
      );
      
      const tempWeightsMap = new Map<string, number>();
      symbolsWithData.forEach((symbol, idx) => tempWeightsMap.set(symbol, adjustedWeights[idx]));
      const tempMDD = calculateOptimizedPortfolioMaxDrawdown(tempWeightsMap, assetsData, symbolsWithData);
      
      // Check constraints
      const returnViolated = constraints.targetReturn !== undefined && tempMetrics.expectedReturn < constraints.targetReturn;
      const drawdownViolated = constraints.maxDrawdown !== undefined && constraints.maxDrawdown < 0 && tempMDD < constraints.maxDrawdown;
      
      // If both satisfied, update the final weights and metrics
      if (!returnViolated && !drawdownViolated) {
        console.log(`[Optimizer] ✓ Constraints satisfied after ${attempts} attempts`);
        console.log(`  Final Expected Return: ${(tempMetrics.expectedReturn * 100).toFixed(1)}%`);
        console.log(`  Final Max Drawdown: ${(tempMDD * 100).toFixed(1)}%`);
        normalizedWeights = adjustedWeights;
        weightsMap = tempWeightsMap;
        metrics = tempMetrics;
        maxDrawdown = tempMDD;
        constraintsSatisfied = true;
        break;
      }
      
      if (attempts % 20 === 0) {
        console.log(`[Optimizer] Attempt ${attempts}: Return=${(tempMetrics.expectedReturn * 100).toFixed(1)}% (target: ${constraints.targetReturn ? (constraints.targetReturn * 100).toFixed(1) + '%' : 'N/A'}), MDD=${(tempMDD * 100).toFixed(1)}% (limit: ${constraints.maxDrawdown ? (constraints.maxDrawdown * 100).toFixed(1) + '%' : 'N/A'})`);
      }
      
      // Actively adjust to fix violations - MORE AGGRESSIVE
      if (returnViolated) {
        // Increase weights of highest return assets more aggressively
        const returnDiff = constraints.targetReturn! - tempMetrics.expectedReturn;
        const sortedByReturn = filteredMeanReturns
          .map((ret, idx) => ({ ret, idx, weight: adjustedWeights[idx] }))
          .sort((a, b) => b.ret - a.ret);
        
        // More aggressive: allocate more to top return assets
        let totalIncrease = 0;
        for (const { idx, ret } of sortedByReturn) {
          if (returnDiff <= 0) break;
          if (ret > tempMetrics.expectedReturn && adjustedWeights[idx] < maxWeight) {
            const returnGap = ret - tempMetrics.expectedReturn;
            // More aggressive adjustment: up to 0.2 per iteration
            const weightIncrease = Math.min(
              maxWeight - adjustedWeights[idx],
              (returnDiff / returnGap) * 0.5, // Increased from 0.3
              0.2 // Increased from 0.1
            );
            adjustedWeights[idx] += weightIncrease;
            totalIncrease += weightIncrease;
          }
        }
        
        // Reduce weights of lowest return assets to make room
        const sortedByReturnAsc = filteredMeanReturns
          .map((ret, idx) => ({ ret, idx, weight: adjustedWeights[idx] }))
          .sort((a, b) => a.ret - b.ret);
        
        for (const { idx } of sortedByReturnAsc) {
          if (totalIncrease <= 0) break;
          if (adjustedWeights[idx] > MIN_WEIGHT_CONSTRAINT) {
            const decrease = Math.min(adjustedWeights[idx] - MIN_WEIGHT_CONSTRAINT, totalIncrease * 0.5, 0.1);
            adjustedWeights[idx] -= decrease;
            totalIncrease -= decrease;
          }
        }
        
        // Renormalize
        let sum = adjustedWeights.reduce((s, w) => s + w, 0);
        if (sum > 0) {
          adjustedWeights = adjustedWeights.map(w => w / sum);
        }
      }
      
      if (drawdownViolated) {
        // EXTREMELY AGGRESSIVE: Drastically reduce high-volatility assets
        const assetVols = symbolsWithData.map((_, idx) => Math.sqrt(filteredCovMatrix[idx][idx]));
        const sortedByVol = assetVols
          .map((vol, idx) => ({ vol, idx, weight: adjustedWeights[idx] }))
          .sort((a, b) => a.vol - b.vol);
        const sortedByVolDesc = assetVols
          .map((vol, idx) => ({ vol, idx, weight: adjustedWeights[idx] }))
          .sort((a, b) => b.vol - a.vol);
        
        // Calculate how much we need to shift - be very aggressive
        const drawdownExcess = Math.abs(tempMDD - constraints.maxDrawdown!);
        // If drawdown is way over limit, be extremely aggressive
        const shiftAmount = drawdownExcess > 0.10 ? 0.5 : Math.min(drawdownExcess * 2.0, 0.4);
        
        // First, drastically reduce high-volatility assets (top 50% by volatility)
        const highVolCount = Math.ceil(sortedByVolDesc.length * 0.5);
        let totalDecrease = 0;
        for (let i = 0; i < highVolCount; i++) {
          const { idx } = sortedByVolDesc[i];
          if (adjustedWeights[idx] > MIN_WEIGHT_CONSTRAINT) {
            // Reduce by up to 50% of current weight or shiftAmount, whichever is larger
            const decrease = Math.min(
              adjustedWeights[idx] - MIN_WEIGHT_CONSTRAINT,
              adjustedWeights[idx] * 0.5, // Reduce by 50% of current weight
              shiftAmount / highVolCount
            );
            adjustedWeights[idx] -= decrease;
            totalDecrease += decrease;
          }
        }
        
        // Then, increase low-volatility assets (bottom 50% by volatility)
        const lowVolCount = Math.ceil(sortedByVol.length * 0.5);
        for (let i = 0; i < lowVolCount && totalDecrease > 0; i++) {
          const { idx } = sortedByVol[i];
          if (adjustedWeights[idx] < maxWeight) {
            const increase = Math.min(
              maxWeight - adjustedWeights[idx],
              totalDecrease / (lowVolCount - i), // Distribute remaining decrease
              0.2 // Cap per asset
            );
            adjustedWeights[idx] += increase;
            totalDecrease -= increase;
          }
        }
        
        // If there's still room, distribute to remaining low-vol assets
        if (totalDecrease > 0.001) {
          for (const { idx } of sortedByVol) {
            if (totalDecrease <= 0) break;
            if (adjustedWeights[idx] < maxWeight) {
              const increase = Math.min(maxWeight - adjustedWeights[idx], totalDecrease);
              adjustedWeights[idx] += increase;
              totalDecrease -= increase;
            }
          }
        }
        
        // Renormalize
        let sum = adjustedWeights.reduce((s, w) => s + w, 0);
        if (sum > 0) {
          adjustedWeights = adjustedWeights.map(w => w / sum);
        }
      }
      
      attempts++;
    }
    
    // Final check - if still violated, set error
    const finalReturn = adjustedWeights.reduce((sum, w, i) => sum + w * filteredMeanReturns[i], 0);
    const finalWeightsMap = new Map<string, number>();
    symbolsWithData.forEach((symbol, idx) => finalWeightsMap.set(symbol, adjustedWeights[idx]));
    const finalMDD = calculateOptimizedPortfolioMaxDrawdown(finalWeightsMap, assetsData, symbolsWithData);
    
    const finalReturnViolated = constraints.targetReturn !== undefined && finalReturn < constraints.targetReturn;
    const finalDrawdownViolated = constraints.maxDrawdown !== undefined && constraints.maxDrawdown < 0 && finalMDD < constraints.maxDrawdown;
    
    if (finalReturnViolated || finalDrawdownViolated) {
      constraintsSatisfied = false;
      const violations: string[] = [];
      if (finalReturnViolated) {
        violations.push(`Expected Return (${(finalReturn * 100).toFixed(1)}%) < Target Return (${(constraints.targetReturn! * 100).toFixed(1)}%)`);
      }
      if (finalDrawdownViolated) {
        violations.push(`Max Drawdown (${(finalMDD * 100).toFixed(1)}%) exceeds limit (${(constraints.maxDrawdown! * 100).toFixed(1)}%)`);
      }
      
      feasibilityWarning = `Constraints NOT satisfied after optimization: ${violations.join('; ')}. The optimizer could not find a solution that meets all constraints.`;
      
      console.warn(`[Optimizer] Custom Balanced constraints still violated after ${attempts} adjustment attempts:`, violations);
      console.warn(`[Optimizer] Final values: Return=${(finalReturn * 100).toFixed(1)}%, MDD=${(finalMDD * 100).toFixed(1)}%`);
      
      // Even if constraints are violated, use the best attempt (closest to constraints)
      // But mark as unsatisfied
      normalizedWeights = adjustedWeights;
      weightsMap = finalWeightsMap;
      const finalMetrics = calculatePortfolioMetrics(
        adjustedWeights,
        filteredMeanReturns,
        filteredCovMatrix,
        assetsData,
        symbolsWithData
      );
      metrics = finalMetrics;
      maxDrawdown = finalMDD;
    } else {
      // Update with adjusted weights if constraints are now satisfied
      console.log(`[Optimizer] ✓ Constraints satisfied! Final: Return=${(finalReturn * 100).toFixed(1)}%, MDD=${(finalMDD * 100).toFixed(1)}%`);
      normalizedWeights = adjustedWeights;
      weightsMap = finalWeightsMap;
      const finalMetrics = calculatePortfolioMetrics(
        adjustedWeights,
        filteredMeanReturns,
        filteredCovMatrix,
        assetsData,
        symbolsWithData
      );
      metrics = finalMetrics;
      maxDrawdown = finalMDD;
      constraintsSatisfied = true;
    }
  }

  return {
    weights: weightsMap,
    ...metrics,
    maxDrawdown,
    feasibilityWarning: feasibilityWarning,
    constraintsSatisfied: constraintsSatisfied,
  };
}

/**
 * Generate Efficient Frontier
 */
export function generateEfficientFrontier(
  positions: CombinedPosition[],
  assetsData: Map<string, AssetPriceData[]>,
  assetStats: Map<string, AssetStatistics>,
  numPoints: number = 50
): EfficientFrontierPoint[] {
  if (positions.length === 0 || assetsData.size === 0) {
    return [];
  }

  // Filter to assets with data
  const symbolsWithData: string[] = [];
  for (const position of positions) {
    if (position.isCash) continue;
    if (assetsData.has(position.symbol) && assetStats.has(position.symbol)) {
      symbolsWithData.push(position.symbol);
    }
  }

  if (symbolsWithData.length === 0) {
    return [];
  }

  // Calculate covariance matrix
  const covResult = calculateCovarianceMatrix(assetsData);
  if (!covResult) return [];

  // Filter to symbols with data
  const symbolIndices = new Map<string, number>();
  symbolsWithData.forEach((sym, idx) => symbolIndices.set(sym, idx));

  const filteredCovMatrix: number[][] = [];
  const filteredMeanReturns: number[] = [];

  for (let i = 0; i < symbolsWithData.length; i++) {
    const symbolI = symbolsWithData[i];
    const origIdxI = covResult.symbols.indexOf(symbolI);
    filteredMeanReturns.push(assetStats.get(symbolI)!.annualizedReturn);

    filteredCovMatrix[i] = [];
    for (let j = 0; j < symbolsWithData.length; j++) {
      const symbolJ = symbolsWithData[j];
      const origIdxJ = covResult.symbols.indexOf(symbolJ);
      filteredCovMatrix[i][j] = covResult.matrix[origIdxI][origIdxJ];
    }
  }

  // Find min and max returns
  const minReturn = Math.min(...filteredMeanReturns);
  const maxReturn = Math.max(...filteredMeanReturns);

  // Generate frontier points
  const frontier: EfficientFrontierPoint[] = [];

  for (let i = 0; i < numPoints; i++) {
    const targetReturn = minReturn + (maxReturn - minReturn) * (i / (numPoints - 1));

    // Optimize for minimum volatility at this target return
    const weights = optimizePortfolio(
      filteredMeanReturns,
      filteredCovMatrix,
      assetsData,
      symbolsWithData,
      "min-volatility",
      { targetReturn }
    );

    // Ensure weights sum to exactly 1.0
    let sum = weights.reduce((s, w) => s + w, 0);
    const normalizedWeights = sum > 0 ? weights.map(w => w / sum) : weights;

    const metrics = calculatePortfolioMetrics(
      normalizedWeights,
      filteredMeanReturns,
      filteredCovMatrix,
      assetsData,
      symbolsWithData
    );

    const weightsMap = new Map<string, number>();
    symbolsWithData.forEach((symbol, idx) => {
      weightsMap.set(symbol, normalizedWeights[idx]);
    });

    frontier.push({
      risk: metrics.volatility,
      return: metrics.expectedReturn,
      weights: weightsMap,
    });
  }

  return frontier;
}

