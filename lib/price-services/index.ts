/**
 * Unified price fetching service
 * Routes to appropriate data source based on settings
 */

import { fetchYahooPrice, fetchYahooPrices } from './yahoo-finance';
import { fetchTradingViewPrice, fetchTradingViewPrices } from './tradingview';
import { getTWSService } from '../tws-service';
import { getDatabase, settingsQueries } from '../database';

export type DataSource = 'yahoo' | 'ibkr' | 'tradingview';

export interface PriceData {
  symbol: string;
  price: number;
  previousClose?: number;
  currency: string;
  timestamp: Date;
}

/**
 * Get the current data source setting from database
 */
export async function getDataSource(): Promise<DataSource> {
  try {
    const result = await settingsQueries.get('data_source') as { value: string } | undefined;
    
    if (result && ['yahoo', 'ibkr', 'tradingview'].includes(result.value)) {
      return result.value as DataSource;
    }
  } catch (error) {
    console.error('[Price Service] Error getting data source:', error);
  }
  
  return 'yahoo'; // Default to Yahoo Finance
}

/**
 * Set the data source setting
 */
export async function setDataSource(source: DataSource): Promise<void> {
  try {
    await settingsQueries.set('data_source', source);
    console.log(`[Price Service] Data source set to: ${source}`);
  } catch (error) {
    console.error('[Price Service] Error setting data source:', error);
  }
}

/**
 * Fetch price for a single symbol using the configured data source
 */
export async function fetchPrice(symbol: string): Promise<PriceData | null> {
  const dataSource = await getDataSource();

  switch (dataSource) {
    case 'yahoo':
      return await fetchYahooPrice(symbol);
    
    case 'tradingview':
      return await fetchTradingViewPrice(symbol);
    
    case 'ibkr':
      // Use TWS service for IBKR
      // This would need to be implemented in tws-service
      console.warn('[Price Service] IBKR data source not yet implemented for individual symbols');
      return null;
    
    default:
      return await fetchYahooPrice(symbol);
  }
}

/**
 * Fetch prices for multiple symbols using the configured data source
 */
export async function fetchPrices(symbols: string[]): Promise<Map<string, PriceData>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const dataSource = await getDataSource();

  switch (dataSource) {
    case 'yahoo':
      return await fetchYahooPrices(symbols);
    
    case 'tradingview':
      return await fetchTradingViewPrices(symbols);
    
    case 'ibkr':
      // Use TWS service for IBKR (already implemented)
      const tws = getTWSService();
      const state = tws.getState();
      
      if (state.connected) {
        // TWS provides position-level data, not individual symbol prices
        // For now, return empty map and let TWS handle NAV calculation
        console.log('[Price Service] Using IBKR TWS for live data');
        return new Map();
      } else {
        console.warn('[Price Service] IBKR TWS not connected, falling back to Yahoo Finance');
        return await fetchYahooPrices(symbols);
      }
    
    default:
      return await fetchYahooPrices(symbols);
  }
}

/**
 * Calculate live NAV from positions and current prices
 */
export async function calculateLiveNAV(
  positions: Array<{ symbol: string; position: number; costBasis: number }>
): Promise<{ nav: number; unrealizedPnl: number }> {
  const symbols = positions.map(p => p.symbol).filter(s => s && s !== 'CASH');
  
  if (symbols.length === 0) {
    // Only cash positions
    const cash = positions.find(p => p.symbol === 'CASH');
    return {
      nav: cash?.costBasis || 0,
      unrealizedPnl: 0,
    };
  }

  const prices = await fetchPrices(symbols);
  
  let totalValue = 0;
  let totalCostBasis = 0;

  for (const position of positions) {
    if (position.symbol === 'CASH') {
      totalValue += position.costBasis;
      totalCostBasis += position.costBasis;
    } else {
      const priceData = prices.get(position.symbol);
      if (priceData) {
        const currentValue = position.position * priceData.price;
        totalValue += currentValue;
        totalCostBasis += position.costBasis;
      } else {
        // Use cost basis if price not available
        totalValue += position.costBasis;
        totalCostBasis += position.costBasis;
      }
    }
  }

  return {
    nav: totalValue,
    unrealizedPnl: totalValue - totalCostBasis,
  };
}






