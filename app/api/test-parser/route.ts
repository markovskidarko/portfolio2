export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server";
import { parseAllIBKRFiles } from "@/lib/parser";
import { join } from "path";
import { existsSync } from "fs";

export async function GET() {
  try {
    const dataDir = join(process.cwd(), "data", "ibkr_uploads");
    
    if (!existsSync(dataDir)) {
      return NextResponse.json(
        { error: `Data directory not found: ${dataDir}` },
        { status: 500 }
      );
    }
    
    console.log(`Testing parser with directory: ${dataDir}`);
    const accounts = parseAllIBKRFiles(dataDir);
    
    return NextResponse.json({
      success: true,
      accountCount: accounts.length,
      accounts: accounts.map(acc => ({
        accountId: acc.accountId,
        accountAlias: acc.accountAlias,
        currency: acc.currency,
        positionsCount: acc.openPositions.length,
        tradesCount: acc.trades.length,
        cashTransactionsCount: acc.cashTransactions.length,
        endingValue: acc.changeInNAV.endingValue,
      })),
    });
  } catch (error) {
    console.error("Test parser error:", error);
    return NextResponse.json(
      { 
        error: "Failed to test parser",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}



