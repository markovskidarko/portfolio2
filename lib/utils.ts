import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  getMarketStatusColorForSession,
  getNewYorkEquitySession,
  isUsEquityTradingWindow,
  type MarketSession,
  type MarketStatusColor,
} from "./market-session";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format number as currency
 */
export function formatCurrency(
  value: number,
  currency: string = "USD",
  decimals: number = 2
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format number as percentage
 */
export function formatPercent(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "0.00%";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

/**
 * Format large numbers with K, M, B suffixes
 */
export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1e9) {
    return `${(value / 1e9).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1e3) {
    return `${(value / 1e3).toFixed(2)}K`;
  }
  return value.toFixed(2);
}

export type { MarketSession, MarketStatusColor };

/**
 * True during any US equity session on weekdays: pre (4:00–9:30), regular (9:30–16:00), post (16:00–20:00) ET.
 */
export function isNewYorkMarketHours(): boolean {
  return isUsEquityTradingWindow();
}

/** Current NY equity session (pre / regular / post / closed). */
export function getNewYorkMarketSession(): MarketSession {
  return getNewYorkEquitySession();
}

/**
 * Status dot: green = regular hours, amber = pre/post, red = closed (nights/weekends).
 */
export function getMarketStatusColor(): MarketStatusColor {
  return getMarketStatusColorForSession(getNewYorkEquitySession());
}


