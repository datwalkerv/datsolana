import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_SETTINGS, type Settings } from "./alerts";
import { cols, db } from "./db";
import { env } from "./env";
import { alternativeMe, coingecko } from "./providers";
import { sendPush } from "./push";

export async function deps(now = Date.now()) {
  const e = env();
  return {
    db: await db(e.MONGODB_URI, e.MONGODB_DB),
    market: coingecko(e.COINGECKO_API_KEY),
    sentiment: alternativeMe,
    send: sendPush,
    vapid: { subject: e.VAPID_SUBJECT, publicKey: e.NEXT_PUBLIC_VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY },
    appUrl: e.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""),
    now,
  };
}

export function bearerOk(req: Request, secret: string) {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

/** Fixed-window limiter in Mongo (in-memory counters don't survive across serverless instances). */
export async function rateLimited(req: Request, route: string, limit: number, windowSec = 60) {
  const window = Math.floor(Date.now() / (windowSec * 1000));
  const r = await cols(await db()).rateLimits.findOneAndUpdate(
    { _id: `${route}:${clientIp(req)}:${window}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowSec * 1000) } },
    { upsert: true, returnDocument: "after" },
  );
  return (r?.count ?? 0) > limit;
}

export const SubscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(2048),
  keys: z.object({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(64) }),
});

export const EndpointSchema = z.object({ endpoint: z.url().startsWith("https://").max(2048) });

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 8192) return { ok: false, res: json({ error: "Payload too large" }, 413) };
  const body = await req.json().catch(() => undefined);
  const r = schema.safeParse(body);
  return r.success ? { ok: true, data: r.data } : { ok: false, res: json({ error: "Invalid request", issues: r.error.issues.map((i) => i.message) }, 400) };
}

export const mergeSettings = (s: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...s, enabled: { ...DEFAULT_SETTINGS.enabled, ...s.enabled } });

/** Settings returned to the device that owns the subscription; keys never leave the server. */
export async function publicSubscription(endpoint: string) {
  const c = cols(await db());
  const sub = await c.subscriptions.findOne({ endpoint });
  if (!sub) return null;
  const recent = await c.alerts
    .find({ subscriptionId: sub._id!.toHexString() }, { sort: { at: -1 }, limit: 20, projection: { _id: 0, dedupeKey: 0, subscriptionId: 0 } })
    .toArray();
  return { status: sub.status, settings: mergeSettings(sub.settings), createdAt: sub.createdAt, lastUsedAt: sub.lastUsedAt, lastError: sub.lastError ?? null, recent };
}
