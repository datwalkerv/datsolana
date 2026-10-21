export const MODEL_VERSION = "2026.10-v1";

export const WEIGHTS = {
  sentiment: 0.2,
  trend: 0.25,
  momentum: 0.2,
  drawdown: 0.15,
  relative: 0.1,
  volume: 0.1,
} as const;

export type ComponentKey = keyof typeof WEIGHTS;

/** Components without which no score is produced. */
export const CRITICAL: ComponentKey[] = ["trend", "momentum"];

/** Heuristic thresholds, not empirically validated trading rules. Lower bound inclusive. */
export const CLASSES = [
  { min: 80, key: "strong", label: "Strong potential opportunity" },
  { min: 65, key: "potential", label: "Potential opportunity" },
  { min: 40, key: "mixed", label: "Mixed conditions" },
  { min: 20, key: "unfavorable", label: "Unfavorable conditions" },
  { min: 0, key: "very_unfavorable", label: "Very unfavorable conditions" },
] as const;

export type ClassKey = (typeof CLASSES)[number]["key"];

export const FRESHNESS = {
  /** A quote older than this is stale and cannot produce a score. */
  quoteMaxAgeMs: 2 * 60 * 60 * 1000,
  /** Latest finalized daily candle must be within this many days. */
  dailyMaxAgeDays: 2,
  /** Fear & Greed publishes daily; older than this is treated as missing. */
  fearGreedMaxAgeDays: 2,
  minCandles: 51,
};

export const FEAR_GREED_BANDS = [
  { max: 24, label: "Extreme Fear" },
  { max: 44, label: "Fear" },
  { max: 55, label: "Neutral" },
  { max: 74, label: "Greed" },
  { max: 100, label: "Extreme Greed" },
] as const;

export const fearGreedLabel = (v: number) => FEAR_GREED_BANDS.find((b) => v <= b.max)!.label;

export function classify(score: number) {
  return CLASSES.find((c) => score >= c.min)!;
}
