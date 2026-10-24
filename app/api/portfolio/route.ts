export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server";
import { aggregateIBKRDataFromDB, combinePositionsFromDB } from "@/lib/db-aggregator";
import { calculateAccountLiveNAV } from "@/lib/live-price-service";
import { getDatabase, livePriceQueries, sumContributionsUSD, sumTodayContributionsUSD, navQueries } from "@/lib/database";
import { mapSymbolForYahoo } from "@/lib/symbol-mapper";
import { getNewYorkEquitySession } from "@/lib/market-session";

// Increase timeout for this route (max 60 seconds in Next.js)
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    // Extract query parameters for account filtering
    const { searchParams } = new URL(request.url);
    const accountIdsParam = searchParams.get("accountIds");
    const includeDetails = searchParams.get("details") === "1";
    const selectedAccountIds = accountIdsParam
      ? new Set(accountIdsParam.split(",").filter(id => id.trim().length > 0))
      : null; // null means all accounts

    console.log(`[${new Date().toISOString()}] Starting database-based portfolio aggregation`);
    if (selectedAccountIds) {
      console.log(`Filtering by accounts: ${Array.from(selectedAccountIds).join(", ")}`);
    } else {
      console.log(`No account filter - including all accounts`);
    }

    // Aggregate from database (no XML parsing)
    const data = await Promise.resolve().then(() => {
      return aggregateIBKRDataFromDB(selectedAccountIds);
    });

    // Detect current US equity session (pre / regular / post / closed).
    // Yahoo's per-symbol marketState was already used at fetch time to pick the
    // correct price (preMarketPrice / regularMarketPrice / postMarketPrice) —
    // this is just for surfacing the session in the response so UI can label it.
    const marketSession = getNewYorkEquitySession();

    // Overlay live Yahoo prices onto every holding so per-position and
    // per-account values reflect pre/regular/post-market moves, not just the
    // grand total. Without this, openPositions[].positionValue stays at the
    // mark_price snapshot taken at last Flex sync (often the prior session's
    // close) and the UI shows "some portfolio unchanged".
    let positionsRepriced = 0;

    for (const acc of data.accounts) {
      for (const pos of acc.openPositions) {
        if (!pos.symbol || pos.symbol === "CASH") continue;
        const mappedSymbol = mapSymbolForYahoo(pos.symbol);
        const lp = await livePriceQueries.get(mappedSymbol);
        if (lp && lp.price > 0) {
          pos.markPrice = lp.price;
          pos.positionValue = pos.position * lp.price;
          positionsRepriced++;
        }
      }
    }

    // Recompute per-account ending NAV from live prices (in USD) so
    // combinePositionsFromDB and any downstream consumers see live totals.
    let liveTotalNAV = 0;
    const accountsToCalculate = selectedAccountIds || new Set(data.accounts.map(acc => acc.accountId));

    for (const acc of data.accounts) {
      if (!accountsToCalculate.has(acc.accountId)) continue;
      try {
        const accountLiveNAV = await calculateAccountLiveNAV(acc.accountId);
        if (accountLiveNAV > 0) {
          // Store live value directly in USD and normalize fx to 1 so the
          // existing `endingValue * fxRateToBase` math in db-aggregator stays
          // consistent (combinePositionsFromDB uses this for %-of-NAV).
          acc.changeInNAV.endingValue = accountLiveNAV;
          acc.changeInNAV.fxRateToBase = 1;
          liveTotalNAV += accountLiveNAV;
        }
      } catch (error) {
        console.warn(`[Portfolio API] Failed to calculate live NAV for ${acc.accountId}:`, error);
      }
    }

    if (liveTotalNAV > 0) {
      // Rebuild combined-position aggregation from the repriced holdings so
      // each symbol's totalValue and totalPercentOfNAV reflects live prices.
      data.combinedPositions = await combinePositionsFromDB(data.accounts);
      data.totalNAV = liveTotalNAV;
      console.log(
        `[Portfolio API] Live NAV applied: $${liveTotalNAV.toLocaleString()} ` +
        `(session=${marketSession}, repriced ${positionsRepriced} positions)`
      );
    } else {
      console.log(`[Portfolio API] No live prices applied (session=${marketSession})`);
    }

    // Expose current market session so the UI can label pre/regular/post/closed.
    (data as any).marketSession = marketSession;

    // Net external cash flows (deposits − withdrawals) during YTD / MTD / today
    // for the requested account scope. The client passes these to
    // calculate{YTD,MTD,Today}Metrics so same-period contributions aren't
    // reported as investment performance on the hero cards.
    const _now = new Date();
    const _ytdStart = `${_now.getFullYear()}-01-01`;
    const _mtdStart = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-01`;
    const _contribScope = selectedAccountIds ?? null;
    (data as any).ytdContributions   = await sumContributionsUSD(_contribScope, _ytdStart);
    (data as any).mtdContributions   = await sumContributionsUSD(_contribScope, _mtdStart);
    (data as any).todayContributions = await sumTodayContributionsUSD(_contribScope);

    // Per-account net external cash flows grouped by month (YYYY-MM), USD.
    // Used by the monthly performance bar chart so the per-account bars can
    // strip out deposits/withdrawals the same way the aggregate bar does.
    // Shape: { "U15352922": { "2026-06": 50000, ... }, ... }
    const _dbClient = getDatabase();
    const _scopedAccountIds = selectedAccountIds
      ? Array.from(selectedAccountIds)
      : (await _dbClient`SELECT id FROM "Accounts" WHERE id != 'HUNGARY_MIGRATION_HISTORY'` as unknown as Array<{ id: string }>).map(r => r.id);
    const monthlyContribsByAccount: Record<string, Record<string, number>> = {};
    if (_scopedAccountIds.length > 0) {
      for (const id of _scopedAccountIds) monthlyContribsByAccount[id] = {};
      const _dep = await _dbClient`
        SELECT account_id, substr(date,1,7) AS ym,
               SUM(amount * COALESCE(fx_rate_to_base, 1)) AS total
        FROM "Deposits"
        WHERE account_id = ANY(${_scopedAccountIds})
        GROUP BY account_id, ym
      ` as unknown as Array<{ account_id: string; ym: string; total: number }>;
      const _wd = await _dbClient`
        SELECT account_id, substr(date,1,7) AS ym,
               SUM(amount * COALESCE(fx_rate_to_base, 1)) AS total
        FROM "Withdrawals"
        WHERE account_id = ANY(${_scopedAccountIds})
        GROUP BY account_id, ym
      ` as unknown as Array<{ account_id: string; ym: string; total: number }>;
      for (const r of _dep) {
        monthlyContribsByAccount[r.account_id][r.ym] = (monthlyContribsByAccount[r.account_id][r.ym] ?? 0) + r.total;
      }
      for (const r of _wd) {
        monthlyContribsByAccount[r.account_id][r.ym] = (monthlyContribsByAccount[r.account_id][r.ym] ?? 0) - r.total;
      }

      // Include internal transfers too — from a per-account standpoint, money
      // moving in/out via internal transfer IS a contribution to that account's
      // NAV. (For the aggregate, internal transfers between selected accounts
      // net to zero and are handled separately via the equity curve's
      // isInternalTransfer-aware cashFlow.) Deduplicate the same way
      // db-aggregator does so we don't double-count the source-side row.
      const _xfRows = await _dbClient`
        SELECT id, account_id, date, type, direction, amount, fx_rate_to_base, transaction_id
        FROM "Transfers"
        WHERE account_id = ANY(${_scopedAccountIds})
      ` as unknown as Array<{
        id: number; account_id: string; date: string;
        type: string; direction: string; amount: number;
        fx_rate_to_base: number | null; transaction_id: string | null;
      }>;
      const _xfSeen = new Set<string>();
      for (const r of _xfRows) {
        const dedupKey = r.transaction_id
          ? `${r.account_id}|${r.transaction_id}`
          : `${r.account_id}|${r.type}|${r.direction}|${r.amount.toFixed(2)}|${r.date}`;
        if (_xfSeen.has(dedupKey)) continue;
        _xfSeen.add(dedupKey);
        const ym = r.date.substring(0, 7);
        // Transfers.amount is signed (IN positive, OUT negative), so summing works.
        const amt = r.amount * (r.fx_rate_to_base ?? 1);
        monthlyContribsByAccount[r.account_id][ym] =
          (monthlyContribsByAccount[r.account_id][ym] ?? 0) + amt;
      }
    }
    (data as any).monthlyContribsByAccount = monthlyContribsByAccount;

    // Per-account monthly returns precomputed server-side from DailyNAV — the
    // same source the per-account MTD card uses (see sidebar route's
    // buildAccountEquityCurve). Computing here ensures the current-month bar
    // for each account matches its MTD card exactly: same baseline anchor
    // (last DailyNAV row before the month), same live-NAV endpoint, same
    // contributions formula.
    const monthlyReturnsByAccount: Record<string, Array<{ monthKey: string; monthTs: number; returnPct: number }>> = {};
    const _currentYm = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
    for (const accId of _scopedAccountIds) {
      if (accId === 'HUNGARY_MIGRATION_HISTORY') { monthlyReturnsByAccount[accId] = []; continue; }
      const navRows = await navQueries.getByAccount(accId) as Array<{ date: string; nav_value: number }>;
      if (navRows.length === 0) { monthlyReturnsByAccount[accId] = []; continue; }

      // Sort defensively (queries already order by date but be explicit).
      navRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      // For each month: first non-zero NAV, last NAV, contribs from the map.
      type MBucket = { firstNav: number; lastNav: number };
      const byMonth = new Map<string, MBucket>();
      for (const r of navRows) {
        if (!r.nav_value || r.nav_value <= 0) continue;
        const ym = r.date.substring(0, 7);
        const b = byMonth.get(ym);
        if (!b) byMonth.set(ym, { firstNav: r.nav_value, lastNav: r.nav_value });
        else b.lastNav = r.nav_value;
      }

      const sortedKeys = Array.from(byMonth.keys()).sort();
      let prevLastNav: number | null = null;
      const out: Array<{ monthKey: string; monthTs: number; returnPct: number }> = [];
      for (const ym of sortedKeys) {
        const b = byMonth.get(ym)!;
        const contribs = monthlyContribsByAccount[accId]?.[ym] ?? 0;
        // Current-month endpoint uses live per-account NAV (matches MTD card).
        const isCurrent = ym === _currentYm;
        const lastNav = isCurrent
          ? (() => { try { return (calculateAccountLiveNAV as any)(accId) || b.lastNav; } catch { return b.lastNav; } })()
          : b.lastNav;
        // Baseline: end of prior month (= prevLastNav). At inception use the
        // unified formula: baseNav = max(0, firstNav − contribs) so true
        // deposit-funded accounts get baseNav=0 while snapshot-imported ones
        // get baseNav≈firstNav.
        const baseNav = prevLastNav === null
          ? Math.max(0, b.firstNav - contribs)
          : prevLastNav;
        const adjBase = baseNav + contribs;
        const gain = lastNav - baseNav - contribs;
        const returnPct = adjBase > 0 ? (gain / adjBase) * 100 : 0;
        const [yy, mm] = ym.split('-').map(Number);
        out.push({ monthKey: ym, monthTs: new Date(yy, mm - 1, 1).getTime(), returnPct });
        prevLastNav = b.lastNav; // historical last for the chain; don't propagate live-override forward
      }
      monthlyReturnsByAccount[accId] = out;
    }
    (data as any).monthlyReturnsByAccount = monthlyReturnsByAccount;

    // Default to a lightweight payload (the full per-account transaction arrays can be huge and
    // make the browser appear "hung" while parsing/rendering). Opt-in via ?details=1.
    if (!includeDetails) {
      data.accounts = data.accounts.map((acc: any) => ({
        ...acc,
        trades: [],
        cashTransactions: [],
        transfers: [],
      }));
    }
    
    console.log(`[${new Date().toISOString()}] Completed: Loaded ${data.accounts.length} accounts, ${data.equityCurve.length} equity curve points`);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error aggregating portfolio data:`, error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
      console.error("Stack:", error.stack);
    }
    return NextResponse.json(
      { 
        error: "Failed to load portfolio data",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}


