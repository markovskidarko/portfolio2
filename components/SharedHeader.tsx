"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, BarChart3 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useStreamingMetrics } from "@/hooks/useStreamingMetrics";

export default function SharedHeader() {
  const pathname = usePathname();
  const { metrics, loading, error, connected } = useStreamingMetrics();

  const navigationCards = [
    {
      name: "Stock Market",
      path: "/",
      icon: TrendingUp,
    },
    {
      name: "KB Funds",
      path: "/kb-funds",
      icon: BarChart3,
    },
    {
      name: "Aggregate Graph",
      path: "/aggregate-graph",
      icon: BarChart3,
    },
  ];

  return (
    <>
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Portfolio Tracker</h1>
              <p className="text-muted-foreground mt-1">Multi-Account IBKR & KB Funds Analysis</p>
            </div>
            
            {/* Total Wealth Display */}
            <div className="flex-1 flex justify-center">
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : error ? (
                <div className="text-sm text-red-500">{error}</div>
              ) : metrics ? (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className="text-2xl font-bold text-foreground">
                      {formatCurrency(metrics.totalWealth)}
                    </div>
                    {connected && (
                      <div className="w-2 h-2 rounded-full bg-green-500" title="Streaming active" />
                    )}
                  </div>
                  <div className="flex gap-4 text-sm font-medium">
                    {/* YTD */}
                    {metrics.totalWealthYtd !== null && metrics.totalWealthYtdPercent !== null ? (
                      <div className={cn(
                        metrics.totalWealthYtd >= 0 ? "text-green-500" : "text-red-500"
                      )}>
                        YTD: {metrics.totalWealthYtd >= 0 ? "+" : ""}{formatCurrency(metrics.totalWealthYtd)} ({metrics.totalWealthYtdPercent >= 0 ? "+" : ""}{Math.abs(metrics.totalWealthYtdPercent).toFixed(2)}%)
                      </div>
                    ) : null}
                    
                    {/* MTD */}
                    {metrics.totalWealthMtd !== null && metrics.totalWealthMtdPercent !== null ? (
                      <div className={cn(
                        metrics.totalWealthMtd >= 0 ? "text-green-500" : "text-red-500"
                      )}>
                        MTD: {metrics.totalWealthMtd >= 0 ? "+" : ""}{formatCurrency(metrics.totalWealthMtd)} ({metrics.totalWealthMtdPercent >= 0 ? "+" : ""}{Math.abs(metrics.totalWealthMtdPercent).toFixed(2)}%)
                      </div>
                    ) : null}
                    
                    {/* Today */}
                    {metrics.totalWealthToday !== null && metrics.totalWealthTodayPercent !== null ? (
                      <div className={cn(
                        metrics.totalWealthToday >= 0 ? "text-green-500" : "text-red-500"
                      )}>
                        Today: {metrics.totalWealthToday >= 0 ? "+" : ""}{formatCurrency(metrics.totalWealthToday)} ({metrics.totalWealthTodayPercent >= 0 ? "+" : ""}{Math.abs(metrics.totalWealthTodayPercent).toFixed(2)}%)
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">—</div>
              )}
            </div>

            <nav className="flex gap-2">
              {navigationCards.map((card) => {
                const Icon = card.icon;
                const isActive = pathname === card.path;
                return (
                  <Link
                    key={card.path}
                    href={card.path}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-all text-sm",
                      "border-2 shadow-sm bg-card",
                      "hover:shadow-md hover:border-primary/30",
                      isActive && "bg-primary/10 border-primary shadow-md"
                    )}
                  >
                    <Icon className={cn(
                      "h-4 w-4 flex-shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )} />
                    <span className={cn(
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}>
                      {card.name}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
    </>
  );
}
