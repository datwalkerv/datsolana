import type { Db } from "mongodb";
import { type RuleId, type SignalState, bucketId, dedupeKey, evaluate } from "./alerts";
import { type SnapshotDoc, cols } from "./db";
import { DAY_MS, finalizedDaily, startOfUtcDay } from "./indicators";
import type { MarketDataProvider, SentimentProvider } from "./providers";
import { type Sender, type Vapid, alertNotification } from "./push";
import { fearGreedLabel } from "./scoring/config";
import { score } from "./scoring";
import type { DailyPoint } from "./types";

export interface MonitorDeps {
  db: Db;
  market: MarketDataProvider;
  sentiment: SentimentProvider;
  send: Sender;
  vapid: Vapid;
  appUrl: string;
  now: number;
}

export const signalState = (s: SnapshotDoc): SignalState => ({
  status: s.status,
  score: s.score,
  price: s.quote?.price ?? null,
  fearGreed: s.fearGreed?.value ?? null,
  rsi: s.indicators.rsi,
  supportingCount: s.components.filter((c) => c.stance === "supports").length,
  recovery: s.indicators.drawdownRecovery,
});

async function dailySeries(deps: MonitorDeps, coin: "solana" | "bitcoin", errors: string[]): Promise<DailyPoint[]> {
  const c = cols(deps.db).series;
  const today = startOfUtcDay(deps.now);
  const cached = await c.findOne({ _id: coin });
  const lastT = cached?.points.filter((p) => p.t % DAY_MS === 0).at(-1)?.t ?? 0;
  const day = new Date(today).toISOString().slice(0, 10);
  // Refetch once per UTC day, and hourly after midnight until the new finalized candle appears.
  const due = !cached || cached.fetchedDay !== day || (lastT < today && deps.now - cached.fetchedAt.getTime() > 3_600_000);
  if (!due) return cached.points;
  const r = await deps.market.daily(coin, 365);
  if (!r.ok) {
    errors.push(r.error);
    return cached?.points ?? []; // freshness checks downstream reject this if it is too old
  }
  await c.updateOne({ _id: coin }, { $set: { fetchedDay: day, fetchedAt: new Date(deps.now), points: r.data } }, { upsert: true });
  return r.data;
}

/** Build (or reuse) the snapshot for the current 15-minute bucket. */
export async function buildSnapshot(deps: MonitorDeps): Promise<{ snapshot: SnapshotDoc; errors: string[] }> {
  const c = cols(deps.db);
  const bucket = bucketId(deps.now);
  const existing = await c.snapshots.findOne({ _id: bucket });
  if (existing) return { snapshot: existing, errors: [] };

  const errors: string[] = [];
  const [quotes, fg, solRaw, btcRaw] = await Promise.all([
    deps.market.quotes(),
    deps.sentiment.fearGreed(30),
    dailySeries(deps, "solana", errors),
    dailySeries(deps, "bitcoin", errors),
  ]);
  if (!quotes.ok) errors.push(quotes.error);
  if (!fg.ok) errors.push(fg.error);

  const sol = finalizedDaily(solRaw, deps.now);
  const btc = finalizedDaily(btcRaw, deps.now);
  const fgPoints = fg.ok ? fg.data : [];
  const result = score({ quote: quotes.ok ? quotes.data.sol : null, solDaily: sol.candles, btcDaily: btc.candles, fearGreed: fgPoints }, deps.now);
  result.freshness.issues.push(...sol.issues.map((i) => `SOL: ${i}`), ...btc.issues.map((i) => `BTC: ${i}`));

  const day = new Date(deps.now).toISOString().slice(0, 10);
  const latestFg = fgPoints.at(-1);
  const doc: SnapshotDoc = {
    _id: bucket,
    at: new Date(deps.now),
    day,
    daily: !(await c.snapshots.findOne({ day, daily: true }, { projection: { _id: 1 } })),
    modelVersion: result.modelVersion,
    status: result.status,
    unavailableReasons: result.unavailableReasons,
    score: result.score,
    classification: result.classification,
    components: result.components,
    coverage: result.coverage,
    conflict: result.conflict,
    reasons: result.reasons,
    indicators: result.indicators,
    freshness: result.freshness,
    quote: quotes.ok ? quotes.data.sol : null,
    btcQuote: quotes.ok ? quotes.data.btc : null,
    fearGreed: latestFg
      ? { value: latestFg.value, label: fearGreedLabel(latestFg.value), previous: fgPoints.at(-2)?.value ?? null, history: fgPoints.slice(-7) }
      : null,
    providerErrors: errors,
  };
  // Concurrent runs in one bucket: the first insert wins, later ones read it back.
  const { _id, ...fields } = doc;
  const saved = await c.snapshots.findOneAndUpdate({ _id }, { $setOnInsert: fields }, { upsert: true, returnDocument: "after" });
  return { snapshot: saved!, errors };
}

export async function runMonitor(deps: MonitorDeps) {
  const started = Date.now();
  const c = cols(deps.db);
  const { snapshot, errors } = await buildSnapshot(deps);
  const prev = await c.snapshots.findOne({ _id: { $lt: snapshot._id } }, { sort: { _id: -1 } });
  const curr = signalState(snapshot);
  let sent = 0;
  const failures: string[] = [];

  const refPrices = new Map<number, number | null>();
  const refPrice = async (hours: number) => {
    if (!refPrices.has(hours)) {
      const target = deps.now - hours * 3_600_000;
      // Closest snapshot at or before the target, but no more than an hour earlier.
      const s = await c.snapshots.findOne({ at: { $lte: new Date(target), $gte: new Date(target - 3_600_000) }, status: "ok" }, { sort: { at: -1 } });
      refPrices.set(hours, s?.quote?.price ?? null);
    }
    return refPrices.get(hours)!;
  };

  for await (const sub of c.subscriptions.find({ status: "active" })) {
    const subId = sub._id!.toHexString();
    const fired = await c.alerts
      .aggregate<{ _id: RuleId; at: Date }>([
        { $match: { subscriptionId: subId, delivery: "sent" } },
        { $unwind: "$rules" },
        { $group: { _id: "$rules", at: { $max: "$at" } } },
      ])
      .toArray();
    const decisions = evaluate({
      prev: prev ? signalState(prev) : null,
      curr,
      settings: sub.settings,
      lastFired: Object.fromEntries(fired.map((f) => [f._id, f.at.getTime()])),
      refPrice: await refPrice(sub.settings.dropHours),
      now: deps.now,
    });
    if (!decisions.length) continue;

    const rules = decisions.map((d) => d.rule);
    const conditions = decisions.map((d) => d.condition);
    try {
      await c.alerts.insertOne({
        dedupeKey: dedupeKey(subId, snapshot._id),
        subscriptionId: subId,
        rules,
        at: new Date(deps.now),
        bucket: snapshot._id,
        score: snapshot.score,
        price: snapshot.quote?.price ?? null,
        classification: snapshot.classification?.label ?? null,
        conditions,
        indicators: { rsi: snapshot.indicators.rsi, fearGreed: curr.fearGreed, dev50: snapshot.indicators.dev50, drawdown90: snapshot.indicators.drawdown90 },
        modelVersion: snapshot.modelVersion,
        delivery: "pending",
        attempts: 0,
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) continue; // already handled for this bucket
      throw e;
    }
    const r = await deps.send(sub, alertNotification(rules, conditions, snapshot, deps.appUrl), deps.vapid);
    await c.alerts.updateOne(
      { dedupeKey: dedupeKey(subId, snapshot._id) },
      { $set: { delivery: r.ok ? "sent" : r.expired ? "expired" : "failed", ...(r.ok ? {} : { error: r.error }) }, $inc: { attempts: 1 } },
    );
    if (r.ok) {
      sent++;
      await c.subscriptions.updateOne({ _id: sub._id }, { $set: { lastUsedAt: new Date(deps.now) }, $unset: { lastError: "" } });
    } else if (r.expired) {
      await c.subscriptions.deleteOne({ _id: sub._id });
    } else {
      failures.push(`push to ${subId}: ${r.error}`);
      console.error("[monitor] push failed", subId, r.error);
      await c.subscriptions.updateOne({ _id: sub._id }, { $set: { lastError: r.error } });
    }
  }

  const allErrors = [...errors, ...failures];
  await c.runs.insertOne({
    at: new Date(deps.now),
    bucket: snapshot._id,
    ok: snapshot.status === "ok" && !failures.length,
    durationMs: Date.now() - started,
    status: snapshot.status,
    errors: allErrors,
    sent,
  });
  return { bucket: snapshot._id, status: snapshot.status, score: snapshot.score, sent, errors: allErrors };
}
