/**
 * Startup script to run sync check on server startup
 */
import { startupSync } from './sync-service';

// Only run on server side
if (typeof window === 'undefined') {
  // Run startup sync (non-blocking)
  startupSync().catch((error) => {
    console.error('Startup sync failed:', error);
  });
}

