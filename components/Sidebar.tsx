"use client";

import React, { useState, useEffect, useRef } from "react";
import { PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebSocketMetrics, type StreamingMetrics } from "@/hooks/useWebSocketMetrics";

export interface AccountInfo {
  accountId: string;
  accountAlias: string;
  nav: number;
  ytdMetrics?: {
    ytdValue: number | null;
    ytdReturn: number | null;
  };
  mtdMetrics?: {
    mtdValue: number | null;
    mtdReturn: number | null;
  };
  todayMetrics?: {
    todayGainLoss: number | null;
    todayGainLossPercent: number | null;
  };
}

export interface PortfolioFilter {
  accountIds: Set<string>;
  assetTypes: Set<"etf" | "stock">; // For future use
}

interface SidebarProps {
  accounts: AccountInfo[];
  selectedAccounts: Set<string>;
  onAccountsChange: (accountIds: Set<string>) => void;
}

const SIDEBAR_UPDATE_INTERVAL = 5000; // refresh sidebar every 5 seconds

export default function Sidebar({ accounts: initialAccounts, selectedAccounts, onAccountsChange }: SidebarProps) {
  const { metrics: wsMetrics, connected: wsConnected } = useWebSocketMetrics();

  // Throttle sidebar to update at most every 5 seconds
  const [throttledMetrics, setThrottledMetrics] = useState<StreamingMetrics | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!wsMetrics) return;
    const now = Date.now();
    if (now - lastUpdateRef.current >= SIDEBAR_UPDATE_INTERVAL) {
      lastUpdateRef.current = now;
      setThrottledMetrics(wsMetrics);
    }
  }, [wsMetrics]);

  // Merge throttled WebSocket live data over the initial accounts prop
  const accounts: AccountInfo[] = React.useMemo(() => {
    if (wsConnected && throttledMetrics?.accounts?.length) {
      return throttledMetrics.accounts.map(a => ({
        accountId: a.accountId,
        accountAlias: a.accountAlias,
        nav: a.nav,
        ytdMetrics: { ytdValue: a.ytdValue, ytdReturn: a.ytdReturn },
        mtdMetrics: { mtdValue: a.mtdValue, mtdReturn: a.mtdReturn },
        todayMetrics: { todayGainLoss: a.todayGainLoss, todayGainLossPercent: a.todayGainLossPercent },
      }));
    }
    return initialAccounts;
  }, [wsConnected, throttledMetrics, initialAccounts]);

  const toggleAccount = (accountId: string) => {
    const newSelected = new Set(selectedAccounts);
    if (newSelected.has(accountId)) {
      newSelected.delete(accountId);
    } else {
      newSelected.add(accountId);
    }
    onAccountsChange(newSelected);
  };

  return (
    <div className="w-64 bg-card border-r border-border h-screen overflow-y-auto">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-4">
          <PieChart className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Portfolios</h2>
          {wsConnected && (
            <span className="relative flex h-2 w-2 ml-1" title="Live via WebSocket">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
          )}
        </div>
      </div>

      <div className="p-2">
        {accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4 text-center">
            No accounts found
          </div>
        ) : (
          accounts.map((account) => {
            const isSelected = selectedAccounts.has(account.accountId);

            return (
              <div key={account.accountId} className="mb-3">
                {/* Account Level - Fully Clickable Card in Separate Window */}
                <div
                  onClick={() => toggleAccount(account.accountId)}
                  className={cn(
                    "flex flex-col gap-2 p-4 rounded-lg cursor-pointer transition-all",
                    "border-2 shadow-md bg-card",
                    "hover:shadow-lg hover:border-primary/30",
                    isSelected && "bg-primary/10 border-primary shadow-lg"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">{account.accountId}</div>
                      {account.accountAlias && account.accountAlias !== account.accountId && (
                        <div className="text-xs text-muted-foreground mt-0.5">{account.accountAlias}</div>
                      )}
                    </div>
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1"></div>
                    )}
                  </div>
                  {account.nav !== undefined && (
                    <div className="text-2xl font-bold text-white">
                      ${account.nav.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                  
                  {/* YTD, MTD, and Today Metrics */}
                  {(account.ytdMetrics || account.mtdMetrics || account.todayMetrics) && (
                    <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-border/50">
                      {/* YTD */}
                      {account.ytdMetrics && account.ytdMetrics.ytdValue !== null && account.ytdMetrics.ytdReturn !== null && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">YTD:</span>
                          <div className={cn(
                            "flex items-center gap-1.5",
                            account.ytdMetrics.ytdValue >= 0 ? "text-green-500" : "text-red-500"
                          )}>
                            <span className="font-medium">
                              {account.ytdMetrics.ytdValue >= 0 ? '+' : ''}
                              ${Math.abs(account.ytdMetrics.ytdValue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-muted-foreground">
                              ({account.ytdMetrics.ytdReturn >= 0 ? '+' : ''}{account.ytdMetrics.ytdReturn.toFixed(2)}%)
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* MTD */}
                      {account.mtdMetrics && account.mtdMetrics.mtdValue !== null && account.mtdMetrics.mtdReturn !== null && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">MTD:</span>
                          <div className={cn(
                            "flex items-center gap-1.5",
                            account.mtdMetrics.mtdValue >= 0 ? "text-green-500" : "text-red-500"
                          )}>
                            <span className="font-medium">
                              {account.mtdMetrics.mtdValue >= 0 ? '+' : ''}
                              ${Math.abs(account.mtdMetrics.mtdValue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-muted-foreground">
                              ({account.mtdMetrics.mtdReturn >= 0 ? '+' : ''}{account.mtdMetrics.mtdReturn.toFixed(2)}%)
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* Today */}
                      {account.todayMetrics && account.todayMetrics.todayGainLoss !== null && account.todayMetrics.todayGainLossPercent !== null && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Today:</span>
                          <div className={cn(
                            "flex items-center gap-1.5",
                            account.todayMetrics.todayGainLoss >= 0 ? "text-green-500" : "text-red-500"
                          )}>
                            <span className="font-medium">
                              {account.todayMetrics.todayGainLoss >= 0 ? '+' : ''}
                              ${Math.abs(account.todayMetrics.todayGainLoss).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-muted-foreground">
                              ({account.todayMetrics.todayGainLossPercent >= 0 ? '+' : ''}{account.todayMetrics.todayGainLossPercent.toFixed(2)}%)
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
