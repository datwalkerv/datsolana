import { describe, expect, it } from "vitest";
import { score, type ScoreInputs } from ".";
import { DAY_MS } from "../indicators";
import { classify, fearGreedLabel } from "./config";

const now = Date.UTC(2026, 9, 21, 12);
const today = Date.UTC(2026, 9, 21);

function series(prices: number[], volume = 1000) {
  return prices.map((price, i) => ({ t: today - (prices.length - 1 - i) * DAY_MS, price, volume }));
}

function inputs(over: Partial<ScoreInputs> = {}, prices = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 5)): ScoreInputs {
  return {
    quote: { price: prices.at(-1)!, change24h: 0, change7d: 0, change30d: 0, volume24h: 1, marketCap: 1, updatedAt: now - 60_000 },
    solDaily: series(prices),
    btcDaily: series(prices.map((p) => p * 600)),
    fearGreed: [{ value: 50, t: today }],
    ...over,
  };
}

describe("classification", () => {
  it.each([
    [100, "strong"],
    [80, "strong"],
    [79, "potential"],
    [65, "potential"],
    [64, "mixed"],
    [40, "mixed"],
    [39, "unfavorable"],
    [20, "unfavorable"],
    [19, "very_unfavorable"],
    [0, "very_unfavorable"],
  ])("%i → %s", (s, key) => expect(classify(s).key).toBe(key));

  it.each([
    [0, "Extreme Fear"],
    [24, "Extreme Fear"],
    [25, "Fear"],
    [44, "Fear"],
    [45, "Neutral"],
    [55, "Neutral"],
    [56, "Greed"],
    [74, "Greed"],
    [75, "Extreme Greed"],
    [100, "Extreme Greed"],
  ])("F&G %i → %s", (v, label) => expect(fearGreedLabel(v)).toBe(label));
});

describe("score", () => {
  it("produces a full-coverage, deterministic score", () => {
    const a = score(inputs(), now);
    const b = score(inputs(), now);
    expect(a.status).toBe("ok");
    expect(a.coverage).toBeCloseTo(1);
    expect(a.score).toBe(b.score);
    expect(a.components).toHaveLength(6);
    expect(a.modelVersion).toBeTruthy();
  });

  it("renormalizes when non-critical data is missing", () => {
    const r = score(inputs({ fearGreed: [], btcDaily: [] }), now);
    expect(r.status).toBe("ok");
    expect(r.coverage).toBeCloseTo(0.7);
    expect(r.freshness.issues.length).toBe(2);
    const avail = r.components.filter((c) => c.score !== null);
    const expected = avail.reduce((s, c) => s + c.score! * c.weight, 0) / avail.reduce((s, c) => s + c.weight, 0);
    // Conflict damping may apply; either way, the score is derived only from available components.
    expect(Math.abs(r.score! - (r.conflict ? 50 + (expected - 50) * 0.8 : expected))).toBeLessThanOrEqual(0.5);
  });

  it("is unavailable when the quote is stale", () => {
    const i = inputs();
    i.quote!.updatedAt = now - 3 * 3_600_000;
    const r = score(i, now);
    expect(r.status).toBe("unavailable");
    expect(r.score).toBeNull();
    expect(r.unavailableReasons).toContain("SOL price is stale");
  });

  it("is unavailable with missing price or short history", () => {
    expect(score(inputs({ quote: null }), now).status).toBe("unavailable");
    const short = inputs({}, Array(30).fill(100));
    expect(score(short, now).unavailableReasons).toContain("Not enough daily price history");
  });

  it("is unavailable when daily history is stale", () => {
    const i = inputs();
    i.solDaily = i.solDaily.map((c) => ({ ...c, t: c.t - 5 * DAY_MS }));
    expect(score(i, now).unavailableReasons).toContain("Daily price history is stale");
  });

  it("does not treat extreme fear as an automatic buy", () => {
    // Steady decline: oversold, below MAs, no recovery.
    const falling = Array.from({ length: 120 }, (_, i) => 200 - i);
    const r = score(inputs({ fearGreed: [{ value: 10, t: today }] }, falling), now);
    const sentiment = r.components.find((c) => c.key === "sentiment")!;
    expect(sentiment.score).toBe(65);
    expect(r.indicators.rsiRecovery).toBe(false);
    expect(r.score!).toBeLessThan(65);
  });

  it("distinguishes oversold from confirmed recovery", () => {
    const crash = Array.from({ length: 100 }, (_, i) => 200 - i * 1.2);
    const rebound = [...crash, ...Array.from({ length: 8 }, (_, i) => crash.at(-1)! + (i + 1) * 6)];
    const r = score(inputs({ fearGreed: [{ value: 15, t: today }] }, rebound), now);
    expect(r.indicators.rsiMin10!).toBeLessThan(30);
    expect(r.indicators.rsiRecovery).toBe(true);
    expect(r.components.find((c) => c.key === "momentum")!.score).toBe(80);
    expect(r.components.find((c) => c.key === "sentiment")!.score).toBe(85);
  });

  it("explains every available component", () => {
    const r = score(inputs(), now);
    const explained = r.reasons.supporting.length + r.reasons.contradicting.length;
    const nonNeutral = r.components.filter((c) => c.stance === "supports" || c.stance === "contradicts").length;
    expect(explained).toBeGreaterThanOrEqual(nonNeutral);
    r.components.forEach((c) => expect(c.interpretation.length).toBeGreaterThan(0));
  });
});
