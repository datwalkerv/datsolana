import { env } from "@/lib/env";
import { runMonitor } from "@/lib/monitor";
import { bearerOk, deps, json } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron issues GET with `Authorization: Bearer $CRON_SECRET`; external schedulers may use either method.
async function handler(req: Request) {
  if (!bearerOk(req, env().CRON_SECRET)) return json({ error: "Unauthorized" }, 401);
  try {
    return json(await runMonitor(await deps()));
  } catch (e) {
    console.error("[monitor] run failed", e);
    return json({ error: "Monitor run failed" }, 500);
  }
}

export { handler as GET, handler as POST };
