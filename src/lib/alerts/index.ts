import { z } from "zod";

export const RULES = {
  score_potential: "Opportunity Score crosses the potential-opportunity threshold",
  score_strong: "Opportunity Score crosses the strong-opportunity threshold",
  extreme_fear: "Fear & Greed enters Extreme Fear",
  rsi_oversold: "RSI falls below the oversold threshold",
  price_drop: "SOL drops sharply over the configured window",
  recovery: "SOL starts recovering after a significant drawdown",
  alignment: "Multiple indicators align",
  deterioration: "A favorable setup becomes materially less favorable",
} as const;

export type RuleId = keyof typeof RULES;
export const RULE_IDS = Object.keys(RULES) as RuleId[];

export const SettingsSchema = z.object({
  enabled: z.record(z.enum(RULE_IDS as [RuleId, ...RuleId[]]), z.boolean()),
  scorePotential: z.number().int().min(1).max(99),
  scoreStrong: z.number().int().min(1).max(100),
  fearThreshold: z.number().int().min(0).max(50),
  rsiThreshold: z.number().min(5).max(50),
  dropPct: z.number().min(1).max(50),
  dropHours: z.number().int().min(1).max(168),
  cooldownHours: z.number().min(0.25).max(168),
  currency: z.literal("usd"),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  enabled: Object.fromEntries(RULE_IDS.map((r) => [r, true])) as Record<RuleId, boolean>,
  scorePotential: 65,
  scoreStrong: 80,
  fearThreshold: 24,
  rsiThreshold: 30,
  dropPct: 10,
  dropHours: 24,
  cooldownHours: 12,
  currency: "usd",
};

/** The subset of a market snapshot the rules need. */
export interface SignalState {
  status: "ok" | "unavailable";
  score: number | null;
  price: number | null;
  fearGreed: number | null;
  rsi: number | null;
  supportingCount: number;
  recovery: boolean;
}

export interface AlertDecision {
  rule: RuleId;
  condition: string;
}

/**
 * Pure rule evaluation. Rules fire on transitions between the previous and current snapshot
 * (not on every refresh), respect per-rule cooldowns, and never fire on unavailable/stale data.
 */
export function evaluate(args: {
  prev: SignalState | null;
  curr: SignalState;
  settings: Settings;
  /** ms of the last delivered alert per rule */
  lastFired: Partial<Record<RuleId, number>>;
  /** SOL price `settings.dropHours` ago, if known */
  refPrice: number | null;
  now: number;
}): AlertDecision[] {
  const { prev, curr, settings: s, lastFired, refPrice, now } = args;
  if (curr.status !== "ok" || curr.score === null) return [];
  const out: AlertDecision[] = [];
  const ok = prev?.status === "ok" && prev.score !== null ? prev : null;
  const crossedUp = (a: number | null | undefined, b: number | null, t: number) => a != null && b != null && a < t && b >= t;
  const crossedDown = (a: number | null | undefined, b: number | null, t: number) => a != null && b != null && a >= t && b < t;

  if (crossedUp(ok?.score, curr.score, s.scorePotential))
    out.push({ rule: "score_potential", condition: `Score rose from ${ok!.score} to ${curr.score} (≥ ${s.scorePotential})` });
  if (crossedUp(ok?.score, curr.score, s.scoreStrong))
    out.push({ rule: "score_strong", condition: `Score rose from ${ok!.score} to ${curr.score} (≥ ${s.scoreStrong})` });
  // "Enters": prev was above the threshold, now at or below it.
  if (ok?.fearGreed != null && curr.fearGreed !== null && ok.fearGreed > s.fearThreshold && curr.fearGreed <= s.fearThreshold)
    out.push({ rule: "extreme_fear", condition: `Fear & Greed fell to ${curr.fearGreed}` });
  if (crossedDown(ok?.rsi, curr.rsi, s.rsiThreshold))
    out.push({ rule: "rsi_oversold", condition: `RSI (14) fell to ${curr.rsi!.toFixed(1)} (< ${s.rsiThreshold})` });
  if (refPrice && curr.price !== null) {
    const change = (curr.price / refPrice - 1) * 100;
    if (change <= -s.dropPct) out.push({ rule: "price_drop", condition: `SOL moved ${change.toFixed(1)}% in ${s.dropHours}h` });
  }
  if (ok && !ok.recovery && curr.recovery) out.push({ rule: "recovery", condition: "Price reclaimed its 20-day average after a significant drawdown" });
  if (ok && ok.supportingCount < 4 && curr.supportingCount >= 4 && curr.score >= s.scorePotential)
    out.push({ rule: "alignment", condition: `${curr.supportingCount} of 6 indicators support the setup` });
  if (ok && ok.score! >= s.scorePotential && curr.score < s.scorePotential - 10)
    out.push({ rule: "deterioration", condition: `Score fell from ${ok.score} to ${curr.score}` });

  const cooldownMs = s.cooldownHours * 3_600_000;
  return out.filter((d) => s.enabled[d.rule] !== false && !(lastFired[d.rule] !== undefined && now - lastFired[d.rule]! < cooldownMs));
}

/** 15-minute UTC bucket id; the idempotency key for a monitoring run. */
export const bucketId = (ms: number) => new Date(Math.floor(ms / 900_000) * 900_000).toISOString();

/** One notification per subscription per bucket, however many rules fired in it. */
export const dedupeKey = (subscriptionId: string, bucket: string) => `${subscriptionId}:${bucket}`;
