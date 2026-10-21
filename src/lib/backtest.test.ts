import { describe, expect, it } from "vitest";
import { backtest, replay } from "./backtest";
import { DAY_MS } from "./indicators";

const t0 = Date.UTC(2025, 0, 1);
const mk = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * DAY_MS, price: f(i), volume: 1e9 }));

describe("backtest", () => {
  const sol = mk(200, (i) => 100 + Math.sin(i / 9) * 20);
  const btc = mk(200, (i) => 80_000 + i * 10);

  it("has no look-ahead: changing the future never changes past scores", () => {
    const a = replay(sol, btc, []);
    const altered = sol.map((c, i) => (i > 150 ? { ...c, price: c.price * 3 } : c));
    const b = replay(altered, btc, []);
    expect(b.slice(0, 151)).toEqual(a.slice(0, 151));
  });

  it("splits development and evaluation and applies costs", () => {
    const r = backtest(sol, btc, [], { threshold: 55, fee: 0.001, slippage: 0.002, devFraction: 0.6 });
    expect(r.development.days as number).toBeGreaterThan(r.evaluation.days as number);
    const free = backtest(sol, btc, [], { threshold: 55, fee: 0, slippage: 0, devFraction: 0.6 });
    if (r.development.avg7d !== null) expect(r.development.avg7d as number).toBeLessThan(free.development.avg7d as number);
  });
});
