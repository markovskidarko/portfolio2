/**
 * KB Funds Valuation & Performance Logic
 * Handles unit quantities, valuation calculations, and TWR calculations
 */

import { kbFundPriceQueries } from './database';

// Fund unit quantities (fixed)
export const KB_FUND_UNITS = {
  'Stocks': 59827.8077,
  'Balanced': 0,
  'Gold': 42248.2878,
} as const;

export type KBFundName = keyof typeof KB_FUND_UNITS;

export interface KBFundPrice {
  date: string;
  fund_name: string;
  price_per_unit_mkd: number;
}

export interface KBFundValuation {
  date: string;
  fund_name: string;
  price_per_unit_mkd: number;
  units: number;
  value_mkd: number;
  value_usd: number;
  usd_rate: number;
}

export interface KBFundPerformance {
  date: string;
  cumulative_twr: number;
  daily_return: number;
}

/**
 * Calculate portfolio valuation for a specific date
 */
export async function calculateValuation(
  date: string,
  fund_name: string | 'All',
  usdRate: number
): Promise<KBFundValuation | KBFundValuation[]> {

  // Debug logging for calculation
  console.log(`[KB Funds] calculateValuation: date=${date}, fund=${fund_name}, usdRate=${usdRate}`);

  if (fund_name === 'All') {
    // Calculate for all funds and aggregate
    const funds: KBFundName[] = ['Stocks', 'Balanced', 'Gold'];
    const valuations: KBFundValuation[] = [];
    let totalValueMKD = 0;

    for (const fund of funds) {
      const price = await getPriceForDate(fund, date);
      if (price) {
        const units = KB_FUND_UNITS[fund];
        const valueMKD = price.price_per_unit_mkd * units;
        totalValueMKD += valueMKD;
        
        const valueUSD = valueMKD / usdRate;
        
        // Debug logging
        console.log(`[KB Funds] ${fund}: price_per_unit=${price.price_per_unit_mkd} MKD, units=${units}, valueMKD=${valueMKD.toLocaleString()}, valueUSD=${valueUSD.toLocaleString()}`);
        
        valuations.push({
          date,
          fund_name: fund,
          price_per_unit_mkd: price.price_per_unit_mkd,
          units,
          value_mkd: valueMKD,
          value_usd: valueUSD,
          usd_rate: usdRate,
        });
      }
    }
    
    // Add aggregated total
    if (valuations.length > 0) {
      const totalValueUSD = totalValueMKD / usdRate;
      
      // Debug logging for total
      console.log(`[KB Funds] Total Portfolio: totalValueMKD=${totalValueMKD.toLocaleString()}, usdRate=${usdRate}, totalValueUSD=${totalValueUSD.toLocaleString()}`);
      
      valuations.push({
        date,
        fund_name: 'Total Portfolio',
        price_per_unit_mkd: 0,
        units: 0,
        value_mkd: totalValueMKD,
        value_usd: totalValueUSD,
        usd_rate: usdRate,
      });
    }
    
    return valuations;
  } else {
    const price = await getPriceForDate(fund_name as KBFundName, date);
    if (!price) {
      throw new Error(`No price data found for ${fund_name} on ${date}`);
    }
    
    const units = KB_FUND_UNITS[fund_name as KBFundName];
    const valueMKD = price.price_per_unit_mkd * units;
    const valueUSD = valueMKD / usdRate;
    
    // Debug logging
    console.log(`[KB Funds] ${fund_name}: price_per_unit=${price.price_per_unit_mkd} MKD, units=${units}, valueMKD=${valueMKD.toLocaleString()}, valueUSD=${valueUSD.toLocaleString()}`);
    
    return {
      date,
      fund_name,
      price_per_unit_mkd: price.price_per_unit_mkd,
      units,
      value_mkd: valueMKD,
      value_usd: valueUSD,
      usd_rate: usdRate,
    };
  }
}

/**
 * Get price for a specific fund and date
 */
async function getPriceForDate(fund_name: KBFundName, date: string): Promise<KBFundPrice | null> {
  const prices = await kbFundPriceQueries.getByFund(fund_name) as Array<{ date: string; price_per_unit_mkd: number }>;
  
  // Find exact date or closest previous date
  const sortedPrices = prices.sort((a, b) => a.date.localeCompare(b.date));
  const price = sortedPrices.find(p => p.date === date) || 
                sortedPrices.filter(p => p.date <= date).pop();
  
  if (!price) return null;
  
  return {
    date: price.date,
    fund_name,
    price_per_unit_mkd: price.price_per_unit_mkd,
  };
}

/**
 * Calculate Time-Weighted Return (TWR) for a fund or aggregated portfolio
 * TWR uses geometric linking: (End Value / Start Value) - 1
 */
export async function calculateTWR(
  fund_name: string | 'All',
  startDate: string,
  endDate: string
): Promise<KBFundPerformance[]> {
  const prices = await kbFundPriceQueries.getByDateRange(startDate, endDate) as KBFundPrice[];
  
  if (prices.length === 0) return [];
  
  // Group by date
  const pricesByDate = new Map<string, KBFundPrice[]>();
  for (const price of prices) {
    if (!pricesByDate.has(price.date)) {
      pricesByDate.set(price.date, []);
    }
    pricesByDate.get(price.date)!.push(price);
  }
  
  // Calculate daily values and returns
  const sortedDates = Array.from(pricesByDate.keys()).sort();
  const performance: KBFundPerformance[] = [];
  
  let previousValue: number | null = null;
  
  for (const date of sortedDates) {
    const datePrices = pricesByDate.get(date)!;
    
    let currentValue: number;
    if (fund_name === 'All') {
      // Aggregate all funds
      currentValue = datePrices.reduce((sum, p) => {
        const units = KB_FUND_UNITS[p.fund_name as KBFundName];
        return sum + (p.price_per_unit_mkd * units);
      }, 0);
    } else {
      // Single fund
      const fundPrice = datePrices.find(p => p.fund_name === fund_name);
      if (!fundPrice) continue;
      currentValue = fundPrice.price_per_unit_mkd * KB_FUND_UNITS[fund_name as KBFundName];
    }
    
    // Calculate daily return
    let dailyReturn = 0;
    if (previousValue !== null && previousValue > 0) {
      dailyReturn = (currentValue / previousValue) - 1;
    }
    
    // Calculate cumulative TWR
    let cumulativeTWR = 0;
    if (previousValue !== null && previousValue > 0) {
      // Geometric linking: multiply daily growth factors
      const previousTWR = performance[performance.length - 1]?.cumulative_twr || 0;
      cumulativeTWR = (1 + previousTWR) * (1 + dailyReturn) - 1;
    }
    
    performance.push({
      date,
      cumulative_twr: cumulativeTWR * 100, // Convert to percentage
      daily_return: dailyReturn * 100,
    });
    
    previousValue = currentValue;
  }
  
  return performance;
}

/**
 * Get all available dates for KB Funds data
 */
export async function getAvailableDates(): Promise<string[]> {
  const prices = await kbFundPriceQueries.getAll() as KBFundPrice[];
  
  const dates = new Set<string>();
  for (const price of prices) {
    dates.add(price.date);
  }
  
  return Array.from(dates).sort();
}

/**
 * Get available funds
 */
export function getAvailableFunds(): string[] {
  return Object.keys(KB_FUND_UNITS);
}

/**
 * Verify data range for KB Funds
 * Returns the date range for each fund to verify full history is loaded
 * Expected ranges:
 * - Balanced: from 2009-06-22
 * - Stocks: from 2021-04-01
 * - Gold: from 2021-04-01
 */
export async function verifyDataRange(): Promise<{
  fund_name: string;
  earliest_date: string | null;
  latest_date: string | null;
  expected_earliest: string;
  is_complete: boolean;
  record_count: number;
}[]> {
  const prices = await kbFundPriceQueries.getAll() as KBFundPrice[];
  
  const expectedRanges: { [key: string]: string } = {
    'Balanced': '2009-06-22',
    'Stocks': '2021-04-01',
    'Gold': '2021-04-01',
  };
  
  const funds = Object.keys(KB_FUND_UNITS);
  const results = funds.map(fund => {
    const fundPrices = prices.filter(p => p.fund_name === fund);
    const dates = fundPrices.map(p => p.date).sort();
    
    const earliest_date = dates.length > 0 ? dates[0] : null;
    const latest_date = dates.length > 0 ? dates[dates.length - 1] : null;
    const expected_earliest = expectedRanges[fund] || '';
    const is_complete = earliest_date ? earliest_date <= expected_earliest : false;
    
    return {
      fund_name: fund,
      earliest_date,
      latest_date,
      expected_earliest,
      is_complete,
      record_count: fundPrices.length,
    };
  });
  
  return results;
}

/**
 * Calculate Total Value (MKD) for a fund price record
 * Total Value (MKD) = Price Per Unit (MKD) × Number of Units
 * 
 * This helper function can be used in database views or calculations
 */
export function calculateTotalValueMKD(
  fund_name: string,
  price_per_unit_mkd: number
): number {
  const units = KB_FUND_UNITS[fund_name as KBFundName] || 0;
  return price_per_unit_mkd * units;
}

/**
 * Get KB Fund prices with calculated total values (MKD)
 * Returns prices with units and total_value_mkd automatically calculated
 */
export async function getKBFundPricesWithValuation(
  fund_name?: string,
  startDate?: string,
  endDate?: string
): Promise<Array<KBFundPrice & { units: number; total_value_mkd: number }>> {

  let prices: KBFundPrice[];

  if (startDate && endDate) {
    prices = await kbFundPriceQueries.getByDateRange(startDate, endDate) as KBFundPrice[];
  } else if (fund_name && fund_name !== 'All') {
    const fundPrices = await kbFundPriceQueries.getByFund(fund_name) as Array<{ date: string; price_per_unit_mkd: number }>;
    prices = fundPrices.map(p => ({
      date: p.date,
      fund_name,
      price_per_unit_mkd: p.price_per_unit_mkd,
    }));
  } else {
    prices = await kbFundPriceQueries.getAll() as KBFundPrice[];
  }
  
  // Add units and total_value_mkd to each price
  return prices.map(price => {
    const units = KB_FUND_UNITS[price.fund_name as KBFundName] || 0;
    const total_value_mkd = calculateTotalValueMKD(price.fund_name, price.price_per_unit_mkd);
    
    return {
      ...price,
      units,
      total_value_mkd,
    };
  });
}

