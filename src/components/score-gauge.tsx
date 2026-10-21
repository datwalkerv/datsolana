import type { Tone } from "@/lib/format";

const TONE_COLOR: Record<Tone, string> = {
  positive: "var(--dt-positive)",
  negative: "var(--dt-destructive)",
  neutral: "var(--dt-warning)",
};

/** Semicircle gauge for the 0–100 Opportunity Score; the number and label carry meaning, the color only reinforces it. */
export function ScoreGauge({ score, label, tone }: { score: number | null; label: string; tone: Tone }) {
  const r = 52;
  const len = Math.PI * r;
  const filled = score === null ? 0 : (score / 100) * len;
  return (
    <figure className="flex flex-col items-center" aria-label={score === null ? "Opportunity Score unavailable" : `Opportunity Score ${score} of 100, ${label}`}>
      <svg viewBox="0 0 128 72" className="w-44" aria-hidden>
        <path d="M 12 64 A 52 52 0 0 1 116 64" fill="none" stroke="var(--dt-control-track)" strokeWidth="10" strokeLinecap="round" />
        {score !== null && (
          <path
            d="M 12 64 A 52 52 0 0 1 116 64"
            fill="none"
            stroke={TONE_COLOR[tone]}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${len}`}
            style={{ transition: "stroke-dasharray var(--dt-duration-slow) var(--dt-ease-standard)" }}
          />
        )}
        <text x="64" y="58" textAnchor="middle" className="fill-foreground" style={{ font: "600 30px var(--dt-font-sans)", fontVariantNumeric: "tabular-nums" }}>
          {score ?? "—"}
        </text>
      </svg>
      <figcaption className="text-center">
        <span className="block text-headline-2 font-semibold">{label}</span>
        <span className="block text-caption-1 text-muted-foreground">Opportunity Score · 0–100</span>
      </figcaption>
    </figure>
  );
}
