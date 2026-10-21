import { type Db, MongoClient } from "mongodb";
import type { RuleId, Settings } from "../alerts";
import type { ScoreResult } from "../scoring";
import type { DailyPoint, FearGreedPoint, Quote } from "../types";

export interface SnapshotDoc {
  _id: string; // 15-minute bucket id
  at: Date;
  day: string; // YYYY-MM-DD (UTC)
  /** First snapshot of each UTC day is kept forever; others expire. */
  daily: boolean;
  modelVersion: string;
  status: ScoreResult["status"];
  unavailableReasons: string[];
  score: number | null;
  classification: ScoreResult["classification"];
  components: ScoreResult["components"];
  coverage: number;
  conflict: boolean;
  reasons: ScoreResult["reasons"];
  indicators: ScoreResult["indicators"];
  freshness: ScoreResult["freshness"];
  quote: Quote | null;
  btcQuote: Quote | null;
  fearGreed: { value: number; label: string; previous: number | null; history: FearGreedPoint[] } | null;
  providerErrors: string[];
}

export interface DailySeriesDoc {
  _id: "solana" | "bitcoin";
  fetchedDay: string;
  fetchedAt: Date;
  points: DailyPoint[];
}

export interface SubscriptionDoc {
  _id?: import("mongodb").ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  settings: Settings;
  status: "active" | "disabled";
  createdAt: Date;
  lastUsedAt: Date | null;
  lastError?: string;
}

export interface AlertEventDoc {
  dedupeKey: string;
  subscriptionId: string;
  rules: (RuleId | "test")[];
  at: Date;
  bucket: string;
  score: number | null;
  price: number | null;
  classification: string | null;
  conditions: string[];
  indicators: Record<string, number | boolean | null>;
  modelVersion: string;
  delivery: "pending" | "sent" | "failed" | "expired";
  attempts: number;
  error?: string;
}

export interface MonitorRunDoc {
  at: Date;
  bucket: string;
  ok: boolean;
  durationMs: number;
  status: string;
  errors: string[];
  sent: number;
}

interface Cache {
  client?: MongoClient;
  db?: Db;
  indexes?: Promise<unknown>;
}
// Reuse one client across warm serverless invocations and dev hot reloads.
const g = globalThis as unknown as { __mongo?: Cache };
const cache: Cache = (g.__mongo ??= {});

export async function db(uri = process.env.MONGODB_URI!, name = process.env.MONGODB_DB ?? "datsolana"): Promise<Db> {
  if (!cache.db) {
    cache.client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    cache.db = cache.client.db(name);
  }
  cache.indexes ??= ensureIndexes(cache.db).catch((e) => {
    cache.indexes = undefined;
    throw e;
  });
  await cache.indexes;
  return cache.db;
}

/** Test helper: drop the cached connection. */
export async function resetDb() {
  await cache.client?.close();
  cache.client = cache.db = cache.indexes = undefined;
}

export const cols = (d: Db) => ({
  snapshots: d.collection<SnapshotDoc>("market_snapshots"),
  series: d.collection<DailySeriesDoc>("daily_series"),
  subscriptions: d.collection<SubscriptionDoc>("push_subscriptions"),
  alerts: d.collection<AlertEventDoc>("alert_events"),
  runs: d.collection<MonitorRunDoc>("monitor_runs"),
  rateLimits: d.collection<{ _id: string; count: number; expiresAt: Date }>("rate_limits"),
});

async function ensureIndexes(d: Db) {
  const c = cols(d);
  await Promise.all([
    c.snapshots.createIndex({ at: -1 }),
    c.snapshots.createIndex({ daily: 1, at: -1 }),
    // Intraday snapshots expire after 90 days; daily ones are kept for history and backtesting.
    c.snapshots.createIndex({ at: 1 }, { name: "intraday_ttl", expireAfterSeconds: 90 * 86400, partialFilterExpression: { daily: false } }),
    c.subscriptions.createIndex({ endpoint: 1 }, { unique: true }),
    c.alerts.createIndex({ dedupeKey: 1 }, { unique: true }),
    c.alerts.createIndex({ subscriptionId: 1, at: -1 }),
    c.alerts.createIndex({ at: 1 }, { expireAfterSeconds: 365 * 86400 }),
    c.runs.createIndex({ at: -1 }),
    c.runs.createIndex({ at: 1 }, { name: "runs_ttl", expireAfterSeconds: 30 * 86400 }),
    c.rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}
