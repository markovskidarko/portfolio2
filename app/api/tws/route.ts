export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import '@/lib/env';
import { getTWSService } from '@/lib/tws-service';

/**
 * GET /api/tws - Get current TWS connection state and live data
 */
export async function GET() {
  try {
    const tws = getTWSService();
    const state = tws.getState();
    
    // Log connection status for debugging
    console.log('[TWS API] Connection state:', {
      connected: state.connected,
      accounts: state.accounts.length,
      error: state.error,
      lastUpdate: state.lastUpdate?.toISOString() || null,
    });
    
    const totalNAV = tws.getTotalNAV();
    const totalUnrealizedPnl = tws.getTotalUnrealizedPnl();
    const liveSimpleReturn = await tws.getLiveSimpleReturn();
    
    return NextResponse.json({
      connected: state.connected,
      accounts: state.accounts,
      totalNAV,
      totalUnrealizedPnl,
      liveSimpleReturn,
      accountSummaries: Array.from(state.accountSummaries.values()),
      positions: state.positions,
      lastUpdate: state.lastUpdate?.toISOString() || null,
      error: state.error,
      // Add diagnostic info
      diagnostics: {
        host: process.env.TWS_HOST || '127.0.0.1',
        port: process.env.TWS_PORT || '7497',
        clientId: process.env.TWS_CLIENT_ID || '1',
      },
    });
  } catch (error) {
    console.error('[TWS API] Error:', error);
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
        diagnostics: {
          host: process.env.TWS_HOST || '127.0.0.1',
          port: process.env.TWS_PORT || '7497',
          clientId: process.env.TWS_CLIENT_ID || '1',
        },
      },
      { status: 500 }
    );
  }
}


