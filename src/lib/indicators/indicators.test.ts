import { describe, expect, it } from "vitest";
import { DAY_MS, drawdown, finalizedDaily, returnOver, rsiSeries, sma, smaSeries, volumeRatio } from ".";

describe("rsiSeries", () => {
  // StockCharts' published Wilder RSI(14) worked example.
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22];
  // The published table rounds intermediate averages to 2 dp, so allow ±0.15.
  it("matches the reference values", () => {
    const r = rsiSeries(closes, 14);
    expect(r.slice(0, 14).every((v) => v === null)).toBe(true);
    [70.53, 66.32, 66.55, 69.41, 66.36].forEach((want, i) => expect(Math.abs(r[14 + i]! - want)).toBeLessThan(0.15));
  });
  it("handles flat and one-sided series", () => {
    expect(rsiSeries(Array(20).fill(5)).at(-1)).toBe(50);
    expect(rsiSeries(Array.from({ length: 20 }, (_, i) => i + 1)).at(-1)).toBe(100);
    expect(rsiSeries([1, 2, 3])).toEqual([null, null, null]);
  });
});

describe("moving averages", () => {
  it("sma of last n", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2], 3)).toBeNull();
  });
  it("smaSeries aligns with sma", () => {
    const v = [3, 1, 4, 1, 5, 9, 2, 6];
    const s = smaSeries(v, 3);
    expect(s.slice(0, 2)).toEqual([null, null]);
    for (let i = 2; i < v.length; i++) expect(s[i]).toBeCloseTo(sma(v.slice(0, i + 1), 3)!);
  });
});

describe("drawdown / returns / volume", () => {
  it("drawdown from rolling high", () => {
    expect(drawdown([100, 150, 120], 90)).toEqual({ drawdown: -0.4, high: 150 });
    expect(drawdown([100], 110).drawdown).toBe(0);
  });
  it("returnOver", () => {
    expect(returnOver([100, 110, 120], 3, 150)).toBeCloseTo(0.5);
    expect(returnOver([100], 3, 150)).toBeNull();
  });
  it("volumeRatio", () => {
    expect(volumeRatio([...Array(30).fill(10), ...Array(7).fill(20)])).toBe(2);
    expect(volumeRatio([1, 2])).toBeNull();
  });
});

describe("finalizedDaily", () => {
  const now = Date.UTC(2026, 9, 21, 15, 30);
  const today = Date.UTC(2026, 9, 21);
  it("drops the live incomplete point, invalid and duplicate points", () => {
    const { candles, issues } = finalizedDaily(
      [
        { t: today - 2 * DAY_MS, price: 10, volume: 1 },
        { t: today - DAY_MS, price: 11, volume: 1 },
        { t: today - DAY_MS, price: 11.5, volume: 1 },
        { t: today - 3 * DAY_MS, price: -1, volume: 1 },
        { t: today, price: 12, volume: 1 },
        { t: now, price: 12.3, volume: 1 },
      ],
      now,
    );
    expect(candles.map((c) => c.price)).toEqual([10, 11.5, 12]);
    expect(issues).toEqual(["invalid point at 2026-10-18"]);
  });
  it("reports gaps", () => {
    const { issues } = finalizedDaily(
      [
        { t: today - 5 * DAY_MS, price: 1, volume: 1 },
        { t: today - 2 * DAY_MS, price: 1, volume: 1 },
      ],
      now,
    );
    expect(issues).toEqual(["1 gap(s) in daily history"]);
  });
});
