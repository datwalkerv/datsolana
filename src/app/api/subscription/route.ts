import { z } from "zod";
import { DEFAULT_SETTINGS } from "@/lib/alerts";
import { cols, db } from "@/lib/db";
import { EndpointSchema, SubscriptionSchema, json, mergeSettings, publicSubscription, rateLimited, readBody } from "@/lib/server";

export const dynamic = "force-dynamic";

const RegisterSchema = z.object({ subscription: SubscriptionSchema, oldEndpoint: z.url().max(2048).optional() });

/** Register a subscription, or replace one whose endpoint rotated (settings carry over). */
export async function POST(req: Request) {
  if (await rateLimited(req, "subscribe", 10)) return json({ error: "Too many requests" }, 429);
  const body = await readBody(req, RegisterSchema);
  if (!body.ok) return body.res;
  const { subscription, oldEndpoint } = body.data;
  const c = cols(await db());

  const previous = oldEndpoint && oldEndpoint !== subscription.endpoint ? await c.subscriptions.findOne({ endpoint: oldEndpoint }) : null;
  const existing = await c.subscriptions.findOne({ endpoint: subscription.endpoint });
  const settings = mergeSettings(existing?.settings ?? previous?.settings ?? DEFAULT_SETTINGS);

  await c.subscriptions.updateOne(
    { endpoint: subscription.endpoint },
    { $set: { keys: subscription.keys, settings, status: "active" }, $setOnInsert: { createdAt: new Date(), lastUsedAt: null } },
    { upsert: true },
  );
  if (previous) await c.subscriptions.deleteOne({ _id: previous._id });
  return json(await publicSubscription(subscription.endpoint));
}

export async function DELETE(req: Request) {
  if (await rateLimited(req, "subscribe", 10)) return json({ error: "Too many requests" }, 429);
  const body = await readBody(req, EndpointSchema);
  if (!body.ok) return body.res;
  await cols(await db()).subscriptions.deleteOne({ endpoint: body.data.endpoint });
  return json({ ok: true });
}
