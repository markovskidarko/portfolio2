/**
 * Monte Carlo Simulation Library
 * Provides multivariate Monte Carlo simulation for portfolio projections
 */

import type { CorrelationMatrix } from "./marketData";

export interface PortfolioStatistics {
  weightedReturn: number;
  portfolioVolatility: number;
  assetWeights: Record<string, number>;
  assetStatistics: Record<string, { return: number; volatility: number }>;
  correlationMatrix: CorrelationMatrix;
  symbols: string[];
}

export interface ProjectionPoint {
  date: Date;
  percentile5: number;
  percentile25: number;
  percentile50: number;
  percentile75: number;
  percentile95: number;
}

export interface SimulationResult {
  projections: ProjectionPoint[];
  iterations: number;
  projectionYears: number;
  driftUsed: number;
  volatilityUsed: number;
}

/**
 * Run multivariate Monte Carlo simulation for portfolio projection
 * Uses Geometric Brownian Motion: dS = S * (mu * dt + sigma * dW)
 * where mu is drift (annualized return) and sigma is volatility
 */
export function runMultivariateMonteCarloSimulation(
  initialValue: number,
  portfolioStats: PortfolioStatistics,
  projectionYears: number,
  numIterations = 10000
): SimulationResult {
  const dt = 1 / 252; // Daily time step (trading days)
  const totalSteps = Math.round(projectionYears * 252);
  const stepsPerMonth = Math.round(252 / 12);

  const mu = portfolioStats.weightedReturn;
  const sigma = portfolioStats.portfolioVolatility;

  // Drift adjustment for GBM: mu - 0.5 * sigma^2
  const drift = (mu - 0.5 * sigma * sigma) * dt;
  const diffusion = sigma * Math.sqrt(dt);

  // Store monthly snapshots for each iteration
  const monthlySteps = Math.ceil(totalSteps / stepsPerMonth);
  const allPaths: number[][] = Array.from({ length: numIterations }, () =>
    new Array(monthlySteps).fill(0)
  );

  for (let iter = 0; iter < numIterations; iter++) {
    let value = initialValue;
    let monthIndex = 0;

    for (let step = 0; step < totalSteps; step++) {
      // Standard normal random variable (Box-Muller)
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);

      value = value * Math.exp(drift + diffusion * z);

      if ((step + 1) % stepsPerMonth === 0 || step === totalSteps - 1) {
        if (monthIndex < monthlySteps) {
          allPaths[iter][monthIndex] = value;
          monthIndex++;
        }
      }
    }
  }

  // Build projection points from percentiles at each monthly step
  const projections: ProjectionPoint[] = [];
  const startDate = new Date();

  for (let m = 0; m < monthlySteps; m++) {
    const valuesAtMonth = allPaths.map(path => path[m]).sort((a, b) => a - b);
    const n = valuesAtMonth.length;

    const date = new Date(startDate);
    date.setMonth(date.getMonth() + m + 1);

    projections.push({
      date,
      percentile5: valuesAtMonth[Math.floor(0.05 * n)],
      percentile25: valuesAtMonth[Math.floor(0.25 * n)],
      percentile50: valuesAtMonth[Math.floor(0.50 * n)],
      percentile75: valuesAtMonth[Math.floor(0.75 * n)],
      percentile95: valuesAtMonth[Math.floor(0.95 * n)],
    });
  }

  return {
    projections,
    iterations: numIterations,
    projectionYears,
    driftUsed: mu,
    volatilityUsed: sigma,
  };
}

/**
 * Simple (univariate) Monte Carlo simulation
 * Signature: (initialValue, annualizedReturn, annualizedVolatility, projectionYears)
 * Same return shape as runMultivariateMonteCarloSimulation
 */
export function runMonteCarloSimulation(
  initialValue: number,
  annualizedReturn: number,
  annualizedVolatility: number,
  projectionYears: number,
  numIterations = 10000
): SimulationResult {
  // Delegate to multivariate with a single-asset dummy portfolio stats
  return runMultivariateMonteCarloSimulation(
    initialValue,
    {
      weightedReturn: annualizedReturn,
      portfolioVolatility: annualizedVolatility,
      assetWeights: { _portfolio: 1 },
      assetStatistics: { _portfolio: { return: annualizedReturn, volatility: annualizedVolatility } },
      correlationMatrix: { symbols: ['_portfolio'], matrix: [[1]] },
      symbols: ['_portfolio'],
    },
    projectionYears,
    numIterations
  );
}
