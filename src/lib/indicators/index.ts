import type { DailyPoint } from "../types";

export const DAY_MS = 86_400_000;

export const startOfUtcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * Keep only finalized, well-formed daily points: stamped exactly at 00:00 UTC, not after today's
 * midnight, finite and positive. CoinGecko appends a live "now" point to daily series; that point
 * is an incomplete day and is dropped here.
 */
export function finalizedDaily(points: DailyPoint[], now: number): { candles: DailyPoint[]; issues: string[] } {
  const issues: string[] = [];
  const today = startOfUtcDay(now);
  const byDay = new Map<number, DailyPoint>();
  for (const p of points) {
    if (p.t % DAY_MS !== 0 || p.t > today) continue;
    if (!Number.isFinite(p.price) || p.price <= 0 || !Number.isFinite(p.volume) || p.volume < 0) {
      issues.push(`invalid point at ${new Date(p.t).toISOString().slice(0, 10)}`);
      continue;
    }
    byDay.set(p.t, p);
  }
  const candles = [...byDay.values()].sort((a, b) => a.t - b.t);
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) if (candles[i].t - candles[i - 1].t !== DAY_MS) gaps++;
  if (gaps) issues.push(`${gaps} gap(s) in daily history`);
  return { candles, issues };
}

/** Simple moving average of the last `n` values, or null if there are fewer than n. */
export function sma(values: number[], n: number): number | null {
  if (values.length < n || n <= 0) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

/** SMA at every index (null until enough history). */
export function smaSeries(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

/** Wilder's RSI at every index (null until `period` changes exist). */
export function rsiSeries(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const rsi = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = rsi();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = rsi();
  }
  return out;
}

/** Fractional drawdown of `price` from the highest of `history` and `price` (≤ 0). */
export function drawdown(history: number[], price: number): { drawdown: number; high: number } {
  const high = Math.max(price, ...history);
  return { drawdown: price / high - 1, high };
}

/** Fractional return from `n` points back to `price`; null if history is too short. */
export function returnOver(values: number[], n: number, price: number): number | null {
  if (values.length < n) return null;
  const base = values[values.length - n];
  return base > 0 ? price / base - 1 : null;
}

/** Mean of the last `recent` values divided by the mean of the `base` values before them. */
export function volumeRatio(volumes: number[], recent = 7, base = 30): number | null {
  if (volumes.length < recent + base) return null;
  const r = volumes.slice(-recent);
  const b = volumes.slice(-(recent + base), -recent);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const bm = mean(b);
  return bm > 0 ? mean(r) / bm : null;
}
