"use client";

import React, { useState, useEffect } from "react";
import { PieChart } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

export interface KBFundInfo {
  fundName: string;
  latestPrice: number;
  totalValueMKD: number;
  totalValueUSD: number;
  ytdMetrics: { ytdReturn: number | null; ytdValue: number | null };
  mtdMetrics: { mtdReturn: number | null; mtdValue: number | null };
  todayMetrics: { todayGainLoss: number | null; todayGainLossPercent: number | null };
}

interface KBFundsSidebarProps {
  selectedFunds: Set<string>;
  onFundsChange: (funds: Set<string>) => void;
}

export default function KBFundsSidebar({ selectedFunds, onFundsChange }: KBFundsSidebarProps) {
  const [funds, setFunds] = useState<KBFundInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFundData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/kb-funds/sidebar");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch KB Funds sidebar data");
        }
        setFunds(data.funds);
      } catch (err) {
        console.error("Error fetching KB Funds sidebar data:", err);
        setError(err instanceof Error ? err.message : "Unknown error fetching funds");
      } finally {
        setLoading(false);
      }
    };

    fetchFundData();
  }, []);

  const toggleFund = (fundName: string) => {
    const newSelected = new Set(selectedFunds);
    if (newSelected.has(fundName)) {
      newSelected.delete(fundName);
    } else {
      newSelected.add(fundName);
    }
    onFundsChange(newSelected);
  };

  return (
    <div className="w-64 bg-card border-r border-border h-screen overflow-y-auto">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-4">
          <PieChart className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Funds</h2>
        </div>
      </div>

      <div className="p-2">
        {loading ? (
          <div className="text-sm text-muted-foreground p-4 text-center">
            Loading funds...
          </div>
        ) : error ? (
          <div className="text-sm text-red-500 p-4 text-center">
            Error: {error}
          </div>
        ) : funds.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4 text-center">
            No funds found
          </div>
        ) : (
          funds.map((fund) => {
            const isSelected = selectedFunds.has(fund.fundName);

            return (
              <div key={fund.fundName} className="mb-3">
                {/* Fund Level - Fully Clickable Card in Separate Window */}
                <div
                  onClick={() => toggleFund(fund.fundName)}
                  className={cn(
                    "flex flex-col gap-2 p-4 rounded-lg cursor-pointer transition-all",
                    "border-2 shadow-md bg-card",
                    "hover:shadow-lg hover:border-primary/30",
                    isSelected && "bg-primary/10 border-primary shadow-lg"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">{fund.fundName}</div>
                    </div>
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1"></div>
                    )}
                  </div>
                  {fund.totalValueUSD > 0 && (
                    <div className="text-2xl font-bold text-white">
                      ${fund.totalValueUSD.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                  
                  {/* YTD, MTD, Today Metrics */}
                  <div className="pt-2 space-y-1.5 border-t border-border">
                    {/* YTD */}
                    {fund.ytdMetrics.ytdValue !== null && fund.ytdMetrics.ytdReturn !== null ? (
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-0.5">YTD</div>
                        <div className={cn(
                          "text-sm font-semibold",
                          fund.ytdMetrics.ytdValue >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {fund.ytdMetrics.ytdValue >= 0 ? "+" : ""}{formatCurrency(fund.ytdMetrics.ytdValue)} ({fund.ytdMetrics.ytdReturn >= 0 ? "+" : ""}{Math.abs(fund.ytdMetrics.ytdReturn).toFixed(2)}%)
                        </div>
                      </div>
                    ) : null}
                    
                    {/* MTD */}
                    {fund.mtdMetrics.mtdValue !== null && fund.mtdMetrics.mtdReturn !== null ? (
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-0.5">MTD</div>
                        <div className={cn(
                          "text-sm font-semibold",
                          fund.mtdMetrics.mtdValue >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {fund.mtdMetrics.mtdValue >= 0 ? "+" : ""}{formatCurrency(fund.mtdMetrics.mtdValue)} ({fund.mtdMetrics.mtdReturn >= 0 ? "+" : ""}{Math.abs(fund.mtdMetrics.mtdReturn).toFixed(2)}%)
                        </div>
                      </div>
                    ) : null}
                    
                    {/* Today */}
                    {fund.todayMetrics.todayGainLoss !== null && fund.todayMetrics.todayGainLossPercent !== null ? (
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-0.5">Today</div>
                        <div className={cn(
                          "text-sm font-semibold",
                          fund.todayMetrics.todayGainLoss >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {fund.todayMetrics.todayGainLoss >= 0 ? "+" : ""}{formatCurrency(fund.todayMetrics.todayGainLoss)} ({fund.todayMetrics.todayGainLossPercent >= 0 ? "+" : ""}{Math.abs(fund.todayMetrics.todayGainLossPercent).toFixed(2)}%)
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
