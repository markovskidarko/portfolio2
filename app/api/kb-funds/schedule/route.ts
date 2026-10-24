export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server';
import '@/lib/env';

export const maxDuration = 120; // 2 minutes

/**
 * GET /api/kb-funds/schedule - Schedule KB Funds scraper to run every hour
 * This endpoint should be called by a cron job or scheduled task
 */
export async function GET() {
  try {
    // Call the update endpoint which triggers scraper and updates DB
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    
    const updateResponse = await fetch(`${baseUrl}/api/kb-funds/update`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'internal'}`,
      },
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Update failed: ${updateResponse.status} - ${errorText}`);
    }

    const result = await updateResponse.json();

    return NextResponse.json({
      success: true,
      message: 'KB Funds value updated successfully',
      data: result,
    });
  } catch (error) {
    console.error('[KB Funds Schedule] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
















