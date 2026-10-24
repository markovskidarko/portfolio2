export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, accountQueries, navQueries, sumTodayContributionsUSD, sumContributionsUSD } from '@/lib/database';
import { calculateAccountLiveNAV } from '@/lib/live-price-service';
import { calculateYTDMetrics, calculateMTDMetrics, calculateTodayMetrics } from '@/lib/calculations';
import type { EquityCurvePoint } from '@/lib/types';

interface AccountSidebarData {
  accountId: string;
  accountAlias: string;
  nav: number;
  ytdMetrics: {
    ytdValue: number | null;
    ytdReturn: number | null;
  };
  mtdMetrics: {
    mtdValue: number | null;
    mtdReturn: number | null;
  };
  todayMetrics: {
    todayGainLoss: number | null;
    todayGainLossPercent: number | null;
  };
}

/**
 * Build equity curve for a single account, annotating each date with
 * external cash-flow (cashFlow / isInternalTransfer) so calculateYTDMetrics
 * can use true TWR sub-period chain-linking.
 */
async function buildAccountEquityCurve(accountId: string): Promise<EquityCurvePoint[]> {
  const navRecords = await navQueries.getByAccount(accountId) as Array<{ date: string; nav_value: number }>;

  if (navRecords.length === 0) {
    return [];
  }

  // Fetch external deposits for this account (positive cash flow)
  const dbClient = getDatabase();
  const depositRows = await dbClient`
    SELECT date, SUM(amount * COALESCE(fx_rate_to_base, 1)) AS total
    FROM "Deposits" WHERE account_id = ${accountId}
    GROUP BY date
  ` as unknown as Array<{ date: string; total: number }>;

  // Fetch external withdrawals for this account (negative cash flow)
  const withdrawalRows = await dbClient`
    SELECT date, SUM(amount * COALESCE(fx_rate_to_base, 1)) AS total
    FROM "Withdrawals" WHERE account_id = ${accountId}
    GROUP BY date
  ` as unknown as Array<{ date: string; total: number }>;

  // Build a map: date -> net external cash flow
  const externalFlowByDate = new Map<string, number>();
  for (const r of depositRows) {
    externalFlowByDate.set(r.date, (externalFlowByDate.get(r.date) ?? 0) + r.total);
  }
  for (const r of withdrawalRows) {
    externalFlowByDate.set(r.date, (externalFlowByDate.get(r.date) ?? 0) - r.total);
  }

  const equityCurve: EquityCurvePoint[] = navRecords.map((record) => {
    const flow = externalFlowByDate.get(record.date) ?? 0;
    return {
      date: new Date(record.date),
      nav: record.nav_value || 0,
      cumulativeReturn: 0,
      simpleReturn: 0,
      cumulativeContributions: 0,
      cashFlow: flow,
      isInternalTransfer: false, // external deposits/withdrawals are never internal transfers
    };
  });

  return equityCurve;
}

export async function GET(request: NextRequest) {
  try {

    // Get all accounts
    const accounts = await accountQueries.getAll() as Array<{ id: string; alias: string }>;

    // Filter out migration history account
    const validAccounts = accounts.filter(acc => acc.id !== 'HUNGARY_MIGRATION_HISTORY');

    const accountData: AccountSidebarData[] = [];

    for (const account of validAccounts) {
      try {
        // Calculate live NAV using Yahoo Finance prices
        const liveNAV = await calculateAccountLiveNAV(account.id);

        // Build equity curve from database (with cash flow annotations for TWR)
        let equityCurve = await buildAccountEquityCurve(account.id);

        // Get last recorded NAV from database BEFORE updating with live NAV
        let lastRecordedNav: number | null = null;
        if (equityCurve.length > 0) {
          const today = new Date();
          const todayStr = today.toISOString().split('T')[0];

          // Find the last point that is NOT today
          for (let i = equityCurve.length - 1; i >= 0; i--) {
            const point = equityCurve[i];
            const pointDate = point.date instanceof Date ? point.date : new Date(point.date);
            const pointDateStr = pointDate.toISOString().split('T')[0];

            if (pointDateStr !== todayStr && point.nav > 0) {
              lastRecordedNav = point.nav;
              break;
            }
          }

          // If no non-today point found, use the last point
          if (lastRecordedNav === null) {
            lastRecordedNav = equityCurve[equityCurve.length - 1].nav || null;
          }
        }

        // Update equity curve with live NAV for today
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        if (equityCurve.length > 0) {
          const lastPoint = equityCurve[equityCurve.length - 1];
          const lastPointDate = lastPoint.date instanceof Date
            ? lastPoint.date.toISOString().split('T')[0]
            : new Date(lastPoint.date).toISOString().split('T')[0];

          if (lastPointDate === todayStr) {
            // Update last point with live NAV (preserve cashFlow annotation)
            equityCurve[equityCurve.length - 1] = {
              ...lastPoint,
              nav: liveNAV,
            };
          } else if (lastPointDate < todayStr) {
            // Add new point for today with live NAV (no cash flow on this synthetic point)
            equityCurve.push({
              date: today,
              nav: liveNAV,
              cumulativeReturn: 0,
              simpleReturn: 0,
              cumulativeContributions: 0,
              cashFlow: 0,
              isInternalTransfer: false,
            });
          }
        } else {
          // No historical data, just add today's point
          equityCurve.push({
            date: today,
            nav: liveNAV,
            cumulativeReturn: 0,
            simpleReturn: 0,
            cumulativeContributions: 0,
            cashFlow: 0,
            isInternalTransfer: false,
          });
        }

        // MTD and Today still use the contributions approach (unchanged)
        const _now = new Date();
        const _mtdStart = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-01`;
        const mtdContrib   = await sumContributionsUSD([account.id], _mtdStart);
        const todayContrib = await sumTodayContributionsUSD([account.id]);

        // YTD uses true TWR via cashFlow-annotated equity curve (no contributions arg needed)
        const ytdMetrics = equityCurve.length > 0
          ? calculateYTDMetrics(equityCurve, liveNAV)
          : { ytdReturn: null, ytdValue: null };

        const mtdMetrics = equityCurve.length > 0
          ? calculateMTDMetrics(equityCurve, liveNAV, mtdContrib)
          : { mtdReturn: null, mtdValue: null };

        // For Today metrics, use lastRecordedNav (before live update) vs liveNAV.
        const todayMetrics = lastRecordedNav !== null && lastRecordedNav > 0
          ? calculateTodayMetrics(equityCurve, liveNAV, lastRecordedNav, todayContrib)
          : { todayGainLoss: null, todayGainLossPercent: null };

        accountData.push({
          accountId: account.id,
          accountAlias: account.alias || account.id,
          nav: liveNAV,
          ytdMetrics,
          mtdMetrics,
          todayMetrics,
        });
      } catch (error) {
        console.error(`[Sidebar API] Failed to process account ${account.id}:`, error);
        // Still add the account with fallback values
        const equityCurve = await buildAccountEquityCurve(account.id);
        const fallbackNAV = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : 0;

        accountData.push({
          accountId: account.id,
          accountAlias: account.alias || account.id,
          nav: fallbackNAV,
          ytdMetrics: { ytdReturn: null, ytdValue: null },
          mtdMetrics: { mtdReturn: null, mtdValue: null },
          todayMetrics: { todayGainLoss: null, todayGainLossPercent: null },
        });
      }
    }

    return NextResponse.json({ accounts: accountData });
  } catch (error) {
    console.error('[Sidebar API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sidebar data', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

