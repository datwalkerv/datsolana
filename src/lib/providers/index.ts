import { z } from "zod";
import type { DailyPoint, FearGreedPoint, Quote } from "../types";

/** Provider results are explicit about failure; callers never receive substituted data. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface MarketDataProvider {
  name: string;
  quotes(): Promise<Result<{ sol: Quote; btc: Quote }>>;
  /** Raw daily series (may include a live, incomplete last point; callers filter). */
  daily(coin: "solana" | "bitcoin", days: number): Promise<Result<DailyPoint[]>>;
  /** Intraday series for charts: 1 day → ~5-minute points, 2–90 days → hourly. */
  intraday(days: 1 | 90): Promise<Result<{ t: number; price: number }[]>>;
}

export interface SentimentProvider {
  name: string;
  /** Ascending by time. `limit` 0 = full history. */
  fearGreed(limit: number): Promise<Result<FearGreedPoint[]>>;
}

const TIMEOUT_MS = 10_000;

async function getJson(url: string, init: RequestInit & { next?: { revalidate: number } } = {}): Promise<Result<unknown>> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, error: `${new URL(url).host} responded ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: `${new URL(url).host}: ${(e as Error).message}` };
  }
}

function parse<T>(schema: z.ZodType<T>, r: Result<unknown>, what: string): Result<T> {
  if (!r.ok) return r;
  const p = schema.safeParse(r.data);
  return p.success ? { ok: true, data: p.data } : { ok: false, error: `${what}: unexpected response shape (${p.error.issues[0]?.message})` };
}

const num = z.number().finite();
const MarketsSchema = z
  .array(
    z.object({
      id: z.string(),
      current_price: num.positive(),
      market_cap: num.nullable(),
      total_volume: num.nullable(),
      last_updated: z.string().datetime({ offset: true }),
      price_change_percentage_24h_in_currency: num.nullable().optional(),
      price_change_percentage_7d_in_currency: num.nullable().optional(),
      price_change_percentage_30d_in_currency: num.nullable().optional(),
    }),
  )
  .min(1);

const ChartSchema = z.object({
  prices: z.array(z.tuple([num, num])).min(1),
  total_volumes: z.array(z.tuple([num, num])),
});

export function coingecko(apiKey?: string): MarketDataProvider {
  const base = "https://api.coingecko.com/api/v3";
  const headers: HeadersInit = apiKey ? { "x-cg-demo-api-key": apiKey, accept: "application/json" } : { accept: "application/json" };
  return {
    name: "CoinGecko",
    async quotes() {
      const r = parse(
        MarketsSchema,
        await getJson(`${base}/coins/markets?vs_currency=usd&ids=solana,bitcoin&price_change_percentage=24h,7d,30d`, { headers, cache: "no-store" }),
        "CoinGecko markets",
      );
      if (!r.ok) return r;
      const toQuote = (id: string): Quote | null => {
        const m = r.data.find((x) => x.id === id);
        if (!m) return null;
        const pctOrNull = (v: number | null | undefined) => (v == null ? null : v / 100);
        return {
          price: m.current_price,
          change24h: pctOrNull(m.price_change_percentage_24h_in_currency),
          change7d: pctOrNull(m.price_change_percentage_7d_in_currency),
          change30d: pctOrNull(m.price_change_percentage_30d_in_currency),
          volume24h: m.total_volume,
          marketCap: m.market_cap,
          updatedAt: Date.parse(m.last_updated),
        };
      };
      const sol = toQuote("solana");
      const btc = toQuote("bitcoin");
      return sol && btc ? { ok: true, data: { sol, btc } } : { ok: false, error: "CoinGecko markets: missing SOL or BTC" };
    },
    async daily(coin, days) {
      const r = parse(ChartSchema, await getJson(`${base}/coins/${coin}/market_chart?vs_currency=usd&days=${days}&interval=daily`, { headers, cache: "no-store" }), `CoinGecko ${coin} history`);
      if (!r.ok) return r;
      const vol = new Map(r.data.total_volumes.map(([t, v]) => [t, v]));
      return { ok: true, data: r.data.prices.map(([t, price]) => ({ t, price, volume: vol.get(t) ?? Number.NaN })) };
    },
    async intraday(days) {
      const r = parse(
        ChartSchema,
        await getJson(`${base}/coins/solana/market_chart?vs_currency=usd&days=${days}`, { headers, next: { revalidate: 3600 } }),
        "CoinGecko intraday",
      );
      return r.ok ? { ok: true, data: r.data.prices.map(([t, price]) => ({ t, price })) } : r;
    },
  };
}

const FngSchema = z.object({
  data: z
    .array(z.object({ value: z.string().regex(/^\d{1,3}$/), timestamp: z.string().regex(/^\d+$/) }))
    .min(1),
});

export const alternativeMe: SentimentProvider = {
  name: "Alternative.me",
  async fearGreed(limit) {
    const r = parse(FngSchema, await getJson(`https://api.alternative.me/fng/?limit=${limit}`, { cache: "no-store" }), "Fear & Greed");
    if (!r.ok) return r;
    const pts = r.data.data
      .map((d) => ({ value: Number(d.value), t: Number(d.timestamp) * 1000 }))
      .filter((p) => p.value >= 0 && p.value <= 100)
      .sort((a, b) => a.t - b.t);
    return pts.length ? { ok: true, data: pts } : { ok: false, error: "Fear & Greed: no valid values" };
  },
};
