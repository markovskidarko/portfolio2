export const dynamic = 'force-dynamic'
/**
 * Monte Carlo simulation endpoint for Stock Market portfolio projections
 * Supports 3, 5, and 10-year horizons with 10,000 trials
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, holdingQueries, navQueries, cashQueries } from '@/lib/database';
import { fetchYahooPrices } from '@/lib/price-services/yahoo-finance';
import { normalizeSymbol, mapSymbolForYahoo } from '@/lib/symbol-mapper';

interface MonteCarloRequest {
  portfolioType: 'LIVE' | 'CUSTOM';
  customInitialInvestment?: number;
  monthlyContribution: number;
  targetValue?: number;
  timeHorizon: 3 | 5 | 10; // years
}

interface SimulationResult {
  initialInvestment: number;
  monthlyContribution: number;
  timeHorizon: number;
  percentiles: {
    p10: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p90: number[];
  };
  finalValues: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  probabilityOfMeetingGoal?: number;
  timeline: number[]; // months array
}

interface HoldingData {
  symbol: string;
  position: number;
  currentValue: number;
  weight: number;
  historicalReturns: number[];
  mu: number; // expected monthly return
  sigma: number; // monthly volatility
}

/**
 * Calculate portfolio statistics from historical data
 */
function calculatePortfolioStats(holdings: HoldingData[]): { mu: number; sigma: number } {
  // Calculate portfolio expected return (weighted average)
  const portfolioMu = holdings.reduce((sum, holding) => sum + (holding.weight * holding.mu), 0);
  
  // For simplicity, calculate portfolio volatility as weighted average of individual volatilities
  // Note: This ignores correlations between assets. A more sophisticated approach would use covariance matrix
  const portfolioSigma = Math.sqrt(
    holdings.reduce((sum, holding) => sum + Math.pow(holding.weight * holding.sigma, 2), 0)
  );
  
  return { mu: portfolioMu, sigma: portfolioSigma };
}

/**
 * Run Monte Carlo simulation
 */
function runMonteCarloSimulation(
  initialValue: number,
  monthlyContribution: number,
  portfolioMu: number,
  portfolioSigma: number,
  timeHorizonYears: number,
  numTrials: number = 10000
): { percentiles: any; finalValues: any; timeline: number[] } {
  const months = timeHorizonYears * 12;
  const timeline = Array.from({ length: months + 1 }, (_, i) => i);
  
  // Store all trial paths
  const allPaths: number[][] = [];
  const finalValues: number[] = [];

  for (let trial = 0; trial < numTrials; trial++) {
    const path: number[] = [initialValue];
    let currentValue = initialValue;

    for (let month = 1; month <= months; month++) {
      // Add monthly contribution
      currentValue += monthlyContribution;
      
      // Generate random return using normal distribution (Box-Muller transform)
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const monthlyReturn = portfolioMu + portfolioSigma * z;
      
      // Apply return to current value
      currentValue *= (1 + monthlyReturn);
      path.push(currentValue);
    }

    allPaths.push(path);
    finalValues.push(currentValue);
  }

  // Calculate percentiles for each time point
  const percentiles = {
    p10: [] as number[],
    p25: [] as number[],
    p50: [] as number[],
    p75: [] as number[],
    p90: [] as number[]
  };

  for (let timePoint = 0; timePoint <= months; timePoint++) {
    const valuesAtTime = allPaths.map(path => path[timePoint]).sort((a, b) => a - b);
    
    percentiles.p10.push(valuesAtTime[Math.floor(0.10 * numTrials)]);
    percentiles.p25.push(valuesAtTime[Math.floor(0.25 * numTrials)]);
    percentiles.p50.push(valuesAtTime[Math.floor(0.50 * numTrials)]);
    percentiles.p75.push(valuesAtTime[Math.floor(0.75 * numTrials)]);
    percentiles.p90.push(valuesAtTime[Math.floor(0.90 * numTrials)]);
  }

  // Calculate final value percentiles
  const sortedFinalValues = finalValues.sort((a, b) => a - b);
  const finalPercentiles = {
    p10: sortedFinalValues[Math.floor(0.10 * numTrials)],
    p25: sortedFinalValues[Math.floor(0.25 * numTrials)],
    p50: sortedFinalValues[Math.floor(0.50 * numTrials)],
    p75: sortedFinalValues[Math.floor(0.75 * numTrials)],
    p90: sortedFinalValues[Math.floor(0.90 * numTrials)]
  };

  return { percentiles, finalValues: finalPercentiles, timeline };
}

/**
 * Calculate monthly returns from historical prices
 */
function calculateMonthlyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const return_rate = (prices[i] - prices[i-1]) / prices[i-1];
    returns.push(return_rate);
  }
  return returns;
}

/**
 * GET endpoint for Monte Carlo simulation
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[Monte Carlo] Starting simulation request...');
    
    const searchParams = request.nextUrl.searchParams;
    const portfolioType = searchParams.get('portfolioType') as 'LIVE' | 'CUSTOM' || 'LIVE';
    const customInitialInvestment = searchParams.get('customInitialInvestment') ? 
      parseFloat(searchParams.get('customInitialInvestment')!) : undefined;
    const monthlyContribution = parseFloat(searchParams.get('monthlyContribution') || '0');
    const targetValue = searchParams.get('targetValue') ? 
      parseFloat(searchParams.get('targetValue')!) : undefined;
    const timeHorizon = parseInt(searchParams.get('timeHorizon') || '10') as 3 | 5 | 10;
    const accountIdsParam = searchParams.get('accountIds');

    console.log('[Monte Carlo] Parameters:', { portfolioType, customInitialInvestment, monthlyContribution, targetValue, timeHorizon, accountIds: accountIdsParam });

    let initialInvestment = 0;
    let holdings: HoldingData[] = [];

    if (portfolioType === 'LIVE') {
      // Get current Stock Market NAV from database
      console.log('[Monte Carlo] Fetching live portfolio data...');
      
      // Get selected accounts or all accounts excluding Hungary Migration History
      const dbClient = getDatabase();
      let accounts: Array<{ id: string; alias: string }>;
      if (accountIdsParam) {
        const accountIds = accountIdsParam.split(',').filter(id => id.trim() !== '');
        if (accountIds.length > 0) {
          accounts = await dbClient`SELECT id, alias FROM "Accounts" WHERE id = ANY(${accountIds}) AND id != 'HUNGARY_MIGRATION_HISTORY'` as unknown as Array<{ id: string; alias: string }>;
        } else {
          accounts = [];
        }
      } else {
        // Get all accounts excluding Hungary Migration History
        accounts = await dbClient`SELECT id, alias FROM "Accounts" WHERE id != 'HUNGARY_MIGRATION_HISTORY'` as unknown as Array<{ id: string; alias: string }>;
      }

      // Collect all holdings and calculate total value
      const allHoldings = new Map<string, {
        symbol: string;
        totalPosition: number;
        totalValue: number;
        fx_rate_to_base: number;
      }>();

      let totalPortfolioValue = 0;

      for (const account of accounts) {
        // Get holdings for this account
        const accountHoldings = await holdingQueries.getLatestByAccount(account.id) as unknown as Array<{
          symbol: string;
          position: number;
          mark_price: number;
          position_value: number;
          currency: string;
          fx_rate_to_base: number;
        }>;

        // Add cash
        const cash = await cashQueries.getLatestByAccount(account.id) as { amount: number; fx_rate_to_base: number } | null;
        if (cash) {
          totalPortfolioValue += cash.amount * cash.fx_rate_to_base;
        }

        // Process holdings with deduplication
        for (const holding of accountHoldings) {
          const normalizedSymbol = normalizeSymbol(holding.symbol);
          const valueUSD = holding.position_value * holding.fx_rate_to_base;
          totalPortfolioValue += valueUSD;

          if (allHoldings.has(normalizedSymbol)) {
            const existing = allHoldings.get(normalizedSymbol)!;
            existing.totalPosition += holding.position;
            existing.totalValue += valueUSD;
          } else {
            allHoldings.set(normalizedSymbol, {
              symbol: normalizedSymbol,
              totalPosition: holding.position,
              totalValue: valueUSD,
              fx_rate_to_base: holding.fx_rate_to_base
            });
          }
        }
      }

      initialInvestment = totalPortfolioValue;
      console.log(`[Monte Carlo] Live portfolio value: $${initialInvestment.toFixed(2)}`);

      // Fetch historical data for each holding
      console.log('[Monte Carlo] Fetching historical data for holdings...');
      for (const [symbol, holdingData] of allHoldings.entries()) {
        if (holdingData.totalPosition === 0) continue; // Skip zero positions

        const yahooSymbol = mapSymbolForYahoo(symbol);
        const weight = holdingData.totalValue / totalPortfolioValue;

        try {
          // Fetch up to 10 years of historical data
          const endDate = new Date();
          const startDate = new Date();
          startDate.setFullYear(endDate.getFullYear() - 10);

          // Temporarily disabled historical data fetching
          const historicalData: any[] = []; // await fetchYahooHistoricalData(yahooSymbol, startDate, endDate);
          
          // Use market average statistics for now
          const mu = 0.007; // ~8.7% annual return (historical S&P 500 average)
          const sigma = 0.04; // ~15% annual volatility

          holdings.push({
            symbol,
            position: holdingData.totalPosition,
            currentValue: holdingData.totalValue,
            weight,
            historicalReturns: [],
            mu,
            sigma
          });

          console.log(`[Monte Carlo] ${symbol}: weight=${(weight*100).toFixed(1)}%, mu=${(mu*100).toFixed(2)}%/month, sigma=${(sigma*100).toFixed(2)}%/month`);

        } catch (error) {
          console.error(`[Monte Carlo] Failed to fetch data for ${symbol}:`, error);
        }
      }

    } else {
      // Custom portfolio mode
      initialInvestment = customInitialInvestment || 10000;
      console.log(`[Monte Carlo] Using custom initial investment: $${initialInvestment}`);
      
      // For custom mode, use market average statistics (approximation)
      holdings = [{
        symbol: 'MARKET_AVERAGE',
        position: 1,
        currentValue: initialInvestment,
        weight: 1.0,
        historicalReturns: [],
        mu: 0.007, // ~8.7% annual return (historical S&P 500 average)
        sigma: 0.04 // ~15% annual volatility
      }];
    }

    if (holdings.length === 0) {
      throw new Error('No valid holdings found for simulation');
    }

    // Calculate portfolio-level statistics
    const portfolioStats = calculatePortfolioStats(holdings);
    console.log(`[Monte Carlo] Portfolio stats: mu=${(portfolioStats.mu*100).toFixed(2)}%/month, sigma=${(portfolioStats.sigma*100).toFixed(2)}%/month`);

    // Run Monte Carlo simulation
    console.log(`[Monte Carlo] Running simulation: ${timeHorizon} years, 10,000 trials...`);
    const simulationResults = runMonteCarloSimulation(
      initialInvestment,
      monthlyContribution,
      portfolioStats.mu,
      portfolioStats.sigma,
      timeHorizon
    );

    // Calculate probability of meeting goal (if target provided)
    let probabilityOfMeetingGoal: number | undefined;
    if (targetValue) {
      // Count how many final values exceed the target
      const finalValues = Object.values(simulationResults.finalValues);
      const successfulTrials = finalValues.filter(value => (value as number) >= targetValue).length;
      probabilityOfMeetingGoal = (successfulTrials / 5) / 100; // Convert to percentage (we have 5 percentiles)
      
      // More accurate calculation would require access to all 10,000 trials
      // For now, we'll estimate based on where the target falls relative to percentiles
      const p50 = simulationResults.finalValues.p50;
      const p10 = simulationResults.finalValues.p10;
      const p25 = simulationResults.finalValues.p25;
      const p75 = simulationResults.finalValues.p75;
      const p90 = simulationResults.finalValues.p90;
      
      if (targetValue <= p10) {
        probabilityOfMeetingGoal = 90;
      } else if (targetValue <= p25) {
        probabilityOfMeetingGoal = 75;
      } else if (targetValue <= p50) {
        probabilityOfMeetingGoal = 50;
      } else if (targetValue <= p75) {
        probabilityOfMeetingGoal = 25;
      } else if (targetValue <= p90) {
        probabilityOfMeetingGoal = 10;
      } else {
        probabilityOfMeetingGoal = 5;
      }
    }

    const result: SimulationResult = {
      initialInvestment,
      monthlyContribution,
      timeHorizon,
      percentiles: simulationResults.percentiles,
      finalValues: simulationResults.finalValues,
      probabilityOfMeetingGoal,
      timeline: simulationResults.timeline
    };

    console.log(`[Monte Carlo] Simulation complete. Final median value: $${simulationResults.finalValues.p50.toFixed(2)}`);
    return NextResponse.json(result);

  } catch (error) {
    console.error('[Monte Carlo] Simulation error:', error);
    return NextResponse.json(
      { error: 'Failed to run Monte Carlo simulation', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export const maxDuration = 60; // Allow up to 60 seconds for historical data fetching

