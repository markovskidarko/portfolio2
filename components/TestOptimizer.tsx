"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { formatPercent, cn } from "@/lib/utils";

export type OptimizationObjective = "max-sharpe" | "max-sortino" | "min-volatility" | "max-return" | "custom-balanced";

interface TestOptimizerProps {
  isMobile?: boolean;
}

interface OptimizationData {
  objective: OptimizationObjective;
  optimal: {
    weights: Record<string, number>;
    expectedReturn: number;
    volatility: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown?: number;
    feasibilityWarning?: string;
    constraintsSatisfied?: boolean;
  };
}

const TestOptimizer: React.FC<TestOptimizerProps> = ({ isMobile = false }) => {
  const [loading, setLoading] = useState(false);
  const [allData, setAllData] = useState<Map<OptimizationObjective, OptimizationData>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [tickers, setTickers] = useState<string[]>(["AAPL", "MSFT", "GOOGL"]);
  const [newTicker, setNewTicker] = useState<string>("");
  const [targetReturn, setTargetReturn] = useState<string>("10");
  const [maxDrawdown, setMaxDrawdown] = useState<string>("-20");
  const [appliedTargetReturn, setAppliedTargetReturn] = useState<string>("10");
  const [appliedMaxDrawdown, setAppliedMaxDrawdown] = useState<string>("-20");
  const fetchingRef = useRef(false);

  // Add ticker
  const handleAddTicker = () => {
    const ticker = newTicker.trim().toUpperCase();
    if (ticker && !tickers.includes(ticker)) {
      setTickers([...tickers, ticker]);
      setNewTicker("");
      setError(null);
    }
  };

  // Remove ticker
  const handleRemoveTicker = (ticker: string) => {
    setTickers(tickers.filter(t => t !== ticker));
  };

  // Fetch optimization data for all objectives
  useEffect(() => {
    if (tickers.length === 0) {
      setAllData(new Map());
      return;
    }

    // Prevent multiple simultaneous fetches
    if (fetchingRef.current) {
      return;
    }

    const fetchAllOptimizations = async () => {
      fetchingRef.current = true;
      setLoading(true);
      setError(null);
      
      try {
        const tickersParam = tickers.join(',');
        const cacheBuster = refreshKey > 0 ? `&_t=${refreshKey}&_v=${Date.now()}` : '';
        const objectives: OptimizationObjective[] = ["max-sharpe", "max-sortino", "min-volatility", "max-return", "custom-balanced"];
        
        // Fetch all objectives in parallel
        const results = await Promise.all(
          objectives.map(async (obj) => {
            let url = `/api/optimize-test?tickers=${encodeURIComponent(tickersParam)}&objective=${obj}${cacheBuster}`;
            
            // Add constraints for custom-balanced objective
            if (obj === "custom-balanced") {
              const targetReturnValue = parseFloat(appliedTargetReturn);
              const maxDrawdownValue = parseFloat(appliedMaxDrawdown);
              if (!isNaN(targetReturnValue) && targetReturnValue > 0) {
                url += `&targetReturn=${targetReturnValue}`;
              }
              if (!isNaN(maxDrawdownValue) && maxDrawdownValue < 0) {
                url += `&maxDrawdown=${maxDrawdownValue}`;
              }
            }
            
            const response = await fetch(url, {
              cache: 'no-store',
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
              },
            });
            const result = await response.json();
            return { objective: obj, data: result };
          })
        );
        
        // Store all results in a Map
        const dataMap = new Map<OptimizationObjective, OptimizationData>();
        
        for (const { objective, data } of results) {
          if (data.success) {
            dataMap.set(objective, data);
          } else {
            console.error(`[Test Optimizer] Failed for ${objective}:`, data.error);
          }
        }
        
        if (dataMap.size === 0) {
          setError("Failed to optimize portfolio for any objective. Please check that all tickers are valid.");
          setAllData(new Map());
        } else {
          setAllData(dataMap);
        }
      } catch (err) {
        console.error('[Test Optimizer] Error:', err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setAllData(new Map());
      } finally {
        setLoading(false);
        fetchingRef.current = false;
      }
    };

    fetchAllOptimizations();
  }, [tickers.join(','), refreshKey, appliedTargetReturn, appliedMaxDrawdown]);

  // Manual refresh handler
  const handleRefresh = () => {
    if (loading) return;
    setRefreshKey(prev => prev + 1);
  };

  // Apply constraints handler
  const handleApplyConstraints = () => {
    if (loading) return;
    const targetReturnValue = parseFloat(targetReturn);
    const maxDrawdownValue = parseFloat(maxDrawdown);
    
    if (isNaN(targetReturnValue) || targetReturnValue <= 0) {
      setError("Target Return must be a positive number");
      return;
    }
    if (isNaN(maxDrawdownValue) || maxDrawdownValue >= 0) {
      setError("Max Drawdown must be a negative number (e.g., -20)");
      return;
    }
    
    setAppliedTargetReturn(targetReturn);
    setAppliedMaxDrawdown(maxDrawdown);
    setError(null);
    setRefreshKey(prev => prev + 1);
  };

  // Prepare comparison table data
  const comparisonTable = useMemo(() => {
    if (allData.size === 0) return null;

    const maxSharpe = allData.get("max-sharpe");
    const maxSortino = allData.get("max-sortino");
    const minVolatility = allData.get("min-volatility");
    const maxReturn = allData.get("max-return");
    const customBalanced = allData.get("custom-balanced");

    return {
      sharpe: {
        maxSharpe: maxSharpe?.optimal.sharpeRatio ?? 0,
        maxSortino: maxSortino?.optimal.sharpeRatio ?? 0,
        minVolatility: minVolatility?.optimal.sharpeRatio ?? 0,
        maxReturn: maxReturn?.optimal.sharpeRatio ?? 0,
        customBalanced: customBalanced?.optimal.sharpeRatio ?? 0,
      },
      sortino: {
        maxSharpe: maxSharpe?.optimal.sortinoRatio ?? 0,
        maxSortino: maxSortino?.optimal.sortinoRatio ?? 0,
        minVolatility: minVolatility?.optimal.sortinoRatio ?? 0,
        maxReturn: maxReturn?.optimal.sortinoRatio ?? 0,
        customBalanced: customBalanced?.optimal.sortinoRatio ?? 0,
      },
      volatility: {
        maxSharpe: maxSharpe?.optimal.volatility ?? 0,
        maxSortino: maxSortino?.optimal.volatility ?? 0,
        minVolatility: minVolatility?.optimal.volatility ?? 0,
        maxReturn: maxReturn?.optimal.volatility ?? 0,
        customBalanced: customBalanced?.optimal.volatility ?? 0,
      },
      return: {
        maxSharpe: maxSharpe?.optimal.expectedReturn ?? 0,
        maxSortino: maxSortino?.optimal.expectedReturn ?? 0,
        minVolatility: minVolatility?.optimal.expectedReturn ?? 0,
        maxReturn: maxReturn?.optimal.expectedReturn ?? 0,
        customBalanced: customBalanced?.optimal.expectedReturn ?? 0,
      },
      maxDrawdown: {
        maxSharpe: maxSharpe?.optimal.maxDrawdown ?? 0,
        maxSortino: maxSortino?.optimal.maxDrawdown ?? 0,
        minVolatility: minVolatility?.optimal.maxDrawdown ?? 0,
        maxReturn: maxReturn?.optimal.maxDrawdown ?? 0,
        customBalanced: customBalanced?.optimal.maxDrawdown ?? 0,
      },
    };
  }, [allData]);

  if (loading) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Optimizing portfolio... This may take a moment.
      </div>
    );
  }

  if (error && allData.size === 0) {
    return (
      <div className="text-center text-red-500 py-8">
        Error: {error}
      </div>
    );
  }

  if (!comparisonTable) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Add tickers to start optimizing. Use the input below to add stock symbols.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-xl font-semibold text-foreground">Test Optimizer</h2>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors"
          title="Force refresh optimization data"
        >
          🔄 Refresh Data
        </button>
      </div>

      {/* Ticker Management */}
      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <h3 className="text-lg font-semibold text-foreground mb-4">Portfolio Tickers</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {tickers.map(ticker => (
            <div
              key={ticker}
              className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-lg"
            >
              <span className="text-sm font-medium text-foreground">{ticker}</span>
              <button
                onClick={() => handleRemoveTicker(ticker)}
                className="text-red-500 hover:text-red-600 text-sm"
                title="Remove ticker"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newTicker}
            onChange={(e) => {
              e.preventDefault();
              setNewTicker(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTicker();
              }
            }}
            placeholder="Enter ticker symbol (e.g., AAPL)"
            className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={handleAddTicker}
            disabled={loading || !newTicker.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            + Add Ticker
          </button>
        </div>
      </div>

      {/* Constraints Input Section */}
      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <h3 className="text-lg font-semibold text-foreground mb-4">Optimization Constraints</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Target Annual Return (%)
            </label>
            <input
              type="number"
              value={targetReturn}
              onChange={(e) => {
                e.preventDefault();
                setTargetReturn(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleApplyConstraints();
                }
              }}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="10"
              min="0"
              max="100"
              step="0.1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used for "Custom Balanced" strategy. Minimum return target.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Maximum Allowable Drawdown (%)
            </label>
            <input
              type="number"
              value={maxDrawdown}
              onChange={(e) => {
                e.preventDefault();
                setMaxDrawdown(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleApplyConstraints();
                }
              }}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="-20"
              min="-100"
              max="0"
              step="0.1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used for "Custom Balanced" strategy. Maximum acceptable loss (negative value, e.g., -20 for -20%).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleApplyConstraints}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            ✓ Apply Constraints
          </button>
          <div className="text-xs text-muted-foreground">
            {appliedTargetReturn !== targetReturn || appliedMaxDrawdown !== maxDrawdown ? (
              <span className="text-amber-500">⚠️ Constraints changed - click "Apply Constraints" to update</span>
            ) : (
              <span>Current: Target Return = {appliedTargetReturn}%, Max Drawdown = {appliedMaxDrawdown}%</span>
            )}
          </div>
        </div>
      </div>

      {/* Feasibility Warning for Custom Balanced */}
      {(() => {
        const customBalancedData = allData.get("custom-balanced");
        if (customBalancedData?.optimal?.feasibilityWarning) {
          return (
            <div className={cn(
              "bg-amber-500/20 border border-amber-500/50 rounded-lg p-4",
              customBalancedData.optimal.constraintsSatisfied === false ? "bg-red-500/20 border-red-500/50" : ""
            )}>
              <div className="flex items-start gap-2">
                <span className="text-lg">{customBalancedData.optimal.constraintsSatisfied === false ? "⚠️" : "ℹ️"}</span>
                <div className="flex-1">
                  <h4 className="font-semibold text-foreground mb-1">
                    {customBalancedData.optimal.constraintsSatisfied === false ? "Constraints Not Satisfied" : "Constraint Warning"}
                  </h4>
                  <p className="text-sm text-foreground">
                    {customBalancedData.optimal.feasibilityWarning}
                  </p>
                </div>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* Comparison Table */}
      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <h3 className="text-lg font-semibold text-foreground mb-4">Portfolio Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Metric</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Max Sharpe</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Max Sortino</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Min Volatility</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Max Return</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">Custom Balanced</th>
              </tr>
            </thead>
            <tbody>
              {/* Sharpe Ratio Row */}
              <tr className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 text-sm font-medium text-foreground">Sharpe Ratio</td>
                <td className={cn(
                  "py-3 px-4 text-sm font-semibold text-right",
                  comparisonTable.sharpe.maxSharpe > Math.max(
                    comparisonTable.sharpe.maxSortino,
                    comparisonTable.sharpe.minVolatility,
                    comparisonTable.sharpe.maxReturn,
                    comparisonTable.sharpe.customBalanced
                  ) ? "text-green-500" : "text-foreground"
                )}>
                  {comparisonTable.sharpe.maxSharpe.toFixed(3)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {comparisonTable.sharpe.maxSortino.toFixed(3)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {comparisonTable.sharpe.minVolatility.toFixed(3)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {comparisonTable.sharpe.maxReturn.toFixed(3)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {comparisonTable.sharpe.customBalanced.toFixed(3)}
                </td>
              </tr>
              
              {/* Sortino Ratio Row */}
              <tr className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 text-sm font-medium text-foreground">Sortino Ratio</td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {comparisonTable.sortino.maxSharpe.toFixed(3)}
                </td>
                <td className={cn(
                  "py-3 px-4 text-sm font-semibold text-right",
                  comparisonTable.sortino.maxSortino > Math.max(
                    comparisonTable.sortino.maxSharpe,
                    comparisonTable.sortino.minVolatility,
                    comparisonTable.sortino.maxReturn,
                    comparisonTable.sortino.customBalanced
                  ) ? "text-green-500" : "text-foreground"
                )}>
                  {comparisonTable.sortino.maxSortino.toFixed(3)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {comparisonTable.sortino.minVolatility.toFixed(3)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {comparisonTable.sortino.maxReturn.toFixed(3)}
                </td>
                <td className={cn(
                  "py-3 px-4 text-sm font-semibold text-right",
                  comparisonTable.sortino.customBalanced > Math.max(
                    comparisonTable.sortino.maxSharpe,
                    comparisonTable.sortino.maxSortino,
                    comparisonTable.sortino.minVolatility,
                    comparisonTable.sortino.maxReturn
                  ) ? "text-green-500" : "text-foreground"
                )}>
                  {comparisonTable.sortino.customBalanced.toFixed(3)}
                </td>
              </tr>
              
              {/* Volatility Row */}
              <tr className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 text-sm font-medium text-foreground">Volatility</td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.volatility.maxSharpe * 100)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.volatility.maxSortino * 100)}
                </td>
                <td className={cn(
                  "py-3 px-4 text-sm font-semibold text-right",
                  comparisonTable.volatility.minVolatility < Math.min(
                    comparisonTable.volatility.maxSharpe,
                    comparisonTable.volatility.maxSortino,
                    comparisonTable.volatility.maxReturn,
                    comparisonTable.volatility.customBalanced
                  ) ? "text-green-500" : "text-foreground"
                )}>
                  {formatPercent(comparisonTable.volatility.minVolatility * 100)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.volatility.maxReturn * 100)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.volatility.customBalanced * 100)}
                </td>
              </tr>
              
              {/* Return Row */}
              <tr className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 text-sm font-medium text-foreground">Expected Return</td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.return.maxSharpe * 100)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.return.maxSortino * 100)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.return.minVolatility * 100)}
                </td>
                <td className={cn(
                  "py-3 px-4 text-sm font-semibold text-right",
                  comparisonTable.return.maxReturn > Math.max(
                    comparisonTable.return.maxSharpe,
                    comparisonTable.return.maxSortino,
                    comparisonTable.return.minVolatility,
                    comparisonTable.return.customBalanced
                  ) ? "text-green-500" : "text-foreground"
                )}>
                  {formatPercent(comparisonTable.return.maxReturn * 100)}
                </td>
                <td className={cn(
                  "py-3 px-4 text-sm text-right",
                  comparisonTable.return.customBalanced >= (parseFloat(appliedTargetReturn) / 100 || 0) ? "text-green-500" : "text-foreground"
                )}>
                  {formatPercent(comparisonTable.return.customBalanced * 100)}
                </td>
              </tr>
              
              {/* Max Drawdown Row */}
              <tr className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 text-sm font-medium text-foreground">Max Drawdown</td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.maxDrawdown.maxSharpe * 100)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.maxDrawdown.maxSortino * 100)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.maxDrawdown.minVolatility * 100)}
                </td>
                <td className="py-3 px-4 text-sm text-foreground text-right">
                  {formatPercent(comparisonTable.maxDrawdown.maxReturn * 100)}
                </td>
                <td className={cn(
                  "py-3 px-4 text-sm font-semibold text-right",
                  comparisonTable.maxDrawdown.customBalanced >= (parseFloat(appliedMaxDrawdown) / 100 || -1) ? "text-green-500" : "text-foreground"
                )}>
                  {formatPercent(comparisonTable.maxDrawdown.customBalanced * 100)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TestOptimizer;


