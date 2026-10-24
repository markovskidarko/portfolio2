export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { getConnectionLogger } from '@/lib/connection-logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GET /api/debug/connection-logs - Get recent connection logs for debugging
 */
export async function GET(request: NextRequest) {
  try {
    const logger = getConnectionLogger();
    const searchParams = request.nextUrl.searchParams;
    const count = parseInt(searchParams.get('count') || '100', 10);
    const includeFile = searchParams.get('file') === 'true';

    const recentLogs = logger.getRecentLogs(count);
    const logFile = logger.getLogFile();

    const response: any = {
      logFile,
      totalEntries: recentLogs.length,
      logs: recentLogs,
    };

    // Optionally include full log file content
    if (includeFile && fs.existsSync(logFile)) {
      try {
        const fileContent = fs.readFileSync(logFile, 'utf8');
        response.fileContent = fileContent;
      } catch (error) {
        response.fileError = error instanceof Error ? error.message : String(error);
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Debug] Error getting connection logs:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get connection logs', 
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}

