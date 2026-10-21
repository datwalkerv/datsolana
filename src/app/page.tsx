import { Banner, Card, CardGrid, ContentBadge, Group, Header, PanelHeader, Placeholder, Progress, SimpleCell } from "datui";
import { CircleAlert, CircleCheck, CircleMinus, TrendingUp } from "lucide-react";
import { FearGreedPanel } from "@/components/fear-greed";
import { PriceChart } from "@/components/price-chart";
import { ScoreGauge } from "@/components/score-gauge";
import { LocalTime } from "@/components/local-time";
import { cols, db, type SnapshotDoc } from "@/lib/db";
import { ago, classTone, compactUsd, pct, usd } from "@/lib/format";
import type { Stance } from "@/lib/scoring";
import { FRESHNESS } from "@/lib/scoring/config";

export const dynamic = "force-dynamic";

async function latest(): Promise<{ snap: SnapshotDoc | null; now: number; error?: string }> {
  const now = Date.now();
  try {
    return { snap: await cols(await db()).snapshots.findOne({}, { sort: { at: -1 } }), now };
  } catch (e) {
    console.error("[market] db read failed", e);
    return { snap: null, now, error: "The market database is unreachable right now." };
  }
}

const STANCE: Record<Stance, { label: string; appearance: "positive" | "negative" | "neutral"; icon: typeof CircleCheck }> = {
  supports: { label: "Supports", appearance: "positive", icon: CircleCheck },
  contradicts: { label: "Contradicts", appearance: "negative", icon: CircleAlert },
  neutral: { label: "Neutral", appearance: "neutral", icon: CircleMinus },
  unavailable: { label: "No data", appearance: "neutral", icon: CircleMinus },
};

export default async function MarketPage() {
  const { snap, now, error } = await latest();

  if (!snap)
    return (
      <>
        <PanelHeader>SOL Signal</PanelHeader>
        <Placeholder icon={<TrendingUp aria-hidden />} title={error ? "Data unavailable" : "Waiting for the first market check"}>
          {error ?? "Monitoring runs on a schedule. The first snapshot will appear here after the next run."}
        </Placeholder>
      </>
    );

  const quote = snap.quote;
  // Staleness is judged against the quote's own timestamp, never the time we stored it.
  const quoteAge = quote ? now - quote.updatedAt : Infinity;
  const stale = quoteAge > FRESHNESS.quoteMaxAgeMs;
  const tone = classTone(snap.classification?.key);
  const i = snap.indicators;

  const cards = [
    { key: "momentum", title: "RSI (14)", value: i.rsi?.toFixed(1) ?? "—" },
    { key: "trend", title: "20-day MA", value: usd(i.ma20), sub: `${pct(i.dev20)} from price` },
    { key: "trend", title: "50-day MA", value: usd(i.ma50), sub: `${pct(i.dev50)} from price` },
    { key: "drawdown", title: "From 90-day high", value: pct(i.drawdown90), sub: i.high90 ? `High ${usd(i.high90)}` : undefined },
    { key: "relative", title: "SOL vs BTC · 30D", value: pct(i.relBtc30), sub: i.btcAboveMa50 === null ? undefined : `BTC ${i.btcAboveMa50 ? "above" : "below"} 50D MA` },
    { key: "volume", title: "Volume trend", value: i.volRatio ? `${i.volRatio.toFixed(2)}×` : "—", sub: "7D vs prior 30D avg" },
  ] as const;

  return (
    <>
      <PanelHeader
        after={
          <ContentBadge className="me-3" size="s" variant="secondary" appearance={stale ? "negative" : "positive"}>
            {stale ? "Stale" : "Fresh"}
          </ContentBadge>
        }
      >
        SOL Signal
      </PanelHeader>

      {(stale || snap.status === "unavailable") && (
        <div className="px-4 pt-3">
          <Banner
            before={<CircleAlert className="text-destructive" aria-hidden />}
            title={stale ? "Showing the last valid snapshot — not live data" : "Score unavailable"}
            subtitle={[stale && `Price last updated ${quote ? ago(quote.updatedAt, now) : "never"}.`, ...snap.unavailableReasons].filter(Boolean).join(" ")}
          />
        </div>
      )}

      <Group>
        <div className="flex flex-col items-center gap-5 px-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <span className="text-caption-1 font-medium uppercase tracking-wide text-muted-foreground">SOL / USD</span>
            <span className="text-display-2 font-semibold tabular-nums">{usd(quote?.price)}</span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ContentBadge size="s" appearance={(quote?.change24h ?? 0) >= 0 ? "positive" : "negative"} variant="secondary">
                {pct(quote?.change24h, 2)} 24h
              </ContentBadge>
              <span className="text-caption-1 text-muted-foreground tabular-nums">
                7D {pct(quote?.change7d)} · 30D {pct(quote?.change30d)}
              </span>
            </div>
            <span className="text-caption-1 text-muted-foreground">
              Vol {compactUsd(quote?.volume24h)} · Mcap {compactUsd(quote?.marketCap)}
            </span>
          </div>
          <ScoreGauge score={snap.score} label={snap.classification?.label ?? "Unavailable"} tone={tone} />
        </div>
        <p className="px-4 pt-4 text-center text-caption-1 text-muted-foreground sm:text-start">
          Updated {quote ? <LocalTime ms={quote.updatedAt} /> : "—"} · Indicator coverage {Math.round(snap.coverage * 100)}% · Model {snap.modelVersion}
        </p>
      </Group>

      <Group header={<Header subtitle="Generated from the data and fixed rules, not predictions">Why this signal?</Header>}>
        {snap.reasons.supporting.map((r) => (
          <SimpleCell key={r} multiline hasHover={false} hasActive={false} before={<CircleCheck className="text-positive" aria-label="Supports" />}>
            {r}
          </SimpleCell>
        ))}
        {snap.reasons.contradicting.map((r) => (
          <SimpleCell key={r} multiline hasHover={false} hasActive={false} before={<CircleAlert className="text-destructive" aria-label="Contradicts" />}>
            {r}
          </SimpleCell>
        ))}
        {!snap.reasons.supporting.length && !snap.reasons.contradicting.length && (
          <p className="px-4 text-subhead text-muted-foreground">All available indicators are neutral.</p>
        )}
      </Group>

      <Group header={<Header>Price</Header>}>
        <PriceChart />
      </Group>

      <Group header={<Header subtitle="Weighted contribution of each indicator">Score breakdown</Header>}>
        {snap.components.map((c) => {
          const s = STANCE[c.stance];
          return (
            <div key={c.key} className="flex flex-col gap-1.5 px-4 py-2">
              <div className="flex items-center justify-between gap-2 text-subhead">
                <span className="font-medium">
                  {c.label} <span className="text-muted-foreground">· {Math.round(c.weight * 100)}%</span>
                </span>
                <span className="tabular-nums">{c.score ?? "—"}</span>
              </div>
              <Progress value={c.score ?? 0} appearance={s.appearance === "neutral" ? "var(--dt-muted-foreground)" : s.appearance} aria-label={`${c.label} score`} />
            </div>
          );
        })}
      </Group>

      <FearGreedPanel fg={snap.fearGreed} />

      <Group header={<Header>Technical indicators</Header>}>
        <CardGrid size="m" padding>
          {cards.map((card) => {
            const comp = snap.components.find((c) => c.key === card.key)!;
            const s = STANCE[comp.stance];
            return (
              <Card key={card.title} asChild variant="outline">
                <li className="flex flex-col gap-1.5 p-3">
                <span className="text-caption-1 text-muted-foreground">{card.title}</span>
                <span className="text-title-3 font-semibold tabular-nums">{card.value}</span>
                {"sub" in card && card.sub && <span className="text-caption-1 text-muted-foreground tabular-nums">{card.sub}</span>}
                <ContentBadge size="s" variant="secondary" appearance={s.appearance} className="self-start">
                  <s.icon className="size-3" aria-hidden /> {s.label}
                </ContentBadge>
                <span className="text-caption-1">{comp.interpretation}</span>
                </li>
              </Card>
            );
          })}
        </CardGrid>
      </Group>

      <p className="px-4 py-3 text-caption-1 text-muted-foreground">
        Decision support only. The Opportunity Score describes current conditions using heuristic thresholds; it is not a probability of profit,
        a buy recommendation, or financial advice. Market data: CoinGecko.
      </p>
    </>
  );
}
