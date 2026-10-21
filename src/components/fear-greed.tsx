import { ContentBadge, Group, Header } from "datui";
import type { SnapshotDoc } from "@/lib/db";
import { fearGreedLabel } from "@/lib/scoring/config";

type FG = NonNullable<SnapshotDoc["fearGreed"]>;

/** Current value, day-over-day change and a 7-day bar history. */
export function FearGreedPanel({ fg }: { fg: FG | null }) {
  const delta = fg && fg.previous !== null ? fg.value - fg.previous : null;
  return (
    <Group header={<Header>Fear &amp; Greed</Header>}>
      {!fg ? (
        <p className="px-4 text-subhead text-muted-foreground">The Fear &amp; Greed Index is currently unavailable. It is excluded from the score until it returns.</p>
      ) : (
        <div className="flex items-end justify-between gap-4 px-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-display-3 font-semibold tabular-nums">{fg.value}</span>
              <span className="text-headline-2 font-medium">{fg.label}</span>
            </div>
            {delta !== null && (
              <ContentBadge variant="secondary" appearance="neutral" size="s" className="self-start">
                {delta === 0 ? "Unchanged" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)}`} vs yesterday ({fg.previous})
              </ContentBadge>
            )}
          </div>
          <svg viewBox={`0 0 ${fg.history.length * 14} 48`} className="h-12 w-28" role="img" aria-label={`Last ${fg.history.length} days: ${fg.history.map((h) => h.value).join(", ")}`}>
            {fg.history.map((h, i) => {
              const height = Math.max(3, (h.value / 100) * 46);
              const last = i === fg.history.length - 1;
              return (
                <rect key={h.t} x={i * 14 + 2} y={48 - height} width={10} height={height} rx={3} fill={last ? "var(--dt-primary)" : "var(--dt-control-track)"}>
                  <title>{`${new Date(h.t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}: ${h.value} (${fearGreedLabel(h.value)})`}</title>
                </rect>
              );
            })}
          </svg>
        </div>
      )}
    </Group>
  );
}
