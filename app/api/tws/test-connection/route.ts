export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import { Socket } from 'net';

/**
 * GET /api/tws/test-connection - Test connection to TWS on various ports
 */
export async function GET() {
  const ports = [7496, 7497, 4001, 4002]; // Common TWS/Gateway ports (7496 first - most common for live)
  const host = '127.0.0.1';
  const results: any[] = [];

  for (const port of ports) {
    const result: any = {
      port,
      host,
      canConnect: false,
      error: null,
      timeout: false,
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const testSocket = new Socket();
        const timeout = setTimeout(() => {
          testSocket.destroy();
          result.timeout = true;
          result.error = 'Connection timeout';
          resolve();
        }, 2000);

        testSocket.on('connect', () => {
          clearTimeout(timeout);
          result.canConnect = true;
          testSocket.destroy();
          resolve();
        });

        testSocket.on('error', (error: Error) => {
          clearTimeout(timeout);
          result.error = `${error.message} (code: ${(error as any).code || 'unknown'})`;
          resolve(); // Don't reject, just note the error
        });

        testSocket.connect(port, host);
      });
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    results.push(result);
  }

  const workingPort = results.find(r => r.canConnect);
  const summary = {
    testedPorts: ports,
    workingPort: workingPort ? workingPort.port : null,
    message: workingPort 
      ? `✅ TWS is responding on port ${workingPort.port}! Update your .env.local TWS_PORT to ${workingPort.port}`
      : `❌ No TWS connection found on any tested port. Make sure TWS/Gateway is running with API enabled.`,
    results,
  };

  return NextResponse.json(summary);
}


