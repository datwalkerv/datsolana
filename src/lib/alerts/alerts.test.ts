import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, bucketId, evaluate, type SignalState } from ".";

const now = Date.UTC(2026, 9, 21, 12);
const base: SignalState = { status: "ok", score: 50, price: 100, fearGreed: 40, rsi: 45, supportingCount: 2, recovery: false };
const run = (prev: Partial<SignalState> | null, curr: Partial<SignalState>, extra: Partial<Parameters<typeof evaluate>[0]> = {}) =>
  evaluate({
    prev: prev && { ...base, ...prev },
    curr: { ...base, ...curr },
    settings: DEFAULT_SETTINGS,
    lastFired: {},
    refPrice: null,
    now,
    ...extra,
  }).map((d) => d.rule);

describe("threshold crossings", () => {
  it("fires when the score crosses 65 and 80", () => {
    expect(run({ score: 60 }, { score: 66 })).toContain("score_potential");
    expect(run({ score: 60 }, { score: 82 })).toEqual(expect.arrayContaining(["score_potential", "score_strong"]));
  });
  it("does not fire while staying above the threshold", () => {
    expect(run({ score: 70 }, { score: 72 })).not.toContain("score_potential");
  });
  it("fires on entering extreme fear and RSI oversold", () => {
    expect(run({ fearGreed: 30 }, { fearGreed: 20 })).toContain("extreme_fear");
    expect(run({ fearGreed: 20 }, { fearGreed: 18 })).not.toContain("extreme_fear");
    expect(run({ rsi: 31 }, { rsi: 29 })).toContain("rsi_oversold");
  });
  it("detects price drops against the reference price", () => {
    expect(run(base, { price: 89 }, { refPrice: 100 })).toContain("price_drop");
    expect(run(base, { price: 95 }, { refPrice: 100 })).not.toContain("price_drop");
  });
  it("detects recovery, alignment and deterioration", () => {
    expect(run({ recovery: false }, { recovery: true })).toContain("recovery");
    expect(run({ supportingCount: 3 }, { supportingCount: 4, score: 70 })).toContain("alignment");
    expect(run({ score: 70 }, { score: 50 })).toContain("deterioration");
    expect(run({ score: 70 }, { score: 60 })).not.toContain("deterioration");
  });
});

describe("safety", () => {
  it("never fires on unavailable data or without a previous snapshot", () => {
    expect(run({ score: 60 }, { status: "unavailable", score: null })).toEqual([]);
    expect(run({ status: "unavailable", score: null }, { score: 90 })).toEqual([]);
    expect(run(null, { score: 90 })).toEqual([]);
  });
  it("respects cooldowns", () => {
    const hour = 3_600_000;
    expect(run({ score: 60 }, { score: 70 }, { lastFired: { score_potential: now - hour } })).toEqual([]);
    expect(run({ score: 60 }, { score: 70 }, { lastFired: { score_potential: now - 13 * hour } })).toContain("score_potential");
  });
  it("respects disabled rules", () => {
    const settings = { ...DEFAULT_SETTINGS, enabled: { ...DEFAULT_SETTINGS.enabled, score_potential: false } };
    expect(run({ score: 60 }, { score: 70 }, { settings })).toEqual([]);
  });
  it("buckets runs into 15-minute idempotency windows", () => {
    expect(bucketId(Date.UTC(2026, 9, 21, 12, 7))).toBe(bucketId(Date.UTC(2026, 9, 21, 12, 14, 59)));
    expect(bucketId(Date.UTC(2026, 9, 21, 12, 15))).not.toBe(bucketId(Date.UTC(2026, 9, 21, 12, 14)));
  });
});
