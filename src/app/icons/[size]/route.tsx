import { ImageResponse } from "next/og";

const SIZES = { "180": 180, "192": 192, "512": 512, maskable: 512 } as const;

// Solana mark, viewBox 0 0 397.7 311.7.
const SOLANA = [
  "M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z",
  "M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z",
  "M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z",
];

export const dynamic = "force-static";
export const generateStaticParams = () => Object.keys(SIZES).map((size) => ({ size }));

export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = SIZES[size as keyof typeof SIZES];
  if (!px) return new Response("Not found", { status: 404 });
  // Maskable icons need their glyphs inside the central 80% safe zone.
  const logo = px * (size === "maskable" ? 0.44 : 0.56);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #191919, #080808)", // datui dark background tokens
        }}
      >
        <svg width={logo} height={(logo * 311.7) / 397.7} viewBox="0 0 397.7 311.7" fill="#ffffff">
          {SOLANA.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}
