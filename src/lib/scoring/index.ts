import { DAY_MS, drawdown, returnOver, rsiSeries, sma, startOfUtcDay, volumeRatio } from "../indicators";
import type { DailyPoint, FearGreedPoint, Quote } from "../types";
import {
  CRITICAL,
  type ClassKey,
  type ComponentKey,
  FRESHNESS,
  MODEL_VERSION,
  WEIGHTS,
  classify,
  fearGreedLabel,
} from "./config";

export type Stance = "supports" | "neutral" | "contradicts" | "unavailable";

export interface Component {
  key: ComponentKey;
  label: string;
  weight: number;
  score: number | null;
  value: string;
  interpretation: string;
  stance: Stance;
}

export interface Indicators {
  price: number | null;
  rsi: number | null;
  rsiMin10: number | null;
  ma20: number | null;
  ma50: number | null;
  dev20: number | null;
  dev50: number | null;
  drawdown90: number | null;
  high90: number | null;
  rebound30: number | null;
  sol30: number | null;
  btc30: number | null;
  relBtc30: number | null;
  btcAboveMa50: boolean | null;
  volRatio: number | null;
  sol7: number | null;
  fearGreed: number | null;
  rsiRecovery: boolean;
  drawdownRecovery: boolean;
}

export interface ScoreInputs {
  quote: Quote | null;
  /** Finalized daily candles, ascending. */
  solDaily: DailyPoint[];
  btcDaily: DailyPoint[];
  /** Ascending, latest last. */
  fearGreed: FearGreedPoint[];
}

export interface ScoreResult {
  modelVersion: string;
  status: "ok" | "unavailable";
  unavailableReasons: string[];
  score: number | null;
  classification: { key: ClassKey; label: string } | null;
  components: Component[];
  /** Share of total weight that had data, 0–1. */
  coverage: number;
  conflict: boolean;
  reasons: { supporting: string[]; contradicting: string[] };
  indicators: Indicators;
  freshness: { quoteAgeMs: number | null; lastCandleAt: number | null; fearGreedAt: number | null; issues: string[] };
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const pct = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
const stanceOf = (s: number): Stance => (s >= 60 ? "supports" : s <= 40 ? "contradicts" : "neutral");

export function computeIndicators(inp: ScoreInputs, now: number): Indicators {
  const closes = inp.solDaily.map((c) => c.price);
  const price = inp.quote?.price ?? null;
  const rsis = rsiSeries(closes, 14);
  const rsi = rsis.at(-1) ?? null;
  const recentRsi = rsis.slice(-10).filter((v): v is number => v !== null);
  const rsiMin10 = recentRsi.length ? Math.min(...recentRsi) : null;
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const dd = price !== null && closes.length >= 90 ? drawdown(closes.slice(-90), price) : null;
  const low30 = closes.length >= 30 ? Math.min(...closes.slice(-30)) : null;
  const rebound30 = price !== null && low30 ? price / low30 - 1 : null;

  const btcCloses = inp.btcDaily.map((c) => c.price);
  const btcNow = btcCloses.at(-1);
  const sol30 = price !== null ? returnOver(closes, 30, price) : null;
  const btc30 = btcNow !== undefined ? returnOver(btcCloses, 30, btcNow) : null;
  const btcMa50 = sma(btcCloses, 50);

  const fg = inp.fearGreed.at(-1);
  const fgFresh = fg && fg.t >= startOfUtcDay(now) - FRESHNESS.fearGreedMaxAgeDays * DAY_MS;

  return {
    price,
    rsi,
    rsiMin10,
    ma20,
    ma50,
    dev20: price !== null && ma20 ? price / ma20 - 1 : null,
    dev50: price !== null && ma50 ? price / ma50 - 1 : null,
    drawdown90: dd?.drawdown ?? null,
    high90: dd?.high ?? null,
    rebound30,
    sol30,
    btc30,
    relBtc30: sol30 !== null && btc30 !== null ? sol30 - btc30 : null,
    btcAboveMa50: btcNow !== undefined && btcMa50 ? btcNow > btcMa50 : null,
    volRatio: volumeRatio(inp.solDaily.map((c) => c.volume)),
    sol7: price !== null ? returnOver(closes, 7, price) : null,
    fearGreed: fgFresh ? fg.value : null,
    // Oversold alone is not a recovery: require RSI to have left the oversold zone and price to reclaim MA20.
    rsiRecovery: rsiMin10 !== null && rsiMin10 < 30 && rsi !== null && rsi >= 40 && price !== null && ma20 !== null && price > ma20,
    drawdownRecovery:
      dd !== null && low30 !== null && price !== null && ma20 !== null && low30 / dd.high - 1 <= -0.25 && price / low30 - 1 >= 0.1 && price > ma20,
  };
}

type Scored = { score: number; value: string; interpretation: string };

function sentiment(i: Indicators): Scored | null {
  const v = i.fearGreed;
  if (v === null) return null;
  const label = fearGreedLabel(v);
  const confirmed = i.rsiRecovery || i.drawdownRecovery;
  // Contrarian, but capped: extreme fear only scores high once price action confirms.
  if (v <= 24)
    return confirmed
      ? { score: 85, value: `${v} · ${label}`, interpretation: "Market sentiment is extremely fearful, and SOL price action is starting to confirm a recovery." }
      : { score: 65, value: `${v} · ${label}`, interpretation: "Market sentiment is extremely fearful; fear alone is not a buy signal without price confirmation." };
  if (v <= 44) return { score: 62, value: `${v} · ${label}`, interpretation: "Market sentiment is fearful, which has historically coincided with cheaper entries." };
  if (v <= 55) return { score: 50, value: `${v} · ${label}`, interpretation: "Market sentiment is neutral." };
  if (v <= 74) return { score: 35, value: `${v} · ${label}`, interpretation: "Market sentiment is greedy; buyers may be paying up." };
  return { score: 15, value: `${v} · ${label}`, interpretation: "Market sentiment shows extreme greed, an elevated-risk environment for new purchases." };
}

function trend(i: Indicators): Scored | null {
  if (i.price === null || i.ma20 === null || i.ma50 === null || i.dev20 === null || i.dev50 === null) return null;
  let s = 50;
  const parts: string[] = [];
  s += i.price > i.ma20 ? 15 : -15;
  s += i.price > i.ma50 ? 10 : -10;
  s += i.ma20 > i.ma50 ? 10 : -10;
  parts.push(`SOL is trading ${i.price > i.ma50 ? "above" : "below"} its 50-day moving average (${pct(i.dev50)})`);
  parts.push(`${i.price > i.ma20 ? "above" : "below"} its 20-day average (${pct(i.dev20)})`);
  if (i.dev20 > 0.15) {
    s -= 20;
    parts.push("and is stretched well above the 20-day average");
  }
  return { score: clamp(s), value: `${pct(i.dev50)} vs MA50`, interpretation: parts.join(", ") + "." };
}

function momentum(i: Indicators): Scored | null {
  const r = i.rsi;
  if (r === null) return null;
  const v = r.toFixed(1);
  if (i.rsiRecovery) return { score: 80, value: v, interpretation: `RSI recovered from oversold to ${v} with price back above the 20-day average.` };
  if (r < 30) return { score: 60, value: v, interpretation: `RSI at ${v} indicates oversold conditions, but no confirmed recovery yet.` };
  if (r < 45) return { score: 60, value: v, interpretation: `RSI at ${v} shows weak but not overheated momentum.` };
  if (r < 60) return { score: 50, value: v, interpretation: `RSI at ${v} is neutral.` };
  if (r < 70) return { score: 35, value: v, interpretation: `RSI at ${v} shows strong momentum; entries are less discounted.` };
  return { score: 15, value: v, interpretation: `RSI at ${v} indicates overbought conditions.` };
}

function drawdownScore(i: Indicators): Scored | null {
  const d = i.drawdown90;
  if (d === null) return null;
  let s = d <= -0.4 ? 70 : d <= -0.25 ? 60 : d <= -0.1 ? 50 : 35;
  let text = `SOL is ${pct(d)} from its 90-day high.`;
  if (i.drawdownRecovery) {
    s += 15;
    text += ` It has rebounded ${pct(i.rebound30 ?? 0)} from its 30-day low and reclaimed the 20-day average.`;
  } else if (d <= -0.25) {
    text += " The decline has not yet shown a confirmed rebound.";
  }
  return { score: clamp(s), value: pct(d), interpretation: text };
}

function relative(i: Indicators): Scored | null {
  const r = i.relBtc30;
  if (r === null) return null;
  let s = r > 0.1 ? 75 : r >= 0 ? 60 : r >= -0.1 ? 40 : 25;
  let text = r >= 0 ? `SOL is outperforming BTC by ${pct(r)} over 30 days.` : `SOL continues to underperform BTC by ${pct(r)} over 30 days.`;
  if (i.btcAboveMa50 !== null) {
    s += i.btcAboveMa50 ? 5 : -5;
    text += i.btcAboveMa50 ? " BTC is above its 50-day average." : " BTC is below its 50-day average, a weaker backdrop for the market.";
  }
  return { score: clamp(s), value: `${pct(r)} vs BTC`, interpretation: text };
}

function volume(i: Indicators): Scored | null {
  const v = i.volRatio;
  if (v === null || i.sol7 === null) return null;
  const value = `${v.toFixed(2)}× 30d avg`;
  const up = i.sol7 >= 0;
  if (v >= 1.1 && up) return { score: 75, value, interpretation: "Rising volume accompanies rising prices, confirming buyer interest." };
  if (v >= 1.1) return { score: 30, value, interpretation: "Rising volume accompanies falling prices, indicating selling pressure." };
  if (v <= 0.9 && !up) return { score: 45, value, interpretation: "Selling is happening on fading volume; volume does not yet confirm a recovery." };
  if (v <= 0.9) return { score: 45, value, interpretation: "Prices are rising on fading volume, a weakly confirmed move." };
  return { score: 50, value, interpretation: "Trading volume is near its recent average and confirms neither direction." };
}

const LABELS: Record<ComponentKey, string> = {
  sentiment: "Fear & Greed sentiment",
  trend: "Trend & moving averages",
  momentum: "RSI & momentum",
  drawdown: "Drawdown & recovery",
  relative: "Relative to BTC",
  volume: "Volume confirmation",
};

const SCORERS: Record<ComponentKey, (i: Indicators) => Scored | null> = {
  sentiment,
  trend,
  momentum,
  drawdown: drawdownScore,
  relative,
  volume,
};

export function score(inp: ScoreInputs, now: number): ScoreResult {
  const indicators = computeIndicators(inp, now);
  const issues: string[] = [];
  const unavailable: string[] = [];

  const quoteAgeMs = inp.quote ? now - inp.quote.updatedAt : null;
  if (quoteAgeMs === null) unavailable.push("SOL price is unavailable");
  else if (quoteAgeMs > FRESHNESS.quoteMaxAgeMs) unavailable.push("SOL price is stale");

  const lastCandleAt = inp.solDaily.at(-1)?.t ?? null;
  if (inp.solDaily.length < FRESHNESS.minCandles) unavailable.push("Not enough daily price history");
  else if (lastCandleAt! < startOfUtcDay(now) - FRESHNESS.dailyMaxAgeDays * DAY_MS) unavailable.push("Daily price history is stale");

  const fearGreedAt = inp.fearGreed.at(-1)?.t ?? null;
  if (indicators.fearGreed === null) issues.push("Fear & Greed unavailable or stale; excluded from score");
  if (!inp.btcDaily.length) issues.push("BTC history unavailable; relative performance excluded");

  const components: Component[] = (Object.keys(WEIGHTS) as ComponentKey[]).map((key) => {
    const r = SCORERS[key](indicators);
    return r
      ? { key, label: LABELS[key], weight: WEIGHTS[key], score: r.score, value: r.value, interpretation: r.interpretation, stance: stanceOf(r.score) }
      : { key, label: LABELS[key], weight: WEIGHTS[key], score: null, value: "Unavailable", interpretation: "Data for this indicator is unavailable.", stance: "unavailable" };
  });

  for (const k of CRITICAL) if (components.find((c) => c.key === k)!.score === null) unavailable.push(`${LABELS[k]} could not be calculated`);

  const avail = components.filter((c) => c.score !== null);
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const availWeight = avail.reduce((s, c) => s + c.weight, 0);
  const coverage = availWeight / totalWeight;
  const supporting = avail.filter((c) => c.stance === "supports");
  const contradicting = avail.filter((c) => c.stance === "contradicts");
  const conflict = supporting.length >= 2 && contradicting.length >= 2;

  let value: number | null = null;
  if (!unavailable.length && availWeight > 0) {
    // Renormalize over available components so missing non-critical data neither helps nor hurts.
    const raw = avail.reduce((s, c) => s + c.score! * c.weight, 0) / availWeight;
    // Conflicting evidence pulls the score toward neutral.
    value = clamp(conflict ? 50 + (raw - 50) * 0.8 : raw);
  }
  const cls = value === null ? null : classify(value);

  return {
    modelVersion: MODEL_VERSION,
    status: value === null ? "unavailable" : "ok",
    unavailableReasons: unavailable,
    score: value,
    classification: cls ? { key: cls.key, label: cls.label } : null,
    components,
    coverage,
    conflict,
    reasons: {
      supporting: supporting.map((c) => c.interpretation),
      contradicting: [
        ...contradicting.map((c) => c.interpretation),
        ...(conflict ? ["Indicators disagree; the score was pulled toward neutral."] : []),
      ],
    },
    indicators,
    freshness: { quoteAgeMs, lastCandleAt, fearGreedAt, issues },
  };
}

