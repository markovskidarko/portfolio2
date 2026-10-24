/**
 * US / exchange-aware market session helpers for Yahoo Finance chart meta.
 */

export type MarketSession = 'pre' | 'regular' | 'post' | 'closed';

export interface YahooTradingPeriod {
  start: number;
  end: number;
  timezone?: string;
}

export interface YahooChartMetaLike {
  marketState?: string;
  regularMarketPrice?: number;
  preMarketPrice?: number;
  postMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  preMarketTime?: number;
  postMarketTime?: number;
  hasPrePostMarketData?: boolean;
  exchangeTimezoneName?: string;
  currentTradingPeriod?: {
    pre?: YahooTradingPeriod;
    regular?: YahooTradingPeriod;
    post?: YahooTradingPeriod;
  };
}

export interface SelectedYahooPrice {
  price: number;
  previousClose: number;
  session: MarketSession;
  timestamp: Date;
  /**
   * True when we returned previousClose because no session-appropriate quote
   * was available (e.g. pre-market session but symbol hasn't traded pre yet).
   * Callers can use this to skip the symbol or label the row as "stale".
   */
  isStale?: boolean;
}

/**
 * Resolve session from Yahoo marketState, falling back to currentTradingPeriod windows.
 */
export function resolveMarketSession(
  meta: YahooChartMetaLike,
  nowUnixSec: number = Math.floor(Date.now() / 1000)
): MarketSession {
  const state = meta.marketState?.toUpperCase();

  if (state === 'PRE' || state === 'PREPRE') return 'pre';
  if (state === 'REGULAR') return 'regular';
  if (state === 'POST' || state === 'POSTPOST') return 'post';
  if (state === 'CLOSED') return 'closed';

  const periods = meta.currentTradingPeriod;
  if (periods?.pre && periods?.regular && periods?.post) {
    if (nowUnixSec >= periods.pre.start && nowUnixSec < periods.pre.end) return 'pre';
    if (nowUnixSec >= periods.regular.start && nowUnixSec < periods.regular.end) return 'regular';
    if (nowUnixSec >= periods.post.start && nowUnixSec < periods.post.end) return 'post';
  }

  return 'closed';
}

/**
 * Pick the price that matches the active session — strictly.
 *
 * Important: Yahoo's `regularMarketPrice` field is the LAST regular-session
 * print, so during pre-market it equals yesterday's close. We must NOT fall
 * back to `regularMarketPrice` while the session is `pre`, otherwise symbols
 * that haven't traded yet pre-market would silently report yesterday's close
 * as "live". Same logic for `post` is acceptable because `regularMarketPrice`
 * during post-market IS today's close (just minutes old) — a legitimate
 * fallback when no after-hours trade exists.
 *
 * Mapping:
 *   pre     → preMarketPrice  (stale=previousClose if no pre print yet)
 *   regular → regularMarketPrice (intraday tick)
 *   post    → postMarketPrice, fallback regularMarketPrice (today's close)
 *   closed  → postMarketPrice → regularMarketPrice → previousClose
 */
export function selectPriceFromYahooMeta(meta: YahooChartMetaLike): SelectedYahooPrice {
  const session = resolveMarketSession(meta);
  const previousClose =
    meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPrice ?? 0;

  const toDate = (unixSec?: number) =>
    new Date((unixSec ?? Math.floor(Date.now() / 1000)) * 1000);

  switch (session) {
    case 'pre': {
      // STRICT: only preMarketPrice counts as a live pre-market quote.
      // No fallback to regularMarketPrice (which would be yesterday's close).
      if (meta.preMarketPrice != null && meta.preMarketPrice > 0) {
        return {
          price: meta.preMarketPrice,
          previousClose,
          session,
          timestamp: toDate(meta.preMarketTime),
        };
      }
      // No pre-market trade yet — surface previous close but mark as stale so
      // the caller can choose to hide it or label "no pre-market activity".
      return {
        price: previousClose,
        previousClose,
        session,
        timestamp: toDate(meta.regularMarketTime),
        isStale: true,
      };
    }
    case 'regular': {
      if (meta.regularMarketPrice != null && meta.regularMarketPrice > 0) {
        return {
          price: meta.regularMarketPrice,
          previousClose,
          session,
          timestamp: toDate(meta.regularMarketTime),
        };
      }
      return {
        price: previousClose,
        previousClose,
        session,
        timestamp: toDate(meta.regularMarketTime),
        isStale: true,
      };
    }
    case 'post': {
      // STRICT: prefer postMarketPrice. Falling back to regularMarketPrice is
      // OK in post-session because that IS today's 4pm close — not stale.
      if (meta.postMarketPrice != null && meta.postMarketPrice > 0) {
        return {
          price: meta.postMarketPrice,
          previousClose,
          session,
          timestamp: toDate(meta.postMarketTime),
        };
      }
      if (meta.regularMarketPrice != null && meta.regularMarketPrice > 0) {
        return {
          price: meta.regularMarketPrice,
          previousClose,
          session,
          timestamp: toDate(meta.regularMarketTime),
        };
      }
      return {
        price: previousClose,
        previousClose,
        session,
        timestamp: toDate(meta.regularMarketTime),
        isStale: true,
      };
    }
    case 'closed':
    default: {
      // Outside any session — use most recent quote.
      const price =
        meta.postMarketPrice ??
        meta.regularMarketPrice ??
        previousClose;
      return {
        price,
        previousClose,
        session: 'closed',
        timestamp: toDate(meta.postMarketTime ?? meta.regularMarketTime),
      };
    }
  }
}

/** NY extended hours: pre 4:00–9:30, regular 9:30–16:00, post 16:00–20:00 (weekdays). */
export function getNewYorkEquitySession(now: Date = new Date()): MarketSession {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed';

  const hour = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  const minutes = hour * 60 + minute;

  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'regular';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'post';
  return 'closed';
}

/** True when US cash equities have any extended or regular session (4:00–20:00 ET, weekdays). */
export function isUsEquityTradingWindow(now: Date = new Date()): boolean {
  const session = getNewYorkEquitySession(now);
  return session !== 'closed';
}

export type MarketStatusColor = 'green' | 'amber' | 'red';

export function getMarketStatusColorForSession(session: MarketSession): MarketStatusColor {
  if (session === 'regular') return 'green';
  if (session === 'pre' || session === 'post') return 'amber';
  return 'red';
}
