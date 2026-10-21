import { cols, db } from "@/lib/db";
import { DAY_MS, finalizedDaily, smaSeries, startOfUtcDay } from "@/lib/indicators";
import { coingecko } from "@/lib/providers";
import { json } from "@/lib/server";

export const dynamic = "force-dynamic";

const RANGES = { "1d": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as const;
type Range = keyof typeof RANGES;

export async function GET(req: Request) {
  const range = new URL(req.url).searchParams.get("range") as Range;
  if (!(range in RANGES)) return json({ error: "Invalid range" }, 400);
  const now = Date.now();

  const series = await cols(await db()).series.findOne({ _id: "solana" });
  const daily = finalizedDaily(series?.points ?? [], now).candles;
  const closes = daily.map((c) => c.price);
  const ma20 = smaSeries(closes, 20);
  const ma50 = smaSeries(closes, 50);
  // MA known at each midnight, applied to that whole day (no look-ahead into the unfinished day).
  const maAt = new Map(daily.map((c, i) => [c.t, { ma20: ma20[i], ma50: ma50[i] }]));

  let points: { t: number; price: number }[];
  if (range === "1y") points = daily;
  else {
    // Two cached upstream calls (1d → 5-min, 90d → hourly) back all intraday ranges.
    const r = await coingecko(process.env.COINGECKO_API_KEY).intraday(range === "1d" ? 1 : 90);
    if (!r.ok) return json({ error: r.error }, 502);
    points = r.data.filter((p) => p.t >= now - RANGES[range] * DAY_MS);
  }

  return Response.json(
    {
      range,
      points: points.map((p) => ({ t: p.t, price: p.price, ...(maAt.get(startOfUtcDay(p.t)) ?? { ma20: null, ma50: null }) })),
    },
    { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } },
  );
}
