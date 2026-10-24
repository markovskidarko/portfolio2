export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server";
import { getDatabase, accountQueries, navQueries } from "@/lib/database";

export async function GET() {
  try {
    
    // Get all accounts from database
    const accounts = await accountQueries.getAll() as Array<{ id: string; alias: string; currency: string }>;
    
    if (accounts.length === 0) {
      return NextResponse.json([]);
    }
    
    // Get the most recent NAV for each account
    const latestNavs = await navQueries.getLatest() as Array<{ account_id: string; max_date: string }>;
    const navMap = new Map<string, string>();
    for (const nav of latestNavs) {
      navMap.set(nav.account_id, nav.max_date);
    }
    
    // Get NAV values for the latest date
    const accountList = await Promise.all(
      accounts
        .filter(account => {
          // Hide virtual CSV account from the UI - it's internal only
          // It will be auto-included when U16030763 is selected
          return account.id !== "HUNGARY_MIGRATION_HISTORY";
        })
        .map(async account => {
          const latestDate = navMap.get(account.id);
          let nav = 0;
          
          if (latestDate) {
            const navRecords = await navQueries.getByAccount(account.id) as Array<{ date: string; nav_value: number }>;
            const latestRecord = navRecords.find(r => r.date === latestDate);
            nav = latestRecord?.nav_value || 0;
          }
          
          return {
            accountId: account.id,
            accountAlias: account.alias,
            nav,
          };
        })
    );
    
    return NextResponse.json(accountList);
  } catch (error) {
    console.error("Error fetching accounts:", error);
    return NextResponse.json(
      { error: "Failed to fetch accounts", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

