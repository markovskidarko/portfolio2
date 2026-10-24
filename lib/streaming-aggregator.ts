/**
 * Lightweight aggregator for streaming - only gets NAV and equity curves
 * Skips all the heavy processing (dividends, fees, income, etc.)
 */
import { getDatabase, navQueries, accountQueries } from './database';
import type { EquityCurvePoint } from './types';

/**
 * Get lightweight portfolio data for streaming.
 * Annotates each equity curve point with external cash-flow (cashFlow /
 * isInternalTransfer) so calculateYTDMetrics can use true TWR sub-period
 * chain-linking instead of simple return.
 *
 * NOTE: This function is async because it queries the database.
 * Callers must await it.
 */
export async function getLightweightPortfolioData(
  selectedAccountIds: Set<string> | null = null
): Promise<{ totalNAV: number; equityCurve: EquityCurvePoint[] }> {
  const sql = getDatabase();

  // Get accounts
  const allAccounts = await accountQueries.getAll() as Array<{ id: string; alias: string }>;
  const accounts = selectedAccountIds
    ? allAccounts.filter(acc => selectedAccountIds.has(acc.id) && acc.id !== 'HUNGARY_MIGRATION_HISTORY')
    : allAccounts.filter(acc => acc.id !== 'HUNGARY_MIGRATION_HISTORY');

  if (accounts.length === 0) {
    return { totalNAV: 0, equityCurve: [] };
  }

  const accountIds = accounts.map(a => a.id);

  // Get all NAV data for selected accounts
  const allNavData = new Map<string, Array<{ date: string; nav_value: number }>>();
  const allDates = new Set<string>();

  for (const account of accounts) {
    const navRecords = await navQueries.getByAccount(account.id) as Array<{ date: string; nav_value: number }>;
    allNavData.set(account.id, navRecords);
    navRecords.forEach(record => allDates.add(record.date));
  }

  // Build per-date external cash flow map (deposits - withdrawals) across all
  // selected accounts. Internal transfers net to zero across the aggregate scope
  // so we mark them as isInternalTransfer=true (excluded from TWR boundaries).
  const externalFlowByDate = new Map<string, number>();
  if (accountIds.length > 0) {
    const depositRows = await sql<Array<{ date: string; total: number }>>`
      SELECT date, SUM(amount * COALESCE(fx_rate_to_base, 1)) AS total
      FROM "Deposits"
      WHERE account_id = ANY(${accountIds})
      GROUP BY date`;

    const withdrawalRows = await sql<Array<{ date: string; total: number }>>`
      SELECT date, SUM(amount * COALESCE(fx_rate_to_base, 1)) AS total
      FROM "Withdrawals"
      WHERE account_id = ANY(${accountIds})
      GROUP BY date`;

    for (const r of depositRows) {
      externalFlowByDate.set(r.date, (externalFlowByDate.get(r.date) ?? 0) + Number(r.total));
    }
    for (const r of withdrawalRows) {
      externalFlowByDate.set(r.date, (externalFlowByDate.get(r.date) ?? 0) - Number(r.total));
    }
  }

  // Build aggregated equity curve
  const sortedDates = Array.from(allDates).sort();
  const equityCurve: EquityCurvePoint[] = [];

  for (const date of sortedDates) {
    let aggregatedNAV = 0;

    for (const account of accounts) {
      const navRecords = allNavData.get(account.id) || [];
      // Find NAV for this date or closest previous
      let navValue = 0;
      for (let i = navRecords.length - 1; i >= 0; i--) {
        if (navRecords[i].date <= date) {
          navValue = navRecords[i].nav_value || 0;
          break;
        }
      }
      aggregatedNAV += navValue;
    }

    const flow = externalFlowByDate.get(date) ?? 0;
    equityCurve.push({
      date: new Date(date),
      nav: aggregatedNAV,
      cumulativeReturn: 0, // Not needed for streaming
      simpleReturn: 0,
      cumulativeContributions: 0,
      cashFlow: flow,
      isInternalTransfer: false, // Only external flows are stored in Deposits/Withdrawals
    });
  }

  // Get latest NAV
  const totalNAV = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : 0;

  return { totalNAV, equityCurve };
}
