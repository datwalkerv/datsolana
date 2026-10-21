import type { Metadata } from "next";
import { ContentBadge, Group, Header, PanelHeader, Placeholder, SimpleCell } from "datui";
import { History } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { ScoreHistoryChart } from "@/components/score-history-chart";
import { cols, db } from "@/lib/db";
import { classTone, usd } from "@/lib/format";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

async function load() {
  const c = cols(await db());
  const projection = { _id: 1, at: 1, score: 1, classification: 1, "quote.price": 1, "indicators.rsi": 1, "fearGreed.value": 1, reasons: 1, modelVersion: 1, status: 1 } as const;
  const [daily, recent] = await Promise.all([
    c.snapshots.find({ daily: true, status: "ok" }, { sort: { at: -1 }, limit: 180, projection }).toArray(),
    // Scan only class keys; fetch full details for the change points afterwards.
    c.snapshots.find({ status: "ok", at: { $gte: new Date(Date.now() - 90 * DAY) } }, { sort: { at: 1 }, projection: { _id: 1, "classification.key": 1 } }).toArray(),
  ]);
  // Signal history = moments the classification changed.
  const ids = recent.filter((s, i) => i > 0 && s.classification?.key !== recent[i - 1].classification?.key).map((s) => s._id);
  const changes = ids.length ? await c.snapshots.find({ _id: { $in: ids.slice(-50) } }, { sort: { at: -1 }, projection }).toArray() : [];
  return { daily: daily.reverse(), changes };
}

export default async function HistoryPage() {
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load();
  } catch (e) {
    console.error("[history] db read failed", e);
  }

  return (
    <>
      <PanelHeader>History</PanelHeader>
      {!data ? (
        <Placeholder icon={<History aria-hidden />} title="History unavailable">The database is unreachable right now.</Placeholder>
      ) : !data.daily.length ? (
        <Placeholder icon={<History aria-hidden />} title="No history yet">Daily snapshots accumulate as monitoring runs.</Placeholder>
      ) : (
        <>
          <Group header={<Header subtitle="First valid snapshot of each UTC day · dashed line = 65">Daily Opportunity Score</Header>}>
            <ScoreHistoryChart points={data.daily.map((s) => ({ t: s.at.getTime(), score: s.score!, price: s.quote?.price ?? null }))} />
          </Group>
          <Group header={<Header subtitle="Last 90 days">Classification changes</Header>}>
            {data.changes.length ? (
              data.changes.map((s) => (
                <SimpleCell
                  key={s._id}
                  multiline
                  hasHover={false}
                  hasActive={false}
                  overTitle={<LocalTime ms={s.at.getTime()} />}
                  after={
                    <ContentBadge size="s" variant="secondary" appearance={classTone(s.classification?.key)}>
                      {s.score}
                    </ContentBadge>
                  }
                  subtitle={[
                    `SOL ${usd(s.quote?.price)}`,
                    s.indicators.rsi !== null && `RSI ${s.indicators.rsi.toFixed(1)}`,
                    s.fearGreed && `F&G ${s.fearGreed.value}`,
                    `Model ${s.modelVersion}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  extraSubtitle={s.reasons.supporting[0] ?? s.reasons.contradicting[0]}
                >
                  {s.classification?.label}
                </SimpleCell>
              ))
            ) : (
              <p className="px-4 text-subhead text-muted-foreground">No classification changes in the last 90 days.</p>
            )}
          </Group>
        </>
      )}
      <p className="px-4 py-3 text-caption-1 text-muted-foreground">Past signals do not predict future returns.</p>
    </>
  );
}
