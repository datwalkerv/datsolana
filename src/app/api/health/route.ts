import { cols, db } from "@/lib/db";
import { json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Public monitoring health: last run and last successful run. No secrets or subscription data. */
export async function GET() {
  try {
    const c = cols(await db());
    const [last, lastOk, snap] = await Promise.all([
      c.runs.findOne({}, { sort: { at: -1 }, projection: { _id: 0 } }),
      c.runs.findOne({ ok: true }, { sort: { at: -1 }, projection: { _id: 0, at: 1 } }),
      c.snapshots.findOne({}, { sort: { at: -1 }, projection: { "quote.updatedAt": 1, status: 1 } }),
    ]);
    return json({
      lastRun: last && { at: last.at, ok: last.ok, status: last.status, errors: last.errors, sent: last.sent },
      lastSuccessAt: lastOk?.at ?? null,
      quoteUpdatedAt: snap?.quote?.updatedAt ?? null,
    });
  } catch {
    return json({ error: "Database unreachable" }, 503);
  }
}
