"use client";

import { Button, Placeholder, SegmentedControl, Skeleton, Switch } from "datui";
import { useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pct, usd } from "@/lib/format";

type Range = "1d" | "7d" | "30d" | "90d" | "1y";
type Point = { t: number; price: number; ma20: number | null; ma50: number | null };

const RANGES: { value: Range; label: string }[] = [
  { value: "1d", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "1y", label: "1Y" },
];

const MA_STYLE = { ma20: "5 3", ma50: "1 3" } as const;

export function PriceChart() {
  const [range, setRange] = useState<Range>("30d");
  const [showMa, setShowMa] = useState(true);
  const [state, setState] = useState<{ range: Range; points?: Point[]; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/chart?range=${range}`)
      .then(async (r) => ((await r.json()) as { points?: Point[]; error?: string }))
      .then((d) => live && setState({ range, points: d.points, error: d.points ? undefined : (d.error ?? "Chart data unavailable") }))
      .catch(() => live && setState({ range, error: "Chart data unavailable — check your connection." }));
    return () => {
      live = false;
    };
  }, [range, retry]);

  const loading = state?.range !== range;
  const points = loading ? undefined : state?.points;
  const intraday = range === "1d" || range === "7d";
  const fmtTime = (t: number) =>
    new Date(t).toLocaleString("en-US", intraday ? { month: "short", day: "numeric", hour: "numeric" } : { month: "short", day: "numeric", ...(range === "1y" && { year: "2-digit" }) });
  const first = points?.[0]?.price;
  const last = points?.at(-1)?.price;
  const hasMa = !!points?.some((p) => p.ma20 !== null);

  return (
    <div className="flex flex-col gap-3 px-4">
      <SegmentedControl size="m" options={RANGES} value={range} onChange={(v) => setRange(v as Range)} aria-label="Chart timeframe" />
      <div className="flex items-center justify-between gap-3 text-caption-1 text-muted-foreground">
        <div className="flex items-center gap-4" aria-label="Legend">
          <span className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke="var(--dt-primary)" strokeWidth="2" /></svg>SOL/USD
          </span>
          {showMa && hasMa &&
            (["ma20", "ma50"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke="var(--dt-muted-foreground)" strokeWidth="2" strokeDasharray={MA_STYLE[k]} /></svg>
                {k === "ma20" ? "20D MA" : "50D MA"}
              </span>
            ))}
        </div>
        <label className="flex items-center gap-2">
          MA <Switch checked={showMa} onCheckedChange={setShowMa} aria-label="Show moving averages" />
        </label>
      </div>

      <div className="h-60 w-full">
        {loading ? (
          <Skeleton width="100%" height="100%" borderRadius="var(--dt-radius-lg)" visibilityDelay={150} />
        ) : !points?.length ? (
          <Placeholder title="Chart unavailable" action={<Button size="s" variant="secondary" onClick={() => setRetry((n) => n + 1)}>Retry</Button>}>
            {state?.error ?? "No data for this timeframe yet."}
          </Placeholder>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--dt-primary)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--dt-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--dt-separator)" />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtTime} tick={{ fill: "var(--dt-muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis orientation="right" domain={["auto", "auto"]} tickFormatter={(v: number) => `$${v.toFixed(0)}`} tick={{ fill: "var(--dt-muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                cursor={{ stroke: "var(--dt-muted-foreground)", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const p = active && (payload?.[0]?.payload as Point | undefined);
                  if (!p) return null;
                  return (
                    <div className="rounded-md border border-border bg-popover px-3 py-2 text-caption-1 text-popover-foreground shadow-md">
                      <div className="text-muted-foreground">{new Date(p.t).toLocaleString("en-US", { dateStyle: "medium", ...(intraday && { timeStyle: "short" }) })}</div>
                      <div className="font-semibold tabular-nums">{usd(p.price)}</div>
                      {showMa && p.ma20 !== null && <div className="tabular-nums text-muted-foreground">20D MA {usd(p.ma20)}</div>}
                      {showMa && p.ma50 !== null && <div className="tabular-nums text-muted-foreground">50D MA {usd(p.ma50)}</div>}
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="price" stroke="var(--dt-primary)" strokeWidth={2} fill="url(#priceFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--dt-background)" }} isAnimationActive={false} />
              {showMa &&
                (["ma20", "ma50"] as const).map((k) => (
                  <Line key={k} type="stepAfter" dataKey={k} stroke="var(--dt-muted-foreground)" strokeWidth={2} strokeDasharray={MA_STYLE[k]} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
                ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {first !== undefined && last !== undefined && (
        <p className="sr-only">
          SOL moved from {usd(first)} to {usd(last)} ({pct(last / first - 1)}) over the selected timeframe.
        </p>
      )}
    </div>
  );
}
