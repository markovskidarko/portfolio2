export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import '@/lib/env';
import { getTWSService } from '@/lib/tws-service';
import { Socket } from 'net';
import { loadEnv } from '@/lib/env';

// Force reload env on each request to ensure latest values
loadEnv();

/**
 * GET /api/tws/diagnostics - Diagnostic endpoint to check TWS connection status
 */
export async function GET() {
  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    environment: {
      TWS_HOST: process.env.TWS_HOST || '127.0.0.1',
      TWS_PORT: process.env.TWS_PORT || '7497',
      TWS_CLIENT_ID: process.env.TWS_CLIENT_ID || '1',
    },
    service: {
      initialized: false,
      connected: false,
      error: null,
    },
    connectionTest: {
      canConnect: false,
      error: null,
    },
  };

  try {
    // Check service state
    const tws = getTWSService();
    const state = tws.getState();
    
    diagnostics.service = {
      initialized: true,
      connected: state.connected,
      accounts: state.accounts,
      error: state.error,
      lastUpdate: state.lastUpdate?.toISOString() || null,
    };

    // Test socket connection
    const host = process.env.TWS_HOST || '127.0.0.1';
    const port = parseInt(process.env.TWS_PORT || '7497', 10);
    
    await new Promise<void>((resolve, reject) => {
      const testSocket = new Socket();
      const timeout = setTimeout(() => {
        testSocket.destroy();
        diagnostics.connectionTest.error = 'Connection timeout after 3 seconds - TWS may not be responding';
        resolve(); // Don't reject, just note the error
      }, 3000);

      testSocket.on('connect', () => {
        clearTimeout(timeout);
        diagnostics.connectionTest.canConnect = true;
        console.log(`[TWS Diagnostics] Successfully connected to ${host}:${port}`);
        testSocket.destroy();
        resolve();
      });

      testSocket.on('error', (error: Error) => {
        clearTimeout(timeout);
        const errorCode = (error as any).code;
        const errorMsg = `${error.message} (code: ${errorCode || 'unknown'})`;
        diagnostics.connectionTest.error = errorMsg;
        console.error(`[TWS Diagnostics] Connection failed:`, errorMsg);
        resolve(); // Don't reject, just note the error
      });

      console.log(`[TWS Diagnostics] Testing connection to ${host}:${port}...`);
      try {
        testSocket.connect(port, host);
      } catch (error) {
        clearTimeout(timeout);
        diagnostics.connectionTest.error = error instanceof Error ? error.message : String(error);
        resolve();
      }
    });

  } catch (error) {
    diagnostics.connectionTest.error = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json(diagnostics);
}


