import { z } from "zod";
import { SettingsSchema } from "@/lib/alerts";
import { cols, db } from "@/lib/db";
import { EndpointSchema, json, publicSubscription, rateLimited, readBody } from "@/lib/server";

export const dynamic = "force-dynamic";

/** POST: read this device's settings. The endpoint is sent in the body so it never lands in URLs or logs. */
export async function POST(req: Request) {
  if (await rateLimited(req, "settings", 60)) return json({ error: "Too many requests" }, 429);
  const body = await readBody(req, EndpointSchema);
  if (!body.ok) return body.res;
  const sub = await publicSubscription(body.data.endpoint);
  return sub ? json(sub) : json({ error: "Subscription not found" }, 404);
}

const UpdateSchema = EndpointSchema.extend({
  settings: SettingsSchema.refine((s) => s.scoreStrong > s.scorePotential, "Strong threshold must exceed the potential threshold").optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export async function PUT(req: Request) {
  if (await rateLimited(req, "settings", 30)) return json({ error: "Too many requests" }, 429);
  const body = await readBody(req, UpdateSchema);
  if (!body.ok) return body.res;
  const { endpoint, settings, status } = body.data;
  const r = await cols(await db()).subscriptions.updateOne({ endpoint }, { $set: { ...(settings && { settings }), ...(status && { status }) } });
  if (!r.matchedCount) return json({ error: "Subscription not found" }, 404);
  return json(await publicSubscription(endpoint));
}
