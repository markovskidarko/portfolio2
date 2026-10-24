export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { getConnectionLogger } from '@/lib/connection-logger';

/**
 * GET /api/health - Simple health check endpoint
 * Useful for testing connectivity from mobile devices
 */
export async function GET(request: NextRequest) {
  const logger = getConnectionLogger();
  
  // Extract client information
  const clientIP = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   request.ip || 
                   'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  
  logger.logServer('Health check request received', {
    clientIP,
    userAgent,
    url: request.url,
    method: request.method,
  }, { ip: clientIP, userAgent });
  
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    server: 'Portfolio Tracker',
    clientIP,
  });
}

