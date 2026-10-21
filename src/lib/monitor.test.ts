import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./alerts";
import { cols, db, resetDb } from "./db";
import { DAY_MS, startOfUtcDay } from "./indicators";
import { runMonitor, type MonitorDeps } from "./monitor";
import { coingecko, type MarketDataProvider, type SentimentProvider } from "./providers";
import type { Sender } from "./push";

let mongo: MongoMemoryServer;
const T0 = Date.UTC(2026, 9, 21, 12, 0);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "test";
});
afterAll(async () => {
  await resetDb();
  await mongo.stop();
});
beforeEach(async () => {
  await (await db()).dropDatabase();
  await resetDb();
});

/** Daily history: decline then a sharp rebound, so the score can move with the live price. */
function history(now: number, base: number) {
  const today = startOfUtcDay(now);
  return Array.from({ length: 200 }, (_, i) => ({ t: today - (199 - i) * DAY_MS, price: base + Math.sin(i / 7) * base * 0.1, volume: 1e9 }));
}

function market(price: () => number | null): MarketDataProvider {
  return {
    name: "fake",
    async quotes() {
      const p = price();
      if (p === null) return { ok: false, error: "provider down" };
      const q = (v: number) => ({ price: v, change24h: 0.01, change7d: 0.02, change30d: -0.05, volume24h: 1e9, marketCap: 6e10, updatedAt: T0 });
      return { ok: true, data: { sol: q(p), btc: q(p * 800) } };
    },
    async daily(coin) {
      return { ok: true, data: history(T0, coin === "solana" ? 100 : 80_000) };
    },
    async intraday() {
      return { ok: true, data: [] };
    },
  };
}

const sentiment: SentimentProvider = { name: "fake", fearGreed: async () => ({ ok: true, data: [{ value: 40, t: startOfUtcDay(T0) - DAY_MS }, { value: 20, t: startOfUtcDay(T0) }] }) };

async function subscribe(endpoint = "https://push.example/abc") {
  const d = await db();
  await cols(d).subscriptions.insertOne({ endpoint, keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) }, settings: DEFAULT_SETTINGS, status: "active", createdAt: new Date(), lastUsedAt: null });
}

const vapid = { subject: "mailto:t@example.com", publicKey: "p", privateKey: "k" };

async function deps(over: Partial<MonitorDeps>): Promise<MonitorDeps> {
  return { db: await db(), market: market(() => 100), sentiment, send: vi.fn<Sender>(async () => ({ ok: true })), vapid, appUrl: "https://app.example", now: T0, ...over };
}

describe("runMonitor", () => {
  it("persists one snapshot per bucket and is idempotent", async () => {
    const d = await deps({});
    const a = await runMonitor(d);
    const b = await runMonitor({ ...d, now: T0 + 5 * 60_000 });
    expect(a.bucket).toBe(b.bucket);
    const c = cols(d.db);
    expect(await c.snapshots.countDocuments()).toBe(1);
    const snap = await c.snapshots.findOne({});
    expect(snap!.status).toBe("ok");
    expect(snap!.daily).toBe(true);
    expect(snap!.modelVersion).toBeTruthy();
    expect(await c.runs.countDocuments()).toBe(2);
    expect((await c.series.findOne({ _id: "solana" }))!.fetchedDay).toBe("2026-10-21");
  });

  it("sends a crossing alert exactly once, then respects cooldown", async () => {
    await subscribe();
    const send = vi.fn<Sender>(async () => ({ ok: true }));
    // Previous bucket: no extreme fear yet.
    const fg0: SentimentProvider = { name: "f", fearGreed: async () => ({ ok: true, data: [{ value: 40, t: startOfUtcDay(T0) }] }) };
    await runMonitor(await deps({ send, sentiment: fg0, now: T0 - 15 * 60_000 }));
    expect(send).not.toHaveBeenCalled();

    const d = await deps({ send, now: T0 });
    await runMonitor(d);
    await runMonitor({ ...d, now: T0 + 60_000 }); // same bucket again
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0][1]);
    expect(payload.web_push).toBe(8030);
    expect(payload.notification.navigate).toMatch(/^https:\/\/app\.example\//);
    const ev = await cols(d.db).alerts.findOne({});
    expect(ev!.rules).toContain("extreme_fear");
    expect(ev!.delivery).toBe("sent");

    // Next bucket, condition re-triggers (prev above threshold again) but cooldown holds.
    await runMonitor(await deps({ send, sentiment: fg0, now: T0 + 15 * 60_000 }));
    await runMonitor(await deps({ send, now: T0 + 30 * 60_000 }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("removes expired subscriptions on 410 and logs failures", async () => {
    await subscribe();
    const fg0: SentimentProvider = { name: "f", fearGreed: async () => ({ ok: true, data: [{ value: 40, t: startOfUtcDay(T0) }] }) };
    await runMonitor(await deps({ sentiment: fg0, now: T0 - 15 * 60_000 }));
    const d = await deps({ send: async () => ({ ok: false, expired: true, error: "410: Gone" }) });
    await runMonitor(d);
    const c = cols(d.db);
    expect(await c.subscriptions.countDocuments()).toBe(0);
    expect((await c.alerts.findOne({}))!.delivery).toBe("expired");
  });

  it("never alerts on unavailable data", async () => {
    await subscribe();
    const send = vi.fn<Sender>(async () => ({ ok: true }));
    const d = await deps({ send, market: market(() => null) });
    const r = await runMonitor(d);
    expect(r.status).toBe("unavailable");
    expect(r.errors).toContain("provider down");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("provider validation", () => {
  it("rejects malformed CoinGecko responses instead of substituting data", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ id: "solana", current_price: "oops" }])));
    const r = await coingecko().quotes();
    expect(r.ok).toBe(false);
    spy.mockResolvedValue(new Response("busy", { status: 429 }));
    expect((await coingecko().daily("solana", 365)).ok).toBe(false);
    spy.mockRestore();
  });
});

describe("routes", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      CRON_SECRET: "s".repeat(40),
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "B".repeat(87),
      VAPID_PRIVATE_KEY: "k".repeat(43),
      VAPID_SUBJECT: "mailto:t@example.com",
      NEXT_PUBLIC_APP_URL: "https://app.example",
    });
  });

  it("/api/monitor rejects missing or wrong secrets", async () => {
    const { GET } = await import("@/app/api/monitor/route");
    expect((await GET(new Request("https://x/api/monitor"))).status).toBe(401);
    expect((await GET(new Request("https://x/api/monitor", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  });

  it("registers, replaces and deletes a subscription", async () => {
    const route = await import("@/app/api/subscription/route");
    const settings = await import("@/app/api/subscription/settings/route");
    const req = (method: string, body: unknown) => new Request("https://x/api/subscription", { method, body: JSON.stringify(body), headers: { "x-forwarded-for": "1.2.3.4" } });
    const keys = { p256dh: "p".repeat(40), auth: "a".repeat(16) };

    expect((await route.POST(req("POST", { subscription: { endpoint: "http://insecure", keys } }))).status).toBe(400);
    const created = await route.POST(req("POST", { subscription: { endpoint: "https://push.example/1", keys } }));
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(body.settings.scorePotential).toBe(65);
    expect(JSON.stringify(body)).not.toContain(keys.auth);

    await settings.PUT(req("PUT", { endpoint: "https://push.example/1", settings: { ...DEFAULT_SETTINGS, scorePotential: 70 } }));
    await route.POST(req("POST", { subscription: { endpoint: "https://push.example/2", keys }, oldEndpoint: "https://push.example/1" }));
    const c = cols(await db());
    expect(await c.subscriptions.countDocuments()).toBe(1);
    expect((await c.subscriptions.findOne({}))!.settings.scorePotential).toBe(70);

    expect((await settings.PUT(req("PUT", { endpoint: "https://push.example/2", settings: { ...DEFAULT_SETTINGS, scoreStrong: 50 } }))).status).toBe(400);
    await route.DELETE(req("DELETE", { endpoint: "https://push.example/2" }));
    expect(await c.subscriptions.countDocuments()).toBe(0);
  });

  it("rate limits subscription registration", async () => {
    const route = await import("@/app/api/subscription/route");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await route.DELETE(new Request("https://x", { method: "DELETE", body: JSON.stringify({ endpoint: "https://push.example/z" }), headers: { "x-forwarded-for": "9.9.9.9" } }))).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
