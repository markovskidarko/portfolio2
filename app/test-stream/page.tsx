"use client";

import React, { useEffect } from "react";
import { useWebSocketMetrics } from "@/hooks/useWebSocketMetrics";
import { cn } from "@/lib/utils";
import { Activity, AlertCircle } from "lucide-react";

export default function TestStreamPage() {
  const { metrics, loading, error, connected } = useWebSocketMetrics();

  // Log when page component mounts
  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;
    
    console.log('[TestStreamPage] ===== Component mounted =====');
    console.log('[TestStreamPage] Current URL:', window.location.href);
    console.log('[TestStreamPage] Window origin:', window.location.origin);
    console.log('[TestStreamPage] Network status:', {
      onLine: navigator.onLine,
      connectionType: (navigator as any).connection ? (navigator as any).connection.effectiveType : 'unknown',
      connectionDownlink: (navigator as any).connection ? (navigator as any).connection.downlink : 'unknown',
    });
    console.log('[TestStreamPage] Initial state:', { loading, error, connected, hasMetrics: !!metrics });
    
    // Try to ping the server to test connectivity
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        console.log('[TestStreamPage] ✅ Health check successful:', data);
      })
      .catch(err => {
        console.error('[TestStreamPage] ❌ Health check failed:', err);
      });
  }, []);

  // Log when state changes
  useEffect(() => {
    console.log('[TestStreamPage] State changed:', { loading, error, connected, hasMetrics: !!metrics });
    if (error) {
      console.error('[TestStreamPage] Error state:', error);
    }
  }, [loading, error, connected, metrics]);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-1">Streaming Metrics</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Real-time portfolio values
          </p>
        </div>

        {/* Connection Status */}
        <div className="mb-4 p-3 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 sm:w-3 sm:h-3 rounded-full",
                connected ? "bg-green-500 animate-pulse" : "bg-red-500"
              )} />
              <span className="text-xs sm:text-sm font-medium">
                {connected ? "Connected" : "Disconnected"}
              </span>
              {loading && <span className="text-xs text-muted-foreground">Loading...</span>}
            </div>
            {error && (
              <div className="flex items-center gap-1 text-red-500 text-xs">
                <AlertCircle className="h-3 w-3" />
                <span>{error}</span>
              </div>
            )}
            {metrics && (
              <span className="text-xs text-muted-foreground">
                {new Date(metrics.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {loading && !metrics ? (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="h-6 w-6 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Connecting to WebSocket stream...</p>
            <p className="text-xs mt-2 text-muted-foreground">
              Make sure the server is running with: <code className="bg-muted px-1 rounded">npm run dev</code>
            </p>
          </div>
        ) : error && !metrics ? (
          <div className="text-center py-12">
            <AlertCircle className="h-6 w-6 mx-auto mb-2 text-red-500" />
            <p className="text-sm font-medium text-red-500 mb-1">Connection Error</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : metrics ? (
          <div className="space-y-4">
            {/* Total Wealth Card */}
            <div className="border-2 shadow-md bg-card rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-2">SUM Total Wealth</div>
              <div className="text-2xl font-bold text-white mb-2">
                ${metrics.totalWealth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-border/50">
                <MetricRow
                  label="YTD"
                  value={metrics.totalWealthYtd}
                  returnValue={metrics.totalWealthYtdPercent}
                />
                <MetricRow
                  label="MTD"
                  value={metrics.totalWealthMtd}
                  returnValue={metrics.totalWealthMtdPercent}
                />
                <MetricRow
                  label="Today"
                  value={metrics.totalWealthToday}
                  returnValue={metrics.totalWealthTodayPercent}
                />
              </div>
            </div>

            {/* Stock Market Card */}
            <div className="border-2 shadow-md bg-card rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-2">Stock Market</div>
              <div className="text-2xl font-bold text-white mb-2">
                ${metrics.stockMarketTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-border/50">
                <MetricRow
                  label="YTD"
                  value={metrics.stockMarketYtd}
                  returnValue={metrics.stockMarketYtdPercent}
                />
                <MetricRow
                  label="MTD"
                  value={metrics.stockMarketMtd}
                  returnValue={metrics.stockMarketMtdPercent}
                />
                <MetricRow
                  label="Today"
                  value={metrics.stockMarketToday}
                  returnValue={metrics.stockMarketTodayPercent}
                />
              </div>
            </div>

            {/* KB Funds Card */}
            <div className="border-2 shadow-md bg-card rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-2">KB Funds</div>
              <div className="text-2xl font-bold text-white mb-2">
                ${metrics.kbFundsTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-border/50">
                <MetricRow
                  label="YTD"
                  value={metrics.kbFundsYtd}
                  returnValue={metrics.kbFundsYtdPercent}
                />
                <MetricRow
                  label="MTD"
                  value={metrics.kbFundsMtd}
                  returnValue={metrics.kbFundsMtdPercent}
                />
                <MetricRow
                  label="Today"
                  value={metrics.kbFundsToday}
                  returnValue={metrics.kbFundsTodayPercent}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No data available</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface MetricRowProps {
  label: string;
  value: number | null;
  returnValue: number | null;
}

function MetricRow({ label, value, returnValue }: MetricRowProps) {
  if (value === null || returnValue === null) {
    return (
      <div className="text-sm text-muted-foreground">
        <span className="text-gray-500">{label}:</span> <span className="text-white">N/A</span>
      </div>
    );
  }

  const isPositive = value >= 0;
  const colorClass = isPositive ? "text-green-500" : "text-red-500";

  return (
    <div className="text-sm">
      <span className="text-gray-500">{label}:</span>{" "}
      <span className={cn("text-white", colorClass)}>
        {isPositive ? "+" : ""}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>{" "}
      <span className={cn(colorClass)}>
        ({isPositive ? "+" : ""}{returnValue.toFixed(2)}%)
      </span>
    </div>
  );
}
