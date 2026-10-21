import { score } from "./scoring";
import type { DailyPoint, FearGreedPoint } from "./types";

export interface BacktestOptions {
  threshold: number;
  /** Per side, as a fraction (0.001 = 0.1%). */
  fee: number;
  slippage: number;
  /** Fraction of eligible days used for development; the rest is held out. */
  devFraction: number;
}

export interface DayScore {
  t: number;
  price: number;
  score: number | null;
}

/**
 * Replay the scoring model day by day. Day i sees only candles up to and including i
 * (its 00:00 UTC close) and Fear & Greed values published by then — no look-ahead.
 */
export function replay(sol: DailyPoint[], btc: DailyPoint[], fg: FearGreedPoint[]): DayScore[] {
  return sol.map((c, i) => {
    const now = c.t + 60_000;
    const r = score(
      {
        quote: { price: c.price, change24h: null, change7d: null, change30d: null, volume24h: c.volume, marketCap: null, updatedAt: c.t },
        solDaily: sol.slice(0, i + 1),
        btcDaily: btc.filter((b) => b.t <= c.t),
        // Strictly earlier: a same-day value may have been published after 00:00 UTC.
        fearGreed: fg.filter((f) => f.t < c.t),
      },
      now,
    );
    return { t: c.t, price: c.price, score: r.score };
  });
}

const HORIZONS = [7, 30, 90] as const;

function stats(days: DayScore[], all: DayScore[], o: BacktestOptions) {
  const idx = new Map(all.map((d, i) => [d.t, i]));
  const cost = (1 - o.fee - o.slippage) ** 2; // buy and sell
  const fwd = (i: number, h: number) => (all[i + h] ? (all[i + h].price / all[i].price) * cost - 1 : null);
  // Signals are crossings into the opportunity zone, not every day spent there.
  const signals = days.filter((d) => {
    const i = idx.get(d.t)!;
    return d.score !== null && d.score >= o.threshold && (all[i - 1]?.score ?? 0) < o.threshold;
  });
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const out: Record<string, unknown> = { days: days.length, signals: signals.length };
  for (const h of HORIZONS) {
    const sig = signals.map((s) => fwd(idx.get(s.t)!, h)).filter((v): v is number => v !== null);
    const base = days.map((d) => fwd(idx.get(d.t)!, h)).filter((v): v is number => v !== null);
    out[`avg${h}d`] = mean(sig);
    out[`buyHold${h}d`] = mean(base);
    out[`losing${h}d`] = sig.length ? sig.filter((v) => v < 0).length / sig.length : null;
    out[`n${h}d`] = sig.length;
  }
  const dds = signals.map((s) => {
    const i = idx.get(s.t)!;
    const window = all.slice(i, i + 31).map((d) => d.price);
    return Math.min(...window) / all[i].price - 1;
  });
  out.maxDrawdown30d = dds.length ? Math.min(...dds) : null;
  return out;
}

export function backtest(sol: DailyPoint[], btc: DailyPoint[], fg: FearGreedPoint[], o: BacktestOptions) {
  const all = replay(sol, btc, fg);
  const eligible = all.filter((d) => d.score !== null);
  const cut = Math.floor(eligible.length * o.devFraction);
  return {
    from: eligible[0] ? new Date(eligible[0].t).toISOString().slice(0, 10) : null,
    to: eligible.at(-1) ? new Date(eligible.at(-1)!.t).toISOString().slice(0, 10) : null,
    development: stats(eligible.slice(0, cut), all, o),
    evaluation: stats(eligible.slice(cut), all, o),
  };
}

