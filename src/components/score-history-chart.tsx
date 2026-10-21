"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ScoreHistoryChart({ points }: { points: { t: number; score: number; price: number | null }[] }) {
  const tick = { fill: "var(--dt-muted-foreground)", fontSize: 11 };
  return (
    <div className="h-48 w-full px-2" role="img" aria-label={`Daily Opportunity Score for the last ${points.length} days`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--dt-separator)" />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={tick} tickLine={false} axisLine={false} minTickGap={40}
            tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
          <YAxis domain={[0, 100]} ticks={[0, 40, 65, 80, 100]} tick={tick} tickLine={false} axisLine={false} width={28} />
          <ReferenceLine y={65} stroke="var(--dt-muted-foreground)" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ stroke: "var(--dt-muted-foreground)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = active && (payload?.[0]?.payload as (typeof points)[number] | undefined);
              if (!p) return null;
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-caption-1 text-popover-foreground shadow-md">
                  <div className="text-muted-foreground">{new Date(p.t).toLocaleDateString("en-US", { dateStyle: "medium" })}</div>
                  <div className="font-semibold tabular-nums">Score {p.score}</div>
                  {p.price !== null && <div className="tabular-nums text-muted-foreground">SOL ${p.price.toFixed(2)}</div>}
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="score" stroke="var(--dt-primary)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--dt-background)" }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
