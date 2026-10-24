/**
 * Load environment variables
 * Call this at the start of server-side code
 * Checks multiple possible env file locations
 */
export function loadEnv(): void {
  if (typeof window === 'undefined') {
    // Only load on server side
    const dotenv = require('dotenv');
    const path = require('path');
    const fs = require('fs');
    
    // Try .env.local first (standard Next.js location)
    const envLocalPath = path.join(process.cwd(), '.env.local');
    const lockPath = path.join(process.cwd(), 'FelxQuery.env.lock');
    const envLockPath = path.join(process.cwd(), '.env.lock'); // Alternative name
    
    let loadedFromLocal = false;
    let loadedFromLock = false;
    
    // Check if .env.local exists and load it
    if (fs.existsSync(envLocalPath)) {
      const result = dotenv.config({ path: envLocalPath });
      if (!result.error && result.parsed) {
        console.log('[ENV] Loaded environment variables from .env.local');
        // Merge into process.env explicitly
        Object.keys(result.parsed).forEach(key => {
          process.env[key] = result.parsed[key];
        });
        loadedFromLocal = true;
      }
    }
    
    // Always try to load from lock file(s) and merge
    // The lock file contains portfolio configuration (tokens, query IDs)
    // This is critical for sync functionality
    // Try FelxQuery.env.lock first (current filename)
    if (fs.existsSync(lockPath)) {
      const result = dotenv.config({ path: lockPath });
      if (!result.error && result.parsed) {
        console.log('[ENV] Loading environment variables from FelxQuery.env.lock...');
        // Explicitly set all variables from lock file to ensure they're loaded
        // This ensures portfolio config is loaded even if .env.local exists
        Object.keys(result.parsed).forEach(key => {
          process.env[key] = result.parsed[key];
        });
        loadedFromLock = true;
        console.log('[ENV] ✓ Merged variables from FelxQuery.env.lock');
      } else if (result.error) {
        console.error('[ENV] Error loading FelxQuery.env.lock:', result.error.message);
      }
    }
    
    // Also try .env.lock as alternative name
    if (!loadedFromLock && fs.existsSync(envLockPath)) {
      const result = dotenv.config({ path: envLockPath });
      if (!result.error && result.parsed) {
        console.log('[ENV] Loading environment variables from .env.lock...');
        // Explicitly set all variables from lock file
        Object.keys(result.parsed).forEach(key => {
          process.env[key] = result.parsed[key];
        });
        loadedFromLock = true;
        console.log('[ENV] ✓ Merged variables from .env.lock');
      } else if (result.error) {
        console.error('[ENV] Error loading .env.lock:', result.error.message);
      }
    }
    
    if (!loadedFromLocal && !loadedFromLock) {
      console.warn('[ENV] No environment file found (.env.local, FelxQuery.env.lock, or .env.lock)');
      console.warn('[ENV] Using default/Next.js environment variables');
    }
    
    // Debug: Show what port we're actually using
    console.log('[ENV] Current TWS_PORT:', process.env.TWS_PORT || 'NOT SET');
    
    // Debug: Show portfolio configuration
    const portfolioCount = process.env.PORTFOLIO_COUNT;
    if (portfolioCount) {
      console.log('[ENV] PORTFOLIO_COUNT:', portfolioCount);
      const count = parseInt(portfolioCount, 10);
      for (let i = 1; i <= count; i++) {
        const accountId = process.env[`P${i}_ACCOUNT_ID`];
        const token = process.env[`P${i}_TOKEN`];
        const queryId = process.env[`P${i}_QUERY_ID`];
        if (accountId && token && queryId) {
          console.log(`[ENV] P${i}: ${accountId} (token: ***, query: ${queryId})`);
        }
      }
    } else {
      console.warn('[ENV] PORTFOLIO_COUNT not set!');
    }
    
    // Debug: Show if symbol mapping is configured
    if (process.env.YAHOO_SYMBOL_MAP) {
      try {
        const symbolMap = JSON.parse(process.env.YAHOO_SYMBOL_MAP);
        console.log('[ENV] YAHOO_SYMBOL_MAP loaded:', Object.keys(symbolMap).length, 'mappings');
      } catch (e) {
        // Ignore parse errors here
      }
    }
  }
}

// Load on import
loadEnv();

