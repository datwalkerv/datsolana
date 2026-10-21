import { cols } from "@/lib/db";
import { buildPayload } from "@/lib/push";
import { EndpointSchema, deps, json, rateLimited, readBody } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (await rateLimited(req, "test-push", 5)) return json({ error: "Too many requests" }, 429);
  const body = await readBody(req, EndpointSchema);
  if (!body.ok) return body.res;
  const d = await deps();
  const c = cols(d.db);
  const sub = await c.subscriptions.findOne({ endpoint: body.data.endpoint });
  if (!sub) return json({ error: "Subscription not found" }, 404);

  const payload = buildPayload({
    title: "Test notification",
    body: "Notifications are working. You'll be alerted when your configured market conditions occur.",
    url: `${d.appUrl}/alerts`,
    tag: "sol-test",
  });
  const r = await d.send(sub, payload, d.vapid);
  await c.alerts.insertOne({
    dedupeKey: `${sub._id!.toHexString()}:test:${d.now}`,
    subscriptionId: sub._id!.toHexString(),
    rules: ["test"],
    at: new Date(d.now),
    bucket: "test",
    score: null,
    price: null,
    classification: null,
    conditions: ["Test notification"],
    indicators: {},
    modelVersion: "-",
    delivery: r.ok ? "sent" : r.expired ? "expired" : "failed",
    attempts: 1,
    ...(r.ok ? {} : { error: r.error }),
  });
  if (r.ok) await c.subscriptions.updateOne({ _id: sub._id }, { $set: { lastUsedAt: new Date(d.now) }, $unset: { lastError: "" } });
  else if (r.expired) await c.subscriptions.deleteOne({ _id: sub._id });
  else console.error("[test-push] failed", r.error);

  return r.ok ? json({ ok: true }) : json({ error: r.expired ? "Subscription expired — please re-enable notifications." : "Delivery failed, try again." }, r.expired ? 410 : 502);
}
