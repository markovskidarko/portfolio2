/**
 * Symbol mapping for Yahoo Finance
 * Maps IBKR symbols to Yahoo Finance symbols (especially for ETFs)
 */

import { loadEnv } from './env';

// Load environment variables
if (typeof window === 'undefined') {
  loadEnv();
}

// Default symbol mappings
const DEFAULT_SYMBOL_MAP: Record<string, string> = {
  'SMH': 'SMH.L',
  'EQQQ': 'EQQQ.SW',
  'EQQU': 'EQQQ.SW', // EQQU maps to the same as EQQQ
  'IUIT': 'IUIT.L',
  'IIUT': 'IIUT.L', // Alternative spelling
  'VUSD': 'VUSD.L',
};

/**
 * Load symbol mapping from environment variable or use defaults
 * Format: YAHOO_SYMBOL_MAP='{"SMH":"SMH.L","EQQQ":"EQQQ.SW"}'
 */
function loadSymbolMap(): Record<string, string> {
  const symbolMap = { ...DEFAULT_SYMBOL_MAP };

  // Try to load from environment variable
  if (typeof process !== 'undefined' && process.env.YAHOO_SYMBOL_MAP) {
    try {
      const envMap = JSON.parse(process.env.YAHOO_SYMBOL_MAP);
      // Merge environment map with defaults (env takes precedence)
      Object.assign(symbolMap, envMap);
      console.log('[Symbol Mapper] Loaded symbol mappings from YAHOO_SYMBOL_MAP:', Object.keys(envMap).length, 'symbols');
    } catch (error) {
      console.error('[Symbol Mapper] Error parsing YAHOO_SYMBOL_MAP:', error);
      console.log('[Symbol Mapper] Using default symbol mappings');
    }
  }

  return symbolMap;
}

// Load the symbol map once at module load
const SYMBOL_MAP = loadSymbolMap();

/**
 * Map an IBKR symbol to its Yahoo Finance equivalent
 * @param symbol - The original symbol (e.g., "SMH", "EQQQ")
 * @returns The mapped Yahoo Finance symbol (e.g., "SMH.L", "EQQQ.SW")
 */
export function mapSymbolForYahoo(symbol: string): string {
  if (!symbol) {
    return symbol;
  }

  // Check if we have a mapping for this symbol
  const mapped = SYMBOL_MAP[symbol.toUpperCase()];
  if (mapped) {
    return mapped;
  }

  // Return original symbol if no mapping exists
  return symbol;
}

/**
 * Get all current symbol mappings
 */
export function getSymbolMappings(): Record<string, string> {
  return { ...SYMBOL_MAP };
}

/**
 * Get the reverse mapping (Yahoo Finance symbol -> IBKR symbol)
 */
export function getReverseMappings(): Record<string, string> {
  const reverse: Record<string, string> = {};
  for (const [ibkrSymbol, yahooSymbol] of Object.entries(SYMBOL_MAP)) {
    reverse[yahooSymbol] = ibkrSymbol;
  }
  return reverse;
}

/**
 * Map a Yahoo Finance symbol back to its IBKR equivalent
 * @param yahooSymbol - The Yahoo Finance symbol (e.g., "SMH.L")
 * @returns The original IBKR symbol (e.g., "SMH") or the symbol itself if no reverse mapping exists
 */
export function mapYahooSymbolToIBKR(yahooSymbol: string): string {
  if (!yahooSymbol) {
    return yahooSymbol;
  }

  const reverseMap = getReverseMappings();
  const mapped = reverseMap[yahooSymbol];
  if (mapped) {
    return mapped;
  }

  return yahooSymbol;
}

/**
 * Normalize symbol - EQQU and EQQQ are the same ticker
 * @param symbol - The symbol to normalize (e.g., "EQQU", "EQQQ")
 * @returns The normalized symbol (e.g., "EQQQ" for both EQQU and EQQQ)
 */
export function normalizeSymbol(symbol: string | null | undefined): string {
  if (!symbol) return '';
  const normalized = symbol.toUpperCase().trim();
  // EQQU and EQQQ are the same ETF
  if (normalized === 'EQQU') return 'EQQQ';
  // Treat SMH and SMH.L as the same instrument (canonicalize to SMH.L)
  if (normalized === 'SMH' || normalized === 'SMH.L') return 'SMH.L';
  return normalized;
}






