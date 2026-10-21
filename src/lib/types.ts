/** A finalized daily observation, stamped at 00:00 UTC (ms). */
export interface DailyPoint {
  t: number;
  price: number;
  volume: number;
}

export interface Quote {
  price: number;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  /** Provider's own last-updated time (ms). */
  updatedAt: number;
}

export interface FearGreedPoint {
  value: number;
  /** ms, start of the day the value applies to */
  t: number;
}
