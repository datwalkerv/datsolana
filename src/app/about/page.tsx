import type { Metadata } from "next";
import { Group, Header, InfoRow, PanelHeader, SimpleCell } from "datui";
import { Github } from "@/components/github-icon";
import { CLASSES, FEAR_GREED_BANDS, MODEL_VERSION, WEIGHTS } from "@/lib/scoring/config";

export const metadata: Metadata = { title: "About" };

const LABELS: Record<keyof typeof WEIGHTS, string> = {
  sentiment: "Fear & Greed sentiment",
  trend: "SOL trend and moving averages",
  momentum: "RSI and momentum",
  drawdown: "Drawdown and recovery",
  relative: "SOL relative performance versus BTC",
  volume: "Trading-volume confirmation",
};

export default function AboutPage() {
  return (
    <>
      <PanelHeader>About</PanelHeader>
      <Group header={<Header>What this is</Header>}>
        <p className="px-4 text-subhead">
          SOL Signal monitors Solana market conditions every 15 minutes and summarizes them as an explainable Opportunity Score from 0 to 100. The score
          describes how favorable observed conditions may be for <em>considering</em> a purchase. It is not a probability of profit, does not execute
          trades, and is not financial advice.
        </p>
      </Group>

      <Group header={<Header subtitle={`Model ${MODEL_VERSION}`}>How the score works</Header>} description="Missing non-critical indicators are excluded and the remaining weights renormalized. Without a fresh price and enough history, no score is produced. When indicators strongly disagree, the score is pulled toward neutral.">
        {Object.entries(WEIGHTS).map(([k, w]) => (
          <SimpleCell key={k} hasHover={false} hasActive={false} after={<span className="tabular-nums">{Math.round(w * 100)}%</span>}>
            {LABELS[k as keyof typeof WEIGHTS]}
          </SimpleCell>
        ))}
      </Group>

      <Group header={<Header>Classifications</Header>} description="Configurable heuristic thresholds, not empirically validated trading rules.">
        {CLASSES.map((c, i) => (
          <SimpleCell key={c.key} hasHover={false} hasActive={false} after={<span className="tabular-nums">{c.min}–{i === 0 ? 100 : CLASSES[i - 1].min - 1}</span>}>
            {c.label}
          </SimpleCell>
        ))}
      </Group>

      <Group header={<Header>Fear &amp; Greed bands</Header>} description="A broad crypto-market sentiment indicator from Alternative.me, not SOL-specific. Bands follow this app's definition, which can differ slightly from the source's own labels.">
        {FEAR_GREED_BANDS.map((b, i) => (
          <SimpleCell key={b.label} hasHover={false} hasActive={false} after={<span className="tabular-nums">{i === 0 ? 0 : FEAR_GREED_BANDS[i - 1].max + 1}–{b.max}</span>}>
            {b.label}
          </SimpleCell>
        ))}
      </Group>

      <Group header={<Header>Data sources</Header>}>
        <div className="flex flex-col gap-3 px-4">
          <InfoRow header="Market data">CoinGecko (price, volume, market cap, daily history up to 365 days)</InfoRow>
          <InfoRow header="Sentiment">Alternative.me Crypto Fear &amp; Greed Index (updates daily)</InfoRow>
        </div>
      </Group>

      <Group header={<Header>Repository</Header>}>
        <SimpleCell
          href="https://github.com/datwalkerv/datsolana"
          target="_blank"
          rel="noopener noreferrer"
          before={<Github aria-hidden />}
          subtitle="github.com/datwalkerv/datsolana"
          chevron
        >
          Source code on GitHub
        </SimpleCell>
      </Group>
    </>
  );
}
